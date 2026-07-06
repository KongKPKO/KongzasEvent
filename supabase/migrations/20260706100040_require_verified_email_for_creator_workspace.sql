create or replace function public.auto_create_creator_workspace_from_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
begin
  if new.auth_user_id is null then
    raise exception 'Creator signup requires an auth user';
  end if;

  if not exists (
    select 1
    from auth.users u
    where u.id = new.auth_user_id
      and u.email_confirmed_at is not null
  ) then
    raise exception 'Email must be confirmed before workspace creation';
  end if;

  if new.status not in ('pending', 'auto_approved') then
    raise exception 'Creator signup cannot start with status %', new.status;
  end if;

  if exists (
    select 1
    from public.artists a
    where lower(a.slug) = lower(new.desired_slug)
      and a.id <> new.auth_user_id
  ) then
    raise exception 'Desired URL slug is already taken';
  end if;

  if exists (
    select 1
    from public.creator_applications ca
    where lower(ca.desired_slug) = lower(new.desired_slug)
      and ca.status in ('pending', 'auto_approved', 'approved')
      and ca.auth_user_id <> new.auth_user_id
  ) then
    raise exception 'Desired URL slug is already taken';
  end if;

  insert into public.artists (
    id,
    slug,
    display_name,
    email,
    facebook_url,
    ig_url,
    x_url,
    tiktok_url,
    is_public,
    is_verified,
    published_at
  )
  values (
    new.auth_user_id,
    new.desired_slug,
    new.creator_name,
    lower(new.email),
    nullif(new.facebook_url, ''),
    nullif(new.instagram_url, ''),
    nullif(new.x_url, ''),
    nullif(new.tiktok_url, ''),
    false,
    true,
    null
  )
  on conflict (id) do update
  set slug = excluded.slug,
      display_name = excluded.display_name,
      email = excluded.email,
      facebook_url = excluded.facebook_url,
      ig_url = excluded.ig_url,
      x_url = excluded.x_url,
      tiktok_url = excluded.tiktok_url,
      is_verified = true,
      updated_at = now();

  select m.id
  into v_member_id
  from public.artist_members m
  where m.artist_id = new.auth_user_id
    and lower(m.member_email) = lower(new.email)
  limit 1;

  if v_member_id is null then
    insert into public.artist_members (
      artist_id,
      member_email,
      role,
      status,
      created_by
    )
    values (
      new.auth_user_id,
      lower(new.email),
      'owner',
      'active',
      new.auth_user_id
    );
  else
    update public.artist_members
    set role = 'owner',
        status = 'active',
        updated_at = now()
    where id = v_member_id;
  end if;

  new.status := 'auto_approved';
  new.reviewed_at := coalesce(new.reviewed_at, now());
  new.reviewed_by := null;
  new.review_note := 'Workspace auto-created after email verification.';

  return new;
end;
$$;

revoke all on function public.auto_create_creator_workspace_from_application() from public, anon, authenticated;

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
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

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

  if v_creator_name is null
    or v_contact_name is null
    or v_desired_slug is null
    or v_primary_social_url is null
    or v_application_note is null then
    raise exception 'Creator signup metadata is incomplete';
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

revoke all on function public.complete_verified_creator_signup() from public, anon, authenticated;
grant execute on function public.complete_verified_creator_signup() to authenticated;
