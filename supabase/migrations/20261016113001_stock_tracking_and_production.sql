-- Supply policy belongs to a sales phase, not to the catalog's stock tracking switch.
alter table public.event_products
  add column preorder_supply_mode text not null default 'stock' check(preorder_supply_mode in ('stock','production')),
  add column preorder_production_limit integer check(preorder_production_limit > 0),
  add column postorder_supply_mode text not null default 'stock' check(postorder_supply_mode in ('stock','production')),
  add column postorder_production_limit integer check(postorder_production_limit > 0);
alter table public.online_campaign_products
  add column supply_mode text not null default 'stock' check(supply_mode in ('stock','production')),
  add column production_limit integer check(production_limit > 0);
alter table public.order_items add column inventory_source text not null default 'stock'
  check(inventory_source in ('stock','production','untracked'));

-- Earmarks are internal: only the transaction engine may assign or consume physical units.
create table private.production_stock (
  order_item_id uuid primary key references public.order_items(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  allocated integer not null default 0 check(allocated >= 0),
  consumed integer not null default 0 check(consumed >= 0 and consumed <= allocated)
);
revoke all on private.production_stock from public,anon,authenticated;
create index production_stock_product on private.production_stock(product_id);

create function private.event_production(p_event_id uuid,p_product_id uuid,p_phase text)
returns boolean language sql stable set search_path='' as $$
  select coalesce((select case when p_phase in ('preorder') then ep.preorder_supply_mode='production'
    when p_phase in ('postorder','post_event') then ep.postorder_supply_mode='production' else false end
    from public.event_products ep where ep.event_id=p_event_id and ep.product_id=p_product_id),false)
$$;
create function private.campaign_production(p_campaign_id uuid,p_product_id uuid)
returns boolean language sql stable set search_path='' as $$
  select coalesce((select cp.supply_mode='production' from public.online_campaign_products cp
    where cp.campaign_id=p_campaign_id and cp.product_id=p_product_id),false)
$$;

-- One capacity calculation for production earmarks and existing allocation enforcement.
create function private.catalog_channel_commitments(p_product_id uuid) returns integer language sql stable set search_path='' as $$
 select coalesce((select sum(s.sold+s.committed) from (
    select ep.stock_sold sold, ep.stock_reserved + case when ep.is_enabled and not ep.is_unlimited
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
revoke all on function private.catalog_channel_commitments(uuid) from public,anon,authenticated;

create function private.catalog_free_stock(p_product_id uuid)
returns integer language sql stable set search_path='' as $$
 select greatest(coalesce(p.stock_total,0)-p.stock_sold-p.stock_reserved-coalesce((
   select sum(s.sold+s.committed) from (
    select ep.stock_sold sold, ep.stock_reserved + case when ep.is_enabled and not ep.is_unlimited
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

create function private.production_order_active(p_order_id uuid)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.orders o left join public.order_payments op on op.order_id=o.id
   where o.id=p_order_id and (o.status='completed' or o.pickup_status in ('picked_up','shipped') or o.picked_up_at is not null or o.shipped_at is not null or (o.status<>'cancelled' and coalesce(op.payment_status,'awaiting_payment')
     not in ('payment_expired','payment_cancelled','payment_rejected','refunded','refund_pending','payment_submitted_late')
   and (op.payment_status is distinct from 'awaiting_payment' or op.stock_hold_expires_at is null or op.stock_hold_expires_at>now() or op.upload_grace_expires_at>now()))))
$$;

create function private.production_remaining(p_event_id uuid,p_campaign_id uuid,p_product_id uuid,p_phase text)
returns integer language plpgsql stable set search_path='' as $$
declare cap integer; used integer;
begin
 if p_campaign_id is not null then
   select production_limit into cap from public.online_campaign_products where campaign_id=p_campaign_id and product_id=p_product_id;
 else
   select case when p_phase='preorder' then preorder_production_limit else postorder_production_limit end into cap
     from public.event_products where event_id=p_event_id and product_id=p_product_id;
 end if;
 if cap is null then return null; end if;
 select coalesce(sum(oi.quantity),0)::integer into used from public.order_items oi join public.orders o on o.id=oi.order_id
 where oi.product_id=p_product_id and oi.inventory_source='production' and private.production_order_active(o.id)
 and o.id is distinct from nullif(current_setting('nireq.production_quote_order',true),'')::uuid
 and ((p_campaign_id is not null and o.campaign_id=p_campaign_id) or (p_event_id is not null and o.event_id=p_event_id
   and o.order_type=case when p_phase='preorder' then 'preorder' else 'post_event' end));
 return greatest(cap-used,0);
end $$;

create function private.snapshot_inventory_source() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.orders; p public.products; production boolean; remaining integer;
begin
 if tg_op='UPDATE' then
   if new.inventory_source is distinct from old.inventory_source or new.product_id is distinct from old.product_id
     or new.order_id is distinct from old.order_id or new.quantity is distinct from old.quantity then
     raise exception 'inventory_item_snapshot_immutable';
   end if;
   return new;
 end if;
 select * into o from public.orders where id=new.order_id;
 select * into p from public.products where id=new.product_id for update;
 production:=case when o.campaign_id is not null then private.campaign_production(o.campaign_id,new.product_id)
   else private.event_production(o.event_id,new.product_id,o.order_type) end;
 new.inventory_source:=case when production then 'production' when p.is_unlimited then 'untracked' else 'stock' end;
 if production then
   remaining:=private.production_remaining(o.event_id,o.campaign_id,new.product_id,case when o.order_type='preorder' then 'preorder' else 'postorder' end);
   if remaining is not null and new.quantity>remaining then raise exception 'production_limit_exceeded'; end if;
 end if;
 return new;
end $$;
create trigger snapshot_inventory_source before insert or update on public.order_items
 for each row execute function private.snapshot_inventory_source();
create function private.record_production_item() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.orders; cap integer; used integer;
begin
 if new.inventory_source='production' then
   select * into o from public.orders where id=new.order_id;
   if o.campaign_id is not null then select production_limit into cap from public.online_campaign_products where id=new.campaign_product_id;
   else select case when o.order_type='preorder' then preorder_production_limit else postorder_production_limit end into cap from public.event_products where id=new.event_product_id; end if;
   if cap is not null then
     select coalesce(sum(oi.quantity),0)::integer into used from public.order_items oi join public.orders other on other.id=oi.order_id
     where oi.product_id=new.product_id and oi.inventory_source='production' and private.production_order_active(other.id)
     and ((o.campaign_id is not null and other.campaign_id=o.campaign_id) or (o.event_id is not null and other.event_id=o.event_id and other.order_type=o.order_type));
     if used>cap then raise exception 'production_limit_exceeded'; end if;
   end if;
   insert into private.production_stock(order_item_id,product_id) values(new.id,new.product_id);
   perform private.touch_production_channels(new.product_id);
 end if;
 return new;
end $$;
create trigger record_production_item after insert on public.order_items for each row execute function private.record_production_item();

create function private.refresh_production_stock(p_product_id uuid,p_supply integer default 0) returns void
language plpgsql security definer set search_path='' as $$
declare p public.products; r record; delta integer; delivered boolean; confirmed boolean; supply_left integer:=greatest(coalesce(p_supply,0),0);
begin
 select * into p from public.products where id=p_product_id for update;
 -- Reactivating a late payment must not reclaim production capacity from newer orders.
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
 for r in select ps.*,oi.quantity from private.production_stock ps join public.order_items oi on oi.id=ps.order_item_id
   join public.orders o on o.id=oi.order_id left join public.order_payments op on op.order_id=o.id
   where ps.product_id=p_product_id and ps.allocated>ps.consumed and ps.consumed=0
   and (o.status='cancelled' or op.payment_status in ('payment_expired','payment_cancelled','payment_rejected','refund_pending','refunded'))
   and o.status<>'completed' and o.pickup_status not in ('picked_up','shipped') order by oi.id for update of ps
 loop
   supply_left:=supply_left+r.allocated;
   update public.products set stock_reserved=stock_reserved-r.allocated where id=p_product_id;
   update private.production_stock set allocated=0 where order_item_id=r.order_item_id;
 end loop;
 -- Never take stock back from another confirmed order; cancellation releases only unconsumed earmarks.
 for r in select s.*,oi.quantity,o.status,o.pickup_status,op.payment_status
   from private.production_stock s join public.order_items oi on oi.id=s.order_item_id
   join public.orders o on o.id=oi.order_id left join public.order_payments op on op.order_id=o.id
   where s.product_id=p_product_id order by o.created_at,o.id,oi.id for update of s
 loop
   delivered:=r.status='completed' or r.pickup_status in ('picked_up','shipped');
   confirmed:=r.payment_status='payment_confirmed';
   if not delivered and (r.status='cancelled' or coalesce(r.payment_status,'') in ('payment_expired','payment_cancelled','payment_rejected','refund_pending','refunded')) then
     delta:=r.allocated-r.consumed;
     if delta>0 then
       update public.products set stock_reserved=stock_reserved-delta where id=p_product_id;
       update private.production_stock set allocated=consumed where order_item_id=r.order_item_id;
     end if;
   elsif confirmed or delivered then
     delta:=least(r.quantity-r.allocated,private.catalog_free_stock(p_product_id),supply_left);
     supply_left:=supply_left-delta;
     if delta>0 then
       update public.products set stock_reserved=stock_reserved+delta where id=p_product_id;
       update private.production_stock set allocated=allocated+delta where order_item_id=r.order_item_id;
     end if;
     if delivered and r.consumed<r.quantity then
       if not coalesce(confirmed,false) then raise exception 'payment_not_confirmed'; end if;
       if r.allocated+delta<r.quantity then raise exception 'production_stock_not_ready'; end if;
       update public.products set stock_reserved=stock_reserved-(r.quantity-r.consumed),stock_sold=stock_sold+(r.quantity-r.consumed)
         where id=p_product_id;
       update private.production_stock set consumed=r.quantity where order_item_id=r.order_item_id;
     end if;
   end if;
 end loop;
 perform private.touch_production_channels(p_product_id);
end $$;
create function private.refresh_order_production() returns trigger language plpgsql security definer set search_path='' as $$
declare product uuid; v_order_id uuid;
begin
 if tg_table_name='orders' then v_order_id:=new.id; else v_order_id:=(to_jsonb(new)->>'order_id')::uuid; end if;
 for product in select distinct oi.product_id from public.order_items oi where oi.order_id=v_order_id and exists(select 1 from private.production_stock ps where ps.order_item_id=oi.id) order by oi.product_id loop
   perform private.refresh_production_stock(product);
 end loop;
 return new;
end $$;
create trigger refresh_order_production after update of status,pickup_status on public.orders
 for each row execute function private.refresh_order_production();
create trigger refresh_payment_production after update of payment_status on public.order_payments
 for each row execute function private.refresh_order_production();
create function private.receive_production_stock() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not new.is_unlimited and (old.is_unlimited or coalesce(new.stock_total,0)>coalesce(old.stock_total,0)) then
   perform private.refresh_production_stock(new.id,case when old.is_unlimited then private.catalog_free_stock(new.id) else new.stock_total-coalesce(old.stock_total,0) end);
 end if;
 return new;
end $$;
create trigger receive_production_stock after update of stock_total,is_unlimited on public.products
 for each row execute function private.receive_production_stock();

-- Management operations share the product lock with checkout; an omitted cap means unlimited production demand.
create function private.configure_product_supply(p_product_id uuid,p_event_id uuid,p_campaign_id uuid,p_phase text,p_mode text,p_limit integer,p_expected jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare artist uuid; used integer; current_mode text; current_limit integer;
begin
 select artist_id into artist from public.products where id=p_product_id and deleted_at is null for update;
 if auth.uid() is null or not public.has_artist_role(artist,array['owner','manager']) then raise exception 'forbidden'; end if;
 if p_mode not in ('stock','production') or p_mode is null or (p_limit is not null and p_limit<=0)
   or num_nonnulls(p_event_id,p_campaign_id)<>1 then raise exception 'invalid_supply_policy'; end if;
 if p_expected is not null then
   if p_event_id is not null then
     select case when p_phase='preorder' then preorder_supply_mode else postorder_supply_mode end,
       case when p_phase='preorder' then preorder_production_limit else postorder_production_limit end into current_mode,current_limit
     from public.event_products where event_id=p_event_id and product_id=p_product_id;
   else select supply_mode,production_limit into current_mode,current_limit from public.online_campaign_products where campaign_id=p_campaign_id and product_id=p_product_id; end if;
   if current_mode is distinct from p_expected->>'mode' or current_limit is distinct from (p_expected->>'limit')::integer then raise exception 'supply_policy_changed_reload'; end if;
 end if;
 if p_event_id is not null then
   if p_phase not in ('preorder','postorder') or p_phase is null then raise exception 'invalid_supply_phase'; end if;
   update public.event_products set
     preorder_supply_mode=case when p_phase='preorder' then p_mode else preorder_supply_mode end,
     preorder_production_limit=case when p_phase='preorder' then p_limit else preorder_production_limit end,
     postorder_supply_mode=case when p_phase='postorder' then p_mode else postorder_supply_mode end,
     postorder_production_limit=case when p_phase='postorder' then p_limit else postorder_production_limit end
   where event_id=p_event_id and product_id=p_product_id and artist_id=artist;
 else
   update public.online_campaign_products set supply_mode=p_mode,production_limit=p_limit
   where campaign_id=p_campaign_id and product_id=p_product_id and artist_id=artist;
 end if;
 if not found then raise exception 'channel_product_not_found'; end if;
 if p_limit is not null then
   select coalesce(sum(oi.quantity),0)::integer into used from public.order_items oi join public.orders o on o.id=oi.order_id
   where oi.product_id=p_product_id and oi.inventory_source='production' and private.production_order_active(o.id)
    and ((p_campaign_id is not null and o.campaign_id=p_campaign_id) or (p_event_id is not null and o.event_id=p_event_id
      and o.order_type=case when p_phase='preorder' then 'preorder' else 'post_event' end));
   if p_limit<used then raise exception 'production_limit_below_orders'; end if;
 end if;
 -- Existing order snapshots never change when a policy is edited.
end $$;
create function public.configure_product_supply(p_product_id uuid,p_event_id uuid,p_campaign_id uuid,p_phase text,p_mode text,p_limit integer default null,p_expected jsonb default null)
returns void language sql security invoker set search_path='' as $$
 select private.configure_product_supply(p_product_id,p_event_id,p_campaign_id,p_phase,p_mode,p_limit,p_expected)
$$;
grant usage on schema private to authenticated;
grant execute on function private.configure_product_supply(uuid,uuid,uuid,text,text,integer,jsonb) to authenticated;
revoke all on function public.configure_product_supply(uuid,uuid,uuid,text,text,integer,jsonb) from public,anon;
grant execute on function public.configure_product_supply(uuid,uuid,uuid,text,text,integer,jsonb) to authenticated;

-- Internal implementation functions are not API endpoints.
revoke all on function private.event_production(uuid,uuid,text),private.campaign_production(uuid,uuid),
 private.catalog_free_stock(uuid),private.production_order_active(uuid),private.production_remaining(uuid,uuid,uuid,text),
 private.snapshot_inventory_source(),private.record_production_item(),private.refresh_production_stock(uuid,integer),
 private.refresh_order_production(),private.receive_production_stock() from public,anon,authenticated;

create function private.active_event_phase(p_event_id uuid) returns text language sql stable set search_path='' as $$
 select public.get_event_sales_phase(e.status,e.start_date,e.end_date,e.preorder_enabled,e.preorder_opens_at,e.preorder_closes_at,
 e.postorder_enabled,e.postorder_opens_at,e.postorder_closes_at,e.sales_status_override) from public.events e where e.id=p_event_id
$$;
create function private.event_supply_available(p_event_id uuid,p_product_id uuid,p_phase text) returns integer
language sql stable set search_path='' as $$
 select case when private.event_production(p_event_id,p_product_id,p_phase)
   then private.production_remaining(p_event_id,null,p_product_id,p_phase)
   when ep.is_unlimited then null else greatest(coalesce(ep.stock_total,0)-ep.stock_reserved-ep.stock_sold,0) end
 from public.event_products ep where ep.event_id=p_event_id and ep.product_id=p_product_id
$$;
create function private.campaign_supply_available(p_campaign_id uuid,p_product_id uuid) returns integer
language sql stable set search_path='' as $$
 select case when cp.supply_mode='production' then private.production_remaining(null,p_campaign_id,p_product_id,null)
   when cp.is_unlimited then null else greatest(coalesce(cp.stock_total,0)-cp.stock_reserved-cp.stock_sold,0) end
 from public.online_campaign_products cp where cp.campaign_id=p_campaign_id and cp.product_id=p_product_id
$$;
revoke all on function private.active_event_phase(uuid),private.event_supply_available(uuid,uuid,text),private.campaign_supply_available(uuid,uuid) from public,anon,authenticated;

-- Stock-taking starts from physical units present NOW, rather than adding that count to historical receipts.
create function private.start_stock_tracking(p_product_id uuid,p_quantity integer,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.products; legacy_sold integer; committed integer; r record;
begin
 select * into p from public.products where id=p_product_id and deleted_at is null for update;
 if auth.uid() is null or not public.has_artist_role(p.artist_id,array['owner','manager']) then raise exception 'forbidden'; end if;
 if p_request_id is null or p_quantity is null or p_quantity<0 then raise exception 'invalid_stock_quantity'; end if;
 if exists(select 1 from public.catalog_stock_movements m where m.product_id=p_product_id and m.request_id=p_request_id) then
   if not exists(select 1 from public.catalog_stock_movements m where m.product_id=p_product_id and m.request_id=p_request_id
      and m.kind='start_tracking' and m.actor_id=auth.uid() and m.reason='Physical opening count: '||p_quantity::text) then raise exception 'stock_request_conflict'; end if;
   return jsonb_build_object('product_id',p_product_id,'already_applied',true);
 end if;
 if not p.is_unlimited then raise exception 'stock_tracking_already_started'; end if;
 -- A live queue has no online payment record. Finish its in-flight untracked orders before changing its reservation model.
 if exists(select 1 from public.order_items oi join public.orders o on o.id=oi.order_id
   where oi.product_id=p_product_id and oi.inventory_source='untracked' and o.order_type not in ('preorder','post_event','online_sale')
   and o.status not in ('completed','cancelled')) then raise exception 'finish_open_live_orders_before_tracking'; end if;

 -- Untracked Event orders had no physical reservation. Preserve their snapshots and make their open demand visible.
 insert into private.production_stock(order_item_id,product_id)
 select oi.id,oi.product_id from public.order_items oi join public.orders o on o.id=oi.order_id
 where oi.product_id=p_product_id and oi.inventory_source='untracked' and oi.campaign_product_id is null
 and o.order_type in ('preorder','post_event') and o.status not in ('completed','cancelled') and o.pickup_status not in ('picked_up','shipped','cancelled','expired')
 on conflict do nothing;
 select coalesce(p.stock_sold,0)+coalesce((select sum(stock_sold) from public.event_products where product_id=p_product_id),0)
   +coalesce((select sum(stock_sold) from public.online_campaign_products where product_id=p_product_id),0) into legacy_sold;
 select legacy_sold-coalesce(sum(oi.quantity),0)::integer into legacy_sold from public.order_items oi
 join public.orders o on o.id=oi.order_id join public.order_payments op on op.order_id=o.id
 where oi.product_id=p_product_id and oi.campaign_product_id is not null and oi.inventory_source<>'production'
 and op.payment_status in ('payment_confirmed','refund_pending','refunded')
 and o.pickup_status not in ('picked_up','shipped') and o.shipped_at is null and o.picked_up_at is null;
 -- Stop unlimited channel sales as part of the same transaction. Existing sold/held counters remain intact.
 for r in select id,stock_sold,stock_reserved from public.event_products where product_id=p_product_id and is_unlimited order by id for update loop
   update public.event_products set is_unlimited=false,stock_total=r.stock_sold+r.stock_reserved where id=r.id;
 end loop;
 for r in select id,stock_sold,stock_reserved from public.online_campaign_products where product_id=p_product_id and is_unlimited order by id for update loop
   update public.online_campaign_products set is_unlimited=false,stock_total=r.stock_sold+r.stock_reserved where id=r.id;
 end loop;
 perform set_config('nireq.stock_kind','start_tracking',true);
 perform set_config('nireq.stock_reason','Physical opening count: '||p_quantity::text,true);
 perform set_config('nireq.stock_request',p_request_id::text,true);
 update public.products set is_unlimited=false,stock_total=p_quantity+legacy_sold,updated_at=now() where id=p_product_id;
 -- Existing finite allocations and Campaign holds cannot be silently discarded at conversion.
 select p2.stock_reserved+p2.stock_sold+private.catalog_channel_commitments(p_product_id) into committed from public.products p2 where p2.id=p_product_id;
 if committed>p_quantity+legacy_sold then raise exception 'opening_stock_below_commitments'; end if;
 perform set_config('nireq.stock_kind','',true); perform set_config('nireq.stock_reason','',true); perform set_config('nireq.stock_request','',true);
 return jsonb_build_object('product_id',p_product_id,'already_applied',false);
end $$;
create function public.start_stock_tracking(p_product_id uuid,p_quantity integer,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.start_stock_tracking(p_product_id,p_quantity,p_request_id) $$;
revoke all on function private.start_stock_tracking(uuid,integer,uuid),public.start_stock_tracking(uuid,integer,uuid) from public,anon;
grant execute on function private.start_stock_tracking(uuid,integer,uuid),public.start_stock_tracking(uuid,integer,uuid) to authenticated;

alter table public.order_items disable trigger snapshot_inventory_source;
update public.order_items oi set inventory_source='untracked' from public.products p where p.id=oi.product_id and p.is_unlimited;
alter table public.order_items enable trigger snapshot_inventory_source;

CREATE OR REPLACE FUNCTION private.reserve_preorder_order_stock_base(p_order_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_item record;
  v_available integer;
  v_reserved integer := 0;
begin
  select o.*, e.artist_id
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  for v_item in
    select
      oi.product_id,
      oi.event_product_id,
      oi.quantity,
      p.is_unlimited as product_unlimited,
      p.stock_total as product_stock_total,
      p.stock_reserved as product_stock_reserved,
      p.stock_sold as product_stock_sold,
      ep.is_unlimited as event_unlimited,
      ep.stock_total as event_stock_total,
      ep.stock_reserved as event_stock_reserved,
      ep.stock_sold as event_stock_sold
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    left join public.event_products ep on ep.id = oi.event_product_id
    where oi.order_id = v_order.id and oi.inventory_source='stock'
    for update of p
  loop
    if v_item.event_product_id is not null then
      if not coalesce(v_item.event_unlimited, true) then
        v_available := coalesce(v_item.event_stock_total, 0)
          - coalesce(v_item.event_stock_reserved, 0)
          - coalesce(v_item.event_stock_sold, 0);

        if v_available < v_item.quantity then
          raise exception 'insufficient_stock';
        end if;

        update public.event_products
        set stock_reserved = stock_reserved + v_item.quantity
        where id = v_item.event_product_id;

        v_reserved := v_reserved + v_item.quantity;
      end if;
    elsif not coalesce(v_item.product_unlimited, true) then
      v_available := coalesce(v_item.product_stock_total, 0)
        - coalesce(v_item.product_stock_reserved, 0)
        - coalesce(v_item.product_stock_sold, 0);

      if v_available < v_item.quantity then
        raise exception 'insufficient_stock';
      end if;

      update public.products
      set stock_reserved = stock_reserved + v_item.quantity,
          updated_at = now()
      where id = v_item.product_id;

      v_reserved := v_reserved + v_item.quantity;
    end if;
  end loop;

  return v_reserved;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.release_preorder_order_stock(p_order_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_item record;
  v_released integer := 0;
begin
  select o.*, e.artist_id
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  for v_item in
    select
      oi.product_id,
      oi.event_product_id,
      oi.quantity,
      p.is_unlimited as product_unlimited,
      ep.is_unlimited as event_unlimited
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    left join public.event_products ep on ep.id = oi.event_product_id
    where oi.order_id = v_order.id and oi.inventory_source='stock'
    for update of p
  loop
    if v_item.event_product_id is not null then
      if not coalesce(v_item.event_unlimited, true) then
        update public.event_products
        set stock_reserved = greatest(stock_reserved - v_item.quantity, 0)
        where id = v_item.event_product_id;
        v_released := v_released + v_item.quantity;
      end if;
    elsif not coalesce(v_item.product_unlimited, true) then
      update public.products
      set stock_reserved = greatest(stock_reserved - v_item.quantity, 0),
          updated_at = now()
      where id = v_item.product_id;
      v_released := v_released + v_item.quantity;
    end if;
  end loop;

  return v_released;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_preorder_picked_up(p_order_id uuid)
 RETURNS TABLE(order_id uuid, pickup_status text, status text, picked_up_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_payment record;
  v_item record;
  v_now timestamptz := now();
begin
  select o.*, e.artist_id
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  if not public.has_event_role(v_order.event_id, array['owner', 'manager', 'seller', 'queue_staff']) then
    raise exception 'forbidden';
  end if;

  if v_order.order_type <> 'preorder' then
    raise exception 'order_not_preorder';
  end if;

  select op.*
  into v_payment
  from public.order_payments op
  where op.order_id = v_order.id
  for update;

  if coalesce(v_payment.payment_status, '') <> 'payment_confirmed' then
    raise exception 'payment_not_confirmed';
  end if;

  if v_order.status <> 'confirmed' or v_order.pickup_status <> 'awaiting_pickup' then
    raise exception 'order_not_pickup_ready';
  end if;

  for v_item in
    select
      oi.product_id,
      oi.event_product_id,
      oi.quantity,
      p.is_unlimited as product_unlimited,
      ep.is_unlimited as event_unlimited
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    left join public.event_products ep on ep.id = oi.event_product_id
    where oi.order_id = v_order.id and oi.inventory_source='stock'
    for update of p
  loop
    if v_item.event_product_id is not null then
      if not coalesce(v_item.event_unlimited, true) then
        update public.event_products
        set stock_reserved = greatest(stock_reserved - v_item.quantity, 0),
            stock_sold = stock_sold + v_item.quantity
        where id = v_item.event_product_id;
      end if;
    elsif not coalesce(v_item.product_unlimited, true) then
      update public.products
      set stock_reserved = greatest(stock_reserved - v_item.quantity, 0),
          stock_sold = stock_sold + v_item.quantity,
          updated_at = now()
      where id = v_item.product_id;
    end if;
  end loop;

  update public.orders
  set status = 'completed',
      pickup_status = 'picked_up',
      picked_up_at = v_now,
      picked_up_by = auth.uid()
  where id = v_order.id;

  return query
  select v_order.id, 'picked_up'::text, 'completed'::text, v_now;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_order_shipped(p_order_id uuid, p_tracking_number text, p_carrier text DEFAULT ''::text)
 RETURNS TABLE(order_id uuid, pickup_status text, shipped_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_payment record;
  v_item record;
  v_now timestamptz := now();
begin
  if length(trim(coalesce(p_tracking_number, ''))) = 0 then
    raise exception 'tracking_required';
  end if;

  select o.*, e.artist_id
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  if not public.has_event_role(v_order.event_id, array['owner', 'manager', 'seller'])
    or not public.has_shipping_access(v_order.artist_id) then
    raise exception 'forbidden';
  end if;

  if v_order.order_type <> 'post_event' then
    raise exception 'not_post_order';
  end if;

  select op.*
  into v_payment
  from public.order_payments op
  where op.order_id = v_order.id
  for update;

  if coalesce(v_payment.payment_status, '') <> 'payment_confirmed' then
    raise exception 'payment_not_confirmed';
  end if;

  if v_order.pickup_status = 'shipped' then
    return query select v_order.id, 'shipped'::text, v_order.shipped_at;
    return;
  end if;

  for v_item in
    select
      oi.product_id,
      oi.event_product_id,
      oi.quantity,
      p.is_unlimited as product_unlimited,
      ep.is_unlimited as event_unlimited
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    left join public.event_products ep on ep.id = oi.event_product_id
    where oi.order_id = v_order.id and oi.inventory_source='stock'
    for update of p
  loop
    if v_item.event_product_id is not null then
      if not coalesce(v_item.event_unlimited, true) then
        update public.event_products
        set stock_reserved = greatest(stock_reserved - v_item.quantity, 0),
            stock_sold = stock_sold + v_item.quantity
        where id = v_item.event_product_id;
      end if;
    elsif not coalesce(v_item.product_unlimited, true) then
      update public.products
      set stock_reserved = greatest(stock_reserved - v_item.quantity, 0),
          stock_sold = stock_sold + v_item.quantity,
          updated_at = now()
      where id = v_item.product_id;
    end if;
  end loop;

  update public.orders
  set tracking_number = trim(p_tracking_number),
      shipping_carrier = nullif(trim(coalesce(p_carrier, '')), ''),
      shipped_at = v_now,
      pickup_status = 'shipped',
      status = 'completed'
  where id = v_order.id;

  return query select v_order.id, 'shipped'::text, v_now;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.complete_order_with_stock_base(p_order_id uuid, p_payment_method text, p_payment_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_item record;
  v_reserved integer;
  v_missing integer;
  v_unreserved_available integer;
begin
  select o.*, e.artist_id
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
  for update of o;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  if not public.has_artist_role(v_order.artist_id, array['owner', 'queue_pos']) then
    raise exception 'forbidden';
  end if;

  if v_order.status = 'completed' then
    if p_payment_idempotency_key is not null
       and v_order.payment_idempotency_key is not null
       and v_order.payment_idempotency_key <> p_payment_idempotency_key then
      raise exception 'payment_idempotency_key_conflict';
    end if;

    if p_payment_idempotency_key is not null and v_order.payment_idempotency_key is null then
      update public.orders
      set payment_idempotency_key = p_payment_idempotency_key
      where id = v_order.id;
    end if;

    return true;
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'order_cancelled';
  end if;

  if p_payment_idempotency_key is not null
     and v_order.payment_idempotency_key is not null
     and v_order.payment_idempotency_key <> p_payment_idempotency_key then
    raise exception 'payment_idempotency_key_conflict';
  end if;

  for v_item in
    select
      oi.product_id,
      oi.event_product_id,
      oi.quantity,
      p.is_unlimited as product_unlimited,
      p.stock_reserved as product_reserved,
      p.stock_sold as product_sold,
      p.stock_sold+p.stock_reserved+private.catalog_free_stock(p.id) as product_total,
      ep.is_unlimited as event_unlimited,
      ep.stock_reserved as event_reserved,
      ep.stock_sold as event_sold,
      ep.stock_total as event_total
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    left join public.event_products ep on ep.id = oi.event_product_id
    where oi.order_id = v_order.id and oi.inventory_source='stock'
    for update of p
  loop
    if v_item.event_product_id is not null then
      if coalesce(v_item.event_unlimited, true) then
        continue;
      end if;

      v_reserved := least(coalesce(v_item.event_reserved, 0), v_item.quantity);
      v_missing := v_item.quantity - v_reserved;
      v_unreserved_available := coalesce(v_item.event_total, 0) - coalesce(v_item.event_sold, 0) - coalesce(v_item.event_reserved, 0);

      if v_missing > v_unreserved_available then
        raise exception 'insufficient_stock_on_complete';
      end if;

      update public.event_products
      set stock_reserved = greatest(stock_reserved - v_reserved, 0),
          stock_sold = stock_sold + v_item.quantity
      where id = v_item.event_product_id;
    elsif not coalesce(v_item.product_unlimited, true) then
      v_reserved := least(coalesce(v_item.product_reserved, 0), v_item.quantity);
      v_missing := v_item.quantity - v_reserved;
      v_unreserved_available := coalesce(v_item.product_total, 0) - coalesce(v_item.product_sold, 0) - coalesce(v_item.product_reserved, 0);

      if v_missing > v_unreserved_available then
        raise exception 'insufficient_stock_on_complete';
      end if;

      update public.products
      set stock_reserved = greatest(stock_reserved - v_reserved, 0),
          stock_sold = stock_sold + v_item.quantity,
          updated_at = now()
      where id = v_item.product_id;
    end if;
  end loop;

  update public.orders
  set status = 'completed',
      payment_method = p_payment_method,
      payment_idempotency_key = coalesce(payment_idempotency_key, p_payment_idempotency_key)
  where id = v_order.id;

  if v_order.queue_id is not null then
    update public.queues
    set status = 'complete',
        completed_at = now(),
        last_updated_at = now()
    where id = v_order.queue_id;
  end if;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_customer_order_with_stock_release(p_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_item record;
begin
  select o.* into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    return false;
  end if;

  if v_order.status not in ('draft', 'confirmed') then
    return false;
  end if;

  for v_item in
    select oi.product_id, oi.event_product_id, oi.quantity, p.is_unlimited as product_unlimited, ep.is_unlimited as event_unlimited
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    left join public.event_products ep on ep.id = oi.event_product_id
    where oi.order_id = v_order.id and oi.inventory_source='stock'
    for update of p
  loop
    if v_item.event_product_id is not null then
      if not coalesce(v_item.event_unlimited, true) then
        update public.event_products
        set stock_reserved = greatest(stock_reserved - v_item.quantity, 0)
        where id = v_item.event_product_id;
      end if;
    elsif not coalesce(v_item.product_unlimited, true) then
      update public.products
      set stock_reserved = greatest(stock_reserved - v_item.quantity, 0),
          updated_at = now()
      where id = v_item.product_id;
    end if;
  end loop;

  update public.orders
  set status = 'cancelled'
  where id = v_order.id;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_customer_order_items_with_stock(p_order_id uuid, p_items jsonb, p_payment_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_existing_item record;
  v_item jsonb;
  v_product record;
  v_qty integer;
  v_total numeric := 0;
  v_currency text;
  v_effective_currency text;
  v_available integer;
  v_has_catalog boolean := false;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items_payload';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'empty_items';
  end if;

  select o.*, e.artist_id, e.currency_override
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  if v_order.queue_id is null then
    raise exception 'order_not_queue_order';
  end if;

  if v_order.status = 'completed' then
    if p_payment_idempotency_key is not null
       and v_order.payment_idempotency_key is not null
       and v_order.payment_idempotency_key <> p_payment_idempotency_key then
      raise exception 'payment_idempotency_key_conflict';
    end if;
    return true;
  end if;

  if v_order.status not in ('draft', 'confirmed') then
    raise exception 'order_not_editable';
  end if;

  if p_payment_idempotency_key is not null
     and v_order.payment_idempotency_key is not null
     and v_order.payment_idempotency_key <> p_payment_idempotency_key then
    raise exception 'payment_idempotency_key_conflict';
  end if;

  if not public.has_artist_role(v_order.artist_id, array['owner', 'queue_pos']) then
    raise exception 'forbidden';
  end if;

  select exists (select 1 from public.event_products ep where ep.event_id = v_order.event_id)
  into v_has_catalog;

  for v_existing_item in
    select oi.product_id, oi.event_product_id, oi.quantity, p.is_unlimited as product_unlimited, ep.is_unlimited as event_unlimited
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    left join public.event_products ep on ep.id = oi.event_product_id
    where oi.order_id = v_order.id and oi.inventory_source='stock'
    for update of p
  loop
    if v_existing_item.event_product_id is not null then
      if not coalesce(v_existing_item.event_unlimited, true) then
        update public.event_products
        set stock_reserved = greatest(stock_reserved - v_existing_item.quantity, 0)
        where id = v_existing_item.event_product_id;
      end if;
    elsif not coalesce(v_existing_item.product_unlimited, true) then
      update public.products
      set stock_reserved = greatest(stock_reserved - v_existing_item.quantity, 0),
          updated_at = now()
      where id = v_existing_item.product_id;
    end if;
  end loop;

  delete from public.order_items
  where order_id = v_order.id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::integer, 1));

    select
      p.*,
      ep.id as event_product_id,
      coalesce(ep.price_override, p.price) as effective_price,
      case when ep.id is not null then ep.is_unlimited else p.is_unlimited end as effective_is_unlimited,
      case when ep.id is not null then ep.stock_total else p.stock_sold+p.stock_reserved+private.catalog_free_stock(p.id) end as effective_stock_total,
      case when ep.id is not null then ep.stock_reserved else p.stock_reserved end as effective_stock_reserved,
      case when ep.id is not null then ep.stock_sold else p.stock_sold end as effective_stock_sold
    into v_product
    from public.products p
    left join public.event_products ep
      on ep.product_id = p.id
     and ep.event_id = v_order.event_id
    where p.id = (v_item ->> 'product_id')::uuid
      and p.artist_id = v_order.artist_id
      and p.deleted_at is null
      and p.status = 'enable'
      and (not v_has_catalog or (ep.id is not null and ep.is_enabled = true))
    for update of p;

    if v_product.id is null then
      raise exception 'invalid_product';
    end if;

    v_effective_currency := coalesce(v_order.currency_override, v_product.currency, 'THB');

    if v_currency is null then
      v_currency := v_effective_currency;
    elsif v_currency <> v_effective_currency then
      raise exception 'mixed_currency_not_allowed';
    end if;

    if not coalesce(v_product.effective_is_unlimited, true) then
      v_available := coalesce(v_product.effective_stock_total, 0)
        - coalesce(v_product.effective_stock_reserved, 0)
        - coalesce(v_product.effective_stock_sold, 0);

      if v_available < v_qty then
        raise exception 'insufficient_stock';
      end if;

      if v_product.event_product_id is not null then
        update public.event_products
        set stock_reserved = stock_reserved + v_qty
        where id = v_product.event_product_id;
      else
        update public.products
        set stock_reserved = stock_reserved + v_qty,
            updated_at = now()
        where id = v_product.id;
      end if;
    end if;

    insert into public.order_items (order_id, product_id, event_product_id, quantity, price_per_unit, notes, currency)
    values (
      v_order.id,
      v_product.id,
      v_product.event_product_id,
      v_qty,
      v_product.effective_price,
      coalesce(v_item ->> 'notes', ''),
      v_effective_currency
    );

    v_total := v_total + (v_product.effective_price * v_qty);
  end loop;

  update public.orders
  set total_price = v_total,
      subtotal_price = v_total,
      currency = coalesce(v_currency, currency, 'THB'),
      status = 'confirmed',
      payment_idempotency_key = coalesce(payment_idempotency_key, p_payment_idempotency_key)
  where id = v_order.id;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.release_online_campaign_order_stock(p_order_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item record;
  v_released integer := 0;
begin
  for v_item in
    select oi.campaign_product_id, oi.quantity
    from public.order_items oi
    where oi.order_id = p_order_id and oi.inventory_source<>'production'
      and oi.campaign_product_id is not null
    order by oi.campaign_product_id
  loop
    update public.online_campaign_products cp
    set stock_reserved = greatest(cp.stock_reserved - v_item.quantity, 0)
    where cp.id = v_item.campaign_product_id;

    v_released := v_released + v_item.quantity;
  end loop;

  return v_released;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_online_payment(p_order_id uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order record;
  v_item record;
  v_fulfillment_status text;
begin
  select
    o.*,
    c.artist_id,
    op.id as payment_id,
    op.payment_status,
    op.slip_url
  into v_order
  from public.orders o
  join public.online_campaigns c on c.id = o.campaign_id
  join public.order_payments op on op.order_id = o.id
  where o.id = p_order_id
    and o.order_type = 'online_sale'
  for update of o, op;

  if v_order.id is null then raise exception 'order_not_found'; end if;
  if not public.has_artist_role(v_order.artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;

  if v_order.payment_status = 'payment_confirmed' then
    return jsonb_build_object(
      'order_id', v_order.id,
      'payment_status', 'payment_confirmed',
      'fulfillment_status', v_order.pickup_status
    );
  end if;

  if v_order.payment_status <> 'payment_submitted' then
    raise exception 'payment_not_submitted';
  end if;

  for v_item in
    select oi.campaign_product_id, oi.quantity
    from public.order_items oi
    where oi.order_id = v_order.id and oi.inventory_source<>'production'
    order by oi.campaign_product_id
  loop
    update public.online_campaign_products cp
    set stock_reserved = cp.stock_reserved - v_item.quantity,
        stock_sold = cp.stock_sold + v_item.quantity
    where cp.id = v_item.campaign_product_id
      and cp.stock_reserved >= v_item.quantity;

    if not found then raise exception 'reserved_stock_mismatch'; end if;
  end loop;

  v_fulfillment_status := case
    when v_order.fulfillment_method = 'shipping' then 'awaiting_shipment'
    else 'awaiting_pickup'
  end;

  update public.order_payments
  set payment_status = 'payment_confirmed',
      confirmed_at = now(),
      confirmed_by = auth.uid(),
      review_note = nullif(trim(coalesce(p_note, '')), ''),
      updated_at = now()
  where id = v_order.payment_id;

  update public.orders
  set status = 'confirmed',
      pickup_status = v_fulfillment_status
  where id = v_order.id;

  perform private.append_campaign_payment_review_event(
    v_order.id, v_order.payment_id, v_order.campaign_id, v_order.artist_id,
    'payment_confirmed', 'payment_submitted', 'payment_confirmed',
    v_order.slip_url, nullif(trim(coalesce(p_note, '')), '')
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'payment_status', 'payment_confirmed',
    'fulfillment_status', v_fulfillment_status
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.accept_late_online_payment(p_order_id uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order record;
  v_item record;
  v_fulfillment_status text;
begin
  select
    o.*,
    c.artist_id,
    op.id as payment_id,
    op.payment_status,
    op.slip_url
  into v_order
  from public.orders o
  join public.online_campaigns c on c.id = o.campaign_id
  join public.order_payments op on op.order_id = o.id
  where o.id = p_order_id
    and o.order_type = 'online_sale'
  for update of o, op;

  if v_order.id is null then raise exception 'order_not_found'; end if;
  if not public.has_artist_role(v_order.artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;
  if v_order.payment_status <> 'payment_submitted_late' then
    raise exception 'payment_not_late';
  end if;

  for v_item in
    select oi.campaign_product_id, oi.quantity
    from public.order_items oi
    where oi.order_id = v_order.id and oi.inventory_source<>'production'
    order by oi.campaign_product_id
  loop
    update public.online_campaign_products cp
    set stock_sold = cp.stock_sold + v_item.quantity
    where cp.id = v_item.campaign_product_id
      and (
        cp.is_unlimited
        or cp.stock_total - cp.stock_reserved - cp.stock_sold >= v_item.quantity
      );

    if not found then raise exception 'insufficient_stock'; end if;
  end loop;

  v_fulfillment_status := case
    when v_order.fulfillment_method = 'shipping' then 'awaiting_shipment'
    else 'awaiting_pickup'
  end;

  update public.order_payments
  set payment_status = 'payment_confirmed',
      confirmed_at = now(),
      confirmed_by = auth.uid(),
      review_note = nullif(trim(coalesce(p_note, '')), ''),
      updated_at = now()
  where id = v_order.payment_id;

  update public.orders
  set status = 'confirmed',
      pickup_status = v_fulfillment_status,
      cancelled_at = null,
      cancelled_by = null,
      cancel_reason = null
  where id = v_order.id;

  perform private.append_campaign_payment_review_event(
    v_order.id, v_order.payment_id, v_order.campaign_id, v_order.artist_id,
    'payment_confirmed', 'payment_submitted_late', 'payment_confirmed',
    v_order.slip_url, nullif(trim(coalesce(p_note, '')), ''),
    jsonb_build_object('late_payment', true)
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'payment_status', 'payment_confirmed',
    'fulfillment_status', v_fulfillment_status
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION private.create_online_campaign_order_base(p_campaign_id uuid, p_items jsonb, p_fulfillment_method text, p_pickup_point_id uuid, p_customer_name text, p_customer_email text, p_customer_phone text DEFAULT ''::text, p_shipping_address text DEFAULT ''::text, p_customer_note text DEFAULT ''::text, p_client_request_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(order_id uuid, order_code text, subtotal_price numeric, shipping_fee numeric, total_price numeric, currency text, payment_status text, payment_methods jsonb, stock_hold_expires_at timestamp with time zone, pickup_point_snapshot jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign record;
  v_existing public.orders%rowtype;
  v_existing_payment public.order_payments%rowtype;
  v_item jsonb;
  v_product record;
  v_pickup record;
  v_order_id uuid;
  v_payment_id uuid;
  v_order_code text;
  v_qty integer;
  v_subtotal numeric := 0;
  v_shipping_fee numeric := 0;
  v_total numeric := 0;
  v_hold_expires_at timestamptz := now() + interval '15 minutes';
  v_pickup_snapshot jsonb;
  v_payment_methods jsonb;
  v_attempt integer := 0;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_items';
  end if;

  if length(trim(coalesce(p_customer_name, ''))) = 0 then
    raise exception 'customer_name_required';
  end if;

  if length(trim(coalesce(p_customer_email, ''))) = 0 then
    raise exception 'customer_email_required';
  end if;

  if lower(trim(p_customer_email)) !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'customer_email_invalid';
  end if;

  select c.*, a.is_public, a.is_verified
  into v_campaign
  from public.online_campaigns c
  join public.artists a on a.id = c.artist_id
  where c.id = p_campaign_id
  for update of c;

  if v_campaign.id is null then
    raise exception 'campaign_not_found';
  end if;

  if v_campaign.publication_status <> 'published'
     or now() < v_campaign.opens_at
     or now() >= v_campaign.closes_at then
    raise exception 'campaign_not_open';
  end if;

  if not coalesce(v_campaign.is_public, false)
     or not coalesce(v_campaign.is_verified, false) then
    raise exception 'artist_not_public';
  end if;

  if p_fulfillment_method = 'shipping' then
    if not v_campaign.shipping_enabled then
      raise exception 'shipping_not_available';
    end if;
    if length(trim(coalesce(p_customer_phone, ''))) = 0 then
      raise exception 'customer_phone_required';
    end if;
    if length(trim(coalesce(p_shipping_address, ''))) = 0 then
      raise exception 'shipping_address_required';
    end if;
    if p_pickup_point_id is not null then
      raise exception 'invalid_fulfillment';
    end if;
    v_shipping_fee := v_campaign.flat_shipping_fee;
  elsif p_fulfillment_method = 'pickup' then
    if not v_campaign.pickup_enabled then
      raise exception 'pickup_not_available';
    end if;
    if length(trim(coalesce(p_customer_phone, ''))) = 0 then
      raise exception 'customer_contact_required';
    end if;

    select pp.*
    into v_pickup
    from public.campaign_pickup_points pp
    where pp.id = p_pickup_point_id
      and pp.campaign_id = v_campaign.id
      and pp.is_enabled = true;

    if v_pickup.id is null then
      raise exception 'invalid_pickup_point';
    end if;

    v_pickup_snapshot := jsonb_build_object(
      'id', v_pickup.id,
      'name', v_pickup.name,
      'address', v_pickup.address,
      'starts_at', v_pickup.starts_at,
      'ends_at', v_pickup.ends_at,
      'instructions', v_pickup.instructions
    );
  else
    raise exception 'invalid_fulfillment';
  end if;

  if not exists (
    select 1
    from public.campaign_payment_methods pm
    where pm.campaign_id = v_campaign.id
      and pm.is_enabled = true
  ) then
    raise exception 'payment_method_required';
  end if;

  if p_client_request_id is not null then
    select o.*
    into v_existing
    from public.orders o
    where o.payment_idempotency_key = p_client_request_id
    for update;

    if v_existing.id is not null then
      if v_existing.campaign_id <> p_campaign_id
         or v_existing.order_type <> 'online_sale' then
        raise exception 'client_request_id_conflict';
      end if;

      select op.*
      into v_existing_payment
      from public.order_payments op
      where op.order_id = v_existing.id;

      select coalesce(jsonb_agg(to_jsonb(pm) - 'artist_id' - 'created_at' - 'updated_at'), '[]'::jsonb)
      into v_payment_methods
      from public.campaign_payment_methods pm
      where pm.campaign_id = p_campaign_id
        and pm.is_enabled = true;

      return query select
        v_existing.id,
        v_existing.pickup_code,
        v_existing.subtotal_price,
        v_existing.shipping_fee,
        v_existing.total_price,
        v_existing.currency,
        v_existing_payment.payment_status,
        v_payment_methods,
        v_existing_payment.stock_hold_expires_at,
        v_existing.pickup_point_snapshot;
      return;
    end if;
  end if;

  if (
    select count(*) <> count(distinct value ->> 'product_id')
    from jsonb_array_elements(p_items)
  ) then
    raise exception 'duplicate_product';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_order_code := public.generate_online_order_code();
    exit when not exists (
      select 1 from public.orders o
      where o.campaign_id = p_campaign_id and o.pickup_code = v_order_code
    );
    if v_attempt >= 5 then
      raise exception 'order_code_generation_failed';
    end if;
  end loop;

  insert into public.orders (
    event_id, campaign_id, queue_id, status,
    total_price, subtotal_price, discount_total, shipping_fee,
    pricing_breakdown, currency, payment_method, payment_idempotency_key,
    order_type, pickup_code, customer_name, customer_contact,
    customer_phone, customer_email, customer_note, shipping_address,
    fulfillment_method, pickup_point_id, pickup_point_snapshot, pickup_status
  )
  values (
    null, v_campaign.id, null, 'draft',
    0, 0, 0, v_shipping_fee,
    '[]'::jsonb, v_campaign.currency, null, p_client_request_id,
    'online_sale', v_order_code, trim(p_customer_name), trim(p_customer_phone),
    nullif(trim(coalesce(p_customer_phone, '')), ''), lower(trim(p_customer_email)),
    nullif(trim(coalesce(p_customer_note, '')), ''),
    case when p_fulfillment_method = 'shipping' then trim(p_shipping_address) else null end,
    p_fulfillment_method, p_pickup_point_id, v_pickup_snapshot, 'not_required'
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_qty := (v_item ->> 'quantity')::integer;
    exception when others then
      raise exception 'invalid_quantity';
    end;

    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid_quantity';
    end if;

    select
      cp.id as campaign_product_id,
      (cp.is_unlimited or cp.supply_mode='production') as is_unlimited,
      cp.stock_total,
      cp.stock_reserved,
      cp.stock_sold,
      p.id as product_id,
      p.name,
      p.sku,
      coalesce(cp.price_override, p.price) as effective_price
    into v_product
    from public.online_campaign_products cp
    join public.products p on p.id = cp.product_id
    where cp.campaign_id = v_campaign.id
      and cp.product_id = nullif(v_item ->> 'product_id', '')::uuid
      and cp.is_enabled = true
      and p.deleted_at is null
      and p.status = 'enable'
    for update of cp;

    if v_product.product_id is null then
      raise exception 'invalid_product';
    end if;
    if v_item->>'expected_supply_mode' is not null and v_item->>'expected_supply_mode' is distinct from
      (case when private.campaign_production(v_campaign.id,v_product.product_id) then 'production' else 'stock' end)
    then raise exception 'supply_policy_changed_reload'; end if;


    if not v_product.is_unlimited
       and v_product.stock_total - v_product.stock_reserved - v_product.stock_sold < v_qty then
      raise exception 'insufficient_stock';
    end if;

    if not private.campaign_production(v_campaign.id,v_product.product_id) then
    update public.online_campaign_products
    set stock_reserved = stock_reserved + v_qty
    where id = v_product.campaign_product_id;
    end if;

    insert into public.order_items (
      order_id, product_id, event_product_id, campaign_product_id,
      quantity, price_per_unit, currency, product_name_snapshot, sku_snapshot
    )
    values (
      v_order_id, v_product.product_id, null, v_product.campaign_product_id,
      v_qty, v_product.effective_price, v_campaign.currency,
      v_product.name, v_product.sku
    );

    v_subtotal := v_subtotal + (v_product.effective_price * v_qty);
  end loop;

  v_total := v_subtotal + v_shipping_fee;

  update public.orders
  set subtotal_price = v_subtotal,
      discount_total = 0,
      shipping_fee = v_shipping_fee,
      total_price = v_total,
      pricing_breakdown = '[]'::jsonb
  where id = v_order_id;

  insert into public.order_payments (
    order_id, event_id, campaign_id, artist_id, payment_status,
    amount_expected, currency, stock_hold_expires_at
  )
  values (
    v_order_id, null, v_campaign.id, v_campaign.artist_id, 'awaiting_payment',
    v_total, v_campaign.currency, v_hold_expires_at
  )
  returning id into v_payment_id;

  perform private.append_campaign_payment_review_event(
    v_order_id, v_payment_id, v_campaign.id, v_campaign.artist_id,
    'created', null, 'awaiting_payment', null, null,
    jsonb_build_object('fulfillment_method', p_fulfillment_method)
  );
  perform private.append_campaign_payment_review_event(
    v_order_id, v_payment_id, v_campaign.id, v_campaign.artist_id,
    'stock_reserved', null, 'awaiting_payment', null, null,
    jsonb_build_object('quantity', (
      select coalesce(sum(oi.quantity), 0)
      from public.order_items oi where oi.order_id = v_order_id
    ))
  );

  select coalesce(jsonb_agg(to_jsonb(pm) - 'artist_id' - 'created_at' - 'updated_at'), '[]'::jsonb)
  into v_payment_methods
  from public.campaign_payment_methods pm
  where pm.campaign_id = v_campaign.id
    and pm.is_enabled = true;

  return query select
    v_order_id, v_order_code, v_subtotal, v_shipping_fee, v_total,
    v_campaign.currency, 'awaiting_payment'::text, v_payment_methods,
    v_hold_expires_at, v_pickup_snapshot;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_online_campaign_order(p_campaign_id uuid, p_items jsonb, p_fulfillment_method text, p_pickup_point_id uuid, p_customer_name text, p_customer_email text, p_customer_phone text DEFAULT ''::text, p_shipping_address text DEFAULT ''::text, p_customer_note text DEFAULT ''::text, p_client_request_id uuid DEFAULT NULL::uuid, p_reward_choices jsonb DEFAULT '[]'::jsonb, p_promotion_choices jsonb DEFAULT '[]'::jsonb, p_expected_pricing_hash text DEFAULT NULL::text, p_accept_exhausted_rewards boolean DEFAULT false)
 RETURNS TABLE(order_id uuid, order_code text, subtotal_price numeric, shipping_fee numeric, total_price numeric, currency text, payment_status text, payment_methods jsonb, stock_hold_expires_at timestamp with time zone, pickup_point_snapshot jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result record;
  v_quote jsonb;
  v_reward jsonb;
  v_product record;
  v_total numeric;
begin
  -- Let the original function return an idempotent replay before recalculating
  -- against stock that the existing order already holds.
  if p_client_request_id is not null and exists (
    select 1 from public.orders where payment_idempotency_key = p_client_request_id
  ) then
    return query
    select * from private.create_online_campaign_order_base(
      p_campaign_id, p_items, p_fulfillment_method, p_pickup_point_id,
      p_customer_name, p_customer_email, p_customer_phone,
      p_shipping_address, p_customer_note, p_client_request_id
    );
    return;
  end if;

  if not exists (
    select 1
    from public.promotion_assignments pa
    join public.artist_promotions ap on ap.id = pa.promotion_id
    where pa.campaign_id = p_campaign_id
      and ap.lifecycle_status = 'ready'
      and not pa.is_paused
      and (pa.starts_at is null or pa.starts_at <= now())
      and (pa.ends_at is null or pa.ends_at > now())
  ) then
    return query
    select * from private.create_online_campaign_order_base(
      p_campaign_id, p_items, p_fulfillment_method, p_pickup_point_id,
      p_customer_name, p_customer_email, p_customer_phone,
      p_shipping_address, p_customer_note, p_client_request_id
    );
    return;
  end if;

  v_quote := public.calculate_sale_promotions(
    null, null, p_campaign_id, p_items,
    coalesce(p_reward_choices, '[]'::jsonb),
    coalesce(p_promotion_choices, '[]'::jsonb)
  );

  if exists (
    select 1 from jsonb_array_elements(v_quote -> 'required_choices') choice(value)
    where not coalesce((choice.value ->> 'exhausted')::boolean, false)
  ) then
    raise exception 'promotion_choice_required';
  end if;

  if not p_accept_exhausted_rewards and exists (
    select 1 from jsonb_array_elements(v_quote -> 'required_choices') choice(value)
    where coalesce((choice.value ->> 'exhausted')::boolean, false)
  ) then
    raise exception 'promotion_rewards_exhausted';
  end if;

  if p_expected_pricing_hash is not null
     and p_expected_pricing_hash <> v_quote ->> 'pricing_hash' then
    raise exception 'promotion_changed';
  end if;

  select * into v_result
  from private.create_online_campaign_order_base(
    p_campaign_id, p_items, p_fulfillment_method, p_pickup_point_id,
    p_customer_name, p_customer_email, p_customer_phone,
    p_shipping_address, p_customer_note, p_client_request_id
  );

  for v_reward in
    select value from jsonb_array_elements(v_quote -> 'reward_lines') reward(value)
  loop
    select
      cp.id as campaign_product_id,
      (cp.is_unlimited or cp.supply_mode='production') as is_unlimited,
      cp.stock_total,
      cp.stock_reserved,
      cp.stock_sold,
      p.id as product_id,
      p.name,
      p.sku
    into v_product
    from public.online_campaign_products cp
    join public.products p on p.id = cp.product_id
    where cp.campaign_id = p_campaign_id
      and cp.product_id = (v_reward ->> 'product_id')::uuid
      and cp.is_enabled
      and p.deleted_at is null
    for update of cp;

    if v_product.product_id is null
       or (
         not v_product.is_unlimited
         and v_product.stock_total - v_product.stock_reserved - v_product.stock_sold
           < (v_reward ->> 'quantity')::integer
       ) then
      raise exception 'promotion_reward_unavailable';
    end if;

    if not v_product.is_unlimited then
      update public.online_campaign_products
      set stock_reserved = stock_reserved + (v_reward ->> 'quantity')::integer
      where id = v_product.campaign_product_id;
    end if;

    insert into public.order_items (
      order_id, product_id, event_product_id, campaign_product_id,
      quantity, price_per_unit, currency, product_name_snapshot, sku_snapshot,
      line_type, promotion_id, promotion_assignment_id, promotion_tier_id
    ) values (
      v_result.order_id, v_product.product_id, null, v_product.campaign_product_id,
      (v_reward ->> 'quantity')::integer, 0, v_result.currency,
      v_product.name, v_product.sku, 'promotion_reward',
      (v_reward ->> 'promotion_id')::uuid,
      coalesce(
        nullif(v_reward ->> 'assignment_id', '')::uuid,
        (
          select (applied.value ->> 'assignment_id')::uuid
          from jsonb_array_elements(v_quote -> 'applied_promotions') applied(value)
          where applied.value ->> 'id' = v_reward ->> 'promotion_id'
          limit 1
        )
      ),
      nullif(v_reward ->> 'tier_id', '')::uuid
    );
  end loop;

  v_total := (v_quote ->> 'merchandise_total')::numeric + v_result.shipping_fee;

  update public.orders
  set subtotal_price = (v_quote ->> 'subtotal')::numeric,
      discount_total = (v_quote ->> 'discount_total')::numeric,
      shipping_fee = v_result.shipping_fee,
      total_price = v_total,
      pricing_breakdown = v_quote -> 'applied_promotions'
  where id = v_result.order_id;

  update public.order_payments
  set amount_expected = v_total,
      updated_at = now()
  where order_payments.order_id = v_result.order_id;

  return query select
    v_result.order_id,
    v_result.order_code,
    (v_quote ->> 'subtotal')::numeric,
    v_result.shipping_fee,
    v_total,
    v_result.currency,
    v_result.payment_status,
    v_result.payment_methods,
    v_result.stock_hold_expires_at,
    v_result.pickup_point_snapshot;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_sale_promotions(p_event_id uuid, p_event_phase text, p_campaign_id uuid, p_items jsonb, p_reward_choices jsonb, p_promotion_choices jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $function$
declare
  v_artist_id uuid;
  v_can_manage boolean := false;
  v_cart jsonb := '[]'::jsonb;
  v_seen_product_ids uuid[] := '{}'::uuid[];
  v_item jsonb;
  v_product_id uuid;
  v_product_name text;
  v_product_sku text;
  v_product_category text;
  v_product_tags text[];
  v_quantity integer;
  v_price numeric;
  v_available integer;
  v_channel_product_id uuid;
  v_is_unlimited boolean;
  v_subtotal numeric := 0;
  v_candidates jsonb := '[]'::jsonb;
  v_selected jsonb := '[]'::jsonb;
  v_required_choices jsonb := '[]'::jsonb;
  v_reward_lines jsonb := '[]'::jsonb;
  v_applied jsonb := '[]'::jsonb;
  v_rule record;
  v_candidate jsonb;
  v_eligible_qty integer;
  v_eligible_amount numeric;
  v_eligible_ids jsonb;
  v_bundle_count integer;
  v_discount numeric;
  v_earned integer;
  v_options jsonb;
  v_resolution jsonb;
  v_conflict_ids text[];
  v_selected_choice text;
  v_discount_total numeric := 0;
  v_tier record;
  v_tier_ids jsonb;
  v_tier_rewards jsonb;
  v_net_eligible numeric;
  v_result jsonb;
  v_hash text;
begin
  if (p_event_id is null) = (p_campaign_id is null) then
    raise exception 'promotion_context_required';
  end if;

  if p_event_id is not null then
    if p_event_phase not in ('preorder', 'live', 'postorder') then
      raise exception 'promotion_event_phase_invalid';
    end if;

    select e.artist_id
    into v_artist_id
    from public.events e
    where e.id = p_event_id;
  else
    if p_event_phase is not null then
      raise exception 'promotion_event_phase_invalid';
    end if;

    select c.artist_id
    into v_artist_id
    from public.online_campaigns c
    where c.id = p_campaign_id;
  end if;

  if v_artist_id is null then
    raise exception 'promotion_context_not_found';
  end if;

  v_can_manage := public.has_artist_role(v_artist_id, array['owner', 'manager', 'seller']);

  if not v_can_manage then
    if p_campaign_id is not null and not exists (
      select 1
      from public.online_campaigns c
      join public.artists a on a.id = c.artist_id
      where c.id = p_campaign_id
        and c.publication_status = 'published'
        and c.opens_at <= now()
        and c.closes_at > now()
        and a.is_public and a.is_verified and a.published_at is not null
    ) then
      raise exception 'promotion_context_closed';
    end if;

    if p_event_id is not null and not exists (
      select 1
      from public.events e
      join public.artists a on a.id = e.artist_id
      where e.id = p_event_id
        and e.status = 'Confirmed'
        and a.is_public and a.is_verified and a.published_at is not null
        and (
          (p_event_phase = 'live' and e.is_booth_open and e.start_date <= now() and e.end_date > now())
          or (p_event_phase = 'preorder' and e.preorder_enabled
            and coalesce(e.preorder_opens_at, '-infinity'::timestamptz) <= now()
            and coalesce(e.preorder_closes_at, e.start_date) > now())
          or (p_event_phase = 'postorder' and e.postorder_enabled
            and coalesce(e.postorder_opens_at, e.end_date) <= now()
            and coalesce(e.postorder_closes_at, 'infinity'::timestamptz) > now())
        )
    ) then
      raise exception 'promotion_context_closed';
    end if;
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'promotion_items_invalid';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item(value)
  loop
    begin
      v_quantity := (v_item ->> 'quantity')::integer;
    exception when others then
      raise exception 'promotion_quantity_invalid';
    end;

    if v_quantity <= 0 then
      raise exception 'promotion_quantity_invalid';
    end if;

    if (v_item ->> 'product_id')::uuid = any(v_seen_product_ids) then
      raise exception 'promotion_duplicate_product';
    end if;
    v_seen_product_ids := array_append(v_seen_product_ids, (v_item ->> 'product_id')::uuid);

    if p_event_id is not null then
      select
        p.id,
        p.name,
        p.sku,
        p.category,
        p.tags,
        coalesce(ep.price_override, p.price),
        ep.id,
        (private.event_supply_available(p_event_id,p.id,p_event_phase) is null),
        private.event_supply_available(p_event_id,p.id,p_event_phase)
      into
        v_product_id,
        v_product_name,
        v_product_sku,
        v_product_category,
        v_product_tags,
        v_price,
        v_channel_product_id,
        v_is_unlimited,
        v_available
      from public.event_products ep
      join public.products p on p.id = ep.product_id
      where ep.event_id = p_event_id
        and ep.product_id = (v_item ->> 'product_id')::uuid
        and ep.is_enabled
        and ep.is_sellable
        and p.deleted_at is null;
    else
      select
        p.id,
        p.name,
        p.sku,
        p.category,
        p.tags,
        coalesce(cp.price_override, p.price),
        cp.id,
        (private.campaign_supply_available(p_campaign_id,p.id) is null),
        private.campaign_supply_available(p_campaign_id,p.id)
      into
        v_product_id,
        v_product_name,
        v_product_sku,
        v_product_category,
        v_product_tags,
        v_price,
        v_channel_product_id,
        v_is_unlimited,
        v_available
      from public.online_campaign_products cp
      join public.products p on p.id = cp.product_id
      where cp.campaign_id = p_campaign_id
        and cp.product_id = (v_item ->> 'product_id')::uuid
        and cp.is_enabled
        and cp.is_sellable
        and p.deleted_at is null;
    end if;

    if v_product_id is null then
      raise exception 'sale_product_unavailable';
    end if;

    if not v_is_unlimited and v_quantity > v_available then
      raise exception 'sale_product_unavailable';
    end if;

    v_subtotal := v_subtotal + v_price * v_quantity;
    v_cart := v_cart || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'name', v_product_name,
      'sku', v_product_sku,
      'category', v_product_category,
      'tags', to_jsonb(coalesce(v_product_tags, '{}'::text[])),
      'price', v_price,
      'quantity', v_quantity,
      'channel_product_id', v_channel_product_id,
      'is_unlimited', v_is_unlimited,
      'available', v_available
    ));

    v_product_id := null;
  end loop;

  for v_rule in
    select ap.*, pa.id as assignment_id, pa.combination_policy
    from public.promotion_assignments pa
    join public.artist_promotions ap on ap.id = pa.promotion_id
    where pa.artist_id = v_artist_id
      and ap.lifecycle_status = 'ready'
      and not pa.is_paused
      and (pa.starts_at is null or pa.starts_at <= now())
      and (pa.ends_at is null or pa.ends_at > now())
      and (
        (p_event_id is not null and pa.event_id = p_event_id and pa.event_phase = p_event_phase)
        or (p_campaign_id is not null and pa.campaign_id = p_campaign_id)
      )
      and ap.promotion_type <> 'spend_tier_gift'
    order by ap.priority, ap.created_at, pa.id
  loop
    select
      coalesce(sum((cart_item.value ->> 'quantity')::integer), 0)::integer,
      coalesce(sum((cart_item.value ->> 'quantity')::integer * (cart_item.value ->> 'price')::numeric), 0),
      coalesce(jsonb_agg(cart_item.value ->> 'product_id'), '[]'::jsonb)
    into v_eligible_qty, v_eligible_amount, v_eligible_ids
    from jsonb_array_elements(v_cart) cart_item(value)
    where private.promotion_matches_product(
      v_rule.target_type,
      v_rule.match_category,
      v_rule.match_tag,
      v_rule.match_product_id,
      v_rule.match_product_ids,
      (cart_item.value ->> 'product_id')::uuid,
      cart_item.value ->> 'category',
      array(select jsonb_array_elements_text(cart_item.value -> 'tags'))
    );

    if v_rule.promotion_type = 'quantity_discount' then
      v_bundle_count := floor(v_eligible_qty / v_rule.buy_quantity);
      v_discount := least(v_eligible_amount, v_bundle_count * v_rule.reward_value);
      if v_bundle_count > 0 and v_discount > 0 then
        v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
          'id', v_rule.id,
          'assignment_id', v_rule.assignment_id,
          'revision', v_rule.revision,
          'name', coalesce(nullif(trim(v_rule.name), ''), 'Promotion'),
          'rule_text', format('Every %s qualifying items, save %s', v_rule.buy_quantity, v_rule.reward_value),
          'promotion_type', v_rule.promotion_type,
          'combination_policy', v_rule.combination_policy,
          'eligible_product_ids', v_eligible_ids,
          'bundle_count', v_bundle_count,
          'discount_amount', v_discount,
          'reached_tier_ids', '[]'::jsonb,
          'rewards', '[]'::jsonb
        ));
      end if;
    elsif v_rule.promotion_type = 'legacy_free_eligible_items' then
      v_bundle_count := floor(v_eligible_qty / (v_rule.buy_quantity + v_rule.reward_quantity));
      v_earned := v_bundle_count * v_rule.reward_quantity;
      if v_earned > 0 then
        select coalesce(sum(unit_price), 0)
        into v_discount
        from (
          select (cart_item.value ->> 'price')::numeric as unit_price
          from jsonb_array_elements(v_cart) cart_item(value)
          cross join lateral generate_series(1, (cart_item.value ->> 'quantity')::integer)
          where (cart_item.value ->> 'product_id')::uuid in (
            select value::uuid from jsonb_array_elements_text(v_eligible_ids)
          )
          order by unit_price
          limit v_earned
        ) cheapest;

        v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
          'id', v_rule.id,
          'assignment_id', v_rule.assignment_id,
          'revision', v_rule.revision,
          'name', coalesce(nullif(trim(v_rule.name), ''), 'Promotion'),
          'rule_text', format('Buy %s qualifying items, get %s eligible item free', v_rule.buy_quantity, v_rule.reward_quantity),
          'promotion_type', v_rule.promotion_type,
          'combination_policy', v_rule.combination_policy,
          'eligible_product_ids', v_eligible_ids,
          'bundle_count', v_bundle_count,
          'discount_amount', least(v_eligible_amount, v_discount),
          'reached_tier_ids', '[]'::jsonb,
          'rewards', '[]'::jsonb
        ));
      end if;
    elsif v_rule.promotion_type = 'quantity_gift' then
      v_bundle_count := floor(v_eligible_qty / v_rule.buy_quantity);
      v_earned := v_bundle_count * v_rule.reward_quantity;
      if v_earned > 0 then
        v_options := private.production_reward_options(
          v_rule.id, null, p_event_id, p_campaign_id, v_earned, p_event_phase
        );
        v_resolution := private.resolve_promotion_rewards(
          v_rule.id,
          null,
          v_rule.reward_selection_mode,
          v_earned,
          v_options,
          p_reward_choices
        );

        if not (v_resolution ->> 'resolved')::boolean then
          v_required_choices := v_required_choices || jsonb_build_array(jsonb_build_object(
            'kind', 'reward',
            'promotion_id', v_rule.id,
            'earned_quantity', v_earned,
            'exhausted', (v_resolution ->> 'exhausted')::boolean,
            'options', v_resolution -> 'options',
            'available_quantity', v_resolution -> 'available_quantity',
            'partial', v_resolution -> 'partial'
          ));
        else
          v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
            'id', v_rule.id,
            'assignment_id', v_rule.assignment_id,
            'revision', v_rule.revision,
            'name', coalesce(nullif(trim(v_rule.name), ''), 'Promotion'),
            'rule_text', format('Every %s qualifying items, receive %s gift', v_rule.buy_quantity, v_rule.reward_quantity),
            'promotion_type', v_rule.promotion_type,
            'combination_policy', v_rule.combination_policy,
            'eligible_product_ids', v_eligible_ids,
            'bundle_count', v_bundle_count,
            'discount_amount', 0,
            'reached_tier_ids', '[]'::jsonb,
            'rewards', v_resolution -> 'lines'
          ));
        end if;
      end if;
    end if;
  end loop;

  for v_candidate in
    select candidate.value
    from jsonb_array_elements(v_candidates) candidate(value)
    order by (candidate.value ->> 'discount_amount')::numeric desc,
      candidate.value ->> 'id'
  loop
    select coalesce(array_agg(selected_item.value ->> 'id'), '{}'::text[])
    into v_conflict_ids
    from jsonb_array_elements(v_selected) selected_item(value)
    where private.jsonb_text_arrays_overlap(
      selected_item.value -> 'eligible_product_ids',
      v_candidate -> 'eligible_product_ids'
    )
      and not (
        selected_item.value ->> 'combination_policy' = 'combine'
        and v_candidate ->> 'combination_policy' = 'combine'
      );

    if cardinality(v_conflict_ids) = 0 then
      v_selected := v_selected || jsonb_build_array(v_candidate);
    elsif v_candidate ->> 'promotion_type' in ('quantity_discount', 'legacy_free_eligible_items')
      and not exists (
        select 1
        from jsonb_array_elements(v_selected) selected_item(value)
        where selected_item.value ->> 'id' = any(v_conflict_ids)
          and selected_item.value ->> 'promotion_type' not in ('quantity_discount', 'legacy_free_eligible_items')
      ) then
      -- Candidates are ordered by customer discount, so the already-selected rule wins ties.
      continue;
    else
      select choice.value ->> 'selected_promotion_id'
      into v_selected_choice
      from jsonb_array_elements(coalesce(p_promotion_choices, '[]'::jsonb)) choice(value)
      where choice.value ->> 'selected_promotion_id' = v_candidate ->> 'id'
         or choice.value ->> 'selected_promotion_id' = any(v_conflict_ids)
      limit 1;

      if v_selected_choice = v_candidate ->> 'id' then
        select coalesce(jsonb_agg(selected_item.value), '[]'::jsonb)
        into v_selected
        from jsonb_array_elements(v_selected) selected_item(value)
        where not (selected_item.value ->> 'id' = any(v_conflict_ids));
        v_selected := v_selected || jsonb_build_array(v_candidate);
      elsif v_selected_choice = any(v_conflict_ids) then
        continue;
      else
        select coalesce(jsonb_agg(selected_item.value), '[]'::jsonb)
        into v_selected
        from jsonb_array_elements(v_selected) selected_item(value)
        where not (selected_item.value ->> 'id' = any(v_conflict_ids));

        v_required_choices := v_required_choices || jsonb_build_array(jsonb_build_object(
          'kind', 'exclusive_promotion',
          'promotion_id', v_candidate ->> 'id',
          'options', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'id', option_item.value ->> 'id',
              'name', option_item.value ->> 'name',
              'benefit_text', option_item.value ->> 'rule_text'
            )), '[]'::jsonb)
            from (
              select selected_item.value
              from jsonb_array_elements(v_candidates) selected_item(value)
              where selected_item.value ->> 'id' = any(v_conflict_ids)
                 or selected_item.value ->> 'id' = v_candidate ->> 'id'
            ) option_item
          )
        ));
      end if;
    end if;
  end loop;

  select coalesce(sum((selected_item.value ->> 'discount_amount')::numeric), 0)
  into v_discount_total
  from jsonb_array_elements(v_selected) selected_item(value);
  v_discount_total := least(v_subtotal, v_discount_total);

  for v_rule in
    select ap.*, pa.id as assignment_id, pa.combination_policy
    from public.promotion_assignments pa
    join public.artist_promotions ap on ap.id = pa.promotion_id
    where pa.artist_id = v_artist_id
      and ap.lifecycle_status = 'ready'
      and ap.promotion_type = 'spend_tier_gift'
      and not pa.is_paused
      and (pa.starts_at is null or pa.starts_at <= now())
      and (pa.ends_at is null or pa.ends_at > now())
      and (
        (p_event_id is not null and pa.event_id = p_event_id and pa.event_phase = p_event_phase)
        or (p_campaign_id is not null and pa.campaign_id = p_campaign_id)
      )
    order by ap.priority, ap.created_at, pa.id
  loop
    select
      coalesce(sum((cart_item.value ->> 'quantity')::integer * (cart_item.value ->> 'price')::numeric), 0),
      coalesce(jsonb_agg(cart_item.value ->> 'product_id'), '[]'::jsonb)
    into v_eligible_amount, v_eligible_ids
    from jsonb_array_elements(v_cart) cart_item(value)
    where private.promotion_matches_product(
      v_rule.target_type,
      v_rule.match_category,
      v_rule.match_tag,
      v_rule.match_product_id,
      v_rule.match_product_ids,
      (cart_item.value ->> 'product_id')::uuid,
      cart_item.value ->> 'category',
      array(select jsonb_array_elements_text(cart_item.value -> 'tags'))
    );

    v_net_eligible := greatest(0, v_eligible_amount - v_discount_total);
    v_tier_ids := '[]'::jsonb;
    v_tier_rewards := '[]'::jsonb;

    for v_tier in
      select pt.*
      from public.promotion_tiers pt
      where pt.promotion_id = v_rule.id
        and pt.threshold_amount <= v_net_eligible
      order by
        case when v_rule.tier_grant_mode = 'highest_only' then pt.threshold_amount end desc,
        pt.threshold_amount asc
      limit case when v_rule.tier_grant_mode = 'highest_only' then 1 else 2147483647 end
    loop
      v_options := private.production_reward_options(
        v_rule.id, v_tier.id, p_event_id, p_campaign_id, v_tier.reward_quantity, p_event_phase
      );
      v_resolution := private.resolve_promotion_rewards(
        v_rule.id,
        v_tier.id,
        v_tier.reward_selection_mode,
        v_tier.reward_quantity,
        v_options,
        p_reward_choices
      );

      if not (v_resolution ->> 'resolved')::boolean then
        v_required_choices := v_required_choices || jsonb_build_array(jsonb_build_object(
          'kind', 'reward',
          'promotion_id', v_rule.id,
          'tier_id', v_tier.id,
          'earned_quantity', v_tier.reward_quantity,
          'exhausted', (v_resolution ->> 'exhausted')::boolean,
          'options', v_resolution -> 'options',
            'available_quantity', v_resolution -> 'available_quantity',
            'partial', v_resolution -> 'partial'
        ));
      else
        v_tier_ids := v_tier_ids || to_jsonb(v_tier.id::text);
        v_tier_rewards := v_tier_rewards || (v_resolution -> 'lines');
      end if;
    end loop;

    if jsonb_array_length(v_tier_ids) > 0 then
      v_selected := v_selected || jsonb_build_array(jsonb_build_object(
        'id', v_rule.id,
        'assignment_id', v_rule.assignment_id,
        'revision', v_rule.revision,
        'name', coalesce(nullif(trim(v_rule.name), ''), 'Promotion'),
        'rule_text', case v_rule.tier_grant_mode
          when 'cumulative' then 'Receive every reached spend-tier gift'
          else 'Receive the highest reached spend-tier gift'
        end,
        'promotion_type', v_rule.promotion_type,
        'combination_policy', v_rule.combination_policy,
        'eligible_product_ids', v_eligible_ids,
        'bundle_count', 0,
        'discount_amount', 0,
        'reached_tier_ids', v_tier_ids,
        'rewards', v_tier_rewards
      ));
    end if;
  end loop;

  select coalesce(jsonb_agg(reward_item.value), '[]'::jsonb)
  into v_reward_lines
  from jsonb_array_elements(v_selected) selected_item(value)
  cross join lateral jsonb_array_elements(coalesce(selected_item.value -> 'rewards', '[]'::jsonb)) reward_item(value);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', selected_item.value ->> 'id',
    'assignment_id', selected_item.value ->> 'assignment_id',
    'revision', (selected_item.value ->> 'revision')::bigint,
    'name', selected_item.value ->> 'name',
    'rule_text', selected_item.value ->> 'rule_text',
    'bundle_count', (selected_item.value ->> 'bundle_count')::integer,
    'discount_amount', (selected_item.value ->> 'discount_amount')::numeric,
    'reached_tier_ids', selected_item.value -> 'reached_tier_ids',
    'rewards', selected_item.value -> 'rewards'
  )), '[]'::jsonb)
  into v_applied
  from jsonb_array_elements(v_selected) selected_item(value);

  v_result := jsonb_build_object(
    'subtotal', v_subtotal,
    'discount_total', v_discount_total,
    'merchandise_total', greatest(0, v_subtotal - v_discount_total),
    'shipping_fee', 0,
    'total', greatest(0, v_subtotal - v_discount_total),
    'applied_promotions', v_applied,
    'reward_lines', v_reward_lines,
    'supply_policies', (select coalesce(jsonb_agg(jsonb_build_object('product_id',line.product_id,'mode',
      case when p_campaign_id is not null then case when private.campaign_production(p_campaign_id,line.product_id) then 'production' else 'stock' end
      else case when private.event_production(p_event_id,line.product_id,p_event_phase) then 'production' else 'stock' end end) order by line.product_id),'[]'::jsonb)
      from (select distinct (x->>'product_id')::uuid product_id from jsonb_array_elements(v_cart||v_reward_lines) x) line),
    'required_choices', v_required_choices
  );

  v_hash := encode(extensions.digest(convert_to(v_result::text, 'UTF8'), 'sha256'), 'hex');
  return v_result || jsonb_build_object('pricing_hash', v_hash);
end;
$function$
;

drop function public.list_event_products(uuid);
CREATE OR REPLACE FUNCTION public.list_event_products(p_event_id uuid)
 RETURNS TABLE(id uuid, artist_id uuid, name text, price numeric, image_url text, description text, category text, tags text[], status text, currency text, stock_total integer, stock_reserved integer, stock_sold integer, is_unlimited boolean, deleted_at timestamp with time zone, event_product_id uuid, event_id uuid, price_override numeric, event_catalog_enabled boolean, event_catalog_mode boolean, variant_group_name text, variant_name text, variant_sort_order integer, parent_product_id uuid, product_kind text, gallery_images jsonb, variant_gallery_images jsonb, bundle_items jsonb, preorder_closes_at timestamp with time zone, preorder_eta text, service_duration_minutes integer, service_slots integer, service_kind text, supply_mode text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_event record;
  v_has_catalog boolean := false;
  v_allowed boolean := false;
begin
  select e.*, a.is_public, a.is_verified
  into v_event
  from public.events e
  join public.artists a on a.id = e.artist_id
  where e.id = p_event_id;

  if v_event.id is null then
    raise exception 'event_not_found';
  end if;

  v_allowed :=
    (coalesce(v_event.is_public, false) = true and coalesce(v_event.is_verified, false) = true)
    or public.has_artist_role(v_event.artist_id, array['owner', 'queue_pos', 'queue_only'])
    or public.is_platform_admin();

  if not v_allowed then
    raise exception 'forbidden';
  end if;

  select exists (
    select 1
    from public.event_products ep
    where ep.event_id = p_event_id
  ) into v_has_catalog;

  if v_has_catalog then
    return query
    select
      p.id,
      p.artist_id,
      p.name,
      coalesce(ep.price_override, p.price) as price,
      p.image_url,
      p.description,
      p.category,
      coalesce(p.tags, '{}'::text[]) as tags,
      p.status,
      coalesce(v_event.currency_override, p.currency, 'THB') as currency,
      case when private.event_production(p_event_id,p.id,private.active_event_phase(p_event_id)) then private.event_supply_available(p_event_id,p.id,private.active_event_phase(p_event_id)) else ep.stock_total end as stock_total,
      case when private.event_production(p_event_id,p.id,private.active_event_phase(p_event_id)) then 0 else coalesce(ep.stock_reserved,0) end as stock_reserved,
      case when private.event_production(p_event_id,p.id,private.active_event_phase(p_event_id)) then 0 else coalesce(ep.stock_sold,0) end as stock_sold,
      (private.event_supply_available(p_event_id,p.id,private.active_event_phase(p_event_id)) is null),
      p.deleted_at,
      ep.id as event_product_id,
      ep.event_id,
      ep.price_override,
      ep.is_enabled as event_catalog_enabled,
      true as event_catalog_mode,
      nullif(btrim(p.variant_group_name), '') as variant_group_name,
      nullif(btrim(p.variant_name), '') as variant_name,
      coalesce(p.variant_sort_order, 0) as variant_sort_order, p.parent_product_id, p.product_kind, p.gallery_images, p.variant_gallery_images, p.bundle_items, p.preorder_closes_at, p.preorder_eta, p.service_duration_minutes, p.service_slots, p.service_kind, case when private.event_production(p_event_id,p.id,private.active_event_phase(p_event_id)) then 'production' else 'stock' end
    from public.event_products ep
    join public.products p on p.id = ep.product_id
    where ep.event_id = p_event_id
      and ep.artist_id = v_event.artist_id
      and ep.is_enabled = true and ep.is_sellable = true
      and p.artist_id = v_event.artist_id
      and p.deleted_at is null
      and p.status in ('enable', 'soldout')
    order by nullif(btrim(p.variant_group_name), '') nulls last, coalesce(p.variant_sort_order, 0), p.name;
    return;
  end if;

  return query
  select
    p.id,
    p.artist_id,
    p.name,
    p.price,
    p.image_url,
    p.description,
    p.category,
    coalesce(p.tags, '{}'::text[]) as tags,
    p.status,
    coalesce(v_event.currency_override, p.currency, 'THB') as currency,
    p.stock_total,
    coalesce(p.stock_reserved, 0) as stock_reserved,
    coalesce(p.stock_sold, 0) as stock_sold,
    coalesce(p.is_unlimited, true) as is_unlimited,
    p.deleted_at,
    null::uuid as event_product_id,
    p_event_id as event_id,
    null::numeric as price_override,
    true as event_catalog_enabled,
    false as event_catalog_mode,
    nullif(btrim(p.variant_group_name), '') as variant_group_name,
    nullif(btrim(p.variant_name), '') as variant_name,
    coalesce(p.variant_sort_order, 0) as variant_sort_order, p.parent_product_id, p.product_kind, p.gallery_images, p.variant_gallery_images, p.bundle_items, p.preorder_closes_at, p.preorder_eta, p.service_duration_minutes, p.service_slots, p.service_kind, 'stock'::text
  from public.products p
  where p.artist_id = v_event.artist_id
    and p.deleted_at is null
    and p.status in ('enable', 'soldout')
  order by nullif(btrim(p.variant_group_name), '') nulls last, coalesce(p.variant_sort_order, 0), p.name;
end;
$function$
;
revoke all on function public.list_event_products(uuid) from public;
grant execute on function public.list_event_products(uuid) to anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_public_online_campaign(p_artist_slug text, p_campaign_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign record;
  v_state text;
  v_has_sellable boolean;
  v_products jsonb;
  v_pickup_points jsonb;
  v_payment_methods jsonb;
begin
  select
    c.*,
    a.slug as artist_slug,
    a.display_name as artist_name,
    a.image_url as artist_image_url
  into v_campaign
  from public.online_campaigns c
  join public.artists a on a.id = c.artist_id
  where lower(a.slug) = lower(trim(p_artist_slug))
    and lower(c.slug) = lower(trim(p_campaign_slug))
    and a.is_public = true
    and a.is_verified = true
    and c.publication_status in ('published', 'cancelled');

  if v_campaign.id is null then
    return null;
  end if;

  select exists (
    select 1
    from public.online_campaign_products cp
    join public.products p on p.id = cp.product_id
    where cp.campaign_id = v_campaign.id
      and cp.is_enabled = true
      and p.deleted_at is null
      and p.status = 'enable'
      and (
        private.campaign_supply_available(cp.campaign_id,cp.product_id) is null
        or private.campaign_supply_available(cp.campaign_id,cp.product_id)>0
      )
  ) into v_has_sellable;

  v_state := case
    when v_campaign.publication_status = 'cancelled' then 'cancelled'
    when now() < v_campaign.opens_at then 'scheduled'
    when now() >= v_campaign.closes_at then 'closed'
    when not v_has_sellable then 'sold_out'
    else 'open'
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'campaign_product_id', cp.id,
    'product_id', p.id,
    'name', p.name,
    'description', p.description,
    'category', p.category,
    'tags', p.tags,
    'image_url', p.image_url,
    'sku', p.sku,
    'parent_product_id', p.parent_product_id, 'product_kind', p.product_kind, 'gallery_images', p.gallery_images, 'variant_gallery_images', p.variant_gallery_images, 'bundle_items', p.bundle_items, 'preorder_closes_at', p.preorder_closes_at, 'preorder_eta', p.preorder_eta, 'service_duration_minutes', p.service_duration_minutes, 'service_slots', p.service_slots, 'service_kind', p.service_kind, 'variant_group_name', p.variant_group_name,
    'variant_name', p.variant_name,
    'price', coalesce(cp.price_override, p.price),
    'currency', v_campaign.currency,
    'supply_mode', cp.supply_mode, 'is_unlimited', private.campaign_supply_available(cp.campaign_id,cp.product_id) is null,
    'max_quantity_per_order', cp.max_quantity_per_order,
    'available_quantity', private.campaign_supply_available(cp.campaign_id,cp.product_id)
  ) order by p.variant_group_name nulls first, p.variant_sort_order, p.name), '[]'::jsonb)
  into v_products
  from public.online_campaign_products cp
  join public.products p on p.id = cp.product_id
  where cp.campaign_id = v_campaign.id
    and cp.is_enabled = true
    and p.deleted_at is null
    and p.status = 'enable';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pp.id,
    'name', pp.name,
    'address', pp.address,
    'starts_at', pp.starts_at,
    'ends_at', pp.ends_at,
    'instructions', pp.instructions
  ) order by pp.starts_at), '[]'::jsonb)
  into v_pickup_points
  from public.campaign_pickup_points pp
  where pp.campaign_id = v_campaign.id
    and pp.is_enabled = true;

  if v_state = 'open' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', pm.id,
      'method_type', pm.method_type,
      'display_name', pm.display_name,
      'account_name', pm.account_name,
      'account_number', pm.account_number,
      'bank_name', pm.bank_name,
      'bank_accounts', pm.bank_accounts,
      'promptpay_id', pm.promptpay_id,
      'qr_image_url', pm.qr_image_url,
      'instructions', pm.instructions
    ) order by pm.created_at), '[]'::jsonb)
    into v_payment_methods
    from public.campaign_payment_methods pm
    where pm.campaign_id = v_campaign.id
      and pm.is_enabled = true;
  else
    v_payment_methods := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'id', v_campaign.id,
    'artist_id', v_campaign.artist_id,
    'artist_slug', v_campaign.artist_slug,
    'artist_name', v_campaign.artist_name,
    'artist_image_url', v_campaign.artist_image_url,
    'name', v_campaign.name,
    'slug', v_campaign.slug,
    'description', v_campaign.description,
    'opens_at', v_campaign.opens_at,
    'closes_at', v_campaign.closes_at,
    'campaign_timezone', v_campaign.campaign_timezone,
    'currency', v_campaign.currency,
    'shipping_enabled', v_campaign.shipping_enabled,
    'flat_shipping_fee', v_campaign.flat_shipping_fee,
    'pickup_enabled', v_campaign.pickup_enabled,
    'state', v_state,
    'products', v_products,
    'pickup_points', v_pickup_points,
    'artist_seller_type', (select a.seller_type from public.artists a where a.id = v_campaign.artist_id),
    'payment_methods', v_payment_methods
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_product_family(p_parent_id uuid, p_parent jsonb, p_variants jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  parent public.product_parents%rowtype; old_child public.products%rowtype;
  item jsonb; child_id uuid; kept uuid[] := '{}'; artist uuid;
  total integer; unlimited boolean; commitments bigint; v_override numeric;
  v_gallery jsonb;
begin
  artist:=(p_parent->>'artist_id')::uuid;
  if p_parent_id is not null then
    select * into parent from public.product_parents where id=p_parent_id for update;
    if parent.id is null then raise exception 'product_parent_not_found'; end if;
    if artist is not null and artist<>parent.artist_id then raise exception 'forbidden'; end if;
    artist:=parent.artist_id;

  end if;
  if auth.uid() is null or artist is null or not public.has_artist_role(artist,array['owner','manager']) then raise exception 'forbidden'; end if;
    if p_parent ? 'updated_at' and (p_parent->>'updated_at')::timestamptz is distinct from parent.updated_at then raise exception 'product_family_changed_reload'; end if;
  if jsonb_typeof(p_variants) is distinct from 'array' or jsonb_array_length(p_variants) not between 1 and 200 then raise exception 'invalid_variants'; end if;
  if exists(select 1 from jsonb_array_elements(p_variants) v where nullif(btrim(v->>'name'),'') is null) then raise exception 'variant_name_required'; end if;
  if (select count(*)<>count(distinct lower(btrim(v->>'name'))) from jsonb_array_elements(p_variants) v) then raise exception 'duplicate_variant_name'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_parent->'gallery_images','[]')) v where jsonb_typeof(v)<>'string') then raise exception 'invalid_gallery'; end if;
  if exists(
    select 1 from jsonb_array_elements(p_variants) v
    where v ? 'variant_gallery_images'
      and jsonb_typeof(v->'variant_gallery_images') not in ('array','null')
  ) then raise exception 'invalid_variant_gallery'; end if;
  if exists(
    select 1 from jsonb_array_elements(p_variants) v
    where jsonb_array_length(case when jsonb_typeof(v->'variant_gallery_images')='array' then v->'variant_gallery_images' else '[]'::jsonb end)>50
  ) then raise exception 'invalid_variant_gallery'; end if;
  if exists(
    select 1
    from jsonb_array_elements(p_variants) v
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(v->'variant_gallery_images')='array' then v->'variant_gallery_images' else '[]'::jsonb end
    ) image
    where jsonb_typeof(image)<>'string'
  ) then raise exception 'invalid_variant_gallery'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_parent->'bundle_items','[]')) v
    where nullif(btrim(v->>'name'),'') is null or coalesce((v->>'quantity')::numeric,0)<=0 or (v->>'quantity')::numeric<>trunc((v->>'quantity')::numeric)) then raise exception 'invalid_bundle_items'; end if;
  if parent.id is null then
    insert into public.product_parents(artist_id,name) values(artist,btrim(p_parent->>'name')) returning * into parent;
  end if;
  update public.product_parents set name=btrim(p_parent->>'name'),description=coalesce(p_parent->>'description',''),
    category=coalesce(nullif(p_parent->>'category',''),'Other'),tags=array(select jsonb_array_elements_text(coalesce(p_parent->'tags','[]'))),
    image_url=nullif(p_parent->>'image_url',''),currency=coalesce(nullif(p_parent->>'currency',''),'THB'),base_price=coalesce((p_parent->>'base_price')::numeric,0),
    product_kind=coalesce(p_parent->>'product_kind','single'),gallery_images=coalesce(p_parent->'gallery_images','[]'),bundle_items=coalesce(p_parent->'bundle_items','[]'),
    preorder_closes_at=nullif(p_parent->>'preorder_closes_at','')::timestamptz,preorder_eta=nullif(p_parent->>'preorder_eta',''),
    service_duration_minutes=nullif(p_parent->>'service_duration_minutes','')::integer,service_slots=nullif(p_parent->>'service_slots','')::integer,
    service_kind=nullif(p_parent->>'service_kind',''),updated_at=clock_timestamp()
    where id=parent.id returning * into parent;
  -- Stable lock ordering matches inventory UUID identity and serializes two family saves.
  perform 1 from public.products where parent_product_id=parent.id order by id for update;
  for item in select value from jsonb_array_elements(p_variants) loop
    child_id:=nullif(item->>'id','')::uuid;
    unlimited:=coalesce((item->>'is_unlimited')::boolean,false);
    total:=case when unlimited then null else coalesce((item->>'stock_total')::integer,0) end;
    if total<0 then raise exception 'invalid_stock_quantity'; end if;
    v_override:=nullif(item->>'price_override','')::numeric;
    if child_id is not null then
      if child_id=any(kept) then raise exception 'duplicate_variant_id'; end if;
      select * into old_child from public.products where id=child_id and parent_product_id=parent.id and deleted_at is null;
      if not found then raise exception 'variant_not_in_family'; end if;
      if item ? 'updated_at' and (item->>'updated_at')::timestamptz is distinct from old_child.updated_at then raise exception 'product_family_changed_reload'; end if;
      v_gallery:=case
        when item ? 'variant_gallery_images' then nullif(item->'variant_gallery_images','null'::jsonb)
        else old_child.variant_gallery_images
      end;
      if old_child.is_unlimited is distinct from unlimited then
        select coalesce(old_child.stock_sold,0)+coalesce(old_child.stock_reserved,0)
          +(select count(*) from public.event_products where product_id=child_id)
          +(select count(*) from public.online_campaign_products where product_id=child_id)
          into commitments;
        if commitments>0 then
          if unlimited then raise exception 'allocated_variant_stock_mode_locked'; else raise exception 'use_stock_tracking_setup'; end if;
        end if;
        update public.products set is_unlimited=unlimited,stock_total=total where id=child_id;
      elsif not unlimited then
        if total>coalesce(old_child.stock_total,0) then
          perform public.add_catalog_stock(child_id,total-coalesce(old_child.stock_total,0),'Variant editor');
        elsif total<coalesce(old_child.stock_total,0) then
          perform public.remove_catalog_stock(child_id,coalesce(old_child.stock_total,0)-total,'Variant editor correction');
        end if;
      end if;
      update public.products set name=case when jsonb_array_length(p_variants)=1 and item->>'name'='Default' then parent.name else parent.name||' — '||btrim(item->>'name') end,
        variant_name=btrim(item->>'name'),variant_group_name=case when jsonb_array_length(p_variants)>1 then parent.name else null end,
        variant_sort_order=coalesce((item->>'variant_sort_order')::integer,0),sku=nullif(item->>'sku',''),price_override=v_override,price=coalesce(v_override,parent.base_price),
        image_url=coalesce(nullif(item->>'image_url',''),parent.image_url),variant_gallery_images=v_gallery,status=coalesce(item->>'status','enable'),
        description=parent.description,category=parent.category,tags=parent.tags,currency=parent.currency
        where id=child_id;
    else
      v_gallery:=nullif(item->'variant_gallery_images','null'::jsonb);
      insert into public.products(artist_id,parent_product_id,name,variant_name,variant_group_name,variant_sort_order,sku,price_override,price,image_url,variant_gallery_images,status,description,category,tags,currency,stock_total,is_unlimited)
        values(artist,parent.id,case when jsonb_array_length(p_variants)=1 and item->>'name'='Default' then parent.name else parent.name||' — '||btrim(item->>'name') end,
          btrim(item->>'name'),case when jsonb_array_length(p_variants)>1 then parent.name else null end,coalesce((item->>'variant_sort_order')::integer,0),nullif(item->>'sku',''),v_override,coalesce(v_override,parent.base_price),
          coalesce(nullif(item->>'image_url',''),parent.image_url),v_gallery,coalesce(item->>'status','enable'),parent.description,parent.category,parent.tags,parent.currency,total,unlimited)
        returning id into child_id;
    end if;
    kept:=array_append(kept,child_id);
  end loop;
  for old_child in select * from public.products where parent_product_id=parent.id and deleted_at is null and not(id=any(kept)) loop
    -- Never orphan a live allocation or hold. Historical sale references remain intact.
    if coalesce(old_child.stock_reserved,0)>0 or exists(select 1 from public.event_products where product_id=old_child.id and (is_enabled or stock_reserved>0))
      or exists(select 1 from public.online_campaign_products where product_id=old_child.id and (is_enabled or stock_reserved>0)) then
      raise exception 'variant_in_use_disable_in_channels_first';
    end if;
    update public.products set deleted_at=now(),status='disable' where id=old_child.id;
  end loop;
  return parent.id;
