#!/usr/bin/env bash
set -euo pipefail

if [[ "${TEAM_RACE_TEST_DISPOSABLE:-}" != "1" ]]; then
  echo "Refusing to mutate a database without TEAM_RACE_TEST_DISPOSABLE=1." >&2
  exit 1
fi

db_container="${TEAM_RACE_TEST_DB_CONTAINER:-}"
if [[ -z "$db_container" ]]; then
  echo "Set TEAM_RACE_TEST_DB_CONTAINER to the disposable local Supabase DB container." >&2
  exit 1
fi

if ! docker inspect "$db_container" >/dev/null 2>&1; then
  echo "Database container does not exist: $db_container" >&2
  exit 1
fi

psql_in_container() {
  docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}

owner_id="8a100000-0000-4000-8000-000000000001"
artist_id="8a100000-0000-4000-8000-000000000002"
member_id="8a100000-0000-4000-8000-000000000003"
event_one_id="8a100000-0000-4000-8000-000000000004"
event_two_id="8a100000-0000-4000-8000-000000000005"
owner_email="team.race.owner@nireq.local"
staff_email="team.race.staff@nireq.local"
tmp_dir="$(mktemp -d)"

cleanup() {
  psql_in_container >/dev/null 2>&1 <<SQL || true
delete from public.artists where id = '$artist_id'::uuid;
delete from auth.users
where id = '$owner_id'::uuid
   or email like 'team.race.invitee.%@nireq.local';
SQL
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

psql_in_container >/dev/null <<SQL
insert into auth.users (
  id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, aud, role
) values (
  '$owner_id'::uuid, '$owner_email', 'x', now(), now(), now(),
  '{}', '{}', 'authenticated', 'authenticated'
);

insert into public.artists (id, slug, display_name)
values ('$artist_id'::uuid, 'team-race-artist', 'Team Race Artist');

insert into public.artist_members (id, artist_id, member_email, role, status)
values
  (gen_random_uuid(), '$artist_id'::uuid, '$owner_email', 'owner', 'active'),
  ('$member_id'::uuid, '$artist_id'::uuid, '$staff_email', 'seller', 'active');

insert into public.events (id, artist_id, event_name, start_date, end_date, status)
values
  ('$event_one_id'::uuid, '$artist_id'::uuid, 'Race Event One', now(), now() + interval '1 day', 'Confirmed'),
  ('$event_two_id'::uuid, '$artist_id'::uuid, 'Race Event Two', now(), now() + interval '1 day', 'Confirmed');
SQL

for iteration in 1 2 3; do
  IFS='|' read -r invitee_id invitation_id <<<"$(
    psql_in_container -A -t -F '|' -c "select gen_random_uuid(), gen_random_uuid()"
  )"
  invitee_email="team.race.invitee.${iteration}@nireq.local"

  psql_in_container >/dev/null <<SQL
insert into auth.users (
  id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, aud, role
) values (
  '$invitee_id'::uuid, '$invitee_email', 'x', now(), now(), now(),
  '{}', '{}', 'authenticated', 'authenticated'
);

insert into public.artist_member_invitations (id, artist_id, invited_email, role, invited_by)
values ('$invitation_id'::uuid, '$artist_id'::uuid, '$invitee_email', 'queue_staff', '$owner_id'::uuid);

insert into public.artist_member_invitation_events (invitation_id, artist_id, event_id)
values ('$invitation_id'::uuid, '$artist_id'::uuid, '$event_one_id'::uuid);
SQL

  psql_in_container >"$tmp_dir/invitation-lock-${iteration}.log" 2>&1 <<SQL &
begin;
select id from public.artist_member_invitations
where id = '$invitation_id'::uuid
for update;
select pg_sleep(1);
commit;
SQL
  lock_pid=$!
  sleep 0.2

  psql_in_container >"$tmp_dir/accept-${iteration}.log" 2>&1 <<SQL &
