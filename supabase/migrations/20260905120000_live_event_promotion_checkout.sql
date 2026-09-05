-- Live Event promotion checkout sells purchased and reward stock atomically.

alter function public.complete_order_with_stock(uuid, text, uuid)
  rename to complete_order_with_stock_base;
alter function public.complete_order_with_stock_base(uuid, text, uuid)
  set schema private;

alter function public.create_walkin_order_with_stock(uuid, jsonb, text, uuid)
  rename to create_walkin_order_with_stock_base;
alter function public.create_walkin_order_with_stock_base(uuid, jsonb, text, uuid)
  set schema private;

revoke all on function private.complete_order_with_stock_base(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function private.create_walkin_order_with_stock_base(uuid, jsonb, text, uuid)
  from public, anon, authenticated;

create function public.complete_order_with_stock(
  p_order_id uuid,
  p_payment_method text,
  p_payment_idempotency_key uuid default null,
  p_reward_choices jsonb default '[]'::jsonb,
  p_promotion_choices jsonb default '[]'::jsonb,
  p_expected_pricing_hash text default null,
  p_accept_exhausted_rewards boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_items jsonb;
  v_quote jsonb;
  v_reward jsonb;
  v_reward_product record;
  v_stock record;
  v_quantity integer;
  v_available integer;
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

  if not public.has_artist_role(v_order.artist_id, array['owner', 'queue_pos']) then
    raise exception 'forbidden';
  end if;

  if v_order.status = 'completed' then
    return private.complete_order_with_stock_base(
      p_order_id, p_payment_method, p_payment_idempotency_key
    );
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'order_cancelled';
  end if;

  if p_payment_idempotency_key is not null
     and v_order.payment_idempotency_key is not null
     and v_order.payment_idempotency_key <> p_payment_idempotency_key then
    raise exception 'payment_idempotency_key_conflict';
  end if;

  if not exists (
    select 1
    from public.promotion_assignments pa
    join public.artist_promotions ap on ap.id = pa.promotion_id
    where pa.event_id = v_order.event_id
      and pa.event_phase = 'live'
      and ap.lifecycle_status = 'ready'
      and not pa.is_paused
      and (pa.starts_at is null or pa.starts_at <= now())
      and (pa.ends_at is null or pa.ends_at > now())
  ) then
    return private.complete_order_with_stock_base(
      p_order_id, p_payment_method, p_payment_idempotency_key
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', purchase.product_id,
    'quantity', purchase.quantity
  )), '[]'::jsonb)
  into v_items
  from (
    select oi.product_id, sum(oi.quantity)::integer as quantity
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.line_type = 'purchase'
    group by oi.product_id
  ) purchase;

  if jsonb_array_length(v_items) = 0 then
    raise exception 'empty_items';
  end if;

  -- Queue orders already reserve their purchased stock. Release only this
  -- order's reservation while holding the rows, then validate and sell once.
  for v_stock in
    select distinct oi.event_product_id, oi.product_id
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.line_type = 'purchase'
  loop
    select sum(oi.quantity)::integer into v_quantity
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.line_type = 'purchase'
      and oi.product_id = v_stock.product_id
      and oi.event_product_id is not distinct from v_stock.event_product_id;

    if v_stock.event_product_id is not null then
      perform 1 from public.event_products
      where id = v_stock.event_product_id
      for update;

      update public.event_products
      set stock_reserved = greatest(stock_reserved - v_quantity, 0)
      where id = v_stock.event_product_id
        and not is_unlimited;
    else
      perform 1 from public.products
      where id = v_stock.product_id
      for update;

      update public.products
      set stock_reserved = greatest(stock_reserved - v_quantity, 0),
          updated_at = now()
      where id = v_stock.product_id
        and not is_unlimited;
    end if;
  end loop;

  v_quote := public.calculate_sale_promotions(
    v_order.event_id, 'live', null, v_items,
    coalesce(p_reward_choices, '[]'::jsonb),
    coalesce(p_promotion_choices, '[]'::jsonb)
  );

  if exists (
    select 1 from jsonb_array_elements(v_quote -> 'required_choices') choice(value)
    where not coalesce((choice.value ->> 'exhausted')::boolean, false)
  ) then
    raise exception 'promotion_choice_required';
  end if;

  if not p_accept_exhausted_rewards and exists (
    select 1 from jsonb_array_elements(v_quote -> 'required_choices') choice(value)
    where coalesce((choice.value ->> 'exhausted')::boolean, false)
  ) then
    raise exception 'promotion_rewards_exhausted';
  end if;

  if p_expected_pricing_hash is not null
     and p_expected_pricing_hash <> v_quote ->> 'pricing_hash' then
    raise exception 'promotion_changed';
  end if;

  delete from public.order_items
  where order_items.order_id = p_order_id
    and line_type = 'promotion_reward';

  for v_reward in
    select value from jsonb_array_elements(v_quote -> 'reward_lines') reward(value)
  loop
    select ep.id as event_product_id, p.id as product_id, p.name, p.sku
    into v_reward_product
    from public.event_products ep
    join public.products p on p.id = ep.product_id
    where ep.event_id = v_order.event_id
      and ep.product_id = (v_reward ->> 'product_id')::uuid
      and ep.is_enabled
      and p.deleted_at is null
    for update of ep;

    if v_reward_product.product_id is null then
      raise exception 'promotion_reward_unavailable';
    end if;

    insert into public.order_items (
      order_id, product_id, event_product_id, quantity, price_per_unit,
      notes, currency, product_name_snapshot, sku_snapshot,
      line_type, promotion_id, promotion_assignment_id, promotion_tier_id
    ) values (
      p_order_id, v_reward_product.product_id, v_reward_product.event_product_id,
      (v_reward ->> 'quantity')::integer, 0, '', v_order.currency,
      v_reward_product.name, v_reward_product.sku, 'promotion_reward',
      (v_reward ->> 'promotion_id')::uuid,
      coalesce(
        nullif(v_reward ->> 'assignment_id', '')::uuid,
        (
          select (applied.value ->> 'assignment_id')::uuid
          from jsonb_array_elements(v_quote -> 'applied_promotions') applied(value)
          where applied.value ->> 'id' = v_reward ->> 'promotion_id'
          limit 1
        )
      ),
      nullif(v_reward ->> 'tier_id', '')::uuid
    );
  end loop;

  for v_stock in
    select distinct oi.event_product_id, oi.product_id
    from public.order_items oi
    where oi.order_id = p_order_id
  loop
    select sum(oi.quantity)::integer into v_quantity
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.product_id = v_stock.product_id
      and oi.event_product_id is not distinct from v_stock.event_product_id;

    if v_stock.event_product_id is not null then
      select ep.is_unlimited,
             coalesce(ep.stock_total, 0) - ep.stock_reserved - ep.stock_sold as available
      into v_reward_product
      from public.event_products ep
      where ep.id = v_stock.event_product_id
      for update;

      if not v_reward_product.is_unlimited then
        v_available := v_reward_product.available;
        if v_available < v_quantity then
          raise exception 'insufficient_stock_on_complete';
        end if;
        update public.event_products
        set stock_sold = stock_sold + v_quantity
        where id = v_stock.event_product_id;
      end if;
    else
      select p.is_unlimited,
             coalesce(p.stock_total, 0) - p.stock_reserved - p.stock_sold as available
      into v_reward_product
      from public.products p
      where p.id = v_stock.product_id
      for update;

      if not v_reward_product.is_unlimited then
        v_available := v_reward_product.available;
        if v_available < v_quantity then
          raise exception 'insufficient_stock_on_complete';
        end if;
        update public.products
        set stock_sold = stock_sold + v_quantity,
            updated_at = now()
        where id = v_stock.product_id;
      end if;
    end if;
  end loop;

  update public.orders
  set status = 'completed',
      payment_method = p_payment_method,
      payment_idempotency_key = coalesce(payment_idempotency_key, p_payment_idempotency_key),
      subtotal_price = (v_quote ->> 'subtotal')::numeric,
      discount_total = (v_quote ->> 'discount_total')::numeric,
      total_price = (v_quote ->> 'merchandise_total')::numeric,
      pricing_breakdown = v_quote -> 'applied_promotions'
  where id = p_order_id;

  if v_order.queue_id is not null then
    update public.queues
    set status = 'complete', completed_at = now(), last_updated_at = now()
    where id = v_order.queue_id;
  end if;

  return true;
