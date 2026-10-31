begin;

select plan(13);

select ok(
  to_regprocedure('public.publish_artist_public_booth(uuid,uuid)') is not null,
  'explicit booth publication function exists'
);

select ok(
  not has_function_privilege('anon', 'public.publish_artist_public_booth(uuid,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.publish_artist_public_booth(uuid,uuid)', 'execute'),
  'only authenticated callers can invoke booth publication'
);

select ok(
  coalesce((
    select 'search_path=""' = any(proconfig)
    from pg_proc
    where oid = 'public.publish_artist_public_booth(uuid,uuid)'::regprocedure
  ), false),
  'publication function has an immutable empty search path'
);

do $$
declare
  v_user_id uuid := gen_random_uuid();
  v_artist_id uuid := v_user_id;
  v_event_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, aud, role
  ) values (
    v_user_id, 'publication.owner@nireq.local', 'x', now(), now(), now(),
    '{}', '{}', 'authenticated', 'authenticated'
  );
  insert into public.artists (id, slug, display_name, email)
  values (v_artist_id, 'publication-test-booth', 'Publication Test Booth', 'publication.owner@nireq.local');
  insert into public.artist_members (artist_id, member_email, role, status)
  values (v_artist_id, 'publication.owner@nireq.local', 'owner', 'active');
  insert into public.events (
    id, artist_id, event_name, start_date, end_date, status, event_timezone,
    location, booth_detail
  ) values (
    v_event_id, v_artist_id, 'Publication Test Event', now() + interval '1 day',
    now() + interval '2 days', 'Confirmed', 'Asia/Bangkok', 'Hall A', 'A12'
  );
  create temp table _publication_ids (artist_id uuid, event_id uuid);
  insert into _publication_ids values (v_artist_id, v_event_id);
  perform set_config('request.jwt.claims', json_build_object(
    'email', 'publication.owner@nireq.local', 'sub', v_user_id::text
  )::text, true);
end $$;

select throws_ok(
  $$ select * from public.publish_artist_public_booth(
    (select artist_id from _publication_ids),
    (select event_id from _publication_ids)
  ) $$,
  'customer_visible_product_required',
  'publication refuses a booth with no customer-visible product'
);

insert into public.products (artist_id, name, price, status, currency, is_unlimited)
select artist_id, 'Publication Test Product', 100, 'enable', 'THB', true
from _publication_ids;

select results_eq(
  $$ select is_public from public.publish_artist_public_booth(
    (select artist_id from _publication_ids),
    (select event_id from _publication_ids)
  ) $$,
  $$ values (true) $$,
  'publication succeeds after all required booth data exists'
);

insert into public.queues (id, artist_id, event_id, queue_number, status, customer_fingerprint, queue_service_date)
select '10000000-0000-4000-8000-000000000001', artist_id, event_id, 1, 'waiting', '20000000-0000-4000-8000-000000000002', current_date
from _publication_ids;
update public.events set start_date = now() - interval '1 hour', is_booth_open = true where id = (select event_id from _publication_ids);

select ok(
  not has_function_privilege('anon', 'public.unpublish_artist_public_booth(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.unpublish_artist_public_booth(uuid)', 'execute'),
  'only authenticated callers can invoke hiding the storefront'
);

select set_config('request.jwt.claims', '{"email":"outsider@nireq.local","sub":"00000000-0000-0000-0000-000000000001"}', true);
select throws_ok(
  $$ select public.unpublish_artist_public_booth((select artist_id from _publication_ids)) $$,
  '42501', 'forbidden', 'another user cannot hide the storefront'
);

select set_config('request.jwt.claims', json_build_object(
  'email', 'publication.owner@nireq.local',
  'sub', (select id::text from auth.users where email = 'publication.owner@nireq.local')
)::text, true);
select is(public.unpublish_artist_public_booth((select artist_id from _publication_ids)), true, 'owner can hide the storefront');
select is((select is_public from public.artists where id = (select artist_id from _publication_ids)), false, 'storefront is no longer public');
select throws_ok(
  $$ select * from public.create_queue_ticket((select artist_id from _publication_ids), (select event_id from _publication_ids), 'hidden-test') $$,
  'artist_not_public', 'direct queue creation is blocked for a hidden storefront'
);
select throws_ok(
  $$ select public.create_customer_order_with_stock('10000000-0000-4000-8000-000000000001'::uuid, '[]'::jsonb, '20000000-0000-4000-8000-000000000002'::text, null::uuid) $$,
  'artist_not_public', 'an existing ticket cannot place a new customer order while hidden'
);
select ok((select is_verified from public.artists where id = (select artist_id from _publication_ids)), 'hiding preserves verification');
select results_eq(
  $$ select is_public from public.publish_artist_public_booth((select artist_id from _publication_ids), (select event_id from _publication_ids)) $$,
  $$ values (true) $$, 'owner can publish the storefront again'
);

select * from finish();
rollback;
