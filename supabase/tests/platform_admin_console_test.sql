begin;
select no_plan();
-- This disposable instance can also contain synthetic browser fixtures. Assert
-- the delta contributed by our records rather than assuming global emptiness.
select set_config('test.console_active_events',(select count(*)::text from public.events where status='Confirmed' and start_date<=now() and end_date>now()),true);
select set_config('test.console_active_campaigns',(select count(*)::text from public.online_campaigns where publication_status='published' and opens_at<=now() and closes_at>now()),true);
select set_config('test.console_active_queue',(select count(*)::text from public.queues where status in ('waiting','calling','serving')),true);
insert into auth.users(id,email,email_confirmed_at) values
('ca000000-0000-4000-8000-000000000001','console-admin@example.test',now()),
('ca000000-0000-4000-8000-000000000002','console-member@example.test',now());
insert into public.platform_admins(admin_email,auth_user_id) values('console-admin@example.test','ca000000-0000-4000-8000-000000000001');
insert into public.platform_admins(admin_email) values('unbound@example.test');
insert into public.artists(id,slug,display_name,email) values('ca000000-0000-4000-8000-000000000002','console-fixture','Console store','console-member@example.test');
insert into public.events(id,artist_id,event_name,start_date,end_date) values('ca100000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000002','Console event',now(),now()+interval '1 day');
insert into public.online_campaigns(id,artist_id,name,slug,opens_at,closes_at) values('ca200000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000002','Console campaign','console',now(),now()+interval '1 day');
insert into public.orders(id,event_id,order_type,total_price,customer_name,customer_email,pickup_code) values('ca300000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001','preorder',100,'PRIVATE CUSTOMER','secret@example.test','CON123');
insert into public.order_payments(order_id,event_id,artist_id,amount_expected,payment_status) values('ca300000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000002',100,'awaiting_payment');
insert into public.queues(id,artist_id,event_id,queue_number,status,queue_service_date) values('ca400000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000002','ca100000-0000-4000-8000-000000000001',1,'calling',current_date);
insert into public.events(id,artist_id,event_name,start_date,end_date,status) values
('ca100000-0000-4000-8000-000000000002','ca000000-0000-4000-8000-000000000002','Future fixture',now()+interval '1 day',now()+interval '2 days','Confirmed'),
('ca100000-0000-4000-8000-000000000003','ca000000-0000-4000-8000-000000000002','Ended fixture',now()-interval '2 days',now()-interval '1 day','Ended'),
('ca100000-0000-4000-8000-000000000004','ca000000-0000-4000-8000-000000000002','Cancelled fixture',now()-interval '1 hour',now()+interval '1 day','Cancelled');
set local role anon;
select throws_ok($$select public.platform_admin_console('overview')$$,'42501',null,'anonymous console blocked');
select throws_ok($$select private.bootstrap_platform_admin(gen_random_uuid(),'bootstrap reason')$$,'42501',null,'browser cannot bootstrap');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000002","email":"unbound@example.test","aal":"aal2"}',true);
select is(public.is_platform_admin_account(),false,'email-only unbound grant is inert');
select throws_ok($$select public.platform_admin_console('overview')$$,'42501','forbidden','ordinary MFA user denied');
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000001","email":"console-admin@example.test","aal":"aal1"}',true);
select throws_ok($$select public.platform_admin_console('users')$$,'42501','forbidden','AAL1 cannot read Auth users');
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000001","email":"console-admin@example.test","aal":"aal2"}',true);
select is(public.platform_admin_console('overview')->>'ok','true','AAL2 admin real overview');
select is(public.platform_admin_console('users')->>'page_size','20','bounded pagination');
select is(public.platform_admin_console('users','console-member')->>'total','1','search finds account');
select is(public.platform_admin_console('user',null,'ca000000-0000-4000-8000-000000000002')->'detail'->>'email_masked','c***@example.test','email masked');
select is((public.platform_admin_console('overview')->'counts'->>'active_queue_entries')::int,current_setting('test.console_active_queue')::int+1,'calling queues count as active');
select is((public.platform_admin_console('overview')->'counts'->>'active_events')::int,current_setting('test.console_active_events')::int+1,'active event count uses status and dates');
select is((public.platform_admin_console('overview')->'counts'->>'active_campaigns')::int,current_setting('test.console_active_campaigns')::int,'draft campaign is not active');
select is(public.platform_admin_console('events','Console event')->>'total','1','real event list');
select is(public.platform_admin_console('campaigns','Console campaign')->>'total','1','real campaign list');
select is(public.platform_admin_console('creators','console-fixture')->>'total','1','real creator list');
select is(public.platform_admin_console('operations_orders','CON123')->'items'->0->>'code','CON123','real pickup code searchable');
select is(public.platform_admin_console('operations_orders','CON123')->'items'->0->>'payment_status','awaiting_payment','payment status comes from payment ledger');
select ok(position('PRIVATE CUSTOMER' in public.platform_admin_console('operations_orders')::text)=0,'customer identity excluded from operations');
select ok(position('secret@example.test' in public.platform_admin_console('operations_orders')::text)=0,'customer contact excluded from operations');
select is(public.platform_admin_console('operations_queue')->'items'->0->>'queue_number','1','real queue list');
select is(public.platform_admin_console('user',null,'ca000000-0000-4000-8000-000000000002')->'detail'->'memberships'->0->>'role','owner','legacy UID ownership appears in user memberships');
select throws_ok($$select public.platform_admin_console('auth.users')$$,'22023','unknown action','view names are allowlisted');
select throws_ok($$select public.platform_admin_console('users',null,null,0)$$,'22023','invalid query','invalid pagination denied');
select throws_ok($$select public.change_platform_admin('ca000000-0000-4000-8000-000000000002',true,'')$$,'P0001','reason required','reason required');
select is(public.change_platform_admin('ca000000-0000-4000-8000-000000000002',true,'Grant operator access'),true,'grant verified account');
select is(public.change_platform_admin('ca000000-0000-4000-8000-000000000002',false,'Revoke operator access'),true,'revoke administrator');
select throws_ok($$select public.change_platform_admin('ca000000-0000-4000-8000-000000000001',false,'Revoke self access')$$,'P0001','cannot revoke your own administrator access','self-lockout protected');
select throws_ok($$update public.creator_applications set status='approved'$$,'42501',null,'direct application transition denied');
select throws_ok($$select * from private.console_users$$,'42501',null,'private views not client readable');
select throws_ok($$insert into private.platform_admin_audit(action) values('fake')$$,'42501',null,'audit append restricted');
reset role;
select ok((select count(*)>=4 from private.platform_admin_audit where actor_id='ca000000-0000-4000-8000-000000000001'),'successful reads and changes audited');
select * from finish();
rollback;
