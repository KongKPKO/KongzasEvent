-- Arrival is operational metadata: calling/serving keep their existing meaning for orders.
alter table public.queues add column arrived_at timestamptz;
grant select(arrived_at) on public.queues to authenticated;
create function private.queue_operation_ticket(q public.queues) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('id',q.id,'artist_id',q.artist_id,'event_id',q.event_id,'queue_number',q.queue_number,
 'status',q.status,'queue_service_date',q.queue_service_date,'called_at',q.called_at,'arrived_at',q.arrived_at,
 'served_at',q.served_at,'completed_at',q.completed_at,'created_at',q.created_at,'last_updated_at',q.last_updated_at)
$$;
revoke all on function private.queue_operation_ticket(public.queues) from public,anon,authenticated;

create table private.queue_call_batches (
 event_id uuid not null references public.events(id) on delete cascade,
 request_id uuid not null,
 actor_id uuid not null,
 batch_size integer not null check(batch_size in (1,3,5,10)),
 queue_ids uuid[] not null,
 created_at timestamptz not null default now(),
 primary key(event_id,request_id)
);
alter table private.queue_call_batches enable row level security;
revoke all on private.queue_call_batches from public,anon,authenticated;

create function private.call_queue_batch(p_event_id uuid,p_count integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[]; prior private.queue_call_batches; service_date date; result jsonb;
begin
 if auth.uid() is null or not public.has_event_role(p_event_id,array['owner','manager','seller','queue_staff']) then raise exception 'forbidden' using errcode='42501'; end if;
 if p_count is null or p_count not in (1,3,5,10) or p_request_id is null then raise exception 'invalid_batch'; end if;
 -- Serialize batch selection per event; a replay must never call another batch.
 select (now() at time zone coalesce(nullif(event_timezone,''),'Asia/Bangkok'))::date into service_date from public.events where id=p_event_id for update;
 select * into prior from private.queue_call_batches where event_id=p_event_id and request_id=p_request_id;
 if found then
  if prior.actor_id<>auth.uid() or prior.batch_size<>p_count then raise exception 'batch_request_mismatch'; end if;
  ids:=prior.queue_ids;
 else
  select coalesce(array_agg(id order by queue_number),'{}'::uuid[]) into ids from
   (select id,queue_number from public.queues where event_id=p_event_id and queue_service_date=service_date and status in ('waiting','queued') order by queue_number,id limit p_count for update) chosen;
  update public.queues set status='calling',called_at=now(),arrived_at=null,last_updated_at=now() where id=any(ids);
  insert into private.queue_call_batches(event_id,request_id,actor_id,batch_size,queue_ids) values(p_event_id,p_request_id,auth.uid(),p_count,ids);
 end if;
 select coalesce(jsonb_agg(private.queue_operation_ticket(q) order by q.queue_number),'[]'::jsonb) into result from public.queues q where q.id=any(ids);
 return result;
end $$;
create function public.call_queue_batch(p_event_id uuid,p_count integer,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.call_queue_batch(p_event_id,p_count,p_request_id) $$;
revoke all on function private.call_queue_batch(uuid,integer,uuid),public.call_queue_batch(uuid,integer,uuid) from public,anon;
grant execute on function private.call_queue_batch(uuid,integer,uuid),public.call_queue_batch(uuid,integer,uuid) to authenticated;

create function private.update_queue_operation(p_queue_id uuid,p_action text,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.queues;
begin
 select * into q from public.queues where id=p_queue_id for update;
 if auth.uid() is null or not public.has_event_role(q.event_id,array['owner','manager','seller','queue_staff']) then raise exception 'forbidden' using errcode='42501'; end if;
 if p_expected_updated_at is null or q.last_updated_at is distinct from p_expected_updated_at then raise exception 'queue_changed'; end if;
 if not ((p_action in ('arrive','recall','serving','missed') and q.status='calling') or (p_action='waiting' and q.status in ('expired','missed'))) then raise exception 'invalid_queue_transition'; end if;
 update public.queues set
  status=case when p_action in ('arrive','recall') then status else p_action end,
  called_at=case when p_action='recall' then now() when p_action='waiting' then null else called_at end,
  arrived_at=case when p_action in ('arrive','serving') then coalesce(arrived_at,now()) when p_action='waiting' then null else arrived_at end,
  served_at=case when p_action='serving' then now() when p_action='waiting' then null else served_at end,
  completed_at=case when p_action='waiting' then null else completed_at end,
  last_updated_at=now()
 where id=p_queue_id returning * into q;
 return private.queue_operation_ticket(q);
end $$;
create function public.update_queue_operation(p_queue_id uuid,p_action text,p_expected_updated_at timestamptz)
returns jsonb language sql security invoker set search_path='' as $$ select private.update_queue_operation(p_queue_id,p_action,p_expected_updated_at) $$;
revoke all on function private.update_queue_operation(uuid,text,timestamptz),public.update_queue_operation(uuid,text,timestamptz) from public,anon;
grant execute on function private.update_queue_operation(uuid,text,timestamptz),public.update_queue_operation(uuid,text,timestamptz) to authenticated;
notify pgrst,'reload schema';

-- Older clients must not automatically expire a customer already marked present.
create function private.guard_arrived_queue() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='expired' and old.arrived_at is not null then return old; end if;
 if new.status in ('waiting','queued') then new.arrived_at:=null; end if;
 if new.status='serving' then new.arrived_at:=coalesce(new.arrived_at,now()); end if;
 return new;
end $$;
create trigger guard_arrived_queue before update on public.queues for each row execute function private.guard_arrived_queue();
