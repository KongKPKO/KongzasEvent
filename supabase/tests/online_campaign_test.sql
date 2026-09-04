begin;

select plan(52);

select has_table('public', 'online_campaigns', 'online campaigns are separate from events');
select has_table('public', 'online_campaign_products', 'campaign allocations have dedicated stock');
select has_column('public', 'online_campaign_products', 'max_quantity_per_order', 'campaign products can limit quantity per order');
select has_table('public', 'campaign_pickup_points', 'campaign pickup points are selectable');
select has_table('public', 'campaign_payment_methods', 'campaign payment instructions are separate');
select has_function('public', 'get_public_online_campaign', array['text', 'text']);
select has_function('public', 'create_online_campaign_order', array['uuid', 'jsonb', 'text', 'uuid', 'text', 'text', 'text', 'text', 'text', 'uuid']);
select has_function('public', 'begin_online_payment_upload', array['text', 'text']);
select has_function('public', 'submit_online_payment_evidence', array['text', 'text', 'text', 'uuid']);
select has_function('public', 'get_public_online_order_by_code', array['text', 'text']);
select has_function('public', 'confirm_online_payment', array['uuid', 'text']);
select has_function('public', 'accept_late_online_payment', array['uuid', 'text']);
select has_function('private', 'expire_online_campaign_holds', array[]::text[]);
select has_column(
  'public',
  'products',
  'sku_is_generated',
  'products record whether an SKU is automatic'
);

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_artist uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_campaign uuid := gen_random_uuid();
  v_campaign_product uuid := gen_random_uuid();
  v_pickup uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, aud, role
  ) values (
    v_owner, 'campaign.owner@nireq.local', 'x', now(), now(), now(),
    '{}', '{}', 'authenticated', 'authenticated'
  );

  insert into public.artists (id, slug, display_name, is_public, is_verified, published_at)
  values (v_artist, 'campaign-test-artist', 'Campaign Test Artist', true, true, now());

  insert into public.artist_members (artist_id, member_email, role, status)
  values (v_artist, 'campaign.owner@nireq.local', 'owner', 'active');

  insert into public.products (
    id, artist_id, name, category, price, currency, stock_total,
    stock_reserved, stock_sold, is_unlimited, status
  ) values (
    v_product, v_artist, 'Campaign Cheki', 'Cheki', 100, 'THB', 5,
    0, 0, false, 'enable'
  );

  insert into public.online_campaigns (
    id, artist_id, name, slug, opens_at, closes_at, currency,
    shipping_enabled, flat_shipping_fee, pickup_enabled, publication_status
  ) values (
    v_campaign, v_artist, 'Cheki Online', 'cheki-online',
    now() - interval '1 hour', now() + interval '1 day', 'THB',
    true, 40, true, 'published'
  );

  insert into public.online_campaign_products (
    id, campaign_id, product_id, artist_id, stock_total,
    stock_reserved, stock_sold, is_unlimited, is_enabled, max_quantity_per_order
  ) values (
    v_campaign_product, v_campaign, v_product, v_artist,
    5, 0, 0, false, true, 2
  );

  insert into public.campaign_pickup_points (
    id, campaign_id, artist_id, name, address, starts_at, ends_at
  ) values (
    v_pickup, v_campaign, v_artist, 'Siam pickup', 'Siam Square',
    now() + interval '2 days', now() + interval '2 days 2 hours'
  );

  insert into public.campaign_payment_methods (
    campaign_id, artist_id, method_type, display_name, promptpay_id
  ) values (v_campaign, v_artist, 'promptpay', 'PromptPay', '0812345678');

  create temp table _campaign_ids (
    owner_id uuid,
    artist_id uuid,
    product_id uuid,
    campaign_id uuid,
    campaign_product_id uuid,
    pickup_point_id uuid,
    shipping_order_id uuid,
    shipping_order_code text,
    expired_order_id uuid,
    expired_order_code text
  ) on commit drop;

  insert into _campaign_ids values (
    v_owner, v_artist, v_product, v_campaign, v_campaign_product, v_pickup,
    null, null, null, null
  );
