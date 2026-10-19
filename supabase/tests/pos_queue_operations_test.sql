begin;
select no_plan();

create temp table pos_queue_ids (
  artist uuid,
  manager uuid,
  seller uuid,
  queue_staff uuid,
  unassigned uuid,
  foreign_user uuid,
  event uuid,
  other_event uuid,
  product uuid,
  order_id uuid,
  manager_member uuid,
  seller_member uuid,
  queue_member uuid,
  unassigned_member uuid,
  batch_three_request uuid
) on commit drop;

do $$
declare
  v_artist uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_seller uuid := gen_random_uuid();
  v_queue_staff uuid := gen_random_uuid();
  v_unassigned uuid := gen_random_uuid();
  v_foreign uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_other_event uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_manager_member uuid := gen_random_uuid();
  v_seller_member uuid := gen_random_uuid();
  v_queue_member uuid := gen_random_uuid();
  v_unassigned_member uuid := gen_random_uuid();
  v_batch_three_request uuid := gen_random_uuid();
  v_service_date date := (now() at time zone 'Asia/Bangkok')::date;
begin
  insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (v_artist, 'pos-queue-owner@example.local', '{}', '{}', 'authenticated', 'authenticated'),
    (v_manager, 'pos-queue-manager@example.local', '{}', '{}', 'authenticated', 'authenticated'),
    (v_seller, 'pos-queue-seller@example.local', '{}', '{}', 'authenticated', 'authenticated'),
    (v_queue_staff, 'pos-queue-staff@example.local', '{}', '{}', 'authenticated', 'authenticated'),
    (v_unassigned, 'pos-queue-unassigned@example.local', '{}', '{}', 'authenticated', 'authenticated'),
    (v_foreign, 'pos-queue-foreign@example.local', '{}', '{}', 'authenticated', 'authenticated');

  insert into public.artists (id, slug, display_name)
  values
    (v_artist, 'pos-queue-operations', 'POS queue operations'),
    (v_foreign, 'pos-queue-foreign', 'Foreign POS queue user');

  insert into public.artist_members (id, artist_id, member_email, role, status)
  values
    (v_manager_member, v_artist, 'pos-queue-manager@example.local', 'manager', 'active'),
    (v_seller_member, v_artist, 'pos-queue-seller@example.local', 'seller', 'active'),
    (v_queue_member, v_artist, 'pos-queue-staff@example.local', 'queue_staff', 'active'),
    (v_unassigned_member, v_artist, 'pos-queue-unassigned@example.local', 'seller', 'active');

  insert into public.events (
    id, artist_id, event_name, start_date, end_date, event_timezone, status, is_booth_open
  ) values
    (v_event, v_artist, 'POS queue event', now() - interval '1 hour', now() + interval '1 day', 'Asia/Bangkok', 'Confirmed', true),
    (v_other_event, v_artist, 'Other assigned event', now() - interval '1 hour', now() + interval '1 day', 'Asia/Bangkok', 'Confirmed', true);

  insert into public.event_member_assignments (artist_id, event_id, member_id)
  values
    (v_artist, v_event, v_manager_member),
    (v_artist, v_event, v_seller_member),
    (v_artist, v_event, v_queue_member),
    (v_artist, v_other_event, v_unassigned_member);

  insert into public.products (
    id, artist_id, name, sku, price, currency, stock_total, is_unlimited, status
  ) values (
    v_product, v_artist, 'Queue POS item', 'QUEUE-POS-ITEM', 100, 'THB', 50, false, 'enable'
  );

  insert into public.event_products (
    event_id, product_id, artist_id, stock_total, is_unlimited, is_enabled
  ) values (
    v_event, v_product, v_artist, 50, false, true
  );

  insert into public.queues (
    id, artist_id, event_id, queue_number, status, queue_service_date, created_at
  )
  select
    gen_random_uuid(), v_artist, v_event, n, 'waiting', v_service_date,
    now() + make_interval(secs => n)
  from generate_series(1, 30) n;

  insert into public.orders (
    id, event_id, queue_id, status, total_price, subtotal_price,
    discount_total, currency, order_type
  )
  select
    v_order, v_event, q.id, 'draft', 100, 100, 0, 'THB', 'live_queue'
  from public.queues q
  where q.event_id = v_event and q.queue_number = 30;

  insert into pos_queue_ids values (
    v_artist, v_manager, v_seller, v_queue_staff, v_unassigned, v_foreign,
    v_event, v_other_event, v_product, v_order,
    v_manager_member, v_seller_member, v_queue_member, v_unassigned_member,
    v_batch_three_request
  );
