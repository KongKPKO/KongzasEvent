begin;

select plan(2);

with expected(signature) as (
  values
    ('public.update_last_updated_at_column()'),
    ('public.update_last_updated_column()'),
    ('public.update_updated_at_column()'),
    ('public.check_active_currency_consistency()'),
    ('public.set_updated_at_timestamp()'),
    ('public.normalize_artist_role(text)')
)
select is(
  (
    select count(*)
    from expected e
    join pg_proc p on p.oid = to_regprocedure(e.signature)
    where 'search_path=""' = any(coalesce(p.proconfig, array[]::text[]))
  ),
  6::bigint,
  'all advisor-reported functions pin an empty search path'
);

do $$
declare
  v_artist_id uuid := gen_random_uuid();
begin
  insert into public.artists (id, slug, display_name)
  values (v_artist_id, 'search-path-currency-test', 'Search Path Currency Test');

  insert into public.products (
    artist_id, name, price, status, currency, is_unlimited
  ) values (
    v_artist_id, 'THB Product', 100, 'enable', 'THB', true
  );

  create temp table _search_path_test_artist (artist_id uuid) on commit drop;
  insert into _search_path_test_artist values (v_artist_id);
end $$;

select throws_ok(
  $$
    insert into public.products (
      artist_id, name, price, status, currency, is_unlimited
    ) values (
      (select artist_id from _search_path_test_artist),
      'USD Product', 10, 'enable', 'USD', true
    )
  $$,
  'P0001',
  'Conflict Currency: ร้านนี้มีเมนูที่ขายเป็นสกุลเงิน THB อยู่แล้ว ไม่สามารถเปิดขายเมนูที่เป็น USD ผสมกันได้',
  'currency consistency still rejects mixed active currencies'
);

select * from finish();

rollback;
