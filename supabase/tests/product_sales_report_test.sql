begin;
select no_plan();

create temp table report_ids as
select
  gen_random_uuid() artist,
  gen_random_uuid() manager,
  gen_random_uuid() seller,
  gen_random_uuid() queue_staff,
  gen_random_uuid() outsider,
  gen_random_uuid() event,
  gen_random_uuid() parent,
  gen_random_uuid() variant_a,
  gen_random_uuid() variant_b,
  gen_random_uuid() order_one,
  gen_random_uuid() order_two,
  gen_random_uuid() penny_order,
  gen_random_uuid() cancelled_order,
  gen_random_uuid() old_order;

insert into auth.users(id,email)
select artist,'sales-report-owner@example.local' from report_ids union all
select manager,'sales-report-manager@example.local' from report_ids union all
select seller,'sales-report-seller@example.local' from report_ids union all
select queue_staff,'sales-report-queue@example.local' from report_ids union all
select outsider,'sales-report-outsider@example.local' from report_ids;

insert into public.artists(id,slug,display_name,is_public,is_verified,published_at)
select artist,'sales-report-fixture','Sales report fixture',true,true,now() from report_ids;

insert into public.artist_members(artist_id,member_email,role,status)
select artist,'sales-report-owner@example.local','owner','active' from report_ids union all
select artist,'sales-report-manager@example.local','manager','active' from report_ids union all
select artist,'sales-report-seller@example.local','seller','active' from report_ids union all
select artist,'sales-report-queue@example.local','queue_staff','active' from report_ids;

insert into public.events(id,artist_id,event_name,start_date,end_date,event_timezone,status)
select event,artist,'Sales report event','2026-10-16 00:00+00','2026-10-20 00:00+00','Asia/Bangkok','Confirmed'
from report_ids;

insert into public.product_parents(id,artist_id,name,category,image_url,base_price)
select parent,artist,'Current renamed parent','Print','report-cover.jpg',100 from report_ids;

insert into public.products(
  id,artist_id,parent_product_id,name,variant_name,variant_group_name,sku,price,category,status,is_unlimited
)
select variant_a,artist,parent,'Current renamed parent — New A','New A','Current renamed parent','CURRENT-A',100,'Print','enable',true from report_ids
union all
select variant_b,artist,parent,'Current renamed parent — New B','New B','Current renamed parent','CURRENT-B',200,'Print','enable',true from report_ids;

insert into public.orders(id,event_id,status,total_price,subtotal_price,discount_total,currency,created_at)
select order_one,event,'completed',270,300,30,'THB','2026-10-17 03:00+00'::timestamptz from report_ids union all
select order_two,event,'completed',270,300,30,'THB','2026-10-17 05:00+00'::timestamptz from report_ids union all
select penny_order,event,'completed',1.99,2,0.01,'THB','2026-10-19 03:00+00'::timestamptz from report_ids union all
select cancelled_order,event,'cancelled',999,999,0,'THB','2026-10-17 06:00+00'::timestamptz from report_ids union all
select old_order,event,'completed',100,100,0,'THB','2026-10-15 16:59+00'::timestamptz from report_ids;

insert into public.order_items(order_id,product_id,quantity,price_per_unit,currency,product_name_snapshot,sku_snapshot)
select order_one,variant_a,1,100,'THB','Original parent — Option A','OLD-A' from report_ids union all
select order_one,variant_b,1,200,'THB','Original parent — Option B','OLD-B' from report_ids union all
select order_two,variant_a,3,100,'THB','Original parent — Option A','OLD-A' from report_ids union all
select penny_order,variant_a,1,1,'THB','Original parent — Option A','OLD-A' from report_ids union all
select penny_order,variant_b,1,1,'THB','Original parent — Option B','OLD-B' from report_ids union all
select cancelled_order,variant_a,9,111,'THB','Original parent — Option A','OLD-A' from report_ids union all
select old_order,variant_a,1,100,'THB','Original parent — Option A','OLD-A' from report_ids;

select set_config('request.jwt.claims',jsonb_build_object('sub',artist,'email','sales-report-owner@example.local','role','authenticated')::text,true)
from report_ids;

select is(
  (public.get_event_product_sales_report((select event from report_ids),'2026-10-17','2026-10-17',null,null,'net','desc',1,20)->>'total_count')::integer,
  1,
  'variants are grouped into one product family'
);