end $function$
;

create table private.inventory_events (
 id uuid primary key default gen_random_uuid(),product_id uuid not null references public.products(id) on delete cascade,
 actor_id uuid,created_at timestamptz not null default clock_timestamp(),kind text not null,
 quantity_before integer not null,quantity_after integer not null,order_item_id uuid,channel_id uuid
);
revoke all on private.inventory_events from public,anon,authenticated;
create index inventory_events_product_time on private.inventory_events(product_id,created_at desc);

create function private.inventory_overview(p_artist_id uuid) returns jsonb
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
       ep.stock_reserved+case when ep.is_enabled and not ep.is_unlimited and ((e.status in ('Confirmed','confirmed') and e.end_date>=now()) or (e.status in ('Confirmed','confirmed','Ended','ended') and e.postorder_enabled and coalesce(e.sales_status_override,'auto')<>'closed' and (e.postorder_closes_at is null or e.postorder_closes_at>=now())))
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
create function public.inventory_overview(p_artist_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.inventory_overview(p_artist_id) $$;
revoke all on function private.inventory_overview(uuid),public.inventory_overview(uuid) from public,anon;
grant execute on function private.inventory_overview(uuid),public.inventory_overview(uuid) to authenticated;

-- New snapshots cannot have their stock ownership changed through a generic update.
-- Legacy notes/retention edits still work. Quantity edits use existing delete-and-reinsert checkout transactions.

create function private.guard_stock_tracking() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.is_unlimited is distinct from new.is_unlimited then
   if new.is_unlimited and (old.stock_reserved+old.stock_sold>0 or exists(select 1 from public.event_products where product_id=old.id)
     or exists(select 1 from public.online_campaign_products where product_id=old.id)
     or exists(select 1 from private.production_stock where product_id=old.id)) then raise exception 'allocated_variant_stock_mode_locked'; end if;
   if not new.is_unlimited and coalesce(current_setting('nireq.stock_kind',true),'')<>'start_tracking'
     and (exists(select 1 from public.event_products where product_id=old.id) or exists(select 1 from public.online_campaign_products where product_id=old.id))
     then raise exception 'use_stock_tracking_setup'; end if;
 end if;
 return new;
end $$;
create trigger guard_stock_tracking before update of is_unlimited on public.products for each row execute function private.guard_stock_tracking();
revoke all on function private.guard_stock_tracking() from public,anon,authenticated;
create function private.stop_stock_tracking(p_product_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare p public.products;
begin
 select * into p from public.products where id=p_product_id and deleted_at is null for update;
 if auth.uid() is null or not public.has_artist_role(p.artist_id,array['owner','manager']) then raise exception 'forbidden'; end if;
 perform set_config('nireq.stock_kind','stop_tracking',true); perform set_config('nireq.stock_reason','Stop tracking before allocation',true);
 update public.products set is_unlimited=true,stock_total=null,updated_at=now() where id=p_product_id;
 perform set_config('nireq.stock_kind','',true); perform set_config('nireq.stock_reason','',true);
end $$;
create function public.stop_stock_tracking(p_product_id uuid) returns void language sql security invoker set search_path='' as $$ select private.stop_stock_tracking(p_product_id) $$;
revoke all on function private.stop_stock_tracking(uuid),public.stop_stock_tracking(uuid) from public,anon;
grant execute on function private.stop_stock_tracking(uuid),public.stop_stock_tracking(uuid) to authenticated;

create function private.rebalance_returned_stock() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.refresh_production_stock(new.product_id); return new;
end $$;
create trigger rebalance_event_stock after update of stock_total,is_enabled on public.event_products for each row execute function private.rebalance_returned_stock();
create trigger rebalance_campaign_stock after update of stock_total,is_enabled on public.online_campaign_products for each row execute function private.rebalance_returned_stock();
revoke all on function private.rebalance_returned_stock() from public,anon,authenticated;

create function private.production_order_stock(p_event_id uuid,p_campaign_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare artist uuid; result jsonb;
begin
 if num_nonnulls(p_event_id,p_campaign_id)<>1 then raise exception 'invalid_channel'; end if;
 if p_event_id is not null then
   select artist_id into artist from public.events where id=p_event_id;
   if not public.has_event_role(p_event_id,array['owner','manager','seller','queue_staff']) then raise exception 'forbidden'; end if;
 else
   select artist_id into artist from public.online_campaigns where id=p_campaign_id;
   if not public.has_artist_role(artist,array['owner','manager','seller']) then raise exception 'forbidden'; end if;
 end if;
 if auth.uid() is null then raise exception 'forbidden'; end if;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into result from (
 select o.id order_id,sum(oi.quantity)::integer required,
   sum(coalesce(s.allocated,0))::integer allocated,sum(coalesce(s.consumed,0))::integer fulfilled,
   sum(case when not p.is_unlimited then oi.quantity-coalesce(s.allocated,0) else 0 end)::integer shortfall,
   bool_and(not p.is_unlimited) tracking
 from public.orders o join public.order_items oi on oi.order_id=o.id join public.products p on p.id=oi.product_id
 left join private.production_stock s on s.order_item_id=oi.id
 where (o.event_id=p_event_id or o.campaign_id=p_campaign_id)
 and (oi.inventory_source='production' or s.order_item_id is not null) group by o.id
 ) r;
 return result;
end $$;
create function public.production_order_stock(p_event_id uuid default null,p_campaign_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$ select private.production_order_stock(p_event_id,p_campaign_id) $$;
revoke all on function private.production_order_stock(uuid,uuid),public.production_order_stock(uuid,uuid) from public,anon;
grant execute on function private.production_order_stock(uuid,uuid),public.production_order_stock(uuid,uuid) to authenticated;

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
      coalesce(ep.stock_reserved,0) + case when ep.is_enabled and not ep.is_unlimited
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
  select coalesce(sum(coalesce(ep.stock_reserved,0) + case when ep.is_enabled and not ep.is_unlimited
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
    + case when ep.is_enabled = true
             and ep.is_unlimited = false
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
  if coalesce(new.is_enabled, true)
     and ((v_event.status in ('Confirmed','confirmed') and v_event.end_date>=now()) or (v_event.status in ('Confirmed','confirmed','Ended','ended') and v_event.postorder_enabled and coalesce(v_event.sales_status_override,'auto')<>'closed' and (v_event.postorder_closes_at is null or v_event.postorder_closes_at>=now()))) then
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
    + case when ep.is_enabled = true
             and ep.is_unlimited = false
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

CREATE OR REPLACE FUNCTION public.create_preorder_with_stock(p_event_id uuid, p_items jsonb, p_customer_name text, p_customer_contact text DEFAULT ''::text, p_customer_note text DEFAULT ''::text, p_client_request_id uuid DEFAULT NULL::uuid, p_customer_phone text DEFAULT ''::text, p_customer_social text DEFAULT ''::text, p_customer_email text DEFAULT ''::text, p_shipping_address text DEFAULT ''::text, p_reward_choices jsonb DEFAULT '[]'::jsonb, p_promotion_choices jsonb DEFAULT '[]'::jsonb, p_expected_pricing_hash text DEFAULT NULL::text, p_accept_exhausted_rewards boolean DEFAULT false)
 RETURNS TABLE(order_id uuid, pickup_code text, total_price numeric, currency text, pickup_instructions text, payment_status text, payment_methods jsonb, payment_deadline_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result record;
  v_order_type text;
  v_event_phase text;
  v_artist_id uuid;
  v_payment_id uuid;
  v_payment_status text;
  v_hold_expires_at timestamptz;
  v_reserved integer := 0;
  v_quote jsonb;
  v_reward jsonb;
  v_product record;
begin
  select * into v_result
  from private.create_preorder_with_stock_base(
    p_event_id, p_items, p_customer_name, p_customer_contact,
    p_customer_note, p_client_request_id, p_customer_phone,
    p_customer_social, p_customer_email, p_shipping_address
  );

  select o.order_type, e.artist_id, op.id, op.payment_status, op.stock_hold_expires_at
  into v_order_type, v_artist_id, v_payment_id, v_payment_status, v_hold_expires_at
  from public.orders o
  join public.events e on e.id = o.event_id
  join public.order_payments op on op.order_id = o.id
  where o.id = v_result.order_id
  for update of op;

  if v_payment_status = 'awaiting_payment' and v_hold_expires_at is null then
    v_event_phase := case v_order_type
      when 'preorder' then 'preorder'
      when 'post_event' then 'postorder'
    end;

    if exists (
      select 1
      from public.promotion_assignments pa
      join public.artist_promotions ap on ap.id = pa.promotion_id
      where pa.event_id = p_event_id
        and pa.event_phase = v_event_phase
        and ap.lifecycle_status = 'ready'
        and not pa.is_paused
        and (pa.starts_at is null or pa.starts_at <= now())
        and (pa.ends_at is null or pa.ends_at > now())
    ) then
      perform set_config('nireq.production_quote_order',v_result.order_id::text,true);
      v_quote := public.calculate_sale_promotions(
        p_event_id, v_event_phase, null, p_items,
        coalesce(p_reward_choices, '[]'::jsonb),
        coalesce(p_promotion_choices, '[]'::jsonb)
      );
      perform set_config('nireq.production_quote_order','',true);

      if exists (
        select 1 from jsonb_array_elements(v_quote -> 'required_choices') choice(value)
        where not coalesce((choice.value ->> 'exhausted')::boolean, false)
      ) then
        raise exception 'promotion_choice_required';
      end if;

      if not p_accept_exhausted_rewards and exists (
        select 1 from jsonb_array_elements(v_quote -> 'required_choices') choice(value)
        where coalesce((choice.value ->> 'exhausted')::boolean, false)
      ) then
        raise exception 'promotion_rewards_exhausted';
      end if;

      if p_expected_pricing_hash is not null
         and p_expected_pricing_hash <> v_quote ->> 'pricing_hash' then
        raise exception 'promotion_changed';
      end if;

      for v_reward in
        select value from jsonb_array_elements(v_quote -> 'reward_lines') reward(value)
      loop
        select
          ep.id as event_product_id,
          p.id as product_id,
          p.name,
          p.sku
        into v_product
        from public.event_products ep
        join public.products p on p.id = ep.product_id
        where ep.event_id = p_event_id
          and ep.product_id = (v_reward ->> 'product_id')::uuid
          and ep.is_enabled
          and p.deleted_at is null
        for update of ep;

        if v_product.product_id is null then
          raise exception 'promotion_reward_unavailable';
        end if;

        insert into public.order_items (
          order_id, product_id, event_product_id, quantity, price_per_unit,
          notes, currency, product_name_snapshot, sku_snapshot,
          line_type, promotion_id, promotion_assignment_id, promotion_tier_id
        ) values (
          v_result.order_id, v_product.product_id, v_product.event_product_id,
          (v_reward ->> 'quantity')::integer, 0, '', v_result.currency,
          v_product.name, v_product.sku, 'promotion_reward',
          (v_reward ->> 'promotion_id')::uuid,
          coalesce(
            nullif(v_reward ->> 'assignment_id', '')::uuid,
            (
              select (applied.value ->> 'assignment_id')::uuid
              from jsonb_array_elements(v_quote -> 'applied_promotions') applied(value)
              where applied.value ->> 'id' = v_reward ->> 'promotion_id'
              limit 1
            )
          ),
          nullif(v_reward ->> 'tier_id', '')::uuid
        );
      end loop;

      update public.orders
      set subtotal_price = (v_quote ->> 'subtotal')::numeric,
          discount_total = (v_quote ->> 'discount_total')::numeric,
          total_price = (v_quote ->> 'merchandise_total')::numeric,
          pricing_breakdown = v_quote -> 'applied_promotions'
      where id = v_result.order_id;

      update public.order_payments
      set amount_expected = (v_quote ->> 'merchandise_total')::numeric,
          updated_at = now()
      where id = v_payment_id;

      v_result.total_price := (v_quote ->> 'merchandise_total')::numeric;
    end if;

    v_reserved := public.reserve_preorder_order_stock(v_result.order_id);
    v_hold_expires_at := now() + interval '15 minutes';

    update public.order_payments
    set stock_hold_expires_at = v_hold_expires_at,
        updated_at = now()
    where id = v_payment_id;

    perform public.append_payment_review_event(
      v_result.order_id, v_payment_id, p_event_id, v_artist_id,
      'stock_reserved', 'awaiting_payment', 'awaiting_payment', null, null,
      jsonb_build_object('quantity', v_reserved, 'expires_at', v_hold_expires_at)
    );
  end if;

  return query select
    v_result.order_id,
    v_result.pickup_code,
    v_result.total_price,
    v_result.currency,
    v_result.pickup_instructions,
    v_result.payment_status,
    v_result.payment_methods,
    least(v_result.payment_deadline_at, v_hold_expires_at);
end;
$function$
;

CREATE OR REPLACE FUNCTION private.promotion_reward_options(p_promotion_id uuid, p_tier_id uuid, p_event_id uuid, p_campaign_id uuid, p_needed integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
  select coalesce(jsonb_agg(option_row.value order by option_row.sort_order, option_row.name), '[]'::jsonb)
  from (
    select
      prp.sort_order,
      p.name,
      jsonb_build_object(
        'product_id', p.id,
        'name', p.name,
        'sku', p.sku,
        'is_unlimited', (private.event_supply_available(p_event_id,p.id,private.active_event_phase(p_event_id)) is null),
        'available', private.event_supply_available(p_event_id,p.id,private.active_event_phase(p_event_id)),
        'channel_product_id', ep.id
      ) as value
    from public.promotion_reward_products prp
    join public.products p on p.id = prp.product_id and p.deleted_at is null
    join public.event_products ep
      on p_event_id is not null
     and ep.event_id = p_event_id
     and ep.product_id = prp.product_id
     and ep.is_enabled
    where prp.promotion_id = p_promotion_id
      and prp.promotion_tier_id is not distinct from p_tier_id
      and (private.event_supply_available(p_event_id,p.id,private.active_event_phase(p_event_id)) is null or private.event_supply_available(p_event_id,p.id,private.active_event_phase(p_event_id)) >= 1)

    union all

    select
      prp.sort_order,
      p.name,
      jsonb_build_object(
        'product_id', p.id,
        'name', p.name,
        'sku', p.sku,
        'is_unlimited', (private.campaign_supply_available(p_campaign_id,p.id) is null),
        'available', private.campaign_supply_available(p_campaign_id,p.id),
        'channel_product_id', cp.id
      ) as value
    from public.promotion_reward_products prp
    join public.products p on p.id = prp.product_id and p.deleted_at is null
    join public.online_campaign_products cp
      on p_campaign_id is not null
     and cp.campaign_id = p_campaign_id
     and cp.product_id = prp.product_id
     and cp.is_enabled
    where prp.promotion_id = p_promotion_id
      and prp.promotion_tier_id is not distinct from p_tier_id
      and (private.campaign_supply_available(p_campaign_id,p.id) is null or private.campaign_supply_available(p_campaign_id,p.id) >= 1)
  ) option_row;
$function$
;

create function private.guard_production_item_delete() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.role(),'') in ('anon','authenticated') and exists(select 1 from private.production_stock where order_item_id=old.id)
 then raise exception 'production_order_use_cancellation'; end if;
 return old;
end $$;
create trigger guard_production_item_delete before delete on public.order_items for each row execute function private.guard_production_item_delete();
revoke all on function private.guard_production_item_delete() from public,anon,authenticated;

create function private.audit_production_earmark() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.allocated-old.consumed is distinct from new.allocated-new.consumed then
   insert into private.inventory_events(product_id,actor_id,kind,quantity_before,quantity_after,order_item_id)
   values(new.product_id,auth.uid(),'production_earmark',old.allocated-old.consumed,new.allocated-new.consumed,new.order_item_id);
 end if;
 if old.consumed is distinct from new.consumed then
   insert into private.inventory_events(product_id,actor_id,kind,quantity_before,quantity_after,order_item_id)
   values(new.product_id,auth.uid(),'production_fulfilled',old.consumed,new.consumed,new.order_item_id);
 end if;
 return new;
end $$;
create trigger audit_production_earmark after update on private.production_stock for each row execute function private.audit_production_earmark();
create function private.audit_channel_allocation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.stock_total is distinct from new.stock_total or old.is_unlimited is distinct from new.is_unlimited then
   insert into private.inventory_events(product_id,actor_id,kind,quantity_before,quantity_after,channel_id)
   values(new.product_id,auth.uid(),tg_table_name||'_allocation',coalesce(old.stock_total,0),coalesce(new.stock_total,0),new.id);
 end if;
 return new;
end $$;
create trigger audit_event_allocation after update on public.event_products for each row execute function private.audit_channel_allocation();
create trigger audit_campaign_allocation after update on public.online_campaign_products for each row execute function private.audit_channel_allocation();
revoke all on function private.audit_production_earmark(),private.audit_channel_allocation() from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_online_campaign_workspace(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.online_campaigns%rowtype;
  v_can_manage boolean;
begin
  select c.* into v_campaign
  from public.online_campaigns c
  where c.id = p_campaign_id;

  if v_campaign.id is null then raise exception 'campaign_not_found'; end if;
  if not public.has_artist_role(v_campaign.artist_id, array['owner', 'manager', 'seller']) then
    raise exception 'forbidden';
  end if;
  v_can_manage := public.has_artist_role(v_campaign.artist_id, array['owner', 'manager']);

  return jsonb_build_object(
    'can_manage_shipping', public.has_shipping_access(v_campaign.artist_id),
    'campaign', to_jsonb(v_campaign),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cp.id, 'product_id', p.id, 'name', p.name,
        'category', p.category, 'sku', p.sku,
        'price', p.price, 'price_override', cp.price_override,
        'stock_total', cp.stock_total, 'stock_reserved', cp.stock_reserved,
        'stock_sold', cp.stock_sold, 'is_unlimited', cp.is_unlimited,
        'supply_mode',cp.supply_mode,'production_limit',cp.production_limit,'available_quantity',private.campaign_supply_available(cp.campaign_id,cp.product_id),
        'max_quantity_per_order', cp.max_quantity_per_order,
        'is_enabled', cp.is_enabled
      ) order by p.name)
      from public.online_campaign_products cp
      join public.products p on p.id = cp.product_id
      where cp.campaign_id = v_campaign.id
    ), '[]'::jsonb),
    'catalog', case when v_can_manage then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'category', p.category,
        'sku', p.sku, 'price', p.price,
        'currency', p.currency, 'stock_total', p.stock_total,
        'stock_reserved', p.stock_reserved, 'stock_sold', p.stock_sold,
        'is_unlimited', p.is_unlimited, 'image_url', p.image_url
      ) order by p.name)
      from public.products p
      where p.artist_id = v_campaign.artist_id
        and p.deleted_at is null
        and p.status = 'enable'
    ), '[]'::jsonb) else '[]'::jsonb end,
    'pickup_points', coalesce((
      select jsonb_agg(to_jsonb(pp) order by pp.starts_at)
      from public.campaign_pickup_points pp
      where pp.campaign_id = v_campaign.id
    ), '[]'::jsonb),
    'payment_methods', case when v_can_manage then coalesce((
      select jsonb_agg(to_jsonb(pm) order by pm.created_at)
      from public.campaign_payment_methods pm
      where pm.campaign_id = v_campaign.id
    ), '[]'::jsonb) else '[]'::jsonb end,
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'order_code', o.pickup_code,
        'created_at', o.created_at,
        'status', o.status,
        'customer_name', o.customer_name,
        'customer_email', case when public.has_shipping_access(v_campaign.artist_id) then o.customer_email else null end,
        'customer_phone', case when public.has_shipping_access(v_campaign.artist_id) then o.customer_phone else null end,
        'shipping_address', case when public.has_shipping_access(v_campaign.artist_id) then o.shipping_address else null end,
        'fulfillment_method', o.fulfillment_method,
        'fulfillment_status', o.pickup_status,
        'pickup_point', o.pickup_point_snapshot,
        'subtotal_price', o.subtotal_price,
        'discount_total', o.discount_total,
        'shipping_fee', o.shipping_fee,
        'total_price', o.total_price,
        'currency', o.currency,
        'tracking_number', o.tracking_number,
        'shipping_carrier', o.shipping_carrier,
        'payment_status', op.payment_status,
        'slip_url', case when v_can_manage then op.slip_url else null end,
        'submitted_at', case when v_can_manage then op.submitted_at else null end,
        'review_note', case when v_can_manage then op.review_note else null end,
        'stock_hold_expires_at', case when v_can_manage then op.stock_hold_expires_at else null end,
        'late_payment_reported_at', case when v_can_manage then op.late_payment_reported_at else null end,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', coalesce(oi.product_name_snapshot, p.name),
            'sku', coalesce(oi.sku_snapshot, p.sku),
            'quantity', oi.quantity,
            'price_per_unit', oi.price_per_unit
          ) order by oi.id)
          from public.order_items oi
          join public.products p on p.id = oi.product_id
          where oi.order_id = o.id
        ), '[]'::jsonb)
      ) order by o.created_at desc)
      from public.orders o
      join public.order_payments op on op.order_id = o.id
      where o.campaign_id = v_campaign.id
    ), '[]'::jsonb)
  );
