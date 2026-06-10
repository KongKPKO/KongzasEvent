begin;
select plan(44);

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

  insert into public.event_payment_methods (
    event_id, artist_id, method_type, display_name, promptpay_id, payment_deadline_at, is_enabled
  )
  values (v_event_id, v_artist_id, 'promptpay', 'PromptPay', '0812345678', now() + interval '12 hours', true);

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
    oversell_order_id uuid,
    cancel_order_id uuid,
    reject_order_id uuid,
    expire_submitted_order_id uuid,
    expire_pickup_order_id uuid
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
  '',
  'arrives after lunch',
  gen_random_uuid(),
  '',
  '@may',
  'may@example.com'
);

update _preorder_ids
set first_order_id = (select order_id from _created_preorder),
    first_pickup_code = (select pickup_code from _created_preorder);

select is(
  (select stock_reserved from public.event_products where id = (select event_product_id from _preorder_ids)),
  0,
  'pre-order creation does not reserve event stock before payment evidence'
);

select is(
  (select pickup_status from public.orders where id = (select first_order_id from _preorder_ids)),
  'not_required',
  'pre-order is not pickup-ready before payment confirmation'
);

select is(
  (select status from public.orders where id = (select first_order_id from _preorder_ids)),
  'draft',
  'pre-order starts as draft while awaiting payment'
);

select is(
  (select payment_status from public.order_payments where order_id = (select first_order_id from _preorder_ids)),
  'awaiting_payment',
  'pre-order starts awaiting payment'
);

select is(
  (select customer_email from public.orders where id = (select first_order_id from _preorder_ids)),
  'may@example.com',
  'pre-order stores required customer email'
);

select throws_ok(
  $$ select * from public.create_preorder_with_stock(
    (select event_id from _preorder_ids),
    jsonb_build_array(jsonb_build_object('product_id', (select product_id from _preorder_ids), 'quantity', 1)),
    'Missing Email',
    '',
    '',
    gen_random_uuid(),
    '0800000000',
    '',
    ''
  ) $$,
  'customer_email_required',
  'pre-order creation requires customer email'
);

create temp table _submitted_payment as
select *
from public.submit_preorder_payment_evidence(
  (select first_order_id from _preorder_ids),
  (select first_pickup_code from _preorder_ids),
  'artist/event/order/slip-1.png',
  gen_random_uuid()
);

select is(
  (select stock_reserved from public.event_products where id = (select event_product_id from _preorder_ids)),
  2,
  'payment evidence submission reserves stock'
);

select is(
  (select payment_status from public.order_payments where order_id = (select first_order_id from _preorder_ids)),
  'payment_submitted',
  'payment evidence moves payment to submitted'
);

do $$ begin perform set_preorder_jwt('preorder.staff@nireq.local'); end $$;

select throws_ok(
  $$ select * from public.mark_preorder_picked_up((select first_order_id from _preorder_ids)) $$,
  'payment_not_confirmed',
  'pickup is blocked until seller confirms payment'
);

create temp table _oversell_preorder as
select *
from public.create_preorder_with_stock(
  (select event_id from _preorder_ids),
  jsonb_build_array(jsonb_build_object('product_id', (select product_id from _preorder_ids), 'quantity', 4)),
  'Oversell Customer',
  '',
  '',
  gen_random_uuid(),
  '0800000000',
  '',
  'oversell@example.com'
);

update _preorder_ids set oversell_order_id = (select order_id from _oversell_preorder);

select throws_ok(
  $$ select * from public.submit_preorder_payment_evidence(
    (select oversell_order_id from _preorder_ids),
    (select pickup_code from _oversell_preorder),
    'artist/event/order/slip-oversell.png',
    gen_random_uuid()
  ) $$,
  'insufficient_stock',
  'finite stock cannot be oversold by payment evidence submission'
);

update public.events
set selling_mode = 'live'
where id = (select event_id from _preorder_ids);

select throws_ok(
  $$ select * from public.create_preorder_with_stock(
    (select event_id from _preorder_ids),
    jsonb_build_array(jsonb_build_object('product_id', (select product_id from _preorder_ids), 'quantity', 1)),
    'Wrong Mode',
    '',
    '',
    gen_random_uuid(),
    '',
    '@wrong',
    'wrong@example.com'
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
    '',
    '',
    gen_random_uuid(),
    '',
    '@early',
    'early@example.com'
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
    '',
    '',
    gen_random_uuid(),
    '',
    '@late',
    'late@example.com'
  ) $$,
  'preorder_closed',
  'pre-order creation fails after preorder_closes_at'
);

