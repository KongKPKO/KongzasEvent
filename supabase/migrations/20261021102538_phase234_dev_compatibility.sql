-- Reapply DEV behavior that predates the Phase 1-4 branch while preserving the
-- live per-account management boundary introduced by Phase 3.

create or replace function public.has_shipping_access(p_artist_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and private.account_management_allowed()
    and (
      public.has_artist_role(p_artist_id, array['owner','manager'])
      or exists (
        select 1
        from public.artist_members m
        where m.artist_id = p_artist_id
          and m.status = 'active'
          and public.normalize_artist_role(m.role) = 'seller'
          and m.can_manage_shipping
          and lower(m.member_email) = lower(coalesce(auth.jwt()->>'email', ''))
      )
    );
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
  v_role text;
  v_rows_updated integer;
begin
  if not private.account_management_allowed() then
    raise exception 'account management suspended' using errcode = '42501';
  end if;

  select artist_id, status, role
  into v_artist_id, v_status, v_role
  from public.artist_member_invitations
  where id = p_invitation_id
  for update;

  if not found then
    raise exception 'invitation not found';
  end if;

  if not (
    public.has_artist_role(v_artist_id, array['owner'])
    or (
      public.normalize_artist_role(v_role) in ('seller', 'queue_staff')
      and public.has_artist_role(v_artist_id, array['manager'])
    )
  ) then
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
  if not private.account_management_allowed() then
    raise exception 'account management suspended' using errcode = '42501';
  end if;

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

  if v_invitation.expires_at is not null
    and v_invitation.expires_at <= clock_timestamp() then
    raise exception 'invitation has expired';
  end if;

  -- Serialize acceptance with membership removal or role changes, then verify
  -- that the original issuer can still grant this exact role.
  perform 1
  from public.artists
  where id = v_invitation.artist_id
  for update;

  if not (
    v_invitation.invited_by = v_invitation.artist_id
    or exists (
      select 1
      from public.artist_members m
      join auth.users u on lower(u.email) = lower(m.member_email)
      where u.id = v_invitation.invited_by
        and m.artist_id = v_invitation.artist_id
        and m.status = 'active'
        and (
          public.normalize_artist_role(m.role) = 'owner'
          or (
            public.normalize_artist_role(m.role) = 'manager'
            and public.normalize_artist_role(v_invitation.role) in ('seller', 'queue_staff')
          )
        )
    )
  ) then
    raise exception 'inviter no longer authorized';
  end if;

  if exists (
    select 1
    from public.artist_members
    where artist_id = v_invitation.artist_id
      and lower(member_email) = v_email
      and (
        status = 'active'
        or public.normalize_artist_role(role) in ('owner', 'manager')
      )
  ) then
    raise exception 'membership changed; request a new invitation';
  end if;

  insert into public.artist_members (artist_id, member_email, role, status, created_by)
  values (
    v_invitation.artist_id,
    v_email,
    public.normalize_artist_role(v_invitation.role),
    'active',
    v_invitation.invited_by
  )
  on conflict (artist_id, lower(member_email))
  do update set
    role = excluded.role,
    status = 'active',
    updated_at = now()
  returning id into v_member_id;

  if public.normalize_artist_role(v_invitation.role) in ('seller', 'queue_staff') then
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
    when public.normalize_artist_role(v_invitation.role) = 'seller'
      and v_first_event_id is not null
      then '/live/pos?eventId=' || v_first_event_id::text
    when public.normalize_artist_role(v_invitation.role) = 'queue_staff'
      and v_first_event_id is not null
      then '/live/queue?eventId=' || v_first_event_id::text
    else '/manage-events'
  end;

  return jsonb_build_object(
    'result', 'accepted',
    'role', public.normalize_artist_role(v_invitation.role),
    'event_id', v_first_event_id,
    'redirect_path', v_redirect_path
  );
end;
$$;

create or replace function public.complete_verified_creator_signup()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed_at timestamptz;
  v_meta jsonb;
  v_application_id uuid;
  v_creator_name text;
  v_contact_name text;
  v_desired_slug text;
  v_primary_social_url text;
  v_application_note text;
  v_seller_type text;
begin
  if not private.account_management_allowed() then
    raise exception 'account management suspended' using errcode = '42501';
  end if;

  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  select lower(u.email), u.email_confirmed_at, coalesce(u.raw_user_meta_data, '{}'::jsonb)
  into v_email, v_confirmed_at, v_meta
  from auth.users u
  where u.id = v_uid;

  if v_email is null then
    raise exception 'Authenticated user not found';
  end if;

  if exists (select 1 from public.artists a where a.id = v_uid) then
    return jsonb_build_object('status', 'exists');
  end if;

  if coalesce(v_meta ->> 'creator_signup', '') <> 'self_serve' then
    return jsonb_build_object('status', 'not_pending');
  end if;

  if v_confirmed_at is null then
    return jsonb_build_object('status', 'email_unconfirmed');
  end if;

  v_creator_name := nullif(trim(coalesce(v_meta ->> 'creator_name', '')), '');
  v_contact_name := nullif(trim(coalesce(v_meta ->> 'contact_name', '')), '');
  v_desired_slug := lower(nullif(trim(coalesce(v_meta ->> 'desired_slug', '')), ''));
  v_primary_social_url := nullif(trim(coalesce(v_meta ->> 'primary_social_url', '')), '');
  v_application_note := nullif(trim(coalesce(v_meta ->> 'application_note', '')), '');
  v_seller_type := coalesce(nullif(trim(coalesce(v_meta ->> 'seller_type', '')), ''), 'creator');

  if v_creator_name is null
    or v_contact_name is null
    or v_desired_slug is null
    or v_primary_social_url is null
    or v_application_note is null then
    raise exception 'Creator signup metadata is incomplete';
  end if;

  if v_seller_type not in ('creator', 'cosplayer', 'shop') then
    raise exception 'invalid_seller_type';
  end if;

  if v_desired_slug !~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'
    or v_desired_slug = any (array['admin', 'settings', 'login', 'menu']) then
    raise exception 'Desired URL slug is invalid';
  end if;

  if exists (
    select 1
    from public.artists a
    where lower(a.slug) = v_desired_slug
  ) or exists (
    select 1
    from public.creator_applications ca
    where lower(ca.desired_slug) = v_desired_slug
      and ca.status in ('pending', 'auto_approved', 'approved')
      and ca.auth_user_id <> v_uid
  ) then
    raise exception 'Desired URL slug is already taken';
  end if;

  insert into public.creator_applications (
    auth_user_id,
    status,
    email,
    contact_name,
    creator_name,
    desired_slug,
    seller_type,
    primary_social_url,
    website_url,
    instagram_url,
    x_url,
    facebook_url,
    tiktok_url,
    application_note
  )
  values (
    v_uid,
    'auto_approved',
    v_email,
    v_contact_name,
    v_creator_name,
    v_desired_slug,
    v_seller_type,
    v_primary_social_url,
    nullif(trim(coalesce(v_meta ->> 'website_url', '')), ''),
    nullif(trim(coalesce(v_meta ->> 'instagram_url', '')), ''),
    nullif(trim(coalesce(v_meta ->> 'x_url', '')), ''),
    nullif(trim(coalesce(v_meta ->> 'facebook_url', '')), ''),
    nullif(trim(coalesce(v_meta ->> 'tiktok_url', '')), ''),
    v_application_note
  )
  returning id into v_application_id;

  return jsonb_build_object(
    'status', 'created',
    'application_id', v_application_id,
    'artist_id', v_uid
  );
end;
$$;

notify pgrst, 'reload schema';
