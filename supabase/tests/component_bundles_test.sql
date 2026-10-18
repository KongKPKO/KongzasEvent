begin;
select no_plan();
create temp table ids as select gen_random_uuid() artist,gen_random_uuid() owner,gen_random_uuid() a,gen_random_uuid() b,gen_random_uuid() event;
insert into auth.users(id,email) select owner,'bundle-owner@example.local' from ids;
insert into public.artists(id,slug,display_name,is_public,is_verified,published_at) select artist,'component-bundle-test','Bundles',true,true,now() from ids;
insert into public.artist_members(artist_id,member_email,role,status) select artist,'bundle-owner@example.local','owner','active' from ids;
select set_config('request.jwt.claims',jsonb_build_object('sub',owner,'email','bundle-owner@example.local','role','authenticated')::text,true) from ids;
insert into public.products(id,artist_id,name,price,is_unlimited,stock_total,status) select a,artist,'A4',100,false,40,'enable' from ids union all select b,artist,'A3',100,false,30,'enable' from ids;
create temp table bundles as select public.save_product_bundle(jsonb_build_object('artist_id',artist,'name','Set Mavuika','base_price',200,'currency','THB'),jsonb_build_array(jsonb_build_object('product_id',a,'quantity',2),jsonb_build_object('product_id',b,'quantity',1))) parent from ids;
create temp table bundle as select id from public.products where parent_product_id=(select parent from bundles);
select is((select private.bundle_available(id) from bundle),20,'bundle capacity accounts for quantity per component');
select is((select is_unlimited from public.products where id=(select id from bundle)),true,'bundle has no independent finite stock');
select ok(not has_function_privilege('anon','public.save_product_bundle(jsonb,jsonb)','execute'),'anonymous has no bundle editor RPC access');
insert into public.events(id,artist_id,event_name,start_date,end_date,status,preorder_enabled,preorder_opens_at,preorder_closes_at)
select event,artist,'Bundle Event',now()+interval '10 days',now()+interval '11 days','Confirmed',true,now()-interval '1 day',now()+interval '9 days' from ids;
insert into public.event_products(event_id,product_id,artist_id,is_unlimited,stock_total,is_enabled) select event,a,artist,false,20,true from ids union all select event,b,artist,false,10,true from ids union all select event,(select id from bundle),artist,true,null,true from ids;
select is((select private.bundle_available((select id from bundle),event,null) from ids),10,'uses event allocation instead of whole catalog');
-- Exercise promotion quoting after the bundle has already taken its own hold.
create temp table promo as select gen_random_uuid() id;
insert into public.artist_promotions(id,artist_id,name,target_type,rule_type,promotion_type,buy_quantity,reward_value,lifecycle_status)
select p.id,i.artist,'Quote-only threshold','all','discount','quantity_discount',9999,1,'ready' from promo p,ids i;
insert into public.promotion_assignments(artist_id,promotion_id,event_id,event_phase,combination_policy)
select i.artist,p.id,i.event,'preorder','combine' from promo p,ids i;
update public.event_products set stock_total=case when product_id=(select a from ids) then 4 else 2 end where product_id in((select a from ids),(select b from ids));
create temp table orders_created as select order_id id from public.create_preorder_with_stock((select event from ids),jsonb_build_array(jsonb_build_object('product_id',(select id from bundle),'quantity',2)),'Bundle buyer','contact',p_customer_email=>'bundle-buyer@example.local');
select is((select stock_reserved from public.event_products where product_id=(select a from ids)),4,'reserves two A4 per set');
select is((select stock_reserved from public.event_products where product_id=(select b from ids)),2,'reserves one A3 per set');
select is((select private.bundle_available((select id from bundle),event,null) from ids),0,'available sets reflect holds');
select throws_ok($$select * from public.create_preorder_with_stock((select event from ids),jsonb_build_array(jsonb_build_object('product_id',(select a from ids),'quantity',17)),'Other','contact',p_customer_email=>'other@example.local')$$,'sale_product_unavailable','separate sale cannot consume held components');
update public.order_payments set payment_status='payment_confirmed' where order_id=(select id from orders_created);
update public.orders set status='confirmed',pickup_status='awaiting_pickup' where id=(select id from orders_created);
select lives_ok($$select public.mark_preorder_picked_up((select id from orders_created))$$,'fulfill whole bundle');
select is((select stock_sold from public.event_products where product_id=(select a from ids)),4,'fulfillment consumes components once');
select is((select stock_reserved from public.event_products where product_id=(select a from ids)),0,'fulfillment releases component holds');
update public.event_products set stock_total=case when product_id=(select a from ids) then 20 else 10 end where product_id in((select a from ids),(select b from ids));
-- Another pending order expires, restoring exactly its components.
create temp table expiring as select order_id id from public.create_preorder_with_stock((select event from ids),jsonb_build_array(jsonb_build_object('product_id',(select id from bundle),'quantity',1)),'Expire','contact',p_customer_email=>'expire@example.local');
update public.order_payments set payment_status='payment_expired' where order_id=(select id from expiring);
select is((select stock_reserved from public.event_products where product_id=(select a from ids)),0,'expiry returns component holds');
update public.order_payments set payment_status='payment_expired' where order_id=(select id from expiring);
select is((select stock_reserved from public.event_products where product_id=(select a from ids)),0,'expiry retry cannot double release');
-- Production units have separate demand and are covered only by receipts/explicit transfer.
select public.configure_product_supply((select id from bundle),(select event from ids),null,'preorder','production',5);
create temp table production as select order_id id from public.create_preorder_with_stock((select event from ids),jsonb_build_array(jsonb_build_object('product_id',(select id from bundle),'quantity',2)),'Production','contact',p_customer_email=>'production@example.local');
update public.order_payments set payment_status='payment_confirmed' where order_id=(select id from production);
update public.orders set status='confirmed',pickup_status='awaiting_pickup' where id=(select id from production);
select is((select stock_reserved from public.products where id=(select a from ids)),0,'payment leaves existing ready stock intact');
select is((select (value->>'required')::integer from jsonb_array_elements(public.production_order_stock((select event from ids),null)) where value->>'order_id'=(select id::text from production)),6,'production summary counts six component units, without the bundle container');
select throws_ok($$select public.mark_preorder_picked_up((select id from production))$$,'production_stock_not_ready','cannot deliver missing production components');
select lives_ok($$select public.adjust_catalog_stock(a,5,'receive','bundle production',gen_random_uuid()) from ids$$,'receipt covers A4 demand');
select is((select stock_reserved from public.products where id=(select a from ids)),4,'receipt earmarks four A4');
select lives_ok($$select public.assign_production_stock(b,2,gen_random_uuid()) from ids$$,'explicit transfer covers A3');
select lives_ok($$select public.mark_preorder_picked_up((select id from production))$$,'deliver after every component ready');
select is((select stock_sold from public.products where id=(select a from ids)),4,'production components consumed centrally');
select is((select stock_reserved from public.products where id=(select a from ids)),0,'production holds consumed');
-- Ordinary and bundle production share a FIFO receipt queue.
select public.configure_product_supply(a,event,null,'preorder','production',20) from ids;
create temp table older_bundle as select order_id id from public.create_preorder_with_stock((select event from ids),jsonb_build_array(jsonb_build_object('product_id',(select id from bundle),'quantity',1)),'Older bundle','contact',p_customer_email=>'older@example.local');
update public.orders set created_at=now()-interval '2 minutes' where id=(select id from older_bundle);
update public.order_payments set payment_status='payment_confirmed' where order_id=(select id from older_bundle);
create temp table newer_single as select order_id id from public.create_preorder_with_stock((select event from ids),jsonb_build_array(jsonb_build_object('product_id',(select a from ids),'quantity',2)),'Newer single','contact',p_customer_email=>'newer@example.local');
update public.order_payments set payment_status='payment_confirmed' where order_id=(select id from newer_single);
select public.adjust_catalog_stock(a,2,'receive','FIFO receipt',gen_random_uuid()) from ids;
select is((select b.held from private.bundle_order_components b join public.order_items oi on oi.id=b.order_item_id where oi.order_id=(select id from older_bundle) and b.product_id=(select a from ids)),2,'older bundle receives stock before newer individual demand');
select is((select allocated from private.production_stock s join public.order_items oi on oi.id=s.order_item_id where oi.order_id=(select id from newer_single)),0,'newer individual demand waits its turn');
update public.order_payments set payment_status='payment_cancelled' where order_id=(select id from older_bundle);
select is((select allocated from private.production_stock s join public.order_items oi on oi.id=s.order_item_id where oi.order_id=(select id from newer_single)),2,'cancelled bundle earmark transfers to next confirmed demand');
update public.order_payments set payment_status='payment_cancelled' where order_id=(select id from newer_single);
-- A component with no channel allocation can still owe production units.
create temp table unallocated_component as select gen_random_uuid() id;
insert into public.products(id,artist_id,name,price,is_unlimited,stock_total,status)
select c.id,i.artist,'Production-only part',10,false,20,'enable' from unallocated_component c,ids i;
create temp table only_production_bundle as select public.save_product_bundle(jsonb_build_object('artist_id',i.artist,'name','Production-only set','base_price',10),jsonb_build_array(jsonb_build_object('product_id',c.id,'quantity',1))) parent from ids i,unallocated_component c;
create temp table only_production_item as select id from public.products where parent_product_id=(select parent from only_production_bundle);
insert into public.event_products(event_id,product_id,artist_id,is_unlimited,is_enabled) select event,(select id from only_production_item),artist,true,true from ids;
select public.configure_product_supply((select id from only_production_item),(select event from ids),null,'preorder','production',2);
create temp table only_production_order as select order_id id from public.create_preorder_with_stock((select event from ids),jsonb_build_array(jsonb_build_object('product_id',(select id from only_production_item),'quantity',1)),'Production-only buyer','contact',p_customer_email=>'production-only@example.local');
update public.order_payments set payment_status='payment_confirmed' where order_id=(select id from only_production_order);
select throws_ok($$update public.products set is_unlimited=true,stock_total=null where id=(select id from unallocated_component)$$,'allocated_variant_stock_mode_locked','unallocated component cannot abandon confirmed bundle production demand');
update public.order_payments set payment_status='payment_cancelled' where order_id=(select id from only_production_order);
create temp table before_recipe as select public.calculate_sale_promotions((select event from ids),'preorder',null,jsonb_build_array(jsonb_build_object('product_id',(select id from bundle),'quantity',1)),'[]','[]')->>'pricing_hash' hash;
-- Existing component snapshots survive changes to the current recipe.
select public.save_product_bundle(to_jsonb(p),jsonb_build_array(jsonb_build_object('product_id',i.a,'quantity',1))) from public.product_parents p,ids i where p.id=(select parent from bundles);
select isnt((public.calculate_sale_promotions((select event from ids),'preorder',null,jsonb_build_array(jsonb_build_object('product_id',(select id from bundle),'quantity',1)),'[]','[]')->>'pricing_hash'),(select hash from before_recipe),'recipe changes invalidate a stale customer quote without changing the price');
select is((select b.quantity from private.bundle_order_components b join public.order_items oi on oi.id=b.order_item_id where oi.order_id=(select id from orders_created) and b.product_id=(select a from ids)),4,'recipe edit leaves historical component quantity intact');
select is((select (private.order_bundle_components(oi.id)->0->>'quantity')::integer from public.order_items oi where oi.order_id=(select id from orders_created)),2,'fulfillment projects the immutable snapshot after recipe edit');
select public.save_product_bundle(to_jsonb(p),jsonb_build_array(jsonb_build_object('product_id',i.a,'quantity',2),jsonb_build_object('product_id',i.b,'quantity',1))) from public.product_parents p,ids i where p.id=(select parent from bundles);
-- Campaign stock uses the same pool as its individually allocated components.
create temp table campaign as select gen_random_uuid() id;
insert into public.online_campaigns(id,artist_id,name,slug,opens_at,closes_at,publication_status,shipping_enabled)
select c.id,i.artist,'Bundle online','component-bundle-online',now()-interval '1 hour',now()+interval '1 day','published',true from campaign c,ids i;
insert into public.campaign_payment_methods(campaign_id,artist_id,method_type,promptpay_id) select c.id,i.artist,'promptpay','0000000000' from campaign c,ids i;
insert into public.online_campaign_products(campaign_id,artist_id,product_id,is_enabled,is_unlimited,stock_total)
select c.id,i.artist,i.a,true,false,10 from campaign c,ids i union all select c.id,i.artist,i.b,true,false,6 from campaign c,ids i union all select c.id,i.artist,b.id,true,true,null from campaign c,ids i,bundle b;
create temp table campaign_order as select order_id id from public.create_online_campaign_order((select id from campaign),jsonb_build_array(jsonb_build_object('product_id',(select id from bundle),'quantity',1)),'shipping',null,'Campaign buyer','campaign@example.local','0800000000','Local fixture address','',gen_random_uuid());
select is((select stock_reserved from public.online_campaign_products where product_id=(select a from ids)),2,'campaign bundle holds components');
update public.order_payments set payment_status='payment_submitted' where order_id=(select id from campaign_order);
select lives_ok($$select public.confirm_online_payment((select id from campaign_order))$$,'campaign confirms bundle payment');
select is((select stock_sold from public.online_campaign_products where product_id=(select a from ids)),2,'campaign confirmation converts holds to sold exactly once');
select lives_ok($$select public.mark_online_order_shipped((select id from campaign_order),'Local','TEST')$$,'campaign ships bundle');
select is((select consumed from private.bundle_order_components b join public.order_items oi on oi.id=b.order_item_id where oi.order_id=(select id from campaign_order) and b.product_id=(select a from ids)),2,'shipping records actual component handover');
update public.order_payments set payment_status='refunded' where order_id=(select id from campaign_order);
select is((select stock_sold from public.online_campaign_products where product_id=(select a from ids)),2,'refund does not silently restock delivered components');
-- Live POS follows the same component pool without an online timer.
update public.events set start_date=now()-interval '1 hour',end_date=now()+interval '1 day',is_booth_open=true where id=(select event from ids);
select lives_ok($$select public.create_walkin_order_with_stock((select event from ids),jsonb_build_array(jsonb_build_object('product_id',(select id from bundle),'quantity',1)),'cash',gen_random_uuid())$$,'live POS sells linked bundle');
select is((select stock_sold from public.event_products where product_id=(select a from ids)),6,'POS consumes components alongside prior pickup');
select throws_like($$select public.create_walkin_order_with_stock((select event from ids),jsonb_build_array(jsonb_build_object('product_id',(select id from bundle),'quantity',5),jsonb_build_object('product_id',(select a from ids),'quantity',6)),'cash',gen_random_uuid())$$,'insufficient%stock','mixed component and bundle oversell rolls back whole cart');
select is((select stock_sold from public.event_products where product_id=(select a from ids)),6,'failed mixed sale leaves stock unchanged');
-- A queue order owns its component hold while POS obtains the final quote.
insert into auth.users(id,email) select artist,'bundle-shop@example.local' from ids;
create temp table live_queue as select gen_random_uuid() id;
insert into public.queues(id,event_id,artist_id,queue_number,queue_service_date,status,called_at,served_at)
select q.id,i.event,i.artist,99,current_date,'serving',now(),now() from live_queue q,ids i;
create temp table queue_order as select public.create_customer_order_with_stock((select id from live_queue),jsonb_build_array(jsonb_build_object('product_id',(select id from bundle),'quantity',1)),gen_random_uuid()) id;
-- Leave no free component beyond the units held by this queue.
update public.event_products set stock_total=stock_sold+stock_reserved where product_id in((select a from ids),(select b from ids));
select is((select (value->>'stock_total')::integer from public.get_pos_catalog_for_order((select event from ids),(select id from queue_order)) as entry(value) where value->>'id'=(select id::text from bundle)),1,'POS catalog includes the selected queue order''s reserved bundle');
create temp table queue_staff_user as select gen_random_uuid() id;
insert into auth.users(id,email) select id,'bundle-queue-staff@example.local' from queue_staff_user;
insert into public.artist_members(artist_id,member_email,role,status) select artist,'bundle-queue-staff@example.local','queue_staff','active' from ids;
select set_config('request.jwt.claims',jsonb_build_object('sub',id,'email','bundle-queue-staff@example.local','role','authenticated')::text,true) from queue_staff_user;
select throws_ok($$select public.quote_pos_order((select event from ids),(select id from queue_order),jsonb_build_array(jsonb_build_object('product_id',(select id from bundle),'quantity',1)))$$,'forbidden','queue staff cannot quote POS order amounts');
select throws_ok($$select * from public.get_pos_catalog_for_order((select event from ids),(select id from queue_order))$$,'forbidden','queue staff cannot access selected POS orders');
select set_config('request.jwt.claims',jsonb_build_object('sub',owner,'email','bundle-owner@example.local','role','authenticated')::text,true) from ids;
select lives_ok($$select public.quote_pos_order((select event from ids),(select id from queue_order),jsonb_build_array(jsonb_build_object('product_id',(select id from bundle),'quantity',1)))$$,'POS preview can quote its reserved last bundle');
select lives_ok($$select public.complete_order_with_stock((select id from queue_order),'cash',(select payment_idempotency_key from public.orders where id=(select id from queue_order)),'[]','[]',null,false)$$,'POS can finish a bundle even when its own hold is the last stock');
select is((select stock_sold from public.event_products where product_id=(select a from ids)),8,'queue payment consumes its components once');
select throws_ok($$select public.save_product_bundle(jsonb_build_object('artist_id',(select artist from ids),'name','Nested','base_price',1),jsonb_build_array(jsonb_build_object('product_id',(select id from bundle),'quantity',1)))$$,'invalid_bundle_component','nested bundles rejected');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.save_product_bundle(jsonb_build_object('artist_id',(select artist from ids),'name','No auth','base_price',1),'[]')$$,'forbidden','unauthenticated cannot create bundle');
select * from finish();
rollback;
