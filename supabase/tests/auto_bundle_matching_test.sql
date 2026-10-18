begin;
select no_plan();

create temp table ids as select
  gen_random_uuid() artist,gen_random_uuid() owner,gen_random_uuid() event,
  gen_random_uuid() preorder_event,gen_random_uuid() campaign,
  gen_random_uuid() a,gen_random_uuid() b,gen_random_uuid() c;
insert into auth.users(id,email) select owner,'auto-bundle-owner@example.local' from ids;
insert into auth.users(id,email) select artist,'auto-bundle-shop@example.local' from ids;
insert into public.artists(id,slug,display_name,is_public,is_verified,published_at)
select artist,'auto-bundle-test','Auto bundles',true,true,now() from ids;
insert into public.artist_members(artist_id,member_email,role,status)
select artist,'auto-bundle-owner@example.local','owner','active' from ids;
select set_config('request.jwt.claims',jsonb_build_object('sub',owner,'email','auto-bundle-owner@example.local','role','authenticated')::text,true) from ids;

insert into public.products(id,artist_id,name,sku,price,is_unlimited,stock_total,status)
select a,artist,'A','EDITABLE-A',100,false,100,'enable' from ids union all
select b,artist,'B','EDITABLE-B',50,false,100,'enable' from ids union all
select c,artist,'C','EDITABLE-C',40,false,100,'enable' from ids;

create temp table bundle_parents(name text primary key,id uuid);
insert into bundle_parents values
('best',(select public.save_product_bundle(jsonb_build_object('artist_id',artist,'name','Best AB','base_price',100,'currency','THB','auto_bundle_enabled',true),jsonb_build_array(jsonb_build_object('product_id',a,'quantity',1),jsonb_build_object('product_id',b,'quantity',1))) from ids)),
('tie',(select public.save_product_bundle(jsonb_build_object('artist_id',artist,'name','Tie AB','base_price',100,'currency','THB','auto_bundle_enabled',true),jsonb_build_array(jsonb_build_object('product_id',a,'quantity',1),jsonb_build_object('product_id',b,'quantity',1))) from ids)),
('single',(select public.save_product_bundle(jsonb_build_object('artist_id',artist,'name','Single A','base_price',80,'currency','THB','auto_bundle_enabled',true),jsonb_build_array(jsonb_build_object('product_id',a,'quantity',1))) from ids)),
('expensive',(select public.save_product_bundle(jsonb_build_object('artist_id',artist,'name','Expensive C','base_price',60,'currency','THB','auto_bundle_enabled',true),jsonb_build_array(jsonb_build_object('product_id',c,'quantity',1))) from ids)),
('optout',(select public.save_product_bundle(jsonb_build_object('artist_id',artist,'name','Opt-out C','base_price',20,'currency','THB','auto_bundle_enabled',false),jsonb_build_array(jsonb_build_object('product_id',c,'quantity',1))) from ids)),
('policy',(select public.save_product_bundle(jsonb_build_object('artist_id',artist,'name','Policy C','base_price',20,'currency','THB','auto_bundle_enabled',false),jsonb_build_array(jsonb_build_object('product_id',c,'quantity',1))) from ids));
create temp table bundles as
select bp.name,p.id from bundle_parents bp join public.products p on p.parent_product_id=bp.id and p.deleted_at is null;
create temp table winning_bundle as select id from bundles where name in ('best','tie') order by id limit 1;

select is((select auto_bundle_enabled from public.product_parents where id=(select id from bundle_parents where name='best')),true,'bundle save persists explicit auto-match opt-in');
select is((select auto_bundle_enabled from public.product_parents where id=(select id from bundle_parents where name='optout')),false,'existing/default behavior remains opt-out');
select ok(not has_function_privilege('authenticated','private.normalize_sale_bundle_items(uuid,text,uuid,jsonb)','execute'),'normalizer is not directly exposed to authenticated clients');

insert into public.events(id,artist_id,event_name,start_date,end_date,status,is_booth_open,preorder_enabled,preorder_opens_at,preorder_closes_at)
select event,artist,'Live auto bundle',now()-interval '1 hour',now()+interval '1 day','Confirmed',true,false,null,null from ids union all
select preorder_event,artist,'Preorder auto bundle',now()+interval '2 days',now()+interval '3 days','Confirmed',false,true,now()-interval '1 day',now()+interval '1 day' from ids;

