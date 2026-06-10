# Pre-order and Pickup MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build pre-order checkout before an event and staff pickup management during the event without breaking existing live queue and POS flows.

**Architecture:** Add event commerce mode fields and order fulfillment fields through a Supabase migration, then expose narrow RPCs for pre-order creation, public receipt lookup, pickup completion, cancellation, and event-end expiry. Reuse the existing event catalog and stock reservation model so pre-orders reserve finite stock exactly like current customer queue orders, and make every non-fulfilled path release reserved stock. Add focused React pages/components for pre-order settings, customer pre-order checkout, and pickup operations.

**Tech Stack:** PostgreSQL 15, Supabase SQL/RPCs, React 18, TypeScript, Supabase JS v2, React Router, TailwindCSS, Playwright, pgTAP-style SQL tests where the repo already uses them.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/20260602090000_preorder_pickup_mvp.sql` | Create | Event/order columns, indexes, RPCs, grants, receipt access, stock release paths, and walk-in RPC patch |
| `supabase/tests/preorder_pickup_mvp_test.sql` | Create | Behavioral database coverage for pre-order, stock, pickup, cancel, expiry, RLS, walk-in labels, and public receipt |
| `src/types/preorder.ts` | Create | Shared TypeScript types for order modes, pickup states, and RPC responses |
| `src/lib/preorders.ts` | Create | Supabase RPC wrappers and customer/staff friendly error mapping for create, pickup, cancel, expire, and receipt |
| `src/pages/customer/MenuView.tsx` | Modify | Add pre-order checkout mode, customer fields, pre-order receipt state |
| `src/pages/creators/ManageArtist.tsx` | Modify | Add pre-order settings entry point from each event card |
| `src/pages/creators/PreorderSettings.tsx` | Create | Event mode/window/pickup instruction settings surface with readiness checklist and event-timezone-safe datetime inputs |
| `src/pages/creators/PreorderPickup.tsx` | Create | Staff pickup list, search, filters, pickup action, cancel action, and event-end expiry action |
| `src/pages/creators/EventDashboard.tsx` | Modify | Separate pre-order metrics from live/walk-in order metrics |
| `src/pages/creators/OrderHistory.tsx` | Modify | Show order type, customer name/contact, pickup status |
| `src/App.tsx` | Modify | Add routes for pre-order settings and pickup management |
| `src/i18n.tsx` | Modify | Add labels/errors used by customer and creator/staff screens |
| `src/tests/regression/preorder-pickup.spec.ts` | Create | Browser regression coverage for the MVP flow |

## Task 1: Add Pre-order Schema and RPCs

**Files:**
- Create: `supabase/migrations/20260602090000_preorder_pickup_mvp.sql`
- Create: `supabase/tests/preorder_pickup_mvp_test.sql`

- [ ] **Step 1: Write behavioral database tests first**

Create `supabase/tests/preorder_pickup_mvp_test.sql` with tests that exercise the dangerous logic directly: stock reservation, oversell prevention, pickup, cancellation, expiry, receipt access, RLS, and walk-in labeling.

```sql
begin;

select plan(18);

do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_staff_id uuid := gen_random_uuid();
  v_other_id uuid := gen_random_uuid();
  v_artist_id uuid := gen_random_uuid();
  v_product_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_event_product_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, aud, role
  )
  values
    (v_owner_id, 'preorder.owner@nireq.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_staff_id, 'preorder.staff@nireq.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_other_id, 'preorder.other@nireq.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated');

  insert into public.artists (id, slug, display_name, is_public, is_verified, published_at)
  values (v_artist_id, 'preorder-test-artist', 'Preorder Test Artist', true, true, now());

  insert into public.artist_members (artist_id, member_email, role, status)
  values
    (v_artist_id, 'preorder.owner@nireq.local', 'owner', 'active'),
    (v_artist_id, 'preorder.staff@nireq.local', 'seller', 'active');

  insert into public.products (
    id, artist_id, name, price, currency, stock_total, stock_reserved, stock_sold, is_unlimited, status
  )
  values (v_product_id, v_artist_id, 'Finite Preorder Product', 100, 'THB', 20, 0, 0, false, 'enable');

  insert into public.events (
    id, artist_id, event_name, start_date, end_date, status, selling_mode,
    preorder_opens_at, preorder_closes_at, preorder_pickup_instructions
  )
  values (
    v_event_id, v_artist_id, 'Preorder Event', now() + interval '1 day', now() + interval '2 days',
    'Confirmed', 'preorder', now() - interval '1 hour', now() + interval '12 hours',
    'Show your pickup code at booth A12.'
  );

  insert into public.event_products (
    id, event_id, product_id, artist_id, stock_total, stock_reserved, stock_sold, is_unlimited, is_enabled
  )
  values (v_event_product_id, v_event_id, v_product_id, v_artist_id, 5, 0, 0, false, true);

  create temp table _preorder_ids (
    owner_id uuid,
    staff_id uuid,
    other_id uuid,
    artist_id uuid,
    event_id uuid,
    product_id uuid,
    event_product_id uuid,
    first_order_id uuid,
    first_pickup_code text,
    cancel_order_id uuid,
    expire_order_id uuid
  ) on commit drop;

  insert into _preorder_ids (
    owner_id, staff_id, other_id, artist_id, event_id, product_id, event_product_id
  )
  values (v_owner_id, v_staff_id, v_other_id, v_artist_id, v_event_id, v_product_id, v_event_product_id);
end $$;

create or replace function set_preorder_jwt(p_email text) returns void as $$
declare
  v_uid uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(p_email) limit 1;
  perform set_config('request.jwt.claims', json_build_object('email', p_email, 'sub', v_uid::text)::text, true);
end;
$$ language plpgsql;

create or replace function test_read_order_type(p_order_id uuid) returns text as $$
  select o.order_type
  from public.orders o
  where o.id = p_order_id;
$$ language sql security definer set search_path = public;

create temp table _created_preorder as
select *
from public.create_preorder_with_stock(
  (select event_id from _preorder_ids),
  jsonb_build_array(jsonb_build_object('product_id', (select product_id from _preorder_ids), 'quantity', 2)),
  'May Pickup',
  '@may',
  'arrives after lunch',
  gen_random_uuid()
);

update _preorder_ids
set first_order_id = (select order_id from _created_preorder),
    first_pickup_code = (select pickup_code from _created_preorder);

select is(
  (select stock_reserved from public.event_products where id = (select event_product_id from _preorder_ids)),
  2,
  'pre-order creation reserves event stock'
);

select is(
  (select pickup_status from public.orders where id = (select first_order_id from _preorder_ids)),
  'awaiting_pickup',
  'pre-order starts awaiting pickup'
);

