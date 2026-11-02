-- Stop before changing stock semantics if existing allocations already overlap.
lock table public.products, public.events, public.event_products, public.online_campaigns, public.online_campaign_products in share row exclusive mode;
do $$ begin
 if exists (select 1 from public.products p where not p.is_unlimited and p.deleted_at is null and (select coalesce(sum(greatest(coalesce(ep.stock_total,0)-coalesce(ep.stock_sold,0)-coalesce(ep.stock_reserved,0),0)),0) from public.event_products ep join public.events e on e.id=ep.event_id where ep.product_id=p.id and not ep.is_enabled and not ep.is_unlimited and ((e.status in ('Confirmed','confirmed') and e.end_date>=now()) or (e.status in ('Confirmed','confirmed','Ended','ended') and e.postorder_enabled and coalesce(e.sales_status_override,'auto')<>'closed' and (e.postorder_closes_at is null or e.postorder_closes_at>=now())))) > private.catalog_free_stock(p.id)) then
 raise exception 'hidden_event_stock_overallocated: resolve conflicting allocations before migration';
 end if;
end $$;

CREATE OR REPLACE FUNCTION private.catalog_channel_commitments(p_product_id uuid) returns integer language sql stable set search_path='' as $$
 select coalesce((select sum(s.sold+s.committed) from (
    select ep.stock_sold sold, ep.stock_reserved + case when not ep.is_unlimited
      and ((e.status in ('Confirmed','confirmed') and e.end_date>=now()) or (e.status in ('Confirmed','confirmed','Ended','ended') and e.postorder_enabled and coalesce(e.sales_status_override,'auto')<>'closed' and (e.postorder_closes_at is null or e.postorder_closes_at>=now())))
      then greatest(coalesce(ep.stock_total,0)-ep.stock_sold-ep.stock_reserved,0) else 0 end committed
    from public.event_products ep join public.events e on e.id=ep.event_id where ep.product_id=p_product_id
    union all
    select cp.stock_sold, cp.stock_reserved + case when cp.is_enabled and not cp.is_unlimited
      and c.publication_status not in ('cancelled','archived') and c.closes_at>=now()
      then greatest(coalesce(cp.stock_total,0)-cp.stock_sold-cp.stock_reserved,0) else 0 end
    from public.online_campaign_products cp join public.online_campaigns c on c.id=cp.campaign_id where cp.product_id=p_product_id
   ) s),0)::integer
$$;

CREATE OR REPLACE FUNCTION private.catalog_free_stock(p_product_id uuid)
returns integer language sql stable set search_path='' as $$
 select greatest(coalesce(p.stock_total,0)-p.stock_sold-p.stock_reserved-coalesce((
   select sum(s.sold+s.committed) from (
    select ep.stock_sold sold, ep.stock_reserved + case when not ep.is_unlimited
      and ((e.status in ('Confirmed','confirmed') and e.end_date>=now()) or (e.status in ('Confirmed','confirmed','Ended','ended') and e.postorder_enabled and coalesce(e.sales_status_override,'auto')<>'closed' and (e.postorder_closes_at is null or e.postorder_closes_at>=now())))
      then greatest(coalesce(ep.stock_total,0)-ep.stock_sold-ep.stock_reserved,0) else 0 end committed
    from public.event_products ep join public.events e on e.id=ep.event_id where ep.product_id=p.id
    union all
    select cp.stock_sold, cp.stock_reserved + case when cp.is_enabled and not cp.is_unlimited
      and c.publication_status not in ('cancelled','archived') and c.closes_at>=now()
      then greatest(coalesce(cp.stock_total,0)-cp.stock_sold-cp.stock_reserved,0) else 0 end
    from public.online_campaign_products cp join public.online_campaigns c on c.id=cp.campaign_id where cp.product_id=p.id
   ) s),0),0)::integer from public.products p where p.id=p_product_id
$$;

