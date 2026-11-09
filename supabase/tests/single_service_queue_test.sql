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
select public.call_queue_batch((select event from pos_queue_ids),10,gen_random_uuid());
select public.call_queue_batch((select event from pos_queue_ids),10,gen_random_uuid());
select public.call_queue_batch((select event from pos_queue_ids),10,gen_random_uuid());
select is((select count(*) from public.queues where event_id=(select event from pos_queue_ids) and status='calling'),30::bigint,'subsequent batches retain no-shows');
select public.update_queue_operation(id,'arrive',last_updated_at) from public.queues where event_id=(select event from pos_queue_ids) and queue_number in (28,29,17);
select public.update_queue_operation(id,'serving',last_updated_at) from public.queues where event_id=(select event from pos_queue_ids) and queue_number=28;
select public.update_queue_operation(id,'complete',last_updated_at) from public.queues where event_id=(select event from pos_queue_ids) and queue_number=28;
select is((select count(*) from public.queues where event_id=(select event from pos_queue_ids) and queue_number in (29,17) and status='calling' and arrived_at is not null),2::bigint,'manual completion leaves other ready tickets');
select public.update_queue_operation(id,'serving',last_updated_at) from public.queues where event_id=(select event from pos_queue_ids) and queue_number=29;
select public.update_queue_operation(id,'serving',last_updated_at) from public.queues where event_id=(select event from pos_queue_ids) and queue_number=17;
select is((select status from public.queues where event_id=(select event from pos_queue_ids) and queue_number=29),'complete','starting 17 completes 29');
select is((select status from public.queues where event_id=(select event from pos_queue_ids) and queue_number=17),'serving','17 is serving');
select public.update_queue_operation(id,'complete',last_updated_at) from public.queues where event_id=(select event from pos_queue_ids) and queue_number=17;
select is((select count(*) from public.queues where event_id=(select event from pos_queue_ids) and status='serving'),0::bigint,'manual completion leaves service point empty');
select public.update_queue_operation(id,'arrive',last_updated_at) from public.queues where event_id=(select event from pos_queue_ids) and queue_number=1;
select ok((select arrived_at is not null from public.queues where event_id=(select event from pos_queue_ids) and queue_number=1),'earlier no-show can arrive');
select throws_ok($$select public.update_queue_operation(id,'serving',last_updated_at) from public.queues where event_id=(select event from pos_queue_ids) and queue_number=2$$,'P0001','invalid_queue_transition','start requires arrival');
select set_pos_queue_jwt(foreign_user, 'pos-queue-foreign@example.local') from pos_queue_ids;
select throws_ok($$select public.update_queue_operation(id,'arrive',last_updated_at) from public.queues where event_id=(select event from pos_queue_ids) and queue_number=2$$,'42501','forbidden','foreign staff cannot operate queue');
select set_pos_queue_jwt(artist, 'pos-queue-owner@example.local') from pos_queue_ids;
insert into public.queues(id,artist_id,event_id,queue_number,status,queue_service_date,customer_fingerprint)
select gen_random_uuid(),artist,event,31,'expired',(now() at time zone 'Asia/Bangkok')::date,'legacy-ticket' from pos_queue_ids;
select public.update_queue_operation(id,'arrive',last_updated_at) from public.queues where event_id=(select event from pos_queue_ids) and queue_number=31;
select ok((select status='calling' and arrived_at is not null from public.queues where event_id=(select event from pos_queue_ids) and queue_number=31),'previously expired ticket can return on arrival');
select throws_ok($$select public.leave_queue_ticket((select id from public.queues where event_id=(select event from pos_queue_ids) and queue_number=31),'wrong')$$,'P0001','ticket_ownership_mismatch','customer cannot cancel another ticket');
select ok(public.leave_queue_ticket((select id from public.queues where event_id=(select event from pos_queue_ids) and queue_number=31),'legacy-ticket'),'ticket owner can cancel');
select is((select status from public.queues where event_id=(select event from pos_queue_ids) and queue_number=31),'missed','customer cancellation remains recorded');
select ok(not has_table_privilege('authenticated','public.queues','UPDATE'),'staff cannot bypass queue RPC with direct updates');
insert into public.queues(id,artist_id,event_id,queue_number,status,queue_service_date,last_updated_at)
select gen_random_uuid(),artist,event,32,'calling',(now() at time zone 'Asia/Bangkok')::date,'2099-01-01 00:00:00+00' from pos_queue_ids;
select public.update_queue_operation(id,'arrive',last_updated_at) from public.queues where event_id=(select event from pos_queue_ids) and queue_number=32;
select ok((select last_updated_at > '2099-01-01 00:00:00+00'::timestamptz from public.queues where event_id=(select event from pos_queue_ids) and queue_number=32),'updates remain ordered even if legacy client clocks were ahead');
insert into public.queues(id,artist_id,event_id,queue_number,status,queue_service_date)
select gen_random_uuid(),artist,event,33,'calling',(now() at time zone 'Asia/Bangkok')::date - 1 from pos_queue_ids;
select throws_ok($$select public.update_queue_operation(id,'arrive',last_updated_at) from public.queues where event_id=(select event from pos_queue_ids) and queue_number=33$$,'P0001','queue_not_active_today','prior service day cannot be reactivated');
update public.queues set arrived_at=now() where event_id=(select event from pos_queue_ids) and queue_number=33;
update public.queues set status='serving' where event_id=(select event from pos_queue_ids) and queue_number=33;
select public.update_queue_operation(id,'complete',last_updated_at) from public.queues where event_id=(select event from pos_queue_ids) and queue_number=33;
select is((select status from public.queues where event_id=(select event from pos_queue_ids) and queue_number=33),'complete','a serving ticket carried over from yesterday can be closed');
select * from finish();
rollback;