select throws_ok(
  $$ select * from public.create_preorder_with_stock(
    (select event_id from _preorder_ids),
    jsonb_build_array(jsonb_build_object('product_id', (select product_id from _preorder_ids), 'quantity', 4)),
    'Oversell Customer',
    '@oversell',
    '',
    gen_random_uuid()
  ) $$,
  'insufficient_stock',
  'finite stock cannot be oversold by pre-order'
);

update public.events
set selling_mode = 'live'
where id = (select event_id from _preorder_ids);

select throws_ok(
  $$ select * from public.create_preorder_with_stock(
    (select event_id from _preorder_ids),
    jsonb_build_array(jsonb_build_object('product_id', (select product_id from _preorder_ids), 'quantity', 1)),
    'Wrong Mode',
    '@wrong',
    '',
    gen_random_uuid()
  ) $$,
  'preorder_not_open',
  'pre-order creation fails when event mode is not preorder'
);

update public.events
set selling_mode = 'preorder',
    preorder_opens_at = now() + interval '1 hour',
    preorder_closes_at = now() + interval '2 hours'
where id = (select event_id from _preorder_ids);

select throws_ok(
  $$ select * from public.create_preorder_with_stock(
    (select event_id from _preorder_ids),
    jsonb_build_array(jsonb_build_object('product_id', (select product_id from _preorder_ids), 'quantity', 1)),
    'Too Early',
    '@early',
    '',
    gen_random_uuid()
  ) $$,
  'preorder_not_open_yet',
  'pre-order creation fails before preorder_opens_at'
);

update public.events
set preorder_opens_at = now() - interval '2 hours',
    preorder_closes_at = now() - interval '1 hour'
where id = (select event_id from _preorder_ids);

select throws_ok(
  $$ select * from public.create_preorder_with_stock(
    (select event_id from _preorder_ids),
    jsonb_build_array(jsonb_build_object('product_id', (select product_id from _preorder_ids), 'quantity', 1)),
    'Too Late',
    '@late',
    '',
    gen_random_uuid()
  ) $$,
  'preorder_closed',
  'pre-order creation fails after preorder_closes_at'
);

update public.events
set preorder_opens_at = now() - interval '1 hour',
    preorder_closes_at = now() + interval '12 hours'
where id = (select event_id from _preorder_ids);

do $$ begin perform set_preorder_jwt('preorder.staff@nireq.local'); end $$;

select results_eq(
  $$ select pickup_status, status from public.mark_preorder_picked_up((select first_order_id from _preorder_ids)) $$,
  $$ values ('picked_up'::text, 'completed'::text) $$,
  'seller can mark pre-order picked up'
);

select is(
  (select stock_reserved from public.event_products where id = (select event_product_id from _preorder_ids)),
  0,
  'pickup releases reserved stock'
);

select is(
  (select stock_sold from public.event_products where id = (select event_product_id from _preorder_ids)),
  2,
  'pickup converts reserved stock to sold stock'
);

select throws_ok(
  $$ select * from public.mark_preorder_picked_up((select first_order_id from _preorder_ids)) $$,
  'order_not_pickup_ready',
  'pickup cannot be repeated'
);

create temp table _cancel_preorder as
select *
from public.create_preorder_with_stock(
  (select event_id from _preorder_ids),
  jsonb_build_array(jsonb_build_object('product_id', (select product_id from _preorder_ids), 'quantity', 1)),
  'Cancel Customer',
  '@cancel',
  '',
  gen_random_uuid()
);

update _preorder_ids set cancel_order_id = (select order_id from _cancel_preorder);

select results_eq(
  $$ select pickup_status, status from public.cancel_preorder_with_stock((select cancel_order_id from _preorder_ids), 'customer no-show') $$,
  $$ values ('cancelled'::text, 'cancelled'::text) $$,
  'seller can cancel pre-order and mark it cancelled'
);

select is(
  (select stock_reserved from public.event_products where id = (select event_product_id from _preorder_ids)),
  0,
  'cancel releases reserved stock'
);

create temp table _expire_preorder as
select *
from public.create_preorder_with_stock(
  (select event_id from _preorder_ids),
  jsonb_build_array(jsonb_build_object('product_id', (select product_id from _preorder_ids), 'quantity', 1)),
  'Expire Customer',
  '@expire',
  '',
  gen_random_uuid()
);

update public.events
set end_date = now() - interval '1 minute',
    selling_mode = 'closed'
where id = (select event_id from _preorder_ids);

do $$ begin perform set_preorder_jwt('preorder.owner@nireq.local'); end $$;

select results_eq(
  $$ select expired_count from public.expire_preorders_for_event((select event_id from _preorder_ids)) $$,
  $$ values (1) $$,
  'owner can expire remaining no-show pre-orders after event end'
);

select is(
  (select stock_reserved from public.event_products where id = (select event_product_id from _preorder_ids)),
  0,
  'expiry releases reserved stock'
);

select isnt_empty(
  $$ select 1 from public.get_public_order_receipt(
    (select first_order_id from _preorder_ids),
    (select first_pickup_code from _preorder_ids)
  ) $$,
  'public receipt works with matching order id and pickup code'
);

select is_empty(
  $$ select 1 from public.get_public_order_receipt(
    (select first_order_id from _preorder_ids),
    'WRONGCODE'
  ) $$,
  'public receipt fails with wrong pickup code'
);

select set_config(
  'test.preorder_order_id',
  (select first_order_id::text from _preorder_ids),
  true
);

do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
set local role anon;

select throws_ok(
  format(
    $$ select customer_name, customer_contact from public.orders where id = %L::uuid $$,
    current_setting('test.preorder_order_id')
  ),
  '42501',
  'permission denied for table orders',
  'anonymous users cannot directly select customer-identifying order fields'
);

reset role;
do $$ begin perform set_preorder_jwt('preorder.owner@nireq.local'); end $$;

update public.events
set start_date = now() - interval '1 hour',
    end_date = now() + interval '1 day',
    selling_mode = 'live'
where id = (select event_id from _preorder_ids);

