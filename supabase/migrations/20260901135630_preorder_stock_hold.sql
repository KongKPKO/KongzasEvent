alter table public.order_payments
  add column if not exists stock_hold_expires_at timestamptz;

create index if not exists order_payments_active_stock_hold_idx
  on public.order_payments (stock_hold_expires_at)
  where payment_status = 'awaiting_payment'
    and stock_hold_expires_at is not null;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

alter function public.reserve_preorder_order_stock(uuid)
  rename to reserve_preorder_order_stock_base;
alter function public.reserve_preorder_order_stock_base(uuid)
  set schema private;

alter function public.create_preorder_with_stock(uuid, jsonb, text, text, text, uuid, text, text, text, text)
  rename to create_preorder_with_stock_base;
alter function public.create_preorder_with_stock_base(uuid, jsonb, text, text, text, uuid, text, text, text, text)
  set schema private;

alter function public.submit_preorder_payment_evidence(uuid, text, text, uuid)
  rename to submit_preorder_payment_evidence_base;
alter function public.submit_preorder_payment_evidence_base(uuid, text, text, uuid)
  set schema private;

alter function public.cancel_public_preorder_before_payment(uuid, text)
  rename to cancel_public_preorder_before_payment_base;
alter function public.cancel_public_preorder_before_payment_base(uuid, text)
  set schema private;

alter function public.get_public_preorder_by_code(text, text)
  rename to get_public_preorder_by_code_base;
alter function public.get_public_preorder_by_code_base(text, text)
  set schema private;