end;
$function$
;

create index if not exists order_items_inventory_product on public.order_items(product_id,order_id);

CREATE OR REPLACE FUNCTION private.production_reward_options(p_promotion_id uuid, p_tier_id uuid, p_event_id uuid, p_campaign_id uuid, p_needed integer, p_phase text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(option_row.value order by option_row.sort_order, option_row.name), '[]'::jsonb)
  from (
    select
      prp.sort_order,
      p.name,
      jsonb_build_object(
        'product_id', p.id,
        'name', p.name,
        'sku', p.sku,
        'is_unlimited', (private.event_supply_available(p_event_id,p.id,p_phase) is null),
        'available', private.event_supply_available(p_event_id,p.id,p_phase),
        'channel_product_id', ep.id
      ) as value
    from public.promotion_reward_products prp
    join public.products p on p.id = prp.product_id and p.deleted_at is null
    join public.event_products ep
      on p_event_id is not null
     and ep.event_id = p_event_id
     and ep.product_id = prp.product_id
     and ep.is_enabled
    where prp.promotion_id = p_promotion_id
      and prp.promotion_tier_id is not distinct from p_tier_id
      and (private.event_supply_available(p_event_id,p.id,p_phase) is null or private.event_supply_available(p_event_id,p.id,p_phase) >= 1)

    union all

    select
      prp.sort_order,
      p.name,
      jsonb_build_object(
        'product_id', p.id,
        'name', p.name,
        'sku', p.sku,
        'is_unlimited', (private.campaign_supply_available(p_campaign_id,p.id) is null),
        'available', private.campaign_supply_available(p_campaign_id,p.id),
        'channel_product_id', cp.id
      ) as value
    from public.promotion_reward_products prp
    join public.products p on p.id = prp.product_id and p.deleted_at is null
    join public.online_campaign_products cp
      on p_campaign_id is not null
     and cp.campaign_id = p_campaign_id
     and cp.product_id = prp.product_id
     and cp.is_enabled
    where prp.promotion_id = p_promotion_id
      and prp.promotion_tier_id is not distinct from p_tier_id
      and (private.campaign_supply_available(p_campaign_id,p.id) is null or private.campaign_supply_available(p_campaign_id,p.id) >= 1)
  ) option_row;
