-- Keep queue order stock reservations in sync when POS edits existing order items

create or replace function public.sync_customer_order_items_with_stock(
  p_order_id uuid,
  p_items jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_existing_item record;
  v_item jsonb;
  v_product record;
  v_qty integer;
  v_total numeric := 0;
  v_currency text;
  v_available integer;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items_payload';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'empty_items';
  end if;

  select o.*, e.artist_id
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  if v_order.queue_id is null then
    raise exception 'order_not_queue_order';
  end if;

  if v_order.status not in ('draft', 'confirmed') then
    raise exception 'order_not_editable';
  end if;

  if not public.has_artist_role(v_order.artist_id, array['owner', 'queue_pos']) then
    raise exception 'forbidden';
  end if;

  -- Release all previous reservations for this order before rebuilding line items.
  for v_existing_item in
    select oi.product_id, oi.quantity, p.is_unlimited
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = v_order.id
    for update of p
  loop
    if not coalesce(v_existing_item.is_unlimited, false) then
      update public.products
      set stock_reserved = greatest(stock_reserved - v_existing_item.quantity, 0),
          updated_at = now()
      where id = v_existing_item.product_id;
    end if;
  end loop;

  delete from public.order_items
  where order_id = v_order.id;

  for v_item in
    select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::integer, 1));

    select p.*
    into v_product
    from public.products p
    where p.id = (v_item ->> 'product_id')::uuid
      and p.artist_id = v_order.artist_id
      and p.deleted_at is null
      and p.status = 'enable'
    for update;

    if v_product.id is null then
      raise exception 'invalid_product';
    end if;

    if v_currency is null then
      v_currency := v_product.currency;
    elsif v_currency <> v_product.currency then
      raise exception 'mixed_currency_not_allowed';
    end if;

    if not coalesce(v_product.is_unlimited, false) then
      v_available := coalesce(v_product.stock_total, 0)
        - coalesce(v_product.stock_reserved, 0)
        - coalesce(v_product.stock_sold, 0);

      if v_available < v_qty then
        raise exception 'insufficient_stock';
      end if;

      update public.products
      set stock_reserved = stock_reserved + v_qty,
          updated_at = now()
      where id = v_product.id;
    end if;

    insert into public.order_items (order_id, product_id, quantity, price_per_unit, notes, currency)
    values (
      v_order.id,
      v_product.id,
      v_qty,
      v_product.price,
      coalesce(v_item ->> 'notes', ''),
      v_product.currency
    );

    v_total := v_total + (v_product.price * v_qty);
  end loop;

  update public.orders
  set total_price = v_total,
      currency = coalesce(v_currency, currency, 'THB'),
      status = 'confirmed'
  where id = v_order.id;

  return true;
end;
$$;

grant execute on function public.sync_customer_order_items_with_stock(uuid, jsonb) to authenticated;
