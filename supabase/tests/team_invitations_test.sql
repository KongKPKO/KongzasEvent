-- supabase/tests/team_invitations_test.sql
begin;
select plan(27);

-- Fixtures --------------------------------------------------------------------

do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_manager_id uuid := gen_random_uuid();
  v_staff_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_other_event_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, aud, role
  )
  values
    (v_owner_id, 'test.owner@nireq.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_manager_id, 'test.manager@nireq.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_staff_id, 'test.staff@nireq.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (gen_random_uuid(), 'test.staff.existing@nireq.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated');

  insert into public.artists (id, slug, display_name)
  values (v_owner_id, 'test-booth-team-access', 'Test Booth Team Access');

  insert into public.artist_members (artist_id, member_email, role, status)
  values
    (v_owner_id, 'test.owner@nireq.local', 'owner', 'active'),
    (v_owner_id, 'test.manager@nireq.local', 'manager', 'active'),
    (v_owner_id, 'test.staff@nireq.local', 'queue_staff', 'active');

  insert into public.events (id, artist_id, event_name, start_date, end_date, status)
  values
    (v_event_id, v_owner_id, 'Assigned Event', now() + interval '1 day', now() + interval '2 days', 'Confirmed'),
    (v_other_event_id, v_owner_id, 'Other Event', now() + interval '3 days', now() + interval '4 days', 'Confirmed');

  create temp table _test_ids (
    owner_id uuid,
    manager_id uuid,
    staff_id uuid,
    artist_id uuid,
    event_id uuid,
    other_event_id uuid
  );

  insert into _test_ids values (
    v_owner_id,
    v_manager_id,
    v_staff_id,
    v_owner_id,
    v_event_id,
    v_other_event_id
  );
end $$;

create or replace function set_jwt_email(p_email text) returns void as $$
declare
  v_uid uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(p_email) limit 1;

  perform set_config('request.jwt.claims',
    json_build_object(
      'email', p_email,
      'sub', coalesce(v_uid::text, gen_random_uuid()::text)
    )::text,
    true
  );
end;
$$ language plpgsql;

-- Tests -----------------------------------------------------------------------

-- Owner invites an existing auth user as event-limited staff. Existing auth no
-- longer auto-adds a member; the invitee must accept so event scope is explicit.
do $$ begin perform set_jwt_email('test.owner@nireq.local'); end $$;
select results_eq(
  $$ select (public.invite_team_member(
       (select artist_id from _test_ids),
       'test.staff.existing@nireq.local',
       'seller',
       array[(select event_id from _test_ids)]
     ) ->> 'result')::text $$,
  $$ values ('invitation_sent') $$,
  'Test 1: owner invite existing auth staff creates pending invitation'
);

select ok(
  exists (
    select 1
    from public.artist_member_invitation_events ie
    join public.artist_member_invitations i on i.id = ie.invitation_id
    where lower(i.invited_email) = 'test.staff.existing@nireq.local'
      and ie.event_id = (select event_id from _test_ids)
  ),
  'Test 2: seller invitation stores selected event access'
);

select results_eq(
  $$ select event_ids
     from public.list_team_invitations((select artist_id from _test_ids))
     where lower(invited_email) = 'test.staff.existing@nireq.local' $$,
  $$ values (array[(select event_id from _test_ids)]::uuid[]) $$,
  'Test 3: list_team_invitations returns selected event_ids'
);

select results_eq(
  $$ select (public.invite_team_member(
       (select artist_id from _test_ids),
       'test.staff.existing@nireq.local',
       'seller',
       array[(select event_id from _test_ids)]
     ) ->> 'result')::text $$,
  $$ values ('already_invited') $$,
  'Test 4: duplicate pending invite returns already_invited'
);

select results_eq(
  $$ select (public.invite_team_member(
       (select artist_id from _test_ids),
       'test.staff@nireq.local',
       'queue_staff',
       array[(select event_id from _test_ids)]
     ) ->> 'result')::text $$,
  $$ values ('already_member') $$,
  'Test 5: active member invite returns already_member'
);

select throws_ok(
  $$ select public.invite_team_member(
       (select artist_id from _test_ids),
       'no.event.scope@nireq.local',
       'seller',
       array[]::uuid[]
     ) $$,
  'event access required',
  'Test 6: seller invite requires at least one event'
);

select throws_ok(
  $$ select public.invite_team_member(
       (select artist_id from _test_ids),
       'manager.scoped@nireq.local',
       'manager',
       array[(select event_id from _test_ids)]
     ) $$,
  'manager cannot be event restricted',
  'Test 7: manager invite cannot be event-scoped'
);

select results_eq(
  $$ select (public.invite_team_member(
       (select artist_id from _test_ids),
       'manager.invite@nireq.local',
       'manager',
       array[]::uuid[]
     ) ->> 'result')::text $$,
  $$ values ('invitation_sent') $$,
  'Test 8: owner can invite manager without event scope'
);

do $$ begin perform set_jwt_email('test.manager@nireq.local'); end $$;
select throws_ok(
  $$ select public.invite_team_member(
       (select artist_id from _test_ids),
       'manager.cannot.invite@nireq.local',
       'seller',
       array[(select event_id from _test_ids)]
     ) $$,
  'permission denied',
  'Test 9: manager cannot manage team invites'
);

do $$ begin perform set_jwt_email('test.staff@nireq.local'); end $$;
select throws_ok(
  $$ select public.invite_team_member(
       (select artist_id from _test_ids),
       'staff.cannot.invite@nireq.local',
       'queue_staff',
       array[(select event_id from _test_ids)]
     ) $$,
  'permission denied',
  'Test 10: queue_staff cannot manage team invites'
);

do $$ begin perform set_jwt_email('test.staff.existing@nireq.local'); end $$;
select results_eq(
  $$ select event_ids from public.list_my_pending_invitations() $$,
  $$ values (array[(select event_id from _test_ids)]::uuid[]) $$,
  'Test 11: invitee sees event_ids on pending invitation'
);

create temp table _accept_results (email text primary key, payload jsonb);
insert into _accept_results (email, payload)
select
  'test.staff.existing@nireq.local',
  public.accept_team_invitation(
    (select id from public.artist_member_invitations
     where lower(invited_email) = 'test.staff.existing@nireq.local'
       and status = 'pending'
     limit 1)
  );

select results_eq(
  $$ select (payload ->> 'result')::text
     from _accept_results
     where email = 'test.staff.existing@nireq.local' $$,
  $$ values ('accepted') $$,
  'Test 12: event-limited seller accepts invitation'
);

select ok(
  exists (
    select 1
    from public.artist_members
    where artist_id = (select artist_id from _test_ids)
      and lower(member_email) = 'test.staff.existing@nireq.local'
      and role = 'seller'
      and status = 'active'
  ),
  'Test 13: accepting seller invite creates active seller member'
);

select ok(
  exists (
    select 1
    from public.event_member_assignments ema
    join public.artist_members m on m.id = ema.member_id
    where ema.artist_id = (select artist_id from _test_ids)
      and ema.event_id = (select event_id from _test_ids)
      and lower(m.member_email) = 'test.staff.existing@nireq.local'
  ),
  'Test 14: accepting seller invite creates event assignment'
);

select results_eq(
  $$ select (payload ->> 'redirect_path')::text
     from _accept_results
     where email = 'test.staff.existing@nireq.local' $$,
  $$ values ('/live/pos?eventId=' || (select event_id::text from _test_ids)) $$,
  'Test 15: accepted seller invite redirects to scoped POS event'
);

do $$ begin perform set_jwt_email('manager.invite@nireq.local'); end $$;
insert into _accept_results (email, payload)
select
  'manager.invite@nireq.local',
  public.accept_team_invitation(
    (select id from public.artist_member_invitations
     where lower(invited_email) = 'manager.invite@nireq.local'
       and status = 'pending'
     limit 1)
  );

select results_eq(
  $$ select (payload ->> 'result')::text
     from _accept_results
     where email = 'manager.invite@nireq.local' $$,
  $$ values ('accepted') $$,
  'Test 16: manager accepts invitation'
);

select ok(
  not exists (
    select 1
    from public.event_member_assignments ema
    join public.artist_members m on m.id = ema.member_id
    where ema.artist_id = (select artist_id from _test_ids)
      and lower(m.member_email) = 'manager.invite@nireq.local'
  ),
  'Test 17: manager acceptance creates no event restriction rows'
);

select results_eq(
  $$ select (payload ->> 'redirect_path')::text
     from _accept_results
     where email = 'manager.invite@nireq.local' $$,
  $$ values ('/manage-events') $$,
  'Test 18: accepted manager invite redirects to management'
);

select results_eq(
  $$ select role::text from public.get_actor_context() $$,
  $$ values ('manager') $$,
  'Test 18b: accepted manager receives actor context'
);

do $$ begin perform set_jwt_email('test.staff.existing@nireq.local'); end $$;
select results_eq(
  $$ select role::text from public.get_actor_context() $$,
  $$ values ('seller') $$,
  'Test 18c: accepted event-limited seller receives actor context'
);

do $$ begin perform set_jwt_email('test.owner@nireq.local'); end $$;
select results_eq(
  $$ select (public.invite_team_member(
       (select artist_id from _test_ids),
       'cancel.me@nireq.local',
       'queue_staff',
       array[(select event_id from _test_ids)]
     ) ->> 'result')::text $$,
  $$ values ('invitation_sent') $$,
  'Test 19: owner can create queue_staff invitation for cancellation'
);

select results_eq(
  $$ select (public.cancel_team_invitation(
       (select id from public.artist_member_invitations
        where lower(invited_email) = 'cancel.me@nireq.local'
          and status = 'pending'
        limit 1)
     ) ->> 'result')::text $$,
  $$ values ('cancelled') $$,
  'Test 20: owner cancels pending invitation'
);

select throws_ok(
  $$ select public.cancel_team_invitation(
       (select id from public.artist_member_invitations
        where lower(invited_email) = 'cancel.me@nireq.local'
          and status = 'cancelled'
        limit 1)
     ) $$,
  null,
  'invitation is not pending (current status: cancelled)',
  'Test 21: cancelling non-pending invitation raises clear error'
);

insert into public.artist_member_invitations (artist_id, invited_email, role, expires_at)
values ((select artist_id from _test_ids), 'expired@nireq.local', 'queue_staff', now() - interval '1 day');

do $$ begin perform set_jwt_email('expired@nireq.local'); end $$;
select ok(
  (select count(*) from public.list_my_pending_invitations()) = 0,
  'Test 22: expired invitations are excluded from pending list'
);

do $$ begin perform set_jwt_email('test.owner@nireq.local'); end $$;
insert into public.artist_member_invitations (artist_id, invited_email, role)
values ((select artist_id from _test_ids), 'victim@nireq.local', 'queue_staff');

do $$ begin perform set_jwt_email('attacker@nireq.local'); end $$;
select throws_ok(
  $$ select public.accept_team_invitation(
       (select id from public.artist_member_invitations
        where lower(invited_email) = 'victim@nireq.local'
          and status = 'pending'
        limit 1)
     ) $$,
  'permission denied',
  'Test 23: wrong user cannot accept another invitation'
);

select throws_ok(
  $$ select public.decline_team_invitation(
       (select id from public.artist_member_invitations
        where lower(invited_email) = 'victim@nireq.local'
          and status = 'pending'
        limit 1)
     ) $$,
  'permission denied',
  'Test 24: wrong user cannot decline another invitation'
);

insert into public.artist_member_invitations (artist_id, invited_email, role)
values ((select artist_id from _test_ids), 'decliner@nireq.local', 'queue_staff');

do $$ begin perform set_jwt_email('decliner@nireq.local'); end $$;
select results_eq(
  $$ select (public.decline_team_invitation(
       (select id from public.artist_member_invitations
        where lower(invited_email) = 'decliner@nireq.local'
          and status = 'pending'
        limit 1)
     ) ->> 'result')::text $$,
  $$ values ('declined') $$,
  'Test 25: invitee can decline their own invitation'
);

select * from finish();
rollback;
