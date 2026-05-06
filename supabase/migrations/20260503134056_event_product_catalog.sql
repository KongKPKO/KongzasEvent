-- Phase 2: event-specific product catalog, pricing, and stock.
-- If an event has no rows in event_products, existing global product behavior remains active.

create table if not exists public.event_products (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  is_enabled boolean not null default true,
  price_override numeric,
  stock_total integer,
  stock_reserved integer not null default 0,
  stock_sold integer not null default 0,
  is_unlimited boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_products_unique_event_product unique (event_id, product_id),
  constraint event_products_price_non_negative check (price_override is null or price_override >= 0),
  constraint event_products_stock_non_negative check (
    (stock_total is null or stock_total >= 0)
    and stock_reserved >= 0
    and stock_sold >= 0
  )
);

create index if not exists idx_event_products_event_enabled
  on public.event_products (event_id, is_enabled);

create index if not exists idx_event_products_artist_event
  on public.event_products (artist_id, event_id);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_event_products_updated_at'
  ) then
    create trigger trg_event_products_updated_at
      before update on public.event_products
      for each row
      execute function public.update_updated_at_column();
  end if;
end $$;

alter table public.event_products enable row level security;

drop policy if exists "event_products_public_read" on public.event_products;
drop policy if exists "event_products_staff_read" on public.event_products;
drop policy if exists "event_products_owner_manage" on public.event_products;

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
        and a.is_public = true
        and a.is_verified = true
    )
  );

create policy "event_products_staff_read"
  on public.event_products
  for select
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'queue_pos', 'queue_only']));

create policy "event_products_owner_manage"
  on public.event_products
  for all
  to authenticated
  using (public.has_artist_role(artist_id, array['owner']))
  with check (public.has_artist_role(artist_id, array['owner']));

grant select on public.event_products to anon, authenticated;
grant insert, update, delete on public.event_products to authenticated;

alter table public.order_items
  add column if not exists event_product_id uuid references public.event_products(id) on delete set null;

create index if not exists idx_order_items_event_product_id
  on public.order_items (event_product_id)
  where event_product_id is not null;

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
      coalesce(p.currency, 'THB') as currency,
      case when ep.is_unlimited then null else ep.stock_total end as stock_total,
      coalesce(ep.stock_reserved, 0) as stock_reserved,
      coalesce(ep.stock_sold, 0) as stock_sold,
      ep.is_unlimited,
      p.deleted_at,
      ep.id as event_product_id,
      ep.event_id,
      ep.price_override,
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

create or replace function public.create_customer_order_with_stock(
  p_queue_id uuid,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue record;
  v_event record;
  v_item jsonb;
  v_order_id uuid;
  v_product record;
  v_qty integer;
  v_total numeric := 0;
  v_currency text;
  v_available integer;
  v_service_date date;
  v_has_catalog boolean := false;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_items';
  end if;

  select q.* into v_queue
  from public.queues q
  where q.id = p_queue_id
  for update;

  if v_queue.id is null then
    raise exception 'queue_not_found';
  end if;

  if v_queue.status not in ('waiting', 'calling', 'serving') then
    raise exception 'queue_not_active';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = v_queue.event_id
    and e.artist_id = v_queue.artist_id
    and e.status = 'Confirmed'
    and e.start_date <= now()
    and e.end_date >= now();

  if v_event.id is null then
    raise exception 'event_not_active';
  end if;

  v_service_date := (
    now() at time zone coalesce(nullif(v_event.event_timezone, ''), 'Asia/Bangkok')
  )::date;

  if v_queue.queue_service_date is distinct from v_service_date then
    raise exception 'queue_not_active_today';
  end if;

  select exists (select 1 from public.event_products ep where ep.event_id = v_event.id)
  into v_has_catalog;

  insert into public.orders (event_id, queue_id, status, total_price, currency, payment_method)
  values (v_event.id, v_queue.id, 'confirmed', 0, 'THB', null)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::integer, 1));

    select
      p.*,
      ep.id as event_product_id,
      coalesce(ep.price_override, p.price) as effective_price,
      case when ep.id is not null then ep.is_unlimited else p.is_unlimited end as effective_is_unlimited,
      case when ep.id is not null then ep.stock_total else p.stock_total end as effective_stock_total,
      case when ep.id is not null then ep.stock_reserved else p.stock_reserved end as effective_stock_reserved,
      case when ep.id is not null then ep.stock_sold else p.stock_sold end as effective_stock_sold
    into v_product
    from public.products p
    left join public.event_products ep
      on ep.product_id = p.id
     and ep.event_id = v_event.id
    where p.id = (v_item ->> 'product_id')::uuid
      and p.artist_id = v_queue.artist_id
      and p.deleted_at is null
      and p.status = 'enable'
      and (not v_has_catalog or (ep.id is not null and ep.is_enabled = true))
    for update of p;

    if v_product.id is null then
      raise exception 'invalid_product';
    end if;

    if v_currency is null then
      v_currency := v_product.currency;
    elsif v_currency <> v_product.currency then
      raise exception 'mixed_currency_not_allowed';
    end if;

    if not coalesce(v_product.effective_is_unlimited, true) then
      v_available := coalesce(v_product.effective_stock_total, 0) - coalesce(v_product.effective_stock_reserved, 0) - coalesce(v_product.effective_stock_sold, 0);
      if v_available < v_qty then
        raise exception 'insufficient_stock';
      end if;

      if v_product.event_product_id is not null then
        update public.event_products
        set stock_reserved = stock_reserved + v_qty
        where id = v_product.event_product_id;
      else
        update public.products
        set stock_reserved = stock_reserved + v_qty,
            updated_at = now()
        where id = v_product.id;
      end if;
    end if;

    insert into public.order_items (order_id, product_id, event_product_id, quantity, price_per_unit, notes, currency)
    values (
      v_order_id,
      v_product.id,
      v_product.event_product_id,
      v_qty,
      v_product.effective_price,
      coalesce(v_item ->> 'notes', ''),
      v_product.currency
    );

    v_total := v_total + (v_product.effective_price * v_qty);
  end loop;

  update public.orders
  set total_price = v_total,
      subtotal_price = v_total,
      currency = coalesce(v_currency, 'THB')
  where id = v_order_id;

  return v_order_id;
