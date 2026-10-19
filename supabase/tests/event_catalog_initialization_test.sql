begin;
select no_plan();

create temp table setup_ids as
select gen_random_uuid() owner, gen_random_uuid() outsider, gen_random_uuid() artist,
  gen_random_uuid() finite_product, gen_random_uuid() unlimited_product,
  gen_random_uuid() source_event, gen_random_uuid() reuse_event,
  gen_random_uuid() empty_event, gen_random_uuid() selected_event;

insert into auth.users(id,email) select owner,'event-setup-owner@example.local' from setup_ids
union all select outsider,'event-setup-outsider@example.local' from setup_ids;
insert into public.artists(id,slug,display_name,is_public,is_verified,published_at)
select artist,'event-setup-fixture','Event setup fixture',true,true,now() from setup_ids;
insert into public.artist_members(artist_id,member_email,role,status)
select artist,'event-setup-owner@example.local','owner','active' from setup_ids;
insert into public.products(id,artist_id,name,price,status,is_unlimited,stock_total,stock_reserved,stock_sold)
select finite_product,artist,'Finite setup item',100,'enable',false,20,0,0 from setup_ids
union all select unlimited_product,artist,'Unlimited setup item',50,'enable',true,null,0,0 from setup_ids;
insert into public.events(id,artist_id,event_name,start_date,end_date,status)
select source_event,artist,'Source event',now()-interval '1 day',now()+interval '1 day','Confirmed' from setup_ids
union all select reuse_event,artist,'Reuse event',now(),now()+interval '2 days','Confirmed' from setup_ids
union all select empty_event,artist,'Empty event',now(),now()+interval '2 days','Confirmed' from setup_ids
union all select selected_event,artist,'Selected event',now(),now()+interval '2 days','Confirmed' from setup_ids;
insert into public.event_products(event_id,product_id,artist_id,is_enabled,is_unlimited,stock_total,stock_reserved,stock_sold)
select source_event,finite_product,artist,true,false,8,1,2 from setup_ids
union all select source_event,unlimited_product,artist,true,true,null,3,4 from setup_ids;

select set_config('request.jwt.claims',jsonb_build_object('sub',owner,'email','event-setup-owner@example.local','role','authenticated')::text,true) from setup_ids;
select lives_ok($$select private.initialize_event_catalog((select reuse_event from setup_ids),'reuse',(select source_event from setup_ids),jsonb_build_array(jsonb_build_object('product_id',(select finite_product from setup_ids),'stock_total',0),jsonb_build_object('product_id',(select unlimited_product from setup_ids))))$$,'owner can reuse a previous event membership');
select is((select stock_total from public.event_products where event_id=(select reuse_event from setup_ids) and product_id=(select finite_product from setup_ids)),0,'reuse starts tracked stock at zero');
select is((select stock_reserved + stock_sold from public.event_products where event_id=(select reuse_event from setup_ids) and product_id=(select finite_product from setup_ids)),0,'reuse never copies reserved or sold counts');
select ok((select is_unlimited and stock_total is null from public.event_products where event_id=(select reuse_event from setup_ids) and product_id=(select unlimited_product from setup_ids)),'unlimited membership needs no allocation');

select lives_ok($$select private.initialize_event_catalog((select empty_event from setup_ids),'empty',null,'[]')$$,'owner can explicitly start empty');
select ok(private.event_catalog_is_initialized((select empty_event from setup_ids)),'empty catalog keeps an explicit initialization marker');
select is((select count(*)::integer from public.list_event_products((select empty_event from setup_ids))),0,'explicitly empty event does not fall back to the shop catalog');

update public.events set is_booth_open=true where id=(select empty_event from setup_ids);
select throws_ok($$select public.quote_sale_promotions((select empty_event from setup_ids),'live',null,jsonb_build_array(jsonb_build_object('product_id',(select finite_product from setup_ids),'quantity',1)))$$,'P0001','sale_product_unavailable','direct pricing cannot buy from an explicitly empty event');
select throws_ok($$select public.create_walkin_order_with_stock((select empty_event from setup_ids),jsonb_build_array(jsonb_build_object('product_id',(select finite_product from setup_ids),'quantity',1)),'cash',gen_random_uuid())$$,'P0001','invalid_product','direct POS cannot bypass empty membership');

select lives_ok($$select private.initialize_event_catalog((select selected_event from setup_ids),'select',null,jsonb_build_array(jsonb_build_object('product_id',(select finite_product from setup_ids),'stock_total',4)))$$,'owner can choose products and allocate stock');
select is((select stock_total from public.event_products where event_id=(select selected_event from setup_ids)),4,'selected allocation is saved');

select throws_ok($$select private.initialize_event_catalog((select selected_event from setup_ids),'empty',null,'[]')$$,'event_catalog_already_initialized','existing configured event cannot be reinitialized');
select is((select stock_total from public.event_products where event_id=(select selected_event from setup_ids)),4,'failed reinitialization preserves allocation');

create temp table new_setup_request as select gen_random_uuid() id, jsonb_build_object('artist_id',artist,'event_name','Atomic event','start_date',now(),'end_date',now()+interval '1 day','status','Confirmed','event_timezone','Asia/Bangkok') payload from setup_ids;
update new_setup_request set payload=payload||jsonb_build_object('id',id);
select throws_ok($$select public.create_event_with_catalog((select payload from new_setup_request),'select',null,jsonb_build_array(jsonb_build_object('product_id',(select finite_product from setup_ids),'stock_total',999)))$$,'event_stock_exceeds_catalog_stock','over-allocation fails the entire creation');
select is((select count(*) from public.events where id=(select id from new_setup_request)),0::bigint,'failed stock setup leaves no partial event');
select lives_ok($$select public.create_event_with_catalog((select payload from new_setup_request),'select',null,jsonb_build_array(jsonb_build_object('product_id',(select finite_product from setup_ids),'stock_total',2)))$$,'atomic creation and fresh allocation succeeds');
select lives_ok($$select public.create_event_with_catalog((select payload from new_setup_request),'select',null,jsonb_build_array(jsonb_build_object('product_id',(select finite_product from setup_ids),'stock_total',2)))$$,'same request retries without duplicate creation or allocation');
select is((select count(*) from public.event_products where event_id=(select id from new_setup_request)),1::bigint,'retry retains one membership');
select throws_ok($$select public.create_event_with_catalog((select payload from new_setup_request),'empty',null,'[]')$$,'event_setup_request_conflict','changed request cannot overwrite a completed event');
select is((select stock_total from public.event_products where event_id=(select source_event from setup_ids) and product_id=(select finite_product from setup_ids)),8,'source allocation untouched');

select set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'email','event-setup-outsider@example.local','role','authenticated')::text,true) from setup_ids;
select throws_ok($$select private.initialize_event_catalog((select selected_event from setup_ids),'empty',null,'[]')$$,'forbidden','other users cannot replace event setup');
select ok(not has_function_privilege('anon','public.create_event_with_catalog(jsonb,text,uuid,jsonb)','EXECUTE'),'anonymous setup writes are denied');

select * from finish();
rollback;
