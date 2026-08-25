begin;

select plan(2);

select is(
  (
    select count(*)
    from unnest(array[
      'artist_promotions',
      'artists',
      'event_products',
      'events',
      'order_payments',
      'orders',
      'products',
      'queues'
    ]) expected(tablename)
    where not exists (
      select 1
      from pg_publication_tables published
      where published.pubname = 'supabase_realtime'
        and published.schemaname = 'public'
        and published.tablename = expected.tablename
    )
  ),
  0::bigint,
  'every table used by a Postgres Changes subscription is published'
);

select ok(
  not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'artist_promotions',
        'artists',
        'event_products',
        'events',
        'order_payments',
        'orders',
        'products',
        'queues'
      )
      and not c.relrowsecurity
  ),
  'every published application table keeps RLS enabled'
);

select * from finish();

rollback;