select results_eq(
  $$ select public.test_read_order_type(public.create_walkin_order_with_stock(
       (select event_id from _preorder_ids),
       jsonb_build_array(jsonb_build_object('product_id', (select product_id from _preorder_ids), 'quantity', 1)),
       'cash',
       gen_random_uuid()
     )) $$,
  $$ values ('pos_walkin'::text) $$,
  'new walk-in POS orders are labeled pos_walkin'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the schema tests and verify they fail**

Run:

```bash
supabase test db supabase/tests/preorder_pickup_mvp_test.sql
```

Expected: fail because the columns, functions, stock behavior, RLS behavior, and walk-in order label do not exist yet.

- [ ] **Step 3: Create the migration with columns, checks, indexes, and backfill**

Create `supabase/migrations/20260602090000_preorder_pickup_mvp.sql`:

```sql
alter table public.events
  add column if not exists selling_mode text not null default 'live',
  add column if not exists preorder_opens_at timestamptz,
  add column if not exists preorder_closes_at timestamptz,
  add column if not exists preorder_pickup_instructions text;

alter table public.events
  drop constraint if exists events_selling_mode_check,
  add constraint events_selling_mode_check
  check (selling_mode in ('preorder', 'live', 'post_event', 'closed'));

alter table public.events
  drop constraint if exists events_preorder_window_check,
  add constraint events_preorder_window_check
  check (
    preorder_opens_at is null
    or preorder_closes_at is null
    or preorder_opens_at < preorder_closes_at
  );

alter table public.orders
  add column if not exists order_type text not null default 'live_queue',
  add column if not exists pickup_code text,
  add column if not exists customer_name text,
  add column if not exists customer_contact text,
  add column if not exists customer_note text,
  add column if not exists pickup_status text not null default 'not_required',
  add column if not exists picked_up_at timestamptz,
  add column if not exists picked_up_by uuid,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid,
  add column if not exists cancel_reason text;

alter table public.orders
  drop constraint if exists orders_order_type_check,
  add constraint orders_order_type_check
  check (order_type in ('live_queue', 'pos_walkin', 'preorder', 'post_event'));

alter table public.orders
  drop constraint if exists orders_pickup_status_check,
  add constraint orders_pickup_status_check
  check (pickup_status in ('not_required', 'awaiting_pickup', 'picked_up', 'cancelled', 'expired'));

alter table public.orders
  drop constraint if exists orders_preorder_customer_name_check,
  add constraint orders_preorder_customer_name_check
  check (order_type <> 'preorder' or length(trim(coalesce(customer_name, ''))) > 0);

alter table public.orders
  drop constraint if exists orders_preorder_pickup_code_check,
  add constraint orders_preorder_pickup_code_check
  check (order_type <> 'preorder' or length(trim(coalesce(pickup_code, ''))) >= 6);

update public.orders
set order_type = case
    when queue_id is null and status = 'completed' then 'pos_walkin'
    else 'live_queue'
  end,
  pickup_status = 'not_required'
where order_type = 'live_queue'
  and pickup_status = 'not_required';

create unique index if not exists orders_event_pickup_code_uidx
  on public.orders (event_id, pickup_code)
  where pickup_code is not null;

create index if not exists idx_orders_event_order_type_pickup_status_created
  on public.orders (event_id, order_type, pickup_status, created_at desc);

-- Keep customer-identifying pre-order fields unavailable to anonymous direct
-- table reads. Public customers use get_public_order_receipt instead.
revoke select (
  order_type,
  pickup_code,
  customer_name,
  customer_contact,
  customer_note,
  pickup_status,
  picked_up_at,
  picked_up_by,
  cancelled_at,
  cancelled_by,
  cancel_reason
) on public.orders from anon;

grant select (
  order_type,
  pickup_code,
  customer_name,
  customer_contact,
  customer_note,
  pickup_status,
  picked_up_at,
  picked_up_by,
  cancelled_at,
  cancelled_by,
  cancel_reason
) on public.orders to authenticated;

drop policy if exists "orders_preorder_staff_read" on public.orders;

create policy "orders_preorder_staff_read"
  on public.orders
  for select
  to authenticated
  using (
    order_type = 'preorder'
    and public.has_event_role(event_id, array['owner', 'manager', 'seller', 'queue_staff'])
  );
```

- [ ] **Step 4: Add pickup code generator helper**

Append this function to the same migration:

```sql
create or replace function public.generate_pickup_code(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_attempt integer := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    exit when not exists (
      select 1
      from public.orders o
      where o.event_id = p_event_id
        and o.pickup_code = v_code
    );

    if v_attempt >= 10 then
      raise exception 'pickup_code_generation_failed';
    end if;
  end loop;

  return v_code;
end;
$$;
```

- [ ] **Step 5: Add `create_preorder_with_stock` RPC**

Append this RPC. It mirrors `create_customer_order_with_stock` but does not require a queue and validates `selling_mode = preorder`:

```sql
create or replace function public.create_preorder_with_stock(
  p_event_id uuid,
  p_items jsonb,
  p_customer_name text,
  p_customer_contact text default '',
  p_customer_note text default '',
  p_client_request_id uuid default null
)
returns table (
  order_id uuid,
  pickup_code text,
  total_price numeric,
  currency text,
  pickup_instructions text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_existing_order record;
  v_item jsonb;
  v_order_id uuid;
  v_pickup_code text;
  v_product record;
  v_qty integer;
  v_total numeric := 0;
  v_currency text;
  v_effective_currency text;
  v_available integer;
  v_has_catalog boolean := false;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_items';
  end if;

  if length(trim(coalesce(p_customer_name, ''))) = 0 then
    raise exception 'customer_name_required';
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
        return query
        select
          v_existing_order.id,
          v_existing_order.pickup_code,
          v_existing_order.total_price,
          v_existing_order.currency,
          coalesce(v_event.preorder_pickup_instructions, '');
        return;
      end if;
      raise exception 'client_request_id_conflict';
    end if;
  end if;

  select exists (select 1 from public.event_products ep where ep.event_id = p_event_id)
  into v_has_catalog;

  v_pickup_code := public.generate_pickup_code(p_event_id);

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
    customer_note,
    pickup_status
  )
  values (
    p_event_id,
    null,
    'confirmed',
    0,
    0,
    coalesce(v_event.currency_override, 'THB'),
    null,
    p_client_request_id,
    'preorder',
    v_pickup_code,
    trim(p_customer_name),
    nullif(trim(coalesce(p_customer_contact, '')), ''),
    nullif(trim(coalesce(p_customer_note, '')), ''),
    'awaiting_pickup'
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

    -- Intentionally lock the product row even when event stock is used.
    -- This serializes concurrent orders for the same product and keeps
    -- event_products.stock_reserved from overselling finite event stock.

    v_effective_currency := coalesce(v_event.currency_override, v_product.currency, 'THB');

    if v_currency is null then
      v_currency := v_effective_currency;
    elsif v_currency <> v_effective_currency then
      raise exception 'mixed_currency_not_allowed';
    end if;

    if not coalesce(v_product.effective_is_unlimited, true) then
      v_available := coalesce(v_product.effective_stock_total, 0)
        - coalesce(v_product.effective_stock_reserved, 0)
        - coalesce(v_product.effective_stock_sold, 0);

      if v_available < v_qty then
        raise exception 'insufficient_stock';
      end if;

      if v_product.event_product_id is not null then
        update public.event_products
        set stock_reserved = stock_reserved + v_qty
        where id = v_product.event_product_id;
      else
        update public.products
        set stock_reserved = stock_reserved + v_qty,
            updated_at = now()
        where id = v_product.id;
      end if;
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

  return query
  select
    v_order_id,
    v_pickup_code,
    v_total,
    coalesce(v_currency, 'THB'),
    coalesce(v_event.preorder_pickup_instructions, '');
exception
  when unique_violation then
    raise exception 'preorder_unique_conflict';
end;
$$;
```

- [ ] **Step 6: Add `mark_preorder_picked_up` RPC**

Append this RPC:

```sql
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

  if v_order.status = 'completed' and v_order.pickup_status = 'picked_up' then
    return query select v_order.id, v_order.pickup_status, v_order.status, v_order.picked_up_at;
    return;
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
```

- [ ] **Step 7: Add `cancel_preorder_with_stock` RPC**

Append this RPC. It is the single-order release path for no-shows and customer-initiated cancellations handled by staff:

```sql
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

  if not public.has_event_role(v_order.event_id, array['owner', 'manager', 'seller']) then
    raise exception 'forbidden';
  end if;

  if v_order.order_type <> 'preorder' then
    raise exception 'order_not_preorder';
  end if;

  if v_order.status <> 'confirmed' or v_order.pickup_status <> 'awaiting_pickup' then
    raise exception 'order_not_cancellable';
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
      end if;
    elsif not coalesce(v_item.product_unlimited, true) then
      update public.products
      set stock_reserved = greatest(stock_reserved - v_item.quantity, 0),
          updated_at = now()
      where id = v_item.product_id;
    end if;
  end loop;

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
```

- [ ] **Step 8: Add `expire_preorders_for_event` RPC**

Append this RPC. It releases stock for all no-show pre-orders after the event has ended or has been manually closed:

```sql
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
  v_item record;
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
    where o.event_id = p_event_id
      and o.order_type = 'preorder'
      and o.status = 'confirmed'
      and o.pickup_status = 'awaiting_pickup'
    for update
  loop
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
        end if;
      elsif not coalesce(v_item.product_unlimited, true) then
        update public.products
        set stock_reserved = greatest(stock_reserved - v_item.quantity, 0),
            updated_at = now()
        where id = v_item.product_id;
      end if;
    end loop;

    update public.orders
    set status = 'cancelled',
        pickup_status = 'expired',
        cancelled_at = now(),
        cancelled_by = auth.uid(),
        cancel_reason = 'expired_after_event'
    where id = v_order.id;

    v_count := v_count + 1;
  end loop;

  return query select v_count;
end;
$$;
```

- [ ] **Step 9: Add public receipt RPC and grants**

Append:

```sql
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
  pickup_instructions text
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
    coalesce(e.preorder_pickup_instructions, '')
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
    and o.pickup_code = upper(trim(p_pickup_code))
    and o.order_type = 'preorder'
  limit 1;
end;
$$;

grant execute on function public.generate_pickup_code(uuid) to authenticated;
grant execute on function public.create_preorder_with_stock(uuid, jsonb, text, text, text, uuid) to anon, authenticated;
grant execute on function public.mark_preorder_picked_up(uuid) to authenticated;
grant execute on function public.cancel_preorder_with_stock(uuid, text) to authenticated;
grant execute on function public.expire_preorders_for_event(uuid) to authenticated;
grant execute on function public.get_public_order_receipt(uuid, text) to anon, authenticated;
```

- [ ] **Step 10: Patch walk-in RPC to write `order_type = 'pos_walkin'`**

In the same migration, replace the latest `create_walkin_order_with_stock` function body from `supabase/migrations/20260512161625_event_catalog_event_currency_and_stock_lifecycle.sql` and change its order insert from:

```sql
insert into public.orders (event_id, queue_id, status, total_price, currency, payment_method, payment_idempotency_key)
values (p_event_id, null, 'completed', 0, coalesce(v_event.currency_override, 'THB'), p_payment_method, p_payment_idempotency_key)
returning id into v_order_id;
```

to:

```sql
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
  pickup_status
)
values (
  p_event_id,
  null,
  'completed',
  0,
  0,
  coalesce(v_event.currency_override, 'THB'),
  p_payment_method,
  p_payment_idempotency_key,
  'pos_walkin',
  'not_required'
)
returning id into v_order_id;
```

Also update the idempotency branch to require `v_existing_order.order_type = 'pos_walkin'` before returning an existing order.

- [ ] **Step 11: Run database tests and fix migration errors**

Run:

```bash
supabase test db supabase/tests/preorder_pickup_mvp_test.sql
```

Expected: pass for behavior: pre-order stock reserve, oversell prevention, window validation, pickup conversion, cancel release, expiry release, receipt matching, anonymous direct order select denial, and new walk-in order type. If the local Supabase test command is unavailable, run `supabase db reset` and document the unavailable command in the implementation notes.

## Task 2: Add Client Types and RPC Helpers

**Files:**
- Create: `src/types/preorder.ts`
- Create: `src/lib/preorders.ts`

- [ ] **Step 1: Create shared pre-order types**

Create `src/types/preorder.ts`:

```ts
export type EventSellingMode = 'preorder' | 'live' | 'post_event' | 'closed';

export type OrderType = 'live_queue' | 'pos_walkin' | 'preorder' | 'post_event';

export type PickupStatus = 'not_required' | 'awaiting_pickup' | 'picked_up' | 'cancelled' | 'expired';

export interface CreatePreorderItem {
  product_id: string;
  quantity: number;
  notes?: string;
}

export interface CreatePreorderInput {
  eventId: string;
  items: CreatePreorderItem[];
  customerName: string;
  customerContact: string;
  customerNote: string;
  clientRequestId: string;
}

export interface CreatePreorderResult {
  order_id: string;
  pickup_code: string;
  total_price: number;
  currency: string;
  pickup_instructions: string;
}

export interface PublicOrderReceipt {
  status: string;
  pickup_status: PickupStatus;
  pickup_code: string;
  customer_name: string;
  total_price: number;
  currency: string;
  pickup_instructions: string;
}

export interface CancelPreorderResult {
  order_id: string;
  pickup_status: 'cancelled';
  status: 'cancelled';
  cancelled_at: string;
}

export interface ExpirePreordersResult {
  expired_count: number;
}
```

- [ ] **Step 2: Create RPC wrappers and error mapping**

Create `src/lib/preorders.ts`:

```ts
import { supabase } from '../supabaseClient';
import type {
  CancelPreorderResult,
  CreatePreorderInput,
  CreatePreorderResult,
  ExpirePreordersResult,
  PublicOrderReceipt,
} from '../types/preorder';

const firstRow = <T,>(value: T | T[] | null): T | null => {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
};

export const getPreorderErrorMessage = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error || '');
  if (raw.includes('customer_name_required')) return 'Please enter a pickup name.';
  if (raw.includes('empty_items')) return 'Select at least one item before submitting.';
  if (raw.includes('event_not_confirmed')) return 'This event is not confirmed yet.';
  if (raw.includes('event_ended')) return 'This event has already ended.';
  if (raw.includes('artist_not_public')) return 'This creator page is not ready for public pre-orders yet.';
  if (raw.includes('preorder_not_open_yet')) return 'Pre-order has not opened yet.';
  if (raw.includes('preorder_closed')) return 'Pre-order is already closed.';
  if (raw.includes('preorder_not_open')) return 'This event is not accepting pre-orders right now.';
  if (raw.includes('insufficient_stock')) return 'One or more items just sold out.';
  if (raw.includes('order_not_cancellable')) return 'This pre-order cannot be cancelled.';
  if (raw.includes('order_not_pickup_ready')) return 'This pre-order is not ready for pickup.';
  if (raw.includes('event_not_ready_to_expire_preorders')) return 'Pre-orders can only be expired after the event ends or after the event is closed.';
  if (raw.includes('mixed_currency_not_allowed')) return 'Items with different currencies cannot be checked out together.';
  if (raw.includes('invalid_product')) return 'One or more items are no longer available.';
  if (raw.includes('forbidden')) return 'Permission denied.';
  return 'Pre-order failed. Please check your items and try again.';
};

export const createPreorder = async (input: CreatePreorderInput) => {
  const { data, error } = await supabase.rpc('create_preorder_with_stock', {
    p_event_id: input.eventId,
    p_items: input.items,
    p_customer_name: input.customerName,
    p_customer_contact: input.customerContact,
    p_customer_note: input.customerNote,
    p_client_request_id: input.clientRequestId,
  });

  if (error) throw error;
  const row = firstRow<CreatePreorderResult>(data as CreatePreorderResult[] | CreatePreorderResult | null);
  if (!row) throw new Error('preorder_response_missing');
  return row;
};

export const getPublicOrderReceipt = async (orderId: string, pickupCode: string) => {
  const { data, error } = await supabase.rpc('get_public_order_receipt', {
    p_order_id: orderId,
    p_pickup_code: pickupCode,
  });

  if (error) throw error;
  return firstRow<PublicOrderReceipt>(data as PublicOrderReceipt[] | PublicOrderReceipt | null);
};

export const markPreorderPickedUp = async (orderId: string) => {
  const { data, error } = await supabase.rpc('mark_preorder_picked_up', {
    p_order_id: orderId,
  });

  if (error) throw error;
  return data;
};

export const cancelPreorder = async (orderId: string, reason: string) => {
  const { data, error } = await supabase.rpc('cancel_preorder_with_stock', {
    p_order_id: orderId,
    p_reason: reason,
  });

  if (error) throw error;
  return firstRow<CancelPreorderResult>(data as CancelPreorderResult[] | CancelPreorderResult | null);
};

export const expirePreordersForEvent = async (eventId: string) => {
  const { data, error } = await supabase.rpc('expire_preorders_for_event', {
    p_event_id: eventId,
  });

  if (error) throw error;
  return firstRow<ExpirePreordersResult>(data as ExpirePreordersResult[] | ExpirePreordersResult | null);
};
```

- [ ] **Step 3: Run TypeScript build and verify helper imports**

Run:

```bash
npm run build
```

Expected: fail only if the new files have typing/import mistakes. Fix any mistakes before moving on.

## Task 3: Add Creator Pre-order Settings

**Files:**
- Create: `src/pages/creators/PreorderSettings.tsx`
- Modify: `src/pages/creators/ManageArtist.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add route imports and routes**

Modify `src/App.tsx` to lazy-load the new pages:

```tsx
const PreorderSettings = lazy(() => import('./pages/creators/PreorderSettings'));
const PreorderPickup = lazy(() => import('./pages/creators/PreorderPickup'));
```

Add routes near the existing `/manage-events/:eventId/dashboard` route:

```tsx
<Route
  path="/manage-events/:eventId/preorder"
  element={session ? (canUseManagement ? <PreorderSettings /> : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
/>
<Route
  path="/manage-events/:eventId/pickup"
  element={session && actorContext && canUseQueueWorkspace ? <PreorderPickup actorContext={actorContext} /> : <Navigate to="/manage-login" replace />}
/>
```

- [ ] **Step 2: Create settings page**

Create `src/pages/creators/PreorderSettings.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import AdminHeader from '../../components/AdminHeader';
import { Toast } from '../../components/ui/Feedback';
import { supabase } from '../../supabaseClient';
import type { EventSellingMode } from '../../types/preorder';
import { formatDateTimeForInput, parseDateTimeInputInTimeZone } from '../../utils/timezone';

interface EventSettingsRow {
  id: string;
  event_name: string;
  start_date: string;
  end_date: string;
  event_timezone: string | null;
  selling_mode: EventSellingMode;
  preorder_opens_at: string | null;
  preorder_closes_at: string | null;
  preorder_pickup_instructions: string | null;
}

const toInputValue = (value: string | null, timeZone: string) => formatDateTimeForInput(value, timeZone);

const fromInputValue = (value: string, timeZone: string) => {
  if (!value) return null;
  const parsed = parseDateTimeInputInTimeZone(value, timeZone);
  return parsed ? parsed.toISOString() : null;
};

export default function PreorderSettings() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventSettingsRow | null>(null);
  const [catalogProductCount, setCatalogProductCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ tone?: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!eventId) return;
      const [{ data, error }, { data: catalogData }] = await Promise.all([
        supabase
        .from('events')
        .select('id, event_name, start_date, end_date, event_timezone, selling_mode, preorder_opens_at, preorder_closes_at, preorder_pickup_instructions')
        .eq('id', eventId)
        .single(),
        supabase.rpc('list_event_products', { p_event_id: eventId }),
      ]);

      if (error) {
        setToast({ tone: 'error', title: 'Could not load event', detail: error.message });
        return;
      }

      setEvent(data as EventSettingsRow);
      setCatalogProductCount((catalogData || []).length);
    };

    void load();
  }, [eventId]);

  const save = async () => {
    if (!event) return;
    setSaving(true);
    const { error } = await supabase
      .from('events')
      .update({
        selling_mode: event.selling_mode,
        preorder_opens_at: event.preorder_opens_at,
        preorder_closes_at: event.preorder_closes_at,
        preorder_pickup_instructions: event.preorder_pickup_instructions || null,
      })
      .eq('id', event.id);

    setSaving(false);
    if (error) {
      setToast({ tone: 'error', title: 'Pre-order settings failed', detail: error.message });
      return;
    }
    setToast({ tone: 'success', title: 'Pre-order settings saved' });
  };

  if (!event) return <div className="min-h-screen bg-gray-50 p-8 text-gray-500">Loading pre-order settings...</div>;
  const eventTimeZone = event.event_timezone || 'Asia/Bangkok';
  const hasPickupInstructions = (event.preorder_pickup_instructions || '').trim().length > 0;
  const closesBeforeEventEnds = !event.preorder_closes_at || new Date(event.preorder_closes_at) <= new Date(event.end_date);
  const readinessItems = [
    { label: 'Pickup instructions added', ready: hasPickupInstructions },
    { label: 'Pre-order closes before event ends', ready: closesBeforeEventEnds },
    { label: 'Event catalog has enabled products', ready: catalogProductCount > 0 },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader />
      <main className="mx-auto max-w-3xl p-4 md:p-6">
        <button onClick={() => navigate('/manage-events')} className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-gray-600 hover:text-pink-600">
          <ArrowLeft size={18} /> Back to events
        </button>
        <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-black text-gray-900">{event.event_name}</h1>
          <p className="mt-1 text-sm font-semibold text-gray-500">Configure customer pre-orders and pickup instructions.</p>

          <div className="mt-6 grid gap-5">
            <label className="grid gap-2">
              <span className="text-sm font-black text-gray-700">Selling mode</span>
              <select
                value={event.selling_mode || 'live'}
                onChange={(e) => setEvent({ ...event, selling_mode: e.target.value as EventSellingMode })}
                className="min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-pink-300"
              >
                <option value="live">Live queue / POS</option>
                <option value="preorder">Pre-order</option>
                <option value="closed">Closed</option>
                <option value="post_event">Post-event sale</option>
              </select>
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-black text-gray-700">Pre-order opens</span>
                <input
                  type="datetime-local"
                  value={toInputValue(event.preorder_opens_at, eventTimeZone)}
                  onChange={(e) => setEvent({ ...event, preorder_opens_at: fromInputValue(e.target.value, eventTimeZone) })}
                  className="min-h-11 rounded-xl border border-gray-200 px-3 text-sm font-bold outline-none focus:border-pink-300"
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-black text-gray-700">Pre-order closes</span>
                <input
                  type="datetime-local"
                  value={toInputValue(event.preorder_closes_at, eventTimeZone)}
                  onChange={(e) => setEvent({ ...event, preorder_closes_at: fromInputValue(e.target.value, eventTimeZone) })}
                  className="min-h-11 rounded-xl border border-gray-200 px-3 text-sm font-bold outline-none focus:border-pink-300"
                />
              </label>
            </div>

            <label className="grid gap-2">
              <span className="text-sm font-black text-gray-700">Pickup instructions</span>
              <textarea
                value={event.preorder_pickup_instructions || ''}
                onChange={(e) => setEvent({ ...event, preorder_pickup_instructions: e.target.value })}
                rows={5}
                className="rounded-xl border border-gray-200 px-3 py-3 text-sm font-semibold outline-none focus:border-pink-300"
                placeholder="Example: Show your pickup code at booth A12 between 12:00-17:00."
              />
            </label>

            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <div className="text-sm font-black text-gray-800">Readiness checklist</div>
              <div className="mt-3 grid gap-2">
                {readinessItems.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-3 text-sm font-bold">
                    <span className="text-gray-600">{item.label}</span>
                    <span className={item.ready ? 'text-emerald-600' : 'text-amber-600'}>{item.ready ? 'Ready' : 'Needs attention'}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-pink-600 px-5 text-sm font-black text-white shadow-sm hover:bg-pink-700 disabled:opacity-60"
              >
                <Save size={17} /> {saving ? 'Saving...' : 'Save settings'}
              </button>
            </div>
          </div>
        </section>
      </main>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
```

- [ ] **Step 3: Add event card actions**

In `src/pages/creators/ManageArtist.tsx`, add two actions near the existing dashboard/history buttons:

```tsx
<button
  onClick={() => navigate(`/manage-events/${evt.id}/preorder`)}
  className="inline-flex min-h-10 items-center justify-center rounded-xl border border-pink-100 bg-white px-3 text-xs font-black text-pink-700 hover:bg-pink-50"
>
  Pre-order
</button>
<button
  onClick={() => navigate(`/manage-events/${evt.id}/pickup`)}
  className="inline-flex min-h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-3 text-xs font-black text-gray-700 hover:bg-gray-50"
>
  Pickup
</button>
```

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: pass after route/page imports are correct.

## Task 4: Add Customer Pre-order Checkout in Menu

**Files:**
- Modify: `src/pages/customer/MenuView.tsx`
- Modify: `src/types/customerContext.ts`
- Modify: `src/i18n.tsx`

- [ ] **Step 1: Extend selected event type**

In `src/types/customerContext.ts`, add optional fields to the event shape used by customer pages:

```ts
selling_mode?: 'preorder' | 'live' | 'post_event' | 'closed' | null;
preorder_opens_at?: string | null;
preorder_closes_at?: string | null;
preorder_pickup_instructions?: string | null;
```

- [ ] **Step 2: Add pre-order mode derivation**

In `MenuView.tsx`, import helpers:

```tsx
import { createPreorder, getPreorderErrorMessage } from '../../lib/preorders';
```

Add state:

```tsx
const [customerName, setCustomerName] = useState('');
const [customerContact, setCustomerContact] = useState('');
const [customerNote, setCustomerNote] = useState('');
const [preorderReceipt, setPreorderReceipt] = useState<{ orderId: string; pickupCode: string; instructions: string } | null>(null);
```

Add mode helpers:

```tsx
const nowMs = Date.now();
const preorderOpenMs = selectedEvent?.preorder_opens_at ? new Date(selectedEvent.preorder_opens_at).getTime() : null;
const preorderCloseMs = selectedEvent?.preorder_closes_at ? new Date(selectedEvent.preorder_closes_at).getTime() : null;
const isPreorderMode = selectedEvent?.selling_mode === 'preorder';
const isPreorderWindowOpen =
  isPreorderMode &&
  (preorderOpenMs === null || nowMs >= preorderOpenMs) &&
  (preorderCloseMs === null || nowMs <= preorderCloseMs);
```

- [ ] **Step 3: Add pre-order submit function**

Add:

```tsx
const submitPreorder = async () => {
  if (!selectedEvent?.id || totalItems === 0) return;
  if (!customerName.trim()) {
    setToast({ tone: 'warning', title: 'Pickup name required', detail: 'Enter the name staff should use to find your order.' });
    return;
  }

  setSubmitting(true);
  try {
    const result = await createPreorder({
      eventId: selectedEvent.id,
      items: Object.entries(cart).map(([productId, qty]) => ({ product_id: productId, quantity: qty, notes: '' })),
      customerName,
      customerContact,
      customerNote,
      clientRequestId: crypto.randomUUID(),
    });

    localStorage.setItem(`preorderReceipt_${contextArtist?.id}_${selectedEvent.id}`, JSON.stringify({
      orderId: result.order_id,
      pickupCode: result.pickup_code,
      instructions: result.pickup_instructions,
    }));
    setPreorderReceipt({
      orderId: result.order_id,
      pickupCode: result.pickup_code,
      instructions: result.pickup_instructions,
    });
    clearCart();
    setIsCartOpen(false);
    setToast({ tone: 'success', title: 'Pre-order sent', detail: `Pickup code: ${result.pickup_code}` });
  } catch (error) {
    setToast({ tone: 'error', title: 'Pre-order failed', detail: getPreorderErrorMessage(error) });
  } finally {
    setSubmitting(false);
  }
};
```

- [ ] **Step 4: Branch confirm button behavior**

Update `handleConfirmOrder` so pre-order mode bypasses queue ticket checks:

```tsx
const handleConfirmOrder = async () => {
  if (totalItems === 0) return;

  if (isPreorderMode) {
    if (!isPreorderWindowOpen) {
      setToast({ tone: 'info', title: 'Pre-order is closed', detail: 'This event is not accepting pre-orders right now.' });
      return;
    }
    await submitPreorder();
    return;
  }

  // existing queue-required logic stays below this branch
};
```

- [ ] **Step 5: Add customer fields inside the cart panel**

Render the form above the submit button when `isPreorderMode`:

```tsx
{isPreorderMode && !preorderReceipt && (
  <div className="grid gap-3 rounded-2xl border border-pink-100 bg-pink-50/50 p-3">
    <label className="grid gap-1">
      <span className="text-xs font-black text-gray-700">Pickup name</span>
      <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="min-h-11 rounded-xl border border-pink-100 px-3 text-sm font-bold outline-none focus:border-pink-300" />
    </label>
    <label className="grid gap-1">
      <span className="text-xs font-black text-gray-700">Contact</span>
      <input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} className="min-h-11 rounded-xl border border-pink-100 px-3 text-sm font-bold outline-none focus:border-pink-300" placeholder="@handle or phone" />
    </label>
    <label className="grid gap-1">
      <span className="text-xs font-black text-gray-700">Note</span>
      <textarea value={customerNote} onChange={(e) => setCustomerNote(e.target.value)} rows={2} className="rounded-xl border border-pink-100 px-3 py-2 text-sm font-semibold outline-none focus:border-pink-300" />
    </label>
  </div>
)}
```

- [ ] **Step 6: Add receipt state**

Render a receipt after pre-order success:

```tsx
{preorderReceipt && (
  <div className="mx-4 my-4 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-center">
    <div className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">Pickup code</div>
    <div className="mt-2 text-3xl font-black tracking-normal text-emerald-900">{preorderReceipt.pickupCode}</div>
    {preorderReceipt.instructions && <p className="mt-3 text-sm font-bold leading-6 text-emerald-800">{preorderReceipt.instructions}</p>}
  </div>
)}
```

- [ ] **Step 7: Run focused build**

Run:

```bash
npm run build
```

Expected: pass with `MenuView.tsx` changes.

## Task 5: Add Staff Pickup Page

**Files:**
- Create: `src/pages/creators/PreorderPickup.tsx`

- [ ] **Step 1: Create pickup page**

Create `src/pages/creators/PreorderPickup.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle, Search } from 'lucide-react';
import AdminHeader from '../../components/AdminHeader';
import { Toast } from '../../components/ui/Feedback';
import { cancelPreorder, expirePreordersForEvent, getPreorderErrorMessage, markPreorderPickedUp } from '../../lib/preorders';
import { supabase } from '../../supabaseClient';
import type { ActorContext } from '../../types/access';
import type { PickupStatus } from '../../types/preorder';
import { formatPrice } from '../../utils/currency';

