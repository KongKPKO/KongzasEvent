begin;

select no_plan();

select has_column('public', 'artists', 'seller_type', 'artists classify the seller');
select has_column('public', 'creator_applications', 'seller_type', 'creator applications preserve the selected seller type');

select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'artists' and column_name = 'seller_type'),
  '''creator''::text',
  'artist seller type defaults to creator'
);

select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'creator_applications' and column_name = 'seller_type'),
  '''creator''::text',
  'application seller type defaults to creator'
);

create temp table _seller_signup_expected (
  uid uuid primary key,
  expected_seller_type text not null
) on commit drop;

do $$
declare
  test_case record;
  v_uid uuid;
  v_email text;
  v_slug text;
  v_metadata jsonb;
  v_result jsonb;
begin
  for test_case in
    select * from (values
      ('creator'::text, 'creator'::text),
      ('cosplayer'::text, 'cosplayer'::text),
      ('shop'::text, 'shop'::text),
      ('default'::text, null::text)
    ) cases(label, supplied_seller_type)
  loop
    v_uid := gen_random_uuid();
    v_email := 'seller-type-' || test_case.label || '@nireq.local';
    v_slug := 'seller-type-' || test_case.label;
    v_metadata := jsonb_build_object(
      'creator_signup', 'self_serve',
      'creator_name', 'Seller Type ' || initcap(test_case.label),
      'contact_name', 'Test Owner',
      'desired_slug', v_slug,
      'primary_social_url', 'https://example.test/' || test_case.label,
      'application_note', 'Seller type signup regression coverage.'
    );

    if test_case.supplied_seller_type is not null then
      v_metadata := v_metadata || jsonb_build_object('seller_type', test_case.supplied_seller_type);
    end if;

    insert into auth.users (
      id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, aud, role
    ) values (
      v_uid, v_email, 'x', now(), now(), now(), '{}', v_metadata, 'authenticated', 'authenticated'
    );

    insert into _seller_signup_expected(uid, expected_seller_type)
    values (v_uid, coalesce(test_case.supplied_seller_type, 'creator'));

    perform set_config('request.jwt.claims', jsonb_build_object(
      'email', v_email,
      'sub', v_uid,
      'role', 'authenticated'
    )::text, true);

    v_result := public.complete_verified_creator_signup();
    if v_result ->> 'status' <> 'created' then
      raise exception 'Unexpected signup result for %: %', test_case.label, v_result;
    end if;
  end loop;
end $$;

select is(
  (select count(*) from public.creator_applications ca
   join _seller_signup_expected expected on expected.uid = ca.auth_user_id
   where ca.seller_type = expected.expected_seller_type),
  4::bigint,
  'all three seller types and the missing-value default reach creator applications'
);

select is(
  (select count(*) from public.artists a
   join _seller_signup_expected expected on expected.uid = a.id
   where a.seller_type = expected.expected_seller_type),
  4::bigint,
  'the application trigger transfers seller type into each auto-created workspace'
);

select is(
  (select a.seller_type from public.artists a
   join auth.users u on u.id = a.id
   where u.email = 'seller-type-default@nireq.local'),
  'creator',
  'legacy signup metadata without seller_type remains a creator'
);

