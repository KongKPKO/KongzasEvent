alter table public.events
  add column if not exists selling_mode text not null default 'live',
  add column if not exists preorder_opens_at timestamptz,
  add column if not exists preorder_closes_at timestamptz,
  add column if not exists preorder_pickup_instructions text;

alter table public.events
  drop constraint if exists events_selling_mode_check;

alter table public.events
  add constraint events_selling_mode_check
  check (selling_mode in ('preorder', 'live', 'post_event', 'closed'));

alter table public.events
  drop constraint if exists events_preorder_window_check;

alter table public.events
  add constraint events_preorder_window_check
  check (
    preorder_opens_at is null
    or preorder_closes_at is null
    or preorder_opens_at < preorder_closes_at
  );

alter table public.orders
  add column if not exists order_type text not null default 'live_queue',
  add column if not exists pickup_code text,
  add column if not exists customer_name text,
  add column if not exists customer_contact text,
  add column if not exists customer_note text,
  add column if not exists pickup_status text not null default 'not_required',
  add column if not exists picked_up_at timestamptz,
  add column if not exists picked_up_by uuid,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid,
  add column if not exists cancel_reason text;

alter table public.orders
  drop constraint if exists orders_order_type_check;

alter table public.orders
  add constraint orders_order_type_check
  check (order_type in ('live_queue', 'pos_walkin', 'preorder', 'post_event'));

alter table public.orders
  drop constraint if exists orders_pickup_status_check;

alter table public.orders
  add constraint orders_pickup_status_check
  check (pickup_status in ('not_required', 'awaiting_pickup', 'picked_up', 'cancelled', 'expired'));

alter table public.orders
  drop constraint if exists orders_preorder_customer_name_check;

alter table public.orders
  add constraint orders_preorder_customer_name_check
  check (order_type <> 'preorder' or length(trim(coalesce(customer_name, ''))) > 0);

alter table public.orders
  drop constraint if exists orders_preorder_pickup_code_check;

alter table public.orders
  add constraint orders_preorder_pickup_code_check
  check (order_type <> 'preorder' or length(trim(coalesce(pickup_code, ''))) >= 6);

update public.orders
set order_type = case
    when queue_id is null and status = 'completed' then 'pos_walkin'
    else 'live_queue'
  end,
  pickup_status = 'not_required'
where order_type = 'live_queue'
  and pickup_status = 'not_required';

create unique index if not exists orders_event_pickup_code_uidx
  on public.orders (event_id, pickup_code)
  where pickup_code is not null;

create index if not exists idx_orders_event_order_type_pickup_status_created
  on public.orders (event_id, order_type, pickup_status, created_at desc);

revoke select (
  order_type,
  pickup_code,
  customer_name,
  customer_contact,
  customer_note,
  pickup_status,
  picked_up_at,
  picked_up_by,
  cancelled_at,
  cancelled_by,
  cancel_reason
) on public.orders from anon;

grant select (
  order_type,
  pickup_code,
  customer_name,
  customer_contact,
  customer_note,
  pickup_status,
  picked_up_at,
  picked_up_by,
  cancelled_at,
  cancelled_by,
  cancel_reason
) on public.orders to authenticated;

drop policy if exists "orders_preorder_staff_read" on public.orders;

create policy "orders_preorder_staff_read"
  on public.orders
  for select
  to authenticated
  using (
    order_type = 'preorder'
    and public.has_event_role(event_id, array['owner', 'manager', 'seller', 'queue_staff'])
  );