CREATE OR REPLACE FUNCTION private.inventory_overview_before_bundles(p_artist_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.has_artist_role(p_artist_id,array['owner','manager']) then raise exception 'forbidden'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
 'recent_events',coalesce((select jsonb_agg(to_jsonb(ev)) from (select kind,quantity_before,quantity_after,created_at from private.inventory_events where product_id=p.id order by created_at desc limit 10) ev),'[]'::jsonb),
 'product_id',p.id,'tracking',not p.is_unlimited,'recorded_total',p.stock_total,
 'tracking_locked',exists(select 1 from public.event_products where product_id=p.id) or exists(select 1 from public.online_campaign_products where product_id=p.id) or p.stock_sold+p.stock_reserved>0,
 'physical_on_hand',case when p.is_unlimited then null else coalesce(p.stock_total,0)-p.stock_sold-coalesce(ch.sold,0)+coalesce(cp_pending.qty,0) end,
 'available',case when p.is_unlimited then null else private.catalog_free_stock(p.id) end,
 'awaiting_fulfillment_stock',coalesce(cp_pending.qty,0),'opening_committed',p.stock_reserved+coalesce(ch.allocated,0)+coalesce(cp_pending.qty,0),'allocated',coalesce(ch.allocated,0),'held',coalesce(ch.held,0),
 'production_earmarked',coalesce(pr.earmarked,0), 'production_shortfall',coalesce(pr.shortfall,0)+coalesce(legacy.qty,0),
 'production_ordered',coalesce(pr.ordered,0),'production_fulfilled',coalesce(pr.fulfilled,0),'production_unpaid',coalesce(pr.unpaid,0),
 'open_live_orders',coalesce(sales.open_live_orders,0),'sold',coalesce(sales.qty,0),'fulfilled',coalesce(sales.fulfilled,0),'channels',coalesce(ch.channels,'[]'::jsonb)
 ) order by p.name),'[]'::jsonb) into result
 from public.products p
 left join lateral (
   select sum(s.sold)::integer sold,sum(s.allocated)::integer allocated,sum(s.held)::integer held,
    jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'kind',s.kind,'allocated',s.allocated,'held',s.held,'sold',s.sold)) channels
   from (
     select e.id,e.event_name name,'event' kind,ep.stock_sold sold,ep.stock_reserved held,
       ep.stock_reserved+case when not ep.is_unlimited and ((e.status in ('Confirmed','confirmed') and e.end_date>=now()) or (e.status in ('Confirmed','confirmed','Ended','ended') and e.postorder_enabled and coalesce(e.sales_status_override,'auto')<>'closed' and (e.postorder_closes_at is null or e.postorder_closes_at>=now())))
         then greatest(coalesce(ep.stock_total,0)-ep.stock_reserved-ep.stock_sold,0) else 0 end allocated
     from public.event_products ep join public.events e on e.id=ep.event_id where ep.product_id=p.id
     union all
     select c.id,c.name,'campaign',cp.stock_sold,cp.stock_reserved,
       cp.stock_reserved+case when cp.is_enabled and not cp.is_unlimited and c.publication_status not in ('cancelled','archived') and c.closes_at>=now()
         then greatest(coalesce(cp.stock_total,0)-cp.stock_reserved-cp.stock_sold,0) else 0 end
     from public.online_campaign_products cp join public.online_campaigns c on c.id=cp.campaign_id where cp.product_id=p.id
   ) s
 ) ch on true
 left join lateral (
   select sum(oi.quantity)::integer qty from public.order_items oi join public.orders o on o.id=oi.order_id
   join public.order_payments op on op.order_id=o.id where oi.product_id=p.id and oi.campaign_product_id is not null
   and oi.inventory_source<>'production' and op.payment_status in ('payment_confirmed','refund_pending','refunded')
   and o.pickup_status not in ('picked_up','shipped') and o.shipped_at is null and o.picked_up_at is null
 ) cp_pending on true
 left join lateral (
   select sum(s.allocated-s.consumed)::integer earmarked,
    sum(case when op.payment_status='payment_confirmed' and o.status<>'cancelled' then oi.quantity-s.allocated else 0 end)::integer shortfall,
    sum(case when private.production_order_active(o.id) then oi.quantity else 0 end)::integer ordered,
    sum(s.consumed)::integer fulfilled,
    sum(case when op.payment_status in ('awaiting_payment','payment_submitted') and private.production_order_active(o.id) then oi.quantity else 0 end)::integer unpaid
   from private.production_stock s join public.order_items oi on oi.id=s.order_item_id join public.orders o on o.id=oi.order_id
   left join public.order_payments op on op.order_id=o.id where s.product_id=p.id
 ) pr on true
 left join lateral (
   select sum(oi.quantity)::integer qty from public.order_items oi join public.orders o on o.id=oi.order_id join public.order_payments op on op.order_id=o.id
   where oi.product_id=p.id and oi.inventory_source='untracked' and oi.campaign_product_id is null
   and op.payment_status='payment_confirmed' and o.status not in ('completed','cancelled') and o.pickup_status not in ('picked_up','shipped')
   and not exists(select 1 from private.production_stock s where s.order_item_id=oi.id)
 ) legacy on true
 left join lateral (
   select sum(case when op.payment_status='payment_confirmed' or o.status='completed' then oi.quantity else 0 end)::integer qty,
    count(distinct case when oi.inventory_source='untracked' and o.order_type not in ('preorder','post_event','online_sale') and o.status not in ('completed','cancelled') then o.id end)::integer open_live_orders,
    sum(case when o.status='completed' or o.pickup_status in ('picked_up','shipped') then oi.quantity else 0 end)::integer fulfilled
   from public.order_items oi join public.orders o on o.id=oi.order_id left join public.order_payments op on op.order_id=o.id where oi.product_id=p.id
 ) sales on true
 where p.artist_id=p_artist_id and p.deleted_at is null;
 return result;
