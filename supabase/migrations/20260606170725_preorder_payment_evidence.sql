-- Pre-order payment evidence and production planning.
-- Money still flows customer -> seller. NireQ stores workflow state/evidence only.

alter table public.orders
  add column if not exists customer_phone text,
  add column if not exists customer_social text,
  add column if not exists customer_email text;

alter table public.orders
  drop constraint if exists orders_preorder_customer_contact_check;

alter table public.orders
  add constraint orders_preorder_customer_contact_check
  check (
    order_type <> 'preorder'
    or length(trim(coalesce(customer_phone, ''))) > 0
    or length(trim(coalesce(customer_social, ''))) > 0
    or length(trim(coalesce(customer_email, ''))) > 0
    or length(trim(coalesce(customer_contact, ''))) > 0
  );

create table if not exists public.event_payment_methods (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  method_type text not null check (method_type in ('promptpay', 'bank_transfer', 'qr_image', 'other')),
  display_name text,
  account_name text,
  account_number text,
  bank_name text,
  promptpay_id text,
  qr_image_url text,
  instructions text,
  payment_deadline_at timestamptz,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_event_payment_methods_event_enabled
  on public.event_payment_methods (event_id, is_enabled, payment_deadline_at);

alter table public.event_payment_methods enable row level security;

drop policy if exists "event_payment_methods_public_read" on public.event_payment_methods;
drop policy if exists "event_payment_methods_staff_read" on public.event_payment_methods;
drop policy if exists "event_payment_methods_manager_write" on public.event_payment_methods;

create policy "event_payment_methods_public_read"
  on public.event_payment_methods
  for select
  to anon, authenticated
  using (
    is_enabled = true
    and exists (
      select 1
      from public.events e
      join public.artists a on a.id = e.artist_id
      where e.id = event_payment_methods.event_id
        and e.artist_id = event_payment_methods.artist_id
        and e.status in ('Confirmed', 'confirmed')
        and coalesce(e.selling_mode, 'live') = 'preorder'
        and a.is_public = true
        and a.is_verified = true
        and a.published_at is not null
    )
  );

create policy "event_payment_methods_staff_read"
  on public.event_payment_methods
  for select
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager', 'seller']));

create policy "event_payment_methods_manager_write"
  on public.event_payment_methods
  for all
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager']))
  with check (public.has_artist_role(artist_id, array['owner', 'manager']));

grant select on public.event_payment_methods to anon, authenticated;
grant insert, update, delete on public.event_payment_methods to authenticated;

create table if not exists public.order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade unique,
  event_id uuid not null references public.events(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  payment_status text not null check (payment_status in ('awaiting_payment', 'payment_submitted', 'payment_confirmed', 'payment_rejected', 'payment_expired', 'payment_cancelled')),
  amount_expected numeric not null default 0 check (amount_expected >= 0),
  currency text not null default 'THB',
  slip_url text,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid,
  rejected_at timestamptz,
  rejected_by uuid,
  expired_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_payments_confirmed_at_check check (payment_status = 'payment_confirmed' or confirmed_at is null),
  constraint order_payments_rejected_at_check check (payment_status = 'payment_rejected' or rejected_at is null),
  constraint order_payments_expired_at_check check (payment_status = 'payment_expired' or expired_at is null)
);

create index if not exists idx_order_payments_event_status
  on public.order_payments (event_id, payment_status, submitted_at desc);

alter table public.order_payments enable row level security;

drop policy if exists "order_payments_staff_read" on public.order_payments;

create policy "order_payments_staff_read"
  on public.order_payments
  for select
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager', 'seller']));

grant select on public.order_payments to authenticated;
revoke all on public.order_payments from anon;

create table if not exists public.payment_review_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_payment_id uuid references public.order_payments(id) on delete set null,
  event_id uuid not null references public.events(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'evidence_submitted', 'evidence_resubmitted', 'payment_confirmed', 'payment_rejected', 'payment_expired', 'stock_reserved', 'stock_released', 'payment_cancelled')),
  from_status text,
  to_status text,
  slip_url text,
  actor_user_id uuid,
  actor_role text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_payment_review_events_order_created
  on public.payment_review_events (order_id, created_at desc);

create index if not exists idx_payment_review_events_event_created
  on public.payment_review_events (event_id, created_at desc);

alter table public.payment_review_events enable row level security;

drop policy if exists "payment_review_events_staff_read" on public.payment_review_events;

create policy "payment_review_events_staff_read"
  on public.payment_review_events
  for select
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager', 'seller']));

grant select on public.payment_review_events to authenticated;
revoke all on public.payment_review_events from anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'PaymentEvidence',
  'PaymentEvidence',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = now();

drop policy if exists "payment_evidence_staff_read" on storage.objects;
drop policy if exists "payment_evidence_customer_insert" on storage.objects;
drop policy if exists "payment_evidence_owner_update" on storage.objects;
drop policy if exists "payment_evidence_owner_delete" on storage.objects;

-- Customers are anonymous in the current public menu. Direct reads remain blocked;
-- uploads are accepted into a private bucket and tied to an order by RPC.
create policy "payment_evidence_customer_insert"
  on storage.objects
  for insert
  to anon, authenticated
  with check (bucket_id = 'PaymentEvidence');

