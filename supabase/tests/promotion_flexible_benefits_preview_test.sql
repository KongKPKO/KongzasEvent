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

create function pg_temp.flex_config(kind text) returns jsonb language sql as $$
 select jsonb_build_object('version',1,'condition',case kind
 when 'quantity' then '{"kind":"quantity","quantity":2}'::jsonb
 when 'recipe' then '{"kind":"recipe","items":[{"product_id":"e1900000-0000-4000-8000-000000000011","quantity":1},{"product_id":"e1900000-0000-4000-8000-000000000012","quantity":1}]}'::jsonb
 else '{"kind":"product","items":[{"product_id":"e1900000-0000-4000-8000-000000000011","quantity":1},{"product_id":"e1900000-0000-4000-8000-000000000012","quantity":1}]}'::jsonb end,
 'discount',jsonb_build_object('kind','percentage','value',20),
 'activity',jsonb_build_object('name','Activity','instructions','Show order number','quantity',2))
$$;
insert into _v1(id) select pg_temp.save(pg_temp.definition(pg_temp.flex_config('product')));
select is(pg_temp.quote(pg_temp.cart(1,0,0))->>'discount_total','50.00','a selected A3 qualifies without buying A4');
select is(pg_temp.quote(pg_temp.cart(0,1,0))->>'discount_total','30.00','a selected A4 qualifies without buying A3');
select is(pg_temp.quote(pg_temp.cart(2,1,1))->>'discount_total','130.00','percentage discounts every chosen product but not other merchandise');
select is(pg_temp.quote(pg_temp.cart(2,1,1))#>>'{applied_promotions,0,activity_reward,quantity}','6','selected products independently earn repeat activity rights');
select is(pg_temp.quote(pg_temp.cart(0,0,1))->>'discount_total','0','unselected item does not qualify');
update public.artist_promotions set v1_config=pg_temp.flex_config('recipe') where id=(select id from _v1);
select is(jsonb_array_length(pg_temp.quote(pg_temp.cart(1,0,0))->'applied_promotions'),0,'recipe still requires every item');
select is(pg_temp.quote(pg_temp.cart(2,2,0))#>>'{applied_promotions,0,activity_reward,quantity}','4','complete recipes earn rights per complete group');
update public.artist_promotions set v1_config=pg_temp.flex_config('quantity') where id=(select id from _v1);
select is(pg_temp.quote(pg_temp.cart(3,0,0))#>>'{applied_promotions,0,activity_reward,quantity}','2','quantity rights count only completed groups');

-- Preview uses the same prices and rules with hypothetical stock quantities.
update public.artist_promotions set lifecycle_status='archived' where id=(select id from _v1);
update public.event_products set stock_total=0 where event_id='e1900000-0000-4000-8000-000000000003';
update public.online_campaign_products set stock_total=0 where campaign_id='e1900000-0000-4000-8000-000000000004';
create function pg_temp.preview_config() returns jsonb language sql as $$
 select pg_temp.flex_config('product')||jsonb_build_object('gift',jsonb_build_object('product_id','e1900000-0000-4000-8000-000000000014','quantity',1,'limit',20))
$$;
update _v1 set quote=public.preview_promotion_definition(pg_temp.definition(pg_temp.preview_config()),'e1900000-0000-4000-8000-000000000003','live',null,pg_temp.cart(2,1,0));
select is((select quote->>'discount_total' from _v1),'130.00','event preview calculates a discount with zero stock');
select is((select quote#>>'{applied_promotions,0,activity_reward,quantity}' from _v1),'6','event preview calculates activity rights without stock');
select is((select quote#>>'{reward_lines,0,quantity}' from _v1),'3','preview simulates gifts without consuming or requiring quota');
select is(public.preview_promotion_definition(pg_temp.definition(jsonb_set(pg_temp.preview_config(),'{gift,limit}','1')),'e1900000-0000-4000-8000-000000000003','live',null,pg_temp.cart(2,1,0))#>>'{reward_lines,0,quantity}','1','preview still respects the configured promotion gift cap');
select is(public.preview_promotion_definition(pg_temp.definition(pg_temp.preview_config()),null,null,'e1900000-0000-4000-8000-000000000004',pg_temp.cart(1,0,0))->>'discount_total','50.00','campaign preview also ignores stock');
select is((select count(*) from public.orders where event_id='e1900000-0000-4000-8000-000000000003'),0::bigint,'preview creates no orders');
select is((select sum(stock_reserved+stock_sold) from public.event_products where event_id='e1900000-0000-4000-8000-000000000003'),0::bigint,'preview changes no stock');
select throws_ok($$select public.quote_sale_promotions('e1900000-0000-4000-8000-000000000003','live',null,pg_temp.cart(1,0,0),'[]','[]')$$,'P0001','sale_product_unavailable','real checkout quote still rejects unavailable stock');
update public.event_products set is_enabled=false where event_id='e1900000-0000-4000-8000-000000000003' and product_id='e1900000-0000-4000-8000-000000000011';
select throws_ok($$select public.preview_promotion_definition(pg_temp.definition(pg_temp.flex_config('product')),'e1900000-0000-4000-8000-000000000003','live',null,pg_temp.cart(1,0,0))$$,'P0001','sale_product_unavailable','preview still requires channel membership');
select ok(not has_function_privilege('authenticated','private.normalize_sale_bundle_items_preview(uuid,text,uuid,jsonb)','execute'),'clients cannot directly bypass normal checkout stock checks');
select * from finish();
rollback;
