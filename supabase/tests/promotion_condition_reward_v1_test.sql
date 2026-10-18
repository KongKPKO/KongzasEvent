begin;
select no_plan();

insert into auth.users(id,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,aud,role)
values('e1800000-0000-4000-8000-000000000001','condition-v1@example.test','x',now(),'{}','{}','authenticated','authenticated');
insert into public.artists(id,slug,display_name,is_public,is_verified,published_at)
values('e1800000-0000-4000-8000-000000000002','condition-reward-v1','Condition V1',true,true,now());
insert into public.artist_members(artist_id,member_email,role,status)
values('e1800000-0000-4000-8000-000000000002','condition-v1@example.test','owner','active');
insert into public.events(id,artist_id,event_name,start_date,end_date,status,is_booth_open)
values('e1800000-0000-4000-8000-000000000003','e1800000-0000-4000-8000-000000000002','Condition V1',now()-interval '1 day',now()+interval '1 day','Confirmed',true);
insert into public.online_campaigns(id,artist_id,name,slug,opens_at,closes_at,publication_status,shipping_enabled,flat_shipping_fee)
values('e1800000-0000-4000-8000-000000000004','e1800000-0000-4000-8000-000000000002','Condition campaign','condition-v1',now()-interval '1 day',now()+interval '1 day','published',true,0);
insert into public.products(id,artist_id,name,sku,price,currency,category,tags,stock_total,is_unlimited,status) values
('e1800000-0000-4000-8000-000000000011','e1800000-0000-4000-8000-000000000002','A3 Mavuika','A3-V1',250,'THB','A3',array['Mavuika'],100,false,'enable'),
('e1800000-0000-4000-8000-000000000012','e1800000-0000-4000-8000-000000000002','A4 Mavuika','A4-V1',150,'THB','A4',array['Mavuika'],100,false,'enable'),
('e1800000-0000-4000-8000-000000000013','e1800000-0000-4000-8000-000000000002','Photoset Mavuika','PHOTO-V1',200,'THB','Photoset',array['Mavuika'],100,false,'enable'),
('e1800000-0000-4000-8000-000000000014','e1800000-0000-4000-8000-000000000002','Gift Hairclip','GIFT-V1',50,'THB','Hairclip',array['Mavuika'],100,false,'enable');
insert into public.event_products(event_id,product_id,artist_id,stock_total,is_unlimited,is_enabled,is_sellable)
select 'e1800000-0000-4000-8000-000000000003',id,artist_id,40,false,true,true from public.products where artist_id='e1800000-0000-4000-8000-000000000002';
insert into public.online_campaign_products(campaign_id,product_id,artist_id,stock_total,is_unlimited,is_enabled,is_sellable)
select 'e1800000-0000-4000-8000-000000000004',id,artist_id,40,false,true,true from public.products where artist_id='e1800000-0000-4000-8000-000000000002';
insert into public.campaign_payment_methods(campaign_id,artist_id,method_type,display_name,is_enabled)
values('e1800000-0000-4000-8000-000000000004','e1800000-0000-4000-8000-000000000002','promptpay','PromptPay',true);
select set_config('request.jwt.claims','{"sub":"e1800000-0000-4000-8000-000000000001","email":"condition-v1@example.test","role":"authenticated"}',true);

create function pg_temp.definition(config jsonb,p_id uuid default null) returns jsonb language sql as $$
 select jsonb_build_object('id',p_id,'artist_id','e1800000-0000-4000-8000-000000000002','name','Condition and reward','promotion_type','condition_reward','target_type','all','v1_config',config,
 'assignments',jsonb_build_array(jsonb_build_object('event_id','e1800000-0000-4000-8000-000000000003','event_phase','live','is_paused',false,'combination_policy','combine'),jsonb_build_object('campaign_id','e1800000-0000-4000-8000-000000000004','is_paused',false,'combination_policy','combine')))
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
insert into _v1(id) select pg_temp.save(pg_temp.definition(pg_temp.cfg('{"kind":"quantity","quantity":3}')));
create function pg_temp.cart(a integer default 1,b integer default 1,c integer default 1) returns jsonb language sql as $$
 select coalesce(jsonb_agg(jsonb_build_object('product_id',id,'quantity',qty)),'[]') from (values('e1800000-0000-4000-8000-000000000011',a),('e1800000-0000-4000-8000-000000000012',b),('e1800000-0000-4000-8000-000000000013',c)) x(id,qty) where qty>0
$$;
create function pg_temp.quote(items jsonb default pg_temp.cart()) returns jsonb language sql as $$
 select public.quote_sale_promotions('e1800000-0000-4000-8000-000000000003','live',null,items,'[]','[]')