insert into public.event_products(event_id,product_id,artist_id,price_override,is_unlimited,stock_total,is_enabled,is_sellable)
select e.id,p.id,i.artist,p.price,false,20,true,true
from ids i cross join lateral (values(i.event),(i.preorder_event)) e(id)
cross join public.products p
where p.artist_id=i.artist and p.product_kind<>'bundle' and p.deleted_at is null;
insert into public.event_products(event_id,product_id,artist_id,price_override,is_unlimited,stock_total,is_enabled,is_sellable)
select e.id,b.id,i.artist,p.base_price,true,null,true,true
from ids i cross join lateral (values(i.event),(i.preorder_event)) e(id)
cross join bundles b join bundle_parents bp on bp.name=b.name join public.product_parents p on p.id=bp.id;

create temp table first_match as
select private.normalize_sale_bundle_items(i.event,'live',null,
  jsonb_build_array(jsonb_build_object('product_id',i.a,'quantity',1),jsonb_build_object('product_id',i.b,'quantity',1))) result
from ids i;
select is((select result->'items'->0->>'product_id' from first_match),(select id::text from winning_bundle),'greatest per-set saving wins before an overlapping recipe');
select is((select (result->'items'->0->>'quantity')::integer from first_match),1,'matched component units are consumed exactly once');
select is((select result->'auto_sets'->0->>'bundle_product_id' from first_match),(select id::text from winning_bundle),'equal-saving recipes use the lowest bundle UUID as a deterministic tie-breaker');
select is((select result->'auto_sets'->0->>'bundle_name' from first_match),(select name from public.products where id=(select id from winning_bundle)),'display metadata names the auto-created set');
select is((select (result->'auto_sets'->0->>'unit_savings')::numeric from first_match),50::numeric,'display metadata records effective channel saving');

create temp table split_match as
select private.normalize_sale_bundle_items(i.event,'live',null,
  jsonb_build_array(jsonb_build_object('product_id',i.a,'quantity',2),jsonb_build_object('product_id',i.b,'quantity',1))) result
from ids i;
select is((select jsonb_array_length(result->'items') from split_match),2,'remaining units may form the next-best non-overlapping recipe');
select is((select sum((x->>'quantity')::integer) from split_match,jsonb_array_elements(result->'auto_sets') x),2::bigint,'no component unit is reused across matched sets');

create temp table no_match as
select private.normalize_sale_bundle_items(i.event,'live',null,
  jsonb_build_array(jsonb_build_object('product_id',i.c,'quantity',1))) result from ids i;
select is((select result->'items'->0->>'product_id' from no_match),(select c::text from ids),'price-increasing and opt-out bundles do not replace a loose item');
select is((select jsonb_array_length(result->'auto_sets') from no_match),0,'no display set is emitted when every eligible recipe is rejected');

select throws_ok($$select private.normalize_sale_bundle_items((select event from ids),'live',null,jsonb_build_array(jsonb_build_object('product_id',(select a from ids),'quantity',1),jsonb_build_object('product_id',(select a from ids),'quantity',1)))$$,'promotion_duplicate_product','duplicate raw products are rejected before matching');
select throws_ok($$select private.normalize_sale_bundle_items((select event from ids),'live',null,jsonb_build_array(jsonb_build_object('product_id',(select a from ids),'quantity',0)))$$,'promotion_quantity_invalid','invalid raw quantities are rejected before matching');
select throws_ok($$select private.normalize_sale_bundle_items((select event from ids),'live',null,jsonb_build_array(jsonb_build_object('product_id',gen_random_uuid(),'quantity',1)))$$,'sale_product_unavailable','unknown raw products are rejected before matching');

update public.products set sku='SKU-CAN-CHANGE' where id=(select a from ids);
select is((private.normalize_sale_bundle_items((select event from ids),'live',null,jsonb_build_array(jsonb_build_object('product_id',(select a from ids),'quantity',1),jsonb_build_object('product_id',(select b from ids),'quantity',1)))->'items'->0->>'product_id'),(select id::text from winning_bundle),'matching identity uses product UUIDs rather than editable SKU text');

-- A different supply policy would change fulfillment semantics, so it cannot auto-match.
update public.product_parents set auto_bundle_enabled=true where id=(select id from bundle_parents where name='policy');
select public.configure_product_supply((select id from bundles where name='policy'),(select preorder_event from ids),null,'preorder','production',10);
select is((private.normalize_sale_bundle_items((select preorder_event from ids),'preorder',null,jsonb_build_array(jsonb_build_object('product_id',(select c from ids),'quantity',1)))->'items'->0->>'product_id'),(select c::text from ids),'stock components are not converted into a production bundle');

-- Real persistence boundaries store the real bundle SKU, activating existing snapshots and stock accounting.
create temp table walkin as select public.create_walkin_order_with_stock(i.event,
  jsonb_build_array(jsonb_build_object('product_id',i.a,'quantity',1),jsonb_build_object('product_id',i.b,'quantity',1)),
  'cash',gen_random_uuid()) id from ids i;
