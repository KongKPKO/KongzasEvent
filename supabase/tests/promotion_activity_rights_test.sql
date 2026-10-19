begin;
select no_plan();

insert into auth.users(id,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,aud,role)
values('e1900000-0000-4000-8000-000000000001','activity-rights@example.test','x',now(),'{}','{}','authenticated','authenticated');
insert into public.artists(id,slug,display_name,is_public,is_verified,published_at)
values('e1900000-0000-4000-8000-000000000002','activity-rights','Condition V1',true,true,now());
insert into public.artist_members(artist_id,member_email,role,status)
values('e1900000-0000-4000-8000-000000000002','activity-rights@example.test','owner','active');
insert into public.events(id,artist_id,event_name,start_date,end_date,status,is_booth_open)
values('e1900000-0000-4000-8000-000000000003','e1900000-0000-4000-8000-000000000002','Condition V1',now()-interval '1 day',now()+interval '1 day','Confirmed',true);
insert into public.online_campaigns(id,artist_id,name,slug,opens_at,closes_at,publication_status,shipping_enabled,flat_shipping_fee)
values('e1900000-0000-4000-8000-000000000004','e1900000-0000-4000-8000-000000000002','Condition campaign','activity-rights',now()-interval '1 day',now()+interval '1 day','published',true,0);
insert into public.products(id,artist_id,name,sku,price,currency,category,tags,stock_total,is_unlimited,status) values
('e1900000-0000-4000-8000-000000000011','e1900000-0000-4000-8000-000000000002','A3 Mavuika','A3-V1',250,'THB','A3',array['Mavuika'],100,false,'enable'),
('e1900000-0000-4000-8000-000000000012','e1900000-0000-4000-8000-000000000002','A4 Mavuika','A4-V1',150,'THB','A4',array['Mavuika'],100,false,'enable'),
('e1900000-0000-4000-8000-000000000013','e1900000-0000-4000-8000-000000000002','Photoset Mavuika','PHOTO-V1',200,'THB','Photoset',array['Mavuika'],100,false,'enable'),
('e1900000-0000-4000-8000-000000000014','e1900000-0000-4000-8000-000000000002','Gift Hairclip','GIFT-V1',50,'THB','Hairclip',array['Mavuika'],100,false,'enable');
insert into public.event_products(event_id,product_id,artist_id,stock_total,is_unlimited,is_enabled,is_sellable)
select 'e1900000-0000-4000-8000-000000000003',id,artist_id,40,false,true,true from public.products where artist_id='e1900000-0000-4000-8000-000000000002';
insert into public.online_campaign_products(campaign_id,product_id,artist_id,stock_total,is_unlimited,is_enabled,is_sellable)
select 'e1900000-0000-4000-8000-000000000004',id,artist_id,40,false,true,true from public.products where artist_id='e1900000-0000-4000-8000-000000000002';
insert into public.campaign_payment_methods(campaign_id,artist_id,method_type,display_name,is_enabled)
values('e1900000-0000-4000-8000-000000000004','e1900000-0000-4000-8000-000000000002','promptpay','PromptPay',true);
select set_config('request.jwt.claims','{"sub":"e1900000-0000-4000-8000-000000000001","email":"activity-rights@example.test","role":"authenticated"}',true);

create function pg_temp.definition(config jsonb,p_id uuid default null) returns jsonb language sql as $$
 select jsonb_build_object('id',p_id,'artist_id','e1900000-0000-4000-8000-000000000002','name','Condition and reward','promotion_type','condition_reward','target_type','all','v1_config',config,
 'assignments',jsonb_build_array(jsonb_build_object('event_id','e1900000-0000-4000-8000-000000000003','event_phase','live','is_paused',false,'combination_policy','combine'),jsonb_build_object('campaign_id','e1900000-0000-4000-8000-000000000004','is_paused',false,'combination_policy','combine')))
$$;
create function pg_temp.cfg(condition jsonb,discount jsonb default '{"kind":"fixed","value":20}',gift jsonb default null) returns jsonb language sql as $$
 select jsonb_build_object('version',1,'condition',condition,'discount',discount,'gift',gift)
$$;
create temp table _v1(id uuid,quote jsonb,order_id uuid,request_id uuid);
create function pg_temp.save(def jsonb) returns uuid language plpgsql as $$
declare detail text;
begin
 begin return public.save_promotion_definition(def);
 exception when raise_exception then
   if sqlerrm<>'promotion_conflict_confirmation_required' then raise; end if;
   get stacked diagnostics detail=PG_EXCEPTION_DETAIL;
 end;
 return public.save_promotion_definition(def||jsonb_build_object('confirmation_token',detail::jsonb->>'confirmation_token'));
