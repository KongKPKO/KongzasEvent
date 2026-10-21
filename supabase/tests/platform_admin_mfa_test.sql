begin;
select no_plan();
insert into auth.users(id,email) values
('c9000000-0000-4000-8000-000000000001','mfa-admin@example.test'),
('c9000000-0000-4000-8000-000000000002','mfa-owner@example.test');
insert into public.platform_admins(admin_email,auth_user_id) values
('mfa-admin@example.test','c9000000-0000-4000-8000-000000000001');
insert into public.artists(id,slug,display_name,email) values
('c9000000-0000-4000-8000-000000000002','mfa-owner','MFA owner','mfa-owner@example.test');
set local role anon;
select is(public.is_platform_admin(),false,'anonymous has no admin privilege');
select throws_ok($$select public.is_platform_admin_account()$$,'42501',null,'anonymous cannot discover admin account');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c9000000-0000-4000-8000-000000000002","email":"mfa-owner@example.test","aal":"aal2"}',true);
select is(public.is_platform_admin_account(),false,'owner with MFA is not platform admin');
select is(public.is_platform_admin(),false,'MFA alone grants no platform privilege');
select set_config('request.jwt.claims','{"sub":"c9000000-0000-4000-8000-000000000001","email":"mfa-admin@example.test"}',true);
select is(public.is_platform_admin_account(),true,'admin can discover enrollment eligibility without MFA');
select is(public.is_platform_admin(),false,'missing aal defaults to unprivileged');
select set_config('request.jwt.claims','{"sub":"c9000000-0000-4000-8000-000000000001","email":"mfa-admin@example.test","aal":"aal1","user_metadata":{"aal":"aal2"}}',true);
select is(public.is_platform_admin(),false,'AAL1 and user metadata cannot grant admin privilege');
select throws_ok($$select public.admin_support('search_stores','mfa')$$,'P0001','forbidden','AAL1 cannot read cross-store support');
select throws_ok($$select public.admin_support_history(gen_random_uuid(),'Support reason')$$,'P0001','forbidden','AAL1 cannot read audit history');
select throws_ok($$select public.admin_order_email_claim(gen_random_uuid(),gen_random_uuid(),'Support reason')$$,'P0001','forbidden','AAL1 cannot claim resend');
select throws_ok($$select public.set_store_suspension('c9000000-0000-4000-8000-000000000002',true,false,'Support reason')$$,'P0001','forbidden','AAL1 cannot suspend store');
select throws_like($$select public.approve_creator_application(gen_random_uuid(),'Review reason')$$,'%Only platform admins%','AAL1 cannot approve applications');
select throws_like($$select public.reject_creator_application(gen_random_uuid(),'Review reason')$$,'%Only platform admins%','AAL1 cannot reject applications');
select is((select count(*) from public.creator_applications),0::bigint,'AAL1 cannot list applications');
select set_config('request.jwt.claims','{"sub":"c9000000-0000-4000-8000-000000000001","email":"mfa-admin@example.test","aal":"aal2"}',true);
select is(public.is_platform_admin(),true,'admin AAL2 allowed');
select lives_ok($$select public.admin_support('search_stores','mfa')$$,'AAL2 support search allowed');
select is(public.set_store_suspension('c9000000-0000-4000-8000-000000000002',true,false,'Support reason'),true,'AAL2 suspension allowed');
select set_config('request.jwt.claims','{"sub":"c9000000-0000-4000-8000-000000000002","email":"mfa-admin@example.test","aal":"aal2"}',true);
select is(public.is_platform_admin(),false,'MFA does not bypass bound admin UID');
reset role;
select is((select count(*) from private.admin_support_access where actor_id='c9000000-0000-4000-8000-000000000001'),1::bigint,'denied AAL1 actions cannot create successful support audits');
select * from finish();
rollback;
