begin;
select no_plan();
create temp table inv_ids as select gen_random_uuid() artist,gen_random_uuid() owner,gen_random_uuid() product,gen_random_uuid() event,gen_random_uuid() ep,gen_random_uuid() request,gen_random_uuid() assign_request;
insert into auth.users(id,email) select owner,'production-owner@example.local' from inv_ids;
insert into public.artists(id,slug,display_name,is_public,is_verified,published_at) select artist,'production-stock-test','Production stock',true,true,now() from inv_ids;
insert into public.artist_members(artist_id,member_email,role,status) select artist,'production-owner@example.local','owner','active' from inv_ids;
select set_config('request.jwt.claims',jsonb_build_object('sub',owner,'email','production-owner@example.local','role','authenticated')::text,true) from inv_ids;
insert into public.products(id,artist_id,name,price,is_unlimited,stock_total,status) select product,artist,'Made to order',200,false,0,'enable' from inv_ids;
insert into public.events(id,artist_id,event_name,start_date,end_date,status,preorder_enabled,preorder_opens_at,preorder_closes_at)
 select event,artist,'Production Event',now()+interval '10 days',now()+interval '11 days','Confirmed',true,now()-interval '1 day',now()+interval '9 days' from inv_ids;
insert into public.event_products(id,event_id,product_id,artist_id,is_unlimited,stock_total,is_enabled)
 select ep,event,product,artist,false,0,true from inv_ids;
select lives_ok($$select public.configure_product_supply(product,event,null,'preorder','production',25) from inv_ids$$,'enable capped production without physical stock');
select throws_ok($$select * from public.create_preorder_with_stock((select event from inv_ids),jsonb_build_array(jsonb_build_object('product_id',(select product from inv_ids),'quantity',1,'expected_supply_mode','stock')), 'Review buyer','contact',p_customer_email=>'review@example.local')$$,'supply_policy_changed_reload','changed supply policy requires renewed customer review');
select throws_ok($$select public.configure_product_supply(product,event,null,'preorder','stock',null,'{"mode":"stock","limit":null}') from inv_ids$$,'supply_policy_changed_reload','stale management policy cannot overwrite a newer policy');
create temp table made_orders(id uuid);
insert into made_orders select order_id from public.create_preorder_with_stock((select event from inv_ids),
 jsonb_build_array(jsonb_build_object('product_id',(select product from inv_ids),'quantity',20)), 'Test buyer','contact',p_customer_email=>'buyer@example.local');
select is((select inventory_source from public.order_items where order_id=(select id from made_orders)),'production','source snapshotted');
select is((select stock_reserved from public.event_products where id=(select ep from inv_ids)),0,'production does not consume event stock');
select is((select private.production_remaining(event,null,product,'preorder') from inv_ids),5,'pending payment counts toward production cap');
update public.order_payments set stock_hold_expires_at=now()-interval '1 second',upload_grace_expires_at=now()+interval '1 minute' where order_id=(select id from made_orders);
select is((select private.production_remaining(event,null,product,'preorder') from inv_ids),5,'upload grace retains production capacity after the payment deadline');
update public.order_payments set upload_grace_expires_at=now()-interval '1 second' where order_id=(select id from made_orders);
select is((select private.production_remaining(event,null,product,'preorder') from inv_ids),25,'capacity releases after both hold and upload grace expire');
update public.order_payments set stock_hold_expires_at=now()+interval '15 minutes',upload_grace_expires_at=null where order_id=(select id from made_orders);