end $$;

insert into public.products (
  artist_id, name, category, variant_name, sku, price, currency, stock_total,
  stock_reserved, stock_sold, is_unlimited, status
) values
  ((select artist_id from _campaign_ids), 'Cheki HSR SW999', 'Cheki', null, null, 350, 'THB', 1, 0, 0, false, 'enable'),
  ((select artist_id from _campaign_ids), 'Cheki HSR Yaoguang Normal', 'Cheki', 'Normal', null, 350, 'THB', 1, 0, 0, false, 'enable'),
  ((select artist_id from _campaign_ids), 'Cheki HSR Yaoguang SP', 'Cheki', 'SP', null, 400, 'THB', 1, 0, 0, false, 'enable'),
  ((select artist_id from _campaign_ids), 'Hairclip Keito', 'Hairclip', null, null, 200, 'THB', 1, 0, 0, false, 'enable'),
  ((select artist_id from _campaign_ids), 'Manual SKU Product', 'Other', null, 'first-manual', 100, 'THB', 1, 0, 0, false, 'enable');

update public.products
set sku = 'my-own-7'
where artist_id = (select artist_id from _campaign_ids)
  and name = 'Manual SKU Product';

select ok(
  (select sku ~ '^CHE-SW999-[0-9]{3}$' from public.products where name = 'Cheki HSR SW999'),
  'SW999 keeps meaningful digits in a compact automatic SKU'
);

select ok(
  (select sku ~ '^CHE-YAOG-N-[0-9]{3}$' from public.products where name = 'Cheki HSR Yaoguang Normal'),
  'Normal becomes the compact N option code'
);

select ok(
  (select sku ~ '^CHE-YAOG-SP-[0-9]{3}$' from public.products where name = 'Cheki HSR Yaoguang SP'),
  'SP remains an explicit compact option code'
);

select ok(
  (select sku ~ '^HCL-KEIT-[0-9]{3}$' from public.products where name = 'Hairclip Keito'),
  'alphabetic item names use four readable characters'
);

select is(
  (select sku from public.products where name = 'Manual SKU Product'),
  'MY-OWN-7',
  'manual SKU remains unchanged apart from normalization'
);

select ok(
  (select sku_is_generated from public.products where name = 'Cheki HSR SW999'),
  'blank SKU is marked generated'
);

select isnt(
  (select sku_is_generated from public.products where name = 'Manual SKU Product'),
  true,
  'seller-provided SKU is marked manual'
);

create temp table _automatic_sku_before as
select sku
from public.products
where name = 'Cheki HSR SW999';

update public.products
set name = 'Cheki HSR SW999 Renamed'
where artist_id = (select artist_id from _campaign_ids)
  and name = 'Cheki HSR SW999';

select is(
  (select sku from public.products where name = 'Cheki HSR SW999 Renamed'),
  (select sku from _automatic_sku_before),
  'renaming a product does not regenerate its automatic SKU'
);

update public.products
set sku = sku
where artist_id = (select artist_id from _campaign_ids)
  and name = 'Manual SKU Product';

select isnt(
  (select sku_is_generated from public.products where name = 'Manual SKU Product'),
  true,
  'submitting the unchanged manual SKU preserves manual ownership'
);

update public.products
set sku = null
where artist_id = (select artist_id from _campaign_ids)
  and name = 'Manual SKU Product';

select ok(
  (select sku_is_generated and sku ~ '^OTH-MANU-[0-9]{3}$'
   from public.products where name = 'Manual SKU Product'),
  'clearing an SKU regenerates it and restores automatic ownership'
);

