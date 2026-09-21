create table public.offline_devices (
  event_id uuid primary key references public.events(id),
  artist_id uuid not null references public.artists(id),
  device_id uuid not null, actor_id uuid not null,
  prepared_at timestamptz not null default now(), heartbeat_at timestamptz not null default now(),
  released boolean not null default false,
  recovering boolean not null default false, resume_after timestamptz not null default now()
);
alter table public.offline_devices enable row level security;
revoke all on public.offline_devices from anon,authenticated;
grant select on public.offline_devices to authenticated;
create policy offline_device_staff_read on public.offline_devices for select to authenticated
 using(public.has_event_role(event_id,array['owner','manager','seller','queue_staff']));
create table public.offline_operations (
  id uuid primary key, event_id uuid not null references public.events(id),
  artist_id uuid not null references public.artists(id), device_id uuid not null,
  actor_id uuid not null, payload jsonb not null,
  status text not null check(status in ('applied','conflict')),
  reason text, order_id uuid references public.orders(id), created_at timestamptz not null default now()
);
alter table public.offline_operations enable row level security;
revoke all on public.offline_operations from anon,authenticated;
grant select on public.offline_operations to authenticated;
create policy offline_operation_read on public.offline_operations for select to authenticated
 using(public.has_artist_role(artist_id,array['owner','manager']) or (actor_id=auth.uid() and public.has_event_role(event_id,array['owner','manager','seller'])));

create function public.prepare_offline_device(p_event_id uuid,p_device_id uuid,p_takeover boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_event public.events; v_device public.offline_devices; v_date date;
begin
  select * into v_event from public.events where id=p_event_id for update;
  if p_device_id is null or not public.has_event_role(p_event_id,array['owner','manager','seller']) then raise exception 'forbidden'; end if;
  select * into v_device from public.offline_devices where event_id=p_event_id for update;
  if found and not v_device.released and (v_device.device_id<>p_device_id or v_device.actor_id<>auth.uid()) and not (p_takeover and public.has_artist_role(v_event.artist_id,array['owner'])) then raise exception 'another_primary_device'; end if;
  insert into public.offline_devices(event_id,artist_id,device_id,actor_id) values(p_event_id,v_event.artist_id,p_device_id,auth.uid())
    on conflict(event_id) do update set
      resume_after=case when offline_devices.device_id<>p_device_id or offline_devices.heartbeat_at<now()-interval '90 seconds' then now()+interval '5 minutes' else offline_devices.resume_after end,
      device_id=p_device_id,actor_id=auth.uid(),released=false,prepared_at=now(),heartbeat_at=now();
  v_date := (now() at time zone coalesce(v_event.event_timezone,'Asia/Bangkok'))::date;
  return jsonb_build_object('event',to_jsonb(v_event),'device_id',p_device_id,'actor_id',auth.uid(),'prepared_at',now(),'service_date',v_date,
    'products',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.list_event_products(p_event_id) p),
    'queues',(select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'queue_number',q.queue_number,'status',q.status,'last_updated_at',q.last_updated_at) order by q.queue_number),'[]')
      from public.queues q where q.event_id=p_event_id and q.queue_service_date=v_date));
end $$;
revoke all on function public.prepare_offline_device(uuid,uuid,boolean) from public;
grant execute on function public.prepare_offline_device(uuid,uuid,boolean) to authenticated;