select throws_ok($$select * from public.create_preorder_with_stock((select event from inv_ids),jsonb_build_array(jsonb_build_object('product_id',(select product from inv_ids),'quantity',6)), 'Test buyer','contact',p_customer_email=>'buyer@example.local')$$,'production_limit_exceeded','cap is enforced server side');
-- Simulate reviewed payment without creating/uploading an evidence file.
update public.order_payments set payment_status='payment_confirmed' where order_id=(select id from made_orders);
update public.orders set status='confirmed',pickup_status='awaiting_pickup' where id=(select id from made_orders);
select throws_ok($$select * from public.mark_preorder_picked_up((select id from made_orders))$$,'production_stock_not_ready','cannot hand over unproduced items');
select lives_ok($$select public.adjust_catalog_stock(product,50,'receive','received',request) from inv_ids$$,'receive50 earmarks outstanding20');
select is((select stock_reserved from public.products where id=(select product from inv_ids)),20,'20 physical units earmarked');
select is((select available from public.list_product_stock_summaries((select artist from inv_ids))),30,'30 remain ready for new allocation');
select lives_ok($$select public.adjust_catalog_stock(product,50,'receive','received',request) from inv_ids$$,'receipt retry idempotent');
select is((select stock_total from public.products where id=(select product from inv_ids)),50,'receipt retry does not add twice');
select lives_ok($$select * from public.mark_preorder_picked_up((select id from made_orders))$$,'can hand over earmarked items');
select is((select stock_reserved from public.products where id=(select product from inv_ids)),0,'delivery clears earmark');
select is((select stock_sold from public.products where id=(select product from inv_ids)),20,'delivery consumes physical stock once');
select is((select available from public.list_product_stock_summaries((select artist from inv_ids))),30,'delivery does not subtract capacity twice');
select is(((public.inventory_overview((select artist from inv_ids))->0)->>'physical_on_hand')::integer,30,'physical stock after handover is30');
select throws_ok($$select public.configure_product_supply(product,event,null,'preorder','production',10) from inv_ids$$,'production_limit_below_orders','cannot lower cap below accepted orders');
select is((select (row->>'stock_total')::integer from public.list_event_products_for_phase((select event from inv_ids),'live') row where row->>'id'=(select product::text from inv_ids)),0,'POS sees physical event allocation rather than public production cap');
-- Returning/cancelling an unfulfilled production order releases its earmark.
select lives_ok($$select public.configure_product_supply(product,event,null,'preorder','production',null) from inv_ids$$,'remove production cap');
insert into made_orders select order_id from public.create_preorder_with_stock((select event from inv_ids),jsonb_build_array(jsonb_build_object('product_id',(select product from inv_ids),'quantity',10)), 'Second buyer','contact',p_customer_email=>'buyer2@example.local');
-- Select by quantity to avoid depending on random UUID ordering.
update public.order_payments set payment_status='payment_confirmed' where order_id=(select order_id from public.order_items where product_id=(select product from inv_ids) and quantity=10);
select is((select stock_reserved from public.products where id=(select product from inv_ids)),0,'confirmation does not take existing ready stock');
select lives_ok($$select public.assign_production_stock(product,10,assign_request) from inv_ids$$,'merchant explicitly earmarks existing ready stock');
select is((select stock_reserved from public.products where id=(select product from inv_ids)),10,'explicit earmark moves10 ready units to production orders');
select lives_ok($$select public.assign_production_stock(product,10,assign_request) from inv_ids$$,'explicit earmark replay is idempotent');
select is((select stock_reserved from public.products where id=(select product from inv_ids)),10,'earmark replay does not take another10 units');
select throws_ok($$select public.assign_production_stock(product,11,assign_request) from inv_ids$$,'stock_request_conflict','earmark request quantity cannot change');
update public.orders set status='cancelled',pickup_status='cancelled' where id=(select order_id from public.order_items where product_id=(select product from inv_ids) and quantity=10);
select is((select stock_reserved from public.products where id=(select product from inv_ids)),0,'cancellation releases unconsumed earmark');
select lives_ok($$select public.assign_production_stock(product,10,assign_request) from inv_ids$$,'old earmark retry after cancellation returns its original receipt');
select is((select stock_reserved from public.products where id=(select product from inv_ids)),0,'retry after cancellation cannot reassign goods');
select is((select available from public.list_product_stock_summaries((select artist from inv_ids)) where product_id=(select product from inv_ids)),30,'cancellation returns capacity without undoing historical delivered stock');

