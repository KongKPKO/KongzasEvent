begin;

select plan(3);

select has_table('public', 'preorder_notification_deliveries', 'notification delivery ledger exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.preorder_notification_deliveries'::regclass),
  'notification delivery ledger has RLS enabled'
);

set local role anon;
select throws_ok(
  $$ select * from public.preorder_notification_deliveries $$,
  '42501',
  'permission denied for table preorder_notification_deliveries',
  'anonymous users cannot read notification delivery state'
);

select * from finish();
rollback;
