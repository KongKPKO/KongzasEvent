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
    and events.status in ('Confirmed', 'Cancelled')
    and events.end_date >= now()
    or public.has_artist_role(artist_id, array['owner', 'manager', 'seller', 'queue_staff'])
    or public.is_platform_admin()
  );