-- Existing untracked orders become visible obligations at the opening count, without rewriting their snapshots.
create temp table opening_ids as select gen_random_uuid() product,gen_random_uuid() ep,gen_random_uuid() request,gen_random_uuid() assign_request;
insert into public.products(id,artist_id,name,price,is_unlimited,status) select o.product,i.artist,'Opening-count item',200,true,'enable' from opening_ids o,inv_ids i;
insert into public.event_products(id,event_id,product_id,artist_id,is_unlimited,is_enabled) select o.ep,i.event,o.product,i.artist,true,true from opening_ids o,inv_ids i;
create temp table opening_order as select order_id id from public.create_preorder_with_stock((select event from inv_ids),jsonb_build_array(jsonb_build_object('product_id',(select product from opening_ids),'quantity',20)), 'Legacy buyer','contact',p_customer_email=>'legacy@example.local');
update public.order_payments set payment_status='payment_confirmed' where order_id=(select id from opening_order);
update public.orders set status='confirmed',pickup_status='awaiting_pickup' where id=(select id from opening_order);
select lives_ok($$select public.start_stock_tracking(product,15,request) from opening_ids$$,'start physical tracking after unlimited event allocation');
select is((select stock_reserved from public.products where id=(select product from opening_ids)),15,'opening15 earmarks15 of legacy demand20');
select is((select inventory_source from public.order_items where order_id=(select id from opening_order)),'untracked','opening count retains historical order source');
select is(((public.inventory_overview((select artist from inv_ids))->0)->>'production_shortfall')::integer,0,'other product does not inherit shortfall');
select is((select (x->>'production_shortfall')::integer from jsonb_array_elements(public.inventory_overview((select artist from inv_ids))) x where x->>'product_id'=(select product::text from opening_ids)),5,'opening count shows remaining shortage5');
select throws_ok($$select public.stop_stock_tracking((select product from opening_ids))$$,'allocated_variant_stock_mode_locked','tracking cannot be disabled after allocation');
select lives_ok($$select public.start_stock_tracking(product,15,request) from opening_ids$$,'opening-count replay is idempotent');
select throws_ok($$select public.start_stock_tracking(product,16,request) from opening_ids$$,'stock_request_conflict','opening request cannot be replayed with another count');
select lives_ok($$select public.adjust_catalog_stock(product,5,'receive','received',gen_random_uuid()) from opening_ids$$,'receipt5 covers the remaining legacy shortfall');
select is((select stock_reserved from public.products where id=(select product from opening_ids)),20,'all20 now earmarked');
select lives_ok($$select * from public.mark_preorder_picked_up((select id from opening_order))$$,'legacy demand can be fulfilled after conversion');
select is((select stock_sold from public.products where id=(select product from opening_ids)),20,'converted legacy fulfillment consumes only its earmark');

-- Campaign production is independent of finite allocated stock and supports the real payment/ship RPCs.
create temp table campaign_ids as select gen_random_uuid() id,gen_random_uuid() request;
insert into public.online_campaigns(id,artist_id,name,slug,opens_at,closes_at,publication_status,shipping_enabled)
 select c.id,i.artist,'Production campaign','production-inventory-campaign',now()-interval '1 hour',now()+interval '1 day','published',true from campaign_ids c,inv_ids i;
insert into public.online_campaign_products(campaign_id,artist_id,product_id,is_enabled,is_unlimited,stock_total)
 select c.id,i.artist,i.product,true,false,0 from campaign_ids c,inv_ids i;
select lives_ok($$select public.configure_product_supply(i.product,null,c.id,'campaign','production',10) from inv_ids i,campaign_ids c$$,'campaign accepts production with zero physical allocation');
insert into public.campaign_payment_methods(campaign_id,artist_id,method_type,promptpay_id) select c.id,i.artist,'promptpay','0000000000' from campaign_ids c,inv_ids i;
create temp table campaign_order as select order_id id from public.create_online_campaign_order((select id from campaign_ids),jsonb_build_array(jsonb_build_object('product_id',(select product from inv_ids),'quantity',3)),'shipping',null,'Campaign buyer','campaign-buyer@example.local','0800000000','Local fixture address','',(select request from campaign_ids));
select is((select stock_reserved from public.online_campaign_products where campaign_id=(select id from campaign_ids)),0,'campaign production does not increment physical channel holds');
select is((select private.production_remaining(null,c.id,i.product,null) from campaign_ids c,inv_ids i),7,'campaign pending order counts toward cap');
update public.order_payments set payment_status='payment_submitted' where order_id=(select id from campaign_order);
select lives_ok($$select public.confirm_online_payment((select id from campaign_order))$$,'campaign confirmation earmarks stock');
select is((select stock_reserved from public.products where id=(select product from inv_ids)),0,'campaign confirmation keeps existing ready stock separate');
select lives_ok($$select public.assign_production_stock(product,3,gen_random_uuid()) from inv_ids$$,'merchant earmarks ready stock for campaign production');
select is((select stock_reserved from public.products where id=(select product from inv_ids)),3,'campaign explicit earmark owns3 physical units');
select lives_ok($$select public.mark_online_order_shipped((select id from campaign_order),'Test carrier','TRACK-LOCAL')$$,'ship campaign production');
select is((select stock_sold from public.online_campaign_products where campaign_id=(select id from campaign_ids)),0,'shipping never charges the physical channel for production');
select is((select stock_sold from public.products where id=(select product from inv_ids)),23,'shipping consumes3 centrally once');
select lives_ok($$select public.mark_online_order_shipped((select id from campaign_order),'Test carrier','TRACK-LOCAL')$$,'shipping replay is idempotent');
select is((select stock_sold from public.products where id=(select product from inv_ids)),23,'shipping replay does not consume twice');
select lives_ok($$select public.configure_product_supply(i.product,null,c.id,'campaign','stock',null) from inv_ids i,campaign_ids c$$,'future orders can switch back to stock');
select is((select inventory_source from public.order_items where order_id=(select id from campaign_order)),'production','policy change keeps existing order source');

