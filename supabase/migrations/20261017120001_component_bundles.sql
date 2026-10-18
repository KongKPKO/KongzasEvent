-- Bundles own merchandising, while their components own physical inventory.
create table private.bundle_components (
 bundle_id uuid not null references public.products(id) on delete cascade,
 product_id uuid not null references public.products(id),
 quantity integer not null check(quantity between 1 and 10000),
 primary key(bundle_id,product_id), check(bundle_id<>product_id)
);
create table private.bundle_order_components (
 order_item_id uuid not null references public.order_items(id) on delete cascade,
 product_id uuid not null references public.products(id),
 product_name text not null, quantity integer not null check(quantity>0),
 event_product_id uuid references public.event_products(id),
 campaign_product_id uuid references public.online_campaign_products(id),
 source text not null check(source in ('stock','production','untracked')),
 held integer not null default 0 check(held>=0),
 sold integer not null default 0 check(sold>=0),
 consumed integer not null default 0 check(consumed>=0),
 primary key(order_item_id,product_id)
);
alter table private.bundle_components enable row level security;
alter table private.bundle_order_components enable row level security;
revoke all on private.bundle_components,private.bundle_order_components from public,anon,authenticated;
create index bundle_components_product on private.bundle_components(product_id);
create index bundle_order_components_product on private.bundle_order_components(product_id);

create function private.is_component_bundle(p_id uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.bundle_components where bundle_id=p_id)
$$;

create function private.bundle_available(p_id uuid,p_event uuid default null,p_campaign uuid default null)
returns integer language plpgsql stable security definer set search_path='' as $$
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
   if available is not null then result:=least(result,available/r.quantity); end if;
 end loop;
 return result;
end $$;

-- Keep legacy descriptive bundles intact. They must be configured explicitly before
-- acquiring component semantics; references are never guessed from names.
create function public.save_product_bundle(p_parent jsonb,p_components jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare parent public.product_parents; child public.products; artist uuid; r record; items jsonb; result uuid; variant jsonb;
begin
 artist:=(p_parent->>'artist_id')::uuid;
 if auth.uid() is null or not public.has_artist_role(artist,array['owner','manager']) then raise exception 'forbidden'; end if;
 if jsonb_typeof(p_components) is distinct from 'array' or jsonb_array_length(p_components) not between 1 and 100 then raise exception 'invalid_bundle_components'; end if;
 if exists(select 1 from jsonb_array_elements(p_components) x where nullif(x->>'product_id','') is null or coalesce((x->>'quantity')::numeric,0) not between 1 and 10000 or (x->>'quantity')::numeric<>trunc((x->>'quantity')::numeric)) then raise exception 'invalid_bundle_components'; end if;
 if p_parent->>'id' is not null then
   select * into parent from public.product_parents where id=(p_parent->>'id')::uuid for update;
   if parent.artist_id is distinct from artist or parent.product_kind<>'bundle' then raise exception 'invalid_bundle'; end if;
   if (p_parent->>'updated_at')::timestamptz is distinct from parent.updated_at then raise exception 'product_family_changed_reload'; end if;
   if (select count(*) from public.products where parent_product_id=parent.id and deleted_at is null)<>1 then raise exception 'legacy_bundle_requires_single_item'; end if;
   select * into child from public.products where parent_product_id=parent.id and deleted_at is null;
   if not private.is_component_bundle(child.id) and (child.stock_reserved+child.stock_sold>0 or exists(select 1 from public.order_items where product_id=child.id) or exists(select 1 from public.event_products where product_id=child.id) or exists(select 1 from public.online_campaign_products where product_id=child.id)) then raise exception 'legacy_bundle_in_use_create_new'; end if;
 end if;
 perform private.lock_bundle_cart(p_components||case when child.id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('product_id',child.id)) end);
 for r in select (x->>'product_id')::uuid id,sum((x->>'quantity')::integer)::integer qty from jsonb_array_elements(p_components)x group by 1 loop
   if r.qty>10000 or not exists(select 1 from public.products where id=r.id and artist_id=artist and deleted_at is null and product_kind<>'bundle' and currency=coalesce(p_parent->>'currency','THB')) then raise exception 'invalid_bundle_component'; end if;
 end loop;
 select jsonb_agg(jsonb_build_object('product_id',p.id,'name',p.name,'quantity',s.qty) order by p.name,p.id) into items
 from (select (x->>'product_id')::uuid id,sum((x->>'quantity')::integer)::integer qty from jsonb_array_elements(p_components)x group by 1)s join public.products p on p.id=s.id;
 variant:=jsonb_build_object('name','Default','is_unlimited',true,'stock_total',null,'status',coalesce(p_parent->>'status',child.status,'enable'));
 if child.id is not null then variant:=variant||jsonb_build_object('id',child.id,'updated_at',child.updated_at,'sku',child.sku); end if;
 result:=public.save_product_family(parent.id,p_parent||jsonb_build_object('product_kind','bundle','bundle_items',items),jsonb_build_array(variant));
 select * into child from public.products where parent_product_id=result and deleted_at is null;
 delete from private.bundle_components where bundle_id=child.id;
 insert into private.bundle_components(bundle_id,product_id,quantity) select child.id,(x->>'product_id')::uuid,(x->>'quantity')::integer from jsonb_array_elements(items)x;
 return result;
