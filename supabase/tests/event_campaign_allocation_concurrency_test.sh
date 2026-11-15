#!/usr/bin/env bash
set -euo pipefail
[[ "${STOCK_RACE_DISPOSABLE:-}" == 1 && "${STOCK_RACE_DB_CONTAINER:-}" == supabase_db_*Validation ]] || { echo 'Disposable local validation database required' >&2; exit 1; }
db="$STOCK_RACE_DB_CONTAINER"
psql_local() { docker exec -i "$db" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
tmp="$(mktemp -d)"
ids="$(psql_local -At -c 'select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()')"
IFS='|' read -r artist product event campaign <<<"$ids"
cleanup() {
  psql_local >/dev/null 2>&1 <<SQL || true
delete from public.online_campaign_products where campaign_id='$campaign';
delete from public.event_products where event_id='$event';
delete from public.online_campaigns where id='$campaign';
delete from public.events where id='$event';
delete from public.products where id='$product';
delete from public.artists where id='$artist';
SQL
  rm -rf "$tmp"
}
trap cleanup EXIT
psql_local >/dev/null <<SQL
insert into public.artists(id,slug,display_name) values ('$artist','stock-race-${artist:0:8}','Stock race');
insert into public.products(id,artist_id,name,price,stock_total,is_unlimited) values ('$product','$artist','Race product',100,50,false);
insert into public.events(id,artist_id,event_name,start_date,end_date,status) values ('$event','$artist','Race event',now(),now()+interval '1 day','Confirmed');
insert into public.online_campaigns(id,artist_id,name,slug,opens_at,closes_at) values ('$campaign','$artist','Race campaign','stock-race-${campaign:0:8}',now(),now()+interval '1 day');
insert into public.event_products(event_id,artist_id,product_id,stock_total,is_unlimited,is_enabled) values ('$event','$artist','$product',0,false,true);
insert into public.online_campaign_products(campaign_id,artist_id,product_id,stock_total,is_unlimited,is_enabled) values ('$campaign','$artist','$product',0,false,true);
SQL
psql_local >"$tmp/event.log" 2>&1 <<SQL &
begin;
set application_name='paimon-stock-race-$product';
select id from public.products where id='$product' for update;
select pg_sleep(2);
update public.event_products set stock_total=40 where event_id='$event' and product_id='$product';
commit;
SQL
event_pid=$!
locked=0
for _ in {1..30}; do
  if [[ "$(psql_local -At -c "select count(*) from pg_stat_activity where application_name='paimon-stock-race-$product' and state='active' and query like 'select pg_sleep%'")" == 1 ]]; then locked=1; break; fi
  sleep 0.05
done
[[ "$locked" == 1 ]] || { echo 'Event transaction did not acquire the stock lock' >&2; wait "$event_pid" || true; exit 1; }
psql_local >"$tmp/campaign.log" 2>&1 <<SQL &
update public.online_campaign_products set stock_total=40 where campaign_id='$campaign' and product_id='$product';
SQL
campaign_pid=$!
wait "$event_pid"
if wait "$campaign_pid"; then echo 'Campaign unexpectedly over-allocated' >&2; exit 1; fi
grep -q 'campaign_stock_exceeds_catalog_stock' "$tmp/campaign.log"
result="$(psql_local -At -c "select (select stock_total from public.event_products where event_id='$event'),(select stock_total from public.online_campaign_products where campaign_id='$campaign')")"
[[ "$result" == '40|0' ]] || { echo "Unexpected persisted totals: $result" >&2; exit 1; }
echo 'PASS: concurrent event and campaign requests preserve stock (40 + 0 of 50)'