revoke all on function private.reserve_preorder_order_stock_base(uuid) from public, anon, authenticated;
revoke all on function private.create_preorder_with_stock_base(uuid, jsonb, text, text, text, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function private.submit_preorder_payment_evidence_base(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function private.cancel_public_preorder_before_payment_base(uuid, text) from public, anon, authenticated;
revoke all on function private.get_public_preorder_by_code_base(text, text) from public, anon, authenticated;

create function public.reserve_preorder_order_stock(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_status text;
  v_hold_expires_at timestamptz;
begin
  select op.payment_status, op.stock_hold_expires_at
  into v_payment_status, v_hold_expires_at
  from public.order_payments op
  where op.order_id = p_order_id
  for update;

  if v_payment_status = 'awaiting_payment' and v_hold_expires_at is not null then
    if v_hold_expires_at <= now() then
      raise exception 'stock_hold_expired';
    end if;
    return 0;
  end if;

  return private.reserve_preorder_order_stock_base(p_order_id);
end;
$$;

create function private.expire_preorder_stock_hold(p_order_id uuid)
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
    o.id,
    o.event_id,
    e.artist_id,
    op.id as payment_id,
    op.payment_status,
    op.stock_hold_expires_at,
    op.slip_url
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  join public.order_payments op on op.order_id = o.id
  where o.id = p_order_id
    and o.order_type = 'preorder'
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

  perform public.append_payment_review_event(
    v_order.id,
    v_order.payment_id,
    v_order.event_id,
    v_order.artist_id,
    'payment_expired',
    'awaiting_payment',
    'payment_expired',
    v_order.slip_url,
    'stock_hold_expired'
  );
  perform public.append_payment_review_event(
    v_order.id,
    v_order.payment_id,
    v_order.event_id,
    v_order.artist_id,
    'stock_released',
    'awaiting_payment',
    'payment_expired',
    v_order.slip_url,
    'stock_hold_expired',
    jsonb_build_object('quantity', v_released)
  );

  return query select true, v_released;
end;
$$;

create function private.expire_preorder_stock_holds()
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
    where o.order_type = 'preorder'
      and op.payment_status = 'awaiting_payment'
      and op.stock_hold_expires_at is not null
      and op.stock_hold_expires_at <= now()
    for update of o, op skip locked
  loop
    select * into v_result
    from private.expire_preorder_stock_hold(v_order_id);

    if coalesce(v_result.expired, false) then
      v_expired_count := v_expired_count + 1;
      v_released_count := v_released_count + coalesce(v_result.released_stock_count, 0);
    end if;
  end loop;

  return query select v_expired_count, v_released_count;
end;
$$;

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
  p_shipping_address text default ''
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
  v_artist_id uuid;
  v_payment_id uuid;
  v_payment_status text;
  v_hold_expires_at timestamptz;
  v_reserved integer := 0;
begin
  select * into v_result
  from private.create_preorder_with_stock_base(
    p_event_id,
    p_items,
    p_customer_name,
    p_customer_contact,
    p_customer_note,
    p_client_request_id,
    p_customer_phone,
    p_customer_social,
    p_customer_email,
    p_shipping_address
  );

  select o.order_type, e.artist_id, op.id, op.payment_status, op.stock_hold_expires_at
  into v_order_type, v_artist_id, v_payment_id, v_payment_status, v_hold_expires_at
  from public.orders o
  join public.events e on e.id = o.event_id
  join public.order_payments op on op.order_id = o.id
  where o.id = v_result.order_id
  for update of op;

  if v_order_type = 'preorder'
     and v_payment_status = 'awaiting_payment'
     and v_hold_expires_at is null then
    v_reserved := public.reserve_preorder_order_stock(v_result.order_id);
    v_hold_expires_at := now() + interval '15 minutes';

    update public.order_payments
    set stock_hold_expires_at = v_hold_expires_at,
        updated_at = now()
    where id = v_payment_id;

    perform public.append_payment_review_event(
      v_result.order_id,
      v_payment_id,
      p_event_id,
      v_artist_id,
      'stock_reserved',
      'awaiting_payment',
      'awaiting_payment',
      null,
      null,
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
    case
      when v_order_type = 'preorder' then least(v_result.payment_deadline_at, v_hold_expires_at)
      else v_result.payment_deadline_at
    end;
end;
$$;

create function public.submit_preorder_payment_evidence(
  p_order_id uuid,
  p_pickup_code text,
  p_slip_url text,
  p_client_request_id uuid default null
)
returns table (
  order_id uuid,
  payment_status text,
  stock_reserved integer,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_status text;
  v_hold_expires_at timestamptz;
begin
  select op.payment_status, op.stock_hold_expires_at
  into v_payment_status, v_hold_expires_at
  from public.orders o
  join public.order_payments op on op.order_id = o.id
  where o.id = p_order_id
    and o.pickup_code = upper(trim(p_pickup_code))
    and o.order_type in ('preorder', 'post_event')
  for update of o, op;

  if v_payment_status = 'awaiting_payment'
     and v_hold_expires_at is not null
     and v_hold_expires_at <= now() then
    perform private.expire_preorder_stock_hold(p_order_id);
    return query select p_order_id, 'payment_expired'::text, 0, now();
    return;
  end if;

  return query
  select * from private.submit_preorder_payment_evidence_base(
    p_order_id,
    p_pickup_code,
    p_slip_url,
    p_client_request_id
  );
end;
$$;

create function public.cancel_public_preorder_before_payment(
  p_order_id uuid,
  p_pickup_code text
)
returns table (
  order_id uuid,
  pickup_status text,
  status text,
  cancelled_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_released integer := 0;
  v_result record;
begin
  select
    o.event_id,
    e.artist_id,
    op.id as payment_id,
    op.payment_status,
    op.stock_hold_expires_at,
    op.slip_url
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  join public.order_payments op on op.order_id = o.id
  where o.id = p_order_id
    and o.pickup_code = upper(trim(p_pickup_code))
    and o.order_type in ('preorder', 'post_event')
  for update of o, op;

  if v_order.payment_status = 'awaiting_payment'
     and v_order.stock_hold_expires_at is not null then
    v_released := public.release_preorder_order_stock(p_order_id);
  end if;

  select * into v_result
  from private.cancel_public_preorder_before_payment_base(p_order_id, p_pickup_code);

  if v_released > 0 then
    perform public.append_payment_review_event(
      p_order_id,
      v_order.payment_id,
      v_order.event_id,
      v_order.artist_id,
      'stock_released',
      'awaiting_payment',
      'payment_cancelled',
      v_order.slip_url,
      'customer_cancelled_before_payment',
      jsonb_build_object('quantity', v_released)
    );
  end if;

  return query select v_result.order_id, v_result.pickup_status, v_result.status, v_result.cancelled_at;
end;
$$;

create function public.get_public_preorder_by_code(
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
  select o.id
  into v_order_id
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
      when result.order_type = 'preorder' and result.payment_status = 'awaiting_payment'
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

revoke all on function public.reserve_preorder_order_stock(uuid) from public, anon, authenticated;
grant execute on function public.reserve_preorder_order_stock(uuid) to service_role;

revoke all on function private.expire_preorder_stock_hold(uuid) from public, anon, authenticated;
revoke all on function private.expire_preorder_stock_holds() from public, anon, authenticated;

revoke all on function public.create_preorder_with_stock(uuid, jsonb, text, text, text, uuid, text, text, text, text) from public;
grant execute on function public.create_preorder_with_stock(uuid, jsonb, text, text, text, uuid, text, text, text, text) to anon, authenticated;

revoke all on function public.submit_preorder_payment_evidence(uuid, text, text, uuid) from public;
grant execute on function public.submit_preorder_payment_evidence(uuid, text, text, uuid) to anon, authenticated;

revoke all on function public.cancel_public_preorder_before_payment(uuid, text) from public;
grant execute on function public.cancel_public_preorder_before_payment(uuid, text) to anon, authenticated;

revoke all on function public.get_public_preorder_by_code(text, text) from public;
grant execute on function public.get_public_preorder_by_code(text, text) to anon, authenticated;

create extension if not exists pg_cron;

select cron.schedule(
  'expire-preorder-stock-holds',
  '* * * * *',
  'select * from private.expire_preorder_stock_holds()'
);
