create table if not exists public.platform_admins (
  id uuid primary key default gen_random_uuid(),
  admin_email text not null unique,
  auth_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint platform_admins_email_format_chk check (admin_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

insert into public.platform_admins (admin_email)
values ('konglnwzas@gmail.com')
on conflict (admin_email) do nothing;

alter table public.platform_admins enable row level security;

drop policy if exists "platform_admins_self_read" on public.platform_admins;

create policy "platform_admins_self_read"
  on public.platform_admins
  for select
  to authenticated
  using (lower(admin_email) = lower(coalesce((auth.jwt() ->> 'email'), '')));

grant select on public.platform_admins to authenticated;

create or replace function public.is_platform_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if auth.uid() is null then
    return false;
  end if;

  v_email := lower(coalesce((auth.jwt() ->> 'email'), ''));
  if v_email = '' then
    return false;
  end if;

  return exists (
    select 1
    from public.platform_admins pa
    where lower(pa.admin_email) = v_email
      and (pa.auth_user_id is null or pa.auth_user_id = auth.uid())
  );
end;
$$;

grant execute on function public.is_platform_admin() to authenticated;

drop policy if exists "creator_applications_platform_admin_read" on public.creator_applications;
drop policy if exists "creator_applications_platform_admin_update" on public.creator_applications;

create policy "creator_applications_platform_admin_read"
  on public.creator_applications
  for select
  to authenticated
  using (public.is_platform_admin());

create policy "creator_applications_platform_admin_update"
  on public.creator_applications
  for update
  to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

grant update on public.creator_applications to authenticated;

create or replace function public.approve_creator_application(
  p_application_id uuid,
  p_review_note text default null
)
returns table (
  application_id uuid,
  artist_id uuid,
  email text,
  creator_name text,
  desired_slug text,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application public.creator_applications%rowtype;
  v_member_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can approve creator applications';
  end if;

  select *
  into v_application
  from public.creator_applications
  where id = p_application_id
  for update;

  if not found then
    raise exception 'Creator application not found';
  end if;

  if v_application.status <> 'pending' then
    raise exception 'Creator application is already %', v_application.status;
  end if;

  if v_application.auth_user_id is null then
    raise exception 'Creator application has no auth user';
  end if;

  if exists (
    select 1
    from public.artists a
    where lower(a.slug) = lower(v_application.desired_slug)
      and a.id <> v_application.auth_user_id
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
    tiktok_url
  )
  values (
    v_application.auth_user_id,
    v_application.desired_slug,
    v_application.creator_name,
    lower(v_application.email),
    nullif(v_application.facebook_url, ''),
    nullif(v_application.instagram_url, ''),
    nullif(v_application.x_url, ''),
    nullif(v_application.tiktok_url, '')
  )
  on conflict (id) do update
  set slug = excluded.slug,
      display_name = excluded.display_name,
      email = excluded.email,
      facebook_url = excluded.facebook_url,
      ig_url = excluded.ig_url,
      x_url = excluded.x_url,
      tiktok_url = excluded.tiktok_url,
      updated_at = now();

  select m.id
  into v_member_id
  from public.artist_members m
  where m.artist_id = v_application.auth_user_id
    and lower(m.member_email) = lower(v_application.email)
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
      v_application.auth_user_id,
      lower(v_application.email),
      'owner',
      'active',
      auth.uid()
    );
  else
    update public.artist_members
    set role = 'owner',
        status = 'active',
        updated_at = now()
    where id = v_member_id;
  end if;

  update public.creator_applications
  set status = 'approved',
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      review_note = nullif(trim(coalesce(p_review_note, '')), '')
  where id = v_application.id;

  return query
  select
    v_application.id,
    v_application.auth_user_id,
    lower(v_application.email),
    v_application.creator_name,
    v_application.desired_slug,
    'approved'::text;
end;
$$;

create or replace function public.reject_creator_application(
  p_application_id uuid,
  p_review_note text
)
returns table (
  application_id uuid,
  email text,
  creator_name text,
  desired_slug text,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application public.creator_applications%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can reject creator applications';
  end if;

  if nullif(trim(coalesce(p_review_note, '')), '') is null then
    raise exception 'Review note is required when rejecting an application';
  end if;

  select *
  into v_application
  from public.creator_applications
  where id = p_application_id
  for update;

  if not found then
    raise exception 'Creator application not found';
  end if;

  if v_application.status <> 'pending' then
    raise exception 'Creator application is already %', v_application.status;
  end if;

  update public.creator_applications
  set status = 'rejected',
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      review_note = trim(p_review_note)
  where id = v_application.id;

  return query
  select
    v_application.id,
    lower(v_application.email),
    v_application.creator_name,
    v_application.desired_slug,
    'rejected'::text;
end;
$$;

grant execute on function public.approve_creator_application(uuid, text) to authenticated;
grant execute on function public.reject_creator_application(uuid, text) to authenticated;