select is((select product_id from public.order_items where order_id=(select id from walkin) and line_type='purchase'),(select id from winning_bundle),'walk-in POS persists the canonical bundle SKU');
select is((select count(*) from private.bundle_order_components boc join public.order_items oi on oi.id=boc.order_item_id where oi.order_id=(select id from walkin)),2::bigint,'walk-in order snapshots the matched recipe components');

create temp table q as select gen_random_uuid() id;
insert into public.queues(id,event_id,artist_id,queue_number,queue_service_date,status)
select q.id,i.event,i.artist,991,(now() at time zone 'Asia/Bangkok')::date,'waiting' from q,ids i;
create temp table queue_order as select public.create_customer_order_with_stock(q.id,
  jsonb_build_array(jsonb_build_object('product_id',i.a,'quantity',1),jsonb_build_object('product_id',i.b,'quantity',1)),gen_random_uuid()) id from q,ids i;
select is((select product_id from public.order_items where order_id=(select id from queue_order) and line_type='purchase'),(select id from winning_bundle),'queue cart persistence stores the canonical bundle SKU');

insert into public.online_campaigns(id,artist_id,name,slug,opens_at,closes_at,publication_status,shipping_enabled)
select campaign,artist,'Auto bundle campaign','auto-bundle-campaign',now()-interval '1 hour',now()+interval '1 day','published',true from ids;
insert into public.campaign_payment_methods(campaign_id,artist_id,method_type,promptpay_id)
select campaign,artist,'promptpay','0000000000' from ids;
insert into public.online_campaign_products(campaign_id,artist_id,product_id,price_override,is_enabled,is_sellable,is_unlimited,stock_total)
select i.campaign,i.artist,p.id,p.price,true,true,false,20 from ids i cross join public.products p where p.artist_id=i.artist and p.product_kind<>'bundle' and p.deleted_at is null;
insert into public.online_campaign_products(campaign_id,artist_id,product_id,price_override,is_enabled,is_sellable,is_unlimited,stock_total)
select i.campaign,i.artist,b.id,p.base_price,true,true,true,null from ids i cross join bundles b join bundle_parents bp on bp.name=b.name join public.product_parents p on p.id=bp.id;
create temp table campaign_order as select order_id id from public.create_online_campaign_order((select campaign from ids),
  jsonb_build_array(jsonb_build_object('product_id',(select a from ids),'quantity',1),jsonb_build_object('product_id',(select b from ids),'quantity',1)),
  'shipping',null,'Buyer','buyer@example.local','0800000000','Local test address','',gen_random_uuid());
select is((select product_id from public.order_items where order_id=(select id from campaign_order) and line_type='purchase'),(select id from winning_bundle),'Campaign checkout persists the same canonical bundle SKU');


select is(jsonb_array_length(private.normalize_sale_bundle_items((select event from ids),'live',null,
 jsonb_build_array(jsonb_build_object('product_id',(select a from ids),'quantity',1,'notes','Keep this note'),jsonb_build_object('product_id',(select b from ids),'quantity',1)))->'auto_sets'),0,'item notes prevent automatic matching rather than being lost');

