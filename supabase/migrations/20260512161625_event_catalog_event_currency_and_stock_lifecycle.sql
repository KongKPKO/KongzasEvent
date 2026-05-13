alter table public.events
  add column if not exists currency_override text;

update public.events
set currency_override = nullif(upper(trim(currency_override)), '')
where currency_override is not null;

alter table public.event_products
  drop column if exists currency_override;

create or replace function public.calculate_product_event_allocation_available(
  p_product_id uuid,
  p_exclude_event_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product record;
  v_event_sold integer := 0;
  v_active_remaining integer := 0;
begin
  select
    p.id,
    p.stock_total,
    coalesce(p.stock_reserved, 0) as stock_reserved,
    coalesce(p.stock_sold, 0) as stock_sold,
    coalesce(p.is_unlimited, true) as is_unlimited
  into v_product
  from public.products p
  where p.id = p_product_id;

  if v_product.id is null then
    raise exception 'product_not_found';
  end if;

  if v_product.is_unlimited or v_product.stock_total is null then
    return 2147483647;
  end if;

  select coalesce(sum(coalesce(ep.stock_sold, 0)), 0)::integer
  into v_event_sold
  from public.event_products ep
  where ep.product_id = p_product_id;

  select coalesce(sum(greatest(coalesce(ep.stock_total, 0) - coalesce(ep.stock_sold, 0), 0)), 0)::integer
  into v_active_remaining
  from public.event_products ep
  join public.events e on e.id = ep.event_id
  where ep.product_id = p_product_id
    and ep.is_enabled = true
    and ep.is_unlimited = false
    and e.status in ('Confirmed', 'confirmed')
    and e.end_date >= now()
    and (p_exclude_event_id is null or ep.event_id <> p_exclude_event_id);

  return greatest(
    coalesce(v_product.stock_total, 0)
      - coalesce(v_product.stock_sold, 0)
      - coalesce(v_product.stock_reserved, 0)
      - v_event_sold
      - v_active_remaining,
    0
  );
end;
$$;

drop function if exists public.save_event_catalog(uuid, jsonb);

create or replace function public.save_event_catalog(
  p_event_id uuid,
  p_items jsonb,
  p_currency_override text default null,
  p_update_event_currency boolean default false
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
  v_stock_total integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_catalog_payload';
  end if;

  select e.id, e.artist_id
  into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null then
    raise exception 'event_not_found';
  end if;

  if not public.has_artist_role(v_event.artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;

  if p_update_event_currency then
    update public.events
    set currency_override = nullif(upper(trim(p_currency_override)), '')
    where id = p_event_id;
  end if;

  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    v_has_is_unlimited := v_item ? 'is_unlimited';
    v_has_stock_total := v_item ? 'stock_total';
    v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    v_is_enabled := coalesce((v_item ->> 'is_enabled')::boolean, true);
    v_price_override := nullif(v_item ->> 'price_override', '')::numeric;

    if v_product_id is null then
      raise exception 'missing_product_id';
    end if;

    if v_price_override is not null and v_price_override < 0 then
      raise exception 'invalid_price_override';
    end if;

    select
      p.id,
      p.artist_id,
      p.stock_total,
      p.deleted_at,
      coalesce(p.is_unlimited, true) as is_unlimited
    into v_product
    from public.products p
    where p.id = v_product_id
    for update;

    if v_product.id is null or v_product.artist_id <> v_event.artist_id or v_product.deleted_at is not null then
      raise exception 'invalid_event_product';
    end if;

    select
      ep.id,
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
      when v_existing.id is not null and not v_has_is_unlimited then coalesce(v_existing.is_unlimited, v_product.is_unlimited)
      else coalesce((v_item ->> 'is_unlimited')::boolean, v_product.is_unlimited)
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
      stock_total,
      is_unlimited
    )
    values (
      p_event_id,
      v_product_id,
      v_event.artist_id,
      v_is_enabled,
      v_price_override,
      v_stock_total,
      v_is_unlimited
    )
    on conflict (event_id, product_id)
    do update set
      artist_id = excluded.artist_id,
      is_enabled = excluded.is_enabled,
      price_override = excluded.price_override,
      stock_total = excluded.stock_total,
      is_unlimited = excluded.is_unlimited,
      updated_at = now();
  end loop;
end;
$$;

create or replace function public.enforce_event_product_allocation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_product record;
  v_event record;
  v_available integer;
  v_requested_blocking integer;
begin
  select
    p.id,
    p.artist_id,
    p.stock_total,
    p.stock_reserved,
    p.stock_sold,
    p.is_unlimited,
    p.deleted_at
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

  if coalesce(v_product.is_unlimited, true) then
    return new;
  end if;

  if not coalesce(new.is_enabled, true) then
    return new;
  end if;

  if coalesce(new.is_unlimited, false) then
    raise exception 'event_stock_exceeds_catalog_stock';
  end if;

  if new.stock_total is null or new.stock_total < 0 then
    raise exception 'invalid_event_stock';
  end if;

  if new.stock_total < coalesce(new.stock_reserved, 0) + coalesce(new.stock_sold, 0) then
    raise exception 'event_stock_below_used_stock';
  end if;

  select
    e.id,
    e.status,
    e.end_date
  into v_event
  from public.events e
  where e.id = new.event_id;

  if v_event.id is null then
    raise exception 'event_not_found';
  end if;

  if v_event.status not in ('Confirmed', 'confirmed') or v_event.end_date < now() then
    return new;
  end if;

  v_requested_blocking := greatest(coalesce(new.stock_total, 0) - coalesce(new.stock_sold, 0), 0);
  v_available := public.calculate_product_event_allocation_available(new.product_id, new.event_id);

  if v_requested_blocking > v_available then
    raise exception 'event_stock_exceeds_catalog_stock';
  end if;

  return new;
end;
$$;

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
    false as event_catalog_mode
  from public.products p
  where p.artist_id = v_event.artist_id
    and p.deleted_at is null
    and p.status in ('enable', 'soldout')
  order by p.name;
end;
$$;

create or replace function public.create_customer_order_with_stock(
  p_queue_id uuid,
  p_items jsonb,
  p_payment_idempotency_key uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue record;
  v_event record;
  v_existing_order record;
  v_item jsonb;
  v_order_id uuid;
  v_product record;
  v_qty integer;
  v_total numeric := 0;
  v_currency text;
  v_effective_currency text;
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

  if p_payment_idempotency_key is not null then
    select o.id, o.event_id, o.queue_id
    into v_existing_order
    from public.orders o
    where o.payment_idempotency_key = p_payment_idempotency_key
    for update;

    if v_existing_order.id is not null then
      if v_existing_order.event_id = v_queue.event_id
         and v_existing_order.queue_id = v_queue.id then
        return v_existing_order.id;
      end if;
      raise exception 'payment_idempotency_key_conflict';
    end if;
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

  insert into public.orders (event_id, queue_id, status, total_price, currency, payment_method, payment_idempotency_key)
  values (v_event.id, v_queue.id, 'confirmed', 0, coalesce(v_event.currency_override, 'THB'), null, p_payment_idempotency_key)
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

    v_effective_currency := coalesce(v_event.currency_override, v_product.currency, 'THB');

    if v_currency is null then
      v_currency := v_effective_currency;
    elsif v_currency <> v_effective_currency then
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
      v_effective_currency
    );

    v_total := v_total + (v_product.effective_price * v_qty);
  end loop;

  update public.orders
  set total_price = v_total,
      subtotal_price = v_total,
      currency = coalesce(v_currency, 'THB')
  where id = v_order_id;

  return v_order_id;
exception
  when unique_violation then
    if p_payment_idempotency_key is not null then
      select o.id, o.event_id, o.queue_id
      into v_existing_order
      from public.orders o
      where o.payment_idempotency_key = p_payment_idempotency_key;

      if v_existing_order.id is not null
         and v_existing_order.event_id = v_queue.event_id
         and v_existing_order.queue_id = v_queue.id then
        return v_existing_order.id;
      end if;
    end if;
    raise;
end;
$$;

create or replace function public.sync_customer_order_items_with_stock(
  p_order_id uuid,
  p_items jsonb,
  p_payment_idempotency_key uuid default null
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
  v_effective_currency text;
  v_available integer;
  v_has_catalog boolean := false;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items_payload';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'empty_items';
  end if;

  select o.*, e.artist_id, e.currency_override
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

  if v_order.status = 'completed' then
    if p_payment_idempotency_key is not null
       and v_order.payment_idempotency_key is not null
       and v_order.payment_idempotency_key <> p_payment_idempotency_key then
      raise exception 'payment_idempotency_key_conflict';
    end if;
    return true;
  end if;

  if v_order.status not in ('draft', 'confirmed') then
    raise exception 'order_not_editable';
  end if;

  if p_payment_idempotency_key is not null
     and v_order.payment_idempotency_key is not null
     and v_order.payment_idempotency_key <> p_payment_idempotency_key then
    raise exception 'payment_idempotency_key_conflict';
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

    v_effective_currency := coalesce(v_order.currency_override, v_product.currency, 'THB');

    if v_currency is null then
      v_currency := v_effective_currency;
    elsif v_currency <> v_effective_currency then
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
      v_effective_currency
    );

    v_total := v_total + (v_product.effective_price * v_qty);
  end loop;

  update public.orders
  set total_price = v_total,
      subtotal_price = v_total,
      currency = coalesce(v_currency, currency, 'THB'),
      status = 'confirmed',
      payment_idempotency_key = coalesce(payment_idempotency_key, p_payment_idempotency_key)
  where id = v_order.id;

  return true;
end;
$$;

create or replace function public.create_walkin_order_with_stock(
  p_event_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_payment_idempotency_key uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_existing_order record;
  v_item jsonb;
  v_order_id uuid;
  v_product record;
  v_qty integer;
  v_total numeric := 0;
  v_currency text;
  v_effective_currency text;
  v_available integer;
  v_has_catalog boolean := false;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_items';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null then
    raise exception 'event_not_active';
  end if;

  if not public.has_artist_role(v_event.artist_id, array['owner', 'queue_pos']) then
    raise exception 'forbidden';
  end if;

  if p_payment_idempotency_key is not null then
    select o.id, o.event_id, o.queue_id
    into v_existing_order
    from public.orders o
    where o.payment_idempotency_key = p_payment_idempotency_key
    for update;

    if v_existing_order.id is not null then
      if v_existing_order.event_id = p_event_id
         and v_existing_order.queue_id is null then
        return v_existing_order.id;
      end if;
      raise exception 'payment_idempotency_key_conflict';
    end if;
  end if;

  if v_event.status <> 'Confirmed'
     or v_event.start_date > now()
     or v_event.end_date < now() then
    raise exception 'event_not_active';
  end if;

  select exists (select 1 from public.event_products ep where ep.event_id = v_event.id)
  into v_has_catalog;

  insert into public.orders (event_id, queue_id, status, total_price, currency, payment_method, payment_idempotency_key)
  values (p_event_id, null, 'completed', 0, coalesce(v_event.currency_override, 'THB'), p_payment_method, p_payment_idempotency_key)
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

    v_effective_currency := coalesce(v_event.currency_override, v_product.currency, 'THB');

    if v_currency is null then
      v_currency := v_effective_currency;
    elsif v_currency <> v_effective_currency then
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
      v_effective_currency
    );

    v_total := v_total + (v_product.effective_price * v_qty);
  end loop;

  update public.orders
  set total_price = v_total,
      subtotal_price = v_total,
      currency = coalesce(v_currency, 'THB')
  where id = v_order_id;

  return v_order_id;
exception
  when unique_violation then
    if p_payment_idempotency_key is not null then
      select o.id, o.event_id, o.queue_id
      into v_existing_order
      from public.orders o
      where o.payment_idempotency_key = p_payment_idempotency_key;

      if v_existing_order.id is not null
         and v_existing_order.event_id = p_event_id
         and v_existing_order.queue_id is null then
        return v_existing_order.id;
      end if;
    end if;
    raise;
end;
$$;

grant execute on function public.create_customer_order_with_stock(uuid, jsonb, uuid) to anon, authenticated;
grant execute on function public.sync_customer_order_items_with_stock(uuid, jsonb, uuid) to authenticated;
grant execute on function public.create_walkin_order_with_stock(uuid, jsonb, text, uuid) to authenticated;
grant execute on function public.list_event_products(uuid) to anon, authenticated;
grant execute on function public.save_event_catalog(uuid, jsonb, text, boolean) to authenticated;

create or replace function public.apply_event_product_order_item_currency()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_currency text;
begin
  if new.order_id is null then
    return new;
  end if;

  select coalesce(e.currency_override, new.currency)
  into v_currency
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = new.order_id;

  if v_currency is not null then
    new.currency := v_currency;
  end if;

  return new;
end;
$$;