end $$;
revoke all on function public.save_product_bundle(jsonb,jsonb) from public,anon;
grant execute on function public.save_product_bundle(jsonb,jsonb) to authenticated;

-- Delta application uses existing allocation counters. Component stocks are locked
-- alongside checkout, so selling a component separately cannot oversell a bundle.
create function private.bundle_stock_delta(p_product uuid,p_event_product uuid,p_campaign_product uuid,p_held integer,p_sold integer)
returns void language plpgsql security definer set search_path='' as $$
declare free integer; unlimited boolean;
begin
 perform 1 from public.products where id=p_product for update;
 if p_campaign_product is not null then
   select is_unlimited,stock_total-stock_reserved-stock_sold into unlimited,free from public.online_campaign_products where id=p_campaign_product for update;
 elsif p_event_product is not null then
   select is_unlimited,stock_total-stock_reserved-stock_sold into unlimited,free from public.event_products where id=p_event_product for update;
 else
   select is_unlimited into unlimited from public.products where id=p_product;
   free:=private.catalog_free_stock(p_product);
 end if;
 if not coalesce(unlimited,false) and p_held+p_sold>coalesce(free,0) then raise exception 'insufficient_bundle_component_stock'; end if;
 if p_campaign_product is not null then
   update public.online_campaign_products set stock_reserved=stock_reserved+p_held,stock_sold=stock_sold+p_sold where id=p_campaign_product;
 elsif p_event_product is not null then
   update public.event_products set stock_reserved=stock_reserved+p_held,stock_sold=stock_sold+p_sold where id=p_event_product;
 else
   update public.products set stock_reserved=stock_reserved+p_held,stock_sold=stock_sold+p_sold where id=p_product;
 end if;
end $$;

create function private.sync_bundle_order(p_order uuid) returns void language plpgsql security definer set search_path='' as $$
declare r record; o public.orders; pay text; cancelled boolean; delivered boolean; target_held integer; target_sold integer;
begin
 select * into o from public.orders where id=p_order;
 select payment_status into pay from public.order_payments where order_id=p_order;
 delivered:=o.status='completed' or o.pickup_status in ('picked_up','shipped') or o.shipped_at is not null or o.picked_up_at is not null;
 cancelled:=not delivered and (o.status='cancelled' or coalesce(pay,'') in ('payment_expired','payment_cancelled','payment_rejected','refund_pending','refunded','payment_submitted_late'));
 perform 1 from public.products where id in(select b.product_id from private.bundle_order_components b join public.order_items oi on oi.id=b.order_item_id where oi.order_id=p_order) order by id for update;
 for r in select b.* from private.bundle_order_components b join public.order_items oi on oi.id=b.order_item_id where oi.order_id=p_order order by b.product_id,b.order_item_id for update of b loop
   if r.source='untracked' then
     update private.bundle_order_components set consumed=case when delivered then quantity else consumed end where order_item_id=r.order_item_id and product_id=r.product_id;
   elsif r.source='production' then
     if delivered and r.consumed<r.quantity then
       if pay is distinct from 'payment_confirmed' or r.held<r.quantity-r.consumed then raise exception 'production_stock_not_ready'; end if;
       perform private.bundle_stock_delta(r.product_id,null,null,-r.held,r.quantity-r.consumed);
       update private.bundle_order_components set held=0,sold=quantity,consumed=quantity where order_item_id=r.order_item_id and product_id=r.product_id;
     elsif cancelled and r.held>0 then
       perform private.bundle_stock_delta(r.product_id,null,null,-r.held,0);
       update private.bundle_order_components set held=0 where order_item_id=r.order_item_id and product_id=r.product_id;
     end if;
   else
     -- Campaign stock is sold at payment confirmation, Event stock at handover.
     -- Sold stock is never silently restored by a refund.
     target_sold:=case when delivered or (o.campaign_id is not null and pay='payment_confirmed') then r.quantity else r.sold end;
     target_held:=case when cancelled or target_sold>0 then 0 else r.quantity end;
     perform private.bundle_stock_delta(r.product_id,r.event_product_id,r.campaign_product_id,target_held-r.held,target_sold-r.sold);
     update private.bundle_order_components set held=target_held,sold=target_sold,consumed=case when delivered then quantity else consumed end where order_item_id=r.order_item_id and product_id=r.product_id;
   end if;
 end loop;