create function public.offline_device_heartbeat(p_event_id uuid,p_device_id uuid,p_pending boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.has_event_role(p_event_id,array['owner','manager','seller']) then raise exception 'forbidden'; end if;
  update public.offline_devices set
    resume_after=case when heartbeat_at<now()-interval '90 seconds' or recovering then now()+interval '5 minutes' else resume_after end,
    recovering=p_pending or exists(select 1 from public.offline_operations where event_id=p_event_id and status='conflict'),heartbeat_at=now()
    where event_id=p_event_id and device_id=p_device_id and actor_id=auth.uid() and not released;
  if not found then raise exception 'another_primary_device'; end if;
end $$;
revoke all on function public.offline_device_heartbeat(uuid,uuid,boolean) from public;
grant execute on function public.offline_device_heartbeat(uuid,uuid,boolean) to authenticated;

create function public.queue_updates_delayed(p_event_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.offline_devices where event_id=p_event_id
    and ((not released and (heartbeat_at<now()-interval '90 seconds' or recovering)) or resume_after>now()));
$$;
revoke all on function public.queue_updates_delayed(uuid) from public;
grant execute on function public.queue_updates_delayed(uuid) to anon,authenticated;

create function private.guard_offline_queue_expiry() returns trigger language plpgsql set search_path='' as $$
begin
  if new.status='expired' and old.status is distinct from 'expired' and public.queue_updates_delayed(old.event_id) then return old; end if;
  return new;
end $$;
create trigger guard_offline_queue_expiry before update on public.queues for each row execute function private.guard_offline_queue_expiry();

create function public.apply_offline_operation(p_id uuid,p_event_id uuid,p_device_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_existing public.offline_operations; v_artist uuid; v_device public.offline_devices;
  v_order uuid; v_queue public.queues; v_reason text; v_status text := 'applied'; v_total numeric; v_expected jsonb; v_actual jsonb;
begin
  if p_id is null or p_device_id is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>65536 then raise exception 'invalid_operation'; end if;
  if not public.has_event_role(p_event_id,array['owner','manager','seller']) then raise exception 'forbidden'; end if;
  select artist_id into v_artist from public.events where id=p_event_id;
  -- Serialize same-operation retries before touching stock.
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
      v_total := (p_payload->>'collected_total')::numeric;
      if v_total is null or v_total<0 or v_total>10000000 or v_total<>round(v_total,2) or p_payload->>'method' not in ('cash','transfer') then raise exception 'invalid_sale'; end if;

      select id into v_order from public.orders where payment_idempotency_key=p_id and event_id=p_event_id and status='completed';
      if v_order is null then
        if p_payload->>'order_id' is not null then
          select id into v_order from public.orders where id=(p_payload->>'order_id')::uuid and event_id=p_event_id for update;
          if not found then raise exception 'order_not_found'; end if;
          perform public.sync_customer_order_items_with_stock(v_order,p_payload->'items',p_id);
        elsif p_payload->>'queue_number' is not null then
          select * into v_queue from public.queues where event_id=p_event_id and queue_service_date=(p_payload->>'service_date')::date
            and queue_number=(p_payload->>'queue_number')::integer for update;
          if not found then raise exception 'queue_not_found'; end if;
          if v_queue.status in ('complete','missed','expired') then raise exception 'queue_changed'; end if;
          v_order := public.create_customer_order_with_stock(v_queue.id,p_payload->'items',p_id);
        end if;
        if v_order is not null then
          perform public.complete_order_with_stock(v_order,p_payload->>'method',p_id,coalesce(p_payload->'reward_choices','[]'),coalesce(p_payload->'promotion_choices','[]'),p_payload->>'expected_pricing_hash',coalesce((p_payload->>'accept_exhausted_rewards')::boolean,false));
        else
          v_order := public.create_walkin_order_with_stock(p_event_id,p_payload->'items',p_payload->>'method',p_id,coalesce(p_payload->'reward_choices','[]'),coalesce(p_payload->'promotion_choices','[]'),p_payload->>'expected_pricing_hash',coalesce((p_payload->>'accept_exhausted_rewards')::boolean,false));
        end if;
      end if;
      if (select total_price from public.orders where id=v_order)<>v_total or (p_payload->>'currency' is not null and (select currency from public.orders where id=v_order)<>p_payload->>'currency') then raise exception 'price_changed'; end if;
      if (select payment_method from public.orders where id=v_order) is distinct from p_payload->>'method' then raise exception 'receipt_changed'; end if;
      select jsonb_object_agg(product_id,quantity) into v_expected from (
        select item->>'product_id' product_id,sum((item->>'quantity')::integer) quantity from jsonb_array_elements(p_payload->'items') item group by item->>'product_id'
      ) expected;
      select jsonb_object_agg(product_id,quantity) into v_actual from (
        select product_id,sum(quantity) quantity from public.order_items where order_id=v_order and line_type='purchase' group by product_id
      ) actual;
      if v_actual is distinct from v_expected then raise exception 'receipt_changed'; end if;
    else raise exception 'invalid_operation'; end if;
  exception when others then
    -- The subtransaction rolls back stock/order changes; the actual receipt remains reviewable.
    v_status := 'conflict'; v_order := null;
    v_reason := case when sqlerrm in ('another_primary_device','queue_not_found','queue_changed','price_changed','insufficient_stock','promotion_choice_required','promotion_rewards_exhausted','event_not_active','booth_closed','invalid_sale','invalid_queue_status','invalid_operation') then sqlerrm else 'review_required' end;
  end;
  insert into public.offline_operations(id,event_id,artist_id,device_id,actor_id,payload,status,reason,order_id)
    values(p_id,p_event_id,v_artist,p_device_id,auth.uid(),p_payload,v_status,v_reason,v_order) returning * into v_existing;
  return to_jsonb(v_existing);
end $$;
revoke all on function public.apply_offline_operation(uuid,uuid,uuid,jsonb) from public;
grant execute on function public.apply_offline_operation(uuid,uuid,uuid,jsonb) to authenticated;

create function public.release_offline_device(p_event_id uuid,p_device_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.has_event_role(p_event_id,array['owner','manager','seller']) then raise exception 'forbidden'; end if;
  if exists(select 1 from public.offline_operations where event_id=p_event_id and status='conflict') then raise exception 'unresolved_operations'; end if;
  update public.offline_devices set released=true,resume_after=now()+interval '5 minutes'
    where event_id=p_event_id and device_id=p_device_id and actor_id=auth.uid();
  if not found then raise exception 'forbidden'; end if;
end $$;
revoke all on function public.release_offline_device(uuid,uuid) from public;
grant execute on function public.release_offline_device(uuid,uuid) to authenticated;

alter table public.offline_operations drop constraint offline_operations_status_check;
alter table public.offline_operations add constraint offline_operations_status_check check(status in ('applied','conflict','resolved'));
alter table public.offline_operations add column resolution_note text,add column resolved_by uuid,add column resolved_at timestamptz;
create unique index offline_operation_order_once on public.offline_operations(order_id) where order_id is not null;
create function public.resolve_offline_operation(p_id uuid,p_order_id uuid,p_note text) returns void
language plpgsql security definer set search_path='' as $$
declare v_row public.offline_operations; v_order public.orders; v_expected jsonb; v_actual jsonb;
begin
  select * into v_row from public.offline_operations where id=p_id for update;
  if not found or not public.has_artist_role(v_row.artist_id,array['owner','manager']) then raise exception 'forbidden'; end if;
  if v_row.status='resolved' and v_row.order_id is not distinct from p_order_id and v_row.resolution_note=trim(p_note) then return; end if;
  if v_row.status<>'conflict' or length(trim(coalesce(p_note,''))) not between 3 and 1000 then raise exception 'invalid_resolution'; end if;
  if v_row.payload->>'kind'='sale' then
    select * into v_order from public.orders where id=p_order_id and event_id=v_row.event_id for update;
    if not found or v_order.status<>'completed' or v_order.total_price<>(v_row.payload->>'collected_total')::numeric
      or v_order.payment_method is distinct from v_row.payload->>'method'
      or (v_row.payload->>'currency' is not null and v_order.currency<>v_row.payload->>'currency') then raise exception 'receipt_does_not_match'; end if;
    select jsonb_object_agg(product_id,quantity) into v_expected from (
      select item->>'product_id' product_id,sum((item->>'quantity')::integer) quantity from jsonb_array_elements(v_row.payload->'items') item group by item->>'product_id'
    ) expected;
    select jsonb_object_agg(product_id,quantity) into v_actual from (
      select product_id,sum(quantity) quantity from public.order_items where order_id=p_order_id and line_type='purchase' group by product_id
    ) actual;
    if v_actual is distinct from v_expected then raise exception 'receipt_does_not_match'; end if;
  else
    if p_order_id is not null or not exists(select 1 from public.queues where event_id=v_row.event_id
      and queue_service_date=(v_row.payload->>'service_date')::date and queue_number=(v_row.payload->>'queue_number')::integer
      and status=v_row.payload->>'status') then raise exception 'queue_not_reconciled'; end if;
  end if;
  update public.offline_operations set status='resolved',order_id=p_order_id,resolution_note=trim(p_note),resolved_by=auth.uid(),resolved_at=now() where id=p_id;
end $$;
revoke all on function public.resolve_offline_operation(uuid,uuid,text) from public;
grant execute on function public.resolve_offline_operation(uuid,uuid,text) to authenticated;
