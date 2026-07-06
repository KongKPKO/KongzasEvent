alter table public.creator_applications
  drop constraint if exists creator_applications_status_check;

alter table public.creator_applications
  add constraint creator_applications_status_check
  check (status in ('pending', 'auto_approved', 'approved', 'rejected'));

alter table public.creator_applications
  drop constraint if exists creator_applications_slug_format_chk;

alter table public.creator_applications
  add constraint creator_applications_slug_format_chk
  check (
    desired_slug ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'
    and desired_slug <> all (array['admin', 'settings', 'login', 'menu'])
  );

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
    where lower(a.slug) = lower(new.desired_slug)
      and a.id <> new.auth_user_id
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
  new.review_note := 'Workspace auto-created during signup.';

  return new;
end;
$$;

revoke all on function public.auto_create_creator_workspace_from_application() from public, anon, authenticated;

drop trigger if exists trg_creator_applications_auto_workspace on public.creator_applications;

create trigger trg_creator_applications_auto_workspace
  before insert on public.creator_applications
  for each row
  execute function public.auto_create_creator_workspace_from_application();

drop policy if exists "creator_applications_self_insert" on public.creator_applications;
drop policy if exists "creator_applications_public_insert" on public.creator_applications;

create policy "creator_applications_self_insert"
  on public.creator_applications
  for insert
  to authenticated
  with check (
    auth.uid() = auth_user_id
    and status = 'auto_approved'
    and reviewed_by is null
  );

create policy "creator_applications_public_insert"
  on public.creator_applications
  for insert
  to anon
  with check (
    auth_user_id is not null
    and status = 'auto_approved'
    and reviewed_by is null
  );
