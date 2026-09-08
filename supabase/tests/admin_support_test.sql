begin;
select no_plan();
select has_function('public','admin_support',array['text','text','uuid','text','uuid']);

insert into auth.users(id,email) values
('a1000000-0000-4000-8000-000000000001','support-admin@test.local'),
('a1000000-0000-4000-8000-000000000002','support-owner@test.local');
insert into public.platform_admins(admin_email,auth_user_id) values
('support-admin@test.local','a1000000-0000-4000-8000-000000000001');
insert into public.artists(id,slug,display_name,email) values
('a1000000-0000-4000-8000-000000000002','support-store-a','Support Store A','support-owner@test.local'),
('a1000000-0000-4000-8000-000000000003','support-store-b','Support Store B','store-b@test.local');
insert into public.events(id,artist_id,event_name,start_date,end_date) values
('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','Event A',now(),now()+interval '1 day'),
('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000003','Event B',now(),now()+interval '1 day');
insert into public.orders(id,event_id,order_type,pickup_code,customer_name,customer_email,customer_phone,shipping_address,total_price) values
('a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','preorder','ABC123','Buyer','buyer@example.test','0812345678','SECRET ADDRESS',100),
('a3000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000002','pos_walkin','ABC123',null,null,null,null,90);
insert into public.order_payments(order_id,event_id,artist_id,amount_expected,stock_hold_expires_at,slip_url,payment_status) values
('a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002',100,now()-interval '1 hour','SECRET SLIP','awaiting_payment');
insert into public.online_campaigns(id,artist_id,name,slug,opens_at,closes_at) values
('a4000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003','Support Campaign','support-campaign',now(),now()+interval '1 day');
insert into public.orders(id,campaign_id,order_type,fulfillment_method,pickup_code,total_price,pickup_status,shipping_carrier,tracking_number,pickup_point_snapshot) values
('a3000000-0000-4000-8000-000000000003','a4000000-0000-4000-8000-000000000001','online_sale','shipping','OC-SUPPORT',100,'shipped','Test Carrier','TRACK123','{"name":"Pickup","account_number":"SECRET ACCOUNT"}');
insert into public.products(id,artist_id,name,price,stock_total,is_unlimited) values
('a5000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003','New product name',999,10,false);
insert into public.artist_promotions(id,artist_id,name,target_type,rule_type,promotion_type,buy_quantity,reward_quantity,lifecycle_status) values
('a6000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003','Changed promotion','all','free_items','quantity_gift',1,1,'ready');
insert into public.promotion_assignments(id,promotion_id,artist_id,campaign_id,combination_policy) values
('a7000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003','a4000000-0000-4000-8000-000000000001','combine');
insert into public.order_items(order_id,product_id,quantity,price_per_unit,line_type,promotion_id,promotion_assignment_id,product_name_snapshot) values
('a3000000-0000-4000-8000-000000000003','a5000000-0000-4000-8000-000000000001',1,0,'promotion_reward','a6000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001','Saved gift');
create temp table before_orders as select * from public.orders;
create temp table before_payments as select * from public.order_payments;
create temp table before_products as select * from public.products;
insert into public.artist_members(artist_id,member_email,role,status)
select 'a1000000-0000-4000-8000-000000000002',role||'@support.test',role,'active'
from unnest(array['manager','seller','queue_staff']) role;