$function$
;
revoke all on function private.production_reward_options(uuid,uuid,uuid,uuid,integer,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.list_my_online_campaigns()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'artist_id', c.artist_id,
    'name', c.name,
    'slug', c.slug,
    'description', c.description,
    'opens_at', c.opens_at,
    'closes_at', c.closes_at,
    'campaign_timezone', c.campaign_timezone,
    'currency', c.currency,
    'shipping_enabled', c.shipping_enabled,
    'flat_shipping_fee', c.flat_shipping_fee,
    'pickup_enabled', c.pickup_enabled,
    'publication_status', c.publication_status,
    'state', case
      when c.publication_status = 'draft' then 'draft'
      when c.publication_status = 'cancelled' then 'cancelled'
      when c.publication_status = 'archived' then 'archived'
      when now() < c.opens_at then 'scheduled'
      when now() >= c.closes_at then 'closed'
      when not exists (
        select 1 from public.online_campaign_products cp
        where cp.campaign_id = c.id
          and cp.is_enabled = true
          and (private.campaign_supply_available(cp.campaign_id,cp.product_id) is null or private.campaign_supply_available(cp.campaign_id,cp.product_id)>0)
      ) then 'sold_out'
      else 'open'
    end,
    'action_count', (
      select count(*)
      from public.orders o
      join public.order_payments op on op.order_id = o.id
      where o.campaign_id = c.id
        and (
          o.pickup_status in ('awaiting_shipment', 'awaiting_pickup')
          or (
            public.has_artist_role(c.artist_id, array['owner', 'manager'])
            and op.payment_status in ('payment_submitted', 'payment_submitted_late', 'refund_pending')
          )
        )
    ),
    'confirmed_revenue', case
      when public.has_artist_role(c.artist_id, array['owner', 'manager']) then (
        select coalesce(sum(o.total_price), 0)
        from public.orders o
        join public.order_payments op on op.order_id = o.id
        where o.campaign_id = c.id
          and op.payment_status = 'payment_confirmed'
      )
      else 0
    end
  ) order by c.opens_at desc), '[]'::jsonb)
  from public.online_campaigns c
  where public.has_artist_role(c.artist_id, array['owner', 'manager', 'seller']);