insert into public.products (
  artist_id, name, category, price, currency, stock_total,
  stock_reserved, stock_sold, is_unlimited, status
) values
  ((select artist_id from _campaign_ids), 'Hairclip Batch', 'Hairclip', 100, 'THB', 1, 0, 0, false, 'enable'),
  ((select artist_id from _campaign_ids), 'Hairclip Batch', 'Hairclip', 100, 'THB', 1, 0, 0, false, 'enable');

select is(
  (select count(distinct sku) from public.products
   where artist_id = (select artist_id from _campaign_ids)
     and name = 'Hairclip Batch'),
  2::bigint,
  'a multi-row blank-SKU insert remains unique within one artist'
);

update public.products
set sku = 'CAT-DUP-001'
where artist_id = (select artist_id from _campaign_ids)
  and name = 'Manual SKU Product';

insert into public.artists (id, slug, display_name, is_public)
values ('44444444-4444-4444-8444-444444444444'::uuid, 'second-sku-artist', 'Second SKU Artist', false);

select lives_ok(
  $$ insert into public.products (
       artist_id, name, category, sku, price, currency, stock_total,
       stock_reserved, stock_sold, is_unlimited, status
     ) values (
       '44444444-4444-4444-8444-444444444444'::uuid,
       'Other shop product', 'Other', 'CAT-DUP-001', 100, 'THB', 1,
       0, 0, false, 'enable'
     ) $$,
  'different artists may use the same SKU'
);

insert into public.events (id, artist_id, event_name, start_date, end_date, status)
values (
  '33333333-3333-4333-8333-333333333333'::uuid,
  (select artist_id from _campaign_ids),
  'Competing stock event', now(), now() + interval '1 day', 'Confirmed'
);

select throws_ok(
  $$ insert into public.event_products (
       event_id, product_id, artist_id, stock_total, stock_reserved,
       stock_sold, is_unlimited, is_enabled
     ) values (
       '33333333-3333-4333-8333-333333333333'::uuid,
       (select product_id from _campaign_ids),
       (select artist_id from _campaign_ids),
       1, 0, 0, false, true
     ) $$,
  'event_stock_exceeds_catalog_stock',
  'event allocation includes stock already allocated to an online campaign'
);

create or replace function set_campaign_jwt(p_email text) returns void as $$
declare
  v_uid uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(p_email) limit 1;
  perform set_config(
    'request.jwt.claims',
    json_build_object('email', p_email, 'sub', v_uid::text, 'role', 'authenticated')::text,
    true
  );
end;
$$ language plpgsql;

select set_campaign_jwt('campaign.owner@nireq.local');

select is(
  public.get_online_campaign_workspace((select campaign_id from _campaign_ids))
    #>> '{catalog,0,category}',
  'Cheki',
  'campaign workspace includes the catalog product category'
);

select is(
  public.get_online_campaign_workspace((select campaign_id from _campaign_ids))
    #>> '{products,0,max_quantity_per_order}',
  '2',
  'campaign workspace includes the product order limit'
);

select results_eq(
  $$ select allocated, available
     from public.list_product_stock_summaries((select artist_id from _campaign_ids))
     where product_id = (select product_id from _campaign_ids) $$,
  $$ values (5, 0) $$,
  'catalog stock summary includes active online campaign allocation'
);

select set_config('request.jwt.claims', '{}'::text, true);

select is(
  public.get_public_online_campaign('campaign-test-artist', 'cheki-online') ->> 'state',
  'open',
  'published campaign in its window is open'
);

select is(
  public.get_public_online_campaign('campaign-test-artist', 'cheki-online')
    #>> '{products,0,max_quantity_per_order}',
  '2',
  'public campaign includes the product order limit'
);

create temp table _shipping_order as
select * from public.create_online_campaign_order(
  (select campaign_id from _campaign_ids),
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from _campaign_ids), 'quantity', 2
  )),
  'shipping', null, 'Shipping Buyer', 'shipping@example.com',
  '0800000000', 'Bangkok', '',
  '11111111-1111-4111-8111-111111111111'::uuid
);

