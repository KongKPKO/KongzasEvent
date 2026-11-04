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
create temp table gift_family as select public.save_product_family(null,jsonb_build_object('artist_id','e1800000-0000-4000-8000-000000000002','name','Gift-only family','base_price',0,'product_kind','single','gift_only',true),jsonb_build_array(jsonb_build_object('name','Default','sku','GIFT-FAMILY','stock_total',3,'is_unlimited',false))) id;
select ok((select gift_only from public.product_parents where id=(select id from gift_family)),'gift-only option is stored on the product');
select ok((select gift_only from public.products where parent_product_id=(select id from gift_family)),'gift-only option applies to its sellable item');

insert into public.products(id,artist_id,name,sku,price,currency,stock_total,is_unlimited,status,gift_only)
values('e1800000-0000-4000-8000-000000000015','e1800000-0000-4000-8000-000000000002','Gift second','GIFT-SECOND',0,'THB',100,false,'enable',true);
update public.products set gift_only=true where id='e1800000-0000-4000-8000-000000000014';
insert into public.event_products(event_id,product_id,artist_id,stock_total,is_unlimited,is_enabled,is_sellable)
values('e1800000-0000-4000-8000-000000000003','e1800000-0000-4000-8000-000000000015','e1800000-0000-4000-8000-000000000002',40,false,true,true);
insert into public.online_campaign_products(campaign_id,product_id,artist_id,stock_total,is_unlimited,is_enabled,is_sellable)
values('e1800000-0000-4000-8000-000000000004','e1800000-0000-4000-8000-000000000015','e1800000-0000-4000-8000-000000000002',40,false,true,true);
create temp table choice_promo as select public.save_promotion_definition(jsonb_build_object(
 'artist_id','e1800000-0000-4000-8000-000000000002','name','Choice gift','promotion_type','condition_reward','target_type','all',
 'v1_config',jsonb_build_object('version',1,'condition',jsonb_build_object('kind','quantity','quantity',1),'discount',null,'gift',jsonb_build_object('product_id','e1800000-0000-4000-8000-000000000014','product_ids',jsonb_build_array('e1800000-0000-4000-8000-000000000014','e1800000-0000-4000-8000-000000000015'),'selection_mode','customer_choice','quantity',1,'limit',null)),
 'assignments',jsonb_build_array(jsonb_build_object('event_id','e1800000-0000-4000-8000-000000000003','event_phase','live','is_paused',false,'combination_policy','combine'),jsonb_build_object('campaign_id','e1800000-0000-4000-8000-000000000004','is_paused',false,'combination_policy','combine')))) id;