create policy "payment_evidence_staff_read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'PaymentEvidence'
    and exists (
      select 1
      from public.order_payments op
      where op.slip_url = storage.objects.name
        and public.has_artist_role(op.artist_id, array['owner', 'manager', 'seller'])
    )
  );

-- Keep direct order exposure tight after adding structured contact columns.
revoke select on table public.orders from anon, authenticated;

grant select (
  id,
  created_at,
  event_id,
  queue_id,
  status,
  total_price,
  payment_method,
  currency,
  subtotal_price,
  discount_total,
  pricing_breakdown,
  order_type,
  pickup_status,
  pickup_code
) on public.orders to anon, authenticated;

create or replace function public.append_payment_review_event(
  p_order_id uuid,
  p_order_payment_id uuid,
  p_event_id uuid,
  p_artist_id uuid,
  p_event_type text,
  p_from_status text default null,
  p_to_status text default null,
  p_slip_url text default null,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_email text;
begin
  v_email := lower(coalesce((auth.jwt() ->> 'email'), ''));

  select m.role
  into v_actor_role
  from public.artist_members m
  where m.artist_id = p_artist_id
    and m.status = 'active'
    and lower(m.member_email) = v_email
  limit 1;

  insert into public.payment_review_events (
    order_id,
    order_payment_id,
    event_id,
    artist_id,
    event_type,
    from_status,
    to_status,
    slip_url,
    actor_user_id,
    actor_role,
    note,
    metadata
  )
  values (
    p_order_id,
    p_order_payment_id,
    p_event_id,
    p_artist_id,
    p_event_type,
    p_from_status,
    p_to_status,
    p_slip_url,
    auth.uid(),
    v_actor_role,
    nullif(trim(coalesce(p_note, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

create or replace function public.reserve_preorder_order_stock(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_item record;
  v_available integer;
  v_reserved integer := 0;
begin
  select o.*, e.artist_id
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  for v_item in
    select
      oi.product_id,
      oi.event_product_id,
      oi.quantity,
      p.is_unlimited as product_unlimited,
      p.stock_total as product_stock_total,
      p.stock_reserved as product_stock_reserved,
      p.stock_sold as product_stock_sold,
      ep.is_unlimited as event_unlimited,
      ep.stock_total as event_stock_total,
      ep.stock_reserved as event_stock_reserved,
      ep.stock_sold as event_stock_sold
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    left join public.event_products ep on ep.id = oi.event_product_id
    where oi.order_id = v_order.id
    for update of p
  loop
    if v_item.event_product_id is not null then
      if not coalesce(v_item.event_unlimited, true) then
        v_available := coalesce(v_item.event_stock_total, 0)
          - coalesce(v_item.event_stock_reserved, 0)
          - coalesce(v_item.event_stock_sold, 0);

        if v_available < v_item.quantity then
          raise exception 'insufficient_stock';
        end if;

        update public.event_products
        set stock_reserved = stock_reserved + v_item.quantity
        where id = v_item.event_product_id;

        v_reserved := v_reserved + v_item.quantity;
      end if;
    elsif not coalesce(v_item.product_unlimited, true) then
      v_available := coalesce(v_item.product_stock_total, 0)
        - coalesce(v_item.product_stock_reserved, 0)
        - coalesce(v_item.product_stock_sold, 0);

      if v_available < v_item.quantity then
        raise exception 'insufficient_stock';
      end if;

      update public.products
      set stock_reserved = stock_reserved + v_item.quantity,
          updated_at = now()
      where id = v_item.product_id;

      v_reserved := v_reserved + v_item.quantity;
    end if;
  end loop;

  return v_reserved;
end;
$$;

create or replace function public.release_preorder_order_stock(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_item record;
  v_released integer := 0;
begin
  select o.*, e.artist_id
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  for v_item in
    select
      oi.product_id,
      oi.event_product_id,
      oi.quantity,
      p.is_unlimited as product_unlimited,
      ep.is_unlimited as event_unlimited
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    left join public.event_products ep on ep.id = oi.event_product_id
    where oi.order_id = v_order.id
    for update of p
  loop
    if v_item.event_product_id is not null then
      if not coalesce(v_item.event_unlimited, true) then
        update public.event_products
        set stock_reserved = greatest(stock_reserved - v_item.quantity, 0)
        where id = v_item.event_product_id;
        v_released := v_released + v_item.quantity;
      end if;
    elsif not coalesce(v_item.product_unlimited, true) then
      update public.products
      set stock_reserved = greatest(stock_reserved - v_item.quantity, 0),
          updated_at = now()
      where id = v_item.product_id;
      v_released := v_released + v_item.quantity;
    end if;
  end loop;

  return v_released;
end;
$$;

drop function if exists public.create_preorder_with_stock(uuid, jsonb, text, text, text, uuid);

create or replace function public.create_preorder_with_stock(
  p_event_id uuid,
  p_items jsonb,
  p_customer_name text,
  p_customer_contact text default '',
  p_customer_note text default '',
  p_client_request_id uuid default null,
  p_customer_phone text default '',
  p_customer_social text default '',
  p_customer_email text default ''
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
set search_path = public
as $$
declare
  v_event record;
  v_existing_order record;
  v_existing_payment record;
  v_item jsonb;
  v_order_id uuid;
  v_payment_id uuid;
  v_pickup_code text;
  v_product record;
  v_qty integer;
  v_total numeric := 0;
  v_currency text;
  v_effective_currency text;
  v_available integer;
  v_has_catalog boolean := false;
  v_payment_methods jsonb;
  v_payment_deadline timestamptz;
  v_contact_display text;
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

  if lower(trim(coalesce(p_customer_email, ''))) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'customer_email_invalid';
  end if;

  if length(trim(coalesce(p_customer_phone, ''))) = 0
     and length(trim(coalesce(p_customer_social, ''))) = 0
     and length(trim(coalesce(p_customer_email, ''))) = 0
     and length(trim(coalesce(p_customer_contact, ''))) = 0 then
    raise exception 'customer_contact_required';
  end if;

  select e.*, a.is_public, a.is_verified
  into v_event
  from public.events e
  join public.artists a on a.id = e.artist_id
  where e.id = p_event_id
  for update;

  if v_event.id is null then
    raise exception 'event_not_found';
  end if;

  if v_event.status not in ('Confirmed', 'confirmed') then
    raise exception 'event_not_confirmed';
  end if;

  if coalesce(v_event.is_public, false) is not true or coalesce(v_event.is_verified, false) is not true then
    raise exception 'artist_not_public';
  end if;

  if coalesce(v_event.selling_mode, 'live') <> 'preorder' then
    raise exception 'preorder_not_open';
  end if;

  if v_event.preorder_opens_at is not null and now() < v_event.preorder_opens_at then
    raise exception 'preorder_not_open_yet';
  end if;

  if v_event.preorder_closes_at is not null and now() > v_event.preorder_closes_at then
    raise exception 'preorder_closed';
  end if;

  if v_event.end_date < now() then
    raise exception 'event_ended';
  end if;

  if p_client_request_id is not null then
    select o.*
    into v_existing_order
    from public.orders o
    where o.payment_idempotency_key = p_client_request_id
    for update;

    if v_existing_order.id is not null then
      if v_existing_order.event_id = p_event_id and v_existing_order.order_type = 'preorder' then
        select op.* into v_existing_payment from public.order_payments op where op.order_id = v_existing_order.id;
        select coalesce(jsonb_agg(to_jsonb(epm) - 'artist_id' - 'created_at' - 'updated_at'), '[]'::jsonb),
               min(epm.payment_deadline_at)
        into v_payment_methods, v_payment_deadline
        from public.event_payment_methods epm
        where epm.event_id = p_event_id
          and epm.is_enabled = true;

        return query
        select
          v_existing_order.id,
          v_existing_order.pickup_code,
          v_existing_order.total_price,
          v_existing_order.currency,
          coalesce(v_event.preorder_pickup_instructions, ''),
          coalesce(v_existing_payment.payment_status, 'awaiting_payment'),
          coalesce(v_payment_methods, '[]'::jsonb),
          v_payment_deadline;
        return;
      end if;
      raise exception 'client_request_id_conflict';
    end if;
  end if;

  select exists (select 1 from public.event_products ep where ep.event_id = p_event_id)
  into v_has_catalog;

  v_pickup_code := public.generate_pickup_code(p_event_id);
  v_contact_display := nullif(trim(coalesce(p_customer_contact, '')), '');
  if v_contact_display is null then
    v_contact_display := concat_ws(' · ',
      nullif(trim(coalesce(p_customer_phone, '')), ''),
      nullif(trim(coalesce(p_customer_social, '')), ''),
      nullif(trim(coalesce(p_customer_email, '')), '')
    );
  end if;

  insert into public.orders (
    event_id,
    queue_id,
    status,
    total_price,
    subtotal_price,
    currency,
    payment_method,
    payment_idempotency_key,
    order_type,
    pickup_code,
    customer_name,
    customer_contact,
    customer_phone,
    customer_social,
    customer_email,
    customer_note,
    pickup_status
  )
  values (
    p_event_id,
    null,
    'draft',
    0,
    0,
    coalesce(v_event.currency_override, 'THB'),
    null,
    p_client_request_id,
    'preorder',
    v_pickup_code,
    trim(p_customer_name),
    v_contact_display,
    nullif(trim(coalesce(p_customer_phone, '')), ''),
    nullif(trim(coalesce(p_customer_social, '')), ''),
    lower(trim(p_customer_email)),
    nullif(trim(coalesce(p_customer_note, '')), ''),
    'not_required'
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::integer, 1));

    select
      p.*,
      ep.id as event_product_id,
      coalesce(ep.price_override, p.price) as effective_price,
      case when ep.id is not null then ep.is_unlimited else p.is_unlimited end as effective_is_unlimited,
      case when ep.id is not null then ep.stock_total else p.stock_total end as effective_stock_total,
      case when ep.id is not null then ep.stock_reserved else p.stock_reserved end as effective_stock_reserved,
      case when ep.id is not null then ep.stock_sold else p.stock_sold end as effective_stock_sold
    into v_product
    from public.products p
    left join public.event_products ep
      on ep.product_id = p.id
     and ep.event_id = p_event_id
    where p.id = (v_item ->> 'product_id')::uuid
      and p.artist_id = v_event.artist_id
      and p.deleted_at is null
      and p.status = 'enable'
      and (not v_has_catalog or (ep.id is not null and ep.is_enabled = true))
    for update of p;

    if v_product.id is null then
      raise exception 'invalid_product';
    end if;

    v_effective_currency := coalesce(v_event.currency_override, v_product.currency, 'THB');

    if v_currency is null then
      v_currency := v_effective_currency;
    elsif v_currency <> v_effective_currency then
      raise exception 'mixed_currency_not_allowed';
    end if;

    insert into public.order_items (order_id, product_id, event_product_id, quantity, price_per_unit, notes, currency)
    values (
      v_order_id,
      v_product.id,
      v_product.event_product_id,
      v_qty,
      v_product.effective_price,
      coalesce(v_item ->> 'notes', ''),
      v_effective_currency
    );

    v_total := v_total + (v_product.effective_price * v_qty);
  end loop;

  update public.orders
  set total_price = v_total,
      subtotal_price = v_total,
      currency = coalesce(v_currency, 'THB')
  where id = v_order_id;

  insert into public.order_payments (
    order_id,
    event_id,
    artist_id,
    payment_status,
    amount_expected,
    currency
  )
  values (
    v_order_id,
    p_event_id,
    v_event.artist_id,
    'awaiting_payment',
    v_total,
    coalesce(v_currency, 'THB')
  )
  returning id into v_payment_id;

  perform public.append_payment_review_event(
    v_order_id,
    v_payment_id,
    p_event_id,
    v_event.artist_id,
    'created',
    null,
    'awaiting_payment'
  );

  select coalesce(jsonb_agg(to_jsonb(epm) - 'artist_id' - 'created_at' - 'updated_at'), '[]'::jsonb),
         min(epm.payment_deadline_at)
  into v_payment_methods, v_payment_deadline
  from public.event_payment_methods epm
  where epm.event_id = p_event_id
    and epm.is_enabled = true;

  return query
  select
    v_order_id,
    v_pickup_code,
    v_total,
    coalesce(v_currency, 'THB'),
    coalesce(v_event.preorder_pickup_instructions, ''),
    'awaiting_payment'::text,
    coalesce(v_payment_methods, '[]'::jsonb),
    v_payment_deadline;
exception
  when unique_violation then
    raise exception 'preorder_unique_conflict';
end;
$$;

create or replace function public.cancel_public_preorder_before_payment(
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
set search_path = public
as $$
declare
  v_order record;
  v_payment record;
  v_now timestamptz := now();
begin
  select o.*, e.artist_id
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
    and o.pickup_code = upper(trim(p_pickup_code))
    and o.order_type = 'preorder'
  for update;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  select op.*
  into v_payment
  from public.order_payments op
  where op.order_id = v_order.id
  for update;

  if v_payment.id is null then
    raise exception 'payment_record_not_found';
  end if;

  if v_order.pickup_status = 'picked_up' or v_order.status = 'completed' then
    raise exception 'order_not_cancellable';
  end if;

  if v_payment.payment_status = 'payment_cancelled' or v_order.status = 'cancelled' then
    return query select v_order.id, 'cancelled'::text, 'cancelled'::text, coalesce(v_order.cancelled_at, v_now);
    return;
  end if;

  if v_payment.payment_status <> 'awaiting_payment' then
    raise exception 'order_not_cancellable';
  end if;

  update public.order_payments
  set payment_status = 'payment_cancelled',
      review_note = 'customer_cancelled_before_payment',
      updated_at = v_now
  where id = v_payment.id;

  update public.orders
  set status = 'cancelled',
      pickup_status = 'cancelled',
      cancelled_at = v_now,
      cancelled_by = null,
      cancel_reason = 'customer_cancelled_before_payment'
  where id = v_order.id;

  perform public.append_payment_review_event(
    v_order.id,
    v_payment.id,
    v_order.event_id,
    v_order.artist_id,
    'payment_cancelled',
    v_payment.payment_status,
    'payment_cancelled',
    v_payment.slip_url,
    'customer_cancelled_before_payment'
  );

  return query select v_order.id, 'cancelled'::text, 'cancelled'::text, v_now;
end;
$$;

create or replace function public.submit_preorder_payment_evidence(
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
set search_path = public
as $$
declare
  v_order record;
  v_payment record;
  v_now timestamptz := now();
  v_reserved integer := 0;
  v_from_status text;
  v_event_type text;
begin
  if length(trim(coalesce(p_slip_url, ''))) = 0 then
    raise exception 'payment_evidence_required';
  end if;

  select o.*, e.artist_id
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
    and o.pickup_code = upper(trim(p_pickup_code))
    and o.order_type = 'preorder'
  for update;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  select op.*
  into v_payment
  from public.order_payments op
  where op.order_id = v_order.id
  for update;

  if v_payment.id is null then
    raise exception 'payment_record_not_found';
  end if;

  if v_payment.payment_status = 'payment_submitted' then
    raise exception 'payment_already_submitted';
  end if;

  if v_payment.payment_status = 'payment_confirmed' then
    raise exception 'payment_already_confirmed';
  end if;

  if v_payment.payment_status not in ('awaiting_payment', 'payment_rejected', 'payment_expired') then
    raise exception 'payment_not_submittable';
  end if;

  v_from_status := v_payment.payment_status;
  v_reserved := public.reserve_preorder_order_stock(v_order.id);
  v_event_type := case when v_from_status in ('payment_rejected', 'payment_expired') then 'evidence_resubmitted' else 'evidence_submitted' end;

  update public.order_payments
  set payment_status = 'payment_submitted',
      slip_url = trim(p_slip_url),
      submitted_at = v_now,
      confirmed_at = null,
      confirmed_by = null,
      rejected_at = null,
      rejected_by = null,
      expired_at = null,
      review_note = null,
      updated_at = v_now
  where id = v_payment.id;

  update public.orders
  set status = 'draft',
      pickup_status = 'not_required',
      cancelled_at = null,
      cancelled_by = null,
      cancel_reason = null
  where id = v_order.id;

  perform public.append_payment_review_event(v_order.id, v_payment.id, v_order.event_id, v_order.artist_id, v_event_type, v_from_status, 'payment_submitted', trim(p_slip_url));
  perform public.append_payment_review_event(v_order.id, v_payment.id, v_order.event_id, v_order.artist_id, 'stock_reserved', v_from_status, 'payment_submitted', trim(p_slip_url), null, jsonb_build_object('quantity', v_reserved));

  return query select v_order.id, 'payment_submitted'::text, v_reserved, v_now;
end;
$$;

create or replace function public.confirm_preorder_payment(
  p_order_id uuid,
  p_note text default ''
)
returns table (
  order_id uuid,
  payment_status text,
  pickup_status text,
  confirmed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_payment record;
  v_now timestamptz := now();
begin
  select o.*, e.artist_id
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  if not public.has_event_role(v_order.event_id, array['owner', 'manager', 'seller']) then
    raise exception 'forbidden';
  end if;

  select op.*
  into v_payment
  from public.order_payments op
  where op.order_id = v_order.id
  for update;

  if v_payment.payment_status <> 'payment_submitted' then
    raise exception 'payment_not_submitted';
  end if;

  update public.order_payments
  set payment_status = 'payment_confirmed',
      confirmed_at = v_now,
      confirmed_by = auth.uid(),
      review_note = nullif(trim(coalesce(p_note, '')), ''),
      updated_at = v_now
  where id = v_payment.id;

  update public.orders
  set status = 'confirmed',
      pickup_status = 'awaiting_pickup'
  where id = v_order.id;

  perform public.append_payment_review_event(v_order.id, v_payment.id, v_order.event_id, v_order.artist_id, 'payment_confirmed', 'payment_submitted', 'payment_confirmed', v_payment.slip_url, p_note);

  return query select v_order.id, 'payment_confirmed'::text, 'awaiting_pickup'::text, v_now;
end;
$$;

create or replace function public.reject_preorder_payment(
  p_order_id uuid,
  p_note text default ''
)
returns table (
  order_id uuid,
  payment_status text,
  pickup_status text,
  rejected_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_payment record;
  v_now timestamptz := now();
  v_released integer := 0;
begin
  if length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'reject_note_required';
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

  if not public.has_event_role(v_order.event_id, array['owner', 'manager', 'seller']) then
    raise exception 'forbidden';
  end if;

  select op.*
  into v_payment
  from public.order_payments op
  where op.order_id = v_order.id
  for update;

  if v_payment.payment_status = 'payment_rejected' then
    return query select v_order.id, 'payment_rejected'::text, 'cancelled'::text, coalesce(v_payment.rejected_at, v_now);
    return;
  end if;

  if v_payment.payment_status <> 'payment_submitted' then
    raise exception 'payment_not_submitted';
  end if;

  v_released := public.release_preorder_order_stock(v_order.id);

  update public.order_payments
  set payment_status = 'payment_rejected',
      rejected_at = v_now,
      rejected_by = auth.uid(),
      review_note = nullif(trim(coalesce(p_note, '')), ''),
      updated_at = v_now
  where id = v_payment.id;

  update public.orders
  set status = 'cancelled',
      pickup_status = 'cancelled',
      cancelled_at = v_now,
      cancelled_by = auth.uid(),
      cancel_reason = coalesce(nullif(trim(coalesce(p_note, '')), ''), 'payment_rejected')
  where id = v_order.id;

  perform public.append_payment_review_event(v_order.id, v_payment.id, v_order.event_id, v_order.artist_id, 'payment_rejected', 'payment_submitted', 'payment_rejected', v_payment.slip_url, p_note);
  perform public.append_payment_review_event(v_order.id, v_payment.id, v_order.event_id, v_order.artist_id, 'stock_released', 'payment_submitted', 'payment_rejected', v_payment.slip_url, p_note, jsonb_build_object('quantity', v_released));

  return query select v_order.id, 'payment_rejected'::text, 'cancelled'::text, v_now;
end;
$$;

create or replace function public.expire_submitted_preorder_payments(
  p_event_id uuid,
  p_grace_hours integer default 24
)
returns table (
  expired_count integer,
  released_stock_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_order record;
  v_deadline timestamptz;
  v_released integer;
  v_expired_count integer := 0;
  v_released_total integer := 0;
  v_grace interval := make_interval(hours => greatest(coalesce(p_grace_hours, 24), 0));
begin
  select e.*
  into v_event
  from public.events e
  where e.id = p_event_id
  for update;

  if v_event.id is null then
    raise exception 'event_not_found';
  end if;

  if not public.has_event_role(p_event_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;

  for v_order in
    select o.*, op.id as payment_id, op.payment_status, op.slip_url, op.submitted_at, op.event_id as payment_event_id, op.artist_id as payment_artist_id
    from public.orders o
    join public.order_payments op on op.order_id = o.id
    where o.event_id = p_event_id
      and o.order_type = 'preorder'
      and op.payment_status = 'payment_submitted'
    for update of o, op
  loop
    select coalesce(
      (select min(epm.payment_deadline_at)
       from public.event_payment_methods epm
       where epm.event_id = p_event_id
         and epm.is_enabled = true
         and epm.payment_deadline_at is not null),
      v_event.preorder_closes_at,
      v_order.submitted_at
    )
    into v_deadline;

    if v_deadline + v_grace > now() then
      continue;
    end if;

    v_released := public.release_preorder_order_stock(v_order.id);

    update public.order_payments
    set payment_status = 'payment_expired',
        expired_at = now(),
        updated_at = now()
    where id = v_order.payment_id;

    update public.orders
    set status = 'cancelled',
        pickup_status = 'expired',
        cancelled_at = now(),
        cancelled_by = auth.uid(),
        cancel_reason = 'payment_submitted_expired'
    where id = v_order.id;

    perform public.append_payment_review_event(v_order.id, v_order.payment_id, p_event_id, v_order.payment_artist_id, 'payment_expired', 'payment_submitted', 'payment_expired', v_order.slip_url);
    perform public.append_payment_review_event(v_order.id, v_order.payment_id, p_event_id, v_order.payment_artist_id, 'stock_released', 'payment_submitted', 'payment_expired', v_order.slip_url, null, jsonb_build_object('quantity', v_released));

    v_expired_count := v_expired_count + 1;
    v_released_total := v_released_total + v_released;
  end loop;

  return query select v_expired_count, v_released_total;
end;
$$;

create or replace function public.mark_preorder_picked_up(p_order_id uuid)
returns table (
  order_id uuid,
  pickup_status text,
  status text,
  picked_up_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_payment record;
  v_item record;
  v_now timestamptz := now();
begin
  select o.*, e.artist_id
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  if not public.has_event_role(v_order.event_id, array['owner', 'manager', 'seller', 'queue_staff']) then
    raise exception 'forbidden';
  end if;

  if v_order.order_type <> 'preorder' then
    raise exception 'order_not_preorder';
  end if;

  select op.*
  into v_payment
  from public.order_payments op
  where op.order_id = v_order.id
  for update;

  if coalesce(v_payment.payment_status, '') <> 'payment_confirmed' then
    raise exception 'payment_not_confirmed';
  end if;

  if v_order.status <> 'confirmed' or v_order.pickup_status <> 'awaiting_pickup' then
    raise exception 'order_not_pickup_ready';
  end if;

  for v_item in
    select
      oi.product_id,
      oi.event_product_id,
      oi.quantity,
      p.is_unlimited as product_unlimited,
      ep.is_unlimited as event_unlimited
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    left join public.event_products ep on ep.id = oi.event_product_id
    where oi.order_id = v_order.id
    for update of p
  loop
    if v_item.event_product_id is not null then
      if not coalesce(v_item.event_unlimited, true) then
        update public.event_products
        set stock_reserved = greatest(stock_reserved - v_item.quantity, 0),
            stock_sold = stock_sold + v_item.quantity
        where id = v_item.event_product_id;
      end if;
    elsif not coalesce(v_item.product_unlimited, true) then
      update public.products
      set stock_reserved = greatest(stock_reserved - v_item.quantity, 0),
          stock_sold = stock_sold + v_item.quantity,
          updated_at = now()
      where id = v_item.product_id;
    end if;
  end loop;

  update public.orders
  set status = 'completed',
      pickup_status = 'picked_up',
      picked_up_at = v_now,
      picked_up_by = auth.uid()
  where id = v_order.id;

  return query
  select v_order.id, 'picked_up'::text, 'completed'::text, v_now;
end;
$$;

create or replace function public.cancel_preorder_with_stock(
  p_order_id uuid,
  p_reason text default ''
)
returns table (
  order_id uuid,
  pickup_status text,
  status text,
  cancelled_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_payment record;
  v_now timestamptz := now();
  v_released integer := 0;
begin
  select o.*, e.artist_id
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  if not public.has_event_role(v_order.event_id, array['owner', 'manager', 'seller']) then
    raise exception 'forbidden';
  end if;

  if v_order.order_type <> 'preorder' then
    raise exception 'order_not_preorder';
  end if;

  if v_order.pickup_status = 'picked_up' or v_order.status = 'completed' then
    raise exception 'order_not_cancellable';
  end if;

  select op.*
  into v_payment
  from public.order_payments op
  where op.order_id = v_order.id
  for update;

  if v_payment.payment_status in ('payment_submitted', 'payment_confirmed') then
    v_released := public.release_preorder_order_stock(v_order.id);
  end if;

  if v_payment.id is not null then
    update public.order_payments
    set payment_status = case
          when payment_status = 'payment_confirmed' then 'payment_rejected'
          when payment_status = 'payment_submitted' then 'payment_rejected'
          else payment_status
        end,
        rejected_at = case when payment_status in ('payment_submitted', 'payment_confirmed') then v_now else rejected_at end,
        rejected_by = case when payment_status in ('payment_submitted', 'payment_confirmed') then auth.uid() else rejected_by end,
        confirmed_at = case when payment_status in ('payment_submitted', 'payment_confirmed') then null else confirmed_at end,
        confirmed_by = case when payment_status in ('payment_submitted', 'payment_confirmed') then null else confirmed_by end,
        expired_at = null,
        review_note = nullif(trim(coalesce(p_reason, '')), ''),
        updated_at = v_now
    where id = v_payment.id;

    perform public.append_payment_review_event(v_order.id, v_payment.id, v_order.event_id, v_order.artist_id, 'payment_cancelled', v_payment.payment_status, 'cancelled', v_payment.slip_url, p_reason);
    if v_released > 0 then
      perform public.append_payment_review_event(v_order.id, v_payment.id, v_order.event_id, v_order.artist_id, 'stock_released', v_payment.payment_status, 'cancelled', v_payment.slip_url, p_reason, jsonb_build_object('quantity', v_released));
    end if;
  end if;

  update public.orders
  set status = 'cancelled',
      pickup_status = 'cancelled',
      cancelled_at = v_now,
      cancelled_by = auth.uid(),
      cancel_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = v_order.id;

  return query
  select v_order.id, 'cancelled'::text, 'cancelled'::text, v_now;
end;
$$;

create or replace function public.expire_preorders_for_event(p_event_id uuid)
returns table (
  expired_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_order record;
  v_payment record;
  v_released integer;
  v_count integer := 0;
begin
  select e.*
  into v_event
  from public.events e
  where e.id = p_event_id
  for update;

  if v_event.id is null then
    raise exception 'event_not_found';
  end if;

  if not public.has_event_role(p_event_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;

  if v_event.end_date >= now() and coalesce(v_event.selling_mode, 'live') <> 'closed' then
    raise exception 'event_not_ready_to_expire_preorders';
  end if;

  for v_order in
    select o.*
    from public.orders o
    join public.order_payments op on op.order_id = o.id
    where o.event_id = p_event_id
      and o.order_type = 'preorder'
      and o.status = 'confirmed'
      and o.pickup_status = 'awaiting_pickup'
      and op.payment_status = 'payment_confirmed'
    for update
  loop
    select op.* into v_payment from public.order_payments op where op.order_id = v_order.id for update;
    v_released := public.release_preorder_order_stock(v_order.id);

    update public.orders
    set status = 'cancelled',
        pickup_status = 'expired',
        cancelled_at = now(),
        cancelled_by = auth.uid(),
        cancel_reason = 'expired_after_event'
    where id = v_order.id;

    update public.order_payments
    set payment_status = 'payment_expired',
        expired_at = now(),
        confirmed_at = null,
        confirmed_by = null,
        updated_at = now()
    where id = v_payment.id;

    perform public.append_payment_review_event(v_order.id, v_payment.id, p_event_id, v_event.artist_id, 'payment_expired', 'payment_confirmed', 'payment_expired', v_payment.slip_url, 'expired_after_event');
    perform public.append_payment_review_event(v_order.id, v_payment.id, p_event_id, v_event.artist_id, 'stock_released', 'payment_confirmed', 'payment_expired', v_payment.slip_url, 'expired_after_event', jsonb_build_object('quantity', v_released));

    v_count := v_count + 1;
  end loop;

  return query select v_count;
end;
$$;

drop function if exists public.get_public_order_receipt(uuid, text);

create or replace function public.get_public_order_receipt(
  p_order_id uuid,
  p_pickup_code text
)
returns table (
  status text,
  pickup_status text,
  pickup_code text,
  customer_name text,
  total_price numeric,
  currency text,
  pickup_instructions text,
  payment_status text,
  slip_url text,
  payment_methods jsonb,
  payment_deadline_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    o.status,
    o.pickup_status,
    o.pickup_code,
    o.customer_name,
    o.total_price,
    o.currency,
    coalesce(e.preorder_pickup_instructions, ''),
    coalesce(op.payment_status, 'awaiting_payment'),
    op.slip_url,
    coalesce((
      select jsonb_agg(to_jsonb(epm) - 'artist_id' - 'created_at' - 'updated_at')
      from public.event_payment_methods epm
      where epm.event_id = o.event_id
        and epm.is_enabled = true
    ), '[]'::jsonb),
    (
      select min(epm.payment_deadline_at)
      from public.event_payment_methods epm
      where epm.event_id = o.event_id
        and epm.is_enabled = true
        and epm.payment_deadline_at is not null
    )
  from public.orders o
  join public.events e on e.id = o.event_id
  left join public.order_payments op on op.order_id = o.id
  where o.id = p_order_id
    and o.pickup_code = upper(trim(p_pickup_code))
    and o.order_type = 'preorder'
  limit 1;
end;
$$;

create or replace function public.list_preorder_production_summary(p_event_id uuid)
returns table (
  product_id uuid,
  product_name text,
  category text,
  image_url text,
  submitted_quantity bigint,
  confirmed_quantity bigint,
  rejected_quantity bigint,
  total_to_prepare bigint,
  expected_amount numeric,
  confirmed_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
begin
  select e.* into v_event from public.events e where e.id = p_event_id;
  if v_event.id is null then
    raise exception 'event_not_found';
  end if;
  if not public.has_event_role(p_event_id, array['owner', 'manager', 'seller']) then
    raise exception 'forbidden';
  end if;

  return query
  select
    p.id,
    p.name,
    p.category,
    p.image_url,
    coalesce(sum(oi.quantity) filter (where op.payment_status = 'payment_submitted'), 0)::bigint,
    coalesce(sum(oi.quantity) filter (where op.payment_status = 'payment_confirmed'), 0)::bigint,
    coalesce(sum(oi.quantity) filter (where op.payment_status in ('payment_rejected', 'payment_expired')), 0)::bigint,
    coalesce(sum(oi.quantity) filter (where op.payment_status in ('payment_submitted', 'payment_confirmed')), 0)::bigint,
    coalesce(sum(oi.quantity * oi.price_per_unit) filter (where op.payment_status in ('payment_submitted', 'payment_confirmed')), 0),
    coalesce(sum(oi.quantity * oi.price_per_unit) filter (where op.payment_status = 'payment_confirmed'), 0)
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  join public.order_payments op on op.order_id = o.id
  join public.products p on p.id = oi.product_id
  where o.event_id = p_event_id
    and o.order_type = 'preorder'
  group by p.id, p.name, p.category, p.image_url
  order by p.name;
end;
$$;

create or replace function public.list_preorder_payment_review(
  p_event_id uuid,
  p_payment_status text default null
)
returns table (
  order_id uuid,
  pickup_code text,
  customer_name text,
  customer_contact text,
  customer_phone text,
  customer_social text,
  customer_email text,
  customer_note text,
  total_price numeric,
  currency text,
  payment_status text,
  slip_url text,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  rejected_at timestamptz,
  expired_at timestamptz,
  review_note text,
  items jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
begin
  select e.* into v_event from public.events e where e.id = p_event_id;
  if v_event.id is null then
    raise exception 'event_not_found';
  end if;
  if not public.has_event_role(p_event_id, array['owner', 'manager', 'seller']) then
    raise exception 'forbidden';
  end if;

  return query
  select
    o.id,
    o.pickup_code,
    o.customer_name,
    o.customer_contact,
    o.customer_phone,
    o.customer_social,
    o.customer_email,
    o.customer_note,
    o.total_price,
    o.currency,
    op.payment_status,
    op.slip_url,
    op.submitted_at,
    op.confirmed_at,
    op.rejected_at,
    op.expired_at,
    op.review_note,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id', oi.product_id,
        'name', p.name,
        'quantity', oi.quantity,
        'price_per_unit', oi.price_per_unit,
        'currency', oi.currency
      ) order by p.name)
      from public.order_items oi
      join public.products p on p.id = oi.product_id
      where oi.order_id = o.id
    ), '[]'::jsonb)
  from public.orders o
  join public.order_payments op on op.order_id = o.id
  where o.event_id = p_event_id
    and o.order_type = 'preorder'
    and (p_payment_status is null or op.payment_status = p_payment_status)
  order by coalesce(op.submitted_at, o.created_at) desc;
end;
$$;

revoke all on function public.append_payment_review_event(uuid, uuid, uuid, uuid, text, text, text, text, text, jsonb) from public;
revoke all on function public.reserve_preorder_order_stock(uuid) from public;
revoke all on function public.release_preorder_order_stock(uuid) from public;

grant execute on function public.create_preorder_with_stock(uuid, jsonb, text, text, text, uuid, text, text, text) to anon, authenticated;
grant execute on function public.submit_preorder_payment_evidence(uuid, text, text, uuid) to anon, authenticated;
grant execute on function public.confirm_preorder_payment(uuid, text) to authenticated;
grant execute on function public.reject_preorder_payment(uuid, text) to authenticated;
grant execute on function public.cancel_public_preorder_before_payment(uuid, text) to anon, authenticated;
grant execute on function public.expire_submitted_preorder_payments(uuid, integer) to authenticated;
grant execute on function public.mark_preorder_picked_up(uuid) to authenticated;
grant execute on function public.cancel_preorder_with_stock(uuid, text) to authenticated;
grant execute on function public.expire_preorders_for_event(uuid) to authenticated;
grant execute on function public.get_public_order_receipt(uuid, text) to anon, authenticated;
grant execute on function public.list_preorder_production_summary(uuid) to authenticated;
grant execute on function public.list_preorder_payment_review(uuid, text) to authenticated;