create temp table v1_offer as select gen_random_uuid() id;
insert into public.artist_promotions(id,artist_id,name,target_type,match_product_ids,rule_type,promotion_type,lifecycle_status,v1_config)
select o.id,i.artist,'Bundle discount and gift','product',array[w.id],'free_items','condition_reward','ready',jsonb_build_object('version',1,'condition',jsonb_build_object('kind','product','items',jsonb_build_array(jsonb_build_object('product_id',w.id,'quantity',1))),'discount',jsonb_build_object('kind','fixed','value',20),'gift',jsonb_build_object('product_id',i.c,'quantity',1,'limit',1)) from v1_offer o,ids i,winning_bundle w;
insert into public.promotion_assignments(promotion_id,artist_id,event_id,event_phase,combination_policy) select o.id,i.artist,i.event,'live','combine' from v1_offer o,ids i;
insert into public.promotion_reward_products(promotion_id,product_id) select o.id,i.c from v1_offer o,ids i;
create temp table v1_quote as select public.quote_sale_promotions(i.event,'live',null,jsonb_build_array(jsonb_build_object('product_id',i.a,'quantity',1),jsonb_build_object('product_id',i.b,'quantity',1)),'[]','[]') result from ids i;
select is((select result->>'total' from v1_quote),'80','downstream conditions see the auto-matched bundle SKU and its own price');
select is((select result->'reward_lines'->0->>'quantity' from v1_quote),'1','auto-created bundle also earns its fixed gift');
select is((select result->>'pricing_hash' from v1_quote),(select public.quote_sale_promotions(i.event,'live',null,jsonb_build_array(jsonb_build_object('product_id',w.id,'quantity',1)),'[]','[]')->>'pricing_hash' from ids i,winning_bundle w),'loose and explicit set have identical authoritative pricing hashes');
create temp table v1_paid as select public.create_walkin_order_with_stock(i.event,jsonb_build_array(jsonb_build_object('product_id',i.a,'quantity',1),jsonb_build_object('product_id',i.b,'quantity',1)),'cash',gen_random_uuid(),'[]','[]',(select result->>'pricing_hash' from v1_quote)) id from ids i;
select is((select total_price from public.orders where id=(select id from v1_paid)),80::numeric,'real POS checkout matches the previewed bundle and promotion total');
select is((select count(*) from public.order_items where order_id=(select id from v1_paid) and line_type='purchase' and product_id=(select id from winning_bundle)),1::bigint,'paid order retains a real bundle purchase line');
select is((select price_per_unit from public.order_items where order_id=(select id from v1_paid) and line_type='promotion_reward'),0::numeric,'gift SKU remains a zero-price line');
select is((select redeemed from private.promotion_gift_commitments where order_id=(select id from v1_paid)),true,'POS completion permanently redeems its global gift right');

-- The last component cannot be promised again as a fixed gift.
update public.artist_promotions set v1_config=jsonb_set(jsonb_set(v1_config,'{gift,product_id}',to_jsonb((select a::text from ids))),'{gift,limit}','null') where id=(select id from v1_offer);
update public.promotion_reward_products set product_id=(select a from ids) where promotion_id=(select id from v1_offer);
update public.event_products set stock_total=stock_reserved+stock_sold+1 where event_id=(select event from ids) and product_id in((select a from ids),(select b from ids));
update v1_quote set result=(select public.quote_sale_promotions(i.event,'live',null,jsonb_build_array(jsonb_build_object('product_id',i.a,'quantity',1),jsonb_build_object('product_id',i.b,'quantity',1)),'[]','[]') from ids i);
select is((select result->>'discount_total' from v1_quote),'20','gift component shortage retains the discount');
select is((select jsonb_array_length(result->'reward_lines') from v1_quote),0,'purchased bundle consumes the last component before gift availability');
select lives_ok($$select public.create_walkin_order_with_stock(i.event,jsonb_build_array(jsonb_build_object('product_id',i.a,'quantity',1),jsonb_build_object('product_id',i.b,'quantity',1)),'cash',gen_random_uuid(),'[]','[]',(select result->>'pricing_hash' from v1_quote)) from ids i$$,'last-component sale succeeds without an over-promised gift');

-- An existing loose cart keeps its own final units when matching is enabled later.
update public.product_parents set auto_bundle_enabled=false where id in(select id from bundle_parents where name in ('best','tie','single'));
update public.event_products set stock_total=stock_reserved+stock_sold+1 where event_id=(select event from ids) and product_id in((select a from ids),(select b from ids));
create temp table held_q as select gen_random_uuid() id;
insert into public.queues(id,event_id,artist_id,queue_number,queue_service_date,status)
select held_q.id,i.event,i.artist,992,(now() at time zone 'Asia/Bangkok')::date,'serving' from held_q,ids i;
create temp table held_order as select public.create_customer_order_with_stock(q.id,jsonb_build_array(jsonb_build_object('product_id',i.a,'quantity',1),jsonb_build_object('product_id',i.b,'quantity',1)),gen_random_uuid()) id from held_q q,ids i;
update public.product_parents set auto_bundle_enabled=true where id in(select id from bundle_parents where name in ('best','tie','single'));
create temp table held_quote as select public.quote_pos_order(i.event,o.id,jsonb_build_array(jsonb_build_object('product_id',i.a,'quantity',1),jsonb_build_object('product_id',i.b,'quantity',1))) result from ids i,held_order o;
select is((select result->>'total' from held_quote),'80','existing loose holds remain available to the auto-set quote');
select lives_ok($$select public.complete_order_with_stock(o.id,'cash',(select payment_idempotency_key from public.orders where id=o.id),'[]','[]',(select result->>'pricing_hash' from held_quote),false) from held_order o$$,'existing loose cart converts and pays using its own last units');
select is((select product_id from public.order_items where order_id=(select id from held_order) and line_type='purchase'),(select id from winning_bundle),'converted held cart persists the canonical bundle');

select * from finish();
rollback;