end $$;

create or replace function set_pos_queue_jwt(p_user uuid, p_email text)
returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_user, 'email', p_email, 'role', 'authenticated')::text,
    true
  );
$$;

select set_pos_queue_jwt(artist, 'pos-queue-owner@example.local') from pos_queue_ids;
set local role authenticated;
select lives_ok(
  $$ select arrived_at from public.queues limit 1 $$,
  'authenticated clients may read arrived_at directly'
);
select throws_ok(
  $$ select customer_fingerprint from public.queues limit 1 $$,
  '42501', 'permission denied for table queues',
  'the protected customer fingerprint remains unreadable to authenticated clients'
);
reset role;
select results_eq(
  $$ select (value ->> 'queue_number')::bigint
     from jsonb_array_elements(public.call_queue_batch(
       (select event from pos_queue_ids), 1, gen_random_uuid()
     )) as ticket(value) order by (value ->> 'queue_number')::bigint $$,
  $$ values (1::bigint) $$,
  'owner can call the next queue'
);

select set_pos_queue_jwt(manager, 'pos-queue-manager@example.local') from pos_queue_ids;
select results_eq(
  $$ select (value ->> 'queue_number')::bigint
     from jsonb_array_elements(public.call_queue_batch(
       (select event from pos_queue_ids), 1, gen_random_uuid()
     )) as ticket(value) order by (value ->> 'queue_number')::bigint $$,
  $$ values (2::bigint) $$,
  'assigned manager can call the next queue'
);

select set_pos_queue_jwt(seller, 'pos-queue-seller@example.local') from pos_queue_ids;
select results_eq(
  $$ select (value ->> 'queue_number')::bigint
     from jsonb_array_elements(public.call_queue_batch(
       (select event from pos_queue_ids), 1, gen_random_uuid()
     )) as ticket(value) order by (value ->> 'queue_number')::bigint $$,
  $$ values (3::bigint) $$,
  'assigned seller can call the next queue'
);

select set_pos_queue_jwt(queue_staff, 'pos-queue-staff@example.local') from pos_queue_ids;
select results_eq(
  $$ select (value ->> 'queue_number')::bigint
     from jsonb_array_elements(public.call_queue_batch(
       (select event from pos_queue_ids), 1, gen_random_uuid()
     )) as ticket(value) order by (value ->> 'queue_number')::bigint $$,
  $$ values (4::bigint) $$,
  'assigned queue staff can call the next queue'
);

select set_pos_queue_jwt(unassigned, 'pos-queue-unassigned@example.local') from pos_queue_ids;
select throws_ok(
  $$ select public.call_queue_batch((select event from pos_queue_ids), 1, gen_random_uuid()) $$,
  '42501', 'forbidden',
  'staff assigned only to another event cannot call this event'
);

select set_pos_queue_jwt(foreign_user, 'pos-queue-foreign@example.local') from pos_queue_ids;
select throws_ok(
  $$ select public.call_queue_batch((select event from pos_queue_ids), 1, gen_random_uuid()) $$,
  '42501', 'forbidden',
  'a foreign artist cannot call this event'
);

select set_pos_queue_jwt(artist, 'pos-queue-owner@example.local') from pos_queue_ids;
select results_eq(
  $$ select (value ->> 'queue_number')::bigint
     from jsonb_array_elements(public.call_queue_batch(
       (select event from pos_queue_ids), 3,
       (select batch_three_request from pos_queue_ids)
     )) as ticket(value) order by (value ->> 'queue_number')::bigint $$,
  $$ values (5::bigint), (6::bigint), (7::bigint) $$,
  'batch 3 selects the next three queues in queue-number order'
);

insert into public.queues (
  id, artist_id, event_id, queue_number, status, queue_service_date
)
select
  gen_random_uuid(), artist, event, 0, 'waiting',
  (now() at time zone 'Asia/Bangkok')::date
from pos_queue_ids;

select results_eq(
  $$ select (value ->> 'queue_number')::bigint
     from jsonb_array_elements(public.call_queue_batch(
       (select event from pos_queue_ids), 3,
       (select batch_three_request from pos_queue_ids)
     )) as ticket(value) order by (value ->> 'queue_number')::bigint $$,
  $$ values (5::bigint), (6::bigint), (7::bigint) $$,
  'replaying a batch request returns the original tickets'
);

select ok(
  not exists (
    select 1
    from jsonb_array_elements(public.call_queue_batch(
      (select event from pos_queue_ids), 3,
      (select batch_three_request from pos_queue_ids)
    )) as ticket(value)
    where value ? 'customer_fingerprint'
  ),
  'batch results use a safe projection without customer fingerprints'
);