end $$;
create function pg_temp.cart(a integer default 1,b integer default 1,c integer default 1) returns jsonb language sql as $$
 select coalesce(jsonb_agg(jsonb_build_object('product_id',id,'quantity',qty)),'[]') from (values('e1900000-0000-4000-8000-000000000011',a),('e1900000-0000-4000-8000-000000000012',b),('e1900000-0000-4000-8000-000000000013',c)) x(id,qty) where qty>0
$$;
create function pg_temp.quote(items jsonb default pg_temp.cart()) returns jsonb language sql as $$
 select public.quote_sale_promotions('e1900000-0000-4000-8000-000000000003','live',null,items,'[]','[]')
$$;

create function pg_temp.activity(qty integer default 1) returns jsonb language sql as $$
 select jsonb_build_object('version',1,'condition',jsonb_build_object('kind','spend','amount',500),'discount',null,'gift',null,
 'activity',jsonb_build_object('name','Wheel entry','instructions','Give one paper entry for each right.','quantity',qty))
$$;
insert into _v1(id) select pg_temp.save(pg_temp.definition(pg_temp.activity()));
select is(pg_temp.quote(pg_temp.cart(1,3,0))#>>'{applied_promotions,0,activity_reward,quantity}','1','700 earns one right');
select is(pg_temp.quote(pg_temp.cart(0,0,4))#>>'{applied_promotions,0,activity_reward,quantity}','1','800 earns one right independently, no cross-order carry');
select is(pg_temp.quote(pg_temp.cart(2,2,2))#>>'{applied_promotions,0,activity_reward,quantity}','2','1200 earns two rights per order');
select is(jsonb_array_length(pg_temp.quote(pg_temp.cart(1,1,0))->'applied_promotions'),0,'below 500 earns no rights');
select is(pg_temp.quote()->>'discount_total','0','activity does not discount merchandise');
select is(jsonb_array_length(pg_temp.quote()->'reward_lines'),0,'activity never creates inventory reward lines');
select is(pg_temp.quote()#>>'{applied_promotions,0,activity_reward,name}','Wheel entry','quote snapshots manual reward name');
select is(pg_temp.quote()#>>'{applied_promotions,0,activity_reward,instructions}','Give one paper entry for each right.','quote snapshots instructions');
select is((select count(*) from public.products where artist_id='e1900000-0000-4000-8000-000000000002'),4::bigint,'activity creates no catalog product');
select lives_ok($$select private.validate_promotion_v1(jsonb_set(pg_temp.activity(),'{condition}','{"kind":"quantity","quantity":2}'),'e1900000-0000-4000-8000-000000000002')$$,'rights also support quantity conditions');
select throws_ok($$select private.validate_promotion_v1(jsonb_set(pg_temp.activity(),'{activity,name}','" "'),'e1900000-0000-4000-8000-000000000002')$$,'P0001','promotion_activity_invalid','blank activity name rejected on server');
select throws_ok($$select private.validate_promotion_v1(pg_temp.activity(0),'e1900000-0000-4000-8000-000000000002')$$,'P0001','promotion_quantity_invalid','zero rights rejected');

-- Final-net calculation includes the activity promotion's own discount.
update public.artist_promotions set v1_config=jsonb_set(pg_temp.activity(),'{discount}','{"kind":"fixed","value":150}') where id=(select id from _v1);
select is(pg_temp.quote()->>'total','450','own discount reduces final net');
select ok(pg_temp.quote()#>'{applied_promotions,0,activity_reward}'='null'::jsonb,'450 net receives no activity rights despite qualifying before own discount');
update public.artist_promotions set v1_config=pg_temp.activity(2) where id=(select id from _v1);
select is(pg_temp.quote(pg_temp.cart(2,2,2))#>>'{applied_promotions,0,activity_reward,quantity}','4','configured rights multiply complete spend groups');
update public.artist_promotions set v1_config=pg_temp.activity() where id=(select id from _v1);

-- Real POS checkout snapshots rights, retries do not duplicate them or stock.
update _v1 set request_id=gen_random_uuid(),quote=pg_temp.quote(pg_temp.cart(1,3,0));
update _v1 set order_id=public.create_walkin_order_with_stock('e1900000-0000-4000-8000-000000000003',pg_temp.cart(1,3,0),'cash',request_id,'[]','[]',quote->>'pricing_hash');
select is((select pricing_breakdown#>>'{0,activity_reward,quantity}' from public.orders where id=(select order_id from _v1)),'1','paid POS order stores rights snapshot');
select is((select sum(quantity) from public.order_items where order_id=(select order_id from _v1)),4::bigint,'only purchased goods consume stock');
select is(public.create_walkin_order_with_stock('e1900000-0000-4000-8000-000000000003',pg_temp.cart(1,3,0),'cash',(select request_id from _v1),'[]','[]',(select quote->>'pricing_hash' from _v1)),(select order_id from _v1),'payment retry returns same order');
select is((select count(*) from public.orders where event_id='e1900000-0000-4000-8000-000000000003'),1::bigint,'retry creates no second entitlement order');
select public.create_walkin_order_with_stock('e1900000-0000-4000-8000-000000000003',pg_temp.cart(0,0,4),'cash',gen_random_uuid());
select is((select sum((entry#>>'{activity_reward,quantity}')::integer) from public.orders o cross join lateral jsonb_array_elements(o.pricing_breakdown) entry where o.event_id='e1900000-0000-4000-8000-000000000003'),2::bigint,'700 and 800 paid orders earn only two total rights');
update public.artist_promotions set v1_config=jsonb_set(pg_temp.activity(),'{activity,name}','"Changed activity"') where id=(select id from _v1);
select is((select pricing_breakdown#>>'{0,activity_reward,name}' from public.orders where id=(select order_id from _v1)),'Wheel entry','editing promotion does not rewrite old rights');
select is(public.get_pos_sale_detail('e1900000-0000-4000-8000-000000000003',(select order_id from _v1))#>>'{pricing_breakdown,0,activity_reward,quantity}','1','authorized POS history exposes immutable rights');

-- Online payment pending keeps provisional snapshot; no gift commitment is made.
update public.artist_promotions set v1_config=pg_temp.activity() where id=(select id from _v1);
update public.online_campaigns set flat_shipping_fee=200 where id='e1900000-0000-4000-8000-000000000004';
update _v1 set request_id=gen_random_uuid(),quote=public.quote_sale_promotions(null,null,'e1900000-0000-4000-8000-000000000004',pg_temp.cart(),'[]','[]');
update _v1 set order_id=(select order_id from public.create_online_campaign_order('e1900000-0000-4000-8000-000000000004',pg_temp.cart(),'shipping',null,'Local tester','local@example.test','0812345678','Local fixture address','',request_id,'[]','[]',quote->>'pricing_hash'));
select is((select pricing_breakdown#>>'{0,activity_reward,quantity}' from public.orders where id=(select order_id from _v1)),'1','shipping is excluded from rights');
select is((select payment_status from public.order_payments where order_id=(select order_id from _v1)),'awaiting_payment','pending order has not confirmed payment');
select is((select count(*) from private.promotion_gift_commitments where order_id=(select order_id from _v1)),0::bigint,'activity consumes no gift quota');
select is(public.get_public_online_order_by_code('activity-rights',(select pickup_code from public.orders where id=(select order_id from _v1)))#>>'{pricing_breakdown,0,activity_reward,quantity}','1','customer order status receives activity snapshot');
select is(public.get_online_campaign_workspace('e1900000-0000-4000-8000-000000000004')#>>'{orders,0,pricing_breakdown,0,activity_reward,quantity}','1','merchant campaign order list exposes the same saved rights');
create temp table _preorder_snapshot(id uuid);
with created as (insert into public.orders(event_id,order_type,customer_name,customer_email,total_price,pricing_breakdown,pickup_code)
 values('e1900000-0000-4000-8000-000000000003','preorder','Local fixture','local@example.test',600,(select quote->'applied_promotions' from _v1),'ACTRIGHTS') returning id)
 insert into _preorder_snapshot select id from created;
insert into public.order_payments(order_id,artist_id,event_id,payment_status) select id,'e1900000-0000-4000-8000-000000000002'::uuid,'e1900000-0000-4000-8000-000000000003'::uuid,'awaiting_payment' from _preorder_snapshot;
select is((select pricing_breakdown#>>'{0,activity_reward,quantity}' from public.list_preorder_payment_review('e1900000-0000-4000-8000-000000000003',null) where order_id=(select id from _preorder_snapshot)),'1','merchant preorder review exposes saved rights without extra contact data');
select set_config('request.jwt.claims','{"role":"anon"}',true);
select throws_ok($$select public.get_pos_sale_detail('e1900000-0000-4000-8000-000000000003',(select order_id from _v1))$$,'42501','forbidden','anonymous callers cannot read private sale history');
select * from finish();
rollback;
