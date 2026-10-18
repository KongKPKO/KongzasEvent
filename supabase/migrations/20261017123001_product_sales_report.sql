-- Server-side product sales aggregation for event reports.
-- Refunds are intentionally not allocated to item lines: the current model only
-- records a whole-order refund state and has no trustworthy per-item amount.
create or replace function private.get_event_product_sales_report(
  p_event_id uuid,
  p_from date default null,
  p_to date default null,
  p_search text default null,
  p_category text default null,
  p_sort text default 'net',
  p_direction text default 'desc',
  p_page integer default 1,
  p_page_size integer default 20,
  p_currency text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_from_at timestamptz;
  v_to_at timestamptz;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_category text := nullif(btrim(coalesce(p_category, '')), '');
  v_sort text := case when p_sort in ('name', 'quantity', 'gross', 'discount', 'net') then p_sort else 'net' end;
  v_direction text := case when lower(coalesce(p_direction, '')) = 'asc' then 'asc' else 'desc' end;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 20), 1), 500);
  v_result jsonb;
begin
  if auth.uid() is null or not public.has_event_role(p_event_id, array['owner', 'manager']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if char_length(coalesce(v_search, '')) > 200 then raise exception 'search_too_long'; end if;

  select coalesce(nullif(e.event_timezone, ''), 'Asia/Bangkok')
  into v_timezone
  from public.events e
  where e.id = p_event_id;

  if v_timezone is null then
    raise exception 'event_not_found';
  end if;

  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'invalid_date_range';
  end if;

  v_from_at := case when p_from is null then null else p_from::timestamp at time zone v_timezone end;
  v_to_at := case when p_to is null then null else (p_to + 1)::timestamp at time zone v_timezone end;

  with sale_lines as (
    select
      oi.id as order_item_id,
      oi.order_id,
      oi.product_id,
      coalesce(p.parent_product_id, p.id, oi.product_id, oi.id)::text || ':' || coalesce(oi.currency,o.currency,'THB') as family_id,
      coalesce(nullif(oi.product_name_snapshot, ''), p.name, 'Unknown product') as sold_name,
      coalesce(nullif(oi.sku_snapshot, ''), p.sku, '') as sold_sku,
      coalesce(nullif(p.variant_name, ''), 'Default') as variant_name,
      coalesce(nullif(pp.category, ''), nullif(p.category, ''), 'Other') as category,
      coalesce(nullif(pp.image_url, ''), nullif(p.image_url, '')) as image_url,
      coalesce(oi.currency, o.currency, 'THB') as currency,
      greatest(coalesce(oi.quantity, 0), 0)::integer as quantity,
      greatest(coalesce(oi.quantity, 0) * coalesce(oi.price_per_unit, 0), 0)::numeric as gross,
      round(least(
        greatest(coalesce(o.discount_total, 0), 0),
        sum(greatest(coalesce(oi.quantity, 0) * coalesce(oi.price_per_unit, 0), 0)) over (partition by oi.order_id)
      ), 2)::numeric as order_discount,
      sum(greatest(coalesce(oi.quantity, 0) * coalesce(oi.price_per_unit, 0), 0)) over (partition by oi.order_id)::numeric as order_gross,
      o.created_at,
      (nullif(p.variant_group_name, '') is not null and coalesce(nullif(p.variant_name,''),'Default')<>'Default') as belongs_to_variant_family
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    left join public.products p on p.id = oi.product_id
    left join public.product_parents pp on pp.id = p.parent_product_id
    where o.event_id = p_event_id
      and o.status = 'completed'
      and (p_currency is null or coalesce(oi.currency,o.currency,'THB')=p_currency)
      and (v_from_at is null or o.created_at >= v_from_at)
      and (v_to_at is null or o.created_at < v_to_at)
  ), proportional as (
    select
      sl.*,
      case when sl.order_gross > 0
        then sl.order_discount * sl.gross / sl.order_gross
        else 0::numeric
      end as raw_discount
    from sale_lines sl
  ), floored as (
    select
      pr.*,
      floor(pr.raw_discount * 100) / 100 as floored_discount
    from proportional pr
  ), ranked as (
    select
      fl.*,
      sum(fl.floored_discount) over (partition by fl.order_id) as floored_total,
      row_number() over (
        partition by fl.order_id
        order by (fl.raw_discount - fl.floored_discount) desc, fl.order_item_id
      ) as remainder_rank
    from floored fl
  ), allocated as (
    select
      rk.*,
      rk.floored_discount + case
        when rk.remainder_rank <= round((rk.order_discount - rk.floored_total) * 100)::integer then 0.01::numeric
        else 0::numeric
      end as allocated_discount
    from ranked rk
  ), variants as (
    select
      a.family_id,
      a.product_id,
      (array_agg(a.sold_name order by a.created_at desc, a.order_item_id desc))[1] as sold_name,
      (array_agg(a.sold_sku order by a.created_at desc, a.order_item_id desc))[1] as sold_sku,
      (array_agg(a.variant_name order by a.created_at desc, a.order_item_id desc))[1] as variant_name,
      (array_agg(a.category order by a.created_at desc, a.order_item_id desc))[1] as category,
      (array_agg(a.image_url order by a.created_at desc, a.order_item_id desc))[1] as image_url,
      (array_agg(a.currency order by a.created_at desc, a.order_item_id desc))[1] as currency,
      sum(a.quantity)::integer as quantity,
      sum(a.gross)::numeric as gross,
      sum(a.allocated_discount)::numeric as discount,
      bool_or(a.belongs_to_variant_family) as belongs_to_variant_family,
      string_agg(distinct lower(a.sold_name || ' ' || a.sold_sku), ' ') as search_text,
      max(a.created_at) as last_sold_at
    from allocated a
    group by a.family_id, a.product_id
  ), families as (
    select
      v.family_id,
      (array_agg(
        case
          when v.belongs_to_variant_family and position(' — ' in v.sold_name) > 0 then split_part(v.sold_name, ' — ', 1)
          else v.sold_name
        end
        order by v.last_sold_at desc, v.product_id
      ))[1] as name,
      (array_agg(v.category order by v.last_sold_at desc, v.product_id))[1] as category,
      (array_agg(v.image_url order by v.last_sold_at desc, v.product_id))[1] as image_url,
      (array_agg(v.currency order by v.last_sold_at desc, v.product_id))[1] as currency,
      sum(v.quantity)::integer as quantity,
      sum(v.gross)::numeric as gross,
      sum(v.discount)::numeric as discount,
      bool_or(v.belongs_to_variant_family) as has_variants,
      string_agg(v.search_text, ' ') as search_text,
      max(v.last_sold_at) as last_sold_at,
      jsonb_agg(jsonb_build_object(
        'product_id', v.product_id,
        'name', v.sold_name,
        'variant_name', case
          when v.belongs_to_variant_family and position(' — ' in v.sold_name) > 0
            then substring(v.sold_name from position(' — ' in v.sold_name) + 3)
          else v.variant_name
        end,
        'sku', v.sold_sku,
        'quantity', v.quantity,
        'gross', v.gross,
        'discount', v.discount,
        'refund', null,
        'net', v.gross - v.discount
      ) order by v.sold_name, v.sold_sku, v.product_id) as variants
    from variants v
    group by v.family_id
  ), filtered as (
    select f.*
    from families f
    where (v_search is null or f.search_text ilike '%' || replace(replace(v_search, '%', '\%'), '_', '\_') || '%' escape '\')
      and (v_category is null or f.category = v_category)
  ), counted as (
    select f.*, count(*) over ()::integer as total_count
    from filtered f
  ), page_rows as (
    select c.*
    from counted c
    order by
      case when v_sort = 'name' and v_direction = 'asc' then lower(c.name) end asc,
      case when v_sort = 'name' and v_direction = 'desc' then lower(c.name) end desc,
      case when v_sort = 'quantity' and v_direction = 'asc' then c.quantity end asc,
      case when v_sort = 'quantity' and v_direction = 'desc' then c.quantity end desc,
      case when v_sort = 'gross' and v_direction = 'asc' then c.gross end asc,
      case when v_sort = 'gross' and v_direction = 'desc' then c.gross end desc,
      case when v_sort = 'discount' and v_direction = 'asc' then c.discount end asc,
      case when v_sort = 'discount' and v_direction = 'desc' then c.discount end desc,
      case when v_sort = 'net' and v_direction = 'asc' then c.gross - c.discount end asc,
      case when v_sort = 'net' and v_direction = 'desc' then c.gross - c.discount end desc,
      lower(c.name), c.family_id
    offset (v_page - 1) * v_page_size
    limit v_page_size
  ), categories as (
    select coalesce(jsonb_agg(category order by category), '[]'::jsonb) as values
    from (select distinct category from families) available
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'family_id', p.family_id,
      'name', p.name,
      'category', p.category,
      'image_url', p.image_url,
      'currency', p.currency,
      'quantity', p.quantity,
      'gross', p.gross,
      'discount', p.discount,
      'refund', null,
      'net', p.gross - p.discount,
      'has_variants', p.has_variants,
      'variants', p.variants
    ) order by
      case when v_sort = 'name' and v_direction = 'asc' then lower(p.name) end asc,
      case when v_sort = 'name' and v_direction = 'desc' then lower(p.name) end desc,
      case when v_sort = 'quantity' and v_direction = 'asc' then p.quantity end asc,
      case when v_sort = 'quantity' and v_direction = 'desc' then p.quantity end desc,
      case when v_sort = 'gross' and v_direction = 'asc' then p.gross end asc,
      case when v_sort = 'gross' and v_direction = 'desc' then p.gross end desc,
      case when v_sort = 'discount' and v_direction = 'asc' then p.discount end asc,
      case when v_sort = 'discount' and v_direction = 'desc' then p.discount end desc,
      case when v_sort = 'net' and v_direction = 'asc' then p.gross - p.discount end asc,
      case when v_sort = 'net' and v_direction = 'desc' then p.gross - p.discount end desc,
      lower(p.name), p.family_id
    ) from page_rows p), '[]'::jsonb),
    'total_count', coalesce((select max(total_count) from counted), 0),
    'page', v_page,
    'page_size', v_page_size,
    'categories', (select values from categories),
    'timezone', v_timezone,
    'refund_allocation_available', false
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_event_product_sales_report(
  p_event_id uuid,
  p_from date default null,
  p_to date default null,
  p_search text default null,
  p_category text default null,
  p_sort text default 'net',
  p_direction text default 'desc',
  p_page integer default 1,
  p_page_size integer default 20,
  p_currency text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_event_product_sales_report(
    p_event_id, p_from, p_to, p_search, p_category,
    p_sort, p_direction, p_page, p_page_size, p_currency
  );
$$;

revoke all on function private.get_event_product_sales_report(uuid,date,date,text,text,text,text,integer,integer,text) from public, anon, authenticated;
revoke all on function public.get_event_product_sales_report(uuid,date,date,text,text,text,text,integer,integer,text) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.get_event_product_sales_report(uuid,date,date,text,text,text,text,integer,integer,text) to authenticated;
grant execute on function public.get_event_product_sales_report(uuid,date,date,text,text,text,text,integer,integer,text) to authenticated;

comment on function public.get_event_product_sales_report(uuid,date,date,text,text,text,text,integer,integer,text) is
  'Paginated completed-order product sales for event management reports. Discounts are allocated proportionally per order; item refunds remain unavailable because refunds are stored at order level.';

notify pgrst, 'reload schema';

-- Dashboard totals use the same completed-order/date definition as the item
-- report. Do not fetch an API-limited order list and total it in the browser.
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
   'hourlySales',(select coalesce(jsonb_agg(to_jsonb(h) order by h.hour),'[]') from hours h)
 ) into result from totals t,queue_totals q;
 return result;
end $$;
create or replace function public.get_event_sales_analytics(p_event_id uuid,p_from date default null,p_to date default null,p_currency text default null)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.get_event_sales_analytics(p_event_id,p_from,p_to,p_currency) $$;
revoke all on function private.get_event_sales_analytics(uuid,date,date,text),public.get_event_sales_analytics(uuid,date,date,text) from public,anon,authenticated;
grant execute on function private.get_event_sales_analytics(uuid,date,date,text),public.get_event_sales_analytics(uuid,date,date,text) to authenticated;

notify pgrst, 'reload schema';
