create unique index if not exists artists_slug_lower_uidx
  on public.artists (lower(slug));

create or replace function public.is_creator_slug_available(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select lower(trim(coalesce(p_slug, ''))) as slug
  )
  select
    slug ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'
    and slug <> all (array['admin', 'settings', 'login', 'menu'])
    and not exists (
      select 1
      from public.artists a
      where lower(a.slug) = normalized.slug
    )
    and not exists (
      select 1
      from public.creator_applications ca
      where lower(ca.desired_slug) = normalized.slug
        and ca.status in ('pending', 'auto_approved', 'approved')
    )
  from normalized;
$$;

revoke all on function public.is_creator_slug_available(text) from public, anon, authenticated;
grant execute on function public.is_creator_slug_available(text) to anon, authenticated;

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

  if new.status not in ('pending', 'auto_approved') then
    raise exception 'Creator signup cannot start with status %', new.status;
  end if;

  if exists (
    select 1
    from public.artists a
    where a.id = new.auth_user_id
  ) then
    raise exception 'Workspace already exists for this email';
  end if;

  if exists (
    select 1
    from public.artists a
    where lower(a.slug) = lower(new.desired_slug)
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
  );

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
  new.review_note := 'Workspace auto-created during signup.';

  return new;
end;
$$;

revoke all on function public.auto_create_creator_workspace_from_application() from public, anon, authenticated;
