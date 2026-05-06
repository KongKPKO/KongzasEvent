-- Creator team role model v2:
-- owner, manager, seller, queue_staff.
-- Legacy rows are migrated from queue_pos -> seller and queue_only -> queue_staff.

update public.artist_members
set role = case
  when role = 'queue_pos' then 'seller'
  when role = 'queue_only' then 'queue_staff'
  else role
end
where role in ('queue_pos', 'queue_only');

alter table public.artist_members
  drop constraint if exists artist_members_role_check;

alter table public.artist_members
  add constraint artist_members_role_check
  check (role in ('owner', 'manager', 'seller', 'queue_staff'));

create or replace function public.normalize_artist_role(p_role text)
returns text
language sql
immutable
as $$
  select case
    when p_role = 'queue_pos' then 'seller'
    when p_role = 'queue_only' then 'queue_staff'
    else p_role
  end
$$;

create or replace function public.has_artist_role(p_artist_id uuid, p_allowed_roles text[])
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_allowed text[];
begin
  if auth.uid() is null then
    return false;
  end if;

  v_allowed := array(
    select public.normalize_artist_role(role_name)
    from unnest(p_allowed_roles) as role_name
  );

  if array_position(v_allowed, 'seller') is not null or array_position(v_allowed, 'queue_staff') is not null then
    v_allowed := array(select distinct role_name from unnest(v_allowed || array['manager']) as role_name);
  end if;

  if auth.uid() = p_artist_id and array_position(v_allowed, 'owner') is not null then
    return true;
  end if;

  v_email := lower(coalesce((auth.jwt() ->> 'email'), ''));

  if v_email = '' then
    return false;
  end if;

  return exists (
    select 1
    from public.artist_members m
    where m.artist_id = p_artist_id
      and m.status = 'active'
      and lower(m.member_email) = v_email
      and public.normalize_artist_role(m.role) = any(v_allowed)
  );
end;
$$;

grant execute on function public.normalize_artist_role(text) to anon, authenticated;
grant execute on function public.has_artist_role(uuid, text[]) to anon, authenticated;

create or replace function public.get_actor_context()
returns table (
  artist_id uuid,
  role text,
  is_owner boolean,
  member_email text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if auth.uid() is null then
    return;
  end if;

  v_email := lower(coalesce((auth.jwt() ->> 'email'), ''));

  if exists (select 1 from public.artists a where a.id = auth.uid()) then
    return query
    select auth.uid(), 'owner'::text, true, v_email;
    return;
  end if;

  return query
  select m.artist_id, public.normalize_artist_role(m.role), public.normalize_artist_role(m.role) = 'owner', m.member_email
  from public.artist_members m
  where m.status = 'active'
    and lower(m.member_email) = v_email
  order by m.updated_at desc
  limit 1;
end;
$$;

grant execute on function public.get_actor_context() to authenticated;

create or replace function public.update_artist_member_role(
  p_member_id uuid,
  p_next_role text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.artist_members%rowtype;
  v_next_role text;
begin
  v_next_role := public.normalize_artist_role(p_next_role);

  if v_next_role not in ('owner', 'manager', 'seller', 'queue_staff') then
    raise exception 'invalid_role';
  end if;

  select *
  into v_member
  from public.artist_members
  where id = p_member_id;

  if v_member.id is null then
    raise exception 'member_not_found';
  end if;

  if not public.has_artist_role(v_member.artist_id, array['owner']) then
    raise exception 'forbidden';
  end if;

  update public.artist_members
  set role = v_next_role,
      updated_at = now()
  where id = p_member_id;

  return true;
end;
$$;

grant execute on function public.update_artist_member_role(uuid, text) to authenticated;

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
  v_allowed text[];
begin
  if auth.uid() is null then
    return false;
  end if;

  v_allowed := array(
    select public.normalize_artist_role(role_name)
    from unnest(p_allowed_roles) as role_name
  );

  if array_position(v_allowed, 'seller') is not null or array_position(v_allowed, 'queue_staff') is not null then
    v_allowed := array(select distinct role_name from unnest(v_allowed || array['manager']) as role_name);
  end if;

  select e.id, e.artist_id
  into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null then
    return false;
  end if;

  if auth.uid() = v_event.artist_id and array_position(v_allowed, 'owner') is not null then
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
    and public.normalize_artist_role(m.role) = any(v_allowed)
  order by m.updated_at desc
  limit 1;

  if v_member.id is null then
    return false;
  end if;

  if public.normalize_artist_role(v_member.role) in ('owner', 'manager') then
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

  if public.normalize_artist_role(v_ctx.role) in ('owner', 'manager') then
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

drop policy if exists "events_owner_insert" on public.events;
drop policy if exists "events_owner_update" on public.events;
drop policy if exists "events_owner_delete" on public.events;
drop policy if exists "events_owner_read" on public.events;

create policy "events_owner_insert"
  on public.events
  for insert
  to authenticated
  with check (public.has_artist_role(artist_id, array['owner', 'manager']));

create policy "events_owner_update"
  on public.events
  for update
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager']))
  with check (public.has_artist_role(artist_id, array['owner', 'manager']));

create policy "events_owner_delete"
  on public.events
  for delete
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager']));

create policy "events_owner_read"
  on public.events
  for select
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager', 'seller', 'queue_staff']));

drop policy if exists "products_owner_read" on public.products;
drop policy if exists "products_owner_insert" on public.products;
drop policy if exists "products_owner_update" on public.products;
drop policy if exists "products_owner_delete" on public.products;

create policy "products_owner_read"
  on public.products
  for select
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager', 'seller', 'queue_staff']));

create policy "products_owner_insert"
  on public.products
  for insert
  to authenticated
  with check (public.has_artist_role(artist_id, array['owner', 'manager']));

create policy "products_owner_update"
  on public.products
  for update
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager']))
  with check (public.has_artist_role(artist_id, array['owner', 'manager']));

create policy "products_owner_delete"
  on public.products
  for delete
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager']));

drop policy if exists "event_products_staff_read" on public.event_products;
drop policy if exists "event_products_owner_manage" on public.event_products;

create policy "event_products_staff_read"
  on public.event_products
  for select
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager', 'seller', 'queue_staff']));

create policy "event_products_owner_manage"
  on public.event_products
  for all
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager']))
  with check (public.has_artist_role(artist_id, array['owner', 'manager']));

drop policy if exists "artist_promotions_owner_manage" on public.artist_promotions;
drop policy if exists "artist_promotions_pos_read" on public.artist_promotions;

create policy "artist_promotions_owner_manage"
  on public.artist_promotions
  for all
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager']))
  with check (public.has_artist_role(artist_id, array['owner', 'manager']));

create policy "artist_promotions_pos_read"
  on public.artist_promotions
  for select
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager', 'seller']));
