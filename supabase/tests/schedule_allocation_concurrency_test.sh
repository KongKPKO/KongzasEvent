#!/usr/bin/env bash
set -euo pipefail
[[ "${STOCK_RACE_DISPOSABLE:-}" == 1 && "${STOCK_RACE_DB_CONTAINER:-}" == supabase_db_*Validation ]] || { echo 'Disposable local validation database required' >&2; exit 1; }
db="$STOCK_RACE_DB_CONTAINER"
psql_local() { docker exec -i "$db" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
tmp="$(mktemp -d)"
ids="$(psql_local -At -c 'select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()')"
IFS='|' read -r artist product event campaign <<<"$ids"
campaign2="$(psql_local -At -c 'select gen_random_uuid()')"
cleanup() {
  psql_local >/dev/null 2>&1 <<SQL || true
delete from public.online_campaign_products where campaign_id='$campaign';
delete from public.online_campaign_products where campaign_id='$campaign2';
delete from public.event_products where event_id='$event';
delete from public.online_campaigns where id='$campaign';
delete from public.online_campaigns where id='$campaign2';
delete from public.events where id='$event';
delete from public.products where id='$product';
delete from public.artists where id='$artist';
SQL
  rm -rf "$tmp"
}
trap cleanup EXIT
psql_local >/dev/null <<SQL
insert into public.artists(id,slug,display_name) values ('$artist','schedule-race-${artist:0:8}','Schedule race');
insert into public.products(id,artist_id,name,price,stock_total,is_unlimited) values ('$product','$artist','Product',100,50,false);
insert into public.events(id,artist_id,event_name,start_date,end_date,status) values ('$event','$artist','Event',now(),now()+interval '1 day','Confirmed');
insert into public.online_campaigns(id,artist_id,name,slug,opens_at,closes_at) values ('$campaign','$artist','Campaign','schedule-race-${campaign:0:8}',now()-interval '1 day',now()+interval '3 seconds');
insert into public.event_products(event_id,artist_id,product_id,stock_total,is_unlimited,is_enabled) values ('$event','$artist','$product',0,false,true);
insert into public.online_campaign_products(campaign_id,artist_id,product_id,stock_total,is_unlimited,is_enabled) values ('$campaign','$artist','$product',50,false,true);
SQL
psql_local >"$tmp/holder" 2>&1 <<SQL &
begin;
set application_name='schedule-lock-$product';
select id from public.products where id='$product' for update;
select pg_sleep(5);
commit;
SQL
holder=$!
locked=0
for _ in {1..40}; do
  if [[ "$(psql_local -At -c "select count(*) from pg_stat_activity where application_name='schedule-lock-$product' and state='active' and query like 'select pg_sleep%'")" == 1 ]]; then locked=1; break; fi
  sleep 0.05
done
[[ "$locked" == 1 ]] || { echo 'Failed to acquire product lock' >&2; exit 1; }
psql_local >"$tmp/schedule" 2>&1 <<SQL &
update public.online_campaigns set closes_at=closes_at+interval '1 day' where id='$campaign';
SQL
schedule=$!
sleep 3
psql_local >"$tmp/allocation" 2>&1 <<SQL &
update public.event_products set stock_total=50 where event_id='$event' and product_id='$product';
SQL
allocation=$!
wait "$holder"
if wait "$schedule"; then echo 'Expired schedule unexpectedly extended' >&2; exit 1; fi
grep -q 'campaign_schedule_ended' "$tmp/schedule"
wait "$allocation"
result="$(psql_local -At -c "select stock_total from public.event_products where event_id='$event'")"
[[ "$result" == 50 ]] || { echo "Unexpected event allocation: $result" >&2; exit 1; }
echo 'PASS: a schedule waiting past expiry cannot reclaim concurrently allocated stock'
psql_local >/dev/null <<SQL
update public.event_products set stock_total=0 where event_id='$event';
insert into public.online_campaigns(id,artist_id,name,slug,opens_at,closes_at) values ('$campaign2','$artist','Campaign 2','schedule-race-second-${campaign2:0:8}',now()-interval '1 day',now()+interval '3 seconds');
insert into public.online_campaign_products(campaign_id,artist_id,product_id,stock_total,is_unlimited,is_enabled) values ('$campaign2','$artist','$product',50,false,true);
SQL
psql_local >"$tmp/extend" 2>&1 <<SQL &
begin;
set application_name='schedule-extend-$product';
update public.online_campaigns set closes_at=closes_at+interval '1 day' where id='$campaign2';
select pg_sleep(5);
commit;
SQL
extension=$!
locked=0
for _ in {1..40}; do
  if [[ "$(psql_local -At -c "select count(*) from pg_stat_activity where application_name='schedule-extend-$product' and state='active' and query like 'select pg_sleep%'")" == 1 ]]; then locked=1; break; fi
  sleep 0.05
done
[[ "$locked" == 1 ]] || { echo 'Failed to extend while holding product lock' >&2; exit 1; }
sleep 3
psql_local >"$tmp/allocation2" 2>&1 <<SQL &
update public.event_products set stock_total=50 where event_id='$event' and product_id='$product';
SQL
allocation2=$!
wait "$extension"
if wait "$allocation2"; then echo 'Event unexpectedly allocated stock held by extended campaign' >&2; exit 1; fi
grep -q 'event_stock_exceeds_catalog_stock' "$tmp/allocation2"
echo 'PASS: a concurrent allocation cannot reuse stock after a successful extension'
