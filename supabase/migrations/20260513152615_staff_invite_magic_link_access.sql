-- Staff invite onboarding:
-- - owner-only team invitation management
-- - seller / queue_staff invitations carry event restrictions up front
-- - accepting an invite creates an account membership only, never a creator page

create table if not exists public.artist_member_invitation_events (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.artist_member_invitations(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint artist_member_invitation_events_unique unique (invitation_id, event_id)
);

create index if not exists idx_artist_member_invitation_events_invitation
  on public.artist_member_invitation_events (invitation_id);

create index if not exists idx_artist_member_invitation_events_artist_event
  on public.artist_member_invitation_events (artist_id, event_id);

alter table public.artist_member_invitation_events enable row level security;

drop policy if exists "artist_member_invitation_events_owner_read" on public.artist_member_invitation_events;

create policy "artist_member_invitation_events_owner_read"
  on public.artist_member_invitation_events
  for select
  to authenticated
  using (public.has_artist_role(artist_id, array['owner']));

grant select on public.artist_member_invitation_events to authenticated;

drop function if exists public.invite_team_member(uuid, text, text);
drop function if exists public.list_team_invitations(uuid);
drop function if exists public.list_my_pending_invitations();

create or replace function public.invite_team_member(
  p_artist_id uuid,
  p_email text,
  p_role text,
  p_event_ids uuid[] default array[]::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_invitation_id uuid;
  v_rows_inserted int;
  v_event_count int := 0;
  v_valid_event_count int := 0;
begin
  if not public.has_artist_role(p_artist_id, array['owner']) then
    raise exception 'permission denied';
  end if;

  v_email := lower(trim(p_email));

  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'invalid email';
  end if;

  if p_role not in ('manager', 'seller', 'queue_staff') then
    raise exception 'invalid role: %', p_role;
  end if;

  select count(distinct event_id)
  into v_event_count
  from unnest(coalesce(p_event_ids, array[]::uuid[])) as event_id;

  if p_role in ('seller', 'queue_staff') and v_event_count = 0 then
    raise exception 'event access required';
  end if;

  if p_role = 'manager' and v_event_count > 0 then
    raise exception 'manager cannot be event restricted';
  end if;

  if v_event_count > 0 then
    select count(distinct e.id)
    into v_valid_event_count
    from public.events e
    join unnest(p_event_ids) as event_id on event_id = e.id
    where e.artist_id = p_artist_id
      and e.status in ('Confirmed', 'confirmed');

    if v_valid_event_count <> v_event_count then
      raise exception 'invalid event access';
    end if;
  end if;

  if exists (
    select 1
    from public.artist_members
    where artist_id = p_artist_id
      and lower(member_email) = v_email
      and status = 'active'
  ) then
    return jsonb_build_object('result', 'already_member');
  end if;

  if exists (
    select 1
    from public.artist_member_invitations
    where artist_id = p_artist_id
      and lower(invited_email) = v_email
      and status = 'pending'
  ) then
    return jsonb_build_object('result', 'already_invited');
  end if;

  insert into public.artist_member_invitations
    (artist_id, invited_email, role, invited_by)
  values
    (p_artist_id, v_email, p_role, auth.uid())
  on conflict do nothing
  returning id into v_invitation_id;

  get diagnostics v_rows_inserted = row_count;

  if v_rows_inserted = 0 then
    return jsonb_build_object('result', 'already_invited');
  end if;

  if p_role in ('seller', 'queue_staff') then
    insert into public.artist_member_invitation_events (invitation_id, artist_id, event_id)
    select v_invitation_id, p_artist_id, event_id
    from (select distinct event_id from unnest(p_event_ids) as event_id) selected_events;
  end if;

  return jsonb_build_object('result', 'invitation_sent', 'invitation_id', v_invitation_id);
end;
$$;

create or replace function public.list_team_invitations(p_artist_id uuid)
returns table(
  id uuid,
  invited_email text,
  role text,
  invited_at timestamptz,
  expires_at timestamptz,
  event_ids uuid[]
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_artist_role(p_artist_id, array['owner']) then
    raise exception 'permission denied';
  end if;

  return query
    select
      i.id,
      i.invited_email,
      i.role,
      i.invited_at,
      i.expires_at,
      coalesce(array_agg(ie.event_id order by ie.created_at) filter (where ie.event_id is not null), array[]::uuid[]) as event_ids
    from public.artist_member_invitations i
    left join public.artist_member_invitation_events ie on ie.invitation_id = i.id
    where i.artist_id = p_artist_id
      and i.status = 'pending'
    group by i.id, i.invited_email, i.role, i.invited_at, i.expires_at
    order by i.invited_at asc;
end;
$$;

create or replace function public.cancel_team_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_artist_id uuid;
  v_status text;
begin
  select artist_id, status
  into v_artist_id, v_status
  from public.artist_member_invitations
  where id = p_invitation_id;

  if not found then
    raise exception 'invitation not found';
  end if;

  if not public.has_artist_role(v_artist_id, array['owner']) then
    raise exception 'permission denied';
  end if;

  if v_status != 'pending' then
    raise exception 'invitation is not pending (current status: %)', v_status;
  end if;

  update public.artist_member_invitations
  set status = 'cancelled',
      cancelled_at = now(),
      updated_at = now()
  where id = p_invitation_id
    and status = 'pending';

  if not found then
    raise exception 'invitation is not pending or was already changed';
  end if;

  return jsonb_build_object('result', 'cancelled');
end;
$$;

create or replace function public.list_my_pending_invitations()
returns table(
  id uuid,
  artist_id uuid,
  artist_name text,
  role text,
  invited_at timestamptz,
  expires_at timestamptz,
  event_ids uuid[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if v_email = '' then
    return;
  end if;

  return query
    select
      i.id,
      i.artist_id,
      coalesce(a.display_name, 'Unknown Booth') as artist_name,
      i.role,
      i.invited_at,
      i.expires_at,
      coalesce(array_agg(ie.event_id order by ie.created_at) filter (where ie.event_id is not null), array[]::uuid[]) as event_ids
    from public.artist_member_invitations i
    join public.artists a on a.id = i.artist_id
    left join public.artist_member_invitation_events ie on ie.invitation_id = i.id
    where lower(i.invited_email) = v_email
      and i.status = 'pending'
      and (i.expires_at is null or i.expires_at > now())
    group by i.id, i.artist_id, a.display_name, i.role, i.invited_at, i.expires_at
    order by i.invited_at asc;
end;
$$;

create or replace function public.accept_team_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_invitation record;
  v_member_id uuid;
  v_first_event_id uuid;
  v_redirect_path text;
begin
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if v_email = '' then
    raise exception 'not authenticated';
  end if;

  select *
  into v_invitation
  from public.artist_member_invitations
  where id = p_invitation_id;

  if not found then
    raise exception 'invitation not found';
  end if;

  if lower(v_invitation.invited_email) != v_email then
    raise exception 'permission denied';
  end if;

  if v_invitation.status != 'pending' then
    raise exception 'invitation is not pending (current status: %)', v_invitation.status;
  end if;

  if v_invitation.expires_at is not null and v_invitation.expires_at <= now() then
    raise exception 'invitation has expired';
  end if;

  insert into public.artist_members (artist_id, member_email, role, status, created_by)
  values (v_invitation.artist_id, v_email, v_invitation.role, 'active', v_invitation.invited_by)
  on conflict (artist_id, lower(member_email))
  do update set
    role = excluded.role,
    status = 'active',
    updated_at = now()
  returning id into v_member_id;

  if v_invitation.role in ('seller', 'queue_staff') then
    delete from public.event_member_assignments
    where artist_id = v_invitation.artist_id
      and member_id = v_member_id;

    insert into public.event_member_assignments (artist_id, member_id, event_id)
    select v_invitation.artist_id, v_member_id, ie.event_id
    from public.artist_member_invitation_events ie
    where ie.invitation_id = p_invitation_id
    on conflict (event_id, member_id) do nothing;

    select ie.event_id
    into v_first_event_id
    from public.artist_member_invitation_events ie
    where ie.invitation_id = p_invitation_id
    order by ie.created_at asc
    limit 1;
  else
    delete from public.event_member_assignments
    where artist_id = v_invitation.artist_id
      and member_id = v_member_id;
  end if;

  update public.artist_member_invitations
  set status = 'accepted',
      accepted_at = now(),
      updated_at = now()
  where id = p_invitation_id;

  v_redirect_path := case
    when v_invitation.role = 'seller' and v_first_event_id is not null then '/live/pos?eventId=' || v_first_event_id::text
    when v_invitation.role = 'queue_staff' and v_first_event_id is not null then '/live/queue?eventId=' || v_first_event_id::text
    else '/manage-events'
  end;

  return jsonb_build_object(
    'result', 'accepted',
    'role', v_invitation.role,
    'event_id', v_first_event_id,
    'redirect_path', v_redirect_path
  );
end;
$$;

revoke execute on function public.invite_team_member(uuid, text, text, uuid[]) from anon, public;
revoke execute on function public.list_team_invitations(uuid) from anon, public;
revoke execute on function public.cancel_team_invitation(uuid) from anon, public;
revoke execute on function public.list_my_pending_invitations() from anon, public;
revoke execute on function public.accept_team_invitation(uuid) from anon, public;

grant execute on function public.invite_team_member(uuid, text, text, uuid[]) to authenticated;
grant execute on function public.list_team_invitations(uuid) to authenticated;
grant execute on function public.cancel_team_invitation(uuid) to authenticated;
grant execute on function public.list_my_pending_invitations() to authenticated;
grant execute on function public.accept_team_invitation(uuid) to authenticated;
