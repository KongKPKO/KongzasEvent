begin;

select no_plan();

insert into auth.users (
  id,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  aud,
  role
)
values
  ('f1000000-0000-4000-8000-000000000001', 'direct-owner@profile.test', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('f1000000-0000-4000-8000-000000000002', 'legacy-owner@profile.test', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('f1000000-0000-4000-8000-000000000003', 'manager@profile.test', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('f1000000-0000-4000-8000-000000000004', 'seller@profile.test', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('f1000000-0000-4000-8000-000000000005', 'queue@profile.test', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('f1000000-0000-4000-8000-000000000006', 'inactive-owner@profile.test', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('f1000000-0000-4000-8000-000000000007', 'outsider@profile.test', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('f3000000-0000-4000-8000-000000000001', 'other-owner@profile.test', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated');

insert into public.artists (
  id,
  slug,
  display_name,
  seller_type,
  bio,
  email,
  is_public,
  is_verified,
  published_at
)
values
  (
    'f1000000-0000-4000-8000-000000000001',
    'profile-direct',
    'Direct Owner Shop',
    'creator',
    'Direct owner biography',
    'direct-owner@profile.test',
    false,
    true,
    null
  ),
  (
    'f2000000-0000-4000-8000-000000000001',
    'profile-legacy',
    'Legacy Shop',
    'creator',
    'Original biography',
    'legacy-owner@profile.test',
    true,
    true,
    '2026-01-02 03:04:05+00'
  ),
  (
    'f3000000-0000-4000-8000-000000000001',
    'profile-other',
    'Other Shop',
    'creator',
    'Other biography',
    'other-owner@profile.test',
    false,
    false,
    null
  );

insert into public.artist_members (artist_id, member_email, role, status)
values
  ('f2000000-0000-4000-8000-000000000001', 'legacy-owner@profile.test', 'owner', 'active'),
  ('f2000000-0000-4000-8000-000000000001', 'manager@profile.test', 'manager', 'active'),
  ('f2000000-0000-4000-8000-000000000001', 'seller@profile.test', 'seller', 'active'),
  ('f2000000-0000-4000-8000-000000000001', 'queue@profile.test', 'queue_staff', 'active'),
  ('f2000000-0000-4000-8000-000000000001', 'inactive-owner@profile.test', 'owner', 'inactive');

select ok(
  has_function_privilege('authenticated', 'private.update_shop_profile(uuid,jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.update_shop_profile(uuid,jsonb)', 'execute')
  and not has_function_privilege('anon', 'private.update_shop_profile(uuid,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.update_shop_profile(uuid,jsonb)', 'execute'),
  'shop profile functions are executable only by authenticated clients'
);

select ok(
  (select p.prosecdef
   from pg_proc p
   where p.oid = 'private.update_shop_profile(uuid,jsonb)'::regprocedure)
  and not (
    select p.prosecdef
    from pg_proc p
    where p.oid = 'public.update_shop_profile(uuid,jsonb)'::regprocedure
  ),
  'the private implementation is a definer and the public wrapper is an invoker'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000002","email":"legacy-owner@profile.test","role":"authenticated"}',
  true
);

select is_empty(
  $$ update public.artists
     set display_name = 'RLS bypass'
     where id = 'f2000000-0000-4000-8000-000000000001'
     returning id $$,
  'legacy owner direct update still returns zero rows under artists_update_self RLS'
);

select is(
  public.update_shop_profile(
    'f2000000-0000-4000-8000-000000000001',
    '{"display_name":"Legacy Owner Updated","seller_type":"cosplayer"}'
  ) ->> 'seller_type',
  'cosplayer',
  'legacy owner with a different auth uid can update the shop profile through the RPC'
);

select is(
  (select display_name from public.artists where id = 'f2000000-0000-4000-8000-000000000001'),
  'Legacy Owner Updated',
  'legacy owner profile changes persist'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000003","email":"manager@profile.test","role":"authenticated"}',
  true
);

select is(
  public.update_shop_profile(
    'f2000000-0000-4000-8000-000000000001',
    '{"bio":"Manager biography","seller_type":"shop","image_url":null}'
  ) ->> 'seller_type',
  'shop',
  'active manager can update the shop profile'
);

select is(
  (select display_name from public.artists where id = 'f2000000-0000-4000-8000-000000000001'),
  'Legacy Owner Updated',
  'partial profile updates preserve omitted fields'
);

select throws_ok(
  $$ select public.update_shop_profile(
       'f1000000-0000-4000-8000-000000000001',
       '{"display_name":"Cross-shop write"}'
     ) $$,
  'P0001',
  'forbidden',
  'manager cannot update another shop'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000001","email":"direct-owner@profile.test","role":"authenticated"}',
  true
);

select is(
  public.update_shop_profile(
    'f1000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'seller_type', 'shop',
      'display_name', 'Direct Owner Updated',
      'bio', null,
      'x_url', 'https://x.example/direct',
      'ig_url', 'https://instagram.example/direct',
      'facebook_url', 'https://facebook.example/direct',
      'tiktok_url', 'https://tiktok.example/direct',
      'email', 'updated-direct@profile.test',
      'image_url', 'https://images.example/direct.png'
    )
  ) ->> 'id',
  'f1000000-0000-4000-8000-000000000001',
  'direct owner can update every allowlisted profile field'
);

select results_eq(
  $$ select seller_type, display_name, bio, x_url, ig_url, facebook_url, tiktok_url, email, image_url
     from public.artists
     where id = 'f1000000-0000-4000-8000-000000000001' $$,
  $$ values (
       'shop'::text,
       'Direct Owner Updated'::text,
       null::text,
       'https://x.example/direct'::text,
       'https://instagram.example/direct'::text,
       'https://facebook.example/direct'::text,
       'https://tiktok.example/direct'::text,
       'updated-direct@profile.test'::text,
       'https://images.example/direct.png'::text
     ) $$,
  'allowlisted profile fields are saved with explicit null support'
);

select throws_ok(
  $$ select public.update_shop_profile(
       'f1000000-0000-4000-8000-000000000001',
       '[]'::jsonb
     ) $$,
  'P0001',
  'invalid_profile',
  'profile payload must be a JSON object'
);

select throws_ok(
  $$ select public.update_shop_profile(
       'f1000000-0000-4000-8000-000000000001',
       '{"bio":false}'
     ) $$,
  'P0001',
  'invalid_profile',
  'allowlisted values must be strings or null'
);

select throws_ok(
  $$ select public.update_shop_profile(
       'f1000000-0000-4000-8000-000000000001',
       '{"display_name":"   "}'
     ) $$,
  'P0001',
  'invalid_display_name',
  'display name cannot be empty'
);

select throws_ok(
  $$ select public.update_shop_profile(
       'f1000000-0000-4000-8000-000000000001',
       '{"seller_type":"agency"}'
     ) $$,
  'P0001',
  'invalid_seller_type',
  'unknown seller type is rejected'
);

select throws_ok(
  $$ select public.update_shop_profile(
       'f1000000-0000-4000-8000-000000000001',
       '{"is_public":true,"published_at":"2026-10-16T00:00:00Z"}'
     ) $$,
  'P0001',
  'invalid_profile',
  'publication fields are outside the profile allowlist'
);

select throws_ok(
  $$ select public.update_shop_profile(
       'f1000000-0000-4000-8000-000000000001',
       '{"id":"f2000000-0000-4000-8000-000000000001","slug":"hijacked"}'
     ) $$,
  'P0001',
  'invalid_profile',
  'identity fields are outside the profile allowlist'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000004","email":"seller@profile.test","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select public.update_shop_profile('f2000000-0000-4000-8000-000000000001', '{"bio":"seller"}') $$,
  'P0001',
  'forbidden',
  'seller cannot update the shop profile'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000005","email":"queue@profile.test","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select public.update_shop_profile('f2000000-0000-4000-8000-000000000001', '{"bio":"queue"}') $$,
  'P0001',
  'forbidden',
  'queue staff cannot update the shop profile'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000006","email":"inactive-owner@profile.test","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select public.update_shop_profile('f2000000-0000-4000-8000-000000000001', '{"bio":"inactive"}') $$,
  'P0001',
  'forbidden',
  'inactive owner membership cannot update the shop profile'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000007","email":"outsider@profile.test","role":"authenticated"}',
  true
);
select throws_ok(
  $$ select public.update_shop_profile('f2000000-0000-4000-8000-000000000001', '{"bio":"outsider"}') $$,
  'P0001',
  'forbidden',
  'unrelated authenticated user cannot update the shop profile'
);

select set_config('request.jwt.claims', '{}', true);
select throws_ok(
  $$ select public.update_shop_profile('f2000000-0000-4000-8000-000000000001', '{"bio":"missing identity"}') $$,
  'P0001',
  'forbidden',
  'authenticated database role without an auth identity is denied'
);

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$ select public.update_shop_profile('f2000000-0000-4000-8000-000000000001', '{"bio":"anonymous"}') $$,
  '42501',
  null,
  'anonymous caller cannot execute the shop profile RPC'
);
reset role;

select results_eq(
  $$ select id, slug, is_public, is_verified, published_at
     from public.artists
     where id in (
       'f1000000-0000-4000-8000-000000000001',
       'f2000000-0000-4000-8000-000000000001'
     )
     order by id $$,
  $$ values
       (
         'f1000000-0000-4000-8000-000000000001'::uuid,
         'profile-direct'::text,
         false,
         true,
         null::timestamptz
       ),
       (
         'f2000000-0000-4000-8000-000000000001'::uuid,
         'profile-legacy'::text,
         true,
         true,
         '2026-01-02 03:04:05+00'::timestamptz
       ) $$,
  'profile updates preserve shop identity and publication controls'
);

select is(
  (select bio from public.artists where id = 'f2000000-0000-4000-8000-000000000001'),
  'Manager biography',
  'denied callers and invalid payloads leave the saved profile unchanged'
);

select * from finish();

rollback;
