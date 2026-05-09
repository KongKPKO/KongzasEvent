-- supabase/migrations/20260509220000_team_invitations.sql

-- ─── Table ────────────────────────────────────────────────────────────────────

create table public.artist_member_invitations (
  id            uuid        primary key default gen_random_uuid(),
  artist_id     uuid        not null references public.artists(id) on delete cascade,
  invited_email text        not null,
  role          text        not null check (role in ('manager', 'seller', 'queue_staff')),
  invited_by    uuid        references auth.users(id) on delete set null,
  status        text        not null default 'pending'
                            check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  invited_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  declined_at   timestamptz,
  cancelled_at  timestamptz,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Prevents duplicate pending invites; allows clean re-invite after cancel
create unique index artist_member_invitations_pending_uidx
  on public.artist_member_invitations (artist_id, lower(invited_email))
  where status = 'pending';

-- Fast lookup when a user logs in and checks for their invitations
create index artist_member_invitations_email_idx
  on public.artist_member_invitations (lower(invited_email));

-- Efficient filtering by artist + status for dashboard queries
create index artist_member_invitations_artist_status_idx
  on public.artist_member_invitations (artist_id, status);

-- ─── updated_at trigger ───────────────────────────────────────────────────────

-- Reuse the existing set_updated_at_timestamp() function
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_artist_member_invitations_updated_at'
  ) then
    create trigger trg_artist_member_invitations_updated_at
      before update on public.artist_member_invitations
      for each row execute function public.set_updated_at_timestamp();
  end if;
end $$;

-- ─── RLS ──────────────────────────────────────────────────────────────────────

-- Enable RLS; all access is through security-definer RPCs (no direct client writes)
alter table public.artist_member_invitations enable row level security;

-- ─── RPC: invite_team_member ──────────────────────────────────────────────────
-- Called by owner/manager from ManageTeam.
-- Returns: { result, invitation_id? }
-- result values: member_added | invitation_sent | already_member | already_invited