update _campaign_ids
set shipping_order_id = (select order_id from _shipping_order),
    shipping_order_code = (select order_code from _shipping_order);

select results_eq(
  $$ select subtotal_price, shipping_fee, total_price, discount_total
     from public.orders where id = (select shipping_order_id from _campaign_ids) $$,
  $$ values (200::numeric, 40::numeric, 240::numeric, 0::numeric) $$,
  'shipping adds the flat fee once and no promotion discount'
);

select is(
  (select stock_reserved from public.online_campaign_products
   where id = (select campaign_product_id from _campaign_ids)),
  2,
  'checkout reserves campaign stock'
);

select throws_ok(
  $$ select * from public.create_online_campaign_order(
    (select campaign_id from _campaign_ids),
    jsonb_build_array(jsonb_build_object(
      'product_id', (select product_id from _campaign_ids), 'quantity', 3
    )),
    'shipping', null, 'Limited Buyer', 'limited@example.com',
    '0800000098', 'Bangkok', '', gen_random_uuid()
  ) $$,
  'campaign_product_order_limit_exceeded',
  'checkout rejects a quantity above the campaign product order limit'
);

select is(
  (select stock_reserved from public.online_campaign_products
   where id = (select campaign_product_id from _campaign_ids)),
  2,
  'rejected quantity does not reserve campaign stock'
);

update public.online_campaign_products
set max_quantity_per_order = null
where id = (select campaign_product_id from _campaign_ids);

select ok(
  (select stock_hold_expires_at between now() + interval '14 minutes'
    and now() + interval '16 minutes'
   from public.order_payments
   where order_id = (select shipping_order_id from _campaign_ids)),
  'checkout creates a 15-minute hold'
);

create temp table _shipping_retry as
select * from public.create_online_campaign_order(
  (select campaign_id from _campaign_ids),
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from _campaign_ids), 'quantity', 2
  )),
  'shipping', null, 'Shipping Buyer', 'shipping@example.com',
  '0800000000', 'Bangkok', '',
  '11111111-1111-4111-8111-111111111111'::uuid
);

select results_eq(
  $$ select (select order_id from _shipping_retry),
            (select stock_reserved from public.online_campaign_products
             where id = (select campaign_product_id from _campaign_ids)) $$,
  $$ select (select shipping_order_id from _campaign_ids), 2 $$,
  'idempotent retry returns one order and one reservation'
);

create temp table _upload_grace as
select * from public.begin_online_payment_upload(
  'campaign-test-artist',
  (select shipping_order_code from _campaign_ids)
);

select ok(
  (select upload_grace_expires_at <= stock_hold_expires_at + interval '2 minutes'
   from public.order_payments
   where order_id = (select shipping_order_id from _campaign_ids)),
  'upload grace is capped at two minutes'
);

create temp table _submitted as
select * from public.submit_online_payment_evidence(
  'campaign-test-artist',
  (select shipping_order_code from _campaign_ids),
  'campaign/order/shipping-slip.png',
  '22222222-2222-4222-8222-222222222222'::uuid
);

select results_eq(
  $$ select payment_status, stock_remains_reserved from _submitted $$,
  $$ values ('payment_submitted'::text, true) $$,
  'on-time evidence keeps stock reserved'
);

select set_campaign_jwt('campaign.owner@nireq.local');

select is(
  public.confirm_online_payment(
    (select shipping_order_id from _campaign_ids), 'bank checked'
  ) ->> 'payment_status',
  'payment_confirmed',
  'owner confirms submitted payment'
);

select results_eq(
  $$ select stock_reserved, stock_sold
     from public.online_campaign_products
     where id = (select campaign_product_id from _campaign_ids) $$,
  $$ values (0, 2) $$,
  'confirmation converts reserved stock to sold'
);

select set_config('request.jwt.claims', '{}'::text, true);

