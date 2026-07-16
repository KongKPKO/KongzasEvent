begin;

select plan(5);

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
  v_artist_id uuid := gen_random_uuid();
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

select * from finish();
rollback;