update public.events
set preorder_opens_at = now() - interval '1 hour',
    preorder_closes_at = now() + interval '12 hours'
where id = (select event_id from _preorder_ids);

select results_eq(
  $$ select payment_status, pickup_status from public.confirm_preorder_payment((select first_order_id from _preorder_ids), 'bank checked') $$,
  $$ values ('payment_confirmed'::text, 'awaiting_pickup'::text) $$,
  'seller can confirm payment and make preorder pickup-ready'
);

select results_eq(
  $$ select pickup_status, status from public.mark_preorder_picked_up((select first_order_id from _preorder_ids)) $$,
  $$ values ('picked_up'::text, 'completed'::text) $$,
  'seller can mark confirmed pre-order picked up'
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
  '',
  '',
  gen_random_uuid(),
  '',
  '@cancel',
  'cancel@example.com'
);

update _preorder_ids set cancel_order_id = (select order_id from _cancel_preorder);

select isnt_empty(
  $$ select 1 from public.submit_preorder_payment_evidence(
    (select cancel_order_id from _preorder_ids),
    (select pickup_code from _cancel_preorder),
    'artist/event/order/slip-cancel.png',
    gen_random_uuid()
  ) $$,
  'cancel test payment evidence can be submitted'
);

select is(
  (select stock_reserved from public.event_products where id = (select event_product_id from _preorder_ids)),
  1,
  'submitted cancel order reserves stock'
);

select results_eq(
  $$ select pickup_status, status from public.cancel_preorder_with_stock((select cancel_order_id from _preorder_ids), 'customer no-show') $$,
  $$ values ('cancelled'::text, 'cancelled'::text) $$,
  'seller can cancel submitted pre-order and mark it cancelled'
);

select is(
  (select stock_reserved from public.event_products where id = (select event_product_id from _preorder_ids)),
  0,
  'cancel releases reserved stock'
);

create temp table _public_cancel_preorder as
select *
from public.create_preorder_with_stock(
  (select event_id from _preorder_ids),
  jsonb_build_array(jsonb_build_object('product_id', (select product_id from _preorder_ids), 'quantity', 1)),
  'Public Cancel Customer',
  '',
  '',
  gen_random_uuid(),
  '',
  '@public-cancel',
  'public-cancel@example.com'
);

select results_eq(
  $$ select pickup_status, status from public.cancel_public_preorder_before_payment(
    (select order_id from _public_cancel_preorder),
    (select pickup_code from _public_cancel_preorder)
  ) $$,
  $$ values ('cancelled'::text, 'cancelled'::text) $$,
  'customer can cancel pre-order before payment evidence'
);

select is(
  (select payment_status from public.order_payments where order_id = (select order_id from _public_cancel_preorder)),
  'payment_cancelled',
  'customer cancel moves payment to cancelled'
);

select is(
  (select stock_reserved from public.event_products where id = (select event_product_id from _preorder_ids)),
  0,
  'customer cancel before payment does not reserve stock'
);

create temp table _reject_preorder as
select *
from public.create_preorder_with_stock(
  (select event_id from _preorder_ids),
  jsonb_build_array(jsonb_build_object('product_id', (select product_id from _preorder_ids), 'quantity', 1)),
  'Reject Customer',
  '',
  '',
  gen_random_uuid(),
  '',
  '@reject',
  'reject@example.com'
);

update _preorder_ids set reject_order_id = (select order_id from _reject_preorder);

select isnt_empty(
  $$ select 1 from public.submit_preorder_payment_evidence(
    (select reject_order_id from _preorder_ids),
    (select pickup_code from _reject_preorder),
    'artist/event/order/slip-reject.png',
    gen_random_uuid()
  ) $$,
  'reject test payment evidence can be submitted'
);

select is(
  (select stock_reserved from public.event_products where id = (select event_product_id from _preorder_ids)),
  1,
  'submitted reject order reserves stock'
);

do $$ begin perform set_preorder_jwt('preorder.other@nireq.local'); end $$;

select throws_ok(
  $$ select * from public.reject_preorder_payment((select reject_order_id from _preorder_ids), 'fake slip') $$,
  'P0001',
  'forbidden',
  'unauthorized user cannot reject payment'
);

do $$ begin perform set_preorder_jwt('preorder.staff@nireq.local'); end $$;

select throws_ok(
  $$ select * from public.reject_preorder_payment((select reject_order_id from _preorder_ids), '') $$,
  'reject_note_required',
  'seller must add a reason before rejecting payment'
);