end;
$$;

grant execute on function public.create_customer_order_with_stock(uuid, jsonb) to anon, authenticated;

create or replace function public.sync_customer_order_items_with_stock(
  p_order_id uuid,
  p_items jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_existing_item record;
  v_item jsonb;
  v_product record;
  v_qty integer;
  v_total numeric := 0;
  v_currency text;
  v_available integer;
  v_has_catalog boolean := false;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items_payload';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'empty_items';
  end if;

  select o.*, e.artist_id
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  if v_order.queue_id is null then
    raise exception 'order_not_queue_order';
  end if;

  if v_order.status not in ('draft', 'confirmed') then
    raise exception 'order_not_editable';
  end if;

  if not public.has_artist_role(v_order.artist_id, array['owner', 'queue_pos']) then
    raise exception 'forbidden';
  end if;

  select exists (select 1 from public.event_products ep where ep.event_id = v_order.event_id)
  into v_has_catalog;

  for v_existing_item in
    select oi.product_id, oi.event_product_id, oi.quantity, p.is_unlimited as product_unlimited, ep.is_unlimited as event_unlimited
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    left join public.event_products ep on ep.id = oi.event_product_id
    where oi.order_id = v_order.id
    for update of p
  loop
    if v_existing_item.event_product_id is not null then
      if not coalesce(v_existing_item.event_unlimited, true) then
        update public.event_products
        set stock_reserved = greatest(stock_reserved - v_existing_item.quantity, 0)
        where id = v_existing_item.event_product_id;
      end if;
    elsif not coalesce(v_existing_item.product_unlimited, true) then
      update public.products
      set stock_reserved = greatest(stock_reserved - v_existing_item.quantity, 0),
          updated_at = now()
      where id = v_existing_item.product_id;
    end if;
  end loop;

  delete from public.order_items
  where order_id = v_order.id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::integer, 1));

    select
      p.*,
      ep.id as event_product_id,
      coalesce(ep.price_override, p.price) as effective_price,
      case when ep.id is not null then ep.is_unlimited else p.is_unlimited end as effective_is_unlimited,
      case when ep.id is not null then ep.stock_total else p.stock_total end as effective_stock_total,
      case when ep.id is not null then ep.stock_reserved else p.stock_reserved end as effective_stock_reserved,
      case when ep.id is not null then ep.stock_sold else p.stock_sold end as effective_stock_sold
    into v_product
    from public.products p
    left join public.event_products ep
      on ep.product_id = p.id
     and ep.event_id = v_order.event_id
    where p.id = (v_item ->> 'product_id')::uuid
      and p.artist_id = v_order.artist_id
      and p.deleted_at is null
      and p.status = 'enable'
      and (not v_has_catalog or (ep.id is not null and ep.is_enabled = true))
    for update of p;

    if v_product.id is null then
      raise exception 'invalid_product';
    end if;

    if v_currency is null then
      v_currency := v_product.currency;
    elsif v_currency <> v_product.currency then
      raise exception 'mixed_currency_not_allowed';
    end if;

    if not coalesce(v_product.effective_is_unlimited, true) then
      v_available := coalesce(v_product.effective_stock_total, 0)
        - coalesce(v_product.effective_stock_reserved, 0)
        - coalesce(v_product.effective_stock_sold, 0);

      if v_available < v_qty then
        raise exception 'insufficient_stock';
      end if;

      if v_product.event_product_id is not null then
        update public.event_products
        set stock_reserved = stock_reserved + v_qty
        where id = v_product.event_product_id;
      else
        update public.products
        set stock_reserved = stock_reserved + v_qty,
            updated_at = now()
        where id = v_product.id;
      end if;
    end if;

    insert into public.order_items (order_id, product_id, event_product_id, quantity, price_per_unit, notes, currency)
    values (
      v_order.id,
      v_product.id,
      v_product.event_product_id,
      v_qty,
      v_product.effective_price,
      coalesce(v_item ->> 'notes', ''),
      v_product.currency
    );

    v_total := v_total + (v_product.effective_price * v_qty);
  end loop;

  update public.orders
  set total_price = v_total,
      subtotal_price = v_total,
      currency = coalesce(v_currency, currency, 'THB'),
      status = 'confirmed'
  where id = v_order.id;

  return true;