select is(
  (select status from public.queues
   where event_id = (select event from pos_queue_ids) and queue_number = 0),
  'waiting',
  'replaying a batch request does not consume another waiting queue'
);

select throws_ok(
  $$ select public.call_queue_batch(
       (select event from pos_queue_ids), 5,
       (select batch_three_request from pos_queue_ids)
     ) $$,
  'P0001', 'batch_request_mismatch',
  'a request id cannot be replayed with a different batch size'
);

update public.queues
set status = 'missed', last_updated_at = now()
where event_id = (select event from pos_queue_ids) and queue_number = 0;

select results_eq(
  $$ select (value ->> 'queue_number')::bigint
     from jsonb_array_elements(public.call_queue_batch(
       (select event from pos_queue_ids), 5, gen_random_uuid()
     )) as ticket(value) order by (value ->> 'queue_number')::bigint $$,
  $$ values (8::bigint), (9::bigint), (10::bigint), (11::bigint), (12::bigint) $$,
  'batch 5 selects exactly the next five queues in order'
);

select results_eq(
  $$ select (value ->> 'queue_number')::bigint
     from jsonb_array_elements(public.call_queue_batch(
       (select event from pos_queue_ids), 10, gen_random_uuid()
     )) as ticket(value) order by (value ->> 'queue_number')::bigint $$,
  $$ values
       (13::bigint), (14::bigint), (15::bigint), (16::bigint), (17::bigint),
       (18::bigint), (19::bigint), (20::bigint), (21::bigint), (22::bigint) $$,
  'batch 10 selects exactly the next ten queues in order'
);

select throws_ok(
  $$ select public.call_queue_batch((select event from pos_queue_ids), 2, gen_random_uuid()) $$,
  'P0001', 'invalid_batch',
  'only supported batch sizes are accepted'
);

select set_pos_queue_jwt(queue_staff, 'pos-queue-staff@example.local') from pos_queue_ids;
select ok(
  not (public.update_queue_operation(
       (select id from public.queues where event_id = (select event from pos_queue_ids) and queue_number = 2),
       'arrive',
       (select last_updated_at from public.queues where event_id = (select event from pos_queue_ids) and queue_number = 2)
     ) ? 'customer_fingerprint'),
  'queue staff can mark queue 2 arrived and receives no customer fingerprint'
);

select is(
  (select status from public.queues where event_id = (select event from pos_queue_ids) and queue_number = 2),
  'calling',
  'arrival metadata does not change the queue from calling'
);
select ok(
  (select arrived_at is not null and served_at is null from public.queues
   where event_id = (select event from pos_queue_ids) and queue_number = 2),
  'arrival records arrived_at without recording service'
);
select ok(
  (select arrived_at is null and status = 'calling' from public.queues
   where event_id = (select event from pos_queue_ids) and queue_number = 1),
  'queue 1 remains called when queue 2 arrives first'
);

create temp table pos_queue_arrival as
select id, arrived_at
from public.queues
where event_id = (select event from pos_queue_ids) and queue_number = 2;

select lives_ok(
  $$ select public.update_queue_operation(
       (select id from pos_queue_arrival), 'serving',
       (select last_updated_at from public.queues where id = (select id from pos_queue_arrival))
     ) $$,
  'queue staff can explicitly start serving an arrived queue'
);
select ok(
  (select q.status = 'serving'
          and q.served_at is not null
          and q.arrived_at = a.arrived_at
   from public.queues q join pos_queue_arrival a using (id)),
  'serving is distinct from arrival and preserves the original arrival time'
);

create temp table pos_queue_stale as
select id, last_updated_at
from public.queues
where event_id = (select event from pos_queue_ids) and queue_number = 1;

select lives_ok(
  $$ select public.update_queue_operation(
       (select id from pos_queue_stale), 'recall',
       (select last_updated_at from pos_queue_stale)
     ) $$,
  'recall succeeds with the current queue version'
);
select throws_ok(
  $$ select public.update_queue_operation(
       (select id from pos_queue_stale), 'arrive',
       '2000-01-01 00:00:00+00'::timestamptz
     ) $$,
  'P0001', 'queue_changed',
  'a stale queue action is rejected'
);

select throws_ok(
  $$ select public.update_queue_operation(
       (select id from public.queues where event_id = (select event from pos_queue_ids) and queue_number = 23),
       'arrive',
       (select last_updated_at from public.queues where event_id = (select event from pos_queue_ids) and queue_number = 23)
     ) $$,
  'P0001', 'invalid_queue_transition',
  'an invalid action for the current queue state is rejected'
);

