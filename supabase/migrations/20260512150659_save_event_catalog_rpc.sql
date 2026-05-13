alter table public.event_products
  add column if not exists currency_override text;

create or replace function public.save_event_catalog(
  p_event_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_item jsonb;
  v_product record;
  v_existing record;
  v_has_is_unlimited boolean;
  v_has_stock_total boolean;
  v_product_id uuid;
  v_is_enabled boolean;
  v_is_unlimited boolean;
  v_price_override numeric;
  v_currency_override text;
  v_stock_total integer;
  v_allocated integer;
  v_product_available integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_catalog_payload';
  end if;

  select e.id, e.artist_id, e.status, e.end_date
  into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null then
    raise exception 'event_not_found';
  end if;

  if not public.has_artist_role(v_event.artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    v_has_is_unlimited := v_item ? 'is_unlimited';
    v_has_stock_total := v_item ? 'stock_total';
    v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    v_is_enabled := coalesce((v_item ->> 'is_enabled')::boolean, true);
    v_price_override := nullif(v_item ->> 'price_override', '')::numeric;
    v_currency_override := upper(nullif(trim(coalesce(v_item ->> 'currency_override', '')), ''));

    if v_product_id is null then
      raise exception 'missing_product_id';
    end if;

    if v_price_override is not null and v_price_override < 0 then
      raise exception 'invalid_price_override';
    end if;

    select p.id, p.artist_id, p.stock_total, coalesce(p.stock_reserved, 0) as stock_reserved,
           coalesce(p.stock_sold, 0) as stock_sold, coalesce(p.is_unlimited, true) as is_unlimited,
           p.deleted_at
    into v_product
    from public.products p
    where p.id = v_product_id
    for update;

    if v_product.id is null or v_product.artist_id <> v_event.artist_id or v_product.deleted_at is not null then
      raise exception 'invalid_event_product';
    end if;

    select ep.id,
           ep.stock_total,
           ep.is_unlimited,
           coalesce(ep.stock_reserved, 0) as stock_reserved,
           coalesce(ep.stock_sold, 0) as stock_sold
    into v_existing
    from public.event_products ep
    where ep.event_id = p_event_id
      and ep.product_id = v_product_id
    for update;

    v_is_unlimited := case
      when v_existing.id is not null and not v_has_is_unlimited then coalesce(v_existing.is_unlimited, coalesce(v_product.is_unlimited, true))
      else coalesce((v_item ->> 'is_unlimited')::boolean, coalesce(v_product.is_unlimited, true))
    end;

    v_stock_total := case
      when not v_has_stock_total and v_existing.id is not null then v_existing.stock_total
      when not v_has_stock_total then v_product.stock_total
      else nullif(v_item ->> 'stock_total', '')::integer
    end;

    if v_is_unlimited then
      v_stock_total := null;
    elsif v_stock_total is null or v_stock_total < 0 then
      raise exception 'invalid_event_stock';
    end if;

    if not v_is_unlimited and v_existing.id is not null then
      if v_stock_total < (v_existing.stock_reserved + v_existing.stock_sold) then
        raise exception 'event_stock_below_reserved_or_sold';
      end if;
    end if;

    insert into public.event_products (
      event_id,
      product_id,
      artist_id,
      is_enabled,
      price_override,
      currency_override,
      stock_total,
      is_unlimited
    )
    values (
      p_event_id,
      v_product_id,
      v_event.artist_id,
      v_is_enabled,
      v_price_override,
      v_currency_override,
      v_stock_total,
      v_is_unlimited
    )
    on conflict (event_id, product_id)
    do update set
      artist_id = excluded.artist_id,
      is_enabled = excluded.is_enabled,
      price_override = excluded.price_override,
      currency_override = excluded.currency_override,
      stock_total = excluded.stock_total,
      is_unlimited = excluded.is_unlimited,
      updated_at = now();

    perform 1
    from public.event_products ep
    join public.events e on e.id = ep.event_id
    where ep.product_id = v_product_id
      and e.end_date >= now()
      and e.status in ('Confirmed', 'confirmed')
    for update of ep;

    if not v_product.is_unlimited then
      v_product_available := greatest(
        coalesce(v_product.stock_total, 0) - coalesce(v_product.stock_reserved, 0) - coalesce(v_product.stock_sold, 0),
        0
      );

      select coalesce(sum(ep.stock_total), 0)::integer
      into v_allocated
      from public.event_products ep
      join public.events e on e.id = ep.event_id
      where ep.product_id = v_product_id
        and ep.is_enabled = true
        and ep.is_unlimited = false
        and e.end_date >= now()
        and e.status in ('Confirmed', 'confirmed');

      if v_allocated > v_product_available then
        raise exception 'event_stock_over_allocated';
      end if;
    end if;
  end loop;
end;
$$;

revoke execute on function public.save_event_catalog(uuid, jsonb) from public, anon;
grant execute on function public.save_event_catalog(uuid, jsonb) to authenticated;

create or replace function public.enforce_event_product_allocation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_product record;
  v_allocated integer;
  v_requested integer;
  v_product_available integer;
begin
  select p.id, p.artist_id, p.stock_total, p.stock_reserved, p.stock_sold, p.is_unlimited, p.deleted_at
  into v_product
  from public.products p
  where p.id = new.product_id
  for update;

  if v_product.id is null or v_product.artist_id <> new.artist_id or v_product.deleted_at is not null then
    raise exception 'invalid_event_product';
  end if;

  if new.price_override is not null and new.price_override < 0 then
    raise exception 'invalid_price_override';
  end if;

  if nullif(trim(coalesce(new.currency_override, '')), '') is null then
    new.currency_override := null;
  else
    new.currency_override := upper(trim(new.currency_override));
  end if;

  if coalesce(v_product.is_unlimited, true) or not coalesce(new.is_enabled, true) then
    return new;
  end if;

  if coalesce(new.is_unlimited, false) then
    raise exception 'event_stock_exceeds_catalog_stock';
  end if;

  v_requested := coalesce(new.stock_total, 0);

  if v_requested < coalesce(new.stock_reserved, 0) + coalesce(new.stock_sold, 0) then
    raise exception 'event_stock_below_used_stock';
  end if;

  select coalesce(sum(coalesce(ep.stock_total, 0)), 0)::integer
  into v_allocated
  from public.event_products ep
  join public.events e on e.id = ep.event_id
  where ep.product_id = new.product_id
    and ep.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and not (ep.event_id = new.event_id and ep.product_id = new.product_id)
    and ep.is_enabled = true
    and ep.is_unlimited = false
    and e.status in ('Confirmed', 'confirmed')
    and e.end_date >= now();

  v_product_available := greatest(
    coalesce(v_product.stock_total, 0)
      - coalesce(v_product.stock_reserved, 0)
      - coalesce(v_product.stock_sold, 0)
      - v_allocated,
    0
  );

  if v_requested > v_product_available then
    raise exception 'event_stock_exceeds_catalog_stock';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_event_product_allocation() from public, anon, authenticated;

drop trigger if exists trg_validate_event_product_stock_allocation on public.event_products;
drop trigger if exists trg_event_products_allocation on public.event_products;

create trigger trg_event_products_allocation
  before insert or update on public.event_products
  for each row
  execute function public.enforce_event_product_allocation();