$function$
;

create function private.touch_production_channels(p_product_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.event_products ep set updated_at=clock_timestamp() where ep.product_id=p_product_id and exists(
   select 1 from private.production_stock ps join public.order_items oi on oi.id=ps.order_item_id join public.orders o on o.id=oi.order_id
   where ps.product_id=p_product_id and o.event_id=ep.event_id);
 update public.online_campaign_products cp set updated_at=clock_timestamp() where cp.product_id=p_product_id and exists(
   select 1 from private.production_stock ps join public.order_items oi on oi.id=ps.order_item_id join public.orders o on o.id=oi.order_id
   where ps.product_id=p_product_id and o.campaign_id=cp.campaign_id);
end $$;
revoke all on function private.touch_production_channels(uuid) from public,anon,authenticated;

-- Staff POS always sees physical allocation, even when the public menu is currently taking production preorders.
create function private.list_event_products_for_phase(p_event_id uuid,p_phase text) returns setof jsonb
language plpgsql security definer set search_path='' as $$
declare phase text:=p_phase; e public.events;
begin
 select * into e from public.events where id=p_event_id;
 if auth.uid() is null or not public.has_artist_role(e.artist_id,array['owner','manager','queue_pos','queue_only']) then raise exception 'forbidden'; end if;
 if phase='setup' then
   phase:=private.active_event_phase(p_event_id);
   if phase='closed' then phase:=case when e.preorder_enabled then 'preorder' when e.postorder_enabled then 'postorder' else 'live' end; end if;
 end if;
 if phase not in ('live','preorder','postorder','post_event') or phase is null then raise exception 'invalid_supply_phase'; end if;
 return query select to_jsonb(listed)||jsonb_build_object(
   'supply_mode',case when private.event_production(p_event_id,p.id,phase) then 'production' else 'stock' end,
   'is_unlimited',case when private.event_production(p_event_id,p.id,phase) then private.event_supply_available(p_event_id,p.id,phase) is null else coalesce(ep.is_unlimited,p.is_unlimited) end,
   'stock_total',case when private.event_production(p_event_id,p.id,phase) then private.event_supply_available(p_event_id,p.id,phase) when ep.id is not null then ep.stock_total else p.stock_total end,
   'stock_reserved',case when private.event_production(p_event_id,p.id,phase) then 0 else coalesce(ep.stock_reserved,p.stock_reserved,0) end,
   'stock_sold',case when private.event_production(p_event_id,p.id,phase) then 0 else coalesce(ep.stock_sold,p.stock_sold,0) end)
 from public.list_event_products(p_event_id) listed join public.products p on p.id=listed.id
 left join public.event_products ep on ep.id=listed.event_product_id;
end $$;
create function public.list_event_products_for_phase(p_event_id uuid,p_phase text) returns setof jsonb
language sql security invoker set search_path='' as $$ select * from private.list_event_products_for_phase(p_event_id,p_phase) $$;
revoke all on function private.list_event_products_for_phase(uuid,text),public.list_event_products_for_phase(uuid,text) from public,anon;
grant execute on function private.list_event_products_for_phase(uuid,text),public.list_event_products_for_phase(uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION public.create_customer_order_with_stock(p_queue_id uuid, p_items jsonb, p_payment_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_queue record;
  v_event record;
  v_existing_order record;
  v_item jsonb;
  v_order_id uuid;
  v_product record;
  v_qty integer;
  v_total numeric := 0;
  v_currency text;
  v_effective_currency text;
  v_available integer;
  v_service_date date;
  v_has_catalog boolean := false;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_items';
  end if;

  select q.* into v_queue
  from public.queues q
  where q.id = p_queue_id
  for update;

  if v_queue.id is null then
    raise exception 'queue_not_found';
  end if;

  if p_payment_idempotency_key is not null then
    select o.id, o.event_id, o.queue_id
    into v_existing_order
    from public.orders o
    where o.payment_idempotency_key = p_payment_idempotency_key
    for update;

    if v_existing_order.id is not null then
      if v_existing_order.event_id = v_queue.event_id
         and v_existing_order.queue_id = v_queue.id then
        return v_existing_order.id;
      end if;
      raise exception 'payment_idempotency_key_conflict';
    end if;
  end if;

  if v_queue.status not in ('waiting', 'calling', 'serving') then
    raise exception 'queue_not_active';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = v_queue.event_id
    and e.artist_id = v_queue.artist_id
    and e.status = 'Confirmed'
    and e.start_date <= now()
    and e.end_date >= now();

  if v_event.id is null then
    raise exception 'event_not_active';
  end if;

  v_service_date := (
    now() at time zone coalesce(nullif(v_event.event_timezone, ''), 'Asia/Bangkok')
  )::date;

  if v_queue.queue_service_date is distinct from v_service_date then
    raise exception 'queue_not_active_today';
  end if;

  select exists (select 1 from public.event_products ep where ep.event_id = v_event.id)
  into v_has_catalog;

  insert into public.orders (event_id, queue_id, status, total_price, currency, payment_method, payment_idempotency_key)
  values (v_event.id, v_queue.id, 'confirmed', 0, coalesce(v_event.currency_override, 'THB'), null, p_payment_idempotency_key)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::integer, 1));

    select
      p.*,
      ep.id as event_product_id,
      coalesce(ep.price_override, p.price) as effective_price,
      case when ep.id is not null then ep.is_unlimited else p.is_unlimited end as effective_is_unlimited,
      case when ep.id is not null then ep.stock_total else p.stock_sold+p.stock_reserved+private.catalog_free_stock(p.id) end as effective_stock_total,
      case when ep.id is not null then ep.stock_reserved else p.stock_reserved end as effective_stock_reserved,
      case when ep.id is not null then ep.stock_sold else p.stock_sold end as effective_stock_sold
    into v_product
    from public.products p
    left join public.event_products ep
      on ep.product_id = p.id
     and ep.event_id = v_event.id
    where p.id = (v_item ->> 'product_id')::uuid
      and p.artist_id = v_queue.artist_id
      and p.deleted_at is null
      and p.status = 'enable'
      and (not v_has_catalog or (ep.id is not null and ep.is_enabled = true))
    for update of p;

    if v_product.id is null then
      raise exception 'invalid_product';
    end if;

    v_effective_currency := coalesce(v_event.currency_override, v_product.currency, 'THB');

    if v_currency is null then
      v_currency := v_effective_currency;
    elsif v_currency <> v_effective_currency then
      raise exception 'mixed_currency_not_allowed';
    end if;

    if not coalesce(v_product.effective_is_unlimited, true) then
      v_available := coalesce(v_product.effective_stock_total, 0) - coalesce(v_product.effective_stock_reserved, 0) - coalesce(v_product.effective_stock_sold, 0);
      if v_available < v_qty then
        raise exception 'insufficient_stock';
      end if;

      if v_product.event_product_id is not null then
        update public.event_products
        set stock_reserved = stock_reserved + v_qty
        where id = v_product.event_product_id;
      else
        update public.products
        set stock_reserved = stock_reserved + v_qty,
            updated_at = now()
        where id = v_product.id;
      end if;
    end if;

    insert into public.order_items (order_id, product_id, event_product_id, quantity, price_per_unit, notes, currency)
    values (
      v_order_id,
      v_product.id,
      v_product.event_product_id,
      v_qty,
      v_product.effective_price,
      coalesce(v_item ->> 'notes', ''),
      v_effective_currency
    );

    v_total := v_total + (v_product.effective_price * v_qty);
  end loop;

  update public.orders
  set total_price = v_total,
      subtotal_price = v_total,
      currency = coalesce(v_currency, 'THB')
  where id = v_order_id;

  return v_order_id;
exception
  when unique_violation then
    if p_payment_idempotency_key is not null then
      select o.id, o.event_id, o.queue_id
      into v_existing_order
      from public.orders o
      where o.payment_idempotency_key = p_payment_idempotency_key;

      if v_existing_order.id is not null
         and v_existing_order.event_id = v_queue.event_id
         and v_existing_order.queue_id = v_queue.id then
        return v_existing_order.id;
      end if;
    end if;
    raise;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.create_walkin_order_with_stock_base(p_event_id uuid, p_items jsonb, p_payment_method text, p_payment_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_event record;
  v_existing_order record;
  v_item jsonb;
  v_order_id uuid;
  v_product record;
  v_qty integer;
  v_total numeric := 0;
  v_currency text;
  v_effective_currency text;
  v_available integer;
  v_has_catalog boolean := false;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_items';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null then
    raise exception 'event_not_active';
  end if;

  if not public.has_artist_role(v_event.artist_id, array['owner', 'queue_pos']) then
    raise exception 'forbidden';
  end if;

  if p_payment_idempotency_key is not null then
    select o.id, o.event_id, o.queue_id, o.order_type
    into v_existing_order
    from public.orders o
    where o.payment_idempotency_key = p_payment_idempotency_key
    for update;

    if v_existing_order.id is not null then
      if v_existing_order.event_id = p_event_id
         and v_existing_order.queue_id is null
         and v_existing_order.order_type = 'pos_walkin' then
        return v_existing_order.id;
      end if;
      raise exception 'payment_idempotency_key_conflict';
    end if;
  end if;

  if v_event.status <> 'Confirmed'
     or v_event.start_date > now()
     or v_event.end_date < now() then
    raise exception 'event_not_active';
  end if;

  select exists (select 1 from public.event_products ep where ep.event_id = v_event.id)
  into v_has_catalog;

  insert into public.orders (
    event_id,
    queue_id,
    status,
    total_price,
    subtotal_price,
    currency,
    payment_method,
    payment_idempotency_key,
    order_type,
    pickup_status
  )
  values (
    p_event_id,
    null,
    'completed',
    0,
    0,
    coalesce(v_event.currency_override, 'THB'),
    p_payment_method,
    p_payment_idempotency_key,
    'pos_walkin',
    'not_required'
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::integer, 1));

    select
      p.*,
      ep.id as event_product_id,
      coalesce(ep.price_override, p.price) as effective_price,
      case when ep.id is not null then ep.is_unlimited else p.is_unlimited end as effective_is_unlimited,
      case when ep.id is not null then ep.stock_total else p.stock_sold+p.stock_reserved+private.catalog_free_stock(p.id) end as effective_stock_total,
      case when ep.id is not null then ep.stock_reserved else p.stock_reserved end as effective_stock_reserved,
      case when ep.id is not null then ep.stock_sold else p.stock_sold end as effective_stock_sold
    into v_product
    from public.products p
    left join public.event_products ep
      on ep.product_id = p.id
     and ep.event_id = v_event.id
    where p.id = (v_item ->> 'product_id')::uuid
      and p.artist_id = v_event.artist_id
      and p.deleted_at is null
      and p.status = 'enable'
      and (not v_has_catalog or (ep.id is not null and ep.is_enabled = true))
    for update of p;

    if v_product.id is null then
      raise exception 'invalid_product';
    end if;

    v_effective_currency := coalesce(v_event.currency_override, v_product.currency, 'THB');

    if v_currency is null then
      v_currency := v_effective_currency;
    elsif v_currency <> v_effective_currency then
      raise exception 'mixed_currency_not_allowed';
    end if;

    if not coalesce(v_product.effective_is_unlimited, true) then
      v_available := coalesce(v_product.effective_stock_total, 0) - coalesce(v_product.effective_stock_reserved, 0) - coalesce(v_product.effective_stock_sold, 0);
      if v_available < v_qty then
        raise exception 'insufficient_stock';
      end if;

      if v_product.event_product_id is not null then
        update public.event_products
        set stock_sold = stock_sold + v_qty
        where id = v_product.event_product_id;
      else
        update public.products
        set stock_sold = stock_sold + v_qty,
            updated_at = now()
        where id = v_product.id;
      end if;
    end if;

    insert into public.order_items (order_id, product_id, event_product_id, quantity, price_per_unit, notes, currency)
    values (
      v_order_id,
      v_product.id,
      v_product.event_product_id,
      v_qty,
      v_product.effective_price,
      coalesce(v_item ->> 'notes', ''),
      v_effective_currency
    );

    v_total := v_total + (v_product.effective_price * v_qty);
  end loop;

  update public.orders
  set total_price = v_total,
      subtotal_price = v_total,
      currency = coalesce(v_currency, 'THB')
  where id = v_order_id;

  return v_order_id;
exception
  when unique_violation then
    if p_payment_idempotency_key is not null then
      select o.id, o.event_id, o.queue_id, o.order_type
      into v_existing_order
      from public.orders o
      where o.payment_idempotency_key = p_payment_idempotency_key;

      if v_existing_order.id is not null
         and v_existing_order.event_id = p_event_id
         and v_existing_order.queue_id is null
         and v_existing_order.order_type = 'pos_walkin' then
        return v_existing_order.id;
      end if;
    end if;
    raise;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.complete_order_with_stock(p_order_id uuid, p_payment_method text, p_payment_idempotency_key uuid DEFAULT NULL::uuid, p_reward_choices jsonb DEFAULT '[]'::jsonb, p_promotion_choices jsonb DEFAULT '[]'::jsonb, p_expected_pricing_hash text DEFAULT NULL::text, p_accept_exhausted_rewards boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order record;
  v_items jsonb;
  v_quote jsonb;
  v_reward jsonb;
  v_reward_product record;
  v_stock record;
  v_quantity integer;
  v_available integer;
begin
  select o.*, e.artist_id
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
  for update of o;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  if not public.has_artist_role(v_order.artist_id, array['owner', 'queue_pos']) then
    raise exception 'forbidden';
  end if;

  if v_order.status = 'completed' then
    return private.complete_order_with_stock_base(
      p_order_id, p_payment_method, p_payment_idempotency_key
    );
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'order_cancelled';
  end if;

  if p_payment_idempotency_key is not null
     and v_order.payment_idempotency_key is not null
     and v_order.payment_idempotency_key <> p_payment_idempotency_key then
    raise exception 'payment_idempotency_key_conflict';
  end if;

  if not exists (
    select 1
    from public.promotion_assignments pa
    join public.artist_promotions ap on ap.id = pa.promotion_id
    where pa.event_id = v_order.event_id
      and pa.event_phase = 'live'
      and ap.lifecycle_status = 'ready'
      and not pa.is_paused
      and (pa.starts_at is null or pa.starts_at <= now())
      and (pa.ends_at is null or pa.ends_at > now())
  ) then
    return private.complete_order_with_stock_base(
      p_order_id, p_payment_method, p_payment_idempotency_key
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', purchase.product_id,
    'quantity', purchase.quantity
  )), '[]'::jsonb)
  into v_items
  from (
    select oi.product_id, sum(oi.quantity)::integer as quantity
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.line_type = 'purchase'
    group by oi.product_id
  ) purchase;

  if jsonb_array_length(v_items) = 0 then
    raise exception 'empty_items';
  end if;

  -- Queue orders already reserve their purchased stock. Release only this
  -- order's reservation while holding the rows, then validate and sell once.
  for v_stock in
    select distinct oi.event_product_id, oi.product_id
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.line_type = 'purchase'
  loop
    select sum(oi.quantity)::integer into v_quantity
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.line_type = 'purchase'
      and oi.product_id = v_stock.product_id
      and oi.event_product_id is not distinct from v_stock.event_product_id;

    if v_stock.event_product_id is not null then
      perform 1 from public.event_products
      where id = v_stock.event_product_id
      for update;

      update public.event_products
      set stock_reserved = greatest(stock_reserved - v_quantity, 0)
      where id = v_stock.event_product_id
        and not is_unlimited;
    else
      perform 1 from public.products
      where id = v_stock.product_id
      for update;

      update public.products
      set stock_reserved = greatest(stock_reserved - v_quantity, 0),
          updated_at = now()
      where id = v_stock.product_id
        and not is_unlimited;
    end if;
  end loop;

  v_quote := public.calculate_sale_promotions(
    v_order.event_id, 'live', null, v_items,
    coalesce(p_reward_choices, '[]'::jsonb),
    coalesce(p_promotion_choices, '[]'::jsonb)
  );

  if exists (
    select 1 from jsonb_array_elements(v_quote -> 'required_choices') choice(value)
    where not coalesce((choice.value ->> 'exhausted')::boolean, false)
  ) then
    raise exception 'promotion_choice_required';
  end if;

  if not p_accept_exhausted_rewards and exists (
    select 1 from jsonb_array_elements(v_quote -> 'required_choices') choice(value)
    where coalesce((choice.value ->> 'exhausted')::boolean, false)
  ) then
    raise exception 'promotion_rewards_exhausted';
  end if;

  if p_expected_pricing_hash is not null
     and p_expected_pricing_hash <> v_quote ->> 'pricing_hash' then
    raise exception 'promotion_changed';
  end if;

  delete from public.order_items
  where order_items.order_id = p_order_id
    and line_type = 'promotion_reward';

  for v_reward in
    select value from jsonb_array_elements(v_quote -> 'reward_lines') reward(value)
  loop
    select ep.id as event_product_id, p.id as product_id, p.name, p.sku
    into v_reward_product
    from public.event_products ep
    join public.products p on p.id = ep.product_id
    where ep.event_id = v_order.event_id
      and ep.product_id = (v_reward ->> 'product_id')::uuid
      and ep.is_enabled
      and p.deleted_at is null
    for update of ep;

    if v_reward_product.product_id is null then
      raise exception 'promotion_reward_unavailable';
    end if;

    insert into public.order_items (
      order_id, product_id, event_product_id, quantity, price_per_unit,
      notes, currency, product_name_snapshot, sku_snapshot,
      line_type, promotion_id, promotion_assignment_id, promotion_tier_id
    ) values (
      p_order_id, v_reward_product.product_id, v_reward_product.event_product_id,
      (v_reward ->> 'quantity')::integer, 0, '', v_order.currency,
      v_reward_product.name, v_reward_product.sku, 'promotion_reward',
      (v_reward ->> 'promotion_id')::uuid,
      coalesce(
        nullif(v_reward ->> 'assignment_id', '')::uuid,
        (
          select (applied.value ->> 'assignment_id')::uuid
          from jsonb_array_elements(v_quote -> 'applied_promotions') applied(value)
          where applied.value ->> 'id' = v_reward ->> 'promotion_id'
          limit 1
        )
      ),
      nullif(v_reward ->> 'tier_id', '')::uuid
    );
  end loop;

  for v_stock in
    select distinct oi.event_product_id, oi.product_id
    from public.order_items oi
    where oi.order_id = p_order_id
  loop
    select sum(oi.quantity)::integer into v_quantity
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.product_id = v_stock.product_id
      and oi.event_product_id is not distinct from v_stock.event_product_id;

    if v_stock.event_product_id is not null then
      select ep.is_unlimited,
             coalesce(ep.stock_total, 0) - ep.stock_reserved - ep.stock_sold as available
      into v_reward_product
      from public.event_products ep
      where ep.id = v_stock.event_product_id
      for update;

      if not v_reward_product.is_unlimited then
        v_available := v_reward_product.available;
        if v_available < v_quantity then
          raise exception 'insufficient_stock_on_complete';
        end if;
        update public.event_products
        set stock_sold = stock_sold + v_quantity
        where id = v_stock.event_product_id;
      end if;
    else
      select p.is_unlimited,
             private.catalog_free_stock(p.id) as available
      into v_reward_product
      from public.products p
      where p.id = v_stock.product_id
      for update;

      if not v_reward_product.is_unlimited then
        v_available := v_reward_product.available;
        if v_available < v_quantity then
          raise exception 'insufficient_stock_on_complete';
        end if;
        update public.products
        set stock_sold = stock_sold + v_quantity,
            updated_at = now()
        where id = v_stock.product_id;
      end if;
    end if;
  end loop;

  update public.orders
  set status = 'completed',
      payment_method = p_payment_method,
      payment_idempotency_key = coalesce(payment_idempotency_key, p_payment_idempotency_key),
      subtotal_price = (v_quote ->> 'subtotal')::numeric,
      discount_total = (v_quote ->> 'discount_total')::numeric,
      total_price = (v_quote ->> 'merchandise_total')::numeric,
      pricing_breakdown = v_quote -> 'applied_promotions'
  where id = p_order_id;

  if v_order.queue_id is not null then
    update public.queues
    set status = 'complete', completed_at = now(), last_updated_at = now()
    where id = v_order.queue_id;
  end if;

  return true;
