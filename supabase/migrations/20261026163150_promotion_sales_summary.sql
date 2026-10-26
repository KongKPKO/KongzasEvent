-- Report promotions from saved order snapshots; never spread order discounts across products.
create or replace function private.get_event_sales_analytics(p_event_id uuid,p_from date default null,p_to date default null,p_currency text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare zone text; first_at timestamptz; last_at timestamptz; selected_currency text; result jsonb;
begin
 if auth.uid() is null or not public.has_event_role(p_event_id,array['owner','manager']) then raise exception 'forbidden'; end if;
 select coalesce(nullif(event_timezone,''),'Asia/Bangkok') into zone from public.events where id=p_event_id;
 if p_from>p_to then raise exception 'invalid_date_range'; end if;
 first_at:=p_from::timestamp at time zone zone;
 last_at:=(p_to+1)::timestamp at time zone zone;
 select case when bool_or(coalesce(o.currency,'THB')=p_currency) then p_currency else coalesce((array_agg(coalesce(o.currency,'THB') order by o.created_at,o.id))[1],'THB') end into selected_currency
 from public.orders o where o.event_id=p_event_id and o.status='completed' and (first_at is null or o.created_at>=first_at) and (last_at is null or o.created_at<last_at);
 with period_orders as materialized (
   select o.*,coalesce(o.order_type,case when o.queue_id is null then 'pos_walkin' else 'live_queue' end) kind from public.orders o
   where o.event_id=p_event_id and (first_at is null or o.created_at>=first_at) and (last_at is null or o.created_at<last_at)
 ), completed as materialized (
   select * from period_orders where status='completed' and coalesce(currency,'THB')=selected_currency
 ), promotion_entries as materialized (
   select o.id order_id,o.created_at,
     coalesce(nullif(entry->>'id',''),nullif(entry->>'promotion_id',''),nullif(entry->>'ruleId',''),'name:'||coalesce(nullif(entry->>'name',''),nullif(entry->>'promotion_name',''),nullif(entry->>'label',''),'Unknown promotion')) promotion_id,
     coalesce(nullif(entry->>'name',''),nullif(entry->>'promotion_name',''),nullif(entry->>'label',''),'Unknown promotion') name,
     case when jsonb_typeof(coalesce(entry->'discount_amount',entry->'discountAmount'))='number' then greatest(coalesce(entry->>'discount_amount',entry->>'discountAmount')::numeric,0) else 0 end discount,
     (select coalesce(sum(case when jsonb_typeof(reward->'quantity')='number' then greatest((reward->>'quantity')::numeric,0) else 0 end),0)
      from jsonb_array_elements(case when jsonb_typeof(entry->'rewards')='array' then entry->'rewards' else '[]'::jsonb end) reward) gift_units,
     case when jsonb_typeof(entry#>'{activity_reward,quantity}')='number' then greatest((entry#>>'{activity_reward,quantity}')::numeric,0) else 0 end activity_units
   from completed o cross join lateral jsonb_array_elements(case when jsonb_typeof(o.pricing_breakdown)='array' then o.pricing_breakdown else '[]'::jsonb end) entry
   where jsonb_typeof(entry)='object'
 ), promotion_usage as (
   select promotion_id,(array_agg(name order by created_at desc,order_id))[1] name,
     count(distinct order_id) order_count,sum(discount) discount_total,sum(gift_units) gift_units,sum(activity_units) activity_units
   from promotion_entries group by promotion_id
 ), promotion_order_totals as (
   select order_id,sum(discount) discount from promotion_entries group by order_id
 ), promotion_totals as (
   select coalesce(sum(greatest(coalesce(o.discount_total,0)-coalesce(p.discount,0),0)),0) unattributed,
     coalesce(bool_or(coalesce(p.discount,0)>coalesce(o.discount_total,0)),false) mismatch
   from completed o left join promotion_order_totals p on p.order_id=o.id
 ), totals as (
   select count(*) n,coalesce(sum(total_price),0) revenue,coalesce(sum(coalesce(nullif(subtotal_price,0),total_price)),0) subtotal,
   coalesce(sum(discount_total),0) discount,
   count(*) filter(where payment_method='cash') cash_count,coalesce(sum(total_price) filter(where payment_method='cash'),0) cash_revenue,
   count(*) filter(where payment_method='transfer') transfer_count,coalesce(sum(total_price) filter(where payment_method='transfer'),0) transfer_revenue,
   count(*) filter(where kind='preorder') pre_count,coalesce(sum(total_price) filter(where kind='preorder'),0) pre_revenue,
   count(*) filter(where kind='post_event') post_count,coalesce(sum(total_price) filter(where kind='post_event'),0) post_revenue,
   count(*) filter(where kind='live_queue') queue_count,coalesce(sum(total_price) filter(where kind='live_queue'),0) queue_revenue,
   count(*) filter(where kind='pos_walkin') walkin_count,coalesce(sum(total_price) filter(where kind='pos_walkin'),0) walkin_revenue from completed
 ), lines as materialized (
   select oi.product_id,coalesce(oi.product_name_snapshot,p.name,'Unknown product') name,
   coalesce(nullif(pp.category,''),nullif(p.category,''),'Other') category,oi.quantity,oi.quantity*oi.price_per_unit gross,o.created_at,oi.id
   from completed o join public.order_items oi on oi.order_id=o.id left join public.products p on p.id=oi.product_id left join public.product_parents pp on pp.id=p.parent_product_id
 ), products as (
   select product_id,(array_agg(name order by created_at desc,id))[1] name,(array_agg(category order by created_at desc,id))[1] category,sum(quantity) qty,sum(gross) revenue from lines group by product_id
 ), top_products as (select * from products order by qty desc,revenue desc,product_id limit 8),
 categories as (select category,sum(quantity) qty,sum(gross) revenue from lines group by category),
 hours as (select to_char(created_at at time zone zone,'HH24:00') as "hour",count(*) orders,sum(total_price) revenue from completed group by 1),
 queue_times as (
   select q.status,extract(epoch from (coalesce(q.served_at,q.called_at)-q.created_at))/60 wait_minutes,
   extract(epoch from (q.completed_at-coalesce(q.served_at,q.called_at)))/60 service_minutes
   from public.queues q where q.event_id=p_event_id and (first_at is null or q.created_at>=first_at) and (last_at is null or q.created_at<last_at)
 ), queue_totals as (
   select count(*) total,count(*) filter(where status='complete') completed,count(*) filter(where status='expired') expired,
   count(*) filter(where status='missed') missed,count(*) filter(where status in ('waiting','queued','calling','serving')) active,
   coalesce(avg(wait_minutes) filter(where wait_minutes>=0 and wait_minutes<600),0) wait,
   coalesce(avg(service_minutes) filter(where service_minutes>=0 and service_minutes<300),0) service from queue_times
 )
 select jsonb_build_object(
   'currency',selected_currency,'currencies',(select coalesce(jsonb_agg(currency order by currency),'[]') from (select distinct coalesce(currency,'THB') currency from period_orders where status='completed')c),
   'revenue',t.revenue,'subtotal',t.subtotal,'discountTotal',t.discount,'itemCount',(select coalesce(sum(quantity),0) from lines),
   'completedOrderCount',t.n,'avgOrderValue',case when t.n>0 then t.revenue/t.n else 0 end,
   'paymentSummary',jsonb_build_object('cashOrders',t.cash_count,'cashRevenue',t.cash_revenue,'transferOrders',t.transfer_count,'transferRevenue',t.transfer_revenue),
   'orderTypeSummary',jsonb_build_object('preorderOrders',t.pre_count,'preorderRevenue',t.pre_revenue,'postOrders',t.post_count,'postRevenue',t.post_revenue,
      'awaitingPickupCount',(select count(*) from period_orders where kind='preorder' and pickup_status='awaiting_pickup' and coalesce(currency,'THB')=selected_currency),
      'liveQueueOrders',t.queue_count,'liveQueueRevenue',t.queue_revenue,'walkinOrders',t.walkin_count,'walkinRevenue',t.walkin_revenue),
   'queueSummary',jsonb_build_object('totalQueues',q.total,'completedQueues',q.completed,'expiredQueues',q.expired,'missedQueues',q.missed,'activeQueues',q.active,
     'conversionRate',case when q.total>0 then q.completed*100.0/q.total else 0 end,'avgWaitMinutes',q.wait,'avgServiceMinutes',q.service),
   'topProducts',(select coalesce(jsonb_agg(to_jsonb(p) order by p.qty desc,p.revenue desc,p.product_id),'[]') from top_products p),
   'categoryBreakdown',(select coalesce(jsonb_agg(to_jsonb(c) order by c.revenue desc,c.category),'[]') from categories c),
   'promotionSummary',jsonb_build_object(
      'rows',(select coalesce(jsonb_agg(to_jsonb(p) order by p.order_count desc,p.discount_total desc,p.promotion_id),'[]'::jsonb) from promotion_usage p),
      'unattributedDiscount',(select unattributed from promotion_totals),
      'discountMismatch',(select mismatch from promotion_totals),
      'discountTotal',t.discount),
   'hourlySales',(select coalesce(jsonb_agg(to_jsonb(h) order by h.hour),'[]') from hours h)
 ) into result from totals t,queue_totals q;
 return result;
end $$;

notify pgrst, 'reload schema';