-- Purchase and gift lines share the production cap, without claiming physical gift stock.
select public.configure_product_supply(product,event,null,'preorder','production',24) from inv_ids;
create temp table production_promo as select gen_random_uuid() id;
insert into public.artist_promotions(id,artist_id,name,target_type,rule_type,promotion_type,buy_quantity,reward_quantity,reward_selection_mode,lifecycle_status)
 select pp.id,i.artist,'Production gift','all','free_items','quantity_gift',1,1,'fixed','ready' from production_promo pp,inv_ids i;
insert into public.promotion_reward_products(promotion_id,product_id) select pp.id,i.product from production_promo pp,inv_ids i;
insert into public.promotion_assignments(artist_id,promotion_id,event_id,event_phase,combination_policy)
 select i.artist,pp.id,i.event,'preorder','combine' from production_promo pp,inv_ids i;
create temp table production_gift_order as select order_id id from public.create_preorder_with_stock((select event from inv_ids),jsonb_build_array(jsonb_build_object('product_id',(select product from inv_ids),'quantity',2)),'Gift buyer','contact',p_customer_email=>'gift@example.local');
select is((select sum(quantity)::integer from public.order_items where order_id=(select id from production_gift_order)),4,'purchase2 plus gift2 fit the last4 production places');
select is((select count(*)::integer from public.order_items where order_id=(select id from production_gift_order) and inventory_source='production'),2,'purchase and gift keep independent production snapshots');
select is((select stock_reserved from public.products where id=(select product from inv_ids)),0,'unpaid production gifts do not reserve physical units');
select is((select private.production_remaining(event,null,product,'preorder') from inv_ids),0,'production gift also uses the cap');
select lives_ok($$select * from public.cancel_public_preorder_before_payment((select id from production_gift_order),(select pickup_code from public.orders where id=(select id from production_gift_order)))$$,'cancel production purchase and gift together');
select is((select private.production_remaining(event,null,product,'preorder') from inv_ids),4,'cancelled production gifts release cap once');
-- The AFTER trigger checks a whole INSERT statement, not just one row at a time.
create temp table bulk_order as select gen_random_uuid() id;
insert into public.orders(id,event_id,order_type,status,customer_name,customer_contact,customer_email,currency,pickup_code)
 select b.id,i.event,'preorder','draft','Bulk fixture','local','bulk@example.local','THB','PRODUCTION-BULK' from bulk_order b,inv_ids i;
select throws_ok($$insert into public.order_items(order_id,product_id,event_product_id,quantity,price_per_unit,currency)
 select b.id,i.product,i.ep,3,200,'THB' from bulk_order b,inv_ids i cross join generate_series(1,2)$$,'production_limit_exceeded','bulk insert cannot evade total production cap');

select public.configure_product_supply(product,event,null,'postorder','production',2) from inv_ids;
insert into public.promotion_assignments(artist_id,promotion_id,event_id,event_phase,combination_policy)
 select i.artist,pp.id,i.event,'postorder','combine' from production_promo pp,inv_ids i;