create function pg_temp.choice_cart() returns jsonb language sql as $$ select '[{"product_id":"e1800000-0000-4000-8000-000000000011","quantity":1}]'::jsonb $$;
create function pg_temp.choice_input(p_product text) returns jsonb language sql as $$ select jsonb_build_array(jsonb_build_object('promotion_id',(select id from choice_promo),'product_ids',jsonb_build_array(p_product))) $$;
select is((select count(*) from public.promotion_reward_products where promotion_id=(select id from choice_promo)),2::bigint,'saves both gift choices');
select is(private.resolve_v1_gift_choices((select id from choice_promo),2,2,'[{"product_id":"A","available":1},{"product_id":"B","available":1}]',jsonb_build_array(jsonb_build_object('promotion_id',(select id from choice_promo),'product_ids',jsonb_build_array('A','B'))))->>'resolved','true','two entitlements can be split across options');
select is(private.resolve_v1_gift_choices((select id from choice_promo),2,2,'[{"product_id":"A","available":1},{"product_id":"B","available":1}]',jsonb_build_array(jsonb_build_object('promotion_id',(select id from choice_promo),'product_ids',jsonb_build_array('A','A'))))->>'resolved','false','cannot exceed stock of a chosen option');
select is(private.resolve_v1_gift_choices((select id from choice_promo),2,1,'[{"product_id":"A","available":1},{"product_id":"B","available":1}]',jsonb_build_array(jsonb_build_object('promotion_id',(select id from choice_promo),'product_ids',jsonb_build_array('B'),'accepted_quantity',1,'accepted_earned_quantity',2)))->>'resolved','true','quota partial acceptance permits either option');
select is(jsonb_array_length(public.quote_sale_promotions(null,null,'e1800000-0000-4000-8000-000000000004',pg_temp.choice_cart(),'[]','[]')->'required_choices'),1,'campaign requires a choice');
select is(jsonb_array_length(public.quote_sale_promotions('e1800000-0000-4000-8000-000000000003','live',null,pg_temp.choice_cart(),'[]','[]')->'required_choices'),1,'POS requires a choice');
update public.artist_promotions set v1_config=jsonb_set(v1_config,'{condition}','{"kind":"product","items":[{"product_id":"e1800000-0000-4000-8000-000000000011","quantity":1},{"product_id":"e1800000-0000-4000-8000-000000000012","quantity":1}]}'::jsonb) where id=(select id from choice_promo);
select is(jsonb_array_length(public.quote_sale_promotions(null,null,'e1800000-0000-4000-8000-000000000004',pg_temp.choice_cart(),'[]','[]')->'required_choices'),1,'buy-any-specific-product promotion offers choices');
select is(public.quote_sale_promotions(null,null,'e1800000-0000-4000-8000-000000000004',pg_temp.choice_cart(),pg_temp.choice_input('e1800000-0000-4000-8000-000000000015'),'[]')#>>'{reward_lines,0,product_id}','e1800000-0000-4000-8000-000000000015','selected gift appears in quote');
create temp table choice_pos_order as select public.create_walkin_order_with_stock('e1800000-0000-4000-8000-000000000003',pg_temp.choice_cart(),'cash',gen_random_uuid(),pg_temp.choice_input('e1800000-0000-4000-8000-000000000014'),'[]',null,false) order_id;
select is((select count(*) from public.order_items where order_id=(select order_id from choice_pos_order) and product_id='e1800000-0000-4000-8000-000000000014' and line_type='promotion_reward'),1::bigint,'POS records selected gift');
select is((select stock_sold from public.event_products where event_id='e1800000-0000-4000-8000-000000000003' and product_id='e1800000-0000-4000-8000-000000000014'),1,'POS consumes the chosen gift stock');
select is(jsonb_array_length(public.quote_sale_promotions(null,null,'e1800000-0000-4000-8000-000000000004',pg_temp.choice_cart(),pg_temp.choice_input('e1800000-0000-4000-8000-000000000011'),'[]')->'required_choices'),1,'cannot inject a non-gift as the selected reward');
create temp table selected_quote as select public.quote_sale_promotions(null,null,'e1800000-0000-4000-8000-000000000004',pg_temp.choice_cart(),pg_temp.choice_input('e1800000-0000-4000-8000-000000000015'),'[]') quote;
create temp table choice_order as select order_id from public.create_online_campaign_order('e1800000-0000-4000-8000-000000000004',pg_temp.choice_cart(),'shipping',null,'Local buyer','choice@example.test','0812345678','Local address','',gen_random_uuid(),pg_temp.choice_input('e1800000-0000-4000-8000-000000000015'),'[]',(select quote->>'pricing_hash' from selected_quote));
select is((select count(*) from public.order_items where order_id=(select order_id from choice_order) and product_id='e1800000-0000-4000-8000-000000000015' and line_type='promotion_reward' and price_per_unit=0),1::bigint,'checkout records selected gift at zero price');
select is((select stock_reserved from public.online_campaign_products where campaign_id='e1800000-0000-4000-8000-000000000004' and product_id='e1800000-0000-4000-8000-000000000015'),1,'checkout holds selected gift stock');
update public.online_campaign_products set stock_total=stock_reserved where campaign_id='e1800000-0000-4000-8000-000000000004' and product_id='e1800000-0000-4000-8000-000000000015';
select is(public.quote_sale_promotions(null,null,'e1800000-0000-4000-8000-000000000004',pg_temp.choice_cart(),'[]','[]')#>>'{required_choices,0,options,1,available}','0','sold out option remains visible with zero stock');
select is((select count(*) from public.list_event_products('e1800000-0000-4000-8000-000000000003') where id in ('e1800000-0000-4000-8000-000000000014','e1800000-0000-4000-8000-000000000015')),0::bigint,'gift-only products hidden from event catalog');
select ok(not (public.get_public_online_campaign('condition-reward-v1','condition-v1')->'products' @> '[{"product_id":"e1800000-0000-4000-8000-000000000015"}]'::jsonb),'gift-only product hidden from online catalog');
select throws_ok($$select public.quote_sale_promotions(null,null,'e1800000-0000-4000-8000-000000000004','[{"product_id":"e1800000-0000-4000-8000-000000000015","quantity":1}]','[]','[]')$$,'sale_product_unavailable','gift-only product cannot be purchased directly');
-- Two selectable bundles may each look available but compete for one component.
create temp table choice_bundles as
select public.save_product_bundle(jsonb_build_object('artist_id','e1800000-0000-4000-8000-000000000002','name',name,'base_price',0),jsonb_build_array(jsonb_build_object('product_id','e1800000-0000-4000-8000-000000000012','quantity',1))) parent
from (values ('Choice bundle A'),('Choice bundle B')) t(name);
create temp table choice_bundle_products as select p.id from public.products p join choice_bundles b on p.parent_product_id=b.parent;
insert into public.online_campaign_products(campaign_id,product_id,artist_id,stock_total,is_unlimited,is_enabled,is_sellable)
select 'e1800000-0000-4000-8000-000000000004',id,'e1800000-0000-4000-8000-000000000002',0,false,true,true from choice_bundle_products;
update public.online_campaign_products set stock_total=1 where campaign_id='e1800000-0000-4000-8000-000000000004' and product_id='e1800000-0000-4000-8000-000000000012';
update public.artist_promotions set v1_config=jsonb_set(jsonb_set(jsonb_set(v1_config,'{condition}','{"kind":"quantity","quantity":1}'::jsonb),'{gift,product_ids}',(select jsonb_agg(id) from choice_bundle_products)),'{gift,product_id}',(select to_jsonb(id) from choice_bundle_products limit 1)) where id=(select id from choice_promo);
select is(jsonb_array_length(public.quote_sale_promotions(null,null,'e1800000-0000-4000-8000-000000000004','[{"product_id":"e1800000-0000-4000-8000-000000000011","quantity":2}]',jsonb_build_array(jsonb_build_object('promotion_id',(select id from choice_promo),'product_ids',(select jsonb_agg(id) from choice_bundle_products))),'[]')->'required_choices'),1,'shared bundle components cannot be claimed twice');
select is(public.quote_sale_promotions(null,null,'e1800000-0000-4000-8000-000000000004','[{"product_id":"e1800000-0000-4000-8000-000000000011","quantity":2}]',jsonb_build_array(jsonb_build_object('promotion_id',(select id from choice_promo),'product_ids',(select jsonb_agg(id) from choice_bundle_products))),'[]')#>>'{required_choices,0,shared_stock_conflict}','true','shared stock conflict is explained to the buyer');
select * from finish();
rollback;