create or replace function public.generate_pickup_code(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_attempt integer := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    exit when not exists (
      select 1
      from public.orders o
      where o.event_id = p_event_id
        and o.pickup_code = v_code
    );

    if v_attempt >= 10 then
      raise exception 'pickup_code_generation_failed';
    end if;
  end loop;

  return v_code;
end;
$$;

create or replace function public.create_preorder_with_stock(
  p_event_id uuid,
  p_items jsonb,
  p_customer_name text,
  p_customer_contact text default '',
  p_customer_note text default '',
  p_client_request_id uuid default null
)
returns table (
  order_id uuid,
  pickup_code text,
  total_price numeric,
  currency text,
  pickup_instructions text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_existing_order record;
  v_item jsonb;
  v_order_id uuid;
  v_pickup_code text;
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

  if length(trim(coalesce(p_customer_name, ''))) = 0 then
    raise exception 'customer_name_required';
  end if;

  select e.*, a.is_public, a.is_verified
  into v_event
  from public.events e
  join public.artists a on a.id = e.artist_id
  where e.id = p_event_id
  for update;

  if v_event.id is null then
    raise exception 'event_not_found';
  end if;

  if v_event.status not in ('Confirmed', 'confirmed') then
    raise exception 'event_not_confirmed';
  end if;

  if coalesce(v_event.is_public, false) is not true or coalesce(v_event.is_verified, false) is not true then
    raise exception 'artist_not_public';
  end if;

  if coalesce(v_event.selling_mode, 'live') <> 'preorder' then
    raise exception 'preorder_not_open';
  end if;

  if v_event.preorder_opens_at is not null and now() < v_event.preorder_opens_at then
    raise exception 'preorder_not_open_yet';
  end if;

  if v_event.preorder_closes_at is not null and now() > v_event.preorder_closes_at then
    raise exception 'preorder_closed';
  end if;

  if v_event.end_date < now() then
    raise exception 'event_ended';
  end if;

  if p_client_request_id is not null then
    select o.*
    into v_existing_order
    from public.orders o
    where o.payment_idempotency_key = p_client_request_id
    for update;

    if v_existing_order.id is not null then
      if v_existing_order.event_id = p_event_id and v_existing_order.order_type = 'preorder' then
        return query
        select
          v_existing_order.id,
          v_existing_order.pickup_code,
          v_existing_order.total_price,
          v_existing_order.currency,
          coalesce(v_event.preorder_pickup_instructions, '');
        return;
      end if;
      raise exception 'client_request_id_conflict';
    end if;
  end if;

  select exists (select 1 from public.event_products ep where ep.event_id = p_event_id)
  into v_has_catalog;

  v_pickup_code := public.generate_pickup_code(p_event_id);

  insert into public.orders (
    event_id,
    queue_id,
    status,
    total_price,
    subtotal_price,
    currency,
    payment_method,
    payment_idempotency_key,
    order_type,
    pickup_code,
    customer_name,
    customer_contact,
    customer_note,
    pickup_status
  )
  values (
    p_event_id,
    null,
    'confirmed',
    0,
    0,
    coalesce(v_event.currency_override, 'THB'),
    null,
    p_client_request_id,
    'preorder',
    v_pickup_code,
    trim(p_customer_name),
    nullif(trim(coalesce(p_customer_contact, '')), ''),
    nullif(trim(coalesce(p_customer_note, '')), ''),
    'awaiting_pickup'
  )
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
     and ep.event_id = p_event_id
    where p.id = (v_item ->> 'product_id')::uuid
      and p.artist_id = v_event.artist_id
      and p.deleted_at is null
      and p.status = 'enable'
      and (not v_has_catalog or (ep.id is not null and ep.is_enabled = true))
    for update of p;

    if v_product.id is null then
      raise exception 'invalid_product';
    end if;

    -- Locking the product row serializes concurrent orders for the same product,
    -- including event catalog stock updates, so finite stock cannot oversell.
    v_effective_currency := coalesce(v_event.currency_override, v_product.currency, 'THB');

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

  return query
  select
    v_order_id,
    v_pickup_code,
    v_total,
    coalesce(v_currency, 'THB'),
    coalesce(v_event.preorder_pickup_instructions, '');
exception
  when unique_violation then
    raise exception 'preorder_unique_conflict';
end;
$$;

create or replace function public.mark_preorder_picked_up(p_order_id uuid)
returns table (
  order_id uuid,
  pickup_status text,
  status text,
  picked_up_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_item record;
  v_now timestamptz := now();
begin
  select o.*, e.artist_id
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  if not public.has_event_role(v_order.event_id, array['owner', 'manager', 'seller', 'queue_staff']) then
    raise exception 'forbidden';
  end if;

  if v_order.order_type <> 'preorder' then
    raise exception 'order_not_preorder';
  end if;

  if v_order.status <> 'confirmed' or v_order.pickup_status <> 'awaiting_pickup' then
    raise exception 'order_not_pickup_ready';
  end if;

  for v_item in
    select
      oi.product_id,
      oi.event_product_id,
      oi.quantity,
      p.is_unlimited as product_unlimited,
      ep.is_unlimited as event_unlimited
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    left join public.event_products ep on ep.id = oi.event_product_id
    where oi.order_id = v_order.id
    for update of p
  loop
    if v_item.event_product_id is not null then
      if not coalesce(v_item.event_unlimited, true) then
        update public.event_products
        set stock_reserved = greatest(stock_reserved - v_item.quantity, 0),
            stock_sold = stock_sold + v_item.quantity
        where id = v_item.event_product_id;
      end if;
    elsif not coalesce(v_item.product_unlimited, true) then
      update public.products
      set stock_reserved = greatest(stock_reserved - v_item.quantity, 0),
          stock_sold = stock_sold + v_item.quantity,
          updated_at = now()
      where id = v_item.product_id;
    end if;
  end loop;

  update public.orders
  set status = 'completed',
      pickup_status = 'picked_up',
      picked_up_at = v_now,
      picked_up_by = auth.uid()
  where id = v_order.id;

  return query
  select v_order.id, 'picked_up'::text, 'completed'::text, v_now;
end;
$$;

create or replace function public.cancel_preorder_with_stock(
  p_order_id uuid,
  p_reason text default ''
)
returns table (
  order_id uuid,
  pickup_status text,
  status text,
  cancelled_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_item record;
  v_now timestamptz := now();
begin
  select o.*, e.artist_id
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  if not public.has_event_role(v_order.event_id, array['owner', 'manager', 'seller']) then
    raise exception 'forbidden';
  end if;

  if v_order.order_type <> 'preorder' then
    raise exception 'order_not_preorder';
  end if;

  if v_order.status <> 'confirmed' or v_order.pickup_status <> 'awaiting_pickup' then
    raise exception 'order_not_cancellable';
  end if;

  for v_item in
    select
      oi.product_id,
      oi.event_product_id,
      oi.quantity,
      p.is_unlimited as product_unlimited,
      ep.is_unlimited as event_unlimited
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
  set status = 'cancelled',
      pickup_status = 'cancelled',
      cancelled_at = v_now,
      cancelled_by = auth.uid(),
      cancel_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = v_order.id;

  return query
  select v_order.id, 'cancelled'::text, 'cancelled'::text, v_now;
end;
$$;

create or replace function public.expire_preorders_for_event(p_event_id uuid)
returns table (
  expired_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_order record;
  v_item record;
  v_count integer := 0;
begin
  select e.*
  into v_event
  from public.events e
  where e.id = p_event_id
  for update;

  if v_event.id is null then
    raise exception 'event_not_found';
  end if;

  if not public.has_event_role(p_event_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;

  if v_event.end_date >= now() and coalesce(v_event.selling_mode, 'live') <> 'closed' then
    raise exception 'event_not_ready_to_expire_preorders';
  end if;

  for v_order in
    select o.*
    from public.orders o
    where o.event_id = p_event_id
      and o.order_type = 'preorder'
      and o.status = 'confirmed'
      and o.pickup_status = 'awaiting_pickup'
    for update
  loop
    for v_item in
      select
        oi.product_id,
        oi.event_product_id,
        oi.quantity,
        p.is_unlimited as product_unlimited,
        ep.is_unlimited as event_unlimited
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
    set status = 'cancelled',
        pickup_status = 'expired',
        cancelled_at = now(),
        cancelled_by = auth.uid(),
        cancel_reason = 'expired_after_event'
    where id = v_order.id;

    v_count := v_count + 1;
  end loop;

  return query select v_count;
end;
$$;

create or replace function public.get_public_order_receipt(
  p_order_id uuid,
  p_pickup_code text
)
returns table (
  status text,
  pickup_status text,
  pickup_code text,
  customer_name text,
  total_price numeric,
  currency text,
  pickup_instructions text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    o.status,
    o.pickup_status,
    o.pickup_code,
    o.customer_name,
    o.total_price,
    o.currency,
    coalesce(e.preorder_pickup_instructions, '')
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
    and o.pickup_code = upper(trim(p_pickup_code))
    and o.order_type = 'preorder'
  limit 1;
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
    select o.id, o.event_id, o.queue_id, o.order_type
    into v_existing_order
    from public.orders o
    where o.payment_idempotency_key = p_payment_idempotency_key
    for update;

    if v_existing_order.id is not null then
      if v_existing_order.event_id = p_event_id
         and v_existing_order.queue_id is null
         and v_existing_order.order_type = 'pos_walkin' then
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

  insert into public.orders (
    event_id,
    queue_id,
    status,
    total_price,
    subtotal_price,
    currency,
    payment_method,
    payment_idempotency_key,
    order_type,
    pickup_status
  )
  values (
    p_event_id,
    null,
    'completed',
    0,
    0,
    coalesce(v_event.currency_override, 'THB'),
    p_payment_method,
    p_payment_idempotency_key,
    'pos_walkin',
    'not_required'
  )
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
      select o.id, o.event_id, o.queue_id, o.order_type
      into v_existing_order
      from public.orders o
      where o.payment_idempotency_key = p_payment_idempotency_key;

      if v_existing_order.id is not null
         and v_existing_order.event_id = p_event_id
         and v_existing_order.queue_id is null
         and v_existing_order.order_type = 'pos_walkin' then
        return v_existing_order.id;
      end if;
    end if;
    raise;
end;
$$;

grant execute on function public.generate_pickup_code(uuid) to authenticated;
grant execute on function public.create_preorder_with_stock(uuid, jsonb, text, text, text, uuid) to anon, authenticated;
grant execute on function public.mark_preorder_picked_up(uuid) to authenticated;
grant execute on function public.cancel_preorder_with_stock(uuid, text) to authenticated;
grant execute on function public.expire_preorders_for_event(uuid) to authenticated;
grant execute on function public.get_public_order_receipt(uuid, text) to anon, authenticated;
grant execute on function public.create_walkin_order_with_stock(uuid, jsonb, text, uuid) to authenticated;