create temp table _expired_order as
select * from public.create_online_campaign_order(
  (select campaign_id from _campaign_ids),
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from _campaign_ids), 'quantity', 1
  )),
  'shipping', null, 'Late Buyer', 'late@example.com',
  '0800000001', 'Chiang Mai', '', gen_random_uuid()
);

update _campaign_ids
set expired_order_id = (select order_id from _expired_order),
    expired_order_code = (select order_code from _expired_order);

update public.order_payments
set stock_hold_expires_at = now() - interval '1 second'
where order_id = (select expired_order_id from _campaign_ids);

select results_eq(
  $$ select expired_count, released_stock_count
     from private.expire_online_campaign_holds() $$,
  $$ values (1, 1) $$,
  'expiry releases an abandoned hold'
);

create temp table _late_submission as
select * from public.submit_online_payment_evidence(
  'campaign-test-artist',
  (select expired_order_code from _campaign_ids),
  'campaign/order/late-slip.png',
  gen_random_uuid()
);

select results_eq(
  $$ select payment_status, stock_remains_reserved from _late_submission $$,
  $$ values ('payment_submitted_late'::text, false) $$,
  'late evidence never reserves stock'
);

select is(
  (select stock_reserved from public.online_campaign_products
   where id = (select campaign_product_id from _campaign_ids)),
  0,
  'late report leaves stock available'
);

select set_campaign_jwt('campaign.owner@nireq.local');

select is(
  public.accept_late_online_payment(
    (select expired_order_id from _campaign_ids), 'stock still available'
  ) ->> 'payment_status',
  'payment_confirmed',
  'merchant explicitly accepts a late payment'
);

select results_eq(
  $$ select stock_reserved, stock_sold
     from public.online_campaign_products
     where id = (select campaign_product_id from _campaign_ids) $$,
  $$ values (0, 3) $$,
  'late acceptance moves availability directly to sold'
);

select set_config('request.jwt.claims', '{}'::text, true);

create temp table _pickup_order as
select * from public.create_online_campaign_order(
  (select campaign_id from _campaign_ids),
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from _campaign_ids), 'quantity', 1
  )),
  'pickup', (select pickup_point_id from _campaign_ids),
  'Pickup Buyer', 'pickup@example.com', '0800000002', '', '', gen_random_uuid()
);

select is(
  (select shipping_fee from _pickup_order),
  0::numeric,
  'pickup has zero shipping fee'
);

select throws_ok(
  $$ select * from public.create_online_campaign_order(
    (select campaign_id from _campaign_ids),
    jsonb_build_array(jsonb_build_object(
      'product_id', (select product_id from _campaign_ids), 'quantity', 99
    )),
    'shipping', null, 'Oversell', 'oversell@example.com',
    '0800000099', 'Bangkok', '', gen_random_uuid()
  ) $$,
  'insufficient_stock',
  'finite campaign stock cannot oversell'
);

select is(
  public.get_public_online_order_by_code(
    'campaign-test-artist',
    (select expired_order_code from _campaign_ids)
  ) ->> 'payment_status',
  'payment_confirmed',
  'public order status survives campaign flow changes'
);

create temp table _sku_snapshot_before as
select sku_snapshot
from public.order_items
where order_id = (select shipping_order_id from _campaign_ids)
limit 1;

update public.products
set sku = 'CHE-RENAMED-999'
where id = (select product_id from _campaign_ids);

select is(
  (select sku_snapshot from public.order_items
   where order_id = (select shipping_order_id from _campaign_ids)
   limit 1),
  (select sku_snapshot from _sku_snapshot_before),
  'historical order SKU snapshot does not change with the catalog SKU'
);

select throws_ok(
  $$ insert into public.orders (
    event_id, campaign_id, order_type, currency
  ) values (
    null, null, 'online_sale', 'THB'
  ) $$,
  '23514',
  null,
  'order must belong to exactly one Event or Campaign'
);

select * from finish();

rollback;