select set_config(
  'request.jwt.claims',
  json_build_object('email', '$invitee_email', 'sub', '$invitee_id')::text,
  false
);
select public.accept_team_invitation('$invitation_id'::uuid);
SQL
  accept_pid=$!

  psql_in_container >"$tmp_dir/cancel-${iteration}.log" 2>&1 <<SQL &
select set_config(
  'request.jwt.claims',
  json_build_object('email', '$owner_email', 'sub', '$owner_id')::text,
  false
);
select public.cancel_team_invitation('$invitation_id'::uuid);
SQL
  cancel_pid=$!

  psql_in_container >"$tmp_dir/decline-${iteration}.log" 2>&1 <<SQL &
select set_config(
  'request.jwt.claims',
  json_build_object('email', '$invitee_email', 'sub', '$invitee_id')::text,
  false
);
select public.decline_team_invitation('$invitation_id'::uuid);
SQL
  decline_pid=$!

  wait "$lock_pid"
  set +e
  wait "$accept_pid"
  accept_status=$?
  wait "$cancel_pid"
  cancel_status=$?
  wait "$decline_pid"
  decline_status=$?
  set -e

  if (( (accept_status == 0) + (cancel_status == 0) + (decline_status == 0) != 1 )); then
    echo "Invitation race $iteration did not produce exactly one successful transition." >&2
    cat "$tmp_dir/accept-${iteration}.log" "$tmp_dir/cancel-${iteration}.log" "$tmp_dir/decline-${iteration}.log" >&2
    exit 1
  fi

  transition_state="$(psql_in_container -A -t -F '|' -c "
    select i.status, count(m.id)
    from public.artist_member_invitations i
    left join public.artist_members m
      on m.artist_id = i.artist_id
     and lower(m.member_email) = lower(i.invited_email)
    where i.id = '$invitation_id'::uuid
    group by i.status
  ")"

  if [[ "$transition_state" != "accepted|1" && "$transition_state" != "cancelled|0" && "$transition_state" != "declined|0" ]]; then
    echo "Invitation race $iteration left inconsistent state: $transition_state" >&2
    exit 1
  fi
done

psql_in_container >/dev/null <<SQL
select set_config(
  'request.jwt.claims',
  json_build_object('email', '$owner_email', 'sub', '$owner_id')::text,
  false
);
select public.replace_event_member_assignments(
  '$member_id'::uuid,
  array['$event_one_id'::uuid]
);
SQL

for iteration in 1 2 3; do
  psql_in_container >"$tmp_dir/assignment-lock-${iteration}.log" 2>&1 <<SQL &
begin;
select id from public.artist_members
where id = '$member_id'::uuid
for update;
select pg_sleep(1);
commit;
SQL
  lock_pid=$!
  sleep 0.2

  psql_in_container >"$tmp_dir/assignment-one-${iteration}.log" 2>&1 <<SQL &
select set_config(
  'request.jwt.claims',
  json_build_object('email', '$owner_email', 'sub', '$owner_id')::text,
  false
);
select public.replace_event_member_assignments(
  '$member_id'::uuid,
  array['$event_one_id'::uuid]
);
SQL
  first_pid=$!

  psql_in_container >"$tmp_dir/assignment-two-${iteration}.log" 2>&1 <<SQL &
select set_config(
  'request.jwt.claims',
  json_build_object('email', '$owner_email', 'sub', '$owner_id')::text,
  false
);
select public.replace_event_member_assignments(
  '$member_id'::uuid,
  array['$event_two_id'::uuid]
);
SQL
  second_pid=$!

  wait "$lock_pid"
  wait "$first_pid"
  wait "$second_pid"

  assignment_state="$(psql_in_container -A -t -F '|' -c "
    select count(*), min(event_id::text)
    from public.event_member_assignments
    where member_id = '$member_id'::uuid
  ")"

  if [[ "$assignment_state" != "1|$event_one_id" && "$assignment_state" != "1|$event_two_id" ]]; then
    echo "Assignment race $iteration left a mixed or unrestricted state: $assignment_state" >&2
    exit 1
  fi
done

echo "Team permission concurrency tests passed."