end;
$$;

grant execute on function public.sync_customer_order_items_with_stock(uuid, jsonb) to authenticated;

create or replace function public.cancel_customer_order_with_stock_release(
  p_order_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_item record;
begin
  select o.* into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    return false;
  end if;

  if v_order.status not in ('draft', 'confirmed') then
    return false;
  end if;

  for v_item in
    select oi.product_id, oi.event_product_id, oi.quantity, p.is_unlimited as product_unlimited, ep.is_unlimited as event_unlimited
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    left join public.event_products ep on ep.id = oi.event_product_id
    where oi.order_id = v_order.id
    for update of p
  loop
    if v_item.event_product_id is not null then
      if not coalesce(v_item.event_unlimited, true) then
        update public.event_products
        set stock_reserved = greatest(stock_reserved - v_item.quantity, 0)
        where id = v_item.event_product_id;
      end if;
    elsif not coalesce(v_item.product_unlimited, true) then
      update public.products
      set stock_reserved = greatest(stock_reserved - v_item.quantity, 0),
          updated_at = now()
      where id = v_item.product_id;
    end if;
  end loop;

  update public.orders
  set status = 'cancelled'
  where id = v_order.id;

  return true;
end;
$$;

grant execute on function public.cancel_customer_order_with_stock_release(uuid) to anon, authenticated;

create or replace function public.complete_order_with_stock(
  p_order_id uuid,
  p_payment_method text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_item record;
  v_reserved integer;
  v_missing integer;
  v_unreserved_available integer;
begin
  select o.* into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  if v_order.status = 'completed' then
    return true;
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'order_cancelled';
  end if;

  for v_item in
    select
      oi.product_id,
      oi.event_product_id,
      oi.quantity,
      p.is_unlimited as product_unlimited,
      p.stock_reserved as product_reserved,
      p.stock_sold as product_sold,
      p.stock_total as product_total,
      ep.is_unlimited as event_unlimited,
      ep.stock_reserved as event_reserved,
      ep.stock_sold as event_sold,
      ep.stock_total as event_total
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    left join public.event_products ep on ep.id = oi.event_product_id
    where oi.order_id = v_order.id
    for update of p
  loop
    if v_item.event_product_id is not null then
      if coalesce(v_item.event_unlimited, true) then
        continue;
      end if;

      v_reserved := least(coalesce(v_item.event_reserved, 0), v_item.quantity);
      v_missing := v_item.quantity - v_reserved;
      v_unreserved_available := coalesce(v_item.event_total, 0) - coalesce(v_item.event_sold, 0) - coalesce(v_item.event_reserved, 0);

      if v_missing > v_unreserved_available then
        raise exception 'insufficient_stock_on_complete';
      end if;

      update public.event_products
      set stock_reserved = greatest(stock_reserved - v_reserved, 0),
          stock_sold = stock_sold + v_item.quantity
      where id = v_item.event_product_id;
    elsif not coalesce(v_item.product_unlimited, true) then
      v_reserved := least(coalesce(v_item.product_reserved, 0), v_item.quantity);
      v_missing := v_item.quantity - v_reserved;
      v_unreserved_available := coalesce(v_item.product_total, 0) - coalesce(v_item.product_sold, 0) - coalesce(v_item.product_reserved, 0);

      if v_missing > v_unreserved_available then
        raise exception 'insufficient_stock_on_complete';
      end if;

      update public.products
      set stock_reserved = greatest(stock_reserved - v_reserved, 0),
          stock_sold = stock_sold + v_item.quantity,
          updated_at = now()
      where id = v_item.product_id;
    end if;
  end loop;

  update public.orders
  set status = 'completed',
      payment_method = p_payment_method
  where id = v_order.id;

  if v_order.queue_id is not null then
    update public.queues
    set status = 'complete',
        completed_at = now(),
        last_updated_at = now()
    where id = v_order.queue_id;
  end if;

  return true;
end;
$$;

grant execute on function public.complete_order_with_stock(uuid, text) to authenticated;

create or replace function public.create_walkin_order_with_stock(
  p_event_id uuid,
  p_items jsonb,
  p_payment_method text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_item jsonb;
  v_order_id uuid;
  v_product record;
  v_qty integer;
  v_total numeric := 0;
  v_currency text;
  v_available integer;
  v_has_catalog boolean := false;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_items';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id
    and e.status = 'Confirmed'
    and e.start_date <= now()
    and e.end_date >= now();

  if v_event.id is null then
    raise exception 'event_not_active';
  end if;

  if not public.has_artist_role(v_event.artist_id, array['owner', 'queue_pos']) then
    raise exception 'forbidden';
  end if;

  select exists (select 1 from public.event_products ep where ep.event_id = v_event.id)
  into v_has_catalog;

  insert into public.orders (event_id, queue_id, status, total_price, currency, payment_method)
  values (p_event_id, null, 'completed', 0, 'THB', p_payment_method)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::integer, 1));

    select
      p.*,
      ep.id as event_product_id,
      coalesce(ep.price_override, p.price) as effective_price,
      case when ep.id is not null then ep.is_unlimited else p.is_unlimited end as effective_is_unlimited,
      case when ep.id is not null then ep.stock_total else p.stock_total end as effective_stock_total,
      case when ep.id is not null then ep.stock_reserved else p.stock_reserved end as effective_stock_reserved,
      case when ep.id is not null then ep.stock_sold else p.stock_sold end as effective_stock_sold
    into v_product
    from public.products p
    left join public.event_products ep
      on ep.product_id = p.id
     and ep.event_id = v_event.id
    where p.id = (v_item ->> 'product_id')::uuid
      and p.artist_id = v_event.artist_id
      and p.deleted_at is null
      and p.status = 'enable'
      and (not v_has_catalog or (ep.id is not null and ep.is_enabled = true))
    for update of p;

    if v_product.id is null then
      raise exception 'invalid_product';
    end if;

    if v_currency is null then
      v_currency := v_product.currency;
    elsif v_currency <> v_product.currency then
      raise exception 'mixed_currency_not_allowed';
    end if;

    if not coalesce(v_product.effective_is_unlimited, true) then
      v_available := coalesce(v_product.effective_stock_total, 0) - coalesce(v_product.effective_stock_reserved, 0) - coalesce(v_product.effective_stock_sold, 0);
      if v_available < v_qty then
        raise exception 'insufficient_stock';
      end if;

      if v_product.event_product_id is not null then
        update public.event_products
        set stock_sold = stock_sold + v_qty
        where id = v_product.event_product_id;
      else
        update public.products
        set stock_sold = stock_sold + v_qty,
            updated_at = now()
        where id = v_product.id;
      end if;
    end if;

    insert into public.order_items (order_id, product_id, event_product_id, quantity, price_per_unit, notes, currency)
    values (
      v_order_id,
      v_product.id,
      v_product.event_product_id,
      v_qty,
      v_product.effective_price,
      coalesce(v_item ->> 'notes', ''),
      v_product.currency
    );

    v_total := v_total + (v_product.effective_price * v_qty);
  end loop;

  update public.orders
  set total_price = v_total,
      subtotal_price = v_total,
      currency = coalesce(v_currency, 'THB')
  where id = v_order_id;

  return v_order_id;
end;
$$;

grant execute on function public.create_walkin_order_with_stock(uuid, jsonb, text) to authenticated;
