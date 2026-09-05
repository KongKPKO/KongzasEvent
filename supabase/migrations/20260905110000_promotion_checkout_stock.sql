-- Apply authoritative promotions inside the existing held-checkout transactions.

alter function public.create_online_campaign_order(uuid, jsonb, text, uuid, text, text, text, text, text, uuid)
  rename to create_online_campaign_order_base;
alter function public.create_online_campaign_order_base(uuid, jsonb, text, uuid, text, text, text, text, text, uuid)
  set schema private;

revoke all on function private.create_online_campaign_order_base(uuid, jsonb, text, uuid, text, text, text, text, text, uuid)
  from public, anon, authenticated;

create function public.create_online_campaign_order(
  p_campaign_id uuid,
  p_items jsonb,
  p_fulfillment_method text,
  p_pickup_point_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text default '',
  p_shipping_address text default '',
  p_customer_note text default '',
  p_client_request_id uuid default null,
  p_reward_choices jsonb default '[]'::jsonb,
  p_promotion_choices jsonb default '[]'::jsonb,
  p_expected_pricing_hash text default null,
  p_accept_exhausted_rewards boolean default false
)
returns table (
  order_id uuid,
  order_code text,
  subtotal_price numeric,
  shipping_fee numeric,
  total_price numeric,
  currency text,
  payment_status text,
  payment_methods jsonb,
  stock_hold_expires_at timestamptz,
  pickup_point_snapshot jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result record;
  v_quote jsonb;
  v_reward jsonb;
  v_product record;
  v_total numeric;
begin
  -- Let the original function return an idempotent replay before recalculating
  -- against stock that the existing order already holds.
  if p_client_request_id is not null and exists (
    select 1 from public.orders where payment_idempotency_key = p_client_request_id
  ) then
    return query
    select * from private.create_online_campaign_order_base(
      p_campaign_id, p_items, p_fulfillment_method, p_pickup_point_id,
      p_customer_name, p_customer_email, p_customer_phone,
      p_shipping_address, p_customer_note, p_client_request_id
    );
    return;
  end if;

  if not exists (
    select 1
    from public.promotion_assignments pa
    join public.artist_promotions ap on ap.id = pa.promotion_id
    where pa.campaign_id = p_campaign_id
      and ap.lifecycle_status = 'ready'
      and not pa.is_paused
      and (pa.starts_at is null or pa.starts_at <= now())
      and (pa.ends_at is null or pa.ends_at > now())
  ) then
    return query
    select * from private.create_online_campaign_order_base(
      p_campaign_id, p_items, p_fulfillment_method, p_pickup_point_id,
      p_customer_name, p_customer_email, p_customer_phone,
      p_shipping_address, p_customer_note, p_client_request_id
    );
    return;
  end if;

  v_quote := public.calculate_sale_promotions(
    null, null, p_campaign_id, p_items,
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

  select * into v_result
  from private.create_online_campaign_order_base(
    p_campaign_id, p_items, p_fulfillment_method, p_pickup_point_id,
    p_customer_name, p_customer_email, p_customer_phone,
    p_shipping_address, p_customer_note, p_client_request_id
  );

  for v_reward in
    select value from jsonb_array_elements(v_quote -> 'reward_lines') reward(value)
  loop
    select
      cp.id as campaign_product_id,
      cp.is_unlimited,
      cp.stock_total,
      cp.stock_reserved,
      cp.stock_sold,
      p.id as product_id,
      p.name,
      p.sku
    into v_product
    from public.online_campaign_products cp
    join public.products p on p.id = cp.product_id
    where cp.campaign_id = p_campaign_id
      and cp.product_id = (v_reward ->> 'product_id')::uuid
      and cp.is_enabled
      and p.deleted_at is null
    for update of cp;

    if v_product.product_id is null
       or (
         not v_product.is_unlimited
         and v_product.stock_total - v_product.stock_reserved - v_product.stock_sold
           < (v_reward ->> 'quantity')::integer
       ) then
      raise exception 'promotion_reward_unavailable';
    end if;

    if not v_product.is_unlimited then
      update public.online_campaign_products
      set stock_reserved = stock_reserved + (v_reward ->> 'quantity')::integer
      where id = v_product.campaign_product_id;
    end if;

    insert into public.order_items (
      order_id, product_id, event_product_id, campaign_product_id,
      quantity, price_per_unit, currency, product_name_snapshot, sku_snapshot,
      line_type, promotion_id, promotion_assignment_id, promotion_tier_id
    ) values (
      v_result.order_id, v_product.product_id, null, v_product.campaign_product_id,
      (v_reward ->> 'quantity')::integer, 0, v_result.currency,
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

  v_total := (v_quote ->> 'merchandise_total')::numeric + v_result.shipping_fee;

  update public.orders
  set subtotal_price = (v_quote ->> 'subtotal')::numeric,
      discount_total = (v_quote ->> 'discount_total')::numeric,
      shipping_fee = v_result.shipping_fee,
      total_price = v_total,
      pricing_breakdown = v_quote -> 'applied_promotions'
  where id = v_result.order_id;

  update public.order_payments
  set amount_expected = v_total,
      updated_at = now()
  where order_payments.order_id = v_result.order_id;

  return query select
    v_result.order_id,
    v_result.order_code,
    (v_quote ->> 'subtotal')::numeric,
    v_result.shipping_fee,
    v_total,
    v_result.currency,
    v_result.payment_status,
    v_result.payment_methods,
    v_result.stock_hold_expires_at,
    v_result.pickup_point_snapshot;
end;
$$;

drop function public.create_preorder_with_stock(uuid, jsonb, text, text, text, uuid, text, text, text, text);

create function public.create_preorder_with_stock(
  p_event_id uuid,
  p_items jsonb,
  p_customer_name text,
  p_customer_contact text default '',
  p_customer_note text default '',
  p_client_request_id uuid default null,
  p_customer_phone text default '',
  p_customer_social text default '',
  p_customer_email text default '',
  p_shipping_address text default '',
  p_reward_choices jsonb default '[]'::jsonb,
  p_promotion_choices jsonb default '[]'::jsonb,
  p_expected_pricing_hash text default null,
  p_accept_exhausted_rewards boolean default false
)
returns table (
  order_id uuid,
  pickup_code text,
  total_price numeric,
  currency text,
  pickup_instructions text,
  payment_status text,
  payment_methods jsonb,
  payment_deadline_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result record;
  v_order_type text;
  v_event_phase text;
  v_artist_id uuid;
  v_payment_id uuid;
  v_payment_status text;
  v_hold_expires_at timestamptz;
  v_reserved integer := 0;
  v_quote jsonb;
  v_reward jsonb;
  v_product record;
begin
  select * into v_result
  from private.create_preorder_with_stock_base(
    p_event_id, p_items, p_customer_name, p_customer_contact,
    p_customer_note, p_client_request_id, p_customer_phone,
    p_customer_social, p_customer_email, p_shipping_address
  );

  select o.order_type, e.artist_id, op.id, op.payment_status, op.stock_hold_expires_at
  into v_order_type, v_artist_id, v_payment_id, v_payment_status, v_hold_expires_at
  from public.orders o
  join public.events e on e.id = o.event_id
  join public.order_payments op on op.order_id = o.id
  where o.id = v_result.order_id
  for update of op;

  if v_payment_status = 'awaiting_payment' and v_hold_expires_at is null then
    v_event_phase := case v_order_type
      when 'preorder' then 'preorder'
      when 'post_event' then 'postorder'
    end;

    if exists (
      select 1
      from public.promotion_assignments pa
      join public.artist_promotions ap on ap.id = pa.promotion_id
      where pa.event_id = p_event_id
        and pa.event_phase = v_event_phase
        and ap.lifecycle_status = 'ready'
        and not pa.is_paused
        and (pa.starts_at is null or pa.starts_at <= now())
        and (pa.ends_at is null or pa.ends_at > now())
    ) then
      v_quote := public.calculate_sale_promotions(
        p_event_id, v_event_phase, null, p_items,
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

      for v_reward in
        select value from jsonb_array_elements(v_quote -> 'reward_lines') reward(value)
      loop
        select
          ep.id as event_product_id,
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

        insert into public.order_items (
          order_id, product_id, event_product_id, quantity, price_per_unit,
          notes, currency, product_name_snapshot, sku_snapshot,
          line_type, promotion_id, promotion_assignment_id, promotion_tier_id
        ) values (
          v_result.order_id, v_product.product_id, v_product.event_product_id,
          (v_reward ->> 'quantity')::integer, 0, '', v_result.currency,
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
      where id = v_result.order_id;

      update public.order_payments
      set amount_expected = (v_quote ->> 'merchandise_total')::numeric,
          updated_at = now()
      where id = v_payment_id;

      v_result.total_price := (v_quote ->> 'merchandise_total')::numeric;
    end if;

    v_reserved := public.reserve_preorder_order_stock(v_result.order_id);
    v_hold_expires_at := now() + interval '15 minutes';

    update public.order_payments
    set stock_hold_expires_at = v_hold_expires_at,
        updated_at = now()
    where id = v_payment_id;

    perform public.append_payment_review_event(
      v_result.order_id, v_payment_id, p_event_id, v_artist_id,
      'stock_reserved', 'awaiting_payment', 'awaiting_payment', null, null,
      jsonb_build_object('quantity', v_reserved, 'expires_at', v_hold_expires_at)
    );
  end if;

  return query select
    v_result.order_id,
    v_result.pickup_code,
    v_result.total_price,
    v_result.currency,
    v_result.pickup_instructions,
    v_result.payment_status,
    v_result.payment_methods,
    least(v_result.payment_deadline_at, v_hold_expires_at);
end;
$$;

-- Post-order uses the same 15-minute checkout hold as Pre-order.
create or replace function private.expire_preorder_stock_hold(p_order_id uuid)
returns table (expired boolean, released_stock_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_released integer := 0;
begin
  select
    o.id, o.event_id, e.artist_id, op.id as payment_id,
    op.payment_status, op.stock_hold_expires_at, op.slip_url
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  join public.order_payments op on op.order_id = o.id
  where o.id = p_order_id
    and o.order_type in ('preorder', 'post_event')
  for update of o, op;

  if v_order.id is null
     or v_order.payment_status <> 'awaiting_payment'
     or v_order.stock_hold_expires_at is null
     or v_order.stock_hold_expires_at > now() then
    return query select false, 0;
    return;
  end if;

  v_released := public.release_preorder_order_stock(v_order.id);

  update public.order_payments
  set payment_status = 'payment_expired', expired_at = now(),
      review_note = 'stock_hold_expired', updated_at = now()
  where id = v_order.payment_id;

  update public.orders
  set status = 'cancelled', pickup_status = 'expired', cancelled_at = now(),
      cancelled_by = null, cancel_reason = 'stock_hold_expired'
  where id = v_order.id;

  perform public.append_payment_review_event(
    v_order.id, v_order.payment_id, v_order.event_id, v_order.artist_id,
    'payment_expired', 'awaiting_payment', 'payment_expired',
    v_order.slip_url, 'stock_hold_expired'
  );
  perform public.append_payment_review_event(
    v_order.id, v_order.payment_id, v_order.event_id, v_order.artist_id,
    'stock_released', 'awaiting_payment', 'payment_expired',
    v_order.slip_url, 'stock_hold_expired', jsonb_build_object('quantity', v_released)
  );

  return query select true, v_released;
end;
$$;

create or replace function private.expire_preorder_stock_holds()
returns table (expired_count integer, released_stock_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_result record;
  v_expired_count integer := 0;
  v_released_count integer := 0;
begin
  for v_order_id in
    select o.id
    from public.orders o
    join public.order_payments op on op.order_id = o.id
    where o.order_type in ('preorder', 'post_event')
      and op.payment_status = 'awaiting_payment'
      and op.stock_hold_expires_at is not null
      and op.stock_hold_expires_at <= now()
    for update of o, op skip locked
  loop
    select * into v_result from private.expire_preorder_stock_hold(v_order_id);
    if coalesce(v_result.expired, false) then
      v_expired_count := v_expired_count + 1;
      v_released_count := v_released_count + coalesce(v_result.released_stock_count, 0);
    end if;
  end loop;

  return query select v_expired_count, v_released_count;
end;
$$;

create or replace function public.get_public_preorder_by_code(
  p_artist_slug text,
  p_pickup_code text
)
returns table (
  order_id uuid,
  event_id uuid,
  event_name text,
  artist_name text,
  order_type text,
  shipping_address text,
  tracking_number text,
  shipping_carrier text,
  shipped_at timestamptz,
  artist_facebook_url text,
  status text,
  pickup_status text,
  pickup_code text,
  customer_name text,
  customer_email_masked text,
  total_price numeric,
  currency text,
  pickup_instructions text,
  payment_status text,
  slip_url text,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  rejected_at timestamptz,
  review_note text,
  payment_methods jsonb,
  payment_deadline_at timestamptz,
  created_at timestamptz,
  picked_up_at timestamptz,
  items jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
begin
  select o.id into v_order_id
  from public.orders o
  join public.events e on e.id = o.event_id
  join public.artists a on a.id = e.artist_id
  where a.slug = lower(trim(p_artist_slug))
    and o.pickup_code = upper(trim(p_pickup_code))
    and o.order_type in ('preorder', 'post_event')
  order by o.created_at desc
  limit 1;

  if v_order_id is not null then
    perform private.expire_preorder_stock_hold(v_order_id);
  end if;

  return query
  select
    result.order_id,
    result.event_id,
    result.event_name,
    result.artist_name,
    result.order_type,
    result.shipping_address,
    result.tracking_number,
    result.shipping_carrier,
    result.shipped_at,
    result.artist_facebook_url,
    result.status,
    result.pickup_status,
    result.pickup_code,
    result.customer_name,
    result.customer_email_masked,
    result.total_price,
    result.currency,
    result.pickup_instructions,
    result.payment_status,
    result.slip_url,
    result.submitted_at,
    result.confirmed_at,
    result.rejected_at,
    result.review_note,
    result.payment_methods,
    case
      when result.order_type in ('preorder', 'post_event')
        and result.payment_status = 'awaiting_payment'
        then op.stock_hold_expires_at
      else result.payment_deadline_at
    end,
    result.created_at,
    result.picked_up_at,
    result.items
  from private.get_public_preorder_by_code_base(p_artist_slug, p_pickup_code) result
  left join public.order_payments op on op.order_id = result.order_id;
end;
$$;

create or replace function private.enforce_campaign_product_order_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  if new.campaign_product_id is null or new.line_type <> 'purchase' then
    return new;
  end if;

  select cp.max_quantity_per_order into v_limit
  from public.online_campaign_products cp
  where cp.id = new.campaign_product_id;

  if v_limit is not null and new.quantity > v_limit then
    raise exception 'campaign_product_order_limit_exceeded';
  end if;

  return new;
end;
$$;

revoke all on function public.create_online_campaign_order(uuid, jsonb, text, uuid, text, text, text, text, text, uuid, jsonb, jsonb, text, boolean)
  from public;
grant execute on function public.create_online_campaign_order(uuid, jsonb, text, uuid, text, text, text, text, text, uuid, jsonb, jsonb, text, boolean)
  to anon, authenticated;

revoke all on function public.create_preorder_with_stock(uuid, jsonb, text, text, text, uuid, text, text, text, text, jsonb, jsonb, text, boolean)
  from public;
grant execute on function public.create_preorder_with_stock(uuid, jsonb, text, text, text, uuid, text, text, text, text, jsonb, jsonb, text, boolean)
  to anon, authenticated;