end $$;

create function private.snapshot_bundle_components() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.orders; r record; ep public.event_products; cp public.online_campaign_products; source text;
begin
 if not private.is_component_bundle(new.product_id) then
   if exists(select 1 from public.products where id=new.product_id and product_kind='bundle') then raise exception 'bundle_components_required'; end if;
   return new;
 end if;
 select * into o from public.orders where id=new.order_id;
 perform 1 from public.products where id in(select product_id from private.bundle_components where bundle_id=new.product_id) order by id for update;
 for r in select b.*,p.name,p.is_unlimited,p.status,p.deleted_at from private.bundle_components b join public.products p on p.id=b.product_id where b.bundle_id=new.product_id order by b.product_id loop
   if r.status<>'enable' or r.deleted_at is not null then raise exception 'bundle_component_unavailable'; end if;
   ep:=null; cp:=null;
   if new.inventory_source<>'production' then
     if o.campaign_id is not null then
       select * into cp from public.online_campaign_products where campaign_id=o.campaign_id and product_id=r.product_id and is_enabled for update;
       if not found then raise exception 'bundle_component_not_allocated'; end if;
     elsif exists(select 1 from public.event_products where event_id=o.event_id) then
       select * into ep from public.event_products where event_id=o.event_id and product_id=r.product_id and is_enabled for update;
       if not found then raise exception 'bundle_component_not_allocated'; end if;
     end if;
   end if;
   source:=case when new.inventory_source='production' then case when r.is_unlimited then 'untracked' else 'production' end when coalesce(cp.is_unlimited,ep.is_unlimited,r.is_unlimited) then 'untracked' else 'stock' end;
   insert into private.bundle_order_components(order_item_id,product_id,product_name,quantity,event_product_id,campaign_product_id,source)
   values(new.id,r.product_id,r.name,new.quantity*r.quantity,ep.id,cp.id,source);
 end loop;
 perform private.sync_bundle_order(new.order_id);
 return new;
end $$;
create trigger zz_snapshot_bundle_components after insert on public.order_items for each row execute function private.snapshot_bundle_components();
create function private.refresh_bundle_order() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.sync_bundle_order(case when tg_table_name='orders' then new.id else (to_jsonb(new)->>'order_id')::uuid end);
 return new;
end $$;
create trigger zz_refresh_bundle_order after update of status,pickup_status on public.orders for each row execute function private.refresh_bundle_order();
create trigger zz_refresh_bundle_payment after update of payment_status on public.order_payments for each row execute function private.refresh_bundle_order();
create function private.release_bundle_item() returns trigger language plpgsql security definer set search_path='' as $$
declare r record;
begin
 for r in select * from private.bundle_order_components where order_item_id=old.id order by product_id loop
   if r.sold>0 or r.consumed>0 then raise exception 'bundle_item_already_sold'; end if;
   if r.held>0 then perform private.bundle_stock_delta(r.product_id,r.event_product_id,r.campaign_product_id,-r.held,0); end if;
 end loop;
 return old;
