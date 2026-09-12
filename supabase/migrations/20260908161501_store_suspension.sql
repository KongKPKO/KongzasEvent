create table private.store_restrictions (
  artist_id uuid primary key references public.artists(id),
  suspended boolean not null,
  updated_at timestamptz not null default now()
);
create table private.store_restriction_audit (
  id bigint generated always as identity primary key,
  artist_id uuid not null,
  actor_id uuid not null,
  suspended boolean not null,
  reason text not null check (char_length(reason) between 5 and 500),
  created_at timestamptz not null default now()
);
alter table private.store_restrictions enable row level security;
alter table private.store_restriction_audit enable row level security;
revoke all on private.store_restrictions,private.store_restriction_audit from public,anon,authenticated;
revoke all on sequence private.store_restriction_audit_id_seq from public,anon,authenticated;

create function private.set_store_suspension(p_artist_id uuid,p_suspended boolean,p_expected boolean,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $$
declare current_state boolean;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  if p_suspended is null or p_expected is null or char_length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'invalid_request'; end if;
  perform 1 from public.artists where id=p_artist_id for update;
  if not found then raise exception 'store_not_found'; end if;
  select coalesce((select suspended from private.store_restrictions where artist_id=p_artist_id),false) into current_state;
  if current_state<>p_expected then raise exception 'state_changed'; end if;
  if current_state=p_suspended then return current_state; end if;
  insert into private.store_restrictions(artist_id,suspended) values(p_artist_id,p_suspended)
    on conflict(artist_id) do update set suspended=excluded.suspended,updated_at=now();
  insert into private.store_restriction_audit(artist_id,actor_id,suspended,reason) values(p_artist_id,auth.uid(),p_suspended,btrim(p_reason));
  return p_suspended;
end $$;
create function public.set_store_suspension(p_artist_id uuid,p_suspended boolean,p_expected boolean,p_reason text)
returns boolean language sql security invoker set search_path='' as $$
  select private.set_store_suspension(p_artist_id,p_suspended,p_expected,p_reason);
$$;
revoke all on function private.set_store_suspension(uuid,boolean,boolean,text),public.set_store_suspension(uuid,boolean,boolean,text) from public,anon,authenticated;
grant execute on function private.set_store_suspension(uuid,boolean,boolean,text),public.set_store_suspension(uuid,boolean,boolean,text) to authenticated;

create function private.get_store_suspension(p_artist_id uuid)
returns boolean language sql security definer set search_path='' as $$
  select coalesce((select r.suspended from public.artists a left join private.store_restrictions r on r.artist_id=a.id
    where a.id=p_artist_id and ((a.is_public and a.is_verified) or public.is_platform_admin()
      or public.has_artist_role(a.id,array['owner','manager','seller','queue_staff']))),false);
$$;
create function public.get_store_suspension(p_artist_id uuid)
returns boolean language sql security invoker set search_path='' as $$ select private.get_store_suspension(p_artist_id); $$;
revoke all on function private.get_store_suspension(uuid),public.get_store_suspension(uuid) from public,anon,authenticated;
grant usage on schema private to anon,authenticated;
grant execute on function private.get_store_suspension(uuid),public.get_store_suspension(uuid) to anon,authenticated;

create function private.guard_store_new_business()
returns trigger language plpgsql security definer set search_path='' as $$
declare store_id uuid;
begin
  if tg_table_name='queues' then
    if tg_op='UPDATE' then
      if new.artist_id is not distinct from old.artist_id and new.event_id is not distinct from old.event_id then return new; end if;
    end if;
    store_id:=new.artist_id;
  else
    if tg_op='UPDATE' then
      if new.event_id is not distinct from old.event_id and new.campaign_id is not distinct from old.campaign_id
        and new.queue_id is not distinct from old.queue_id then return new; end if;
    end if;
    select coalesce((select artist_id from public.online_campaigns where id=new.campaign_id),
      (select artist_id from public.events where id=new.event_id),
      (select artist_id from public.queues where id=new.queue_id)) into store_id;
  end if;
  -- Same lock target as suspension; a concurrent insert either commits before
  -- suspension or observes it. It cannot silently enter after suspension wins.
  perform 1 from public.artists where id=store_id for share;
  if exists(select 1 from private.store_restrictions where artist_id=store_id and suspended) then
    raise exception 'store_suspended: ร้านนี้ถูกระงับการรับออเดอร์และคิวใหม่ / This store is not accepting new orders or queue tickets';
  end if;
  return new;
end $$;
revoke all on function private.guard_store_new_business() from public,anon,authenticated;
create trigger guard_store_new_orders before insert or update of event_id,campaign_id,queue_id on public.orders
  for each row execute function private.guard_store_new_business();
create trigger guard_store_new_queues before insert or update of artist_id,event_id on public.queues
  for each row execute function private.guard_store_new_business();