$$;
select is(pg_temp.quote()->>'discount_total','20','quantity discount applies once to complete three-unit group');
select is(pg_temp.quote(pg_temp.cart(2,2,2))->>'discount_total','40','quantity discounts repeat for two complete groups');
select is(pg_temp.quote(pg_temp.cart(1,1,0))->>'discount_total','0','incomplete group has no discount');
select is(pg_temp.quote(pg_temp.cart(1,1,0))#>>'{diagnostics,0,missing_quantity}','1','unmet quantity explains missing unit');

update public.artist_promotions set v1_config=pg_temp.cfg('{"kind":"quantity","quantity":2}','{"kind":"percentage","value":10}') where id=(select id from _v1);
select is(pg_temp.quote()->>'discount_total','45.00','percentage applies to the two highest-priced units in one complete group');
select is(pg_temp.quote(pg_temp.cart(2,2,1))->>'discount_total','85.00','percentage ignores an unmatched fifth unit');
update public.artist_promotions set v1_config=pg_temp.cfg('{"kind":"product","items":[{"product_id":"e1800000-0000-4000-8000-000000000012","quantity":2}]}') where id=(select id from _v1);
select is(pg_temp.quote(pg_temp.cart(3,1,0))->>'discount_total','0','three different units do not satisfy two exact A4 SKU units');
select is(pg_temp.quote(pg_temp.cart(0,4,0))->>'discount_total','40','exact SKU groups repeat');
update public.artist_promotions set v1_config=pg_temp.cfg('{"kind":"recipe","items":[{"product_id":"e1800000-0000-4000-8000-000000000011","quantity":1},{"product_id":"e1800000-0000-4000-8000-000000000012","quantity":2},{"product_id":"e1800000-0000-4000-8000-000000000013","quantity":1}]}') where id=(select id from _v1);
select is(pg_temp.quote(pg_temp.cart(4,0,0))->>'discount_total','0','recipe never substitutes same-total unrelated units');
select is(pg_temp.quote(pg_temp.cart(2,4,2))->>'discount_total','40','exact multi-SKU recipe repeats by its limiting ingredient');
select is(pg_temp.quote()#>>'{diagnostics,0,missing_items,1,quantity}','1','recipe explains missing A4 unit');

select throws_ok($$select public.save_promotion_definition(pg_temp.definition(pg_temp.cfg('{"kind":"quantity","quantity":1}',null,null)))$$,'P0001','promotion_reward_required','cannot save without either reward');
select throws_ok($$select public.save_promotion_definition(pg_temp.definition(pg_temp.cfg('{"kind":"quantity","quantity":0}')))$$,'P0001','promotion_quantity_invalid','zero quantity rejected by server');
select throws_ok($$select public.save_promotion_definition(pg_temp.definition(pg_temp.cfg('{"kind":"quantity","quantity":1}','{"kind":"percentage","value":101}')))$$,'P0001','promotion_discount_invalid','percentage cannot exceed 100');
select throws_ok($$select public.save_promotion_definition(pg_temp.definition(pg_temp.cfg('{"kind":"product","items":[{"product_id":"e1800000-0000-4000-8000-000000000002","quantity":1}]}')))$$,'P0001','promotion_product_invalid','recipe requires a real SKU');

-- Quantity discounts precede spend conditions, whose own discount is not part of qualification.
update public.artist_promotions set v1_config=pg_temp.cfg('{"kind":"quantity","quantity":3}','{"kind":"fixed","value":100}') where id=(select id from _v1);
insert into _v1(id) select pg_temp.save(pg_temp.definition(pg_temp.cfg('{"kind":"spend","amount":550}','{"kind":"fixed","value":50}')));
select is(pg_temp.quote()->>'discount_total','100','spend threshold uses 500 remaining after quantity discount');
select ok(exists(select 1 from jsonb_array_elements(pg_temp.quote()->'diagnostics') x where x->>'missing_amount'='50'),'spend diagnostic explains after-discount shortfall');
update public.artist_promotions set v1_config=pg_temp.cfg('{"kind":"spend","amount":500}','{"kind":"fixed","value":50}') where v1_config#>>'{condition,kind}'='spend' and artist_id='e1800000-0000-4000-8000-000000000002';
select is(pg_temp.quote()->>'discount_total','150','spend reward stacks once after eligible quantity discount');
select is(pg_temp.quote(pg_temp.cart(2,2,2))->>'discount_total','250','spend reward does not repeat per threshold multiple');

-- Draft preview uses the same engine without persisting any change.
create temp table _before as select (select count(*) from public.orders) orders,(select count(*) from public.artist_promotions) promotions,(select sum(stock_reserved+stock_sold) from public.event_products) commitments;
select is(public.preview_promotion_definition(pg_temp.definition(pg_temp.cfg('{"kind":"spend","amount":500}','{"kind":"fixed","value":75}'),(select id from public.artist_promotions where artist_id='e1800000-0000-4000-8000-000000000002' and v1_config#>>'{condition,kind}'='spend')), 'e1800000-0000-4000-8000-000000000003','live',null,pg_temp.cart())->>'total','425','unsaved preview combines draft spend reward with existing quantity reward');
select is((select count(*) from public.orders),(select orders from _before),'preview creates no orders');
select is((select count(*) from public.artist_promotions),(select promotions from _before),'preview creates no promotion definition');
select is((select sum(stock_reserved+stock_sold) from public.event_products),(select commitments from _before),'preview changes no stock');

-- One fixed gift shares its real stock and global quota without disabling discount.
update public.artist_promotions set lifecycle_status='archived' where artist_id='e1800000-0000-4000-8000-000000000002';
truncate _v1;
insert into _v1(id,request_id) select pg_temp.save(pg_temp.definition(pg_temp.cfg('{"kind":"quantity","quantity":3}','{"kind":"fixed","value":20}','{"product_id":"e1800000-0000-4000-8000-000000000014","quantity":1,"limit":1}'))),gen_random_uuid();
select is(pg_temp.quote()#>>'{reward_lines,0,quantity}','1','combined promotion grants configured gift SKU');
update _v1 set quote=public.quote_sale_promotions(null,null,'e1800000-0000-4000-8000-000000000004',pg_temp.cart(),'[]','[]');
update _v1 set order_id=(select order_id from public.create_online_campaign_order('e1800000-0000-4000-8000-000000000004',pg_temp.cart(),'shipping',null,'Local tester','local@example.test','0812345678','Local fixture address','',_v1.request_id,'[]','[]',_v1.quote->>'pricing_hash'));
select is((select count(*) from public.order_items where order_id=(select order_id from _v1) and line_type='promotion_reward'),1::bigint,'real campaign checkout persists a zero-price gift line');
select is((select price_per_unit from public.order_items where order_id=(select order_id from _v1) and line_type='promotion_reward'),0::numeric,'gift is not revenue');
select is(pg_temp.quote()->>'discount_total','20','other channel keeps discount when shared gift cap is held');
select is(jsonb_array_length(pg_temp.quote()->'reward_lines'),0,'Event shares cap held by Campaign');
select is(public.promotion_gift_usage('e1800000-0000-4000-8000-000000000002')#>>'{0,held_quantity}','1','merchant sees pending gift commitment');
select is((select order_id from public.create_online_campaign_order('e1800000-0000-4000-8000-000000000004',pg_temp.cart(),'shipping',null,'Local tester','local@example.test','0812345678','Local fixture address','',(select request_id from _v1),'[]','[]',(select quote->>'pricing_hash' from _v1))),(select order_id from _v1),'idempotent checkout retry returns same order');
select is((select sum(quantity) from private.promotion_gift_commitments where promotion_id=(select id from _v1)),1::bigint,'retry does not consume another right');
update public.orders set status='cancelled' where id=(select order_id from _v1);
select is(private.promotion_gift_remaining((select id from _v1)),1,'unpaid cancellation releases quota');

-- Expiry releases only unpaid rights; payment turns a right into permanent use.
update _v1 set request_id=gen_random_uuid(),quote=public.quote_sale_promotions(null,null,'e1800000-0000-4000-8000-000000000004',pg_temp.cart(),'[]','[]');
update _v1 set order_id=(select order_id from public.create_online_campaign_order('e1800000-0000-4000-8000-000000000004',pg_temp.cart(),'shipping',null,'Local tester','local@example.test','0812345678','Local fixture address','',_v1.request_id,'[]','[]',_v1.quote->>'pricing_hash'));
update public.order_payments set stock_hold_expires_at=now()-interval '1 second' where order_id=(select order_id from _v1);
select is(private.promotion_gift_remaining((select id from _v1)),1,'expired unpaid deadline frees quota even before expiry worker runs');
select lives_ok($$select private.expire_online_campaign_hold((select order_id from _v1))$$,'existing expiry worker releases stock and quota together');
select lives_ok($$select private.expire_online_campaign_hold((select order_id from _v1))$$,'repeated expiry is safe');
select is(private.promotion_gift_remaining((select id from _v1)),1,'expiry retry never creates extra quota');
update _v1 set request_id=gen_random_uuid(),quote=public.quote_sale_promotions(null,null,'e1800000-0000-4000-8000-000000000004',pg_temp.cart(),'[]','[]');
update _v1 set order_id=(select order_id from public.create_online_campaign_order('e1800000-0000-4000-8000-000000000004',pg_temp.cart(),'shipping',null,'Local tester','local@example.test','0812345678','Local fixture address','',_v1.request_id,'[]','[]',_v1.quote->>'pricing_hash'));
update public.order_payments set payment_status='payment_confirmed' where order_id=(select order_id from _v1);
select is(public.promotion_gift_usage('e1800000-0000-4000-8000-000000000002')#>>'{0,redeemed_quantity}','1','confirmed payment redeems the right');
update public.order_payments set payment_status='refunded' where order_id=(select order_id from _v1);
select is(private.promotion_gift_remaining((select id from _v1)),0,'refund never silently restores a redeemed right');
update public.orders set status='cancelled' where id=(select order_id from _v1);
select is(private.promotion_gift_remaining((select id from _v1)),0,'cancelling a paid order keeps its redemption');
select throws_ok($$update public.artist_promotions set v1_config=jsonb_set(v1_config,'{gift,limit}','0') where id=(select id from _v1)$$,'P0001','promotion_gift_limit_below_committed','limit cannot invalidate committed order snapshots');
update public.artist_promotions set v1_config=pg_temp.cfg('{"kind":"quantity","quantity":1}','{"kind":"fixed","value":999999999}','{"product_id":"e1800000-0000-4000-8000-000000000014","quantity":1,"limit":1}') where id=(select id from _v1);
select is(pg_temp.quote()->>'total','0','combined discounts never make the payable total negative');
select is((select sum((x->>'discount_amount')::numeric) from jsonb_array_elements(pg_temp.quote()->'applied_promotions') x),600::numeric,'displayed discounts reconcile with the capped total');
update public.artist_promotions set v1_config=pg_temp.cfg('{"kind":"quantity","quantity":3}','{"kind":"fixed","value":20}','{"product_id":"e1800000-0000-4000-8000-000000000014","quantity":1,"limit":null}') where id=(select id from _v1);
update public.event_products set stock_total=0 where event_id='e1800000-0000-4000-8000-000000000003' and product_id='e1800000-0000-4000-8000-000000000014';
select is(pg_temp.quote()->>'discount_total','20','gift stock exhaustion preserves the independent discount');
select is(jsonb_array_length(pg_temp.quote()->'reward_lines'),0,'no nonexistent gift stock is promised');
select is(pg_temp.quote()#>>'{diagnostics,0,code}','gift_stock_insufficient','fixed gift stock exhaustion is explicit and does not block checkout');

-- Twenty actual online holds consume twenty rights; buyer 21 retains the discount.
select public.archive_promotion_definition((select id from _v1));
truncate _v1;
insert into _v1(id) select pg_temp.save(pg_temp.definition(pg_temp.cfg('{"kind":"quantity","quantity":1}','{"kind":"fixed","value":20}','{"product_id":"e1800000-0000-4000-8000-000000000014","quantity":1,"limit":20}')));
create temp table _twenty_orders(position integer,id uuid);
do $$declare n integer; created uuid; begin
 for n in 1..21 loop
   select order_id into created from public.create_online_campaign_order('e1800000-0000-4000-8000-000000000004',pg_temp.cart(1,0,0),'shipping',null,'Local quota tester','local@example.test','0812345678','Local fixture address','',gen_random_uuid());
   insert into _twenty_orders values(n,created);
 end loop;
end $$;
select is((select sum(oi.quantity) from public.order_items oi join _twenty_orders q on q.id=oi.order_id where oi.line_type='promotion_reward'),20::bigint,'twenty gifts are held across twenty real orders');
select is((select count(*) from public.order_items where order_id=(select id from _twenty_orders where position=21) and line_type='promotion_reward'),0::bigint,'buyer 21 receives no over-quota gift');
select is((select total_price from public.orders where id=(select id from _twenty_orders where position=21)),230::numeric,'buyer 21 can buy with the independent discount');
select is(private.promotion_gift_remaining((select id from _v1)),0,'twenty-right cap stops at zero');

update public.products set status='disable' where id='e1800000-0000-4000-8000-000000000014';
select lives_ok($$select public.archive_promotion_definition((select id from _v1))$$,'an unavailable gift never prevents archiving an existing promotion');
select set_config('request.jwt.claims','{"role":"anon"}',true);
select throws_ok($$select public.preview_promotion_definition(pg_temp.definition(pg_temp.cfg('{"kind":"quantity","quantity":1}')),'e1800000-0000-4000-8000-000000000003','live',null,pg_temp.cart())$$,'P0001','forbidden','public cannot preview merchant drafts');
select throws_ok($$select public.promotion_gift_usage('e1800000-0000-4000-8000-000000000002')$$,'P0001','forbidden','public cannot inspect merchant redemption totals');
select * from finish();
rollback;
