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
set search_path = ''
as $$
declare
  v_artist public.artists%rowtype;
  v_event public.events%rowtype;
  v_has_event_catalog boolean := false;
  v_has_visible_product boolean := false;
  v_requires_payment_setup boolean := false;
begin
  if not public.has_artist_role(p_artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;

  select * into v_artist
  from public.artists
  where id = p_artist_id
  for update;

  if not found then raise exception 'artist_not_found'; end if;
  if nullif(btrim(coalesce(v_artist.slug, '')), '') is null then raise exception 'artist_slug_required'; end if;
  if nullif(btrim(coalesce(v_artist.display_name, '')), '') is null then raise exception 'artist_display_name_required'; end if;
  if nullif(btrim(coalesce(v_artist.email, '')), '') is null then raise exception 'artist_contact_required'; end if;
  if p_event_id is null then raise exception 'event_required'; end if;

  select * into v_event
  from public.events e
  where e.id = p_event_id
    and e.artist_id = p_artist_id
  for update;

  if not found then raise exception 'event_not_found'; end if;
  if v_event.status <> 'Confirmed' or v_event.end_date < now() then raise exception 'event_not_customer_visible'; end if;
  if nullif(btrim(coalesce(v_event.event_timezone, '')), '') is null then raise exception 'event_timezone_required'; end if;
  if nullif(btrim(coalesce(v_event.location, v_event.location_name, '')), '') is null then raise exception 'event_location_required'; end if;
  if nullif(btrim(coalesce(v_event.booth_detail, v_event.booth_number, v_event.queueing_area, '')), '') is null then
    raise exception 'event_booth_or_queue_area_required';
  end if;

  select exists (
    select 1 from public.event_products ep where ep.event_id = p_event_id
  ) into v_has_event_catalog;

  if v_has_event_catalog then
    select exists (
      select 1
      from public.event_products ep
      join public.products p on p.id = ep.product_id
      where ep.event_id = p_event_id
        and ep.artist_id = p_artist_id
        and ep.is_enabled = true
        and p.artist_id = p_artist_id
        and p.deleted_at is null
        and p.status in ('enable', 'soldout')
    ) into v_has_visible_product;
  else
    select exists (
      select 1
      from public.products p
      where p.artist_id = p_artist_id
        and p.deleted_at is null
        and p.status in ('enable', 'soldout')
    ) into v_has_visible_product;
  end if;

  if not v_has_visible_product then raise exception 'customer_visible_product_required'; end if;

  v_requires_payment_setup := coalesce(v_event.preorder_enabled, false)
    or coalesce(v_event.postorder_enabled, false)
    or v_event.selling_mode in ('preorder', 'post_event');

  if v_requires_payment_setup then
    if nullif(btrim(coalesce(v_event.preorder_pickup_instructions, '')), '') is null then
      raise exception 'fulfillment_instructions_required';
    end if;
    if not exists (
      select 1
      from public.event_payment_methods epm
      where epm.event_id = p_event_id
        and epm.artist_id = p_artist_id
        and epm.is_enabled = true
        and nullif(btrim(coalesce(epm.promptpay_id, epm.account_number, epm.qr_image_url, epm.instructions, '')), '') is not null
    ) then
      raise exception 'payment_instructions_required';
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
  select v_artist.id, p_event_id, v_artist.slug, v_artist.is_public, v_artist.is_verified, v_artist.published_at;
end;
$$;

revoke all on function public.publish_artist_public_booth(uuid, uuid) from public, anon;
grant execute on function public.publish_artist_public_booth(uuid, uuid) to authenticated;
