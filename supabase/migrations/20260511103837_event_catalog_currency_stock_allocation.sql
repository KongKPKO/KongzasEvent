alter table public.event_products
  add column if not exists currency_override text;

drop policy if exists "event_products_public_read" on public.event_products;

create policy "event_products_public_read"
  on public.event_products
  for select
  to anon, authenticated
  using (
    is_enabled = true
    and exists (
      select 1
      from public.events e
      join public.artists a on a.id = e.artist_id
      where e.id = event_products.event_id
        and e.artist_id = event_products.artist_id
        and e.status in ('Confirmed', 'Cancelled')
        and e.end_date >= now()
        and a.is_public = true
        and a.is_verified = true
        and a.published_at is not null
    )
  );

create or replace function public.enforce_event_product_allocation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_product record;
  v_allocated integer;
  v_requested integer;
  v_available integer;
begin
  select id, stock_total, stock_reserved, stock_sold, is_unlimited, currency
  into v_product
  from public.products
  where id = new.product_id
  for update;

  if v_product.id is null then
    raise exception 'product_not_found';
  end if;

  if nullif(trim(coalesce(new.currency_override, '')), '') is null then
    new.currency_override := null;
  else
    new.currency_override := upper(trim(new.currency_override));
  end if;

  if coalesce(v_product.is_unlimited, true) then
    return new;
  end if;

  if not coalesce(new.is_enabled, true) then
    return new;
  end if;

  if coalesce(new.is_unlimited, false) then
    raise exception 'event_stock_exceeds_catalog_stock';
  end if;

  v_requested := coalesce(new.stock_total, 0);

  if v_requested < coalesce(new.stock_reserved, 0) + coalesce(new.stock_sold, 0) then
    raise exception 'event_stock_below_used_stock';
  end if;

  select coalesce(sum(coalesce(ep.stock_total, 0)), 0)
  into v_allocated
  from public.event_products ep
  where ep.product_id = new.product_id
    and ep.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and not (ep.event_id = new.event_id and ep.product_id = new.product_id)
    and ep.is_enabled = true
    and ep.is_unlimited = false;

  v_available := greatest(
    coalesce(v_product.stock_total, 0)
      - coalesce(v_product.stock_reserved, 0)
      - coalesce(v_product.stock_sold, 0)
      - v_allocated,
    0
  );

  if v_requested > v_available then
    raise exception 'event_stock_exceeds_catalog_stock';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_event_products_allocation on public.event_products;

create trigger trg_event_products_allocation
  before insert or update on public.event_products
  for each row
  execute function public.enforce_event_product_allocation();

drop function if exists public.list_event_products(uuid);

create function public.list_event_products(p_event_id uuid)
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
  currency_override text,
  event_catalog_enabled boolean,
  event_catalog_mode boolean
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
  select e.*, a.is_public, a.is_verified, a.published_at
  into v_event
  from public.events e
  join public.artists a on a.id = e.artist_id
  where e.id = p_event_id;

  if v_event.id is null then
    raise exception 'event_not_found';
  end if;

  v_allowed :=
    (
      coalesce(v_event.is_public, false) = true
      and coalesce(v_event.is_verified, false) = true
      and v_event.published_at is not null
      and v_event.status in ('Confirmed', 'Cancelled')
      and v_event.end_date >= now()
    )
    or public.has_artist_role(v_event.artist_id, array['owner', 'manager', 'seller', 'queue_staff'])
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
      coalesce(ep.currency_override, p.currency, 'THB') as currency,
      case when ep.is_unlimited then null else ep.stock_total end as stock_total,
      coalesce(ep.stock_reserved, 0) as stock_reserved,
      coalesce(ep.stock_sold, 0) as stock_sold,
      ep.is_unlimited,
      p.deleted_at,
      ep.id as event_product_id,
      ep.event_id,
      ep.price_override,
      ep.currency_override,
      ep.is_enabled as event_catalog_enabled,
      true as event_catalog_mode
    from public.event_products ep
    join public.products p on p.id = ep.product_id
    where ep.event_id = p_event_id
      and ep.artist_id = v_event.artist_id
      and ep.is_enabled = true
      and p.artist_id = v_event.artist_id
      and p.deleted_at is null
      and p.status in ('enable', 'soldout')
    order by p.name;
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
    coalesce(p.currency, 'THB') as currency,
    p.stock_total,
    coalesce(p.stock_reserved, 0) as stock_reserved,
    coalesce(p.stock_sold, 0) as stock_sold,
    coalesce(p.is_unlimited, true) as is_unlimited,
    p.deleted_at,
    null::uuid as event_product_id,
    p_event_id as event_id,
    null::numeric as price_override,
    null::text as currency_override,
    true as event_catalog_enabled,
    false as event_catalog_mode
  from public.products p
  where p.artist_id = v_event.artist_id
    and p.deleted_at is null
    and p.status in ('enable', 'soldout')
  order by p.name;
end;
$$;

grant execute on function public.list_event_products(uuid) to anon, authenticated;

create or replace function public.apply_event_product_order_item_currency()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_currency text;
begin
  if new.event_product_id is null then
    return new;
  end if;

  select nullif(trim(currency_override), '')
  into v_currency
  from public.event_products
  where id = new.event_product_id;

  if v_currency is not null then
    new.currency := v_currency;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_order_items_event_currency on public.order_items;

create trigger trg_order_items_event_currency
  before insert or update on public.order_items
  for each row
  execute function public.apply_event_product_order_item_currency();

create or replace function public.sync_order_currency_from_items()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_currency text;
  v_distinct_count integer;
begin
  select oi.currency
  into v_currency
  from public.order_items oi
  where oi.order_id = coalesce(new.order_id, old.order_id)
  order by oi.id
  limit 1;

  select count(distinct oi.currency)
  into v_distinct_count
  from public.order_items oi
  where oi.order_id = coalesce(new.order_id, old.order_id);

  if v_distinct_count > 1 then
    raise exception 'mixed_currency_not_allowed';
  end if;

  if v_currency is not null then
    update public.orders
    set currency = v_currency
    where id = coalesce(new.order_id, old.order_id)
      and currency is distinct from v_currency;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_sync_item_currency on public.orders;
drop trigger if exists trg_order_items_sync_order_currency on public.order_items;

create trigger trg_order_items_sync_order_currency
  after insert or update or delete on public.order_items
  for each row
  execute function public.sync_order_currency_from_items();

create or replace function public.sync_order_currency_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_currency text;
  v_distinct_count integer;
begin
  select oi.currency
  into v_currency
  from public.order_items oi
  where oi.order_id = new.id
  order by oi.id
  limit 1;

  select count(distinct oi.currency)
  into v_distinct_count
  from public.order_items oi
  where oi.order_id = new.id;

  if v_distinct_count > 1 then
    raise exception 'mixed_currency_not_allowed';
  end if;

  if v_currency is not null then
    new.currency := v_currency;
  end if;

  return new;
end;
$$;

create trigger trg_orders_sync_item_currency
  before update on public.orders
  for each row
  execute function public.sync_order_currency_before_update();
