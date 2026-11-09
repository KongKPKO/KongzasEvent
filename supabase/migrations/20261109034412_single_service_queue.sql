-- Do not rewrite historical tickets: duplicate serving rows must be resolved explicitly.
create unique index queues_one_serving_per_event on public.queues(event_id)
where event_id is not null and status = 'serving';

-- Browser clients use scoped RPCs; legacy direct state changes cannot bypass transitions.
revoke update on public.queues from authenticated;

create or replace function private.guard_arrived_queue() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='expired' and old.status='calling' then return old; end if;
 if new.status='complete' and old.status not in ('serving','complete') then raise exception 'invalid_queue_transition'; end if;
 if new.status='serving' and old.status is distinct from 'serving' and (old.status <> 'calling' or old.arrived_at is null) then raise exception 'invalid_queue_transition'; end if;
 if new.status in ('waiting','queued') then new.arrived_at:=null; end if;
 return new;
end $$;

-- Run after the legacy timestamp trigger so concurrent responses remain ordered.
create function private.queue_ordered_updated_at() returns trigger language plpgsql set search_path='' as $$
begin
 new.last_updated_at:=greatest(clock_timestamp(),old.last_updated_at + interval '1 microsecond');
 return new;
end $$;
revoke all on function private.queue_ordered_updated_at() from public,anon,authenticated;
create trigger zz_queue_ordered_updated_at before update on public.queues for each row execute function private.queue_ordered_updated_at();

create or replace function private.update_queue_operation(p_queue_id uuid,p_action text,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.queues; v_event uuid; v_service_date date;
begin
 select event_id into v_event from public.queues where id=p_queue_id;
 if auth.uid() is null or v_event is null or not public.has_event_role(v_event,array['owner','manager','seller','queue_staff']) then raise exception 'forbidden' using errcode='42501'; end if;
 -- All staff starts and completions serialize on the same event before ticket locks.
 perform 1 from public.events where id=v_event for update;
 select (clock_timestamp() at time zone coalesce(nullif(event_timezone,''),'Asia/Bangkok'))::date into v_service_date from public.events where id=v_event;
 select * into q from public.queues where id=p_queue_id for update;
 if p_expected_updated_at is null or q.last_updated_at is distinct from p_expected_updated_at then raise exception 'queue_changed'; end if;
 if p_action in ('arrive','serving','recall') and q.queue_service_date is distinct from v_service_date then raise exception 'queue_not_active_today'; end if;
 if not ((p_action in ('arrive','recall','missed') and q.status='calling') or
         (p_action='arrive' and q.status='expired') or
         (p_action='serving' and q.status='calling' and q.arrived_at is not null) or
         (p_action='complete' and q.status='serving') or
         (p_action='waiting' and q.status in ('expired','missed'))) then raise exception 'invalid_queue_transition'; end if;
 if p_action='serving' then
  update public.queues set status='complete',completed_at=now(),last_updated_at=now()
   where event_id=v_event and status='serving' and id<>q.id;
 end if;
 update public.queues set
  status=case when p_action='arrive' and status='expired' then 'calling' when p_action in ('arrive','recall') then status else p_action end,
  called_at=case when p_action='recall' then now() when p_action='waiting' then null else called_at end,
  arrived_at=case when p_action='arrive' then coalesce(arrived_at,now()) when p_action='waiting' then null else arrived_at end,
  served_at=case when p_action='serving' then now() when p_action='waiting' then null else served_at end,
  completed_at=case when p_action='complete' then now() when p_action='waiting' then null else completed_at end,
  last_updated_at=now()
 where id=p_queue_id returning * into q;
 return private.queue_operation_ticket(q);
end $$;
notify pgrst,'reload schema';

-- Keep the installed POS wrappers and inventory locking intact; remove only queue completion.
do $migration$
declare definition text; patched text; target regprocedure; old_block text;
begin
 for target, old_block in
  select 'private.complete_order_with_stock_base(uuid,text,uuid)'::regprocedure, $old$
  if v_order.queue_id is not null then
    update public.queues
    set status = 'complete',
        completed_at = now(),
        last_updated_at = now()
    where id = v_order.queue_id;
  end if;
$old$
  union all
  select 'private.complete_order_with_stock_before_auto_matching(uuid,text,uuid,jsonb,jsonb,text,boolean)'::regprocedure, $old$
  if v_order.queue_id is not null then
    update public.queues
    set status = 'complete', completed_at = now(), last_updated_at = now()
    where id = v_order.queue_id;
  end if;
$old$
 loop
  definition := pg_get_functiondef(target);
  patched := replace(definition, old_block, E'\n');
  if patched = definition or length(definition) - length(patched) <> length(old_block) - 1 then
   raise exception 'queue_checkout_definition_mismatch: %', target;
  end if;
  execute patched;
 end loop;
end $migration$;
