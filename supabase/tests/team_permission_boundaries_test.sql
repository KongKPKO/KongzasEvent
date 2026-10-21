begin;

select no_plan();

do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_other_owner_id uuid := gen_random_uuid();
  v_staff_id uuid := gen_random_uuid();
  v_invitee_id uuid := gen_random_uuid();
  v_artist_id uuid := gen_random_uuid();
  v_other_artist_id uuid := gen_random_uuid();
  v_member_id uuid := gen_random_uuid();
  v_manager_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_second_event_id uuid := gen_random_uuid();
  v_other_event_id uuid := gen_random_uuid();
  v_accept_invitation_id uuid := gen_random_uuid();
  v_cancel_invitation_id uuid := gen_random_uuid();
  v_decline_invitation_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, aud, role
  ) values
    (v_owner_id, 'team.boundary.owner@nireq.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_other_owner_id, 'team.boundary.other-owner@nireq.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_staff_id, 'team.boundary.staff@nireq.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_invitee_id, 'team.boundary.invitee@nireq.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated');

  insert into public.artists (id, slug, display_name) values
    (v_artist_id, 'team-boundary-artist', 'Team Boundary Artist'),
    (v_other_artist_id, 'team-boundary-other', 'Team Boundary Other');

  insert into public.artist_members (id, artist_id, member_email, role, status) values
    (gen_random_uuid(), v_artist_id, 'team.boundary.owner@nireq.local', 'owner', 'active'),
    (gen_random_uuid(), v_other_artist_id, 'team.boundary.other-owner@nireq.local', 'owner', 'active'),
    (v_member_id, v_artist_id, 'team.boundary.staff@nireq.local', 'seller', 'active'),
    (v_manager_id, v_artist_id, 'team.boundary.manager@nireq.local', 'manager', 'active');

  insert into public.events (id, artist_id, event_name, start_date, end_date, status) values
    (v_event_id, v_artist_id, 'Boundary Event One', now(), now() + interval '1 day', 'Confirmed'),
    (v_second_event_id, v_artist_id, 'Boundary Event Two', now(), now() + interval '1 day', 'Confirmed'),
    (v_other_event_id, v_other_artist_id, 'Other Artist Event', now(), now() + interval '1 day', 'Confirmed');

  insert into public.artist_member_invitations (id, artist_id, invited_email, role) values
    (v_accept_invitation_id, v_artist_id, 'team.boundary.invitee@nireq.local', 'queue_staff'),
    (v_cancel_invitation_id, v_artist_id, 'team.boundary.cancel@nireq.local', 'queue_staff'),
    (v_decline_invitation_id, v_artist_id, 'team.boundary.decline@nireq.local', 'queue_staff');

  insert into public.artist_member_invitation_events (invitation_id, artist_id, event_id)
  values (v_accept_invitation_id, v_artist_id, v_event_id);

  create temp table _team_boundary_ids (
    owner_id uuid,
    other_owner_id uuid,
    staff_id uuid,
    invitee_id uuid,
    artist_id uuid,
    member_id uuid,
    manager_id uuid,
    event_id uuid,
    second_event_id uuid,
    other_event_id uuid,
    accept_invitation_id uuid,
    cancel_invitation_id uuid,
    decline_invitation_id uuid
  );

  insert into _team_boundary_ids values (
    v_owner_id, v_other_owner_id, v_staff_id, v_invitee_id, v_artist_id,
    v_member_id, v_manager_id, v_event_id, v_second_event_id, v_other_event_id,
    v_accept_invitation_id, v_cancel_invitation_id, v_decline_invitation_id
  );
end $$;

-- An invitee must have completed Auth signup before presenting a JWT.
insert into auth.users(id,email,email_confirmed_at)
select gen_random_uuid(),email,now() from unnest(array[
 'team.boundary.cancel@nireq.local','team.boundary.decline@nireq.local'
]) as fixture(email);

create or replace function set_team_boundary_jwt(p_email text) returns void as $$
declare
  v_uid uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(p_email) limit 1;
  perform set_config(
    'request.jwt.claims',
    json_build_object('email', p_email, 'sub', coalesce(v_uid, gen_random_uuid())::text)::text,
    true
  );
end;
$$ language plpgsql;

select ok(
  has_function_privilege('authenticated', 'public.replace_event_member_assignments(uuid,uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.replace_event_member_assignments(uuid,uuid[])', 'execute'),
  'atomic assignment RPC is authenticated-only'
);

select ok(
  not has_table_privilege('authenticated', 'public.event_member_assignments', 'insert')
  and not has_table_privilege('authenticated', 'public.event_member_assignments', 'update')
  and not has_table_privilege('authenticated', 'public.event_member_assignments', 'delete'),
  'authenticated clients cannot bypass the assignment RPC with direct writes'
);

do $$ begin perform set_team_boundary_jwt('team.boundary.owner@nireq.local'); end $$;

select ok(
  public.replace_event_member_assignments(
    (select member_id from _team_boundary_ids),
    array[(select event_id from _team_boundary_ids)]
  ),
  'owner can replace assignments for event-scoped staff'
);

select results_eq(
  $$ select event_id from public.event_member_assignments
     where member_id = (select member_id from _team_boundary_ids) $$,
  $$ values ((select event_id from _team_boundary_ids)) $$,
  'replacement stores exactly the selected event'
);

select throws_ok(
  $$ select public.replace_event_member_assignments(
       (select member_id from _team_boundary_ids),
       array[(select second_event_id from _team_boundary_ids), (select other_event_id from _team_boundary_ids)]
     ) $$,
  'invalid_event_access',
  'cross-artist event selection is rejected'
);

select results_eq(
  $$ select event_id from public.event_member_assignments
     where member_id = (select member_id from _team_boundary_ids) $$,
  $$ values ((select event_id from _team_boundary_ids)) $$,
  'failed replacement rolls back without widening access'
);

select throws_ok(
  $$ select public.replace_event_member_assignments(
       (select member_id from _team_boundary_ids),
       array[(select event_id from _team_boundary_ids), (select event_id from _team_boundary_ids)]
     ) $$,
  'invalid_event_access',
  'duplicate event ids are rejected at the RPC boundary'
);


select throws_ok(
  $$ select public.replace_event_member_assignments((select member_id from _team_boundary_ids), null) $$,
  'invalid_event_access', 'null cannot silently clear restrictions'
);
create function public.fail_team_assignment_insert() returns trigger language plpgsql as $$
begin raise exception 'forced_assignment_failure'; end;
$$;
create trigger fail_team_assignment_insert before insert on public.event_member_assignments
for each row execute function public.fail_team_assignment_insert();
select throws_ok(
  $$ select public.replace_event_member_assignments((select member_id from _team_boundary_ids), array[(select second_event_id from _team_boundary_ids)]) $$,
  'forced_assignment_failure', 'an insert failure after deletion aborts the replacement'
);
select results_eq(
  $$select event_id from public.event_member_assignments where member_id=(select member_id from _team_boundary_ids)$$,
  $$values ((select event_id from _team_boundary_ids))$$,
  'insert failure retains original event restriction'
);
drop trigger fail_team_assignment_insert on public.event_member_assignments;
drop function public.fail_team_assignment_insert();

do $$ begin perform set_team_boundary_jwt('team.boundary.other-owner@nireq.local'); end $$;

select throws_ok(
  $$ select public.replace_event_member_assignments(
       (select member_id from _team_boundary_ids),
       array[(select event_id from _team_boundary_ids)]
     ) $$,
  'forbidden',
  'an owner cannot change another artist team assignments'
);

do $$ begin perform set_team_boundary_jwt('team.boundary.owner@nireq.local'); end $$;

select ok(
  public.replace_event_member_assignments(
    (select member_id from _team_boundary_ids),
    array[]::uuid[]
  ),
  'owner can clear restrictions explicitly'
);

select is(
  (select count(*) from public.event_member_assignments
   where member_id = (select member_id from _team_boundary_ids)),
  0::bigint,
  'zero assignment rows preserve all-events semantics'
);

do $$ begin perform set_team_boundary_jwt('team.boundary.staff@nireq.local'); end $$;

select ok(
  public.has_event_role((select second_event_id from _team_boundary_ids), array['seller']),
  'staff with zero assignment rows can still access all events for their role'
);

do $$ begin perform set_team_boundary_jwt('team.boundary.owner@nireq.local'); end $$;

select throws_ok(
  $$ select public.replace_event_member_assignments(
       (select manager_id from _team_boundary_ids),
       array[(select event_id from _team_boundary_ids)]
     ) $$,
  'member_role_not_event_scoped',
  'manager rows cannot be given misleading event restrictions'
);

do $$ begin perform set_team_boundary_jwt('team.boundary.invitee@nireq.local'); end $$;

select results_eq(
  $$ select public.accept_team_invitation((select accept_invitation_id from _team_boundary_ids)) ->> 'result' $$,
  $$ values ('accepted') $$,
  'invitee can accept a pending invitation'
);

select throws_ok(
  $$ select public.accept_team_invitation((select accept_invitation_id from _team_boundary_ids)) $$,
  null,
  'invitation is not pending (current status: accepted)',
  'accepted invitation cannot be replayed'
);

select ok(
  exists (
    select 1 from public.artist_members m
    where m.artist_id = (select artist_id from _team_boundary_ids)
      and lower(m.member_email) = 'team.boundary.invitee@nireq.local'
      and m.status = 'active'
  ),
  'failed invitation replay preserves the accepted membership'
);

do $$ begin perform set_team_boundary_jwt('team.boundary.owner@nireq.local'); end $$;

select results_eq(
  $$ select public.cancel_team_invitation((select cancel_invitation_id from _team_boundary_ids)) ->> 'result' $$,
  $$ values ('cancelled') $$,
  'owner can cancel a pending invitation'
);

do $$ begin perform set_team_boundary_jwt('team.boundary.cancel@nireq.local'); end $$;

select throws_ok(
  $$ select public.accept_team_invitation((select cancel_invitation_id from _team_boundary_ids)) $$,
  null,
  'invitation is not pending (current status: cancelled)',
  'cancelled invitation cannot create a membership'
);

do $$ begin perform set_team_boundary_jwt('team.boundary.decline@nireq.local'); end $$;

select results_eq(
  $$ select public.decline_team_invitation((select decline_invitation_id from _team_boundary_ids)) ->> 'result' $$,
  $$ values ('declined') $$,
  'invitee can decline a pending invitation'
);

do $$ begin perform set_team_boundary_jwt('team.boundary.owner@nireq.local'); end $$;

select throws_ok(
  $$ select public.cancel_team_invitation((select decline_invitation_id from _team_boundary_ids)) $$,
  null,
  'invitation is not pending (current status: declined)',
  'declined invitation cannot be cancelled afterward'
);

select * from finish();
rollback;