insert into auth.users (
  id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, aud, role
) values (
  'e0000000-0000-4000-8000-000000000001',
  'seller-type-invalid@nireq.local',
  'x', now(), now(), now(), '{}',
  jsonb_build_object(
    'creator_signup', 'self_serve',
    'seller_type', 'agency',
    'creator_name', 'Invalid Seller Type',
    'contact_name', 'Test Owner',
    'desired_slug', 'seller-type-invalid',
    'primary_social_url', 'https://example.test/invalid',
    'application_note', 'Invalid seller type regression coverage.'
  ),
  'authenticated', 'authenticated'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'email', 'seller-type-invalid@nireq.local',
    'sub', 'e0000000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);

select throws_ok(
  $$ select public.complete_verified_creator_signup() $$,
  'invalid_seller_type',
  'signup rejects an unknown seller type before creating a workspace'
);

select is(
  (select count(*) from public.artists where id = 'e0000000-0000-4000-8000-000000000001'),
  0::bigint,
  'invalid signup does not create an artist'
);

select throws_like(
  $$ update public.artists
     set seller_type = 'agency'
     where id = (select uid from _seller_signup_expected limit 1) $$,
  '%artists_seller_type_check%',
  'artist seller type is constrained at the database boundary'
);

select throws_like(
  $$ update public.creator_applications
     set seller_type = 'agency'
     where auth_user_id = (select uid from _seller_signup_expected limit 1) $$,
  '%creator_applications_seller_type_check%',
  'application seller type is constrained at the database boundary'
);

select set_config(
  'request.jwt.claims',
  (
    select jsonb_build_object('email', u.email, 'sub', u.id, 'role', 'authenticated')::text
    from auth.users u
    where u.email = 'seller-type-default@nireq.local'
  ),
  true
);

set local role authenticated;

update public.artists
set seller_type = 'shop'
where slug = 'seller-type-default';

reset role;

select is(
  (select a.seller_type from public.artists a
   join auth.users u on u.id = a.id
   where u.email = 'seller-type-default@nireq.local'),
  'shop',
  'an artist owner can update their own seller type through existing RLS'
);

insert into public.artists (
  id, slug, display_name, seller_type, is_public, is_verified, published_at
) values (
  'e1000000-0000-4000-8000-000000000001',
  'seller-type-public',
  'Seller Type Public',
  'cosplayer',
  true,
  true,
  now()
);

insert into public.products (
  id, artist_id, name, price, currency, stock_total,
  stock_reserved, stock_sold, is_unlimited, status
) values (
  'e2000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'Seller Type Product',
  100,
  'THB',
  10,
  0,
  0,
  false,
  'enable'
);

insert into public.online_campaigns (
  id, artist_id, name, slug, opens_at, closes_at, publication_status
) values (
  'e3000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'Seller Type Campaign',
  'seller-type-campaign',
  now() - interval '1 hour',
  now() + interval '1 day',
  'published'
);

insert into public.online_campaign_products (
  id, campaign_id, product_id, artist_id, stock_total,
  stock_reserved, stock_sold, is_unlimited, is_enabled
) values (
  'e4000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  10,
  0,
  0,
  false,
  true
);

insert into public.orders (
  id, campaign_id, order_type, fulfillment_method, pickup_code,
  total_price, currency, pickup_status
) values (
  'e5000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'online_sale',
  'pickup',
  'SELL01',
  100,
  'THB',
  'awaiting_pickup'
);

insert into public.order_payments (
  id, order_id, campaign_id, artist_id, payment_status, amount_expected,
  stock_hold_expires_at
) values (
  'e6000000-0000-4000-8000-000000000001',
  'e5000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'awaiting_payment',
  100,
  now() + interval '15 minutes'
);

insert into public.events (
  id, artist_id, event_name, start_date, end_date, status, selling_mode,
  preorder_opens_at, preorder_closes_at, preorder_pickup_instructions
) values (
  'e7000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'Seller Type Event',
  now() + interval '1 day',
  now() + interval '2 days',
  'Confirmed',
  'preorder',
  now() - interval '1 hour',
  now() + interval '12 hours',
  'Show the pickup code.'
);

insert into public.orders (
  id, event_id, order_type, pickup_code, customer_name, customer_contact, customer_email,
  total_price, currency, pickup_status
) values (
  'e8000000-0000-4000-8000-000000000001',
  'e7000000-0000-4000-8000-000000000001',
  'preorder',
  'SELL02',
  'Seller Type Customer',
  'seller-type-customer@example.test',
  'seller-type-customer@example.test',
  100,
  'THB',
  'awaiting_pickup'
);

insert into public.order_payments (
  id, order_id, event_id, artist_id, payment_status, amount_expected,
  stock_hold_expires_at
) values (
  'e9000000-0000-4000-8000-000000000001',
  'e8000000-0000-4000-8000-000000000001',
  'e7000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'awaiting_payment',
  100,
  now() + interval '15 minutes'
);

select set_config('request.jwt.claims', '{}', true);
grant select on _seller_signup_expected to anon;
set local role anon;

select is(
  (select seller_type from public.artists where id = 'e1000000-0000-4000-8000-000000000001'),
  'cosplayer',
  'public artist profiles expose seller_type through existing RLS'
);

select is(
  (select count(*) from public.artists where id in (select uid from _seller_signup_expected)),
  0::bigint,
  'private signup workspaces remain hidden from anonymous artist reads'
);

select is(
  (select count(*) from public.creator_applications where auth_user_id in (select uid from _seller_signup_expected)),
  0::bigint,
  'seller type does not expose private creator applications'
);

update public.artists
set seller_type = 'shop'
where id = 'e1000000-0000-4000-8000-000000000001';

reset role;

select is(
  (select seller_type from public.artists where id = 'e1000000-0000-4000-8000-000000000001'),
  'cosplayer',
  'anonymous visitors cannot change the public seller type'
);

set local role anon;

select is(
  public.get_public_online_campaign('seller-type-public', 'seller-type-campaign') ->> 'artist_seller_type',
  'cosplayer',
  'public campaign detail exposes artist_seller_type'
);

select is(
  (select artist_seller_type from public.list_public_online_campaigns('seller-type-public')),
  'cosplayer',
  'public campaign discovery exposes artist_seller_type'
);

select is(
  public.get_public_online_order_by_code('seller-type-public', 'SELL01') ->> 'artist_seller_type',
  'cosplayer',
  'public campaign order status exposes artist_seller_type'
);

select is(
  (select artist_seller_type from public.get_public_preorder_by_code('seller-type-public', 'SELL02')),
  'cosplayer',
  'public event preorder status exposes artist_seller_type'
);

select is(
  (select artist_seller_type from public.get_public_order_receipt(
    'e8000000-0000-4000-8000-000000000001',
    'SELL02'
  )),
  'cosplayer',
  'public event order receipt exposes artist_seller_type'
);

reset role;

select * from finish();
rollback;