end $$;

CREATE OR REPLACE FUNCTION public.list_product_stock_summaries(p_artist_id uuid)
 RETURNS TABLE(product_id uuid, on_hand integer, allocated integer, available integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_artist_role(p_artist_id, array['owner','manager']) then
    raise exception 'forbidden';
  end if;
  return query
  with channel_stock as (
    select ep.product_id, coalesce(ep.stock_sold,0) sold,
      coalesce(ep.stock_reserved,0) + case when not ep.is_unlimited
        and ((e.status in ('Confirmed','confirmed') and e.end_date>=now()) or (e.status in ('Confirmed','confirmed','Ended','ended') and e.postorder_enabled and coalesce(e.sales_status_override,'auto')<>'closed' and (e.postorder_closes_at is null or e.postorder_closes_at>=now())))
        then greatest(coalesce(ep.stock_total,0)-coalesce(ep.stock_sold,0)-coalesce(ep.stock_reserved,0),0)
        else 0 end allocation
    from public.event_products ep join public.events e on e.id=ep.event_id
    where ep.artist_id=p_artist_id
    union all
    select cp.product_id, coalesce(cp.stock_sold,0),
      coalesce(cp.stock_reserved,0) + case when cp.is_enabled and not cp.is_unlimited
        and c.publication_status not in ('cancelled','archived') and c.closes_at >= now()
        then greatest(coalesce(cp.stock_total,0)-coalesce(cp.stock_sold,0)-coalesce(cp.stock_reserved,0),0)
        else 0 end
    from public.online_campaign_products cp join public.online_campaigns c on c.id=cp.campaign_id
    where cp.artist_id=p_artist_id
  ), commitments as (
    select s.product_id, sum(s.sold) sold, sum(s.allocation) allocation
    from channel_stock s group by s.product_id
  )
  select p.id, coalesce(p.stock_total,0)::integer, coalesce(c.allocation,0)::integer,
    greatest(coalesce(p.stock_total,0)-coalesce(p.stock_sold,0)-coalesce(p.stock_reserved,0)
      -coalesce(c.sold,0)-coalesce(c.allocation,0),0)::integer
  from public.products p left join commitments c on c.product_id=p.id
  where p.artist_id=p_artist_id and p.deleted_at is null and not coalesce(p.is_unlimited,true);
end $function$
;

CREATE OR REPLACE FUNCTION public.calculate_product_event_allocation_available(p_product_id uuid, p_exclude_event_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p record; capacity integer; own_allocation integer := 0;
begin
  select * into p from public.products where id=p_product_id and deleted_at is null;
  if p.id is null then raise exception 'product_not_found'; end if;
  if not public.has_artist_role(p.artist_id,array['owner','manager']) then raise exception 'forbidden'; end if;
  if coalesce(p.is_unlimited,true) or p.stock_total is null then return 2147483647; end if;
  select s.available into capacity from public.list_product_stock_summaries(p.artist_id) s where s.product_id=p_product_id;
  select coalesce(sum(coalesce(ep.stock_reserved,0) + case when not ep.is_unlimited
    and ((e.status in ('Confirmed','confirmed') and e.end_date>=now()) or (e.status in ('Confirmed','confirmed','Ended','ended') and e.postorder_enabled and coalesce(e.sales_status_override,'auto')<>'closed' and (e.postorder_closes_at is null or e.postorder_closes_at>=now())))
    then greatest(coalesce(ep.stock_total,0)-coalesce(ep.stock_sold,0)-coalesce(ep.stock_reserved,0),0)
    else 0 end),0)::integer into own_allocation
  from public.event_products ep join public.events e on e.id=ep.event_id
  where ep.product_id=p_product_id and ep.event_id=p_exclude_event_id;
  return capacity + own_allocation;
end $function$
;

CREATE OR REPLACE FUNCTION public.enforce_event_product_allocation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_product record;
  v_event record;
  v_other_event_committed integer := 0;
  v_campaign_committed integer := 0;
  v_new_committed integer := 0;
  v_committed integer := 0;
begin
  select p.id, p.artist_id, p.stock_total, p.stock_reserved, p.stock_sold,
         p.is_unlimited, p.deleted_at
  into v_product
  from public.products p
  where p.id = new.product_id
  for update;

  if v_product.id is null or v_product.artist_id <> new.artist_id or v_product.deleted_at is not null then
    raise exception 'invalid_event_product';
  end if;
  if new.price_override is not null and new.price_override < 0 then
    raise exception 'invalid_price_override';
  end if;
  if coalesce(v_product.is_unlimited, true) then return new; end if;
  if coalesce(new.is_unlimited, false) then raise exception 'event_stock_exceeds_catalog_stock'; end if;
  if new.stock_total is null or new.stock_total < 0 then raise exception 'invalid_event_stock'; end if;
  if new.stock_total < coalesce(new.stock_reserved, 0) + coalesce(new.stock_sold, 0) then
    raise exception 'event_stock_below_used_stock';
  end if;

  select e.id, e.status, e.end_date, e.postorder_enabled, e.postorder_closes_at, e.sales_status_override
  into v_event
  from public.events e
  where e.id = new.event_id;
  if v_event.id is null then raise exception 'event_not_found'; end if;

  select coalesce(sum(
    coalesce(ep.stock_sold, 0)
    + coalesce(ep.stock_reserved, 0)
    + case when ep.is_unlimited = false
             and ((e.status in ('Confirmed','confirmed') and e.end_date>=now()) or (e.status in ('Confirmed','confirmed','Ended','ended') and e.postorder_enabled and coalesce(e.sales_status_override,'auto')<>'closed' and (e.postorder_closes_at is null or e.postorder_closes_at>=now())))
      then greatest(coalesce(ep.stock_total, 0) - coalesce(ep.stock_sold, 0) - coalesce(ep.stock_reserved, 0), 0)
      else 0 end
  ), 0)::integer
  into v_other_event_committed
  from public.event_products ep
  join public.events e on e.id = ep.event_id
  where ep.product_id = new.product_id
    and ep.event_id <> new.event_id;

  select coalesce(sum(
    coalesce(cp.stock_sold, 0)
    + coalesce(cp.stock_reserved, 0)
    + case when cp.is_enabled = true
             and cp.is_unlimited = false
             and c.publication_status not in ('cancelled', 'archived')
             and c.closes_at >= now()
      then greatest(coalesce(cp.stock_total, 0) - coalesce(cp.stock_sold, 0) - coalesce(cp.stock_reserved, 0), 0)
      else 0 end
  ), 0)::integer
  into v_campaign_committed
  from public.online_campaign_products cp
  join public.online_campaigns c on c.id = cp.campaign_id
  where cp.product_id = new.product_id;

  v_new_committed := coalesce(new.stock_sold, 0) + coalesce(new.stock_reserved, 0);
  if ((v_event.status in ('Confirmed','confirmed') and v_event.end_date>=now()) or (v_event.status in ('Confirmed','confirmed','Ended','ended') and v_event.postorder_enabled and coalesce(v_event.sales_status_override,'auto')<>'closed' and (v_event.postorder_closes_at is null or v_event.postorder_closes_at>=now()))) then
    v_new_committed := v_new_committed
      + greatest(coalesce(new.stock_total, 0) - coalesce(new.stock_sold, 0) - coalesce(new.stock_reserved, 0), 0);
  end if;

  v_committed := coalesce(v_product.stock_sold, 0)
    + coalesce(v_product.stock_reserved, 0)
    + v_other_event_committed
    + v_campaign_committed
    + v_new_committed;

  if v_committed > coalesce(v_product.stock_total, 0) then
    raise exception 'event_stock_exceeds_catalog_stock';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_online_campaign_product_allocation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_product record;
  v_campaign record;
  v_event_committed integer := 0;
  v_other_campaign_committed integer := 0;
  v_new_committed integer := 0;
  v_committed integer := 0;
begin
  select p.id, p.artist_id, p.stock_total, p.stock_reserved, p.stock_sold,
         p.is_unlimited, p.deleted_at
  into v_product
  from public.products p
  where p.id = new.product_id
  for update;

  if v_product.id is null or v_product.artist_id <> new.artist_id or v_product.deleted_at is not null then
    raise exception 'invalid_campaign_product';
  end if;
  if new.price_override is not null and new.price_override < 0 then
    raise exception 'invalid_price_override';
  end if;
  if coalesce(v_product.is_unlimited, true) then return new; end if;
  if coalesce(new.is_unlimited, false) then raise exception 'campaign_stock_exceeds_catalog_stock'; end if;
  if new.stock_total is null or new.stock_total < 0 then raise exception 'invalid_campaign_stock'; end if;
  if new.stock_total < coalesce(new.stock_reserved, 0) + coalesce(new.stock_sold, 0) then
    raise exception 'campaign_stock_below_used_stock';
  end if;

  select c.id, c.publication_status, c.closes_at
  into v_campaign
  from public.online_campaigns c
  where c.id = new.campaign_id;
  if v_campaign.id is null then raise exception 'campaign_not_found'; end if;

  select coalesce(sum(
    coalesce(ep.stock_sold, 0)
    + coalesce(ep.stock_reserved, 0)
    + case when ep.is_unlimited = false
             and ((e.status in ('Confirmed','confirmed') and e.end_date>=now()) or (e.status in ('Confirmed','confirmed','Ended','ended') and e.postorder_enabled and coalesce(e.sales_status_override,'auto')<>'closed' and (e.postorder_closes_at is null or e.postorder_closes_at>=now())))
      then greatest(coalesce(ep.stock_total, 0) - coalesce(ep.stock_sold, 0) - coalesce(ep.stock_reserved, 0), 0)
      else 0 end
  ), 0)::integer
  into v_event_committed
  from public.event_products ep
  join public.events e on e.id = ep.event_id
  where ep.product_id = new.product_id;

  select coalesce(sum(
    coalesce(cp.stock_sold, 0)
    + coalesce(cp.stock_reserved, 0)
    + case when cp.is_enabled = true
             and cp.is_unlimited = false
             and c.publication_status not in ('cancelled', 'archived')
             and c.closes_at >= now()
      then greatest(coalesce(cp.stock_total, 0) - coalesce(cp.stock_sold, 0) - coalesce(cp.stock_reserved, 0), 0)
      else 0 end
  ), 0)::integer
  into v_other_campaign_committed
  from public.online_campaign_products cp
  join public.online_campaigns c on c.id = cp.campaign_id
  where cp.product_id = new.product_id
    and cp.campaign_id <> new.campaign_id;

  v_new_committed := coalesce(new.stock_sold, 0) + coalesce(new.stock_reserved, 0);
  if coalesce(new.is_enabled, true)
     and v_campaign.publication_status not in ('cancelled', 'archived')
     and v_campaign.closes_at >= now() then
    v_new_committed := v_new_committed
      + greatest(coalesce(new.stock_total, 0) - coalesce(new.stock_sold, 0) - coalesce(new.stock_reserved, 0), 0);
  end if;

  v_committed := coalesce(v_product.stock_sold, 0)
    + coalesce(v_product.stock_reserved, 0)
    + v_event_committed
    + v_other_campaign_committed
    + v_new_committed;

  if v_committed > coalesce(v_product.stock_total, 0) then
    raise exception 'campaign_stock_exceeds_catalog_stock';
  end if;
  return new;
end;
$function$
;
