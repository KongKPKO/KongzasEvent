alter table public.artists
  add column if not exists is_public boolean not null default false,
  add column if not exists is_verified boolean not null default false,
  add column if not exists published_at timestamptz;

update public.artists
set is_public = true,
    is_verified = true,
    published_at = coalesce(published_at, created_at, now())
where lower(coalesce(email, '')) = 'konglnwzas@gmail.com'
   or lower(coalesce(slug, '')) = 'konglnwzas';

create index if not exists artists_public_verified_slug_idx
  on public.artists (is_public, is_verified, slug)
  where is_public = true and is_verified = true;

drop policy if exists "artists_public_read" on public.artists;

create policy "artists_public_read"
  on public.artists
  for select
  to anon, authenticated
  using (
    (is_public = true and is_verified = true)
    or public.has_artist_role(id, array['owner', 'queue_only', 'queue_pos'])
    or public.is_platform_admin()
  );

drop policy if exists "events_public_read" on public.events;

create policy "events_public_read"
  on public.events
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.artists a
      where a.id = events.artist_id
        and a.is_public = true
        and a.is_verified = true
    )
  );

drop policy if exists "products_public_read" on public.products;

create policy "products_public_read"
  on public.products
  for select
  to anon, authenticated
  using (
    status in ('enable', 'soldout')
    and exists (
      select 1
      from public.artists a
      where a.id = products.artist_id
        and a.is_public = true
        and a.is_verified = true
    )
  );

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
    tiktok_url,
    is_public,
    is_verified,
    published_at
  )
  values (
    v_application.auth_user_id,
    v_application.desired_slug,
    v_application.creator_name,
    lower(v_application.email),
    nullif(v_application.facebook_url, ''),
    nullif(v_application.instagram_url, ''),
    nullif(v_application.x_url, ''),
    nullif(v_application.tiktok_url, ''),
    true,
    true,
    now()
  )
  on conflict (id) do update
  set slug = excluded.slug,
      display_name = excluded.display_name,
      email = excluded.email,
      facebook_url = excluded.facebook_url,
      ig_url = excluded.ig_url,
      x_url = excluded.x_url,
      tiktok_url = excluded.tiktok_url,
      is_public = true,
      is_verified = true,
      published_at = coalesce(public.artists.published_at, now()),
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

grant execute on function public.approve_creator_application(uuid, text) to authenticated;
