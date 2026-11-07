create or replace function public.get_campaign_sales_analytics(p_campaign_id uuid, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare zone text; campaign_currency text; result jsonb;
begin
 select coalesce(nullif(c.campaign_timezone,''),'Asia/Bangkok'), c.currency into zone,campaign_currency
 from public.online_campaigns c where c.id=p_campaign_id and public.has_artist_role(c.artist_id,array['owner','manager']);
 if zone is null or auth.uid() is null then raise exception 'forbidden'; end if;
 if p_from>p_to then raise exception 'invalid_date_range'; end if;
 if exists (select 1 from public.orders o join public.order_payments op on op.order_id=o.id where o.campaign_id=p_campaign_id and op.payment_status='payment_confirmed' and coalesce(o.currency,campaign_currency)<>campaign_currency) then raise exception 'campaign_currency_mismatch'; end if;
 with orders as materialized (
   select o.* from public.orders o join public.order_payments op on op.order_id=o.id
   where o.campaign_id=p_campaign_id and op.payment_status='payment_confirmed'
     and coalesce(o.currency,campaign_currency)=campaign_currency
     and (p_from is null or o.created_at >= (p_from::timestamp at time zone zone))
     and (p_to is null or o.created_at < ((p_to+1)::timestamp at time zone zone))
 ), lines as materialized (
   select oi.product_id, coalesce(oi.product_name_snapshot,p.name,'Unknown product') name,
     coalesce(nullif(pp.category,''),nullif(p.category,''),'Other') category,
     oi.quantity, oi.quantity*oi.price_per_unit gross, oi.line_type
   from orders o join public.order_items oi on oi.order_id=o.id
   left join public.products p on p.id=oi.product_id left join public.product_parents pp on pp.id=p.parent_product_id
 ), products as (
   select product_id,name,category,sum(quantity) filter(where coalesce(line_type,'purchase')<>'promotion_reward') qty,
     sum(quantity) filter(where line_type='promotion_reward') gifts,sum(gross) revenue
   from lines group by product_id,name,category
 ), categories as (select category,sum(quantity) qty,sum(gross) revenue from lines where coalesce(line_type,'purchase')<>'promotion_reward' group by category),
 hours as (select to_char(created_at at time zone zone,'HH24:00') as "hour",count(*) orders,sum(total_price) revenue from orders group by 1),
 days as (select (created_at at time zone zone)::date as "day",count(*) orders,sum(total_price) revenue from orders group by 1),
 promo_entries as (
   select o.id order_id, coalesce(nullif(e->>'id',''),nullif(e->>'promotion_id',''),nullif(e->>'ruleId',''),nullif(e->>'name',''),'unknown') id,
     coalesce(nullif(e->>'name',''),nullif(e->>'promotion_name',''),nullif(e->>'label',''),'Unknown promotion') name,
     case when jsonb_typeof(coalesce(e->'discount_amount',e->'discountAmount'))='number' then greatest(coalesce(e->>'discount_amount',e->>'discountAmount')::numeric,0) else 0 end discount
   from orders o cross join lateral jsonb_array_elements(case when jsonb_typeof(o.pricing_breakdown)='array' then o.pricing_breakdown else '[]'::jsonb end) e where jsonb_typeof(e)='object'
 ), promos as (select id,max(name) name,count(distinct order_id) orders,sum(discount) discount from promo_entries group by id),
 totals as (select count(*) n,coalesce(sum(total_price),0) revenue,coalesce(sum(discount_total),0) discount,coalesce(sum(shipping_fee),0) shipping from orders)
 select jsonb_build_object('currency',campaign_currency,'revenue',t.revenue,'discount',t.discount,'shipping',t.shipping,'orders',t.n,
   'items',(select coalesce(sum(qty),0) from products),'gifts',(select coalesce(sum(gifts),0) from products),
   'products',(select coalesce(jsonb_agg(to_jsonb(p) order by p.qty desc nulls last,p.revenue desc,p.name),'[]') from products p),
   'categories',(select coalesce(jsonb_agg(to_jsonb(c) order by c.revenue desc,c.category),'[]') from categories c),
   'hours',(select coalesce(jsonb_agg(to_jsonb(h) order by h."hour"),'[]') from hours h),
   'days',(select coalesce(jsonb_agg(to_jsonb(d) order by d."day"),'[]') from days d),
   'promotions',(select coalesce(jsonb_agg(to_jsonb(p) order by p.orders desc,p.name),'[]') from promos p)) into result from totals t;
 return result;
end $$;
revoke all on function public.get_campaign_sales_analytics(uuid,date,date) from public, anon;
grant execute on function public.get_campaign_sales_analytics(uuid,date,date) to authenticated;
notify pgrst, 'reload schema';
