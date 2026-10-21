begin;
select no_plan();
delete from public.platform_admins;
insert into auth.users(id,email,email_confirmed_at) values
('cb000000-0000-4000-8000-000000000001','bootstrap-verified@example.test',now()),
('cb000000-0000-4000-8000-000000000002','bootstrap-unverified@example.test',null);
set local role authenticated;
select throws_ok($$select private.bootstrap_platform_admin('cb000000-0000-4000-8000-000000000001','Approved bootstrap')$$,'42501',null,'browser cannot bootstrap');
reset role;
select throws_ok($$select private.bootstrap_platform_admin('cb000000-0000-4000-8000-000000000002','Approved bootstrap')$$,'P0001','verified account required','unverified bootstrap denied');
set local role service_role;
select lives_ok($$select private.bootstrap_platform_admin('cb000000-0000-4000-8000-000000000001','Approved bootstrap')$$,'trusted verified bootstrap');
reset role;
select throws_ok($$select private.bootstrap_platform_admin('cb000000-0000-4000-8000-000000000001','Approved bootstrap')$$,'P0001','bootstrap already completed','second bootstrap denied');
select is((select auth_user_id from public.platform_admins),'cb000000-0000-4000-8000-000000000001'::uuid,'bootstrap binds exact verified UID');
select is((select count(*) from private.platform_admin_audit where action='bootstrap_admin' and target_id='cb000000-0000-4000-8000-000000000001'),1::bigint,'bootstrap audited once');
delete from auth.users where id='cb000000-0000-4000-8000-000000000001';
insert into auth.users(id,email,email_confirmed_at) values('cb000000-0000-4000-8000-000000000003','bootstrap-verified@example.test',now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"cb000000-0000-4000-8000-000000000003","email":"bootstrap-verified@example.test","aal":"aal2"}',true);
select is(public.is_platform_admin_account(),false,'recreated email does not inherit old administrator identity');
reset role;
select * from finish();
rollback;