select is((public.calculate_sale_promotions((select event from inv_ids),'postorder',null,jsonb_build_array(jsonb_build_object('product_id',(select product from inv_ids),'quantity',1)),'[]'::jsonb,'[]'::jsonb)->'reward_lines'->0->>'quantity')::integer,1,'inactive-phase preview uses its own production supply for gifts');
select public.configure_product_supply(product,event,null,'postorder','stock',null) from inv_ids;
select public.configure_product_supply(i.product,null,c.id,'campaign','production',6) from inv_ids i,campaign_ids c;
create temp table late_production as select order_id id from public.create_online_campaign_order((select id from campaign_ids),jsonb_build_array(jsonb_build_object('product_id',(select product from inv_ids),'quantity',3)),'shipping',null,'Late buyer','late@example.local','0800000000','Local fixture address','',gen_random_uuid());
update public.order_payments set payment_status='payment_expired' where order_id=(select id from late_production);
update public.orders set status='cancelled',pickup_status='expired' where id=(select id from late_production);
create temp table replacement_production as select order_id id from public.create_online_campaign_order((select id from campaign_ids),jsonb_build_array(jsonb_build_object('product_id',(select product from inv_ids),'quantity',3)),'shipping',null,'New buyer','new@example.local','0800000000','Local fixture address','',gen_random_uuid());
update public.order_payments set payment_status='payment_submitted_late' where order_id=(select id from late_production);
select throws_ok($$select public.accept_late_online_payment((select id from late_production),'reviewed late')$$,'production_limit_exceeded','late payment cannot reclaim production places from a newer order');
select is((select payment_status from public.order_payments where order_id=(select id from late_production)),'payment_submitted_late','failed late acceptance rolls back payment and inventory together');

-- Tracking may start after production orders were accepted while the catalog was untracked.
create temp table untracked_production as select gen_random_uuid() product,gen_random_uuid() request;
insert into public.products(id,artist_id,name,price,is_unlimited,status)
 select u.product,i.artist,'Untracked production',200,true,'enable' from untracked_production u,inv_ids i;
insert into public.online_campaign_products(campaign_id,artist_id,product_id,is_enabled,is_unlimited)
 select c.id,i.artist,u.product,true,true from untracked_production u,inv_ids i,campaign_ids c;
select public.configure_product_supply(u.product,null,c.id,'campaign','production',null) from untracked_production u,campaign_ids c;
create temp table untracked_production_order as select order_id id from public.create_online_campaign_order((select id from campaign_ids),jsonb_build_array(jsonb_build_object('product_id',(select product from untracked_production),'quantity',20)),'shipping',null,'Untracked production buyer','untracked@example.local','0800000000','Local fixture address','',gen_random_uuid());
update public.order_payments set payment_status='payment_submitted' where order_id=(select id from untracked_production_order);
select public.confirm_online_payment((select id from untracked_production_order));
select is((select stock_reserved from public.products where id=(select product from untracked_production)),0,'untracked production does not pretend to hold counted physical units');
select lives_ok($$select public.start_stock_tracking(product,50,request) from untracked_production$$,'opening50 after untracked production20');
select is((select stock_total from public.products where id=(select product from untracked_production)),50,'production demand is not subtracted from the physical opening count');
select is((select stock_reserved from public.products where id=(select product from untracked_production)),20,'opening earmarks the confirmed production20 once');
select is((select available from public.list_product_stock_summaries((select artist from inv_ids)) where product_id=(select product from untracked_production)),30,'opening50 leaves30 after production20');
create temp table budget_order as select order_id id from public.create_online_campaign_order((select id from campaign_ids),jsonb_build_array(jsonb_build_object('product_id',(select product from untracked_production),'quantity',40)),'shipping',null,'New production buyer','newproduction@example.local','0800000000','Local fixture address','',gen_random_uuid());
update public.order_payments set payment_status='payment_submitted' where order_id=(select id from budget_order);
select public.confirm_online_payment((select id from budget_order));
select is((select stock_reserved from public.products where id=(select product from untracked_production)),20,'paid production40 leaves the existing30 ready units untouched');
select lives_ok($$select public.adjust_catalog_stock(product,5,'receive','received',gen_random_uuid()) from untracked_production$$,'new receipt5 supplies only5 of production40');
select is((select stock_reserved from public.products where id=(select product from untracked_production)),25,'receipt earmarks only new5, not existing30');
select is((select available from public.list_product_stock_summaries((select artist from inv_ids)) where product_id=(select product from untracked_production)),30,'existing ready30 remains available after receipt5');
select lives_ok($$select public.assign_production_stock(product,30,gen_random_uuid()) from untracked_production$$,'merchant can explicitly move the ready30 to production');
select is((select stock_reserved from public.products where id=(select product from untracked_production)),55,'explicit move adds30 earmarked units');


-- Postorder stock remains allocated after the physical event ends.
update public.event_products set stock_total=10 where id=(select ep from inv_ids);
update public.events set start_date=now()-interval '2 days',end_date=now()-interval '1 day',postorder_enabled=true,
 postorder_opens_at=now()-interval '1 hour',postorder_closes_at=now()+interval '1 day',preorder_enabled=false where id=(select event from inv_ids);
