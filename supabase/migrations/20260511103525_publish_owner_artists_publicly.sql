-- Legacy workspaces existed before creator publication flags. If an artist has
-- an active owner membership and a slug, the Owner Workspace share link is a
-- public booth URL and must resolve for anon users.
update public.artists a
set is_public = true,
    is_verified = true,
    published_at = coalesce(a.published_at, a.created_at, now()),
    updated_at = now()
where coalesce(a.slug, '') <> ''
  and exists (
    select 1
    from public.artist_members m
    where m.artist_id = a.id
      and m.status = 'active'
      and public.normalize_artist_role(m.role) = 'owner'
  );

drop policy if exists "artists_public_read" on public.artists;

create policy "artists_public_read"
  on public.artists
  for select
  to anon, authenticated
  using (
    (is_public = true and is_verified = true)
    or public.has_artist_role(id, array['owner', 'manager', 'seller', 'queue_staff'])
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
    or public.has_artist_role(artist_id, array['owner', 'manager', 'seller', 'queue_staff'])
    or public.is_platform_admin()
  );
