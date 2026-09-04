#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

project_id="$(sed -n 's/^project_id = "\([^"]*\)"/\1/p' supabase/config.toml | head -1)"
db_container="supabase_db_${project_id}"

supabase db reset --local --version 20260904140000 --no-seed --yes

docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
insert into public.artists (id, slug, display_name, is_public)
values ('66666666-6666-4666-8666-666666666666'::uuid, 'sku-migration-test', 'SKU Migration Test', false);

insert into public.products (
  id, artist_id, name, category, variant_name, sku, price, currency,
  stock_total, stock_reserved, stock_sold, is_unlimited, status, created_at
) values
  (
    '66666666-6666-4666-8666-666666666651'::uuid,
    '66666666-6666-4666-8666-666666666666'::uuid,
    'Cheki HSR', 'Cheki', 'Yaoguang Normal', null,
    100, 'THB', 1, 0, 0, false, 'enable', now() - interval '3 minutes'
  ),
  (
    '66666666-6666-4666-8666-666666666652'::uuid,
    '66666666-6666-4666-8666-666666666666'::uuid,
    'Cheki Alpha', 'Cheki', 'Yaoguang Normal', null,
    100, 'THB', 1, 0, 0, false, 'enable', now() - interval '2 minutes'
  ),
  (
    '66666666-6666-4666-8666-666666666653'::uuid,
    '66666666-6666-4666-8666-666666666666'::uuid,
    'Cheki Beta', 'Cheki', 'Yaoguang Normal', null,
    100, 'THB', 1, 0, 0, false, 'enable', now() - interval '1 minute'
  ),
  (
    '66666666-6666-4666-8666-666666666654'::uuid,
    '66666666-6666-4666-8666-666666666666'::uuid,
    'Manual migration fixture', 'Other', null, 'manual-keep',
    100, 'THB', 1, 0, 0, false, 'enable', now()
  );

alter table public.products disable trigger trg_products_generate_sku;

update public.products
set sku = case id
    when '66666666-6666-4666-8666-666666666651'::uuid then 'CHE-ITEM-N-050'
    when '66666666-6666-4666-8666-666666666652'::uuid then 'CHE-YAOGUANG-NORMAL-999'
    when '66666666-6666-4666-8666-666666666653'::uuid then 'CHE-YAOGUANG-VARIANT-999'
  end,
  sku_is_generated = true
where id in (
  '66666666-6666-4666-8666-666666666651'::uuid,
  '66666666-6666-4666-8666-666666666652'::uuid,
  '66666666-6666-4666-8666-666666666653'::uuid
);

alter table public.products enable trigger trg_products_generate_sku;

insert into public.events (
  id, artist_id, event_name, start_date, end_date, status
) values (
  '66666666-6666-4666-8666-666666666661'::uuid,
  '66666666-6666-4666-8666-666666666666'::uuid,
  'SKU migration snapshot event', now(), now() + interval '1 day', 'Confirmed'
);

insert into public.orders (id, event_id, order_type, currency)
values (
  '66666666-6666-4666-8666-666666666662'::uuid,
  '66666666-6666-4666-8666-666666666661'::uuid,
  'live_queue', 'THB'
);

insert into public.order_items (
  id, order_id, product_id, quantity, price_per_unit, currency,
  product_name_snapshot, sku_snapshot
) values (
  '66666666-6666-4666-8666-666666666663'::uuid,
  '66666666-6666-4666-8666-666666666662'::uuid,
  '66666666-6666-4666-8666-666666666651'::uuid,
  1, 100, 'THB', 'Cheki HSR', 'CHE-ITEM-N-050'
);
SQL

supabase migration up --local

tap_output="$({ docker exec -i "$db_container" psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(5);

select ok(
  (select sku = 'CHE-YAOG-N-050' and sku_is_generated
   from public.products where id = '66666666-6666-4666-8666-666666666651'::uuid),
  'variant-aware rewrite preserves the generated suffix'
);

select is(
  (select sku from public.products where id = '66666666-6666-4666-8666-666666666652'::uuid),
  'CHE-YAOG-N-999',
  'the oldest compact collision keeps its suffix'
);

select is(
  (select sku from public.products where id = '66666666-6666-4666-8666-666666666653'::uuid),
  'CHE-YAOG-N-1000',
  'the later compact collision grows beyond three digits without truncation'
);

select ok(
  (select sku = 'MANUAL-KEEP' and not sku_is_generated
   from public.products where id = '66666666-6666-4666-8666-666666666654'::uuid),
  'manual SKU value and ownership remain unchanged'
);

select is(
  (select sku_snapshot from public.order_items
   where id = '66666666-6666-4666-8666-666666666663'::uuid),
  'CHE-ITEM-N-050',
  'historical order SKU snapshot remains unchanged'
);

select * from finish();
rollback;
SQL
} 2>&1)"

printf '%s\n' "$tap_output"
if grep -q '^not ok' <<<"$tap_output" || ! grep -q '^1\.\.5$' <<<"$tap_output"; then
  exit 1
fi
