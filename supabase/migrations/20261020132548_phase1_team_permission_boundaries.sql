-- Close team-permission races without changing the existing access model:
-- zero assignment rows still means unrestricted event access for staff.

create or replace function public.replace_event_member_assignments(
  p_member_id uuid,
  p_event_ids uuid[]
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.artist_members%rowtype;
  v_requested_count integer;
  v_valid_count integer;
begin
  select *
  into v_member
  from public.artist_members
  where id = p_member_id
  for update;

  if not found then
    raise exception 'member_not_found';
  end if;

  if not public.has_artist_role(v_member.artist_id, array['owner']) then
    raise exception 'forbidden';
  end if;

  if public.normalize_artist_role(v_member.role) not in ('seller', 'queue_staff') then
    raise exception 'member_role_not_event_scoped';
  end if;

  if p_event_ids is null then
    raise exception 'invalid_event_access';
  end if;

  v_requested_count := cardinality(coalesce(p_event_ids, array[]::uuid[]));

  select count(distinct e.id)
  into v_valid_count
  from unnest(coalesce(p_event_ids, array[]::uuid[])) requested(event_id)
  join public.events e on e.id = requested.event_id
  where e.artist_id = v_member.artist_id
    and e.status in ('Confirmed', 'confirmed');

  if v_valid_count <> v_requested_count then
    raise exception 'invalid_event_access';
  end if;

  delete from public.event_member_assignments
  where artist_id = v_member.artist_id
    and member_id = v_member.id;

  insert into public.event_member_assignments (artist_id, member_id, event_id)
  select v_member.artist_id, v_member.id, requested.event_id
  from unnest(coalesce(p_event_ids, array[]::uuid[])) requested(event_id);

  return true;
end;
$$;

revoke execute on function public.replace_event_member_assignments(uuid, uuid[]) from public, anon;
grant execute on function public.replace_event_member_assignments(uuid, uuid[]) to authenticated;

-- Assignment writes now go through the owner-only atomic RPC above. Reads stay
-- available because staff authorization helpers and ManageTeam need them.
revoke insert, update, delete on public.event_member_assignments from public, anon, authenticated;

create or replace function public.cancel_team_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_artist_id uuid;
  v_status text;
  v_rows_updated integer;
begin
  select artist_id, status
  into v_artist_id, v_status
  from public.artist_member_invitations
  where id = p_invitation_id
  for update;

  if not found then
    raise exception 'invitation not found';
  end if;

  if not public.has_artist_role(v_artist_id, array['owner']) then
    raise exception 'permission denied';
  end if;

  if v_status <> 'pending' then
    raise exception 'invitation is not pending (current status: %)', v_status;
  end if;

  update public.artist_member_invitations
  set status = 'cancelled',
      cancelled_at = now(),
      updated_at = now()
  where id = p_invitation_id
    and status = 'pending';

  get diagnostics v_rows_updated = row_count;
  if v_rows_updated <> 1 then
    raise exception 'invitation is not pending or was already changed';
  end if;

  return jsonb_build_object('result', 'cancelled');
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
  v_invitation public.artist_member_invitations%rowtype;
  v_member_id uuid;
  v_first_event_id uuid;
  v_redirect_path text;
  v_rows_updated integer;
begin
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if v_email = '' then
    raise exception 'not authenticated';
  end if;

  select *
  into v_invitation
  from public.artist_member_invitations
  where id = p_invitation_id
  for update;

  if not found then
    raise exception 'invitation not found';
  end if;

  if lower(v_invitation.invited_email) <> v_email then
    raise exception 'permission denied';
  end if;

  if v_invitation.status <> 'pending' then
    raise exception 'invitation is not pending (current status: %)', v_invitation.status;
  end if;

  if v_invitation.expires_at is not null and v_invitation.expires_at <= clock_timestamp() then
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
  where id = p_invitation_id
    and status = 'pending';

  get diagnostics v_rows_updated = row_count;
  if v_rows_updated <> 1 then
    raise exception 'invitation is not pending or was already changed';
  end if;

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

create or replace function public.decline_team_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_invitation public.artist_member_invitations%rowtype;
  v_rows_updated integer;
begin
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if v_email = '' then
    raise exception 'not authenticated';
  end if;

  select *
  into v_invitation
  from public.artist_member_invitations
  where id = p_invitation_id
  for update;

  if not found then
    raise exception 'invitation not found';
  end if;

  if lower(v_invitation.invited_email) <> v_email then
    raise exception 'permission denied';
  end if;

  if v_invitation.status <> 'pending' then
    raise exception 'invitation is not pending (current status: %)', v_invitation.status;
  end if;

  update public.artist_member_invitations
  set status = 'declined',
      declined_at = now(),
      updated_at = now()
  where id = p_invitation_id
    and status = 'pending';

  get diagnostics v_rows_updated = row_count;
  if v_rows_updated <> 1 then
    raise exception 'invitation is not pending or was already changed';
  end if;

  return jsonb_build_object('result', 'declined');
end;
$$;

revoke execute on function public.cancel_team_invitation(uuid) from public, anon;
revoke execute on function public.accept_team_invitation(uuid) from public, anon;
revoke execute on function public.decline_team_invitation(uuid) from public, anon;

grant execute on function public.cancel_team_invitation(uuid) to authenticated;
grant execute on function public.accept_team_invitation(uuid) to authenticated;
grant execute on function public.decline_team_invitation(uuid) to authenticated;