select is((select available from public.list_product_stock_summaries((select artist from inv_ids)) where product_id=(select product from inv_ids)),17,'postorder keeps10 physically allocated, leaving17');
select is((select is_unlimited from public.list_event_products((select event from inv_ids)) where id=(select product from inv_ids)),false,'postorder uses stock by default despite preorder production policy');

-- A legacy Event without its own catalog cannot spend stock already assigned to another channel.
create temp table legacy_live_event as select gen_random_uuid() id;
insert into public.events(id,artist_id,event_name,status,start_date,end_date,is_booth_open)
 select l.id,i.artist,'Legacy live event','Confirmed',now()-interval '1 hour',now()+interval '1 hour',true from legacy_live_event l,inv_ids i;
select throws_ok($$select public.create_walkin_order_with_stock((select id from legacy_live_event),jsonb_build_array(jsonb_build_object('product_id',(select product from inv_ids),'quantity',18)),'cash',gen_random_uuid())$$,'insufficient_stock','legacy live checkout cannot take another channel allocation');

-- Untracked live orders have no online payment timer and cannot become production demand on conversion.
create temp table live_opening as select gen_random_uuid() product,gen_random_uuid() order_id;
insert into public.products(id,artist_id,name,price,is_unlimited,status) select l.product,i.artist,'Live opening',200,true,'enable' from live_opening l,inv_ids i;
insert into public.orders(id,event_id,order_type,status,currency) select l.order_id,e.id,'live_queue','draft','THB' from live_opening l,legacy_live_event e;
insert into public.order_items(order_id,product_id,quantity,price_per_unit,currency) select order_id,product,2,200,'THB' from live_opening;
select throws_ok($$select public.start_stock_tracking(product,5,gen_random_uuid()) from live_opening$$,'finish_open_live_orders_before_tracking','in-flight live orders must finish before opening count');
select is((select is_unlimited from public.products where id=(select product from live_opening)),true,'failed live conversion leaves tracking unchanged');
select is((select (x->>'open_live_orders')::integer from jsonb_array_elements(public.inventory_overview((select artist from inv_ids))) x where x->>'product_id'=(select product::text from live_opening)),1,'merchant sees the live-order conversion blocker');
update public.orders set status='cancelled' where id=(select order_id from live_opening);
select lives_ok($$select public.start_stock_tracking(product,5,gen_random_uuid()) from live_opening$$,'opening count works after live orders finish');

-- Visibility failures precede the optional supply-policy comparison.
update public.online_campaigns set publication_status='draft' where id=(select id from campaign_ids);
select set_config('request.jwt.claims','{}',true);
create function pg_temp.hidden_supply_error(expected text) returns text language plpgsql as $$
begin
 perform public.create_online_campaign_order((select id from campaign_ids),jsonb_build_array(jsonb_build_object('product_id',(select product from inv_ids),'quantity',1,'expected_supply_mode',expected)),'shipping',null,'Visibility fixture','visibility@example.local','0800000000','Local fixture address','',gen_random_uuid());
 return 'created';
exception when others then return sqlerrm;
end $$;
select isnt(pg_temp.hidden_supply_error('stock'),'created','hidden campaign rejects checkout before any policy disclosure');
select is(pg_temp.hidden_supply_error('stock'),pg_temp.hidden_supply_error('production'),'hidden policy cannot be inferred from different error responses');

select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'email','unrelated@example.local','role','authenticated')::text,true);
select throws_ok($$select public.inventory_overview((select artist from inv_ids))$$,'forbidden','other shop cannot read inventory breakdown');
select throws_ok($$select public.configure_product_supply(product,event,null,'preorder','production',null) from inv_ids$$,'forbidden','other shop cannot change supply');
select throws_ok($$select public.start_stock_tracking(product,50,gen_random_uuid()) from opening_ids$$,'forbidden','other shop cannot initialize stock');
select ok(not has_function_privilege('anon','public.start_stock_tracking(uuid,integer,uuid)','execute'),'anonymous cannot initialize stock');
select throws_ok($$select public.assign_production_stock(product,1,gen_random_uuid()) from inv_ids$$,'forbidden','other shop cannot earmark physical units');
select ok(not has_function_privilege('anon','public.assign_production_stock(uuid,integer,uuid)','execute'),'anonymous cannot earmark stock');
select ok(not has_function_privilege('authenticated','private.refresh_production_stock(uuid,integer)','execute'),'internal stock reconciliation is not callable by clients');

select * from finish();
rollback;