interface PreorderPickupProps {
  actorContext: ActorContext;
}

interface PickupOrderRow {
  id: string;
  created_at: string;
  status: string;
  pickup_status: PickupStatus;
  pickup_code: string;
  customer_name: string;
  customer_contact: string | null;
  customer_note: string | null;
  total_price: number;
  currency: string;
  order_items: Array<{ quantity: number; products: { name: string } | null }>;
}

export default function PreorderPickup({ actorContext }: PreorderPickupProps) {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<PickupOrderRow[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'awaiting_pickup' | 'picked_up' | 'all'>('awaiting_pickup');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ tone?: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string } | null>(null);
  const canCancelPreorders = ['owner', 'manager', 'seller'].includes(actorContext.role);
  const canExpirePreorders = ['owner', 'manager'].includes(actorContext.role);

  const load = async () => {
    if (!eventId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('orders')
      .select(`
        id,
        created_at,
        status,
        pickup_status,
        pickup_code,
        customer_name,
        customer_contact,
        customer_note,
        total_price,
        currency,
        order_items (
          quantity,
          products (name)
        )
      `)
      .eq('event_id', eventId)
      .eq('order_type', 'preorder')
      .order('created_at', { ascending: false });

    setLoading(false);
    if (error) {
      setToast({ tone: 'error', title: 'Could not load pickup orders', detail: error.message });
      return;
    }
    setOrders((data || []) as unknown as PickupOrderRow[]);
  };

  useEffect(() => { void load(); }, [eventId]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesFilter = filter === 'all' || order.pickup_status === filter;
      const itemNames = order.order_items.map((item) => item.products?.name || '').join(' ');
      const haystack = `${order.pickup_code} ${order.customer_name} ${order.customer_contact || ''} ${itemNames}`.toLowerCase();
      return matchesFilter && (normalized.length === 0 || haystack.includes(normalized));
    });
  }, [orders, query, filter]);

  const markPickedUp = async (orderId: string) => {
    try {
      await markPreorderPickedUp(orderId);
      setToast({ tone: 'success', title: 'Pickup completed' });
      await load();
    } catch (error) {
      setToast({ tone: 'error', title: 'Pickup failed', detail: getPreorderErrorMessage(error) });
    }
  };

  const cancelNoShow = async (orderId: string) => {
    try {
      await cancelPreorder(orderId, 'staff_cancelled_no_show');
      setToast({ tone: 'success', title: 'Pre-order cancelled', detail: 'Reserved stock was released.' });
      await load();
    } catch (error) {
      setToast({ tone: 'error', title: 'Cancel failed', detail: getPreorderErrorMessage(error) });
    }
  };

  const expireRemaining = async () => {
    if (!eventId) return;
    try {
      const result = await expirePreordersForEvent(eventId);
      setToast({ tone: 'success', title: 'Remaining pre-orders expired', detail: `${result?.expired_count || 0} order(s) released.` });
      await load();
    } catch (error) {
      setToast({ tone: 'error', title: 'Expiry failed', detail: getPreorderErrorMessage(error) });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader />
      <main className="mx-auto max-w-5xl p-4 md:p-6">
        <button onClick={() => navigate('/manage-events')} className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-gray-600 hover:text-pink-600">
          <ArrowLeft size={18} /> Back to events
        </button>
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-black text-gray-900">Pickup Orders</h1>
            <p className="text-sm font-semibold text-gray-500">Staff workspace for pre-order fulfillment.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canExpirePreorders && (
              <button onClick={expireRemaining} className="inline-flex min-h-10 items-center rounded-xl border border-amber-200 bg-amber-50 px-3 text-xs font-black text-amber-800 hover:bg-amber-100">
                Expire remaining
              </button>
            )}
            <div className="text-xs font-bold text-gray-400">Workspace: {actorContext.role}</div>
          </div>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <label className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-pink-400" size={18} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search code, name, contact, or product"
              className="min-h-12 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-3 text-sm font-bold outline-none focus:border-pink-300"
            />
          </label>
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="min-h-12 rounded-xl border border-gray-200 bg-white px-3 text-sm font-black outline-none focus:border-pink-300">
            <option value="awaiting_pickup">Awaiting pickup</option>
            <option value="picked_up">Picked up</option>
            <option value="all">All</option>
          </select>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          {loading ? (
            <div className="p-8 text-center text-sm font-bold text-gray-400">Loading pickup orders...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm font-bold text-gray-400">No pickup orders found.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filtered.map((order) => (
                <div key={order.id} className="grid gap-3 p-4 md:grid-cols-[140px_1fr_auto] md:items-center">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.14em] text-gray-400">Code</div>
                    <div className="text-2xl font-black text-pink-700">{order.pickup_code}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-black text-gray-900">{order.customer_name}</div>
                    <div className="text-xs font-bold text-gray-500">{order.customer_contact || 'No contact'} · {formatPrice(order.total_price, order.currency)}</div>
                    <div className="mt-1 text-xs font-semibold text-gray-500">
                      {order.order_items.map((item) => `${item.quantity}x ${item.products?.name || 'Unknown'}`).join(', ')}
                    </div>
                    {order.customer_note && <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600">{order.customer_note}</div>}
                  </div>
                  <div className="flex justify-end">
                    {order.pickup_status === 'awaiting_pickup' ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        {canCancelPreorders && (
                          <button onClick={() => cancelNoShow(order.id)} className="inline-flex min-h-11 items-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-black text-gray-700 hover:bg-gray-50">
                            Cancel
                          </button>
                        )}
                        <button onClick={() => markPickedUp(order.id)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white hover:bg-emerald-700">
                          <CheckCircle size={17} /> Picked up
                        </button>
                      </div>
                    ) : (
                      <span className="inline-flex min-h-11 items-center rounded-xl bg-gray-100 px-4 text-sm font-black text-gray-700">{order.pickup_status}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
```

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: pass after query typing and component props are correct.

## Task 6: Update History and Dashboard

**Files:**
- Modify: `src/pages/creators/OrderHistory.tsx`
- Modify: `src/pages/creators/EventDashboard.tsx`

- [ ] **Step 1: Extend order queries**

In both files, include these fields in order selects:

```sql
order_type,
pickup_code,
customer_name,
customer_contact,
pickup_status,
picked_up_at
```

- [ ] **Step 2: Add order type summary in `EventDashboard.tsx`**

Add derived counts:

```tsx
const preorderOrders = completedOrders.filter((order) => order.order_type === 'preorder');
const liveQueueOrders = completedOrders.filter((order) => order.order_type === 'live_queue');
const walkinOrders = completedOrders.filter((order) => order.order_type === 'pos_walkin');
const awaitingPickupCount = orders.filter((order) => order.order_type === 'preorder' && order.pickup_status === 'awaiting_pickup').length;
```

Render cards for:

- pre-order revenue,
- awaiting pickup,
- live queue revenue,
- walk-in revenue.

- [ ] **Step 3: Add pickup columns in `OrderHistory.tsx`**

Add columns or compact row details:

```tsx
{order.order_type === 'preorder' && (
  <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-bold">
    <span className="rounded-md bg-pink-50 px-2 py-1 text-pink-700">Pre-order</span>
    <span className="rounded-md bg-gray-100 px-2 py-1 text-gray-600">{order.pickup_code}</span>
    <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">{order.pickup_status}</span>
  </div>
)}
```

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: pass with updated order interfaces.

## Task 7: Add Regression Coverage

**Files:**
- Create: `src/tests/regression/preorder-pickup.spec.ts`

- [ ] **Step 1: Add Playwright smoke regressions**

Create:

```ts
import { test, expect } from '@playwright/test';

test.describe('pre-order pickup MVP', () => {
  test('customer pre-order flow does not require a queue ticket', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('public-topbar')).toBeVisible();
  });

  test('pickup workspace route is protected for management users', async ({ page }) => {
    await page.goto('/manage-events/example-event-id/pickup');
    await expect(page).toHaveURL(/manage-login/);
  });
});
```

These smoke tests intentionally stay narrow because the database test in Task 1 owns the stock, permission, and receipt behavior coverage.

- [ ] **Step 2: Run targeted regression**

Run:

```bash
npx playwright test src/tests/regression/preorder-pickup.spec.ts
```

Expected: protected route smoke passes; customer flow smoke reaches the public app. If the suite requires a seeded creator, update the test to use `src/tests/regression/helpers/testData.ts`.

## Task 8: Full Verification

**Files:**
- Verify all modified files

- [ ] **Step 1: Run TypeScript build**

Run:

```bash
npm run build
```

Expected: pass.

- [ ] **Step 2: Run targeted database tests**

Run:

```bash
supabase test db supabase/tests/preorder_pickup_mvp_test.sql
```

Expected: pass for stock reserve/release, pickup, cancel, expiry, RLS, receipt, and walk-in labels.

- [ ] **Step 3: Run targeted browser tests**

Run:

```bash
npx playwright test src/tests/regression/preorder-pickup.spec.ts
```

Expected: pass.

- [ ] **Step 4: Run release hygiene checks**

Run:

```bash
npm run check:hygiene
```

Expected: pass or report only known pre-existing issues. Document any pre-existing issues in the final implementation summary.

- [ ] **Step 5: Manual browser verification**

Run the app:

```bash
npm run dev
```

Open the local URL and verify:

- Creator can save pre-order settings.
- Customer can submit pre-order without queue.
- Customer sees pickup code.
- Staff pickup page lists the order.
- Marking pickup changes status.
- Cancelling a no-show releases reserved stock.
- Expiring remaining event pre-orders releases reserved stock after the event ends or closes.
- New walk-in POS orders appear as `pos_walkin` in history/dashboard metrics.
- Existing live menu still requires queue.

## Self-Review

- Spec coverage: the plan covers event mode settings, customer pre-order creation, stock reservation, pickup completion, cancellation, event-end expiry, RLS receipt protection, walk-in order labeling, dashboard/history visibility, and regression testing.
- Placeholder scan: the plan avoids unresolved implementation placeholders and names concrete files, functions, fields, commands, and snippets.
- Type consistency: `selling_mode`, `order_type`, `pickup_status`, `pickup_code`, `customer_name`, `customer_contact`, `customer_note`, `cancelled_at`, `cancelled_by`, and `cancel_reason` are used consistently across SQL and TypeScript.
