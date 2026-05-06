drop policy if exists "events_owner_read" on public.events;

create policy "events_owner_read"
  on public.events
  for select
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'queue_only', 'queue_pos']));