end;
$function$
;


-- Stock overview and earmarking query channel commitments by SKU across Events/Campaigns.
create index if not exists event_products_inventory_product on public.event_products(product_id,event_id);
create index if not exists campaign_products_inventory_product on public.online_campaign_products(product_id,campaign_id);
alter table private.production_stock enable row level security;
alter table private.inventory_events enable row level security;

CREATE OR REPLACE FUNCTION private.create_preorder_with_stock_base(p_event_id uuid, p_items jsonb, p_customer_name text, p_customer_contact text DEFAULT ''::text, p_customer_note text DEFAULT ''::text, p_client_request_id uuid DEFAULT NULL::uuid, p_customer_phone text DEFAULT ''::text, p_customer_social text DEFAULT ''::text, p_customer_email text DEFAULT ''::text, p_shipping_address text DEFAULT ''::text)
 RETURNS TABLE(order_id uuid, pickup_code text, total_price numeric, currency text, pickup_instructions text, payment_status text, payment_methods jsonb, payment_deadline_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_event record;
  v_existing_order record;
  v_existing_payment record;
  v_item jsonb;
  v_order_id uuid;
  v_payment_id uuid;
  v_pickup_code text;
  v_product record;
  v_qty integer;
  v_total numeric := 0;
  v_currency text;
  v_effective_currency text;
  v_has_catalog boolean := false;
  v_payment_methods jsonb;
  v_payment_deadline timestamptz;
  v_contact_display text;
  v_sales_phase text;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_items';
  end if;

  if length(trim(coalesce(p_customer_name, ''))) = 0 then
    raise exception 'customer_name_required';
  end if;

  if length(trim(coalesce(p_customer_email, ''))) = 0 then
    raise exception 'customer_email_required';
  end if;

  if lower(trim(coalesce(p_customer_email, ''))) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'customer_email_invalid';
  end if;

  if length(trim(coalesce(p_customer_phone, ''))) = 0
     and length(trim(coalesce(p_customer_social, ''))) = 0
     and length(trim(coalesce(p_customer_email, ''))) = 0
     and length(trim(coalesce(p_customer_contact, ''))) = 0 then
    raise exception 'customer_contact_required';
  end if;

  select e.*, a.is_public, a.is_verified
  into v_event
  from public.events e
  join public.artists a on a.id = e.artist_id
  where e.id = p_event_id
  for update;

  if v_event.id is null then
    raise exception 'event_not_found';
  end if;

  v_sales_phase := public.get_event_sales_phase(
    v_event.status,
    v_event.start_date,
    v_event.end_date,
    coalesce(v_event.preorder_enabled, false) or coalesce(v_event.selling_mode, 'live') = 'preorder',
    v_event.preorder_opens_at,
    v_event.preorder_closes_at,
    coalesce(v_event.postorder_enabled, false) or coalesce(v_event.selling_mode, 'live') = 'post_event',
    coalesce(v_event.postorder_opens_at, case when coalesce(v_event.selling_mode, 'live') = 'post_event' then v_event.preorder_opens_at end),
    coalesce(v_event.postorder_closes_at, case when coalesce(v_event.selling_mode, 'live') = 'post_event' then v_event.preorder_closes_at end),
    coalesce(v_event.sales_status_override, 'auto')
  );

  if coalesce(v_event.is_public, false) is not true or coalesce(v_event.is_verified, false) is not true then
    raise exception 'artist_not_public';
  end if;

  if v_sales_phase not in ('preorder', 'post_event') then
    if coalesce(v_event.sales_status_override, 'auto') = 'closed' then
      raise exception 'preorder_not_open';
    end if;
    if (coalesce(v_event.preorder_enabled, false) or coalesce(v_event.selling_mode, 'live') = 'preorder')
       and v_event.preorder_opens_at is not null
       and now() < v_event.preorder_opens_at then
      raise exception 'preorder_not_open_yet';
    end if;
    if (coalesce(v_event.preorder_enabled, false) or coalesce(v_event.selling_mode, 'live') = 'preorder')
       and v_event.preorder_closes_at is not null
       and now() >= v_event.preorder_closes_at then
      raise exception 'preorder_closed';
    end if;
    if (coalesce(v_event.postorder_enabled, false) or coalesce(v_event.selling_mode, 'live') = 'post_event')
       and coalesce(v_event.postorder_opens_at, case when coalesce(v_event.selling_mode, 'live') = 'post_event' then v_event.preorder_opens_at end) is not null
       and now() < coalesce(v_event.postorder_opens_at, case when coalesce(v_event.selling_mode, 'live') = 'post_event' then v_event.preorder_opens_at end) then
      raise exception 'preorder_not_open_yet';
    end if;
    if (coalesce(v_event.postorder_enabled, false) or coalesce(v_event.selling_mode, 'live') = 'post_event')
       and coalesce(v_event.postorder_closes_at, case when coalesce(v_event.selling_mode, 'live') = 'post_event' then v_event.preorder_closes_at end) is not null
       and now() >= coalesce(v_event.postorder_closes_at, case when coalesce(v_event.selling_mode, 'live') = 'post_event' then v_event.preorder_closes_at end) then
      raise exception 'preorder_closed';
    end if;
    if v_event.end_date < now() then
      raise exception 'event_ended';
    end if;
    raise exception 'preorder_not_open';
  end if;

  if v_sales_phase = 'post_event' then
    if length(trim(coalesce(p_customer_phone, ''))) = 0 then
      raise exception 'customer_phone_required';
    end if;

    if length(trim(coalesce(p_shipping_address, ''))) = 0 then
      raise exception 'shipping_address_required';
    end if;
  end if;

  if p_client_request_id is not null then
    select o.*
    into v_existing_order
    from public.orders o
    where o.payment_idempotency_key = p_client_request_id
    for update;

    if v_existing_order.id is not null then
      if v_existing_order.event_id = p_event_id and v_existing_order.order_type in ('preorder', 'post_event') then
        select op.* into v_existing_payment from public.order_payments op where op.order_id = v_existing_order.id;
        select coalesce(jsonb_agg(to_jsonb(epm) - 'artist_id' - 'created_at' - 'updated_at'), '[]'::jsonb),
               min(epm.payment_deadline_at)
        into v_payment_methods, v_payment_deadline
        from public.event_payment_methods epm
        where epm.event_id = p_event_id
          and epm.is_enabled = true;

        return query
        select
          v_existing_order.id,
          v_existing_order.pickup_code,
          v_existing_order.total_price,
          v_existing_order.currency,
          coalesce(v_event.preorder_pickup_instructions, ''),
          coalesce(v_existing_payment.payment_status, 'awaiting_payment'),
          coalesce(v_payment_methods, '[]'::jsonb),
          v_payment_deadline;
        return;
      end if;
      raise exception 'client_request_id_conflict';
    end if;
  end if;

  select exists (select 1 from public.event_products ep where ep.event_id = p_event_id)
  into v_has_catalog;

  v_pickup_code := public.generate_pickup_code(p_event_id);
  v_contact_display := nullif(trim(coalesce(p_customer_contact, '')), '');
  if v_contact_display is null then
    v_contact_display := concat_ws(' · ',
      nullif(trim(coalesce(p_customer_phone, '')), ''),
      nullif(trim(coalesce(p_customer_social, '')), ''),
      nullif(trim(coalesce(p_customer_email, '')), '')
    );
  end if;

  insert into public.orders (
    event_id,
    queue_id,
    status,
    total_price,
    subtotal_price,
    currency,
    payment_method,
    payment_idempotency_key,
    order_type,
    pickup_code,
    customer_name,
    customer_contact,
    customer_phone,
    customer_social,
    customer_email,
    customer_note,
    shipping_address,
    pickup_status
  )
  values (
    p_event_id,
    null,
    'draft',
    0,
    0,
    coalesce(v_event.currency_override, 'THB'),
    null,
    p_client_request_id,
    v_sales_phase,
    v_pickup_code,
    trim(p_customer_name),
    v_contact_display,
    nullif(trim(coalesce(p_customer_phone, '')), ''),
    nullif(trim(coalesce(p_customer_social, '')), ''),
    lower(trim(p_customer_email)),
    nullif(trim(coalesce(p_customer_note, '')), ''),
    nullif(trim(coalesce(p_shipping_address, '')), ''),
    'not_required'
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::integer, 1));

    select
      p.*,
      ep.id as event_product_id,
      coalesce(ep.price_override, p.price) as effective_price,
      case when ep.id is not null then ep.is_unlimited else p.is_unlimited end as effective_is_unlimited,
      case when ep.id is not null then ep.stock_total else p.stock_total end as effective_stock_total,
      case when ep.id is not null then ep.stock_reserved else p.stock_reserved end as effective_stock_reserved,
      case when ep.id is not null then ep.stock_sold else p.stock_sold end as effective_stock_sold
    into v_product
    from public.products p
    left join public.event_products ep
      on ep.product_id = p.id
     and ep.event_id = p_event_id
    where p.id = (v_item ->> 'product_id')::uuid
      and p.artist_id = v_event.artist_id
      and p.deleted_at is null
      and p.status = 'enable'
      and (not v_has_catalog or (ep.id is not null and ep.is_enabled = true))
    for update of p;

    if v_product.id is null then
      raise exception 'invalid_product';
    end if;
    if v_item->>'expected_supply_mode' is not null and v_item->>'expected_supply_mode' is distinct from
      (case when private.event_production(p_event_id,v_product.id,private.active_event_phase(p_event_id)) then 'production' else 'stock' end)
    then raise exception 'supply_policy_changed_reload'; end if;


    v_effective_currency := coalesce(v_event.currency_override, v_product.currency, 'THB');

    if v_currency is null then
      v_currency := v_effective_currency;
    elsif v_currency <> v_effective_currency then
      raise exception 'mixed_currency_not_allowed';
    end if;

    insert into public.order_items (order_id, product_id, event_product_id, quantity, price_per_unit, notes, currency)
    values (
      v_order_id,
      v_product.id,
      v_product.event_product_id,
      v_qty,
      v_product.effective_price,
      coalesce(v_item ->> 'notes', ''),
      v_effective_currency
    );

    v_total := v_total + (v_product.effective_price * v_qty);
  end loop;

  update public.orders
  set total_price = v_total,
      subtotal_price = v_total,
      currency = coalesce(v_currency, 'THB')
  where id = v_order_id;

  insert into public.order_payments (
    order_id,
    event_id,
    artist_id,
    payment_status,
    amount_expected,
    currency
  )
  values (
    v_order_id,
    p_event_id,
    v_event.artist_id,
    'awaiting_payment',
    v_total,
    coalesce(v_currency, 'THB')
  )
  returning id into v_payment_id;

  perform public.append_payment_review_event(
    v_order_id,
    v_payment_id,
    p_event_id,
    v_event.artist_id,
    'created',
    null,
    'awaiting_payment'
  );

  select coalesce(jsonb_agg(to_jsonb(epm) - 'artist_id' - 'created_at' - 'updated_at'), '[]'::jsonb),
         min(epm.payment_deadline_at)
  into v_payment_methods, v_payment_deadline
  from public.event_payment_methods epm
  where epm.event_id = p_event_id
    and epm.is_enabled = true;

  return query
  select
    v_order_id,
    v_pickup_code,
    v_total,
    coalesce(v_currency, 'THB'),
    coalesce(v_event.preorder_pickup_instructions, ''),
    'awaiting_payment'::text,
    coalesce(v_payment_methods, '[]'::jsonb),
    v_payment_deadline;
