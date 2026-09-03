begin;

select plan(4);

select has_table('public', 'preorder_notification_deliveries', 'notification delivery ledger exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.preorder_notification_deliveries'::regclass),
  'notification delivery ledger has RLS enabled'
);

select ok(
  (select pg_get_constraintdef(oid)
   from pg_constraint
   where conrelid = 'public.preorder_notification_deliveries'::regclass
     and conname = 'preorder_notification_deliveries_notification_event_check')
    like '%ready_for_pickup%shipped%payment_rejected%refund_required%',
  'notification ledger accepts the online campaign customer events'
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