end $$;
create trigger release_bundle_item before delete on public.order_items for each row execute function private.release_bundle_item();

-- Future product creation has two presentation formats. Old metadata remains
-- archived, but sales timing comes exclusively from the channel.
update public.product_parents set product_kind='single',updated_at=clock_timestamp() where product_kind in ('preorder','service');
update public.products set product_kind='single' where product_kind in ('preorder','service');
drop trigger check_product_preorder_close on public.order_items;
alter function public.save_product_family(uuid,jsonb,jsonb) rename to save_product_family_legacy;
alter function public.save_product_family_legacy(uuid,jsonb,jsonb) set schema private;
revoke all on function private.save_product_family_legacy(uuid,jsonb,jsonb) from public,anon,authenticated;
create function public.save_product_family(p_parent_id uuid,p_parent jsonb,p_variants jsonb) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.products where parent_product_id=p_parent_id and private.is_component_bundle(id)) then raise exception 'use_bundle_editor'; end if;
 if coalesce(p_parent->>'product_kind','single') in ('preorder','service') then p_parent:=p_parent||jsonb_build_object('product_kind','single'); end if;
 return private.save_product_family_legacy(p_parent_id,p_parent,p_variants);
end $$;
revoke all on function public.save_product_family(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.save_product_family(uuid,jsonb,jsonb) to authenticated;
do $$ declare d text; begin
 select pg_get_functiondef('public.save_product_bundle(jsonb,jsonb)'::regprocedure) into d;
 execute replace(d,'public.save_product_family(parent.id','private.save_product_family_legacy(parent.id');
end $$;

-- Direct legacy writers cannot change a linked bundle into its own stock pool.
create function private.guard_bundle_stock() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if private.is_component_bundle(new.id) and (not new.is_unlimited or new.stock_total is not null or new.product_kind<>'bundle') then raise exception 'bundle_uses_component_stock'; end if;
 if tg_op='UPDATE' and not old.is_unlimited and new.is_unlimited and exists(select 1 from private.bundle_order_components b join public.order_items oi on oi.id=b.order_item_id join public.orders o on o.id=oi.order_id where b.product_id=new.id and b.source='production' and b.consumed<b.quantity and private.production_order_active(o.id)) then raise exception 'allocated_variant_stock_mode_locked'; end if;
 if tg_op='UPDATE' and old.is_unlimited and not new.is_unlimited and exists(select 1 from private.bundle_order_components b join public.order_items oi on oi.id=b.order_item_id join public.orders o on o.id=oi.order_id where b.product_id=new.id and b.source='untracked' and b.consumed=0 and o.status not in ('cancelled','completed')) then raise exception 'finish_untracked_bundle_orders_first'; end if;
 return new;
end $$;
create trigger zz_guard_bundle_stock before update on public.products for each row execute function private.guard_bundle_stock();

-- Receipts and explicit transfers cover ordinary and bundle production demands
-- in one chronological queue. Confirming payment supplies no existing ready stock.
alter function private.refresh_production_stock(uuid,integer) rename to refresh_production_stock_before_bundles;
create function private.refresh_production_stock(p_product_id uuid,p_supply integer default 0) returns void
language plpgsql security definer set search_path='' as $$
declare p public.products; r record; delta integer; delivered boolean; confirmed boolean;
 supply_left integer:=greatest(coalesce(p_supply,0),0);
begin
 select * into p from public.products where id=p_product_id for update;
 -- Retain production cap validation when a late payment is reactivated.
 for r in select sum(oi.quantity)::integer used,
   case when o.campaign_id is not null then cp.production_limit when o.order_type='preorder' then ep.preorder_production_limit else ep.postorder_production_limit end cap
   from public.order_items oi join public.orders o on o.id=oi.order_id
   left join public.event_products ep on ep.id=oi.event_product_id left join public.online_campaign_products cp on cp.id=oi.campaign_product_id
   where oi.product_id=p_product_id and oi.inventory_source='production' and private.production_order_active(o.id)
   group by o.campaign_id,o.event_id,o.order_type,cp.production_limit,ep.preorder_production_limit,ep.postorder_production_limit
 loop
   if r.cap is not null and r.used>r.cap then raise exception 'production_limit_exceeded'; end if;
 end loop;
 if p.is_unlimited then
   update private.production_stock ps set allocated=oi.quantity,consumed=oi.quantity
   from public.order_items oi join public.orders o on o.id=oi.order_id
   where ps.order_item_id=oi.id and ps.product_id=p_product_id and ps.consumed<oi.quantity
   and (o.status='completed' or o.pickup_status in ('picked_up','shipped'));
   perform private.touch_production_channels(p_product_id);
   return;
 end if;
 -- Released earmarks remain production supply; they do not consume ready stock.
 for r in
   select ps.order_item_id,ps.allocated-ps.consumed held,false bundle from private.production_stock ps
   join public.order_items oi on oi.id=ps.order_item_id join public.orders o on o.id=oi.order_id left join public.order_payments op on op.order_id=o.id
   where ps.product_id=p_product_id and ps.allocated>ps.consumed and ps.consumed=0
   and (o.status='cancelled' or op.payment_status in ('payment_expired','payment_cancelled','payment_rejected','refund_pending','refunded'))
   and o.status<>'completed' and o.pickup_status not in ('picked_up','shipped')
   union all
   select b.order_item_id,b.held,true from private.bundle_order_components b
   join public.order_items oi on oi.id=b.order_item_id join public.orders o on o.id=oi.order_id left join public.order_payments op on op.order_id=o.id
   where b.product_id=p_product_id and b.source='production' and b.held>0 and b.consumed=0
   and (o.status='cancelled' or op.payment_status in ('payment_expired','payment_cancelled','payment_rejected','refund_pending','refunded'))
   and o.status<>'completed' and o.pickup_status not in ('picked_up','shipped')
 loop
   supply_left:=supply_left+r.held;
   update public.products set stock_reserved=stock_reserved-r.held where id=p_product_id;
   if r.bundle then update private.bundle_order_components set held=0 where order_item_id=r.order_item_id and product_id=p_product_id;
   else update private.production_stock set allocated=consumed where order_item_id=r.order_item_id; end if;
 end loop;
 for r in select * from (
   select ps.order_item_id,oi.quantity,ps.allocated,ps.consumed,false bundle,o.created_at,o.id order_id,o.status,o.pickup_status,op.payment_status
   from private.production_stock ps join public.order_items oi on oi.id=ps.order_item_id join public.orders o on o.id=oi.order_id left join public.order_payments op on op.order_id=o.id
   where ps.product_id=p_product_id and not private.is_component_bundle(oi.product_id)
   union all
   select b.order_item_id,b.quantity,b.held+b.consumed,b.consumed,true,o.created_at,o.id,o.status,o.pickup_status,op.payment_status
   from private.bundle_order_components b join public.order_items oi on oi.id=b.order_item_id join public.orders o on o.id=oi.order_id left join public.order_payments op on op.order_id=o.id
   where b.product_id=p_product_id and b.source='production'
 ) demands order by created_at,order_id,order_item_id
 loop
   delivered:=r.status='completed' or r.pickup_status in ('picked_up','shipped');
   confirmed:=r.payment_status='payment_confirmed';
   if (confirmed or delivered) and r.status<>'cancelled' then
     delta:=least(r.quantity-r.allocated,private.catalog_free_stock(p_product_id),supply_left);
     if delta>0 then
       update public.products set stock_reserved=stock_reserved+delta where id=p_product_id;
       if r.bundle then
         update private.bundle_order_components set held=held+delta where order_item_id=r.order_item_id and product_id=p_product_id;
         insert into private.inventory_events(product_id,actor_id,kind,quantity_before,quantity_after,order_item_id)
         values(p_product_id,auth.uid(),'bundle_production_earmark',r.allocated-r.consumed,r.allocated-r.consumed+delta,r.order_item_id);
       else update private.production_stock set allocated=allocated+delta where order_item_id=r.order_item_id; end if;
       supply_left:=supply_left-delta;
     end if;
     if delivered and not r.bundle and r.consumed<r.quantity then
       if not coalesce(confirmed,false) then raise exception 'payment_not_confirmed'; end if;
       if r.allocated+delta<r.quantity then raise exception 'production_stock_not_ready'; end if;
       update public.products set stock_reserved=stock_reserved-(r.quantity-r.consumed),stock_sold=stock_sold+(r.quantity-r.consumed) where id=p_product_id;
       update private.production_stock set consumed=r.quantity where order_item_id=r.order_item_id;
     end if;
   end if;
 end loop;
 perform private.touch_production_channels(p_product_id);
end $$;
create or replace function private.refresh_order_production() returns trigger language plpgsql security definer set search_path='' as $$
declare product uuid; v_order_id uuid;
begin
 if tg_table_name='orders' then v_order_id:=new.id; else v_order_id:=(to_jsonb(new)->>'order_id')::uuid; end if;
 for product in select id from (
   select oi.product_id id from public.order_items oi where oi.order_id=v_order_id and exists(select 1 from private.production_stock ps where ps.order_item_id=oi.id)
   union select b.product_id from private.bundle_order_components b join public.order_items oi on oi.id=b.order_item_id where oi.order_id=v_order_id and b.source='production'
 ) products order by id loop perform private.refresh_production_stock(product); end loop;
 return new;
end $$;
-- Include component earmarks in the idempotent manual-transfer result.
do $$ declare d text; begin
 select pg_get_functiondef('private.assign_production_stock(uuid,integer,uuid)'::regprocedure) into d;
 d:=replace(d,'from private.production_stock where product_id=p_product_id;', 'from (select allocated-consumed amount from private.production_stock where product_id=p_product_id union all select held from private.bundle_order_components where product_id=p_product_id and source=''production'') s;');
 d:=replace(d,'sum(allocated-consumed)','sum(amount)');
 execute d;
end $$;

-- Public availability uses the component pool; production caps still count bundles.
alter function private.event_supply_available(uuid,uuid,text) rename to event_supply_available_before_bundles;
create function private.event_supply_available(p_event_id uuid,p_product_id uuid,p_phase text) returns integer language plpgsql stable set search_path='' as $$
begin
 if exists(select 1 from public.products where id=p_product_id and product_kind='bundle') and not private.is_component_bundle(p_product_id) then return 0; end if;
 if private.is_component_bundle(p_product_id) and not private.event_production(p_event_id,p_product_id,p_phase) then return private.bundle_available(p_product_id,p_event_id,null); end if;
 return private.event_supply_available_before_bundles(p_event_id,p_product_id,p_phase);
end $$;
alter function private.campaign_supply_available(uuid,uuid) rename to campaign_supply_available_before_bundles;
create function private.campaign_supply_available(p_campaign_id uuid,p_product_id uuid) returns integer language plpgsql stable set search_path='' as $$
begin
 if exists(select 1 from public.products where id=p_product_id and product_kind='bundle') and not private.is_component_bundle(p_product_id) then return 0; end if;
 if private.is_component_bundle(p_product_id) and not private.campaign_production(p_campaign_id,p_product_id) then return private.bundle_available(p_product_id,null,p_campaign_id); end if;
 return private.campaign_supply_available_before_bundles(p_campaign_id,p_product_id);
end $$;

create function public.bundle_stock_preview(p_artist_id uuid,p_event_id uuid default null,p_campaign_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_artist_role(p_artist_id,array['owner','manager']) then raise exception 'forbidden'; end if;
 if num_nonnulls(p_event_id,p_campaign_id)>1 or (p_event_id is not null and not exists(select 1 from public.events where id=p_event_id and artist_id=p_artist_id)) or (p_campaign_id is not null and not exists(select 1 from public.online_campaigns where id=p_campaign_id and artist_id=p_artist_id)) then raise exception 'invalid_channel'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('product_id',p.id,'available',private.bundle_available(p.id,p_event_id,p_campaign_id),'configured',private.is_component_bundle(p.id))) from public.products p where p.artist_id=p_artist_id and p.product_kind='bundle' and p.deleted_at is null),'[]');