select is(
  (public.get_event_product_sales_report((select event from report_ids),'2026-10-17','2026-10-17',null,null,'net','desc',1,20)#>>'{rows,0,name}'),
  'Original parent',
  'product heading comes from the saved sale name after a catalog rename'
);

select is(
  (public.get_event_product_sales_report((select event from report_ids),'2026-10-17','2026-10-17',null,null,'net','desc',1,20)#>>'{rows,0,quantity}')::integer,
  5,
  'multiple orders and multi-quantity lines aggregate exact units without parent duplication'
);

select is(
  (public.get_event_product_sales_report((select event from report_ids),'2026-10-17','2026-10-17',null,null,'net','desc',1,20)#>>'{rows,0,gross}')::numeric,
  600::numeric,
  'gross uses saved unit prices and excludes cancelled orders'
);

select is(
  (public.get_event_product_sales_report((select event from report_ids),'2026-10-17','2026-10-17',null,null,'net','desc',1,20)#>>'{rows,0,discount}')::numeric,
  60::numeric,
  'order discounts are allocated to items and reconcile exactly'
);

select is(
  (public.get_event_product_sales_report((select event from report_ids),'2026-10-17','2026-10-17',null,null,'net','desc',1,20)#>>'{rows,0,net}')::numeric,
  540::numeric,
  'net equals gross less allocated discount'
);

select is(
  jsonb_array_length(public.get_event_product_sales_report((select event from report_ids),'2026-10-17','2026-10-17',null,null,'net','desc',1,20)#>'{rows,0,variants}'),
  2,
  'variant rows remain separate beneath the family total'
);

select is(
  (public.get_event_product_sales_report((select event from report_ids),'2026-10-17','2026-10-17',null,null,'net','desc',1,20)#>>'{rows,0,variants,0,variant_name}'),
  'Option A',
  'variant label comes from the saved sale name after a catalog rename'
);

select is(
  (select sum((item->>'quantity')::integer)
   from jsonb_array_elements(public.get_event_product_sales_report((select event from report_ids),'2026-10-17','2026-10-17',null,null,'net','desc',1,20)#>'{rows,0,variants}') item),
  5::bigint,
  'variant quantities reconcile to the parent quantity'
);

select is(
  (public.get_event_product_sales_report((select event from report_ids),'2026-10-17','2026-10-17','old-b',null,'net','desc',1,20)->>'total_count')::integer,
  1,
  'search uses the SKU snapshot stored at sale time'
);

select is(
  (public.get_event_product_sales_report((select event from report_ids),'2026-10-18','2026-10-18',null,null,'net','desc',1,20)->>'total_count')::integer,
  0,
  'Bangkok date boundaries exclude sales outside the selected local day'
);

select is(
  (public.get_event_product_sales_report((select event from report_ids),'2026-10-19','2026-10-19',null,null,'net','desc',1,20)#>>'{rows,0,discount}')::numeric,
  0.01::numeric,
  'fractional proportional allocation keeps the order-level rounding residual exact'
);

select is(
  (public.get_event_product_sales_report((select event from report_ids),'2026-10-17','2026-10-17','%',null,'net','desc',1,20)->>'total_count')::integer,
  0,
  'search treats wildcard characters as literal text'
);

select is(
  public.get_event_product_sales_report((select event from report_ids),'2026-10-17','2026-10-17',null,null,'net','desc',1,20)#>'{rows,0,refund}',
  'null'::jsonb,
  'item refund amount stays unavailable instead of inventing an allocation'
);

-- A large number of tiny lines cannot concentrate a negative rounding residual.
create temp table tiny_order as select gen_random_uuid() id;
insert into public.orders(id,event_id,status,total_price,subtotal_price,discount_total,currency,created_at)
select t.id,r.event,'completed',0.5,1,0.5,'THB','2026-10-20 03:00+00' from tiny_order t,report_ids r;
insert into public.order_items(order_id,product_id,quantity,price_per_unit,currency)
select t.id,r.variant_a,1,0.01,'THB' from tiny_order t,report_ids r,generate_series(1,100);
select is((public.get_event_product_sales_report((select event from report_ids),'2026-10-20','2026-10-20')#>>'{rows,0,discount}')::numeric,0.5::numeric,'100 tiny lines allocate exactly50 cents');
select is((public.get_event_product_sales_report((select event from report_ids),'2026-10-20','2026-10-20')#>>'{rows,0,net}')::numeric,0.5::numeric,'tiny-line net remains nonnegative and reconciles');
-- A renamed SKU can have sales in different currencies over its lifetime.
create temp table currency_orders as select gen_random_uuid() id,currency,amount from (values ('THB',100::numeric),('USD',3::numeric)) v(currency,amount);
insert into public.orders(id,event_id,status,total_price,subtotal_price,discount_total,currency,created_at)
select c.id,r.event,'completed',c.amount,c.amount,0,c.currency,'2026-10-21 03:00+00' from currency_orders c,report_ids r;
insert into public.order_items(order_id,product_id,quantity,price_per_unit,currency)
select c.id,r.variant_a,1,c.amount,c.currency from currency_orders c,report_ids r;
select is((public.get_event_product_sales_report((select event from report_ids),'2026-10-21','2026-10-21')->>'total_count')::integer,2,'different currencies are separate rows and never added together');
select is((public.get_event_sales_analytics((select event from report_ids),'2026-10-17','2026-10-17')->>'revenue')::numeric,540::numeric,'dashboard and product report reconcile net revenue');
select is((public.get_event_sales_analytics((select event from report_ids),'2026-10-17','2026-10-17')->>'itemCount')::integer,5,'dashboard counts actual sold units without join duplication');
select is((public.get_event_sales_analytics((select event from report_ids),'2026-10-21','2026-10-21','USD')->>'revenue')::numeric,3::numeric,'dashboard selects one currency instead of adding unlike amounts');
select is((public.get_event_product_sales_report((select event from report_ids),'2026-10-21','2026-10-21',p_currency=>'USD')#>>'{rows,0,net}')::numeric,3::numeric,'product currency matches dashboard selection');
-- Regression for the Data API's usual1000-row result limit.
create temp table many_orders as select gen_random_uuid() id from generate_series(1,1005);
insert into public.orders(id,event_id,status,total_price,subtotal_price,currency,created_at)
select m.id,r.event,'completed',2,2,'THB','2026-10-22 03:00+00' from many_orders m,report_ids r;
insert into public.order_items(order_id,product_id,quantity,price_per_unit,currency)
select m.id,r.variant_a,1,2,'THB' from many_orders m,report_ids r;
select is((public.get_event_sales_analytics((select event from report_ids),'2026-10-22','2026-10-22')->>'completedOrderCount')::integer,1005,'dashboard includes orders beyond the API row limit');
select is((public.get_event_sales_analytics((select event from report_ids),'2026-10-22','2026-10-22')->>'revenue')::numeric,2010::numeric,'large-event revenue is not silently truncated');
select is((public.get_event_product_sales_report((select event from report_ids),'2026-10-22','2026-10-22')#>>'{rows,0,net}')::numeric,2010::numeric,'large product report reconciles against server summary');
-- Promotion reporting counts orders, never item lines or proportional discounts.
update public.orders set pricing_breakdown='[
 {"id":"historical-offer","name":"Original offer","discount_amount":10},
 {"id":"historical-offer","name":"Original offer","discount_amount":20},
 null, "not a promotion"
]'::jsonb where id=(select order_one from report_ids);
update public.orders set pricing_breakdown='[
 {"id":"historical-offer","name":"Saved newer name","discount_amount":30,"rewards":[{"quantity":3}],"activity_reward":{"quantity":2}},
 {"id":"activity-only","name":"Activity only","discount_amount":0,"activity_reward":{"quantity":1}}
]'::jsonb where id=(select order_two from report_ids);
update public.orders set pricing_breakdown='[{"id":"historical-offer","name":"Cancelled offer","discount_amount":999}]'::jsonb
where id=(select cancelled_order from report_ids);
create temp table promotion_report as select public.get_event_sales_analytics((select event from report_ids),'2026-10-17','2026-10-17')->'promotionSummary' data;
select is((select jsonb_array_length(data->'rows') from promotion_report),2,'only saved completed promotions are reported, including zero-discount activities');
select is((select data#>>'{rows,0,name}' from promotion_report),'Saved newer name','latest saved name is used without consulting current promotion definitions');
select is((select (data#>>'{rows,0,order_count}')::int from promotion_report),2,'repeated snapshot entries count once per order and do not multiply by items');
select is((select (data#>>'{rows,0,discount_total}')::numeric from promotion_report),60::numeric,'only this promotion snapshot discount is aggregated');
select is((select (data#>>'{rows,0,gift_units}')::numeric from promotion_report),3::numeric,'gift quantities remain separate from monetary discounts');
select is((select (data#>>'{rows,0,activity_units}')::numeric from promotion_report),2::numeric,'activity quantities remain separate from monetary discounts');
select is((select (data->>'unattributedDiscount')::numeric from promotion_report),0::numeric,'complete snapshot discounts reconcile to recorded order discounts');
select is((public.get_event_sales_analytics((select event from report_ids),'2026-10-19','2026-10-19')#>>'{promotionSummary,unattributedDiscount}')::numeric,0.01::numeric,'old order discounts without promotion details are explicitly unattributed');
select is(jsonb_array_length(public.get_event_sales_analytics((select event from report_ids),'2026-10-21','2026-10-21','USD')#>'{promotionSummary,rows}'),0,'date and currency filters apply to promotion usage too');
select is(jsonb_array_length(public.get_event_sales_analytics((select event from report_ids),'2025-01-01','2025-01-01')#>'{promotionSummary,rows}'),0,'no sales returns an empty promotion summary');
select is((public.get_event_sales_analytics((select event from report_ids),'2026-10-17','2026-10-17')->>'revenue')::numeric,540::numeric,'promotion summary does not change actual revenue');

-- Legacy camelCase snapshots remain readable without current rule rows.
update public.orders set pricing_breakdown='[{"ruleId":"legacy-rule","label":"Legacy saved offer","discountAmount":0.01,"bundleCount":2}]'::jsonb
where id=(select penny_order from report_ids);
select is(public.get_event_sales_analytics((select event from report_ids),'2026-10-19','2026-10-19')#>>'{promotionSummary,rows,0,name}','Legacy saved offer','legacy promotion label is preserved');
select is((public.get_event_sales_analytics((select event from report_ids),'2026-10-19','2026-10-19')#>>'{promotionSummary,rows,0,discount_total}')::numeric,0.01::numeric,'legacy discountAmount contributes exact recorded discount');
select is((public.get_event_sales_analytics((select event from report_ids),'2026-10-19','2026-10-19')#>>'{promotionSummary,rows,0,order_count}')::int,1,'repeat bundleCount still counts as one order');
-- Opposite differences must not hide each other across orders.
update public.orders set discount_total=20 where id=(select order_one from report_ids);
update public.orders set discount_total=40 where id=(select order_two from report_ids);
select is((public.get_event_sales_analytics((select event from report_ids),'2026-10-17','2026-10-17')#>>'{promotionSummary,unattributedDiscount}')::numeric,10::numeric,'missing details reconcile within each order, never offset against another order');
select is((public.get_event_sales_analytics((select event from report_ids),'2026-10-17','2026-10-17')#>>'{promotionSummary,discountMismatch}')::boolean,true,'one excess snapshot is flagged even when period totals match');
update public.orders set discount_total=30 where id in (select order_one from report_ids union all select order_two from report_ids);

select set_config('request.jwt.claims',jsonb_build_object('sub',manager,'email','sales-report-manager@example.local','role','authenticated')::text,true)
from report_ids;
select lives_ok(
  format('select public.get_event_product_sales_report(%L,null,null,null,null,%L,%L,1,20)',(select event from report_ids),'name','asc'),
  'assigned manager may read the event sales report'
);

select set_config('request.jwt.claims',jsonb_build_object('sub',seller,'email','sales-report-seller@example.local','role','authenticated')::text,true)
from report_ids;
select throws_ok(
  format('select public.get_event_product_sales_report(%L,null,null,null,null,%L,%L,1,20)',(select event from report_ids),'net','desc'),
  'forbidden',
  'seller cannot read the management sales report'
);

select set_config('request.jwt.claims',jsonb_build_object('sub',queue_staff,'email','sales-report-queue@example.local','role','authenticated')::text,true)
from report_ids;
select throws_ok(
  format('select public.get_event_product_sales_report(%L,null,null,null,null,%L,%L,1,20)',(select event from report_ids),'net','desc'),
  'forbidden',
  'queue staff cannot read sales amounts'
);
select throws_ok(format('select public.get_event_sales_analytics(%L)',(select event from report_ids)),'forbidden','queue staff cannot read server dashboard totals');

select set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'email','sales-report-outsider@example.local','role','authenticated')::text,true)
from report_ids;
select throws_ok(
  format('select public.get_event_product_sales_report(%L,null,null,null,null,%L,%L,1,20)',(select event from report_ids),'net','desc'),
  'forbidden',
  'another shop cannot read the event report'
);

select ok(
  not has_function_privilege('anon','public.get_event_product_sales_report(uuid,date,date,text,text,text,text,integer,integer,text)','EXECUTE'),
  'anonymous users cannot execute the report RPC'
);

select throws_ok(format('select public.get_event_sales_analytics(%L)',(select event from report_ids)),'forbidden','another shop cannot read server dashboard totals');
select * from finish();
rollback;
