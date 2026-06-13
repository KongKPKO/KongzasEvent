alter table public.products
  add column if not exists variant_group_name text,
  add column if not exists variant_name text,
  add column if not exists variant_sort_order integer not null default 0;

update public.products
set
  variant_group_name = nullif(btrim(variant_group_name), ''),
  variant_name = nullif(btrim(variant_name), ''),
  variant_sort_order = coalesce(variant_sort_order, 0);

create index if not exists idx_products_variant_group
  on public.products (artist_id, variant_group_name, variant_sort_order, name)
  where variant_group_name is not null and deleted_at is null;

drop function if exists public.list_event_products(uuid);

create or replace function public.list_event_products(p_event_id uuid)
returns table (
  id uuid,
  artist_id uuid,
  name text,
  price numeric,
  image_url text,
  description text,
  category text,
  tags text[],
  status text,
  currency text,
  stock_total integer,
  stock_reserved integer,
  stock_sold integer,
  is_unlimited boolean,
  deleted_at timestamptz,
  event_product_id uuid,
  event_id uuid,
  price_override numeric,
  event_catalog_enabled boolean,
  event_catalog_mode boolean,
  variant_group_name text,
  variant_name text,
  variant_sort_order integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_has_catalog boolean := false;
  v_allowed boolean := false;
begin
  select e.*, a.is_public, a.is_verified
  into v_event
  from public.events e
  join public.artists a on a.id = e.artist_id
  where e.id = p_event_id;

  if v_event.id is null then
    raise exception 'event_not_found';
  end if;

  v_allowed :=
    (coalesce(v_event.is_public, false) = true and coalesce(v_event.is_verified, false) = true)
    or public.has_artist_role(v_event.artist_id, array['owner', 'queue_pos', 'queue_only'])
    or public.is_platform_admin();

  if not v_allowed then
    raise exception 'forbidden';
  end if;

  select exists (
    select 1
    from public.event_products ep
    where ep.event_id = p_event_id
  ) into v_has_catalog;

  if v_has_catalog then
    return query
    select
      p.id,
      p.artist_id,
      p.name,
      coalesce(ep.price_override, p.price) as price,
      p.image_url,
      p.description,
      p.category,
      coalesce(p.tags, '{}'::text[]) as tags,
      p.status,
      coalesce(v_event.currency_override, p.currency, 'THB') as currency,
      case when ep.is_unlimited then null else ep.stock_total end as stock_total,
      coalesce(ep.stock_reserved, 0) as stock_reserved,
      coalesce(ep.stock_sold, 0) as stock_sold,
      ep.is_unlimited,
      p.deleted_at,
      ep.id as event_product_id,
      ep.event_id,
      ep.price_override,
      ep.is_enabled as event_catalog_enabled,
      true as event_catalog_mode,
      nullif(btrim(p.variant_group_name), '') as variant_group_name,
      nullif(btrim(p.variant_name), '') as variant_name,
      coalesce(p.variant_sort_order, 0) as variant_sort_order
    from public.event_products ep
    join public.products p on p.id = ep.product_id
    where ep.event_id = p_event_id
      and ep.artist_id = v_event.artist_id
      and ep.is_enabled = true
      and p.artist_id = v_event.artist_id
      and p.deleted_at is null
      and p.status in ('enable', 'soldout')
    order by nullif(btrim(p.variant_group_name), '') nulls last, coalesce(p.variant_sort_order, 0), p.name;
    return;
  end if;

  return query
  select
    p.id,
    p.artist_id,
    p.name,
    p.price,
    p.image_url,
    p.description,
    p.category,
    coalesce(p.tags, '{}'::text[]) as tags,
    p.status,
    coalesce(v_event.currency_override, p.currency, 'THB') as currency,
    p.stock_total,
    coalesce(p.stock_reserved, 0) as stock_reserved,
    coalesce(p.stock_sold, 0) as stock_sold,
    coalesce(p.is_unlimited, true) as is_unlimited,
    p.deleted_at,
    null::uuid as event_product_id,
    p_event_id as event_id,
    null::numeric as price_override,
    true as event_catalog_enabled,
    false as event_catalog_mode,
    nullif(btrim(p.variant_group_name), '') as variant_group_name,
    nullif(btrim(p.variant_name), '') as variant_name,
    coalesce(p.variant_sort_order, 0) as variant_sort_order
  from public.products p
  where p.artist_id = v_event.artist_id
    and p.deleted_at is null
    and p.status in ('enable', 'soldout')
  order by nullif(btrim(p.variant_group_name), '') nulls last, coalesce(p.variant_sort_order, 0), p.name;
end;
$$;

grant execute on function public.list_event_products(uuid) to anon, authenticated;