end $$;
revoke all on function public.bundle_stock_preview(uuid,uuid,uuid) from public,anon;
grant execute on function public.bundle_stock_preview(uuid,uuid,uuid) to authenticated;

-- Do not leave new internal helpers callable through PostgREST's exposed schemas.
do $$ declare r record; begin
 for r in select p.oid::regprocedure f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and (p.proname like '%bundle%' or p.proname in ('event_supply_available','campaign_supply_available','refresh_production_stock')) loop
   execute format('revoke all on function %s from public,anon,authenticated',r.f);
 end loop;
end $$;
notify pgrst,'reload schema';

alter function public.save_product_bundle(jsonb,jsonb) set schema private;
create function public.save_product_bundle(p_parent jsonb,p_components jsonb) returns uuid
language sql security invoker set search_path='' as $$ select private.save_product_bundle(p_parent,p_components) $$;
alter function public.bundle_stock_preview(uuid,uuid,uuid) set schema private;
create function public.bundle_stock_preview(p_artist_id uuid,p_event_id uuid default null,p_campaign_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$ select private.bundle_stock_preview(p_artist_id,p_event_id,p_campaign_id) $$;
revoke all on function public.save_product_bundle(jsonb,jsonb),private.save_product_bundle(jsonb,jsonb),public.bundle_stock_preview(uuid,uuid,uuid),private.bundle_stock_preview(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_product_bundle(jsonb,jsonb),private.save_product_bundle(jsonb,jsonb),public.bundle_stock_preview(uuid,uuid,uuid),private.bundle_stock_preview(uuid,uuid,uuid) to authenticated;

-- Lock the complete cart/component set in one order before any per-item locks.
-- Include possible promotion rewards so a gift bundle cannot reverse that order.
create function private.lock_bundle_cart(p_items jsonb,p_existing_order uuid default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if jsonb_typeof(p_items) is distinct from 'array' then return; end if;
 perform 1 from public.products p where p.id in (
   with requested as (
     select (x->>'product_id')::uuid id from jsonb_array_elements(p_items)x
     union select product_id from public.order_items where order_id=p_existing_order
   ), rewards as (
     select r.product_id id from public.promotion_reward_products r join public.artist_promotions ap on ap.id=r.promotion_id
     where ap.artist_id in(select artist_id from public.products where id in(select id from requested))
   ), all_items as (select id from requested union select id from rewards)
   select id from all_items
   union select product_id from private.bundle_components where bundle_id in(select id from all_items)
   union select b.product_id from private.bundle_order_components b join public.order_items oi on oi.id=b.order_item_id where oi.order_id=p_existing_order
 ) order by p.id for update;
end $$;
revoke all on function private.lock_bundle_cart(jsonb,uuid) from public,anon,authenticated;
do $$ declare r record; d text; patched text; existing text; begin
 for r in select p.oid,p.proname,p.proargnames from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.proname in ('create_customer_order_with_stock','sync_customer_order_items_with_stock','create_walkin_order_with_stock_base','create_preorder_with_stock_base','create_online_campaign_order_base') loop
   select pg_get_functiondef(r.oid) into d;
   existing:=case when 'p_order_id'=any(r.proargnames) then 'p_order_id' else 'null' end;
   patched:=regexp_replace(d,'for v_(existing_item|item) in','perform private.lock_bundle_cart(p_items,'||existing||');'||chr(10)||'  for v_\1 in','i');
   if patched=d then raise exception 'bundle_cart_lock_patch_missing: %',r.proname; end if;
   execute patched;
 end loop;
end $$;

-- Publish receipt readiness changes to the bundle's channel as well as its SKU.
alter function private.touch_production_channels(uuid) rename to touch_production_channels_before_bundles;
create function private.touch_production_channels(p_product_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.touch_production_channels_before_bundles(p_product_id);
 update public.event_products ep set updated_at=clock_timestamp() where exists(
   select 1 from private.bundle_order_components b join public.order_items oi on oi.id=b.order_item_id join public.orders o on o.id=oi.order_id
   where b.product_id=p_product_id and b.source='production' and oi.product_id=ep.product_id and o.event_id=ep.event_id);
 update public.online_campaign_products cp set updated_at=clock_timestamp() where exists(
   select 1 from private.bundle_order_components b join public.order_items oi on oi.id=b.order_item_id join public.orders o on o.id=oi.order_id
   where b.product_id=p_product_id and b.source='production' and oi.product_id=cp.product_id and o.campaign_id=cp.campaign_id);
end $$;
revoke all on function private.touch_production_channels(uuid),private.touch_production_channels_before_bundles(uuid) from public,anon,authenticated;