create or replace function public.invite_team_member(
  p_artist_id uuid,
  p_email     text,
  p_role      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email          text;
  v_invitation_id  uuid;
  v_rows_inserted  int;
begin
  -- Permission check
  if not public.has_artist_role(p_artist_id, array['owner', 'manager']) then
    raise exception 'permission denied';
  end if;

  -- Normalize
  v_email := lower(trim(p_email));

  -- Validate role
  if p_role not in ('manager', 'seller', 'queue_staff') then
    raise exception 'invalid role: %', p_role;
  end if;

  -- Already an active member?
  if exists (
    select 1 from public.artist_members
    where artist_id = p_artist_id
      and lower(member_email) = v_email
      and status = 'active'
  ) then
    return jsonb_build_object('result', 'already_member');
  end if;

  -- Already a pending invitation?
  if exists (
    select 1 from public.artist_member_invitations
    where artist_id = p_artist_id
      and lower(invited_email) = v_email
      and status = 'pending'
  ) then
    return jsonb_build_object('result', 'already_invited');
  end if;

  -- User exists in auth? → add as active member immediately
  if exists (select 1 from auth.users where lower(email) = v_email) then
    insert into public.artist_members (artist_id, member_email, role, status, created_by)
    values (p_artist_id, v_email, p_role, 'active', auth.uid())
    on conflict do nothing;
    return jsonb_build_object('result', 'member_added');
  end if;

  -- User does not exist → create pending invitation (handle race via ON CONFLICT)
  insert into public.artist_member_invitations
    (artist_id, invited_email, role, invited_by)
  values
    (p_artist_id, v_email, p_role, auth.uid())
  on conflict do nothing
  returning id into v_invitation_id;

  get diagnostics v_rows_inserted = row_count;

  if v_rows_inserted = 0 then
    -- Race condition: another concurrent call already created it
    return jsonb_build_object('result', 'already_invited');
  end if;

  return jsonb_build_object('result', 'invitation_sent', 'invitation_id', v_invitation_id);
end;
$$;


-- ─── RPC: list_team_invitations ───────────────────────────────────────────────
-- Returns pending invitations for an artist. Owner/manager only.

create or replace function public.list_team_invitations(p_artist_id uuid)
returns table(
  id            uuid,
  invited_email text,
  role          text,
  invited_at    timestamptz,
  expires_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_artist_role(p_artist_id, array['owner', 'manager']) then
    raise exception 'permission denied';
  end if;

  return query
    select i.id, i.invited_email, i.role, i.invited_at, i.expires_at
    from public.artist_member_invitations i
    where i.artist_id = p_artist_id
      and i.status = 'pending'
    order by i.invited_at asc;
end;
$$;


-- ─── RPC: cancel_team_invitation ─────────────────────────────────────────────
-- Owner/manager cancels a pending invitation.

create or replace function public.cancel_team_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_artist_id uuid;
  v_status    text;
begin
  select artist_id, status
  into v_artist_id, v_status
  from public.artist_member_invitations
  where id = p_invitation_id;

  if not found then
    raise exception 'invitation not found';
  end if;

  if not public.has_artist_role(v_artist_id, array['owner', 'manager']) then
    raise exception 'permission denied';
  end if;

  if v_status != 'pending' then
    raise exception 'invitation is not pending (current status: %)', v_status;
  end if;

  update public.artist_member_invitations
  set status       = 'cancelled',
      cancelled_at = now(),
      updated_at   = now()
  where id = p_invitation_id;

  return jsonb_build_object('result', 'cancelled');
end;
$$;


-- ─── RPC: list_my_pending_invitations ─────────────────────────────────────────
-- Read-only. Returns pending, non-expired invitations for the authenticated user's email.

create or replace function public.list_my_pending_invitations()
returns table(
  id          uuid,
  artist_id   uuid,
  artist_name text,
  role        text,
  invited_at  timestamptz,
  expires_at  timestamptz
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
      coalesce(a.creator_name, 'Unknown Booth') as artist_name,
      i.role,
      i.invited_at,
      i.expires_at
    from public.artist_member_invitations i
    join public.artists a on a.id = i.artist_id
    where lower(i.invited_email) = v_email
      and i.status = 'pending'
      and (i.expires_at is null or i.expires_at > now())
    order by i.invited_at asc;
end;
$$;


-- ─── RPC: accept_team_invitation ─────────────────────────────────────────────
-- Called when invitee explicitly clicks Accept.
-- Returns: { result: 'accepted' | 'accepted_existing_member' }

create or replace function public.accept_team_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email         text;
  v_invitation    record;
  v_rows_inserted int;
begin
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if v_email = '' then
    raise exception 'not authenticated';
  end if;

  select * into v_invitation
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

  -- Insert active member; silent no-op if already exists
  insert into public.artist_members (artist_id, member_email, role, status, created_by)
  values (v_invitation.artist_id, v_email, v_invitation.role, 'active', v_invitation.invited_by)
  on conflict (artist_id, lower(member_email)) do nothing;

  get diagnostics v_rows_inserted = row_count;

  -- Mark invitation accepted regardless of whether member row was new
  update public.artist_member_invitations
  set status      = 'accepted',
      accepted_at = now(),
      updated_at  = now()
  where id = p_invitation_id;

  if v_rows_inserted = 0 then
    return jsonb_build_object('result', 'accepted_existing_member');
  end if;

  return jsonb_build_object('result', 'accepted');
end;
$$;


-- ─── RPC: decline_team_invitation ────────────────────────────────────────────
-- Called only from /invitations settings page (not the login banner).

create or replace function public.decline_team_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email      text;
  v_invitation record;
begin
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if v_email = '' then
    raise exception 'not authenticated';
  end if;

  select * into v_invitation
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

  update public.artist_member_invitations
  set status      = 'declined',
      declined_at = now(),
      updated_at  = now()
  where id = p_invitation_id;

  return jsonb_build_object('result', 'declined');
end;
$$;
