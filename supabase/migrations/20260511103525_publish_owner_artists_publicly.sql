drop policy if exists "artists_public_read" on public.artists;

create policy "artists_public_read"
  on public.artists
  for select
  to anon, authenticated
  using (
    (is_public = true and is_verified = true and published_at is not null)
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
        and a.published_at is not null
    )
    and events.status in ('Confirmed', 'Cancelled')
    and events.end_date >= now()
    or public.has_artist_role(artist_id, array['owner', 'manager', 'seller', 'queue_staff'])
    or public.is_platform_admin()
  );

drop policy if exists "products_public_read" on public.products;

create policy "products_public_read"
  on public.products
  for select
  to anon, authenticated
  using (
    deleted_at is null
    and status in ('enable', 'soldout')
    and exists (
      select 1
      from public.artists a
      where a.id = products.artist_id
        and a.is_public = true
        and a.is_verified = true
        and a.published_at is not null
    )
  );

create or replace function public.publish_artist_public_booth(
  p_artist_id uuid,
  p_event_id uuid default null
)
returns table (
  artist_id uuid,
  event_id uuid,
  slug text,
  is_public boolean,
  is_verified boolean,
  published_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_artist public.artists%rowtype;
  v_event public.events%rowtype;
begin
  if not public.has_artist_role(p_artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;

  select *
  into v_artist
  from public.artists
  where id = p_artist_id
  for update;

  if not found then
    raise exception 'artist_not_found';
  end if;

  if nullif(trim(coalesce(v_artist.slug, '')), '') is null then
    raise exception 'artist_slug_required';
  end if;

  if p_event_id is not null then
    select *
    into v_event
    from public.events e
    where e.id = p_event_id
      and e.artist_id = p_artist_id
    for update;

    if not found then
      raise exception 'event_not_found';
    end if;

    if v_event.status <> 'Confirmed' or v_event.end_date < now() then
      raise exception 'event_not_customer_visible';
    end if;
  end if;

  update public.artists
  set is_public = true,
      is_verified = true,
      published_at = coalesce(public.artists.published_at, now()),
      updated_at = now()
  where id = p_artist_id
  returning * into v_artist;

  return query
  select
    v_artist.id,
    p_event_id,
    v_artist.slug,
    v_artist.is_public,
    v_artist.is_verified,
    v_artist.published_at;
end;
$$;

grant execute on function public.publish_artist_public_booth(uuid, uuid) to authenticated;
