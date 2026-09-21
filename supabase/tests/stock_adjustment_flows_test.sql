begin;
select plan(20);

do $$
declare
  v_owner_id uuid := gen_random_uuid();
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
    (v_owner_id, 'stock.owner@nireq.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_other_id, 'stock.other@nireq.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated');

  insert into public.artists (id, slug, display_name)
  values (v_artist_id, 'stock-test-artist', 'Stock Test Artist');

  insert into public.artist_members (artist_id, member_email, role, status)
  values (v_artist_id, 'stock.owner@nireq.local', 'owner', 'active');

  insert into public.products (
    id, artist_id, name, price, stock_total, stock_reserved, stock_sold, is_unlimited
  )
  values (v_product_id, v_artist_id, 'Finite Stock Product', 100, 20, 0, 0, false);

  insert into public.events (id, artist_id, event_name, start_date, end_date, status)
  values (v_event_id, v_artist_id, 'Stock Event', now() - interval '1 hour', now() + interval '1 day', 'Confirmed');

  insert into public.event_products (
    id, event_id, product_id, artist_id, stock_total, stock_reserved, stock_sold, is_unlimited, is_enabled
  )
  values (v_event_product_id, v_event_id, v_product_id, v_artist_id, 5, 1, 1, false, true);

  create temp table _stock_ids (
    owner_id uuid,
    other_id uuid,
    artist_id uuid,
    product_id uuid,
    event_product_id uuid
  );

  insert into _stock_ids values (v_owner_id, v_other_id, v_artist_id, v_product_id, v_event_product_id);
end $$;

create or replace function set_stock_jwt(p_email text) returns void as $$
declare
  v_uid uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(p_email) limit 1;
  perform set_config('request.jwt.claims', json_build_object('email', p_email, 'sub', v_uid::text)::text, true);
end;
$$ language plpgsql;

do $$ begin perform set_stock_jwt('stock.owner@nireq.local'); end $$;

select results_eq(
  $$ select on_hand from public.add_catalog_stock((select product_id from _stock_ids), 5, 'restock') $$,
  $$ values (25) $$,
  'owner can add catalog stock'
);

select results_eq(
  $$ select available from public.list_product_stock_summaries((select artist_id from _stock_ids))
     where product_id = (select product_id from _stock_ids) $$,
  $$ values (20) $$,
  'catalog summary reports available stock after active event allocation'
);

select results_eq(
  $$ select on_hand from public.remove_catalog_stock((select product_id from _stock_ids), 4, 'damaged') $$,
  $$ values (21) $$,
  'owner can remove catalog stock within available amount'
);

select throws_ok(
  $$ select public.remove_catalog_stock((select product_id from _stock_ids), 50, 'lost') $$,
  'insufficient_catalog_available_stock',
  'catalog remove cannot exceed available stock'
);

select throws_ok(
  $$ select public.remove_catalog_stock((select product_id from _stock_ids), 1, '') $$,
  'stock_removal_reason_required',
  'catalog remove requires a reason'
);

select results_eq(
  $$ select event_stock_total from public.add_event_stock((select event_product_id from _stock_ids), 3) $$,
  $$ values (8) $$,
  'owner can add event stock when catalog has capacity'
);

select throws_ok(
  $$ select public.add_event_stock((select event_product_id from _stock_ids), 50) $$,
  'insufficient_catalog_available_stock',
  'event add cannot exceed catalog availability'
);

select results_eq(
  $$ select event_stock_total from public.remove_event_stock((select event_product_id from _stock_ids), 2) $$,
  $$ values (6) $$,
  'owner can remove unreserved event stock'
);

select results_eq(
  $$ select catalog_available from public.remove_event_stock((select event_product_id from _stock_ids), 1) $$,
  $$ values (16) $$,
  'event removal returns capacity to catalog availability'
);

select throws_ok(
  $$ select public.remove_event_stock((select event_product_id from _stock_ids), 5) $$,
  'event_stock_below_reserved_or_sold',
  'event remove cannot undercut reserved or sold stock'
);

do $$ begin perform set_stock_jwt('stock.other@nireq.local'); end $$;

select throws_ok(
  $$ select public.add_catalog_stock((select product_id from _stock_ids), 1, 'restock') $$,
  'forbidden',
  'non-owner cannot add catalog stock'
);

select throws_ok(
  $$ select public.add_event_stock((select event_product_id from _stock_ids), 1) $$,
  'forbidden',
  'non-owner cannot add event stock'
);


do $$ begin perform set_stock_jwt('stock.owner@nireq.local'); end $$;
create temp table _before_receipt as select stock_total from public.products where id = (select product_id from _stock_ids);
select lives_ok(
  $$ select * from public.adjust_catalog_stock((select product_id from _stock_ids), 7, 'receive', '', 'ec4cf77c-ea33-48b5-b6a3-f2ae70e52288') $$,
  'receive stock succeeds');
select lives_ok(
  $$ select * from public.adjust_catalog_stock((select product_id from _stock_ids), 7, 'receive', '', 'ec4cf77c-ea33-48b5-b6a3-f2ae70e52288') $$,
  'lost-response retry succeeds');
select results_eq(
  $$ select stock_total from public.products where id = (select product_id from _stock_ids) $$,
  $$ select stock_total + 7 from _before_receipt $$, 'receipt retry increments only once');
select results_eq(
  $$ select count(*) from public.catalog_stock_movements where request_id = 'ec4cf77c-ea33-48b5-b6a3-f2ae70e52288' $$,
  $$ values (1::bigint) $$, 'one audit record per receipt');
select ok(
  exists (select 1 from public.catalog_stock_movements where request_id = 'ec4cf77c-ea33-48b5-b6a3-f2ae70e52288'
    and actor_id = (select owner_id from _stock_ids) and kind = 'receive' and reason = 'received'
    and quantity_after - quantity_before = 7), 'receipt audit records actor, reason and before/after');
select throws_ok(
  $$ select * from public.adjust_catalog_stock((select product_id from _stock_ids), 8, 'receive', '', 'ec4cf77c-ea33-48b5-b6a3-f2ae70e52288') $$,
  'stock_request_conflict', 'retry cannot change payload');
select throws_ok(
  $$ select * from public.adjust_catalog_stock((select product_id from _stock_ids), 1, 'increase', '', gen_random_uuid()) $$,
  'stock_removal_reason_required', 'positive correction also requires reason');
insert into public.artist_members (artist_id, member_email, role, status)
values ((select artist_id from _stock_ids), 'stock.other@nireq.local', 'seller', 'active');
do $$ begin perform set_stock_jwt('stock.other@nireq.local'); end $$;
select throws_ok(
  $$ select * from public.adjust_catalog_stock((select product_id from _stock_ids), 1, 'receive', '', gen_random_uuid()) $$,
  'forbidden', 'seller cannot receive stock by RPC');

select * from finish();
rollback;
