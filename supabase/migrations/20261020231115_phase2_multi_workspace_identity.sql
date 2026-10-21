-- Phase 2 identity/session: enumerate every workspace the signed-in account may
-- use and resolve an explicit workspace on the server. Existing callers of
-- get_actor_context() keep a deterministic default backed by the same source.

create or replace function public.list_actor_workspaces()
returns table (
  artist_id uuid,
  artist_name text,
  artist_slug text,
  role text,
  is_owner boolean,
  member_email text
)
language sql
stable
security definer
set search_path = public
as $$
  with identity as (
    select
      auth.uid() as user_id,
      lower(coalesce(auth.jwt() ->> 'email', '')) as email
  ), candidates as (
    -- Original prototype owners are still identified by artists.id = auth.uid().
    select
      a.id as artist_id,
      a.display_name as artist_name,
      a.slug as artist_slug,
      'owner'::text as role,
      true as is_owner,
      nullif(i.email, '') as member_email,
      1 as source_priority,
      a.updated_at as membership_updated_at
    from identity i
    join public.artists a on a.id = i.user_id
    where i.user_id is not null

    union all

    -- Active team membership is the source of truth for every invited role.
    select
      a.id,
      a.display_name,
      a.slug,
      public.normalize_artist_role(m.role),
      public.normalize_artist_role(m.role) = 'owner',
      lower(m.member_email),
      2,
      m.updated_at
    from identity i
    join public.artist_members m
      on i.email <> ''
     and lower(m.member_email) = i.email
     and m.status = 'active'
    join public.artists a on a.id = m.artist_id

  ), deduplicated as (
    select distinct on (c.artist_id)
      c.artist_id,
      c.artist_name,
      c.artist_slug,
      c.role,
      c.is_owner,
      c.member_email,
      c.source_priority,
      c.membership_updated_at
    from candidates c
    order by
      c.artist_id,
      c.source_priority,
      case c.role
        when 'owner' then 1
        when 'manager' then 2
        when 'seller' then 3
        when 'queue_staff' then 4
        else 5
      end,
      c.membership_updated_at desc nulls last
  )
  select
    d.artist_id,
    d.artist_name,
    d.artist_slug,
    d.role,
    d.is_owner,
    d.member_email
  from deduplicated d
  order by
    case d.role
      when 'owner' then 1
      when 'manager' then 2
      when 'seller' then 3
      when 'queue_staff' then 4
      else 5
    end,
    lower(d.artist_name),
    d.artist_id;
$$;

create or replace function public.resolve_actor_workspace(p_artist_id uuid)
returns table (
  artist_id uuid,
  role text,
  is_owner boolean,
  member_email text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_artist_id is null then
    raise exception 'workspace is required' using errcode = '22004';
  end if;

  return query
  select
    w.artist_id,
    w.role,
    w.is_owner,
    w.member_email
  from public.list_actor_workspaces() w
  where w.artist_id = p_artist_id;

  if not found then
    raise exception 'workspace access denied' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.get_actor_context()
returns table (
  artist_id uuid,
  role text,
  is_owner boolean,
  member_email text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.artist_id,
    w.role,
    w.is_owner,
    w.member_email
  from public.list_actor_workspaces() w
  limit 1;
$$;

revoke execute on function public.list_actor_workspaces() from public, anon;
revoke execute on function public.resolve_actor_workspace(uuid) from public, anon;
revoke execute on function public.get_actor_context() from public, anon;

grant execute on function public.list_actor_workspaces() to authenticated;
grant execute on function public.resolve_actor_workspace(uuid) to authenticated;
grant execute on function public.get_actor_context() to authenticated;

-- Live Ops previously called the zero-argument function, which inherits the
-- legacy first-workspace choice. The explicit overload keeps event discovery
-- in the selected workspace while has_event_role remains the final server-side
-- authorization check for every event action.
create or replace function public.list_accessible_pos_events(p_artist_id uuid)
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
stable
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_has_restrictions boolean := false;
begin
  select * into v_ctx
  from public.resolve_actor_workspace(p_artist_id)
  limit 1;

  if v_ctx.role in ('owner', 'manager') then
    return query
    select e.id, e.event_name, e.start_date, e.end_date, e.event_timezone, e.is_booth_open, e.status
    from public.events e
    where e.artist_id = p_artist_id
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
    where ema.artist_id = p_artist_id
      and lower(m.member_email) = lower(v_ctx.member_email)
      and m.status = 'active'
  ) into v_has_restrictions;

  return query
  select e.id, e.event_name, e.start_date, e.end_date, e.event_timezone, e.is_booth_open, e.status
  from public.events e
  where e.artist_id = p_artist_id
    and e.status = 'Confirmed'
    and e.start_date <= now()
    and e.end_date >= now()
    and (
      not v_has_restrictions
      or exists (
        select 1
        from public.event_member_assignments ema
        join public.artist_members m on m.id = ema.member_id
        where ema.artist_id = p_artist_id
          and ema.event_id = e.id
          and lower(m.member_email) = lower(v_ctx.member_email)
          and m.status = 'active'
      )
    )
  order by e.start_date asc;
end;
$$;

revoke execute on function public.list_accessible_pos_events(uuid) from public, anon;
grant execute on function public.list_accessible_pos_events(uuid) to authenticated;

create or replace function public.has_event_role_for_workspace(
  p_event_id uuid,
  p_artist_id uuid,
  p_allowed_roles text[]
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform 1 from public.resolve_actor_workspace(p_artist_id);
  if not exists (
    select 1 from public.events e
    where e.id = p_event_id and e.artist_id = p_artist_id
  ) then
    return false;
  end if;
  return public.has_event_role(p_event_id, p_allowed_roles);
end;
$$;

revoke execute on function public.has_event_role_for_workspace(uuid, uuid, text[]) from public, anon;
grant execute on function public.has_event_role_for_workspace(uuid, uuid, text[]) to authenticated;

create or replace function public.list_my_online_campaigns(p_artist_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_all jsonb;
begin
  perform 1 from public.resolve_actor_workspace(p_artist_id);
  v_all := public.list_my_online_campaigns();
  return coalesce((
    select jsonb_agg(entry)
    from jsonb_array_elements(coalesce(v_all, '[]'::jsonb)) entry
    where entry ->> 'artist_id' = p_artist_id::text
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_online_campaign_workspace(
  p_campaign_id uuid,
  p_artist_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform 1 from public.resolve_actor_workspace(p_artist_id);
  if not exists (
    select 1 from public.online_campaigns c
    where c.id = p_campaign_id and c.artist_id = p_artist_id
  ) then
    raise exception 'campaign_not_found' using errcode = 'P0001';
  end if;
  return public.get_online_campaign_workspace(p_campaign_id);
end;
$$;

revoke execute on function public.list_my_online_campaigns(uuid) from public, anon;
revoke execute on function public.get_online_campaign_workspace(uuid, uuid) from public, anon;
grant execute on function public.list_my_online_campaigns(uuid) to authenticated;
grant execute on function public.get_online_campaign_workspace(uuid, uuid) to authenticated;
