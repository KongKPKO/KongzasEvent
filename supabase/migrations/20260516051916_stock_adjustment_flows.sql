create or replace function public.list_product_stock_summaries(p_artist_id uuid)
returns table (
  product_id uuid,
  on_hand integer,
  allocated integer,
  available integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_artist_role(p_artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;

  return query
    with active_allocations as (
      select
        ep.product_id,
        coalesce(sum(greatest(coalesce(ep.stock_total, 0) - coalesce(ep.stock_sold, 0), 0)), 0)::integer as allocated
      from public.event_products ep
      join public.events e on e.id = ep.event_id
      where ep.artist_id = p_artist_id
        and ep.is_enabled = true
        and ep.is_unlimited = false
        and e.status in ('Confirmed', 'confirmed')
        and e.end_date >= now()
      group by ep.product_id
    )
    select
      p.id,
      coalesce(p.stock_total, 0)::integer as on_hand,
      coalesce(a.allocated, 0)::integer as allocated,
      greatest(
        coalesce(p.stock_total, 0)
          - coalesce(p.stock_reserved, 0)
          - coalesce(p.stock_sold, 0)
          - coalesce(a.allocated, 0),
        0
      )::integer as available
    from public.products p
    left join active_allocations a on a.product_id = p.id
    where p.artist_id = p_artist_id
      and p.deleted_at is null
      and coalesce(p.is_unlimited, true) = false;
end;
$$;

revoke execute on function public.list_product_stock_summaries(uuid) from public, anon;
grant execute on function public.list_product_stock_summaries(uuid) to authenticated;

create or replace function public.add_catalog_stock(
  p_product_id uuid,
  p_quantity integer,
  p_reason text default null
)
returns table (
  product_id uuid,
  on_hand integer,
  allocated integer,
  available integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product record;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'invalid_stock_quantity';
  end if;

  select p.id, p.artist_id, coalesce(p.is_unlimited, true) as is_unlimited
  into v_product
  from public.products p
  where p.id = p_product_id
    and p.deleted_at is null
  for update;

  if v_product.id is null then
    raise exception 'product_not_found';
  end if;

  if not public.has_artist_role(v_product.artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;

  if v_product.is_unlimited then
    raise exception 'unlimited_product_stock_not_adjustable';
  end if;

  update public.products
  set stock_total = coalesce(stock_total, 0) + p_quantity
  where id = p_product_id;

  return query
    select s.*
    from public.list_product_stock_summaries(v_product.artist_id) s
    where s.product_id = p_product_id;
end;
$$;

revoke execute on function public.add_catalog_stock(uuid, integer, text) from public, anon;
grant execute on function public.add_catalog_stock(uuid, integer, text) to authenticated;

create or replace function public.remove_catalog_stock(
  p_product_id uuid,
  p_quantity integer,
  p_reason text
)
returns table (
  product_id uuid,
  on_hand integer,
  allocated integer,
  available integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product record;
  v_summary record;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'invalid_stock_quantity';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'stock_removal_reason_required';
  end if;

  select p.id, p.artist_id, coalesce(p.is_unlimited, true) as is_unlimited
  into v_product
  from public.products p
  where p.id = p_product_id
    and p.deleted_at is null
  for update;

  if v_product.id is null then
    raise exception 'product_not_found';
  end if;

  if not public.has_artist_role(v_product.artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;

  if v_product.is_unlimited then
    raise exception 'unlimited_product_stock_not_adjustable';
  end if;

  select *
  into v_summary
  from public.list_product_stock_summaries(v_product.artist_id) s
  where s.product_id = p_product_id;

  if p_quantity > coalesce(v_summary.available, 0) then
    raise exception 'insufficient_catalog_available_stock';
  end if;

  update public.products
  set stock_total = coalesce(stock_total, 0) - p_quantity
  where id = p_product_id;

  return query
    select s.*
    from public.list_product_stock_summaries(v_product.artist_id) s
    where s.product_id = p_product_id;
end;
$$;

revoke execute on function public.remove_catalog_stock(uuid, integer, text) from public, anon;
grant execute on function public.remove_catalog_stock(uuid, integer, text) to authenticated;

create or replace function public.add_event_stock(
  p_event_product_id uuid,
  p_quantity integer
)
returns table (
  event_product_id uuid,
  event_stock_total integer,
  event_reserved integer,
  event_sold integer,
  event_available integer,
  catalog_available integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_catalog_available integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'invalid_stock_quantity';
  end if;

  select
    ep.id,
    ep.product_id,
    ep.artist_id,
    ep.event_id,
    coalesce(ep.stock_total, 0) as stock_total,
    coalesce(ep.stock_reserved, 0) as stock_reserved,
    coalesce(ep.stock_sold, 0) as stock_sold,
    coalesce(ep.is_unlimited, false) as is_unlimited
  into v_row
  from public.event_products ep
  where ep.id = p_event_product_id
  for update;

  if v_row.id is null then
    raise exception 'event_product_not_found';
  end if;

  if not public.has_artist_role(v_row.artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;

  if v_row.is_unlimited then
    raise exception 'unlimited_event_stock_not_adjustable';
  end if;

  v_catalog_available := public.calculate_product_event_allocation_available(v_row.product_id, v_row.event_id);

  if p_quantity > v_catalog_available then
    raise exception 'insufficient_catalog_available_stock';
  end if;

  update public.event_products
  set stock_total = coalesce(stock_total, 0) + p_quantity,
      updated_at = now()
  where id = p_event_product_id;

  return query
    select
      ep.id,
      coalesce(ep.stock_total, 0)::integer,
      coalesce(ep.stock_reserved, 0)::integer,
      coalesce(ep.stock_sold, 0)::integer,
      greatest(coalesce(ep.stock_total, 0) - coalesce(ep.stock_reserved, 0) - coalesce(ep.stock_sold, 0), 0)::integer,
      public.calculate_product_event_allocation_available(ep.product_id, ep.event_id)::integer
    from public.event_products ep
    where ep.id = p_event_product_id;
end;
$$;

revoke execute on function public.add_event_stock(uuid, integer) from public, anon;
grant execute on function public.add_event_stock(uuid, integer) to authenticated;

create or replace function public.remove_event_stock(
  p_event_product_id uuid,
  p_quantity integer
)
returns table (
  event_product_id uuid,
  event_stock_total integer,
  event_reserved integer,
  event_sold integer,
  event_available integer,
  catalog_available integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_removable integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'invalid_stock_quantity';
  end if;

  select
    ep.id,
    ep.product_id,
    ep.artist_id,
    ep.event_id,
    coalesce(ep.stock_total, 0) as stock_total,
    coalesce(ep.stock_reserved, 0) as stock_reserved,
    coalesce(ep.stock_sold, 0) as stock_sold,
    coalesce(ep.is_unlimited, false) as is_unlimited
  into v_row
  from public.event_products ep
  where ep.id = p_event_product_id
  for update;

  if v_row.id is null then
    raise exception 'event_product_not_found';
  end if;

  if not public.has_artist_role(v_row.artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;

  if v_row.is_unlimited then
    raise exception 'unlimited_event_stock_not_adjustable';
  end if;

  v_removable := greatest(v_row.stock_total - v_row.stock_reserved - v_row.stock_sold, 0);

  if p_quantity > v_removable then
    raise exception 'event_stock_below_reserved_or_sold';
  end if;

  update public.event_products
  set stock_total = coalesce(stock_total, 0) - p_quantity,
      updated_at = now()
  where id = p_event_product_id;

  return query
    select
      ep.id,
      coalesce(ep.stock_total, 0)::integer,
      coalesce(ep.stock_reserved, 0)::integer,
      coalesce(ep.stock_sold, 0)::integer,
      greatest(coalesce(ep.stock_total, 0) - coalesce(ep.stock_reserved, 0) - coalesce(ep.stock_sold, 0), 0)::integer,
      public.calculate_product_event_allocation_available(ep.product_id, ep.event_id)::integer
    from public.event_products ep
    where ep.id = p_event_product_id;
end;
$$;

revoke execute on function public.remove_event_stock(uuid, integer) from public, anon;
grant execute on function public.remove_event_stock(uuid, integer) to authenticated;