set local role anon;
select throws_ok($$select public.admin_support('search_stores','Support')$$,'42501',null,'anonymous denied');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000002","email":"support-owner@test.local"}',true);
select throws_ok($$select public.admin_support('search_stores','Support')$$,'P0001','forbidden','owner is not platform admin');
select throws_ok($$select private.admin_support('order',null,'a3000000-0000-4000-8000-000000000001','Support case',null)$$,'P0001','forbidden','private implementation also guarded');
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000004","email":"manager@support.test"}',true);
select throws_ok($$select public.admin_support('search_stores','Support')$$,'P0001','forbidden','manager denied');
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000004","email":"seller@support.test"}',true);
select throws_ok($$select public.admin_support('search_stores','Support')$$,'P0001','forbidden','seller denied');
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000004","email":"queue_staff@support.test"}',true);
select throws_ok($$select public.admin_support('search_stores','Support')$$,'P0001','forbidden','queue staff denied');
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","email":"support-admin@test.local"}',true);
select throws_ok($$select public.admin_support('delete','Support')$$,'P0001','invalid_action');
select throws_ok($$select public.admin_support('search_stores','x')$$,'P0001','invalid_query');
select throws_ok($$select public.admin_support('search_stores',repeat('x',101))$$,'P0001','invalid_query');
select throws_ok($$select public.admin_support('order',null,'a3000000-0000-4000-8000-000000000001','x')$$,'P0001','invalid_reason');
select throws_ok($$select public.admin_support('store',null,null,'Support case')$$,'P0001','invalid_target');
select is(jsonb_array_length(public.admin_support('search_stores','Support Store')->'results'),2,'admin sees both stores');
select is(jsonb_array_length(public.admin_support('search_stores','%_')->'results'),0,'wildcards are literal');
select is(jsonb_array_length(public.admin_support('search_orders','abc123')->'results'),2,'duplicate pickup codes kept distinct');
select is(jsonb_array_length(public.admin_support('search_orders','abc123',null,null,'a1000000-0000-4000-8000-000000000002')->'results'),1,'store scoped lookup');
select is(jsonb_array_length(public.admin_support('search_orders','ABC')->'results'),0,'order lookup exact only');
select is(public.admin_support('store',null,'a1000000-0000-4000-8000-000000000003','Support case')->>'name','Support Store B','foreign store detail');
select is(public.admin_support('order',null,'a3000000-0000-4000-8000-000000000001','Support case')->>'customer_email_masked','***@example.test','email masked');
select is(public.admin_support('order',null,'a3000000-0000-4000-8000-000000000001','Support case')->>'customer_phone_masked','***78','phone masked');
select ok(not(public.admin_support('order',null,'a3000000-0000-4000-8000-000000000001','Support case')::text like '%SECRET%'),'private address/slip excluded');
select is(public.admin_support('order',null,'a3000000-0000-4000-8000-000000000001','Support case')->>'payment_status','awaiting_payment','overdue order not expired by read');
select is(public.admin_support('order',null,'a3000000-0000-4000-8000-000000000002','Support case')->>'stock_hold_expires_at',null,'offline order no invented hold');
select is(public.admin_support('order',null,'a3000000-0000-4000-8000-000000000099','Support case'),null::jsonb,'missing order no detail');
select is(public.admin_support('order',null,'a3000000-0000-4000-8000-000000000001','Support case','a1000000-0000-4000-8000-000000000003'),null::jsonb,'detail respects scope');
select throws_ok($$insert into private.admin_support_access(actor_id,action) values(auth.uid(),'search_stores')$$,'42501',null,'client cannot forge log');
select throws_ok($$delete from private.admin_support_access$$,'42501',null,'client cannot delete log');
select throws_ok($$update private.admin_support_access set reason='changed'$$,'42501',null,'client cannot edit log');
reset role;
select ok(not exists(select * from public.orders except select * from before_orders),'orders unchanged');
select ok(not exists(select * from public.order_payments except select * from before_payments),'payments unchanged');
select ok(not exists(select * from public.products except select * from before_products),'stock unchanged');
select is((select count(*) from private.admin_support_access where actor_id='a1000000-0000-4000-8000-000000000001' and action='order'),5::bigint,'successful detail reads audited');
select is((select count(*) from private.admin_support_access where order_id='a3000000-0000-4000-8000-000000000099'),0::bigint,'missing target has no success log');
select ok(not exists(select 1 from private.admin_support_access where actor_id='a1000000-0000-4000-8000-000000000002'),'denied user not logged as successful');
insert into public.artists(id,slug,display_name) select gen_random_uuid(),'bounded-support-'||n,'Bounded Support '||n from generate_series(1,26) n;
set local role authenticated;
select is(jsonb_array_length(public.admin_support('search_stores','Bounded Support')->'results'),25,'search capped at 25');
select is(public.admin_support('search_stores','Bounded Support')->>'limited','true','search limit announced');
select is(jsonb_array_length(public.admin_support('search_orders','oc-support')->'results'),1,'campaign order found');
select is(public.admin_support('order',null,'a3000000-0000-4000-8000-000000000003','Support case')->>'tracking_number','TRACK123','tracking surfaced');
select is(public.admin_support('order',null,'a3000000-0000-4000-8000-000000000003','Support case')#>>'{items,0,name}','Saved gift','saved gift name retained');
select is(public.admin_support('order',null,'a3000000-0000-4000-8000-000000000003','Support case')#>>'{items,0,price_per_unit}','0','gift price stays zero');
select ok(not(public.admin_support('order',null,'a3000000-0000-4000-8000-000000000003','Support case')::text like '%SECRET%'),'raw pickup snapshot not exposed');
select throws_ok($$select public.admin_support('store',null,'a1000000-0000-4000-8000-000000000003',repeat('x',501))$$,'P0001','invalid_reason','reason maximum enforced');
reset role;
alter table private.admin_support_access add constraint force_audit_failure check (action <> 'store') not valid;
set local role authenticated;
select throws_ok($$select public.admin_support('store',null,'a1000000-0000-4000-8000-000000000003','Support case')$$,'23514',null,'audit failure blocks detail response');
reset role;
select * from finish();
rollback;
