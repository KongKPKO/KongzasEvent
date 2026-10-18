-- Auto matching is explicit per real bundle parent. Existing bundles remain opt-out.
alter table public.product_parents
  add column auto_bundle_enabled boolean not null default false,
  add constraint product_parents_auto_bundle_kind
    check (not auto_bundle_enabled or product_kind = 'bundle');

create function private.has_auto_bundles(p_event uuid,p_campaign uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.product_parents pp where pp.auto_bundle_enabled and pp.artist_id=coalesce((select artist_id from public.events where id=p_event),(select artist_id from public.online_campaigns where id=p_campaign)))
$$;
revoke all on function private.has_auto_bundles(uuid,uuid) from public,anon,authenticated;

-- Keep the existing bundle writer intact and add the opt-in as one atomic save.
alter function private.save_product_bundle(jsonb,jsonb)
  rename to save_product_bundle_before_auto_matching;

create function private.save_product_bundle(p_parent jsonb,p_components jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  result:=private.save_product_bundle_before_auto_matching(p_parent,p_components);
  if p_parent ? 'auto_bundle_enabled' then
    update public.product_parents
    set auto_bundle_enabled=coalesce((p_parent->>'auto_bundle_enabled')::boolean,false),
        updated_at=clock_timestamp()
    where id=result;
  end if;
  return result;
end $$;
revoke all on function private.save_product_bundle_before_auto_matching(jsonb,jsonb),private.save_product_bundle(jsonb,jsonb)
  from public,anon,authenticated;
-- The existing public SQL-invoker facade delegates here; private is not an API schema.
grant execute on function private.save_product_bundle(jsonb,jsonb) to authenticated;

-- Validate the raw cart first, then greedily consume loose component units by
-- greatest per-set channel saving. UUID ordering makes equal-saving recipes stable.
create function private.normalize_sale_bundle_items(
  p_event_id uuid,
  p_event_phase text,
  p_campaign_id uuid,
  p_items jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_artist_id uuid;
  v_item jsonb;
  v_product record;
  v_product_id uuid;
  v_quantity integer;
  v_available integer;
  v_supply_mode text;
  v_seen uuid[]:='{}'::uuid[];
  v_remaining jsonb:='{}'::jsonb;
  v_original jsonb:='{}'::jsonb;
  v_auto_sets jsonb:='[]'::jsonb;
  v_candidate record;
  v_component jsonb;
  v_sets integer;
  v_component_available integer;
  v_items jsonb;
begin
  if (p_event_id is null)=(p_campaign_id is null) then
    raise exception 'promotion_context_required';
  end if;
  if p_event_id is not null then
    if p_event_phase not in ('preorder','live','postorder') then
      raise exception 'promotion_event_phase_invalid';
    end if;
    select artist_id into v_artist_id from public.events where id=p_event_id;
  else
    if p_event_phase is not null then raise exception 'promotion_event_phase_invalid'; end if;
    select artist_id into v_artist_id from public.online_campaigns where id=p_campaign_id;
  end if;
  if v_artist_id is null then raise exception 'promotion_context_not_found'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then
    raise exception 'promotion_items_invalid';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) item(value) loop
    if jsonb_typeof(v_item)<>'object' then raise exception 'promotion_items_invalid'; end if;
    begin
      v_product_id:=(v_item->>'product_id')::uuid;
    exception when others then
      raise exception 'promotion_product_invalid';
    end;
    if v_product_id is null then raise exception 'promotion_product_invalid'; end if;
    begin
      v_quantity:=(v_item->>'quantity')::integer;
    exception when others then
      raise exception 'promotion_quantity_invalid';
    end;
    if v_quantity is null or v_quantity<=0 then raise exception 'promotion_quantity_invalid'; end if;
    if v_product_id=any(v_seen) then raise exception 'promotion_duplicate_product'; end if;
    v_seen:=array_append(v_seen,v_product_id);

    v_product:=null;
    if p_event_id is not null then
      select p.id,p.product_kind,private.event_supply_available(p_event_id,p.id,p_event_phase) available,
        case when private.event_production(p_event_id,p.id,p_event_phase) then 'production' else 'stock' end supply_mode
      into v_product
      from public.event_products ep join public.products p on p.id=ep.product_id
      where ep.event_id=p_event_id and ep.product_id=v_product_id
        and ep.is_enabled and ep.is_sellable and p.status='enable' and p.deleted_at is null;
    else
      select p.id,p.product_kind,private.campaign_supply_available(p_campaign_id,p.id) available,
        case when private.campaign_production(p_campaign_id,p.id) then 'production' else 'stock' end supply_mode
      into v_product
      from public.online_campaign_products cp join public.products p on p.id=cp.product_id
      where cp.campaign_id=p_campaign_id and cp.product_id=v_product_id
        and cp.is_enabled and cp.is_sellable and p.status='enable' and p.deleted_at is null;
    end if;
    if v_product.id is null then raise exception 'sale_product_unavailable'; end if;
    v_available:=v_product.available;
    v_supply_mode:=v_product.supply_mode;
    if v_available is not null and v_quantity>v_available then raise exception 'sale_product_unavailable'; end if;
    if v_item ? 'expected_supply_mode' and v_item->>'expected_supply_mode' is distinct from v_supply_mode then
      raise exception 'supply_policy_changed_reload';
    end if;
    v_remaining:=jsonb_set(v_remaining,array[v_product_id::text],to_jsonb(v_quantity),true);
    v_original:=jsonb_set(v_original,array[v_product_id::text],v_item,true);
  end loop;

  if not private.has_auto_bundles(p_event_id,p_campaign_id) then return jsonb_build_object('items',p_items,'auto_sets','[]'::jsonb); end if;

  -- Checkout facades normalize before legacy cores acquire product locks. Their
  -- transaction-local hash prevents the promotion engine from taking parent
  -- locks after those product locks while still repeating all raw validations.
  if nullif(current_setting('nireq.auto_bundle_normalized_hash',true),'')
     =encode(extensions.digest(convert_to(coalesce(p_items,'[]'::jsonb)::text,'UTF8'),'sha256'),'hex') then
    return jsonb_build_object('items',coalesce(p_items,'[]'::jsonb),'auto_sets','[]'::jsonb);
  end if;

  -- Bundle saves lock parent then product rows. Use the same order so a recipe or
  -- opt-in cannot change between selection and the downstream cart lock.
  perform 1 from public.product_parents pp
  where pp.artist_id=v_artist_id and pp.product_kind='bundle' and pp.auto_bundle_enabled
  order by pp.id for update;
  perform 1 from public.products p
  where p.id=any(v_seen)
     or p.id in (
       select bp.id from public.products bp join public.product_parents pp on pp.id=bp.parent_product_id
       where pp.artist_id=v_artist_id and pp.product_kind='bundle' and pp.auto_bundle_enabled
     )
     or p.id in (
       select bc.product_id from private.bundle_components bc join public.products bp on bp.id=bc.bundle_id
       join public.product_parents pp on pp.id=bp.parent_product_id
       where pp.artist_id=v_artist_id and pp.product_kind='bundle' and pp.auto_bundle_enabled
     )
  order by p.id for update;

  if p_event_id is not null then
    perform 1 from public.event_products ep where ep.event_id=p_event_id order by ep.product_id for update;
  else
    perform 1 from public.online_campaign_products cp where cp.campaign_id=p_campaign_id order by cp.product_id for update;
  end if;

  for v_candidate in
    with candidates as (
      select bp.id bundle_id,bp.name bundle_name,
        coalesce(case when p_event_id is not null then bep.price_override else bcp.price_override end,bp.price) bundle_price,
        (select jsonb_agg(jsonb_build_object('product_id',bc.product_id,'quantity',bc.quantity) order by bc.product_id)
         from private.bundle_components bc where bc.bundle_id=bp.id) components,
        (select sum(coalesce(case when p_event_id is not null then cep.price_override else ccp.price_override end,component.price)*bc.quantity)
         from private.bundle_components bc
         join public.products component on component.id=bc.product_id
         left join public.event_products cep on p_event_id is not null and cep.event_id=p_event_id and cep.product_id=bc.product_id
         left join public.online_campaign_products ccp on p_campaign_id is not null and ccp.campaign_id=p_campaign_id and ccp.product_id=bc.product_id
         where bc.bundle_id=bp.id) component_price
      from public.products bp
      join public.product_parents pp on pp.id=bp.parent_product_id
      left join public.event_products bep on p_event_id is not null and bep.event_id=p_event_id and bep.product_id=bp.id
      left join public.online_campaign_products bcp on p_campaign_id is not null and bcp.campaign_id=p_campaign_id and bcp.product_id=bp.id
      where pp.artist_id=v_artist_id and pp.product_kind='bundle' and pp.auto_bundle_enabled
        and bp.product_kind='bundle' and bp.status='enable' and bp.deleted_at is null
        and private.is_component_bundle(bp.id)
        and ((p_event_id is not null and bep.id is not null and bep.is_enabled and bep.is_sellable)
          or (p_campaign_id is not null and bcp.id is not null and bcp.is_enabled and bcp.is_sellable))
        and not exists (
          select 1 from private.bundle_components bc where bc.bundle_id=bp.id and (
            (p_event_id is not null and private.event_production(p_event_id,bc.product_id,p_event_phase)
              is distinct from private.event_production(p_event_id,bp.id,p_event_phase))
            or (p_campaign_id is not null and private.campaign_production(p_campaign_id,bc.product_id)
              is distinct from private.campaign_production(p_campaign_id,bp.id))
          )
        )
        and not exists (
          select 1 from private.bundle_components bc
          join public.products component on component.id=bc.product_id
          left join public.event_products cep on p_event_id is not null and cep.event_id=p_event_id and cep.product_id=bc.product_id
          left join public.online_campaign_products ccp on p_campaign_id is not null and ccp.campaign_id=p_campaign_id and ccp.product_id=bc.product_id
          where bc.bundle_id=bp.id and (
            component.status<>'enable' or component.deleted_at is not null
            or (p_event_id is not null and (cep.id is null or not cep.is_enabled or not cep.is_sellable))
            or (p_campaign_id is not null and (ccp.id is null or not ccp.is_enabled or not ccp.is_sellable))
          )
        )
    )
    select *,component_price-bundle_price saving from candidates
    where component_price-bundle_price>=0
    order by component_price-bundle_price desc,bundle_id
  loop
    if coalesce(v_original#>>array[v_candidate.bundle_id::text,'notes'],'')<>'' or exists(
      select 1 from jsonb_array_elements(v_candidate.components) c where coalesce(v_original#>>array[c->>'product_id','notes'],'')<>''
    ) then continue; end if;
    v_sets:=null;
    for v_component in select value from jsonb_array_elements(v_candidate.components) component(value) loop
      v_component_available:=coalesce((v_remaining->>(v_component->>'product_id'))::integer,0)/(v_component->>'quantity')::integer;
      v_sets:=case when v_sets is null then v_component_available else least(v_sets,v_component_available) end;
    end loop;
    if coalesce(v_sets,0)<=0 then continue; end if;
    for v_component in select value from jsonb_array_elements(v_candidate.components) component(value) loop
      v_product_id:=(v_component->>'product_id')::uuid;
      v_quantity:=(v_remaining->>v_product_id::text)::integer-v_sets*(v_component->>'quantity')::integer;
      v_remaining:=jsonb_set(v_remaining,array[v_product_id::text],to_jsonb(v_quantity),true);
    end loop;
    v_remaining:=jsonb_set(v_remaining,array[v_candidate.bundle_id::text],
      to_jsonb(coalesce((v_remaining->>v_candidate.bundle_id::text)::integer,0)+v_sets),true);
    v_auto_sets:=v_auto_sets||jsonb_build_array(jsonb_build_object(
      'bundle_product_id',v_candidate.bundle_id,'bundle_name',v_candidate.bundle_name,
      'quantity',v_sets,'unit_savings',v_candidate.saving,
      'total_savings',v_candidate.saving*v_sets,'components',v_candidate.components
    ));
  end loop;

  select coalesce(jsonb_agg(
    (coalesce(v_original->entry.key,'{}'::jsonb)-'product_id'-'quantity'-'expected_supply_mode')
      ||jsonb_build_object('product_id',entry.key::uuid,'quantity',entry.value::integer,
        'expected_supply_mode',case when p_event_id is not null
          then case when private.event_production(p_event_id,entry.key::uuid,p_event_phase) then 'production' else 'stock' end
          else case when private.campaign_production(p_campaign_id,entry.key::uuid) then 'production' else 'stock' end end)
    order by entry.key),'[]'::jsonb)
  into v_items from jsonb_each_text(v_remaining) entry where entry.value::integer>0;
  return jsonb_build_object('items',v_items,'auto_sets',v_auto_sets);
end $$;
revoke all on function private.normalize_sale_bundle_items(uuid,text,uuid,jsonb) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.bundle_available(p_id uuid, p_event uuid DEFAULT NULL::uuid, p_campaign uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record; available integer; result integer;
begin
 if not private.is_component_bundle(p_id) then return 0; end if;
 for r in select bc.*,p.status,p.deleted_at,p.is_unlimited from private.bundle_components bc
 join public.products p on p.id=bc.product_id where bc.bundle_id=p_id loop
   if r.deleted_at is not null or r.status<>'enable' then return 0; end if;
   if p_campaign is not null then
     select case when cp.is_unlimited then null else greatest(cp.stock_total-cp.stock_reserved-cp.stock_sold,0) end into available
     from public.online_campaign_products cp where cp.campaign_id=p_campaign and cp.product_id=r.product_id and cp.is_enabled;
     if not found then return 0; end if;
   elsif p_event is not null and exists(select 1 from public.event_products where event_id=p_event) then
     select case when ep.is_unlimited then null else greatest(ep.stock_total-ep.stock_reserved-ep.stock_sold,0) end into available
     from public.event_products ep where ep.event_id=p_event and ep.product_id=r.product_id and ep.is_enabled;
     if not found then return 0; end if;
   else
     available:=case when r.is_unlimited then null else private.catalog_free_stock(r.product_id) end;
   end if;
   -- A pending order's own holds remain available to its final promotion quote.
   -- The physical delta guard still checks actual allocation counters at commit.
   available:=available+coalesce((select sum(b.held)::integer from private.bundle_order_components b
     join public.order_items oi on oi.id=b.order_item_id join public.orders o on o.id=oi.order_id
     where oi.order_id=nullif(current_setting('nireq.production_quote_order',true),'')::uuid
       and b.product_id=r.product_id and b.source='stock'
       and o.event_id is not distinct from p_event and o.campaign_id is not distinct from p_campaign),0);
   -- Converting an existing queue cart must retain its own loose-component holds.
   if p_event is not null and p_campaign is null and available is not null
      and coalesce(current_setting('nireq.pos_reprice_released',true),'')<>'true' then
     available:=available+coalesce((select sum(oi.quantity)::integer
       from public.order_items oi join public.orders o on o.id=oi.order_id
       where o.id=nullif(current_setting('nireq.production_quote_order',true),'')::uuid
         and o.event_id=p_event and o.queue_id is not null and o.status in ('draft','confirmed')
         and oi.product_id=r.product_id and oi.inventory_source='stock'
         and not private.is_component_bundle(oi.product_id)),0);
   end if;
   if available is not null then result:=least(result,available/r.quantity); end if;
 end loop;
 return result;
end $function$;

-- Keep the proven checkout implementations and put a canonical cart in front of
-- each persistence boundary. Existing idempotent results bypass fresh matching.
alter function public.create_customer_order_with_stock(uuid,jsonb,uuid) set schema private;
alter function private.create_customer_order_with_stock(uuid,jsonb,uuid) rename to create_customer_order_with_stock_before_auto_matching;
create function public.create_customer_order_with_stock(p_queue_id uuid,p_items jsonb,p_payment_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_event uuid; v_items jsonb:=p_items;
begin
  if p_payment_idempotency_key is not null and exists(select 1 from public.orders where payment_idempotency_key=p_payment_idempotency_key) then
    return private.create_customer_order_with_stock_before_auto_matching(p_queue_id,p_items,p_payment_idempotency_key);
  end if;
  select event_id into v_event from public.queues where id=p_queue_id;
  if v_event is not null and private.has_auto_bundles(v_event) and exists(select 1 from public.event_products where event_id=v_event) then
    v_items:=private.normalize_sale_bundle_items(v_event,'live',null,p_items)->'items';
    perform set_config('nireq.auto_bundle_normalized_hash',encode(extensions.digest(convert_to(v_items::text,'UTF8'),'sha256'),'hex'),true);
  end if;
  return private.create_customer_order_with_stock_before_auto_matching(p_queue_id,v_items,p_payment_idempotency_key);
end $$;

alter function public.sync_customer_order_items_with_stock(uuid,jsonb,uuid) set schema private;
alter function private.sync_customer_order_items_with_stock(uuid,jsonb,uuid) rename to sync_customer_order_items_with_stock_before_auto_matching;
create function public.sync_customer_order_items_with_stock(p_order_id uuid,p_items jsonb,p_payment_idempotency_key uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_event uuid; v_artist uuid; v_status text; v_items jsonb:=p_items;
begin
  select o.event_id,e.artist_id,o.status into v_event,v_artist,v_status
  from public.orders o left join public.events e on e.id=o.event_id where o.id=p_order_id;
  if v_status='completed' then
    return private.sync_customer_order_items_with_stock_before_auto_matching(p_order_id,p_items,p_payment_idempotency_key);
  end if;
  if auth.uid() is null or not public.has_artist_role(v_artist,array['owner','queue_pos']) then
    return private.sync_customer_order_items_with_stock_before_auto_matching(p_order_id,p_items,p_payment_idempotency_key);
  end if;
  if v_event is not null and private.has_auto_bundles(v_event) and exists(select 1 from public.event_products where event_id=v_event) then
    perform set_config('nireq.production_quote_order',p_order_id::text,true);
    v_items:=private.normalize_sale_bundle_items(v_event,'live',null,p_items)->'items';
    perform set_config('nireq.auto_bundle_normalized_hash',encode(extensions.digest(convert_to(v_items::text,'UTF8'),'sha256'),'hex'),true);
  end if;
  return private.sync_customer_order_items_with_stock_before_auto_matching(p_order_id,v_items,p_payment_idempotency_key);
end $$;

alter function public.create_walkin_order_with_stock(uuid,jsonb,text,uuid,jsonb,jsonb,text,boolean) set schema private;
alter function private.create_walkin_order_with_stock(uuid,jsonb,text,uuid,jsonb,jsonb,text,boolean) rename to create_walkin_order_with_stock_before_auto_matching;
create function public.create_walkin_order_with_stock(
  p_event_id uuid,p_items jsonb,p_payment_method text,p_payment_idempotency_key uuid default null,
  p_reward_choices jsonb default '[]',p_promotion_choices jsonb default '[]',
  p_expected_pricing_hash text default null,p_accept_exhausted_rewards boolean default false
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_items jsonb:=p_items;
begin
  if p_payment_idempotency_key is not null and exists(select 1 from public.orders where payment_idempotency_key=p_payment_idempotency_key) then
    return private.create_walkin_order_with_stock_before_auto_matching(p_event_id,p_items,p_payment_method,p_payment_idempotency_key,p_reward_choices,p_promotion_choices,p_expected_pricing_hash,p_accept_exhausted_rewards);
  end if;
  if auth.uid() is null or not public.has_artist_role((select artist_id from public.events where id=p_event_id),array['owner','queue_pos']) then
    return private.create_walkin_order_with_stock_before_auto_matching(p_event_id,p_items,p_payment_method,p_payment_idempotency_key,p_reward_choices,p_promotion_choices,p_expected_pricing_hash,p_accept_exhausted_rewards);
  end if;
  if private.has_auto_bundles(p_event_id) and exists(select 1 from public.event_products where event_id=p_event_id) then
    v_items:=private.normalize_sale_bundle_items(p_event_id,'live',null,p_items)->'items';
    perform set_config('nireq.auto_bundle_normalized_hash',encode(extensions.digest(convert_to(v_items::text,'UTF8'),'sha256'),'hex'),true);
  end if;
  return private.create_walkin_order_with_stock_before_auto_matching(p_event_id,v_items,p_payment_method,p_payment_idempotency_key,p_reward_choices,p_promotion_choices,p_expected_pricing_hash,p_accept_exhausted_rewards);
end $$;

alter function public.create_preorder_with_stock(uuid,jsonb,text,text,text,uuid,text,text,text,text,jsonb,jsonb,text,boolean) set schema private;
alter function private.create_preorder_with_stock(uuid,jsonb,text,text,text,uuid,text,text,text,text,jsonb,jsonb,text,boolean) rename to create_preorder_with_stock_before_auto_matching;
create function public.create_preorder_with_stock(
  p_event_id uuid,p_items jsonb,p_customer_name text,p_customer_contact text default '',p_customer_note text default '',
  p_client_request_id uuid default null,p_customer_phone text default '',p_customer_social text default '',
  p_customer_email text default '',p_shipping_address text default '',p_reward_choices jsonb default '[]',
  p_promotion_choices jsonb default '[]',p_expected_pricing_hash text default null,p_accept_exhausted_rewards boolean default false
) returns table(order_id uuid,pickup_code text,total_price numeric,currency text,pickup_instructions text,payment_status text,payment_methods jsonb,payment_deadline_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_items jsonb:=p_items; v_phase text;
begin
  if p_client_request_id is not null and exists(select 1 from public.orders where payment_idempotency_key=p_client_request_id) then
    return query select * from private.create_preorder_with_stock_before_auto_matching(p_event_id,p_items,p_customer_name,p_customer_contact,p_customer_note,p_client_request_id,p_customer_phone,p_customer_social,p_customer_email,p_shipping_address,p_reward_choices,p_promotion_choices,p_expected_pricing_hash,p_accept_exhausted_rewards);
    return;
  end if;
  v_phase:=private.active_event_phase(p_event_id);
  if v_phase='post_event' then v_phase:='postorder'; end if;
  if v_phase in ('preorder','postorder') and private.has_auto_bundles(p_event_id) and exists(select 1 from public.event_products where event_id=p_event_id) then
    v_items:=private.normalize_sale_bundle_items(p_event_id,v_phase,null,p_items)->'items';
    perform set_config('nireq.auto_bundle_normalized_hash',encode(extensions.digest(convert_to(v_items::text,'UTF8'),'sha256'),'hex'),true);
  end if;
  return query select * from private.create_preorder_with_stock_before_auto_matching(p_event_id,v_items,p_customer_name,p_customer_contact,p_customer_note,p_client_request_id,p_customer_phone,p_customer_social,p_customer_email,p_shipping_address,p_reward_choices,p_promotion_choices,p_expected_pricing_hash,p_accept_exhausted_rewards);
end $$;

alter function public.create_online_campaign_order(uuid,jsonb,text,uuid,text,text,text,text,text,uuid,jsonb,jsonb,text,boolean) set schema private;
alter function private.create_online_campaign_order(uuid,jsonb,text,uuid,text,text,text,text,text,uuid,jsonb,jsonb,text,boolean) rename to create_online_campaign_order_before_auto_matching;
create function public.create_online_campaign_order(
  p_campaign_id uuid,p_items jsonb,p_fulfillment_method text,p_pickup_point_id uuid,p_customer_name text,p_customer_email text,
  p_customer_phone text default '',p_shipping_address text default '',p_customer_note text default '',p_client_request_id uuid default null,
  p_reward_choices jsonb default '[]',p_promotion_choices jsonb default '[]',p_expected_pricing_hash text default null,
  p_accept_exhausted_rewards boolean default false
) returns table(order_id uuid,order_code text,subtotal_price numeric,shipping_fee numeric,total_price numeric,currency text,payment_status text,payment_methods jsonb,stock_hold_expires_at timestamptz,pickup_point_snapshot jsonb)
language plpgsql security definer set search_path='' as $$
declare v_items jsonb:=p_items;
begin
  if p_client_request_id is not null and exists(select 1 from public.orders where payment_idempotency_key=p_client_request_id) then
    return query select * from private.create_online_campaign_order_before_auto_matching(p_campaign_id,p_items,p_fulfillment_method,p_pickup_point_id,p_customer_name,p_customer_email,p_customer_phone,p_shipping_address,p_customer_note,p_client_request_id,p_reward_choices,p_promotion_choices,p_expected_pricing_hash,p_accept_exhausted_rewards);
    return;
  end if;
  if private.has_auto_bundles(null,p_campaign_id) then
  v_items:=private.normalize_sale_bundle_items(null,null,p_campaign_id,p_items)->'items';
  perform set_config('nireq.auto_bundle_normalized_hash',encode(extensions.digest(convert_to(v_items::text,'UTF8'),'sha256'),'hex'),true);
  end if;
  return query select * from private.create_online_campaign_order_before_auto_matching(p_campaign_id,v_items,p_fulfillment_method,p_pickup_point_id,p_customer_name,p_customer_email,p_customer_phone,p_shipping_address,p_customer_note,p_client_request_id,p_reward_choices,p_promotion_choices,p_expected_pricing_hash,p_accept_exhausted_rewards);
end $$;

alter function public.complete_order_with_stock(uuid,text,uuid,jsonb,jsonb,text,boolean) set schema private;
alter function private.complete_order_with_stock(uuid,text,uuid,jsonb,jsonb,text,boolean) rename to complete_order_with_stock_before_auto_matching;
create function public.complete_order_with_stock(
  p_order_id uuid,p_payment_method text,p_payment_idempotency_key uuid default null,
  p_reward_choices jsonb default '[]',p_promotion_choices jsonb default '[]',
  p_expected_pricing_hash text default null,p_accept_exhausted_rewards boolean default false
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_event uuid; v_artist uuid; v_status text; v_raw jsonb; v_items jsonb;
begin
  select o.event_id,e.artist_id,o.status into v_event,v_artist,v_status
  from public.orders o left join public.events e on e.id=o.event_id where o.id=p_order_id;
  if v_status<>'completed' and (auth.uid() is null or not public.has_artist_role(v_artist,array['owner','queue_pos'])) then
    return private.complete_order_with_stock_before_auto_matching(p_order_id,p_payment_method,p_payment_idempotency_key,p_reward_choices,p_promotion_choices,p_expected_pricing_hash,p_accept_exhausted_rewards);
  end if;
  if v_status<>'completed' and v_event is not null and private.has_auto_bundles(v_event) and exists(select 1 from public.event_products where event_id=v_event) then
    perform set_config('nireq.production_quote_order',p_order_id::text,true);
    select coalesce(jsonb_agg(jsonb_build_object('product_id',x.product_id,'quantity',x.quantity,'notes',x.notes) order by x.product_id),'[]'::jsonb)
    into v_raw from (
      select oi.product_id,sum(oi.quantity)::integer quantity,max(oi.notes) notes
      from public.order_items oi where oi.order_id=p_order_id and oi.line_type='purchase' group by oi.product_id
    ) x;
    if jsonb_array_length(v_raw)>0 then
      v_items:=private.normalize_sale_bundle_items(v_event,'live',null,v_raw)->'items';
      perform set_config('nireq.auto_bundle_normalized_hash',encode(extensions.digest(convert_to(v_items::text,'UTF8'),'sha256'),'hex'),true);
      if (select jsonb_object_agg(x->>'product_id',(x->>'quantity')::integer) from jsonb_array_elements(v_raw)x)
         is distinct from
         (select jsonb_object_agg(x->>'product_id',(x->>'quantity')::integer) from jsonb_array_elements(v_items)x) then
        perform public.sync_customer_order_items_with_stock(p_order_id,v_items,null);
      end if;
    end if;
  end if;
  return private.complete_order_with_stock_before_auto_matching(p_order_id,p_payment_method,p_payment_idempotency_key,p_reward_choices,p_promotion_choices,p_expected_pricing_hash,p_accept_exhausted_rewards);
end $$;

revoke all on function
  private.create_customer_order_with_stock_before_auto_matching(uuid,jsonb,uuid),
  private.sync_customer_order_items_with_stock_before_auto_matching(uuid,jsonb,uuid),
  private.create_walkin_order_with_stock_before_auto_matching(uuid,jsonb,text,uuid,jsonb,jsonb,text,boolean),
  private.create_preorder_with_stock_before_auto_matching(uuid,jsonb,text,text,text,uuid,text,text,text,text,jsonb,jsonb,text,boolean),
  private.create_online_campaign_order_before_auto_matching(uuid,jsonb,text,uuid,text,text,text,text,text,uuid,jsonb,jsonb,text,boolean),
  private.complete_order_with_stock_before_auto_matching(uuid,text,uuid,jsonb,jsonb,text,boolean)
from public,anon,authenticated;

revoke all on function public.create_customer_order_with_stock(uuid,jsonb,uuid) from public;
grant execute on function public.create_customer_order_with_stock(uuid,jsonb,uuid) to anon,authenticated,service_role;
revoke all on function public.sync_customer_order_items_with_stock(uuid,jsonb,uuid) from public,anon;
grant execute on function public.sync_customer_order_items_with_stock(uuid,jsonb,uuid) to authenticated,service_role;
revoke all on function public.create_walkin_order_with_stock(uuid,jsonb,text,uuid,jsonb,jsonb,text,boolean) from public,anon;
grant execute on function public.create_walkin_order_with_stock(uuid,jsonb,text,uuid,jsonb,jsonb,text,boolean) to authenticated,service_role;
revoke all on function public.create_preorder_with_stock(uuid,jsonb,text,text,text,uuid,text,text,text,text,jsonb,jsonb,text,boolean) from public;
grant execute on function public.create_preorder_with_stock(uuid,jsonb,text,text,text,uuid,text,text,text,text,jsonb,jsonb,text,boolean) to anon,authenticated,service_role;
revoke all on function public.create_online_campaign_order(uuid,jsonb,text,uuid,text,text,text,text,text,uuid,jsonb,jsonb,text,boolean) from public;
grant execute on function public.create_online_campaign_order(uuid,jsonb,text,uuid,text,text,text,text,text,uuid,jsonb,jsonb,text,boolean) to anon,authenticated,service_role;
revoke all on function public.complete_order_with_stock(uuid,text,uuid,jsonb,jsonb,text,boolean) from public,anon;
grant execute on function public.complete_order_with_stock(uuid,text,uuid,jsonb,jsonb,text,boolean) to authenticated,service_role;

-- Offline receipts keep the submitted payload for retry identity, while both the
-- checkout and receipt comparison use the same canonical cart.
create or replace function public.apply_offline_operation(p_id uuid,p_event_id uuid,p_device_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_existing public.offline_operations; v_artist uuid; v_device public.offline_devices;
  v_order uuid; v_queue public.queues; v_reason text; v_status text:='applied'; v_total numeric;
  v_expected jsonb; v_actual jsonb; v_items jsonb;
begin
  if p_id is null or p_device_id is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>65536 then raise exception 'invalid_operation'; end if;
  if not public.has_event_role(p_event_id,array['owner','manager','seller']) then raise exception 'forbidden'; end if;
  select artist_id into v_artist from public.events where id=p_event_id;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select * into v_existing from public.offline_operations where id=p_id;
  if found then
    if v_existing.event_id<>p_event_id or v_existing.device_id<>p_device_id or v_existing.payload<>p_payload then raise exception 'operation_request_conflict'; end if;
    return to_jsonb(v_existing);
  end if;
  select * into v_device from public.offline_devices where event_id=p_event_id for update;
  begin
    if v_device.released or v_device.device_id is distinct from p_device_id or v_device.actor_id is distinct from auth.uid() then raise exception 'another_primary_device'; end if;
    if p_payload->>'kind'='queue' then
      select * into v_queue from public.queues where event_id=p_event_id
        and queue_service_date=(p_payload->>'service_date')::date and queue_number=(p_payload->>'queue_number')::integer for update;
      if not found then raise exception 'queue_not_found'; end if;
      if p_payload->>'status' not in ('calling','serving','complete','missed','waiting') then raise exception 'invalid_queue_status'; end if;
      if v_queue.status is distinct from p_payload->>'expected_status' then raise exception 'queue_changed'; end if;
      if not (
        (p_payload->>'status'='calling' and v_queue.status in ('waiting','queued')) or
        (p_payload->>'status'='serving' and v_queue.status='calling') or
        (p_payload->>'status'='complete' and (v_queue.status='serving' or (v_queue.status in ('waiting','calling') and p_payload->>'observed_queue'='true'))) or
        (p_payload->>'status'='missed' and v_queue.status in ('waiting','queued','calling')) or
        (p_payload->>'status'='waiting' and v_queue.status in ('missed','expired','calling'))
      ) then raise exception 'invalid_queue_status'; end if;
      update public.queues set status=p_payload->>'status',last_updated_at=now(),
        called_at=case when p_payload->>'status'='calling' then now() else called_at end,
        served_at=case when p_payload->>'status'='serving' then now() else served_at end,
        completed_at=case when p_payload->>'status'='complete' then now() else completed_at end where id=v_queue.id;
    elsif p_payload->>'kind'='sale' then
      v_total:=(p_payload->>'collected_total')::numeric;
      if v_total is null or v_total<0 or v_total>10000000 or v_total<>round(v_total,2) or p_payload->>'method' not in ('cash','transfer') then raise exception 'invalid_sale'; end if;
      v_items:=p_payload->'items';
      if private.has_auto_bundles(p_event_id) and exists(select 1 from public.event_products where event_id=p_event_id) then
        v_items:=private.normalize_sale_bundle_items(p_event_id,'live',null,v_items)->'items';
        perform set_config('nireq.auto_bundle_normalized_hash',encode(extensions.digest(convert_to(v_items::text,'UTF8'),'sha256'),'hex'),true);
      end if;
      select id into v_order from public.orders where payment_idempotency_key=p_id and event_id=p_event_id and status='completed';
      if v_order is null then
        if p_payload->>'order_id' is not null then
          select id into v_order from public.orders where id=(p_payload->>'order_id')::uuid and event_id=p_event_id for update;
          if not found then raise exception 'order_not_found'; end if;
          perform public.sync_customer_order_items_with_stock(v_order,v_items,p_id);
        elsif p_payload->>'queue_number' is not null then
          select * into v_queue from public.queues where event_id=p_event_id and queue_service_date=(p_payload->>'service_date')::date
            and queue_number=(p_payload->>'queue_number')::integer for update;
          if not found then raise exception 'queue_not_found'; end if;
          if v_queue.status in ('complete','missed','expired') then raise exception 'queue_changed'; end if;
          v_order:=public.create_customer_order_with_stock(v_queue.id,v_items,p_id);
        end if;
        if v_order is not null then
          perform public.complete_order_with_stock(v_order,p_payload->>'method',p_id,coalesce(p_payload->'reward_choices','[]'),coalesce(p_payload->'promotion_choices','[]'),p_payload->>'expected_pricing_hash',coalesce((p_payload->>'accept_exhausted_rewards')::boolean,false));
        else
          v_order:=public.create_walkin_order_with_stock(p_event_id,v_items,p_payload->>'method',p_id,coalesce(p_payload->'reward_choices','[]'),coalesce(p_payload->'promotion_choices','[]'),p_payload->>'expected_pricing_hash',coalesce((p_payload->>'accept_exhausted_rewards')::boolean,false));
        end if;
      end if;
      if (select total_price from public.orders where id=v_order)<>v_total or (p_payload->>'currency' is not null and (select currency from public.orders where id=v_order)<>p_payload->>'currency') then raise exception 'price_changed'; end if;
      if (select payment_method from public.orders where id=v_order) is distinct from p_payload->>'method' then raise exception 'receipt_changed'; end if;
      select jsonb_object_agg(product_id,quantity) into v_expected from (
        select item->>'product_id' product_id,sum((item->>'quantity')::integer) quantity from jsonb_array_elements(v_items) item group by item->>'product_id'
      ) expected;
      select jsonb_object_agg(product_id,quantity) into v_actual from (
        select product_id,sum(quantity) quantity from public.order_items where order_id=v_order and line_type='purchase' group by product_id
      ) actual;
      if v_actual is distinct from v_expected then raise exception 'receipt_changed'; end if;
    else raise exception 'invalid_operation'; end if;
  exception when others then
    v_status:='conflict'; v_order:=null;
    v_reason:=case when sqlerrm in ('another_primary_device','queue_not_found','queue_changed','price_changed','insufficient_stock','promotion_choice_required','promotion_rewards_exhausted','event_not_active','booth_closed','invalid_sale','invalid_queue_status','invalid_operation') then sqlerrm else 'review_required' end;
  end;
  insert into public.offline_operations(id,event_id,artist_id,device_id,actor_id,payload,status,reason,order_id)
    values(p_id,p_event_id,v_artist,p_device_id,auth.uid(),p_payload,v_status,v_reason,v_order) returning * into v_existing;
  return to_jsonb(v_existing);
end $$;
revoke all on function public.apply_offline_operation(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.apply_offline_operation(uuid,uuid,uuid,jsonb) to authenticated,service_role;