exception
  when unique_violation then
    raise exception 'preorder_unique_conflict';
end;
$function$
;

create table private.production_stock_requests (
 product_id uuid not null references public.products(id) on delete cascade, request_id uuid not null,
 actor_id uuid not null, quantity integer not null check(quantity>0), result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(product_id,request_id)
);
alter table private.production_stock_requests enable row level security;
revoke all on private.production_stock_requests from public,anon,authenticated;
create function private.assign_production_stock(p_product_id uuid,p_quantity integer,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.products; prior private.production_stock_requests; before_qty integer; after_qty integer; result jsonb;
begin
 select * into p from public.products where id=p_product_id and deleted_at is null for update;
 if auth.uid() is null or not public.has_artist_role(p.artist_id,array['owner','manager']) then raise exception 'forbidden'; end if;
 if p_quantity is null or p_quantity<=0 or p_request_id is null then raise exception 'invalid_stock_quantity'; end if;
 select * into prior from private.production_stock_requests where product_id=p_product_id and request_id=p_request_id;
 if found then
   if prior.actor_id<>auth.uid() or prior.quantity<>p_quantity then raise exception 'stock_request_conflict'; end if;
   return prior.result;
 end if;
 if p.is_unlimited then raise exception 'stock_tracking_required'; end if;
 if private.catalog_free_stock(p_product_id)<p_quantity then raise exception 'insufficient_catalog_available_stock'; end if;
 select coalesce(sum(allocated-consumed),0)::integer into before_qty from private.production_stock where product_id=p_product_id;
 perform private.refresh_production_stock(p_product_id,p_quantity);
 select coalesce(sum(allocated-consumed),0)::integer into after_qty from private.production_stock where product_id=p_product_id;
 result:=jsonb_build_object('allocated',after_qty-before_qty,'available',private.catalog_free_stock(p_product_id));
 insert into private.production_stock_requests(product_id,request_id,actor_id,quantity,result) values(p_product_id,p_request_id,auth.uid(),p_quantity,result);
 return result;
end $$;
create function public.assign_production_stock(p_product_id uuid,p_quantity integer,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.assign_production_stock(p_product_id,p_quantity,p_request_id) $$;
revoke all on function private.assign_production_stock(uuid,integer,uuid),public.assign_production_stock(uuid,integer,uuid) from public,anon;
grant execute on function private.assign_production_stock(uuid,integer,uuid),public.assign_production_stock(uuid,integer,uuid) to authenticated;
