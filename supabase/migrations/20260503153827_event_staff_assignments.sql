-- Phase 3: event-scoped staff assignment.

create table if not exists public.event_member_assignments (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  member_id uuid not null references public.artist_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_member_assignments_unique unique (event_id, member_id)
);

create index if not exists idx_event_member_assignments_artist_member
  on public.event_member_assignments (artist_id, member_id);

create index if not exists idx_event_member_assignments_event
  on public.event_member_assignments (event_id);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_event_member_assignments_updated_at'
  ) then
    create trigger trg_event_member_assignments_updated_at
      before update on public.event_member_assignments
      for each row
      execute function public.update_updated_at_column();
  end if;
end $$;

alter table public.event_member_assignments enable row level security;

drop policy if exists "event_member_assignments_owner_manage" on public.event_member_assignments;
drop policy if exists "event_member_assignments_self_read" on public.event_member_assignments;

create policy "event_member_assignments_owner_manage"
  on public.event_member_assignments
  for all
  to authenticated
  using (public.has_artist_role(artist_id, array['owner']))
  with check (public.has_artist_role(artist_id, array['owner']));

create policy "event_member_assignments_self_read"
  on public.event_member_assignments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.artist_members m
      where m.id = event_member_assignments.member_id
        and m.status = 'active'
        and lower(m.member_email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
    )
  );

grant select, insert, update, delete on public.event_member_assignments to authenticated;

create or replace function public.has_event_role(p_event_id uuid, p_allowed_roles text[])
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_email text;
  v_member record;
  v_has_restrictions boolean := false;
begin
  if auth.uid() is null then
    return false;
  end if;

  select e.id, e.artist_id
  into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null then
    return false;
  end if;

  if auth.uid() = v_event.artist_id then
    return true;
  end if;

  v_email := lower(coalesce((auth.jwt() ->> 'email'), ''));
  if v_email = '' then
    return false;
  end if;

  select m.*
  into v_member
  from public.artist_members m
  where m.artist_id = v_event.artist_id
    and m.status = 'active'
    and lower(m.member_email) = v_email
    and m.role = any(p_allowed_roles)
  order by m.updated_at desc
  limit 1;

  if v_member.id is null then
    return false;
  end if;

  if v_member.role = 'owner' then
    return true;
  end if;

  select exists (
    select 1
    from public.event_member_assignments ema
    where ema.artist_id = v_event.artist_id
      and ema.member_id = v_member.id
  ) into v_has_restrictions;

  if not v_has_restrictions then
    return true;
  end if;

  return exists (
    select 1
    from public.event_member_assignments ema
    where ema.artist_id = v_event.artist_id
      and ema.member_id = v_member.id
      and ema.event_id = p_event_id
  );
end;
$$;

grant execute on function public.has_event_role(uuid, text[]) to authenticated;

create or replace function public.list_accessible_pos_events()
returns table (
  id uuid,
  event_name text,
  start_date timestamptz,
  end_date timestamptz,
  event_timezone text,
  is_booth_open boolean,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_has_restrictions boolean := false;
begin
  select *
  into v_ctx
  from public.get_actor_context()
  limit 1;

  if v_ctx.artist_id is null then
    return;
  end if;

  if v_ctx.role = 'owner' then
    return query
    select e.id, e.event_name, e.start_date, e.end_date, e.event_timezone, e.is_booth_open, e.status
    from public.events e
    where e.artist_id = v_ctx.artist_id
      and e.status = 'Confirmed'
      and e.start_date <= now()
      and e.end_date >= now()
    order by e.start_date asc;
    return;
  end if;

  select exists (
    select 1
    from public.event_member_assignments ema
    join public.artist_members m on m.id = ema.member_id
    where ema.artist_id = v_ctx.artist_id
      and lower(m.member_email) = lower(v_ctx.member_email)
      and m.status = 'active'
  ) into v_has_restrictions;

  return query
  select e.id, e.event_name, e.start_date, e.end_date, e.event_timezone, e.is_booth_open, e.status
  from public.events e
  where e.artist_id = v_ctx.artist_id
    and e.status = 'Confirmed'
    and e.start_date <= now()
    and e.end_date >= now()
    and (
      not v_has_restrictions
      or exists (
        select 1
        from public.event_member_assignments ema
        join public.artist_members m on m.id = ema.member_id
        where ema.event_id = e.id
          and lower(m.member_email) = lower(v_ctx.member_email)
          and m.status = 'active'
      )
    )
  order by e.start_date asc;
end;
$$;

grant execute on function public.list_accessible_pos_events() to authenticated;

create or replace function public.set_booth_open_status(
  p_event_id uuid,
  p_is_open boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_event_role(p_event_id, array['owner', 'queue_only', 'queue_pos']) then
    raise exception 'forbidden';
  end if;

  update public.events
  set is_booth_open = p_is_open,
      last_updated_at = now()
  where id = p_event_id;

  return true;
end;
$$;

grant execute on function public.set_booth_open_status(uuid, boolean) to authenticated;