select lives_ok(
  $$ select public.update_queue_operation(
       (select id from public.queues where event_id = (select event from pos_queue_ids) and queue_number = 3),
       'arrive',
       (select last_updated_at from public.queues where event_id = (select event from pos_queue_ids) and queue_number = 3)
     ) $$,
  'a called queue can be marked arrived before expiry runs'
);
update public.queues
set status = 'expired', last_updated_at = now()
where event_id = (select event from pos_queue_ids) and queue_number = 3;
select ok(
  (select status = 'calling' and arrived_at is not null
   from public.queues
   where event_id = (select event from pos_queue_ids) and queue_number = 3),
  'the expiry guard keeps an arrived queue active'
);

select set_pos_queue_jwt(unassigned, 'pos-queue-unassigned@example.local') from pos_queue_ids;
select throws_ok(
  $$ select public.update_queue_operation(
       (select id from public.queues where event_id = (select event from pos_queue_ids) and queue_number = 4),
       'arrive',
       (select last_updated_at from public.queues where event_id = (select event from pos_queue_ids) and queue_number = 4)
     ) $$,
  '42501', 'forbidden',
  'staff assigned only to another event cannot update this event queue'
);

select set_pos_queue_jwt(foreign_user, 'pos-queue-foreign@example.local') from pos_queue_ids;
select throws_ok(
  $$ select public.update_queue_operation(
       (select id from public.queues where event_id = (select event from pos_queue_ids) and queue_number = 4),
       'arrive',
       (select last_updated_at from public.queues where event_id = (select event from pos_queue_ids) and queue_number = 4)
     ) $$,
  '42501', 'forbidden',
  'a foreign artist cannot update this event queue'
);

select set_pos_queue_jwt(queue_staff, 'pos-queue-staff@example.local') from pos_queue_ids;
select throws_ok(
  $$ select public.list_pos_sales_history((select event from pos_queue_ids)) $$,
  '42501', 'forbidden',
  'queue staff cannot read POS sales history'
);
select throws_ok(
  $$ select public.get_pos_sale_detail(
       (select event from pos_queue_ids), (select order_id from pos_queue_ids)
     ) $$,
  '42501', 'forbidden',
  'queue staff cannot read POS sale details'
);
select throws_ok(
  $$ select public.quote_pos_order(
       (select event from pos_queue_ids), (select order_id from pos_queue_ids),
       jsonb_build_array(jsonb_build_object('product_id', (select product from pos_queue_ids), 'quantity', 1))
     ) $$,
  'P0001', 'forbidden',
  'queue staff cannot quote a POS order'
);
select throws_ok(
  $$ select public.get_pos_catalog_for_order(
       (select event from pos_queue_ids), (select order_id from pos_queue_ids)
     ) $$,
  'P0001', 'forbidden',
  'queue staff cannot read the POS order catalog'
);
select throws_ok(
  $$ select public.create_walkin_order_with_stock(
       (select event from pos_queue_ids),
       jsonb_build_array(jsonb_build_object('product_id', (select product from pos_queue_ids), 'quantity', 1)),
       'cash'
     ) $$,
  'P0001', 'forbidden',
  'queue staff cannot create a walk-in POS sale'
);
select throws_ok(
  $$ select public.complete_order_with_stock(
       (select order_id from pos_queue_ids), 'cash'
     ) $$,
  'P0001', 'forbidden',
  'queue staff cannot complete a POS sale'
);

-- Timed post-order sales do not reopen physical event queue intake.
update public.events set start_date=now()-interval '2 hours',end_date=now()-interval '1 hour',is_booth_open=true,
 postorder_enabled=true,postorder_opens_at=now()-interval '30 minutes',postorder_closes_at=now()+interval '1 day'
where id=(select event from pos_queue_ids);
select throws_ok($$select * from public.create_queue_ticket((select artist from pos_queue_ids),(select event from pos_queue_ids),'ended-event-fingerprint')$$,'P0001','event_not_in_window','ended event rejects queue intake even while post-order is enabled and booth is open');
update public.events set status='Ended' where id=(select event from pos_queue_ids);
select throws_ok($$select * from public.create_queue_ticket((select artist from pos_queue_ids),(select event from pos_queue_ids),'ended-event-fingerprint')$$,'P0001','event_not_active','explicitly ended event rejects new queue tickets');

select * from finish();
rollback;
