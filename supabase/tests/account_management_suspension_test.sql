begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
('ac000000-0000-4000-8000-000000000001','account-admin@example.test',now()),
('ac000000-0000-4000-8000-000000000002','account-owner@example.test',now()),
('ac000000-0000-4000-8000-000000000003','account-manager@example.test',now()),
('ac000000-0000-4000-8000-000000000004','account-seller@example.test',now());
insert into public.platform_admins(admin_email,auth_user_id) values('account-admin@example.test','ac000000-0000-4000-8000-000000000001');
insert into public.artists(id,slug,display_name,email,is_public,is_verified,published_at)
values('ac000000-0000-4000-8000-000000000002','account-suspension','Account suspension','account-owner@example.test',true,true,now());
insert into public.artist_members(artist_id,member_email,role,status,can_manage_shipping) values
('ac000000-0000-4000-8000-000000000002','account-manager@example.test','manager','active',false),
('ac000000-0000-4000-8000-000000000002','account-seller@example.test','seller','active',true);
insert into public.events(id,artist_id,event_name,start_date,end_date,status,is_booth_open) values
('ac100000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000002','Existing live event',now()-interval '1 hour',now()+interval '1 day','Confirmed',true),
('ac100000-0000-4000-8000-000000000002','ac000000-0000-4000-8000-000000000002','Private future event',now()+interval '2 days',now()+interval '3 days','Confirmed',false);
insert into public.orders(id,event_id,order_type,total_price,status,pickup_status,pickup_code,customer_name,customer_email) values
('ac200000-0000-4000-8000-000000000001','ac100000-0000-4000-8000-000000000001','preorder',100,'confirmed','awaiting_pickup','ACT123','Synthetic buyer','buyer@example.test');
insert into public.order_payments(order_id,event_id,artist_id,amount_expected,payment_status) values
('ac200000-0000-4000-8000-000000000001','ac100000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000002',100,'payment_confirmed');
insert into public.online_campaigns(id,artist_id,name,slug,opens_at,closes_at,shipping_enabled) values
('ac300000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000002','Shipping suspension campaign','account-suspension-shipping',now()-interval '1 hour',now()+interval '1 day',true);
insert into public.orders(id,campaign_id,order_type,fulfillment_method,total_price,status,pickup_status,pickup_code,customer_name,customer_email,shipping_address) values
('ac200000-0000-4000-8000-000000000002','ac300000-0000-4000-8000-000000000001','online_sale','shipping',150,'confirmed','awaiting_shipment','SHIP123','Shipping buyer','shipping-buyer@example.test','Synthetic shipping address');
insert into public.order_payments(order_id,campaign_id,artist_id,amount_expected,payment_status) values
('ac200000-0000-4000-8000-000000000002','ac300000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000002',150,'payment_confirmed');
set local role anon;
select throws_ok($$select public.set_account_management_suspension('ac000000-0000-4000-8000-000000000002',true,'Suspension reason',false)$$,'42501',null,'anonymous cannot suspend');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000002","email":"account-owner@example.test","aal":"aal2"}',true);
select is(public.has_artist_role('ac000000-0000-4000-8000-000000000002',array['owner']),true,'owner initially has management rights');
select throws_ok($$select public.set_account_management_suspension('ac000000-0000-4000-8000-000000000003',true,'Suspension reason',false)$$,'42501','forbidden','owner cannot suspend another account');
select set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000001","email":"account-admin@example.test","aal":"aal1"}',true);
select throws_ok($$select public.set_account_management_suspension('ac000000-0000-4000-8000-000000000002',true,'Suspension reason',false)$$,'42501','forbidden','AAL1 administrator denied');
select set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000001","email":"account-admin@example.test","aal":"aal2"}',true);
select throws_ok($$select public.set_account_management_suspension('ac000000-0000-4000-8000-000000000002',true,'x',false)$$,'22023','valid account, state and reason required','reason required');
select throws_ok($$select public.set_account_management_suspension('ac000000-0000-4000-8000-000000000001',true,'Suspend admin account',false)$$,'42501','revoke Platform Admin access before suspension','administrator self-lockout protected');
select is(public.set_account_management_suspension('ac000000-0000-4000-8000-000000000002',true,'Review owner management access',false),true,'MFA admin suspends original owner');
select throws_ok($$select public.set_account_management_suspension('ac000000-0000-4000-8000-000000000002',true,'Repeat same request',false)$$,'PT409','account state changed; reload before retrying','duplicate or stale action rejected');
select throws_ok($$select public.set_account_management_suspension('ac000000-0000-4000-8000-000000000002',false,'Stale recovery request',false)$$,'PT409','account state changed; reload before retrying','stale reactivation rejected');
select is(public.platform_admin_console('user',null,'ac000000-0000-4000-8000-000000000002')->'detail'->>'suspended','true','console reports actual management suspension');
select is(public.platform_admin_console('user',null,'ac000000-0000-4000-8000-000000000002')->'detail'->>'suspended_reason','Review owner management access','console shows reason');
select throws_ok($$select public.change_platform_admin('ac000000-0000-4000-8000-000000000002',true,'Grant suspended user')$$,'42501','restore account management before granting Platform Admin access','grant cannot race past suspension');
select throws_ok($$update private.account_management_restrictions set suspended=false$$,'42501',null,'client cannot bypass private state');
select throws_ok($$delete from private.platform_admin_audit$$,'42501',null,'client cannot delete audit');
-- Reuse exactly the original claims: suspension must not wait for a token refresh.
select set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000002","email":"account-owner@example.test","aal":"aal2"}',true);
select is(public.is_account_management_active(),false,'same JWT now has no management rights');
select is(public.is_account_active(),true,'account remains usable for customer support');
select is(public.auth_user_exists_by_email('account-manager@example.test'),false,'suspended account cannot enumerate team emails');
select is(public.has_artist_role('ac000000-0000-4000-8000-000000000002',array['owner']),false,'original owner shortcut cannot bypass suspension');
select is(public.has_event_role('ac100000-0000-4000-8000-000000000001',array['owner']),false,'event owner shortcut cannot bypass suspension');
select is((select count(*) from public.list_actor_workspaces()),0::bigint,'suspended account gets no workspaces');
select throws_ok($$select public.resolve_actor_workspace('ac000000-0000-4000-8000-000000000002')$$,'42501','workspace access denied','explicit workspace is denied');
select throws_ok($$select public.complete_verified_creator_signup()$$,'42501','account management suspended','cannot recreate management through signup');
select throws_ok($$select public.accept_team_invitation(gen_random_uuid())$$,'42501','account management suspended','cannot reenter through invitation');
select throws_ok($$select public.decline_team_invitation(gen_random_uuid())$$,'42501','account management suspended','invitation mutation denied');
select throws_ok($$select public.list_my_pending_invitations()$$,'42501','account management suspended','private invitations denied');
select is((select count(*) from public.orders where id='ac200000-0000-4000-8000-000000000001'),0::bigint,'private existing orders no longer readable');
select throws_ok($$update public.orders set status='cancelled' where id='ac200000-0000-4000-8000-000000000001'$$,'42501',null,'direct order mutation denied');
select results_eq($$update public.artists set display_name='tampered' where id='ac000000-0000-4000-8000-000000000002' returning id$$,$$select null::uuid where false$$,'direct original-owner store edit denied');
select throws_ok($$select public.mark_preorder_picked_up('ac200000-0000-4000-8000-000000000001')$$,'P0001','forbidden','SECURITY DEFINER fulfillment denied');
select is((select count(*) from public.events where id='ac100000-0000-4000-8000-000000000002'),0::bigint,'private event inaccessible');
select is((select count(*) from public.events where id='ac100000-0000-4000-8000-000000000001'),1::bigint,'public event remains visible');
select is((select count(*) from public.artists where id='ac000000-0000-4000-8000-000000000002'),1::bigint,'public storefront remains visible');
select throws_ok($$insert into storage.objects(bucket_id,name,owner) values('Avatar','ac000000-0000-4000-8000-000000000002/blocked.jpg','ac000000-0000-4000-8000-000000000002')$$,'42501',null,'Storage owner uploads denied');
select set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000003","email":"account-manager@example.test","aal":"aal1"}',true);
select is(public.is_account_management_active(),true,'other teammate remains active');
select is(public.has_artist_role('ac000000-0000-4000-8000-000000000002',array['manager']),true,'manager retains store rights');
select is((select count(*) from public.orders where id='ac200000-0000-4000-8000-000000000001'),1::bigint,'other teammate can read existing orders');
select lives_ok($$select public.set_booth_open_status('ac100000-0000-4000-8000-000000000001',true)$$,'manager can still run same event');
select lives_ok($$select public.mark_preorder_picked_up('ac200000-0000-4000-8000-000000000001')$$,'manager can fulfill original order');
select set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000004","email":"account-seller@example.test","aal":"aal1"}',true);
select is(public.has_shipping_access('ac000000-0000-4000-8000-000000000002'),true,'assigned seller initially has shipping access');
select lives_ok($$select public.prepare_offline_device('ac100000-0000-4000-8000-000000000001','ac400000-0000-4000-8000-000000000001')$$,'active seller prepares offline replay device');
select set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000001","email":"account-admin@example.test","aal":"aal2"}',true);
select is(public.set_account_management_suspension('ac000000-0000-4000-8000-000000000004',true,'Review seller management access',false),true,'staff account can also be suspended');
select set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000004","email":"account-seller@example.test","aal":"aal1"}',true);
select is(public.has_artist_role('ac000000-0000-4000-8000-000000000002',array['seller']),false,'email-based membership cannot bypass account suspension');
select is(public.has_shipping_access('ac000000-0000-4000-8000-000000000002'),false,'explicit shipping assignment cannot bypass account suspension');
select throws_ok($$select public.mark_online_order_shipped('ac200000-0000-4000-8000-000000000002','Synthetic carrier','SUSPENDED-TRACK')$$,'P0001','forbidden','suspended assigned seller cannot ship an online order');
select throws_ok($$select public.apply_offline_operation('ac500000-0000-4000-8000-000000000001','ac100000-0000-4000-8000-000000000001','ac400000-0000-4000-8000-000000000001','{"kind":"sale"}'::jsonb)$$,'P0001','forbidden','suspended seller cannot replay an offline operation');
select is((select count(*) from public.artist_members where lower(member_email)='account-seller@example.test'),0::bigint,'self membership policy no longer leaks private team data');
select set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000003","email":"account-manager@example.test","aal":"aal1"}',true);
select is((select count(*) from public.offline_operations where id='ac500000-0000-4000-8000-000000000001'),0::bigint,'denied offline replay creates no conflict row');
select is(public.has_shipping_access('ac000000-0000-4000-8000-000000000002'),true,'unsuspended manager retains shipping access');
select lives_ok($$select public.mark_online_order_shipped('ac200000-0000-4000-8000-000000000002','Synthetic carrier','ACTIVE-TRACK')$$,'unsuspended teammate can ship the same online order');
select set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000001","email":"account-admin@example.test","aal":"aal2"}',true);
select is(public.set_account_management_suspension('ac000000-0000-4000-8000-000000000002',false,'Management review resolved',true),true,'reactivation confirmed');
select set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000002","email":"account-owner@example.test","aal":"aal2"}',true);
select is(public.is_account_management_active(),true,'same JWT works immediately after reactivation');
select is(public.has_artist_role('ac000000-0000-4000-8000-000000000002',array['owner']),true,'original role restored without rewriting memberships');
reset role;
select is((select count(*) from private.store_restrictions where artist_id='ac000000-0000-4000-8000-000000000002'),0::bigint,'account suspension never suspends store');
select is((select total_price from public.orders where id='ac200000-0000-4000-8000-000000000001'),100::numeric,'original order money preserved');
select is((select status from public.orders where id='ac200000-0000-4000-8000-000000000001'),'completed','teammate fulfillment persisted');
select is((select pickup_status from public.orders where id='ac200000-0000-4000-8000-000000000002'),'shipped','unsuspended teammate shipment persisted');
select is((select tracking_number from public.orders where id='ac200000-0000-4000-8000-000000000002'),'ACTIVE-TRACK','suspended shipping attempt never changed tracking');
select is((select count(*) from public.artist_members where artist_id='ac000000-0000-4000-8000-000000000002' and status='active'),2::bigint,'team memberships preserved');
select is((select count(*) from private.platform_admin_audit where target_id='ac000000-0000-4000-8000-000000000002' and action in('suspend_account_management','reactivate_account_management')),2::bigint,'state changes each audited once');
-- Removing an Auth identity must never reactivate its old JWT through a cascaded restriction.
delete from auth.users where id='ac000000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000004","email":"account-seller@example.test","aal":"aal1"}',true);
select is(private.account_management_allowed(),false,'deleted account cannot regain access after restriction cascade');
select is(public.has_artist_role('ac000000-0000-4000-8000-000000000002',array['seller']),false,'old JWT email membership remains denied after account deletion');
select is(public.has_event_role('ac100000-0000-4000-8000-000000000001',array['seller']),false,'old JWT event permission remains denied after account deletion');
reset role;
select * from finish();
rollback;
