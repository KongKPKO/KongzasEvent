create or replace function public.complete_order_with_stock(
  p_order_id uuid,
  p_payment_method text,
  p_payment_idempotency_key uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_item record;
  v_reserved integer;
  v_missing integer;
  v_unreserved_available integer;
begin
  select o.*, e.artist_id
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
  for update of o;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  if v_order.status = 'completed' then
    if p_payment_idempotency_key is not null
       and v_order.payment_idempotency_key is not null
       and v_order.payment_idempotency_key <> p_payment_idempotency_key then
      raise exception 'payment_idempotency_key_conflict';
    end if;

    if not public.has_artist_role(v_order.artist_id, array['owner', 'queue_pos']) then
      raise exception 'forbidden';
    end if;

    if p_payment_idempotency_key is not null and v_order.payment_idempotency_key is null then
      update public.orders
      set payment_idempotency_key = p_payment_idempotency_key
      where id = v_order.id;
    end if;

    return true;
  end if;

  if v_order.status = 'cancelled' then
    if not public.has_artist_role(v_order.artist_id, array['owner', 'queue_pos']) then
      raise exception 'forbidden';
    end if;

    raise exception 'order_cancelled';
  end if;

  if p_payment_idempotency_key is not null
     and v_order.payment_idempotency_key is not null
     and v_order.payment_idempotency_key <> p_payment_idempotency_key then
    raise exception 'payment_idempotency_key_conflict';
  end if;

  if not public.has_artist_role(v_order.artist_id, array['owner', 'queue_pos']) then
    raise exception 'forbidden';
  end if;

  for v_item in
    select
      oi.product_id,
      oi.event_product_id,
      oi.quantity,
      p.is_unlimited as product_unlimited,
      p.stock_reserved as product_reserved,
      p.stock_sold as product_sold,
      p.stock_total as product_total,
      ep.is_unlimited as event_unlimited,
      ep.stock_reserved as event_reserved,
      ep.stock_sold as event_sold,
      ep.stock_total as event_total
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    left join public.event_products ep on ep.id = oi.event_product_id
    where oi.order_id = v_order.id
    for update of p
  loop
    if v_item.event_product_id is not null then
      if coalesce(v_item.event_unlimited, true) then
        continue;
      end if;

      v_reserved := least(coalesce(v_item.event_reserved, 0), v_item.quantity);
      v_missing := v_item.quantity - v_reserved;
      v_unreserved_available := coalesce(v_item.event_total, 0) - coalesce(v_item.event_sold, 0) - coalesce(v_item.event_reserved, 0);

      if v_missing > v_unreserved_available then
        raise exception 'insufficient_stock_on_complete';
      end if;

      update public.event_products
      set stock_reserved = greatest(stock_reserved - v_reserved, 0),
          stock_sold = stock_sold + v_item.quantity
      where id = v_item.event_product_id;
    elsif not coalesce(v_item.product_unlimited, true) then
      v_reserved := least(coalesce(v_item.product_reserved, 0), v_item.quantity);
      v_missing := v_item.quantity - v_reserved;
      v_unreserved_available := coalesce(v_item.product_total, 0) - coalesce(v_item.product_sold, 0) - coalesce(v_item.product_reserved, 0);

      if v_missing > v_unreserved_available then
        raise exception 'insufficient_stock_on_complete';
      end if;

      update public.products
      set stock_reserved = greatest(stock_reserved - v_reserved, 0),
          stock_sold = stock_sold + v_item.quantity,
          updated_at = now()
      where id = v_item.product_id;
    end if;
  end loop;

  update public.orders
  set status = 'completed',
      payment_method = p_payment_method,
      payment_idempotency_key = coalesce(payment_idempotency_key, p_payment_idempotency_key)
  where id = v_order.id;

  if v_order.queue_id is not null then
    update public.queues
    set status = 'complete',
        completed_at = now(),
        last_updated_at = now()
    where id = v_order.queue_id;
  end if;

  return true;
end;
$$;

grant execute on function public.complete_order_with_stock(uuid, text, uuid) to authenticated;
