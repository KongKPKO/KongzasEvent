-- supabase/tests/team_invitations_test.sql
begin;
select plan(21);

-- ─── Fixtures ─────────────────────────────────────────────────────────────────

-- Create a test artist and auth users
do $$
declare
  v_owner_id   uuid := gen_random_uuid();
  v_manager_id uuid := gen_random_uuid();
  v_staff_id   uuid := gen_random_uuid();
  v_artist_id  uuid;
begin
  -- Insert auth users (local dev allows direct inserts into auth.users)
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (v_owner_id,   'test.owner@nireq.local',   'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_manager_id, 'test.manager@nireq.local',  'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_staff_id,   'test.staff@nireq.local',    'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (gen_random_uuid(), 'test.staff.existing@nireq.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated');

  -- Create artist (owner = v_owner_id)
  insert into public.artists (id, slug, display_name)
  values (v_owner_id, 'test-booth-pgtap', 'Test Booth')
  returning id into v_artist_id;

  -- Seed owner row in artist_members
  insert into public.artist_members (artist_id, member_email, role, status)
  values (v_owner_id, 'test.owner@nireq.local', 'owner', 'active');

  -- Seed manager row
  insert into public.artist_members (artist_id, member_email, role, status)
  values (v_owner_id, 'test.manager@nireq.local', 'manager', 'active');

  -- Seed staff row (unauthorized for team management)
  insert into public.artist_members (artist_id, member_email, role, status)
  values (v_owner_id, 'test.staff@nireq.local', 'queue_staff', 'active');

  -- Store IDs for use in tests via temp table
  create temp table _test_ids (owner_id uuid, manager_id uuid, staff_id uuid, artist_id uuid);
  insert into _test_ids values (v_owner_id, v_manager_id, v_staff_id, v_owner_id);
end $$;

-- Helper: set JWT context to simulate a logged-in user
-- Sets both 'email' and 'sub' (auth.uid()) so has_artist_role works correctly
create or replace function set_jwt_email(p_email text) returns void as $$
declare
  v_uid uuid;
begin
  -- Look up the user's ID from auth.users so auth.uid() returns correctly
  select id into v_uid from auth.users where lower(email) = lower(p_email) limit 1;

  perform set_config('request.jwt.claims',
    json_build_object(
      'email', p_email,
      'sub',   coalesce(v_uid::text, gen_random_uuid()::text)
    )::text, true);
end;
$$ language plpgsql;

-- ─── Tests ────────────────────────────────────────────────────────────────────

-- Test 1: Owner invites email that exists in auth → member_added
do $$ begin perform set_jwt_email('test.owner@nireq.local'); end $$;
select results_eq(
  $$ select (public.invite_team_member(
       (select artist_id from _test_ids),
       'test.staff.existing@nireq.local', 'queue_staff'
     ) ->> 'result')::text $$,
  $$ values ('member_added') $$,
  'Test 1: invite existing auth user → member_added'
);
-- (test.staff.existing@nireq.local was inserted in auth.users fixture above)

-- Test 2: Owner invites email not in auth → invitation_sent
select results_eq(
  $$ select (public.invite_team_member(
       (select artist_id from _test_ids),
       'newstaff@external.com', 'queue_staff'
     ) ->> 'result')::text $$,
  $$ values ('invitation_sent') $$,
  'Test 2: invite non-existing user → invitation_sent'
);

-- Test 3: Duplicate pending invite → already_invited
select results_eq(
  $$ select (public.invite_team_member(
       (select artist_id from _test_ids),
       'newstaff@external.com', 'queue_staff'
     ) ->> 'result')::text $$,
  $$ values ('already_invited') $$,
  'Test 3: duplicate pending invite → already_invited'
);

-- Test 4: Invite existing active member → already_member
select results_eq(
  $$ select (public.invite_team_member(
       (select artist_id from _test_ids),
       'test.staff@nireq.local', 'queue_staff'
     ) ->> 'result')::text $$,
  $$ values ('already_member') $$,
  'Test 4: invite existing active member → already_member'
);

-- Test 5: Manager can invite
do $$ begin perform set_jwt_email('test.manager@nireq.local'); end $$;
select results_eq(
  $$ select (public.invite_team_member(
       (select artist_id from _test_ids),
       'mgr.invite@external.com', 'seller'
     ) ->> 'result')::text $$,
  $$ values ('invitation_sent') $$,
  'Test 5: manager can invite → invitation_sent'
);

-- Test 6: queue_staff cannot invite → exception
do $$ begin perform set_jwt_email('test.staff@nireq.local'); end $$;
select throws_ok(
  $$ select public.invite_team_member(
       (select artist_id from _test_ids),
       'hacker@external.com', 'queue_staff'
     ) $$,
  'permission denied',
  'Test 6: queue_staff cannot invite → permission denied'
);

-- Test 7: Owner cancels pending invitation → cancelled
do $$ begin perform set_jwt_email('test.owner@nireq.local'); end $$;
select results_eq(
  $$ select (public.cancel_team_invitation(
       (select id from public.artist_member_invitations
        where lower(invited_email) = 'newstaff@external.com'
          and status = 'pending'
        limit 1)
     ) ->> 'result')::text $$,
  $$ values ('cancelled') $$,
  'Test 7: cancel pending invitation → cancelled'
);

-- Test 8: Cannot cancel already-cancelled invitation → exception
select throws_ok(
  $$ select public.cancel_team_invitation(
       (select id from public.artist_member_invitations
        where lower(invited_email) = 'newstaff@external.com'
          and status = 'cancelled'
        limit 1)
     ) $$,
  null,
  'invitation is not pending (current status: cancelled)',
  'Test 8: cancel non-pending invitation → correct error raised'
);

-- Test 9: Invitee lists their pending invitations
do $$ begin perform set_jwt_email('mgr.invite@external.com'); end $$;
select ok(
  (select count(*) from public.list_my_pending_invitations()) = 1,
  'Test 9: invitee sees their pending invitation'
);

-- Test 10: Invitee accepts pending invitation → accepted
select results_eq(
  $$ select (public.accept_team_invitation(
       (select id from public.artist_member_invitations
        where lower(invited_email) = 'mgr.invite@external.com'
          and status = 'pending'
        limit 1)
     ) ->> 'result')::text $$,
  $$ values ('accepted') $$,
  'Test 10: accept pending invitation → accepted'
);

-- Verify artist_members row created
select ok(
  exists(select 1 from public.artist_members
         where lower(member_email) = 'mgr.invite@external.com'
           and status = 'active'),
  'Test 10b: artist_members row created after accept'
);

-- Test 11: Accept expired invitation → exception
do $$ begin perform set_jwt_email('test.owner@nireq.local'); end $$;
-- Create an expired invitation
insert into public.artist_member_invitations (artist_id, invited_email, role, expires_at)
values ((select artist_id from _test_ids), 'expired@external.com', 'queue_staff', now() - interval '1 day');

do $$ begin perform set_jwt_email('expired@external.com'); end $$;
select throws_ok(
  $$ select public.accept_team_invitation(
       (select id from public.artist_member_invitations
        where lower(invited_email) = 'expired@external.com'
          and status = 'pending'
        limit 1)
     ) $$,
  'invitation has expired',
  'Test 11: accept expired invitation → exception'
);

-- Test 12: Accept already-accepted invitation → accepted_existing_member
do $$ begin perform set_jwt_email('mgr.invite@external.com'); end $$;
-- Re-insert a pending invitation for the already-accepted user (bypass unique index via direct insert)
insert into public.artist_member_invitations (artist_id, invited_email, role)
values ((select artist_id from _test_ids), 'mgr.invite@external.com', 'seller');

select results_eq(
  $$ select (public.accept_team_invitation(
       (select id from public.artist_member_invitations
        where lower(invited_email) = 'mgr.invite@external.com'
          and status = 'pending'
        limit 1)
     ) ->> 'result')::text $$,
  $$ values ('accepted_existing_member') $$,
  'Test 12: accept when already a member → accepted_existing_member'
);

-- Test 13: Invitee declines from settings page → declined
do $$ begin perform set_jwt_email('test.owner@nireq.local'); end $$;
-- Create fresh pending invitation to decline
insert into public.artist_member_invitations (artist_id, invited_email, role)
values ((select artist_id from _test_ids), 'decliner@external.com', 'queue_staff');

do $$ begin perform set_jwt_email('decliner@external.com'); end $$;
select results_eq(
  $$ select (public.decline_team_invitation(
       (select id from public.artist_member_invitations
        where lower(invited_email) = 'decliner@external.com'
          and status = 'pending'
        limit 1)
     ) ->> 'result')::text $$,
  $$ values ('declined') $$,
  'Test 13: decline invitation → declined'
);

-- Test 14: Wrong user cannot accept another's invitation → exception
do $$ begin perform set_jwt_email('test.owner@nireq.local'); end $$;
insert into public.artist_member_invitations (artist_id, invited_email, role)
values ((select artist_id from _test_ids), 'victim@external.com', 'queue_staff');

do $$ begin perform set_jwt_email('attacker@nireq.local'); end $$;
select throws_ok(
  $$ select public.accept_team_invitation(
       (select id from public.artist_member_invitations
        where lower(invited_email) = 'victim@external.com'
          and status = 'pending'
        limit 1)
     ) $$,
  'permission denied',
  'Test 14: wrong user cannot accept another invitation → permission denied'
);

-- Test 15: Wrong user cannot decline another's invitation → exception
select throws_ok(
  $$ select public.decline_team_invitation(
       (select id from public.artist_member_invitations
        where lower(invited_email) = 'victim@external.com'
          and status = 'pending'
        limit 1)
     ) $$,
  'permission denied',
  'Test 15: wrong user cannot decline another invitation → permission denied'
);

-- Test 16: Re-invite after cancel → new pending row, old cancelled preserved
do $$ begin perform set_jwt_email('test.owner@nireq.local'); end $$;
-- newstaff@external.com was cancelled in Test 7
select results_eq(
  $$ select (public.invite_team_member(
       (select artist_id from _test_ids),
       'newstaff@external.com', 'manager'
     ) ->> 'result')::text $$,
  $$ values ('invitation_sent') $$,
  'Test 16: re-invite after cancel → invitation_sent'
);
select ok(
  (select count(*) from public.artist_member_invitations
   where lower(invited_email) = 'newstaff@external.com') >= 2,
  'Test 16b: old cancelled row preserved alongside new pending row'
);

-- Test 17: Expired invitations excluded from list_my_pending_invitations
do $$ begin perform set_jwt_email('expired@external.com'); end $$;
select ok(
  (select count(*) from public.list_my_pending_invitations()) = 0,
  'Test 17: expired invitations excluded from list_my_pending_invitations'
);

-- Test 18: list_team_invitations returns only pending rows
do $$ begin perform set_jwt_email('test.owner@nireq.local'); end $$;
select ok(
  (select count(*) from public.list_team_invitations((select artist_id from _test_ids))
   where role is not null) >= 1,
  'Test 18: list_team_invitations returns at least one pending row'
);
select ok(
  not exists(
    select 1 from public.list_team_invitations((select artist_id from _test_ids)) lti
    join public.artist_member_invitations ami
      on ami.id = lti.id
    where ami.status != 'pending'
  ),
  'Test 18b: list_team_invitations returns no non-pending rows'
);

select * from finish();
rollback;
