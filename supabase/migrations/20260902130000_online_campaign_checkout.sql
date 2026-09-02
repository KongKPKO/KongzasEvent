-- Transactional checkout and payment lifecycle for online campaigns.

alter table public.order_items
  add column if not exists product_name_snapshot text,
  add column if not exists sku_snapshot text;

alter table public.order_payments
  add column if not exists evidence_idempotency_key uuid;

create unique index if not exists order_payments_campaign_evidence_idempotency
  on public.order_payments (order_id, evidence_idempotency_key)
  where evidence_idempotency_key is not null;

create or replace function public.generate_online_order_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'OC-' || upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 13));
$$;

create or replace function private.append_campaign_payment_review_event(
  p_order_id uuid,
  p_order_payment_id uuid,
  p_campaign_id uuid,
  p_artist_id uuid,
  p_event_type text,
  p_from_status text default null,
  p_to_status text default null,
  p_slip_url text default null,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_role text;
begin
  if auth.uid() is not null then
    select am.role
    into v_role
    from public.artist_members am
    where am.artist_id = p_artist_id
      and lower(am.member_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and am.status = 'active'
    limit 1;
  end if;

  insert into public.payment_review_events (
    order_id, order_payment_id, event_id, campaign_id, artist_id,
    event_type, from_status, to_status, slip_url,
    actor_user_id, actor_role, note, metadata
  )
  values (
    p_order_id, p_order_payment_id, null, p_campaign_id, p_artist_id,
    p_event_type, p_from_status, p_to_status, p_slip_url,
    auth.uid(), v_role, p_note, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.generate_online_order_code() from public, anon, authenticated;
revoke all on function private.append_campaign_payment_review_event(uuid, uuid, uuid, uuid, text, text, text, text, text, jsonb)
  from public, anon, authenticated;

create or replace function public.get_public_online_campaign(
  p_artist_slug text,
  p_campaign_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign record;
  v_state text;
  v_has_sellable boolean;
  v_products jsonb;
  v_pickup_points jsonb;
  v_payment_methods jsonb;
begin
  select
    c.*,
    a.slug as artist_slug,
    a.display_name as artist_name,
    a.image_url as artist_image_url
  into v_campaign
  from public.online_campaigns c
  join public.artists a on a.id = c.artist_id
  where lower(a.slug) = lower(trim(p_artist_slug))
    and lower(c.slug) = lower(trim(p_campaign_slug))
    and a.is_public = true
    and a.is_verified = true
    and c.publication_status in ('published', 'cancelled');

  if v_campaign.id is null then
    return null;
  end if;

  select exists (
    select 1
    from public.online_campaign_products cp
    join public.products p on p.id = cp.product_id
    where cp.campaign_id = v_campaign.id
      and cp.is_enabled = true
      and p.deleted_at is null
      and p.status = 'enable'
      and (
        cp.is_unlimited
        or cp.stock_total - cp.stock_reserved - cp.stock_sold > 0
      )
  ) into v_has_sellable;

  v_state := case
    when v_campaign.publication_status = 'cancelled' then 'cancelled'
    when now() < v_campaign.opens_at then 'scheduled'
    when now() >= v_campaign.closes_at then 'closed'
    when not v_has_sellable then 'sold_out'
    else 'open'
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'campaign_product_id', cp.id,
    'product_id', p.id,
    'name', p.name,
    'description', p.description,
    'category', p.category,
    'tags', p.tags,
    'image_url', p.image_url,
    'sku', p.sku,
    'variant_group_name', p.variant_group_name,
    'variant_name', p.variant_name,
    'price', coalesce(cp.price_override, p.price),
    'currency', v_campaign.currency,
    'is_unlimited', cp.is_unlimited,
    'available_quantity', case
      when cp.is_unlimited then null
      else greatest(cp.stock_total - cp.stock_reserved - cp.stock_sold, 0)
    end
  ) order by p.variant_group_name nulls first, p.variant_sort_order, p.name), '[]'::jsonb)
  into v_products
  from public.online_campaign_products cp
  join public.products p on p.id = cp.product_id
  where cp.campaign_id = v_campaign.id
    and cp.is_enabled = true
    and p.deleted_at is null
    and p.status = 'enable';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pp.id,
    'name', pp.name,
    'address', pp.address,
    'starts_at', pp.starts_at,
    'ends_at', pp.ends_at,
    'instructions', pp.instructions
  ) order by pp.starts_at), '[]'::jsonb)
  into v_pickup_points
  from public.campaign_pickup_points pp
  where pp.campaign_id = v_campaign.id
    and pp.is_enabled = true;

  if v_state = 'open' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', pm.id,
      'method_type', pm.method_type,
      'display_name', pm.display_name,
      'account_name', pm.account_name,
      'account_number', pm.account_number,
      'bank_name', pm.bank_name,
      'promptpay_id', pm.promptpay_id,
      'qr_image_url', pm.qr_image_url,
      'instructions', pm.instructions
    ) order by pm.created_at), '[]'::jsonb)
    into v_payment_methods
    from public.campaign_payment_methods pm
    where pm.campaign_id = v_campaign.id
      and pm.is_enabled = true;
  else
    v_payment_methods := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'id', v_campaign.id,
    'artist_id', v_campaign.artist_id,
    'artist_slug', v_campaign.artist_slug,
    'artist_name', v_campaign.artist_name,
    'artist_image_url', v_campaign.artist_image_url,
    'name', v_campaign.name,
    'slug', v_campaign.slug,
    'description', v_campaign.description,
    'opens_at', v_campaign.opens_at,
    'closes_at', v_campaign.closes_at,
    'campaign_timezone', v_campaign.campaign_timezone,
    'currency', v_campaign.currency,
    'shipping_enabled', v_campaign.shipping_enabled,
    'flat_shipping_fee', v_campaign.flat_shipping_fee,
    'pickup_enabled', v_campaign.pickup_enabled,
    'state', v_state,
    'products', v_products,
    'pickup_points', v_pickup_points,
    'payment_methods', v_payment_methods
  );
end;
$$;

