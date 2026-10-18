-- Keep the established RPC contracts while replacing bundle stock projections.
do $$ declare d text; begin
 select pg_get_functiondef('public.list_event_products(uuid)'::regprocedure) into d;
 d:=replace(d,'private.event_production(p_event_id,p.id,private.active_event_phase(p_event_id)) then','(private.event_production(p_event_id,p.id,private.active_event_phase(p_event_id)) or private.is_component_bundle(p.id)) then');
 -- supply_mode must continue to describe the merchant policy, not the display calculation.
 d:=replace(d,'case when (private.event_production(p_event_id,p.id,private.active_event_phase(p_event_id)) or private.is_component_bundle(p.id)) then ''production''','case when private.event_production(p_event_id,p.id,private.active_event_phase(p_event_id)) then ''production''');
 d:=replace(d,'    p.stock_total,','    case when private.is_component_bundle(p.id) then private.bundle_available(p.id,p_event_id,null) else p.stock_total end,');
 d:=replace(d,'    coalesce(p.stock_reserved, 0) as stock_reserved,','    case when private.is_component_bundle(p.id) then 0 else coalesce(p.stock_reserved,0) end as stock_reserved,');
 d:=replace(d,'    coalesce(p.stock_sold, 0) as stock_sold,','    case when private.is_component_bundle(p.id) then 0 else coalesce(p.stock_sold,0) end as stock_sold,');
 d:=replace(d,'    coalesce(p.is_unlimited, true) as is_unlimited,','    case when private.is_component_bundle(p.id) then private.bundle_available(p.id,p_event_id,null) is null else coalesce(p.is_unlimited,true) end as is_unlimited,');
 execute d;
 select pg_get_functiondef('private.list_event_products_for_phase(uuid,text)'::regprocedure) into d;
 d:=replace(d,'''is_unlimited'',case when private.event_production','''is_unlimited'',case when private.is_component_bundle(p.id) and not private.event_production(p_event_id,p.id,phase) then private.bundle_available(p.id,p_event_id,null) is null when private.event_production');
 d:=replace(d,'''stock_total'',case when private.event_production','''stock_total'',case when private.is_component_bundle(p.id) and not private.event_production(p_event_id,p.id,phase) then private.bundle_available(p.id,p_event_id,null) when private.event_production');
 d:=replace(d,'''stock_reserved'',case when private.event_production(p_event_id,p.id,phase) then','''stock_reserved'',case when private.is_component_bundle(p.id) or private.event_production(p_event_id,p.id,phase) then');
 d:=replace(d,'''stock_sold'',case when private.event_production(p_event_id,p.id,phase) then','''stock_sold'',case when private.is_component_bundle(p.id) or private.event_production(p_event_id,p.id,phase) then');
 execute d;
end $$;

alter function private.inventory_overview(uuid) rename to inventory_overview_before_bundles;
create function private.inventory_overview(p_artist_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; row jsonb; extra record;
begin
 result:=private.inventory_overview_before_bundles(p_artist_id);
 for row in select value from jsonb_array_elements(result) loop
   select coalesce(sum(case when b.source='production' then b.held else 0 end),0)::integer earmarked,
     coalesce(sum(case when b.source='production' and op.payment_status='payment_confirmed' and o.status<>'cancelled' then b.quantity-b.held-b.consumed else 0 end),0)::integer shortfall,
     coalesce(sum(case when b.source='production' and private.production_order_active(o.id) then b.quantity else 0 end),0)::integer ordered,
     coalesce(sum(case when b.source='production' then b.consumed else 0 end),0)::integer produced_fulfilled,
     coalesce(sum(case when b.source='production' and op.payment_status in ('awaiting_payment','payment_submitted') and private.production_order_active(o.id) then b.quantity else 0 end),0)::integer unpaid,
     coalesce(sum(case when op.payment_status='payment_confirmed' or o.status='completed' then b.quantity else 0 end),0)::integer sold,
     coalesce(sum(b.consumed),0)::integer fulfilled,
     coalesce(sum(case when b.campaign_product_id is not null then b.sold-b.consumed else 0 end),0)::integer pending
   into extra from private.bundle_order_components b join public.order_items oi on oi.id=b.order_item_id join public.orders o on o.id=oi.order_id left join public.order_payments op on op.order_id=o.id where b.product_id=(row->>'product_id')::uuid;
   result:=(select jsonb_agg(case when x->>'product_id'=row->>'product_id' then x||jsonb_build_object(
     'production_earmarked',(x->>'production_earmarked')::integer+extra.earmarked,
     'production_shortfall',(x->>'production_shortfall')::integer+extra.shortfall,
     'production_ordered',(x->>'production_ordered')::integer+extra.ordered,
     'production_fulfilled',(x->>'production_fulfilled')::integer+extra.produced_fulfilled,
     'production_unpaid',(x->>'production_unpaid')::integer+extra.unpaid,
     'sold',(x->>'sold')::integer+extra.sold,'fulfilled',(x->>'fulfilled')::integer+extra.fulfilled,
     'physical_on_hand',(x->>'physical_on_hand')::integer+extra.pending,
     'awaiting_fulfillment_stock',(x->>'awaiting_fulfillment_stock')::integer+extra.pending,
     'bundle_available',case when private.is_component_bundle((x->>'product_id')::uuid) then private.bundle_available((x->>'product_id')::uuid) else null end
   ) else x end) from jsonb_array_elements(result)x);
 end loop;
 return result;
end $$;
revoke all on function private.inventory_overview(uuid) from public,anon;
grant execute on function private.inventory_overview(uuid) to authenticated;

-- The bundle container is not a physical production unit; count its components.
do $$ declare d text; begin
 select pg_get_functiondef('private.production_order_stock(uuid,uuid)'::regprocedure) into d;
 d:=replace(d,$s$and (oi.inventory_source='production' or s.order_item_id is not null) group by o.id$s$, $s$and (oi.inventory_source='production' or s.order_item_id is not null) and not private.is_component_bundle(oi.product_id) group by o.id$s$);
 execute d;
end $$;
alter function private.production_order_stock(uuid,uuid) rename to production_order_stock_before_bundles;
create function private.production_order_stock(p_event_id uuid,p_campaign_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare base jsonb; extra jsonb;
begin
 base:=private.production_order_stock_before_bundles(p_event_id,p_campaign_id);
 select coalesce(jsonb_agg(to_jsonb(s)),'[]') into extra from (
 select o.id order_id,sum(b.quantity)::integer required,sum(b.held+b.consumed)::integer allocated,sum(b.consumed)::integer fulfilled,
 sum(case when b.source='production' then b.quantity-b.held-b.consumed else 0 end)::integer shortfall,bool_and(b.source='production') tracking
 from private.bundle_order_components b join public.order_items oi on oi.id=b.order_item_id join public.orders o on o.id=oi.order_id
 where (o.event_id=p_event_id or o.campaign_id=p_campaign_id) and oi.inventory_source='production' group by o.id)s;
 return (select coalesce(jsonb_agg(to_jsonb(s)),'[]') from (
 select (x->>'order_id')::uuid order_id,sum((x->>'required')::integer)::integer required,sum((x->>'allocated')::integer)::integer allocated,
 sum((x->>'fulfilled')::integer)::integer fulfilled,sum((x->>'shortfall')::integer)::integer shortfall,bool_or((x->>'tracking')::boolean) tracking
 from jsonb_array_elements(base||extra)x group by 1)s);
end $$;
revoke all on function private.production_order_stock(uuid,uuid) from public,anon;
grant execute on function private.production_order_stock(uuid,uuid) to authenticated;
notify pgrst,'reload schema';

-- Campaign management also needs format metadata to avoid displaying a fictitious
-- independent stock pool for a bundle.
do $$ declare d text; begin
 select pg_get_functiondef('public.get_online_campaign_workspace(uuid)'::regprocedure) into d;
 d:=replace(d,'''sku'', p.sku, ''price'', p.price,','''sku'', p.sku, ''price'', p.price, ''product_kind'',p.product_kind,''bundle_items'',p.bundle_items,');
 execute d;
end $$;
create function private.guard_bundle_allocation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if private.is_component_bundle(new.product_id) then new.is_unlimited:=true; new.stock_total:=null; end if;
 return new;
end $$;
create trigger zz_guard_bundle_allocation before insert or update on public.event_products for each row execute function private.guard_bundle_allocation();
create trigger zz_guard_bundle_allocation before insert or update on public.online_campaign_products for each row execute function private.guard_bundle_allocation();
revoke all on function private.guard_bundle_allocation() from public,anon,authenticated;

-- Only authorized order projections call this helper; names/quantities come from
-- the immutable sale snapshot, never from today's editable bundle recipe.
create function private.order_bundle_components(p_order_item uuid) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('product_id',product_id,'name',product_name,'quantity',quantity) order by product_name,product_id),'[]')
 from private.bundle_order_components where order_item_id=p_order_item
$$;
revoke all on function private.order_bundle_components(uuid) from public,anon,authenticated;
do $$ declare r record; d text; begin
 for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('get_online_campaign_workspace','get_public_online_order_by_code','get_public_preorder_by_code') loop
   select pg_get_functiondef(r.oid) into d;
   d:=replace(d,'''name'', coalesce(oi.product_name_snapshot, p.name),','''name'', coalesce(oi.product_name_snapshot, p.name), ''components'',private.order_bundle_components(oi.id),');
   execute d;
 end loop;
end $$;
create function private.event_bundle_contents(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_event_role(p_event_id,array['owner','manager','seller','queue_staff']) then raise exception 'forbidden'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('order_item_id',oi.id,'components',private.order_bundle_components(oi.id)))
 from public.order_items oi join public.orders o on o.id=oi.order_id where o.event_id=p_event_id
 and exists(select 1 from private.bundle_order_components b where b.order_item_id=oi.id)),'[]');
end $$;
create function public.event_bundle_contents(p_event_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.event_bundle_contents(p_event_id) $$;
revoke all on function private.event_bundle_contents(uuid),public.event_bundle_contents(uuid) from public,anon,authenticated;
grant execute on function private.event_bundle_contents(uuid),public.event_bundle_contents(uuid) to authenticated;

-- A recipe edit requires a fresh customer quote, even if the bundle price stays.
do $$ declare d text; begin
 select pg_get_functiondef('public.calculate_sale_promotions(uuid,text,uuid,jsonb,jsonb,jsonb)'::regprocedure) into d;
 d:=replace(d,'''required_choices'', v_required_choices','''bundle_components'', (select coalesce(jsonb_agg(jsonb_build_object(''product_id'',p.id,''components'',p.bundle_items) order by p.id),''[]''::jsonb) from public.products p where private.is_component_bundle(p.id) and p.id in(select (x->>''product_id'')::uuid from jsonb_array_elements(v_cart||v_reward_lines)x)), ''required_choices'', v_required_choices');
 execute d;
end $$;

-- POS repricing can use the physical units already held by this queue order.
do $$ declare d text; begin
 select pg_get_functiondef('public.complete_order_with_stock(uuid,text,uuid,jsonb,jsonb,text,boolean)'::regprocedure) into d;
 d:=replace(d,'v_quote := public.calculate_sale_promotions(', 'perform set_config(''nireq.production_quote_order'',p_order_id::text,true);'||chr(10)||'  v_quote := public.calculate_sale_promotions(');
 d:=replace(d,'coalesce(p_promotion_choices, ''[]''::jsonb)'||chr(10)||'  );','coalesce(p_promotion_choices, ''[]''::jsonb)'||chr(10)||'  );'||chr(10)||'  perform set_config(''nireq.production_quote_order'','''',true);');
 execute d;
end $$;

-- A seller may quote/read a queue order including the stock that order owns.
-- These endpoints never grant queue staff access to the POS or receipt amounts.
create function private.assert_pos_order(p_event_id uuid,p_order_id uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_event_role(p_event_id,array['owner','manager','seller']) then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.orders where id=p_order_id and event_id=p_event_id and queue_id is not null and status in ('draft','confirmed') and campaign_id is null and (order_type is null or order_type='live_queue')) then raise exception 'order_not_editable'; end if;
end $$;
create function private.quote_pos_order(p_event_id uuid,p_order_id uuid,p_items jsonb,p_reward_choices jsonb default '[]',p_promotion_choices jsonb default '[]') returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.assert_pos_order(p_event_id,p_order_id);
 perform set_config('nireq.production_quote_order',p_order_id::text,true);
 result:=public.calculate_sale_promotions(p_event_id,'live',null,p_items,p_reward_choices,p_promotion_choices);
 perform set_config('nireq.production_quote_order','',true);
 return result;
end $$;
create function public.quote_pos_order(p_event_id uuid,p_order_id uuid,p_items jsonb,p_reward_choices jsonb default '[]',p_promotion_choices jsonb default '[]') returns jsonb
language sql security invoker set search_path='' as $$ select private.quote_pos_order(p_event_id,p_order_id,p_items,p_reward_choices,p_promotion_choices) $$;
create function private.get_pos_catalog_for_order(p_event_id uuid,p_order_id uuid) returns setof jsonb
language plpgsql security definer set search_path='' as $$
declare row jsonb; owned integer;
begin
 perform private.assert_pos_order(p_event_id,p_order_id);
 perform set_config('nireq.production_quote_order',p_order_id::text,true);
 for row in select * from private.list_event_products_for_phase(p_event_id,'live') loop
   if not private.is_component_bundle((row->>'id')::uuid) then
     select coalesce(sum(quantity),0)::integer into owned from public.order_items where order_id=p_order_id and product_id=(row->>'id')::uuid and inventory_source='stock';
     row:=row||jsonb_build_object('stock_reserved',greatest(coalesce((row->>'stock_reserved')::integer,0)-owned,0));
   end if;
   return next row;
 end loop;
 perform set_config('nireq.production_quote_order','',true);
end $$;
create function public.get_pos_catalog_for_order(p_event_id uuid,p_order_id uuid) returns setof jsonb
language sql security invoker set search_path='' as $$ select * from private.get_pos_catalog_for_order(p_event_id,p_order_id) $$;
revoke all on function private.assert_pos_order(uuid,uuid),private.quote_pos_order(uuid,uuid,jsonb,jsonb,jsonb),public.quote_pos_order(uuid,uuid,jsonb,jsonb,jsonb),private.get_pos_catalog_for_order(uuid,uuid),public.get_pos_catalog_for_order(uuid,uuid) from public,anon,authenticated;
grant execute on function private.quote_pos_order(uuid,uuid,jsonb,jsonb,jsonb),public.quote_pos_order(uuid,uuid,jsonb,jsonb,jsonb),private.get_pos_catalog_for_order(uuid,uuid),public.get_pos_catalog_for_order(uuid,uuid) to authenticated;

-- Ordinary queue items also own holds. POS completion releases their ordinary
-- counters before quoting, so only preview reads need this additional credit.
do $$ declare d text; begin
 select pg_get_functiondef('private.event_supply_available(uuid,uuid,text)'::regprocedure) into d;
 d:=replace(d,'begin','declare available integer; owned integer; begin');
 d:=replace(d,'return private.event_supply_available_before_bundles(p_event_id,p_product_id,p_phase);',
 $p$available:=private.event_supply_available_before_bundles(p_event_id,p_product_id,p_phase);
 if not private.event_production(p_event_id,p_product_id,p_phase) and available is not null and coalesce(current_setting('nireq.pos_reprice_released',true),'')<>'true' then
   select coalesce(sum(oi.quantity),0)::integer into owned from public.order_items oi join public.orders o on o.id=oi.order_id
   where o.id=nullif(current_setting('nireq.production_quote_order',true),'')::uuid and o.event_id=p_event_id and o.queue_id is not null and o.status in ('draft','confirmed') and oi.product_id=p_product_id and oi.inventory_source='stock';
   available:=available+owned;
 end if;
 return available;$p$);
 execute d;
 select pg_get_functiondef('public.complete_order_with_stock(uuid,text,uuid,jsonb,jsonb,text,boolean)'::regprocedure) into d;
 d:=replace(d,'perform set_config(''nireq.production_quote_order'',p_order_id::text,true);','perform set_config(''nireq.production_quote_order'',p_order_id::text,true); perform set_config(''nireq.pos_reprice_released'',''true'',true);');
 d:=replace(d,'perform set_config(''nireq.production_quote_order'','''',true);','perform set_config(''nireq.production_quote_order'','''',true); perform set_config(''nireq.pos_reprice_released'','''',true);');
 execute d;
end $$;
notify pgrst,'reload schema';

-- Keep a bundle recipe/price stable from promotion quote through component
-- acquisition, including mixed purchased/gift carts and existing queue carts.
do $$ declare d text; patched text; begin
 select pg_get_functiondef('public.create_online_campaign_order(uuid,jsonb,text,uuid,text,text,text,text,text,uuid,jsonb,jsonb,text,boolean)'::regprocedure) into d;
 patched:=replace(d,'v_quote := public.calculate_sale_promotions(',
 $p$if exists(select 1 from public.online_campaigns c join public.artists a on a.id=c.artist_id
     where c.id=p_campaign_id and c.publication_status='published' and now()>=c.opens_at and now()<c.closes_at and a.is_public and a.is_verified) then
     perform private.lock_bundle_cart(p_items);
   end if;
   v_quote := public.calculate_sale_promotions($p$);
 if patched=d then raise exception 'bundle_campaign_quote_lock_patch_missing'; end if;
 execute patched;
 select pg_get_functiondef('public.complete_order_with_stock(uuid,text,uuid,jsonb,jsonb,text,boolean)'::regprocedure) into d;
 patched:=regexp_replace(d,'for v_stock in',
 $p$perform private.lock_bundle_cart(coalesce((select jsonb_agg(jsonb_build_object('product_id',oi.product_id)) from public.order_items oi where oi.order_id=p_order_id),'[]'),p_order_id);
   for v_stock in$p$,'i');
 if patched=d then raise exception 'bundle_pos_quote_lock_patch_missing'; end if;
 execute patched;
end $$;
