#!/usr/bin/env bash
set -euo pipefail
: "${QUEUE_RACE_DB_CONTAINER:?Set QUEUE_RACE_DB_CONTAINER to the disposable local database container}"
[[ "${QUEUE_RACE_DISPOSABLE:-}" == 1 ]] || { echo 'Disposable database confirmation required' >&2; exit 1; }
owner=$(uuidgen | tr '[:upper:]' '[:lower:]')
event=$(uuidgen | tr '[:upper:]' '[:lower:]')
first=$(uuidgen | tr '[:upper:]' '[:lower:]')
second=$(uuidgen | tr '[:upper:]' '[:lower:]')
email="queue-race-${owner}@example.test"
psql_local() { docker exec -i "$QUEUE_RACE_DB_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
cleanup() { psql_local -q <<SQL >/dev/null
 delete from public.queues where event_id='$event';
 delete from public.events where id='$event';
 delete from public.artists where id='$owner';
 delete from auth.users where id='$owner';
SQL
}
trap cleanup EXIT
psql_local -q <<SQL
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role) values('$owner','$email','{}','{}','authenticated','authenticated');
insert into public.artists(id,slug,display_name) values('$owner','q${owner:0:8}','Queue race');
insert into public.events(id,artist_id,event_name,start_date,end_date,event_timezone,status,is_booth_open) values('$event','$owner','Queue race',now()-interval '1 hour',now()+interval '1 day','Asia/Bangkok','Confirmed',true);
insert into public.queues(id,artist_id,event_id,queue_number,status,queue_service_date,arrived_at) values
('$first','$owner','$event',1,'calling',(now() at time zone 'Asia/Bangkok')::date,now()),
('$second','$owner','$event',2,'calling',(now() at time zone 'Asia/Bangkok')::date,now());
SQL
start_queue() { psql_local -q <<SQL >/dev/null
select set_config('request.jwt.claims','{"sub":"$owner","email":"$email","role":"authenticated"}',false);
select public.update_queue_operation(id,'serving',last_updated_at) from public.queues where id='$1';
SQL
}
start_queue "$first" & first_pid=$!
start_queue "$second" & second_pid=$!
wait "$first_pid"
wait "$second_pid"
psql_local -q <<SQL
DO \$\$ BEGIN
 if (select count(*) from public.queues where event_id='$event' and status='serving') <> 1 or
    (select count(*) from public.queues where event_id='$event' and status='complete') <> 1 then
  raise exception 'concurrent starts did not produce one serving and one completed ticket';
 end if;
END \$\$;
SQL
echo 'Concurrent queue starts passed.'