create or replace function public.create_online_campaign_order(
  p_campaign_id uuid,
  p_items jsonb,
  p_fulfillment_method text,
  p_pickup_point_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text default '',
  p_shipping_address text default '',
  p_customer_note text default '',
  p_client_request_id uuid default null
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
  v_campaign record;
  v_existing public.orders%rowtype;
  v_existing_payment public.order_payments%rowtype;
  v_item jsonb;
  v_product record;
  v_pickup record;
  v_order_id uuid;
  v_payment_id uuid;
  v_order_code text;
  v_qty integer;
  v_subtotal numeric := 0;
  v_shipping_fee numeric := 0;
  v_total numeric := 0;
  v_hold_expires_at timestamptz := now() + interval '15 minutes';
  v_pickup_snapshot jsonb;
  v_payment_methods jsonb;
  v_attempt integer := 0;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_items';
  end if;

  if length(trim(coalesce(p_customer_name, ''))) = 0 then
    raise exception 'customer_name_required';
  end if;

  if length(trim(coalesce(p_customer_email, ''))) = 0 then
    raise exception 'customer_email_required';
  end if;

  if lower(trim(p_customer_email)) !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'customer_email_invalid';
  end if;

  select c.*, a.is_public, a.is_verified
  into v_campaign
  from public.online_campaigns c
  join public.artists a on a.id = c.artist_id
  where c.id = p_campaign_id
  for update of c;

  if v_campaign.id is null then
    raise exception 'campaign_not_found';
  end if;

  if v_campaign.publication_status <> 'published'
     or now() < v_campaign.opens_at
     or now() >= v_campaign.closes_at then
    raise exception 'campaign_not_open';
  end if;

  if not coalesce(v_campaign.is_public, false)
     or not coalesce(v_campaign.is_verified, false) then
    raise exception 'artist_not_public';
  end if;

  if p_fulfillment_method = 'shipping' then
    if not v_campaign.shipping_enabled then
      raise exception 'shipping_not_available';
    end if;
    if length(trim(coalesce(p_customer_phone, ''))) = 0 then
      raise exception 'customer_phone_required';
    end if;
    if length(trim(coalesce(p_shipping_address, ''))) = 0 then
      raise exception 'shipping_address_required';
    end if;
    if p_pickup_point_id is not null then
      raise exception 'invalid_fulfillment';
    end if;
    v_shipping_fee := v_campaign.flat_shipping_fee;
  elsif p_fulfillment_method = 'pickup' then
    if not v_campaign.pickup_enabled then
      raise exception 'pickup_not_available';
    end if;
    if length(trim(coalesce(p_customer_phone, ''))) = 0 then
      raise exception 'customer_contact_required';
    end if;

    select pp.*
    into v_pickup
    from public.campaign_pickup_points pp
    where pp.id = p_pickup_point_id
      and pp.campaign_id = v_campaign.id
      and pp.is_enabled = true;

    if v_pickup.id is null then
      raise exception 'invalid_pickup_point';
    end if;

    v_pickup_snapshot := jsonb_build_object(
      'id', v_pickup.id,
      'name', v_pickup.name,
      'address', v_pickup.address,
      'starts_at', v_pickup.starts_at,
      'ends_at', v_pickup.ends_at,
      'instructions', v_pickup.instructions
    );
  else
    raise exception 'invalid_fulfillment';
  end if;

  if not exists (
    select 1
    from public.campaign_payment_methods pm
    where pm.campaign_id = v_campaign.id
      and pm.is_enabled = true
  ) then
    raise exception 'payment_method_required';
  end if;

  if p_client_request_id is not null then
    select o.*
    into v_existing
    from public.orders o
    where o.payment_idempotency_key = p_client_request_id
    for update;

    if v_existing.id is not null then
      if v_existing.campaign_id <> p_campaign_id
         or v_existing.order_type <> 'online_sale' then
        raise exception 'client_request_id_conflict';
      end if;

      select op.*
      into v_existing_payment
      from public.order_payments op
      where op.order_id = v_existing.id;

      select coalesce(jsonb_agg(to_jsonb(pm) - 'artist_id' - 'created_at' - 'updated_at'), '[]'::jsonb)
      into v_payment_methods
      from public.campaign_payment_methods pm
      where pm.campaign_id = p_campaign_id
        and pm.is_enabled = true;

      return query select
        v_existing.id,
        v_existing.pickup_code,
        v_existing.subtotal_price,
        v_existing.shipping_fee,
        v_existing.total_price,
        v_existing.currency,
        v_existing_payment.payment_status,
        v_payment_methods,
        v_existing_payment.stock_hold_expires_at,
        v_existing.pickup_point_snapshot;
      return;
    end if;
  end if;

  if (
    select count(*) <> count(distinct value ->> 'product_id')
    from jsonb_array_elements(p_items)
  ) then
    raise exception 'duplicate_product';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_order_code := public.generate_online_order_code();
    exit when not exists (
      select 1 from public.orders o
      where o.campaign_id = p_campaign_id and o.pickup_code = v_order_code
    );
    if v_attempt >= 5 then
      raise exception 'order_code_generation_failed';
    end if;
  end loop;

  insert into public.orders (
    event_id, campaign_id, queue_id, status,
    total_price, subtotal_price, discount_total, shipping_fee,
    pricing_breakdown, currency, payment_method, payment_idempotency_key,
    order_type, pickup_code, customer_name, customer_contact,
    customer_phone, customer_email, customer_note, shipping_address,
    fulfillment_method, pickup_point_id, pickup_point_snapshot, pickup_status
  )
  values (
    null, v_campaign.id, null, 'draft',
    0, 0, 0, v_shipping_fee,
    '[]'::jsonb, v_campaign.currency, null, p_client_request_id,
    'online_sale', v_order_code, trim(p_customer_name), trim(p_customer_phone),
    nullif(trim(coalesce(p_customer_phone, '')), ''), lower(trim(p_customer_email)),
    nullif(trim(coalesce(p_customer_note, '')), ''),
    case when p_fulfillment_method = 'shipping' then trim(p_shipping_address) else null end,
    p_fulfillment_method, p_pickup_point_id, v_pickup_snapshot, 'not_required'
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_qty := (v_item ->> 'quantity')::integer;
    exception when others then
      raise exception 'invalid_quantity';
    end;

    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid_quantity';
    end if;

    select
      cp.id as campaign_product_id,
      cp.is_unlimited,
      cp.stock_total,
      cp.stock_reserved,
      cp.stock_sold,
      p.id as product_id,
      p.name,
      p.sku,
      coalesce(cp.price_override, p.price) as effective_price
    into v_product
    from public.online_campaign_products cp
    join public.products p on p.id = cp.product_id
    where cp.campaign_id = v_campaign.id
      and cp.product_id = nullif(v_item ->> 'product_id', '')::uuid
      and cp.is_enabled = true
      and p.deleted_at is null
      and p.status = 'enable'
    for update of cp;

    if v_product.product_id is null then
      raise exception 'invalid_product';
    end if;

    if not v_product.is_unlimited
       and v_product.stock_total - v_product.stock_reserved - v_product.stock_sold < v_qty then
      raise exception 'insufficient_stock';
    end if;

    update public.online_campaign_products
    set stock_reserved = stock_reserved + v_qty
    where id = v_product.campaign_product_id;

    insert into public.order_items (
      order_id, product_id, event_product_id, campaign_product_id,
      quantity, price_per_unit, currency, product_name_snapshot, sku_snapshot
    )
    values (
      v_order_id, v_product.product_id, null, v_product.campaign_product_id,
      v_qty, v_product.effective_price, v_campaign.currency,
      v_product.name, v_product.sku
    );

    v_subtotal := v_subtotal + (v_product.effective_price * v_qty);
  end loop;

  v_total := v_subtotal + v_shipping_fee;

  update public.orders
  set subtotal_price = v_subtotal,
      discount_total = 0,
      shipping_fee = v_shipping_fee,
      total_price = v_total,
      pricing_breakdown = '[]'::jsonb
  where id = v_order_id;

  insert into public.order_payments (
    order_id, event_id, campaign_id, artist_id, payment_status,
    amount_expected, currency, stock_hold_expires_at
  )
  values (
    v_order_id, null, v_campaign.id, v_campaign.artist_id, 'awaiting_payment',
    v_total, v_campaign.currency, v_hold_expires_at
  )
  returning id into v_payment_id;

  perform private.append_campaign_payment_review_event(
    v_order_id, v_payment_id, v_campaign.id, v_campaign.artist_id,
    'created', null, 'awaiting_payment', null, null,
    jsonb_build_object('fulfillment_method', p_fulfillment_method)
  );
  perform private.append_campaign_payment_review_event(
    v_order_id, v_payment_id, v_campaign.id, v_campaign.artist_id,
    'stock_reserved', null, 'awaiting_payment', null, null,
    jsonb_build_object('quantity', (
      select coalesce(sum(oi.quantity), 0)
      from public.order_items oi where oi.order_id = v_order_id
    ))
  );

  select coalesce(jsonb_agg(to_jsonb(pm) - 'artist_id' - 'created_at' - 'updated_at'), '[]'::jsonb)
  into v_payment_methods
  from public.campaign_payment_methods pm
  where pm.campaign_id = v_campaign.id
    and pm.is_enabled = true;

  return query select
    v_order_id, v_order_code, v_subtotal, v_shipping_fee, v_total,
    v_campaign.currency, 'awaiting_payment'::text, v_payment_methods,
    v_hold_expires_at, v_pickup_snapshot;
end;
$$;

revoke all on function public.get_public_online_campaign(text, text) from public;
grant execute on function public.get_public_online_campaign(text, text) to anon, authenticated;

revoke all on function public.create_online_campaign_order(uuid, jsonb, text, uuid, text, text, text, text, text, uuid) from public;
grant execute on function public.create_online_campaign_order(uuid, jsonb, text, uuid, text, text, text, text, text, uuid) to anon, authenticated;


create or replace function private.expire_online_campaign_hold(p_order_id uuid)
returns table (expired boolean, released_stock_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_item record;
  v_released integer := 0;
  v_deadline timestamptz;
begin
  select
    o.id, o.campaign_id, o.status,
    c.artist_id,
    op.id as payment_id,
    op.payment_status,
    op.stock_hold_expires_at,
    op.upload_grace_expires_at,
    op.slip_url
  into v_order
  from public.orders o
  join public.online_campaigns c on c.id = o.campaign_id
  join public.order_payments op on op.order_id = o.id
  where o.id = p_order_id
    and o.order_type = 'online_sale'
  for update of o, op;

  v_deadline := greatest(
    v_order.stock_hold_expires_at,
    coalesce(v_order.upload_grace_expires_at, v_order.stock_hold_expires_at)
  );

  if v_order.id is null
     or v_order.payment_status <> 'awaiting_payment'
     or v_deadline is null
     or v_deadline > now() then
    return query select false, 0;
    return;
  end if;

  for v_item in
    select oi.campaign_product_id, oi.quantity
    from public.order_items oi
    where oi.order_id = v_order.id
      and oi.campaign_product_id is not null
    order by oi.campaign_product_id
  loop
    update public.online_campaign_products cp
    set stock_reserved = greatest(cp.stock_reserved - v_item.quantity, 0)
    where cp.id = v_item.campaign_product_id;

    v_released := v_released + v_item.quantity;
  end loop;

  update public.order_payments
  set payment_status = 'payment_expired',
      expired_at = now(),
      review_note = 'stock_hold_expired',
      updated_at = now()
  where id = v_order.payment_id;

  update public.orders
  set status = 'cancelled',
      pickup_status = 'expired',
      cancelled_at = now(),
      cancelled_by = null,
      cancel_reason = 'stock_hold_expired'
  where id = v_order.id;

  perform private.append_campaign_payment_review_event(
    v_order.id, v_order.payment_id, v_order.campaign_id, v_order.artist_id,
    'payment_expired', 'awaiting_payment', 'payment_expired',
    v_order.slip_url, 'stock_hold_expired'
  );
  perform private.append_campaign_payment_review_event(
    v_order.id, v_order.payment_id, v_order.campaign_id, v_order.artist_id,
    'stock_released', 'awaiting_payment', 'payment_expired',
    v_order.slip_url, 'stock_hold_expired',
    jsonb_build_object('quantity', v_released)
  );

  return query select true, v_released;
end;
$$;

create or replace function private.expire_online_campaign_holds()
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
    where o.order_type = 'online_sale'
      and op.payment_status = 'awaiting_payment'
      and greatest(
        op.stock_hold_expires_at,
        coalesce(op.upload_grace_expires_at, op.stock_hold_expires_at)
      ) <= now()
    for update of o, op skip locked
  loop
    select * into v_result
    from private.expire_online_campaign_hold(v_order_id);

    if coalesce(v_result.expired, false) then
      v_expired_count := v_expired_count + 1;
      v_released_count := v_released_count + coalesce(v_result.released_stock_count, 0);
    end if;
  end loop;

  return query select v_expired_count, v_released_count;
end;
$$;

create or replace function private.expire_all_stock_holds()
returns table (
  preorder_expired_count integer,
  campaign_expired_count integer,
  released_stock_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preorder record;
  v_campaign record;
begin
  select * into v_preorder from private.expire_preorder_stock_holds();
  select * into v_campaign from private.expire_online_campaign_holds();

  return query select
    coalesce(v_preorder.expired_count, 0),
    coalesce(v_campaign.expired_count, 0),
    coalesce(v_preorder.released_stock_count, 0)
      + coalesce(v_campaign.released_stock_count, 0);
end;
$$;

revoke all on function private.expire_online_campaign_hold(uuid) from public, anon, authenticated;
revoke all on function private.expire_online_campaign_holds() from public, anon, authenticated;
revoke all on function private.expire_all_stock_holds() from public, anon, authenticated;

select cron.schedule(
  'expire-preorder-stock-holds',
  '* * * * *',
  'select * from private.expire_all_stock_holds()'
);

create or replace function public.begin_online_payment_upload(
  p_artist_slug text,
  p_order_code text
)
returns table (
  order_id uuid,
  upload_grace_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_grace timestamptz;
begin
  select
    o.id,
    op.id as payment_id,
    op.payment_status,
    op.stock_hold_expires_at,
    op.evidence_upload_started_at,
    op.upload_grace_expires_at
  into v_order
  from public.orders o
  join public.online_campaigns c on c.id = o.campaign_id
  join public.artists a on a.id = c.artist_id
  join public.order_payments op on op.order_id = o.id
  where lower(a.slug) = lower(trim(p_artist_slug))
    and upper(o.pickup_code) = upper(trim(p_order_code))
    and o.order_type = 'online_sale'
  for update of op;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  if v_order.payment_status <> 'awaiting_payment' then
    raise exception 'payment_not_awaiting';
  end if;

  if v_order.stock_hold_expires_at <= now() then
    raise exception 'stock_hold_expired';
  end if;

  if v_order.upload_grace_expires_at is null then
    v_grace := least(
      now() + interval '2 minutes',
      v_order.stock_hold_expires_at + interval '2 minutes'
    );

    update public.order_payments
    set evidence_upload_started_at = now(),
        upload_grace_expires_at = v_grace,
        updated_at = now()
    where id = v_order.payment_id;
  else
    v_grace := v_order.upload_grace_expires_at;
  end if;

  return query select v_order.id, v_grace;
end;
$$;

create or replace function public.submit_online_payment_evidence(
  p_artist_slug text,
  p_order_code text,
  p_slip_url text,
  p_client_request_id uuid default null
)
returns table (
  order_id uuid,
  payment_status text,
  submitted_at timestamptz,
  stock_remains_reserved boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_deadline timestamptz;
  v_now timestamptz := now();
  v_expiry record;
begin
  if length(trim(coalesce(p_slip_url, ''))) = 0 then
    raise exception 'slip_required';
  end if;

  select
    o.id,
    o.campaign_id,
    o.status as order_status,
    c.artist_id,
    op.id as payment_id,
    op.payment_status,
    op.stock_hold_expires_at,
    op.upload_grace_expires_at,
    op.evidence_idempotency_key,
    op.submitted_at
  into v_order
  from public.orders o
  join public.online_campaigns c on c.id = o.campaign_id
  join public.artists a on a.id = c.artist_id
  join public.order_payments op on op.order_id = o.id
  where lower(a.slug) = lower(trim(p_artist_slug))
    and upper(o.pickup_code) = upper(trim(p_order_code))
    and o.order_type = 'online_sale'
  for update of o, op;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  if p_client_request_id is not null
     and v_order.evidence_idempotency_key = p_client_request_id
     and v_order.payment_status in ('payment_submitted', 'payment_submitted_late') then
    return query select
      v_order.id,
      v_order.payment_status,
      v_order.submitted_at,
      v_order.payment_status = 'payment_submitted';
    return;
  end if;

  v_deadline := greatest(
    v_order.stock_hold_expires_at,
    coalesce(v_order.upload_grace_expires_at, v_order.stock_hold_expires_at)
  );

  if v_order.payment_status = 'awaiting_payment' and v_deadline >= v_now then
    update public.order_payments
    set payment_status = 'payment_submitted',
        slip_url = trim(p_slip_url),
        submitted_at = v_now,
        evidence_idempotency_key = p_client_request_id,
        review_note = null,
        updated_at = v_now
    where id = v_order.payment_id;

    perform private.append_campaign_payment_review_event(
      v_order.id, v_order.payment_id, v_order.campaign_id, v_order.artist_id,
      'evidence_submitted', 'awaiting_payment', 'payment_submitted',
      trim(p_slip_url)
    );

    return query select v_order.id, 'payment_submitted'::text, v_now, true;
    return;
  end if;

  if v_order.payment_status = 'awaiting_payment' then
    select * into v_expiry
    from private.expire_online_campaign_hold(v_order.id);

    select
      o.id,
      o.campaign_id,
      c.artist_id,
      op.id as payment_id,
      op.payment_status,
      op.evidence_idempotency_key,
      op.submitted_at
    into v_order
    from public.orders o
    join public.online_campaigns c on c.id = o.campaign_id
    join public.order_payments op on op.order_id = o.id
    where o.id = v_order.id
    for update of o, op;
  end if;

  if v_order.payment_status = 'payment_submitted_late' then
    return query select
      v_order.id, 'payment_submitted_late'::text,
      v_order.submitted_at, false;
    return;
  end if;

  if v_order.payment_status <> 'payment_expired' then
    raise exception 'payment_submission_not_allowed';
  end if;

  update public.order_payments
  set payment_status = 'payment_submitted_late',
      slip_url = trim(p_slip_url),
      submitted_at = v_now,
      late_payment_reported_at = v_now,
      evidence_idempotency_key = p_client_request_id,
      review_note = null,
      updated_at = v_now
  where id = v_order.payment_id;

  perform private.append_campaign_payment_review_event(
    v_order.id, v_order.payment_id, v_order.campaign_id, v_order.artist_id,
    'late_evidence_submitted', 'payment_expired', 'payment_submitted_late',
    trim(p_slip_url), 'stock_not_reserved'
  );

  return query select v_order.id, 'payment_submitted_late'::text, v_now, false;
end;
$$;

create or replace function public.get_public_online_order_by_code(
  p_artist_slug text,
  p_order_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'order_id', o.id,
    'campaign_id', o.campaign_id,
    'campaign_name', c.name,
    'campaign_slug', c.slug,
    'artist_slug', a.slug,
    'artist_name', a.display_name,
    'status', o.status,
    'fulfillment_status', o.pickup_status,
    'fulfillment_method', o.fulfillment_method,
    'order_code', o.pickup_code,
    'customer_name', o.customer_name,
    'customer_email_masked', case
      when coalesce(o.customer_email, '') = '' then ''
      else left(split_part(o.customer_email, '@', 1), 2)
        || '***@' || split_part(o.customer_email, '@', 2)
    end,
    'subtotal_price', o.subtotal_price,
    'discount_total', o.discount_total,
    'shipping_fee', o.shipping_fee,
    'total_price', o.total_price,
    'currency', o.currency,
    'shipping_address', o.shipping_address,
    'pickup_point', o.pickup_point_snapshot,
    'tracking_number', o.tracking_number,
    'shipping_carrier', o.shipping_carrier,
    'shipped_at', o.shipped_at,
    'picked_up_at', o.picked_up_at,
    'created_at', o.created_at,
    'payment_status', op.payment_status,
    'slip_url', op.slip_url,
    'submitted_at', op.submitted_at,
    'confirmed_at', op.confirmed_at,
    'expired_at', op.expired_at,
    'review_note', op.review_note,
    'stock_hold_expires_at', op.stock_hold_expires_at,
    'upload_grace_expires_at', op.upload_grace_expires_at,
    'late_payment_reported_at', op.late_payment_reported_at,
    'refunded_at', op.refunded_at,
    'payment_methods', case
      when op.payment_status = 'awaiting_payment'
        and greatest(
          op.stock_hold_expires_at,
          coalesce(op.upload_grace_expires_at, op.stock_hold_expires_at)
        ) > now()
      then coalesce((
        select jsonb_agg(to_jsonb(pm) - 'artist_id' - 'created_at' - 'updated_at')
        from public.campaign_payment_methods pm
        where pm.campaign_id = c.id and pm.is_enabled = true
      ), '[]'::jsonb)
      else '[]'::jsonb
    end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id', oi.product_id,
        'name', coalesce(oi.product_name_snapshot, p.name),
        'sku', coalesce(oi.sku_snapshot, p.sku),
        'quantity', oi.quantity,
        'price_per_unit', oi.price_per_unit,
        'currency', oi.currency
      ) order by oi.id)
      from public.order_items oi
      join public.products p on p.id = oi.product_id
      where oi.order_id = o.id
    ), '[]'::jsonb)
  )
  into v_result
  from public.orders o
  join public.online_campaigns c on c.id = o.campaign_id
  join public.artists a on a.id = c.artist_id
  join public.order_payments op on op.order_id = o.id
  where lower(a.slug) = lower(trim(p_artist_slug))
    and upper(o.pickup_code) = upper(trim(p_order_code))
    and o.order_type = 'online_sale';

  return v_result;
end;
$$;

revoke all on function public.begin_online_payment_upload(text, text) from public;
grant execute on function public.begin_online_payment_upload(text, text) to anon, authenticated;

revoke all on function public.submit_online_payment_evidence(text, text, text, uuid) from public;
grant execute on function public.submit_online_payment_evidence(text, text, text, uuid) to anon, authenticated;

revoke all on function public.get_public_online_order_by_code(text, text) from public;
grant execute on function public.get_public_online_order_by_code(text, text) to anon, authenticated;


create or replace function private.release_online_campaign_order_stock(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_released integer := 0;
begin
  for v_item in
    select oi.campaign_product_id, oi.quantity
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.campaign_product_id is not null
    order by oi.campaign_product_id
  loop
    update public.online_campaign_products cp
    set stock_reserved = greatest(cp.stock_reserved - v_item.quantity, 0)
    where cp.id = v_item.campaign_product_id;

    v_released := v_released + v_item.quantity;
  end loop;

  return v_released;
end;
$$;

create or replace function public.confirm_online_payment(
  p_order_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_item record;
  v_fulfillment_status text;
begin
  select
    o.*,
    c.artist_id,
    op.id as payment_id,
    op.payment_status,
    op.slip_url
  into v_order
  from public.orders o
  join public.online_campaigns c on c.id = o.campaign_id
  join public.order_payments op on op.order_id = o.id
  where o.id = p_order_id
    and o.order_type = 'online_sale'
  for update of o, op;

  if v_order.id is null then raise exception 'order_not_found'; end if;
  if not public.has_artist_role(v_order.artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;

  if v_order.payment_status = 'payment_confirmed' then
    return jsonb_build_object(
      'order_id', v_order.id,
      'payment_status', 'payment_confirmed',
      'fulfillment_status', v_order.pickup_status
    );
  end if;

  if v_order.payment_status <> 'payment_submitted' then
    raise exception 'payment_not_submitted';
  end if;

  for v_item in
    select oi.campaign_product_id, oi.quantity
    from public.order_items oi
    where oi.order_id = v_order.id
    order by oi.campaign_product_id
  loop
    update public.online_campaign_products cp
    set stock_reserved = cp.stock_reserved - v_item.quantity,
        stock_sold = cp.stock_sold + v_item.quantity
    where cp.id = v_item.campaign_product_id
      and cp.stock_reserved >= v_item.quantity;

    if not found then raise exception 'reserved_stock_mismatch'; end if;
  end loop;

  v_fulfillment_status := case
    when v_order.fulfillment_method = 'shipping' then 'awaiting_shipment'
    else 'awaiting_pickup'
  end;

  update public.order_payments
  set payment_status = 'payment_confirmed',
      confirmed_at = now(),
      confirmed_by = auth.uid(),
      review_note = nullif(trim(coalesce(p_note, '')), ''),
      updated_at = now()
  where id = v_order.payment_id;

  update public.orders
  set status = 'confirmed',
      pickup_status = v_fulfillment_status
  where id = v_order.id;

  perform private.append_campaign_payment_review_event(
    v_order.id, v_order.payment_id, v_order.campaign_id, v_order.artist_id,
    'payment_confirmed', 'payment_submitted', 'payment_confirmed',
    v_order.slip_url, nullif(trim(coalesce(p_note, '')), '')
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'payment_status', 'payment_confirmed',
    'fulfillment_status', v_fulfillment_status
  );
end;
$$;

create or replace function public.reject_online_payment(
  p_order_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_released integer;
begin
  if length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'review_note_required';
  end if;

  select
    o.*,
    c.artist_id,
    op.id as payment_id,
    op.payment_status,
    op.slip_url
  into v_order
  from public.orders o
  join public.online_campaigns c on c.id = o.campaign_id
  join public.order_payments op on op.order_id = o.id
  where o.id = p_order_id
    and o.order_type = 'online_sale'
  for update of o, op;

  if v_order.id is null then raise exception 'order_not_found'; end if;
  if not public.has_artist_role(v_order.artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;
  if v_order.payment_status <> 'payment_submitted' then
    raise exception 'payment_not_submitted';
  end if;

  v_released := private.release_online_campaign_order_stock(v_order.id);

  update public.order_payments
  set payment_status = 'payment_rejected',
      rejected_at = now(),
      rejected_by = auth.uid(),
      review_note = trim(p_note),
      updated_at = now()
  where id = v_order.payment_id;

  update public.orders
  set status = 'cancelled',
      pickup_status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancel_reason = 'payment_rejected'
  where id = v_order.id;

  perform private.append_campaign_payment_review_event(
    v_order.id, v_order.payment_id, v_order.campaign_id, v_order.artist_id,
    'payment_rejected', 'payment_submitted', 'payment_rejected',
    v_order.slip_url, trim(p_note)
  );
  perform private.append_campaign_payment_review_event(
    v_order.id, v_order.payment_id, v_order.campaign_id, v_order.artist_id,
    'stock_released', 'payment_submitted', 'payment_rejected',
    v_order.slip_url, trim(p_note), jsonb_build_object('quantity', v_released)
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'payment_status', 'payment_rejected',
    'released_stock_count', v_released
  );
end;
$$;

create or replace function public.accept_late_online_payment(
  p_order_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_item record;
  v_fulfillment_status text;
begin
  select
    o.*,
    c.artist_id,
    op.id as payment_id,
    op.payment_status,
    op.slip_url
  into v_order
  from public.orders o
  join public.online_campaigns c on c.id = o.campaign_id
  join public.order_payments op on op.order_id = o.id
  where o.id = p_order_id
    and o.order_type = 'online_sale'
  for update of o, op;

  if v_order.id is null then raise exception 'order_not_found'; end if;
  if not public.has_artist_role(v_order.artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;
  if v_order.payment_status <> 'payment_submitted_late' then
    raise exception 'payment_not_late';
  end if;

  for v_item in
    select oi.campaign_product_id, oi.quantity
    from public.order_items oi
    where oi.order_id = v_order.id
    order by oi.campaign_product_id
  loop
    update public.online_campaign_products cp
    set stock_sold = cp.stock_sold + v_item.quantity
    where cp.id = v_item.campaign_product_id
      and (
        cp.is_unlimited
        or cp.stock_total - cp.stock_reserved - cp.stock_sold >= v_item.quantity
      );

    if not found then raise exception 'insufficient_stock'; end if;
  end loop;

  v_fulfillment_status := case
    when v_order.fulfillment_method = 'shipping' then 'awaiting_shipment'
    else 'awaiting_pickup'
  end;

  update public.order_payments
  set payment_status = 'payment_confirmed',
      confirmed_at = now(),
      confirmed_by = auth.uid(),
      review_note = nullif(trim(coalesce(p_note, '')), ''),
      updated_at = now()
  where id = v_order.payment_id;

  update public.orders
  set status = 'confirmed',
      pickup_status = v_fulfillment_status,
      cancelled_at = null,
      cancelled_by = null,
      cancel_reason = null
  where id = v_order.id;

  perform private.append_campaign_payment_review_event(
    v_order.id, v_order.payment_id, v_order.campaign_id, v_order.artist_id,
    'payment_confirmed', 'payment_submitted_late', 'payment_confirmed',
    v_order.slip_url, nullif(trim(coalesce(p_note, '')), ''),
    jsonb_build_object('late_payment', true)
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'payment_status', 'payment_confirmed',
    'fulfillment_status', v_fulfillment_status
  );
end;
$$;

create or replace function public.mark_online_refund_required(
  p_order_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
begin
  if length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'refund_note_required';
  end if;

  select
    o.*,
    c.artist_id,
    op.id as payment_id,
    op.payment_status,
    op.slip_url
  into v_order
  from public.orders o
  join public.online_campaigns c on c.id = o.campaign_id
  join public.order_payments op on op.order_id = o.id
  where o.id = p_order_id
    and o.order_type = 'online_sale'
  for update of o, op;

  if v_order.id is null then raise exception 'order_not_found'; end if;
  if not public.has_artist_role(v_order.artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;
  if v_order.payment_status not in ('payment_submitted_late', 'payment_confirmed') then
    raise exception 'refund_not_allowed';
  end if;

  update public.order_payments
  set payment_status = 'refund_pending',
      refund_note = trim(p_note),
      updated_at = now()
  where id = v_order.payment_id;

  update public.orders
  set status = 'cancelled',
      pickup_status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, now()),
      cancelled_by = auth.uid(),
      cancel_reason = 'refund_required'
  where id = v_order.id;

  perform private.append_campaign_payment_review_event(
    v_order.id, v_order.payment_id, v_order.campaign_id, v_order.artist_id,
    'refund_required', v_order.payment_status, 'refund_pending',
    v_order.slip_url, trim(p_note)
  );

  return jsonb_build_object('order_id', v_order.id, 'payment_status', 'refund_pending');
end;
$$;

create or replace function public.mark_online_refunded(
  p_order_id uuid,
  p_note text,
  p_refund_reference text default null,
  p_refund_evidence_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
begin
  if length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'refund_note_required';
  end if;

  select
    o.*,
    c.artist_id,
    op.id as payment_id,
    op.payment_status,
    op.slip_url
  into v_order
  from public.orders o
  join public.online_campaigns c on c.id = o.campaign_id
  join public.order_payments op on op.order_id = o.id
  where o.id = p_order_id
    and o.order_type = 'online_sale'
  for update of o, op;

  if v_order.id is null then raise exception 'order_not_found'; end if;
  if not public.has_artist_role(v_order.artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;
  if v_order.payment_status <> 'refund_pending' then
    raise exception 'refund_not_pending';
  end if;

  update public.order_payments
  set payment_status = 'refunded',
      refunded_at = now(),
      refunded_by = auth.uid(),
      refund_note = trim(p_note),
      refund_reference = nullif(trim(coalesce(p_refund_reference, '')), ''),
      refund_evidence_url = nullif(trim(coalesce(p_refund_evidence_url, '')), ''),
      updated_at = now()
  where id = v_order.payment_id;

  perform private.append_campaign_payment_review_event(
    v_order.id, v_order.payment_id, v_order.campaign_id, v_order.artist_id,
    'refund_completed', 'refund_pending', 'refunded',
    v_order.slip_url, trim(p_note),
    jsonb_build_object(
      'refund_reference', nullif(trim(coalesce(p_refund_reference, '')), ''),
      'refund_evidence_url', nullif(trim(coalesce(p_refund_evidence_url, '')), '')
    )
  );

  return jsonb_build_object('order_id', v_order.id, 'payment_status', 'refunded');
end;
$$;

create or replace function public.mark_online_order_shipped(
  p_order_id uuid,
  p_carrier text,
  p_tracking_number text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
begin
  if length(trim(coalesce(p_tracking_number, ''))) = 0 then
    raise exception 'tracking_number_required';
  end if;

  select o.*, c.artist_id, op.id as payment_id, op.payment_status
  into v_order
  from public.orders o
  join public.online_campaigns c on c.id = o.campaign_id
  join public.order_payments op on op.order_id = o.id
  where o.id = p_order_id
    and o.order_type = 'online_sale'
  for update of o, op;

  if v_order.id is null then raise exception 'order_not_found'; end if;
  if not public.has_artist_role(v_order.artist_id, array['owner', 'manager', 'seller']) then
    raise exception 'forbidden';
  end if;

  if v_order.pickup_status = 'shipped' then
    return jsonb_build_object('order_id', v_order.id, 'fulfillment_status', 'shipped');
  end if;

  if v_order.status <> 'confirmed'
     or v_order.payment_status <> 'payment_confirmed'
     or v_order.fulfillment_method <> 'shipping'
     or v_order.pickup_status <> 'awaiting_shipment' then
    raise exception 'shipment_not_allowed';
  end if;

  update public.orders
  set status = 'completed',
      pickup_status = 'shipped',
      shipping_carrier = nullif(trim(coalesce(p_carrier, '')), ''),
      tracking_number = trim(p_tracking_number),
      shipped_at = now()
  where id = v_order.id;

  perform private.append_campaign_payment_review_event(
    v_order.id, v_order.payment_id, v_order.campaign_id, v_order.artist_id,
    'order_shipped', 'awaiting_shipment', 'shipped',
    null, trim(p_tracking_number),
    jsonb_build_object('carrier', nullif(trim(coalesce(p_carrier, '')), ''))
  );

  return jsonb_build_object('order_id', v_order.id, 'fulfillment_status', 'shipped');
end;
$$;

create or replace function public.mark_online_order_picked_up(
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
begin
  select o.*, c.artist_id, op.id as payment_id, op.payment_status
  into v_order
  from public.orders o
  join public.online_campaigns c on c.id = o.campaign_id
  join public.order_payments op on op.order_id = o.id
  where o.id = p_order_id
    and o.order_type = 'online_sale'
  for update of o, op;

  if v_order.id is null then raise exception 'order_not_found'; end if;
  if not public.has_artist_role(v_order.artist_id, array['owner', 'manager', 'seller']) then
    raise exception 'forbidden';
  end if;

  if v_order.pickup_status = 'picked_up' then
    return jsonb_build_object('order_id', v_order.id, 'fulfillment_status', 'picked_up');
  end if;

  if v_order.status <> 'confirmed'
     or v_order.payment_status <> 'payment_confirmed'
     or v_order.fulfillment_method <> 'pickup'
     or v_order.pickup_status <> 'awaiting_pickup' then
    raise exception 'pickup_not_allowed';
  end if;

  update public.orders
  set status = 'completed',
      pickup_status = 'picked_up',
      picked_up_at = now(),
      picked_up_by = auth.uid()
  where id = v_order.id;

  perform private.append_campaign_payment_review_event(
    v_order.id, v_order.payment_id, v_order.campaign_id, v_order.artist_id,
    'order_picked_up', 'awaiting_pickup', 'picked_up'
  );

  return jsonb_build_object('order_id', v_order.id, 'fulfillment_status', 'picked_up');
end;
$$;

revoke all on function private.release_online_campaign_order_stock(uuid) from public, anon, authenticated;

revoke all on function public.confirm_online_payment(uuid, text) from public;
grant execute on function public.confirm_online_payment(uuid, text) to authenticated;

revoke all on function public.reject_online_payment(uuid, text) from public;
grant execute on function public.reject_online_payment(uuid, text) to authenticated;

revoke all on function public.accept_late_online_payment(uuid, text) from public;
grant execute on function public.accept_late_online_payment(uuid, text) to authenticated;

revoke all on function public.mark_online_refund_required(uuid, text) from public;
grant execute on function public.mark_online_refund_required(uuid, text) to authenticated;

revoke all on function public.mark_online_refunded(uuid, text, text, text) from public;
grant execute on function public.mark_online_refunded(uuid, text, text, text) to authenticated;

revoke all on function public.mark_online_order_shipped(uuid, text, text) from public;
grant execute on function public.mark_online_order_shipped(uuid, text, text) to authenticated;

revoke all on function public.mark_online_order_picked_up(uuid) from public;
grant execute on function public.mark_online_order_picked_up(uuid) to authenticated;


create or replace function public.save_online_campaign_products(
  p_campaign_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign record;
  v_item jsonb;
  v_product record;
  v_existing record;
  v_product_id uuid;
  v_is_enabled boolean;
  v_is_unlimited boolean;
  v_stock_total integer;
  v_price_override numeric;
  v_allocated integer;
  v_product_available integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'invalid_catalog_payload'; end if;

  select c.* into v_campaign
  from public.online_campaigns c
  where c.id = p_campaign_id
  for update;

  if v_campaign.id is null then raise exception 'campaign_not_found'; end if;
  if not public.has_artist_role(v_campaign.artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    v_is_enabled := coalesce((v_item ->> 'is_enabled')::boolean, true);
    v_is_unlimited := coalesce((v_item ->> 'is_unlimited')::boolean, false);
    v_stock_total := nullif(v_item ->> 'stock_total', '')::integer;
    v_price_override := nullif(v_item ->> 'price_override', '')::numeric;

    select p.* into v_product
    from public.products p
    where p.id = v_product_id
      and p.artist_id = v_campaign.artist_id
      and p.deleted_at is null
    for update;

    if v_product.id is null then raise exception 'invalid_campaign_product'; end if;
    if v_price_override is not null and v_price_override < 0 then
      raise exception 'invalid_price_override';
    end if;

    select cp.* into v_existing
    from public.online_campaign_products cp
    where cp.campaign_id = p_campaign_id
      and cp.product_id = v_product_id
    for update;

    if v_is_unlimited then
      if not coalesce(v_product.is_unlimited, false) then
        raise exception 'campaign_stock_exceeds_catalog_stock';
      end if;
      v_stock_total := null;
    elsif v_stock_total is null or v_stock_total < 0 then
      raise exception 'invalid_campaign_stock';
    end if;

    if v_existing.id is not null
       and not v_is_unlimited
       and v_stock_total < v_existing.stock_reserved + v_existing.stock_sold then
      raise exception 'campaign_stock_below_used_stock';
    end if;

    if not coalesce(v_product.is_unlimited, false)
       and v_is_enabled
       and not v_is_unlimited then
      select
        coalesce((
          select sum(ep.stock_total)
          from public.event_products ep
          join public.events e on e.id = ep.event_id
          where ep.product_id = v_product_id
            and ep.is_enabled = true
            and ep.is_unlimited = false
            and e.status in ('Confirmed', 'confirmed')
            and e.end_date >= now()
        ), 0)
        + coalesce((
          select sum(cp.stock_total)
          from public.online_campaign_products cp
          join public.online_campaigns c on c.id = cp.campaign_id
          where cp.product_id = v_product_id
            and cp.campaign_id <> p_campaign_id
            and cp.is_enabled = true
            and cp.is_unlimited = false
            and c.publication_status not in ('cancelled', 'archived')
            and c.closes_at >= now()
        ), 0)
      into v_allocated;

      v_product_available := greatest(
        coalesce(v_product.stock_total, 0)
          - coalesce(v_product.stock_reserved, 0)
          - coalesce(v_product.stock_sold, 0)
          - coalesce(v_allocated, 0),
        0
      );

      if v_stock_total > v_product_available then
        raise exception 'campaign_stock_exceeds_catalog_stock';
      end if;
    end if;

    insert into public.online_campaign_products (
      campaign_id, product_id, artist_id, is_enabled,
      price_override, stock_total, is_unlimited
    )
    values (
      p_campaign_id, v_product_id, v_campaign.artist_id, v_is_enabled,
      v_price_override, v_stock_total, v_is_unlimited
    )
    on conflict (campaign_id, product_id)
    do update set
      is_enabled = excluded.is_enabled,
      price_override = excluded.price_override,
      stock_total = excluded.stock_total,
      is_unlimited = excluded.is_unlimited,
      updated_at = now();
  end loop;
end;
$$;

create or replace function public.publish_online_campaign(p_campaign_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign record;
begin
  select c.* into v_campaign
  from public.online_campaigns c
  where c.id = p_campaign_id
  for update;

  if v_campaign.id is null then raise exception 'campaign_not_found'; end if;
  if not public.has_artist_role(v_campaign.artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;

  if not v_campaign.shipping_enabled and not v_campaign.pickup_enabled then
    raise exception 'fulfillment_method_required';
  end if;
  if v_campaign.pickup_enabled and not exists (
    select 1 from public.campaign_pickup_points pp
    where pp.campaign_id = v_campaign.id and pp.is_enabled = true
  ) then
    raise exception 'pickup_point_required';
  end if;
  if not exists (
    select 1 from public.online_campaign_products cp
    where cp.campaign_id = v_campaign.id and cp.is_enabled = true
  ) then
    raise exception 'campaign_product_required';
  end if;
  if not exists (
    select 1 from public.campaign_payment_methods pm
    where pm.campaign_id = v_campaign.id and pm.is_enabled = true
  ) then
    raise exception 'payment_method_required';
  end if;

  update public.online_campaigns
  set publication_status = 'published'
  where id = v_campaign.id;

  return 'published';
end;
$$;

create or replace function public.list_my_online_campaigns()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'artist_id', c.artist_id,
    'name', c.name,
    'slug', c.slug,
    'description', c.description,
    'opens_at', c.opens_at,
    'closes_at', c.closes_at,
    'campaign_timezone', c.campaign_timezone,
    'currency', c.currency,
    'shipping_enabled', c.shipping_enabled,
    'flat_shipping_fee', c.flat_shipping_fee,
    'pickup_enabled', c.pickup_enabled,
    'publication_status', c.publication_status,
    'state', case
      when c.publication_status = 'draft' then 'draft'
      when c.publication_status = 'cancelled' then 'cancelled'
      when c.publication_status = 'archived' then 'archived'
      when now() < c.opens_at then 'scheduled'
      when now() >= c.closes_at then 'closed'
      when not exists (
        select 1 from public.online_campaign_products cp
        where cp.campaign_id = c.id
          and cp.is_enabled = true
          and (cp.is_unlimited or cp.stock_total - cp.stock_reserved - cp.stock_sold > 0)
      ) then 'sold_out'
      else 'open'
    end,
    'action_count', (
      select count(*)
      from public.orders o
      join public.order_payments op on op.order_id = o.id
      where o.campaign_id = c.id
        and (
          op.payment_status in ('payment_submitted', 'payment_submitted_late', 'refund_pending')
          or o.pickup_status in ('awaiting_shipment', 'awaiting_pickup')
        )
    ),
    'confirmed_revenue', (
      select coalesce(sum(o.total_price), 0)
      from public.orders o
      join public.order_payments op on op.order_id = o.id
      where o.campaign_id = c.id
        and op.payment_status = 'payment_confirmed'
    )
  ) order by c.opens_at desc), '[]'::jsonb)
  from public.online_campaigns c
  where public.has_artist_role(c.artist_id, array['owner', 'manager']);
$$;

create or replace function public.get_online_campaign_workspace(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.online_campaigns%rowtype;
begin
  select c.* into v_campaign
  from public.online_campaigns c
  where c.id = p_campaign_id;

  if v_campaign.id is null then raise exception 'campaign_not_found'; end if;
  if not public.has_artist_role(v_campaign.artist_id, array['owner', 'manager', 'seller']) then
    raise exception 'forbidden';
  end if;

  return jsonb_build_object(
    'campaign', to_jsonb(v_campaign),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cp.id,
        'product_id', p.id,
        'name', p.name,
        'sku', p.sku,
        'price', p.price,
        'price_override', cp.price_override,
        'stock_total', cp.stock_total,
        'stock_reserved', cp.stock_reserved,
        'stock_sold', cp.stock_sold,
        'is_unlimited', cp.is_unlimited,
        'is_enabled', cp.is_enabled
      ) order by p.name)
      from public.online_campaign_products cp
      join public.products p on p.id = cp.product_id
      where cp.campaign_id = v_campaign.id
    ), '[]'::jsonb),
    'catalog', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'sku', p.sku,
        'price', p.price,
        'currency', p.currency,
        'stock_total', p.stock_total,
        'stock_reserved', p.stock_reserved,
        'stock_sold', p.stock_sold,
        'is_unlimited', p.is_unlimited,
        'image_url', p.image_url
      ) order by p.name)
      from public.products p
      where p.artist_id = v_campaign.artist_id
        and p.deleted_at is null
        and p.status = 'enable'
    ), '[]'::jsonb),
    'pickup_points', coalesce((
      select jsonb_agg(to_jsonb(pp) order by pp.starts_at)
      from public.campaign_pickup_points pp
      where pp.campaign_id = v_campaign.id
    ), '[]'::jsonb),
    'payment_methods', coalesce((
      select jsonb_agg(to_jsonb(pm) order by pm.created_at)
      from public.campaign_payment_methods pm
      where pm.campaign_id = v_campaign.id
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'order_code', o.pickup_code,
        'created_at', o.created_at,
        'status', o.status,
        'customer_name', o.customer_name,
        'customer_email', o.customer_email,
        'customer_phone', o.customer_phone,
        'shipping_address', o.shipping_address,
        'fulfillment_method', o.fulfillment_method,
        'fulfillment_status', o.pickup_status,
        'pickup_point', o.pickup_point_snapshot,
        'subtotal_price', o.subtotal_price,
        'discount_total', o.discount_total,
        'shipping_fee', o.shipping_fee,
        'total_price', o.total_price,
        'currency', o.currency,
        'tracking_number', o.tracking_number,
        'shipping_carrier', o.shipping_carrier,
        'payment_status', op.payment_status,
        'slip_url', op.slip_url,
        'submitted_at', op.submitted_at,
        'review_note', op.review_note,
        'stock_hold_expires_at', op.stock_hold_expires_at,
        'late_payment_reported_at', op.late_payment_reported_at,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', coalesce(oi.product_name_snapshot, p.name),
            'sku', coalesce(oi.sku_snapshot, p.sku),
            'quantity', oi.quantity,
            'price_per_unit', oi.price_per_unit
          ) order by oi.id)
          from public.order_items oi
          join public.products p on p.id = oi.product_id
          where oi.order_id = o.id
        ), '[]'::jsonb)
      ) order by o.created_at desc)
      from public.orders o
      join public.order_payments op on op.order_id = o.id
      where o.campaign_id = v_campaign.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.save_online_campaign_products(uuid, jsonb) from public;
grant execute on function public.save_online_campaign_products(uuid, jsonb) to authenticated;

revoke all on function public.publish_online_campaign(uuid) from public;
grant execute on function public.publish_online_campaign(uuid) to authenticated;

revoke all on function public.list_my_online_campaigns() from public;
grant execute on function public.list_my_online_campaigns() to authenticated;

revoke all on function public.get_online_campaign_workspace(uuid) from public;
grant execute on function public.get_online_campaign_workspace(uuid) to authenticated;
