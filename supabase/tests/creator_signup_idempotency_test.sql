begin;
select plan(9);

do $$
declare
  v_uid uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, aud, role
  )
  values (
    v_uid,
    'creator.signup.idempotency@nireq.local',
    'x',
    now(),
    now(),
    now(),
    '{}',
    '{"creator_signup":"self_serve","creator_name":"Idempotent Creator","contact_name":"Test Owner","desired_slug":"idempotent-creator-test","primary_social_url":"https://example.com/creator","application_note":"Creator signup idempotency regression."}',
    'authenticated',
    'authenticated'
  );

  create temp table _creator_signup_ids (uid uuid not null);
  insert into _creator_signup_ids values (v_uid);

  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'email', 'creator.signup.idempotency@nireq.local',
      'sub', v_uid::text,
      'role', 'authenticated'
    )::text,
    true
  );
end $$;

select is(
  public.complete_verified_creator_signup() ->> 'status',
  'created',
  'first completion creates the workspace'
);

select is(
  public.complete_verified_creator_signup() ->> 'status',
  'exists',
  'repeated completion is idempotent'
);

select is(
  (
    select count(*)
    from public.creator_applications
    where auth_user_id = (select uid from _creator_signup_ids)
      and status in ('pending', 'auto_approved', 'approved')
  ),
  1::bigint,
  'one active application'
);

select is(
  (select count(*) from public.artists where id = (select uid from _creator_signup_ids)),
  1::bigint,
  'one owned artist'
);

select is(
  (
    select count(*)
    from public.artist_members
    where artist_id = (select uid from _creator_signup_ids)
      and role = 'owner'
      and status = 'active'
  ),
  1::bigint,
  'one active owner member'
);

select has_index(
  'public',
  'creator_applications',
  'creator_applications_active_auth_user_uidx',
  'active application invariant exists'
);

update public.creator_applications
set status = 'rejected'
where auth_user_id = (select uid from _creator_signup_ids);

delete from public.artist_members
where artist_id = (select uid from _creator_signup_ids);

delete from public.artists
where id = (select uid from _creator_signup_ids);

select is(
  public.complete_verified_creator_signup() ->> 'status',
  'created',
  'rejected history permits a new active application'
);

select is(
  (
    select count(*)
    from public.creator_applications
    where auth_user_id = (select uid from _creator_signup_ids)
  ),
  2::bigint,
  'reapplication preserves rejected history'
);

do $$
begin
  perform set_config('request.jwt.claims', '{}', true);
end $$;

select throws_ok(
  $$ select public.complete_verified_creator_signup() $$,
  'Authentication required',
  'anonymous completion is denied'
);

select * from finish();
rollback;