end;
$$;

create function public.create_walkin_order_with_stock(
  p_event_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_payment_idempotency_key uuid default null,
  p_reward_choices jsonb default '[]'::jsonb,
  p_promotion_choices jsonb default '[]'::jsonb,
  p_expected_pricing_hash text default null,
  p_accept_exhausted_rewards boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_quote jsonb;
  v_reward jsonb;
  v_product record;
  v_available integer;
begin
  if p_payment_idempotency_key is not null and exists (
    select 1 from public.orders where payment_idempotency_key = p_payment_idempotency_key
  ) then
    return private.create_walkin_order_with_stock_base(
      p_event_id, p_items, p_payment_method, p_payment_idempotency_key
    );
  end if;

  if not exists (
    select 1
    from public.promotion_assignments pa
    join public.artist_promotions ap on ap.id = pa.promotion_id
    where pa.event_id = p_event_id
      and pa.event_phase = 'live'
      and ap.lifecycle_status = 'ready'
      and not pa.is_paused
      and (pa.starts_at is null or pa.starts_at <= now())
      and (pa.ends_at is null or pa.ends_at > now())
  ) then
    return private.create_walkin_order_with_stock_base(
      p_event_id, p_items, p_payment_method, p_payment_idempotency_key
    );
  end if;

  v_quote := public.calculate_sale_promotions(
    p_event_id, 'live', null, p_items,
    coalesce(p_reward_choices, '[]'::jsonb),
    coalesce(p_promotion_choices, '[]'::jsonb)
  );

  if exists (
    select 1 from jsonb_array_elements(v_quote -> 'required_choices') choice(value)
    where not coalesce((choice.value ->> 'exhausted')::boolean, false)
  ) then
    raise exception 'promotion_choice_required';
  end if;

  if not p_accept_exhausted_rewards and exists (
    select 1 from jsonb_array_elements(v_quote -> 'required_choices') choice(value)
    where coalesce((choice.value ->> 'exhausted')::boolean, false)
  ) then
    raise exception 'promotion_rewards_exhausted';
  end if;

  if p_expected_pricing_hash is not null
     and p_expected_pricing_hash <> v_quote ->> 'pricing_hash' then
    raise exception 'promotion_changed';
  end if;

  v_order_id := private.create_walkin_order_with_stock_base(
    p_event_id, p_items, p_payment_method, p_payment_idempotency_key
  );

  for v_reward in
    select value from jsonb_array_elements(v_quote -> 'reward_lines') reward(value)
  loop
    select
      ep.id as event_product_id,
      ep.is_unlimited,
      ep.stock_total,
      ep.stock_reserved,
      ep.stock_sold,
      p.id as product_id,
      p.name,
      p.sku
    into v_product
    from public.event_products ep
    join public.products p on p.id = ep.product_id
    where ep.event_id = p_event_id
      and ep.product_id = (v_reward ->> 'product_id')::uuid
      and ep.is_enabled
      and p.deleted_at is null
    for update of ep;

    if v_product.product_id is null then
      raise exception 'promotion_reward_unavailable';
    end if;

    if not v_product.is_unlimited then
      v_available := v_product.stock_total - v_product.stock_reserved - v_product.stock_sold;
      if v_available < (v_reward ->> 'quantity')::integer then
        raise exception 'promotion_reward_unavailable';
      end if;

      update public.event_products
      set stock_sold = stock_sold + (v_reward ->> 'quantity')::integer
      where id = v_product.event_product_id;
    end if;

    insert into public.order_items (
      order_id, product_id, event_product_id, quantity, price_per_unit,
      notes, currency, product_name_snapshot, sku_snapshot,
      line_type, promotion_id, promotion_assignment_id, promotion_tier_id
    ) values (
      v_order_id, v_product.product_id, v_product.event_product_id,
      (v_reward ->> 'quantity')::integer, 0, '',
      (select currency from public.orders where id = v_order_id),
      v_product.name, v_product.sku, 'promotion_reward',
      (v_reward ->> 'promotion_id')::uuid,
      coalesce(
        nullif(v_reward ->> 'assignment_id', '')::uuid,
        (
          select (applied.value ->> 'assignment_id')::uuid
          from jsonb_array_elements(v_quote -> 'applied_promotions') applied(value)
          where applied.value ->> 'id' = v_reward ->> 'promotion_id'
          limit 1
        )
      ),
      nullif(v_reward ->> 'tier_id', '')::uuid
    );
  end loop;

  update public.orders
  set subtotal_price = (v_quote ->> 'subtotal')::numeric,
      discount_total = (v_quote ->> 'discount_total')::numeric,
      total_price = (v_quote ->> 'merchandise_total')::numeric,
      pricing_breakdown = v_quote -> 'applied_promotions'
  where id = v_order_id;

  return v_order_id;
end;
$$;

create or replace function public.apply_order_pricing(
  p_order_id uuid,
  p_subtotal_price numeric,
  p_discount_total numeric,
  p_total_price numeric,
  p_pricing_breakdown jsonb default '[]'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
begin
  if coalesce(p_total_price, 0) < 0
     or coalesce(p_subtotal_price, 0) < 0
     or coalesce(p_discount_total, 0) < 0 then
    raise exception 'invalid_pricing';
  end if;

  select o.id, o.status, e.artist_id
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
  for update of o;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  if not public.has_artist_role(v_order.artist_id, array['owner', 'queue_pos']) then
    raise exception 'forbidden';
  end if;

  if v_order.status not in ('draft', 'confirmed') then
    raise exception 'order_not_editable';
  end if;

  update public.orders
  set subtotal_price = coalesce(p_subtotal_price, 0),
      discount_total = coalesce(p_discount_total, 0),
      total_price = coalesce(p_total_price, 0),
      pricing_breakdown = coalesce(p_pricing_breakdown, '[]'::jsonb)
  where id = p_order_id;

  return true;
end;
$$;

revoke all on function public.complete_order_with_stock(uuid, text, uuid, jsonb, jsonb, text, boolean)
  from public;
grant execute on function public.complete_order_with_stock(uuid, text, uuid, jsonb, jsonb, text, boolean)
  to authenticated;

revoke all on function public.create_walkin_order_with_stock(uuid, jsonb, text, uuid, jsonb, jsonb, text, boolean)
  from public;
grant execute on function public.create_walkin_order_with_stock(uuid, jsonb, text, uuid, jsonb, jsonb, text, boolean)
  to authenticated;
