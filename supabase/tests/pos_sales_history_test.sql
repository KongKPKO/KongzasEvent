begin;
select no_plan();

create temp table pos_history_ids (
  artist uuid,
  seller uuid,
  queue_staff uuid,
  unrelated uuid,
  event uuid,
  other_event uuid,
  queue uuid,
  product uuid,
  queue_order uuid,
  walkin_order uuid
) on commit drop;

do $$
declare
  v_artist uuid := gen_random_uuid();
  v_seller uuid := gen_random_uuid();
  v_queue_staff uuid := gen_random_uuid();
  v_unrelated uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_other_event uuid := gen_random_uuid();
  v_queue uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_queue_order uuid := gen_random_uuid();
  v_walkin_order uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (v_artist, 'pos-history-owner@example.local', '{}', '{}', 'authenticated', 'authenticated'),
    (v_seller, 'pos-history-seller@example.local', '{}', '{}', 'authenticated', 'authenticated'),
    (v_queue_staff, 'pos-history-queue@example.local', '{}', '{}', 'authenticated', 'authenticated'),
    (v_unrelated, 'pos-history-other@example.local', '{}', '{}', 'authenticated', 'authenticated');

  insert into public.artists (id, slug, display_name)
  values (v_artist, 'pos-history-test', 'POS History Test');

  insert into public.artist_members (artist_id, member_email, role, status)
  values
    (v_artist, 'pos-history-owner@example.local', 'owner', 'active'),
    (v_artist, 'pos-history-seller@example.local', 'seller', 'active'),
    (v_artist, 'pos-history-queue@example.local', 'queue_staff', 'active');

  insert into public.events (id, artist_id, event_name, start_date, end_date, status, is_booth_open)
  values
    (v_event, v_artist, 'POS history event', now() - interval '1 day', now() + interval '1 day', 'Confirmed', true),
    (v_other_event, v_artist, 'Other event', now() - interval '1 day', now() + interval '1 day', 'Confirmed', true);

  insert into public.products (id, artist_id, name, sku, price, currency, status, is_unlimited)
  values (v_product, v_artist, 'Current product name', 'CURRENT-SKU', 120, 'THB', 'enable', true);

  insert into public.queues (id, artist_id, event_id, queue_number, status, queue_service_date)
  values (v_queue, v_artist, v_event, 27, 'complete', current_date);

  insert into public.orders (
    id, event_id, queue_id, status, total_price, subtotal_price, discount_total,
    payment_method, currency, order_type, created_at
  ) values
    (v_queue_order, v_event, v_queue, 'completed', 220, 240, 20, 'cash', 'THB', 'live_queue', now() - interval '2 minutes'),
    (v_walkin_order, v_event, null, 'completed', 120, 120, 0, 'transfer', 'THB', 'pos_walkin', now() - interval '1 minute');

  insert into public.order_items (
    order_id, product_id, quantity, price_per_unit, currency,
    product_name_snapshot, sku_snapshot
  ) values
    (v_queue_order, v_product, 2, 120, 'THB', 'Recorded queue item', 'RECORDED-QUEUE'),
    (v_walkin_order, v_product, 1, 120, 'THB', 'Recorded walk-in item', 'RECORDED-WALKIN');

  insert into public.order_payments (
    order_id, event_id, artist_id, payment_status, amount_expected,
    currency, confirmed_at, refunded_at, refund_note, refund_reference
  ) values (
    v_queue_order, v_event, v_artist, 'refunded', 220,
    'THB', now() - interval '90 seconds', now() - interval '30 seconds',
    'Customer returned the item', 'REF-27'
  );

  insert into pos_history_ids values (
    v_artist, v_seller, v_queue_staff, v_unrelated, v_event, v_other_event,
    v_queue, v_product, v_queue_order, v_walkin_order
  );
end $$;

create or replace function set_pos_history_jwt(p_user uuid, p_email text)
returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_user, 'email', p_email, 'role', 'authenticated')::text,
    true
  );
$$;

select set_pos_history_jwt(artist, 'pos-history-owner@example.local') from pos_history_ids;

select is(
  (public.list_pos_sales_history((select event from pos_history_ids)) ->> 'total')::integer,
  2,
  'owner sees only live POS orders for the selected event'
);

select is(
  public.list_pos_sales_history((select event from pos_history_ids)) #>> '{orders,0,id}',
  (select walkin_order::text from pos_history_ids),
  'history is ordered newest first'
);

select is(
  (public.list_pos_sales_history(
    (select event from pos_history_ids),
    p_search => 'queue #27'
  ) ->> 'total')::integer,
  1,
  'queue-number search uses the queue stored on the order'
);

select is(
  (public.list_pos_sales_history(
    (select event from pos_history_ids),
    p_payment_method => 'transfer'
  ) ->> 'total')::integer,
  1,
  'payment method is filtered on the server'
);

select is(
  (public.list_pos_sales_history(
    (select event from pos_history_ids),
    p_payment_status => 'refunded'
  ) ->> 'total')::integer,
  1,
  'stored refund status is filterable'
);

select is(
  jsonb_array_length(public.list_pos_sales_history(
    (select event from pos_history_ids),
    p_page => 1,
    p_page_size => 1
  ) -> 'orders'),
  1,
  'history is paginated in the database'
);

select is(
  public.get_pos_sale_detail(
    (select event from pos_history_ids),
    (select queue_order from pos_history_ids)
  ) #>> '{items,0,name}',
  'Recorded queue item',
  'detail uses the product name recorded at sale time'
);

select is(
  public.get_pos_sale_detail(
    (select event from pos_history_ids),
    (select queue_order from pos_history_ids)
  ) #>> '{queue_number}',
  '27',
  'detail returns the order queue rather than any active POS selection'
);

select is(
  public.get_pos_sale_detail(
    (select event from pos_history_ids),
    (select queue_order from pos_history_ids)
  ) #>> '{payment,refund_reference}',
  'REF-27',
  'detail exposes stored refund metadata read-only'
);

select set_pos_history_jwt(seller, 'pos-history-seller@example.local') from pos_history_ids;
select lives_ok(
  $$ select public.list_pos_sales_history((select event from pos_history_ids)) $$,
  'seller can inspect sales history for an allowed event'
);

select set_pos_history_jwt(queue_staff, 'pos-history-queue@example.local') from pos_history_ids;
select throws_ok(
  $$ select public.list_pos_sales_history((select event from pos_history_ids)) $$,
  '42501',
  'forbidden',
  'queue staff cannot read POS sales history'
);
select throws_ok(
  $$ select public.get_pos_sale_detail(
       (select event from pos_history_ids),
       (select queue_order from pos_history_ids)
     ) $$,
  '42501',
  'forbidden',
  'queue staff cannot read POS sale detail'
);

select set_pos_history_jwt(unrelated, 'pos-history-other@example.local') from pos_history_ids;
select throws_ok(
  $$ select public.list_pos_sales_history((select event from pos_history_ids)) $$,
  '42501',
  'forbidden',
  'an unrelated authenticated user cannot read event sales'
);

select * from finish();
rollback;