select results_eq(
  $$ select payment_status, pickup_status from public.reject_preorder_payment((select reject_order_id from _preorder_ids), 'fake slip') $$,
  $$ values ('payment_rejected'::text, 'cancelled'::text) $$,
  'seller can reject submitted payment and cancel preorder'
);

select is(
  (select stock_reserved from public.event_products where id = (select event_product_id from _preorder_ids)),
  0,
  'reject releases reserved stock'
);

select is(
  (select cancel_reason from public.orders where id = (select reject_order_id from _preorder_ids)),
  'fake slip',
  'reject records seller reason on cancelled preorder'
);

select results_eq(
  $$ select payment_status, pickup_status from public.reject_preorder_payment((select reject_order_id from _preorder_ids), 'second click') $$,
  $$ values ('payment_rejected'::text, 'cancelled'::text) $$,
  'rejecting the same payment twice is idempotent'
);

create temp table _expire_submitted_preorder as
select *
from public.create_preorder_with_stock(
  (select event_id from _preorder_ids),
  jsonb_build_array(jsonb_build_object('product_id', (select product_id from _preorder_ids), 'quantity', 1)),
  'Expire Submitted Customer',
  '',
  '',
  gen_random_uuid(),
  '',
  '@expire-submitted',
  'expire-submitted@example.com'
);

update _preorder_ids set expire_submitted_order_id = (select order_id from _expire_submitted_preorder);

select isnt_empty(
  $$ select 1 from public.submit_preorder_payment_evidence(
    (select expire_submitted_order_id from _preorder_ids),
    (select pickup_code from _expire_submitted_preorder),
    'artist/event/order/slip-expire-submitted.png',
    gen_random_uuid()
  ) $$,
  'submitted expiry test payment evidence can be submitted'
);

update public.event_payment_methods
set payment_deadline_at = now() - interval '2 days'
where event_id = (select event_id from _preorder_ids);

do $$ begin perform set_preorder_jwt('preorder.owner@nireq.local'); end $$;

select results_eq(
  $$ select expired_count from public.expire_submitted_preorder_payments((select event_id from _preorder_ids), 0) $$,
  $$ values (1) $$,
  'owner can expire stale submitted payment evidence'
);

select is(
  (select stock_reserved from public.event_products where id = (select event_product_id from _preorder_ids)),
  0,
  'submitted payment expiry releases reserved stock'
);

update public.event_payment_methods
set payment_deadline_at = now() + interval '12 hours'
where event_id = (select event_id from _preorder_ids);

create temp table _expire_pickup_preorder as
select *
from public.create_preorder_with_stock(
  (select event_id from _preorder_ids),
  jsonb_build_array(jsonb_build_object('product_id', (select product_id from _preorder_ids), 'quantity', 1)),
  'Expire Pickup Customer',
  '',
  '',
  gen_random_uuid(),
  '',
  '@expire-pickup',
  'expire-pickup@example.com'
);

update _preorder_ids set expire_pickup_order_id = (select order_id from _expire_pickup_preorder);

select isnt_empty(
  $$ select 1 from public.submit_preorder_payment_evidence(
    (select expire_pickup_order_id from _preorder_ids),
    (select pickup_code from _expire_pickup_preorder),
    'artist/event/order/slip-expire-pickup.png',
    gen_random_uuid()
  ) $$,
  'no-show expiry test payment evidence can be submitted'
);

select isnt_empty(
  $$ select 1 from public.confirm_preorder_payment((select expire_pickup_order_id from _preorder_ids), 'bank checked') $$,
  'no-show expiry test payment can be confirmed'
);

update public.events
set end_date = now() - interval '1 minute',
    selling_mode = 'closed'
where id = (select event_id from _preorder_ids);

select results_eq(
  $$ select expired_count from public.expire_preorders_for_event((select event_id from _preorder_ids)) $$,
  $$ values (1) $$,
  'owner can expire confirmed no-show pre-orders after event end'
);

select is(
  (select stock_reserved from public.event_products where id = (select event_product_id from _preorder_ids)),
  0,
  'no-show expiry releases reserved stock'
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
    $$ select customer_name, customer_contact, customer_phone, customer_social, customer_email from public.orders where id = %L::uuid $$,
    current_setting('test.preorder_order_id')
  ),
  '42501',
  'permission denied for table orders',
  'anonymous users cannot directly select customer-identifying order fields'
);

reset role;
set local role postgres;
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
