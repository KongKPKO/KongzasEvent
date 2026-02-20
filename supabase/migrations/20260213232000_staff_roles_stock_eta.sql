-- Staff roles, stock accounting, and ETA helpers

-- 1) Team members table
create table if not exists public.artist_members (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  member_email text not null,
  role text not null check (role in ('owner', 'queue_only', 'queue_pos')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists artist_members_artist_email_uidx
  on public.artist_members (artist_id, lower(member_email));

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Use a dedicated trigger name to avoid conflicts with existing tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_artist_members_updated_at'
  ) THEN
    CREATE TRIGGER trg_artist_members_updated_at
      BEFORE UPDATE ON public.artist_members
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at_timestamp();
  END IF;
END $$;

alter table public.artist_members enable row level security;

-- Seed owner rows for existing artists if missing
insert into public.artist_members (artist_id, member_email, role, status, created_by)
select a.id, lower(u.email), 'owner', 'active', a.id
from public.artists a
join auth.users u on u.id = a.id
where u.email is not null
on conflict do nothing;

-- 2) Role helpers
create or replace function public.has_artist_role(p_artist_id uuid, p_allowed_roles text[])
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if auth.uid() is null then
    return false;
  end if;

  if auth.uid() = p_artist_id then
    return true;
  end if;

  v_email := lower(coalesce((auth.jwt() ->> 'email'), ''));

  if v_email = '' then
    return false;
  end if;

  return exists (
    select 1
    from public.artist_members m
    where m.artist_id = p_artist_id
      and m.status = 'active'
      and lower(m.member_email) = v_email
      and m.role = any(p_allowed_roles)
  );
end;
$$;

create or replace function public.get_actor_context()
returns table (
  artist_id uuid,
  role text,
  is_owner boolean,
  member_email text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if auth.uid() is null then
    return;
  end if;

  v_email := lower(coalesce((auth.jwt() ->> 'email'), ''));

  if exists (select 1 from public.artists a where a.id = auth.uid()) then
    return query
    select auth.uid(), 'owner'::text, true, v_email;
    return;
  end if;

  return query
  select m.artist_id, m.role, false, m.member_email
  from public.artist_members m
  where m.status = 'active'
    and lower(m.member_email) = v_email
  order by m.updated_at desc
  limit 1;
end;
$$;

-- 3) Team member policies
DROP POLICY IF EXISTS "artist_members_owner_manage" ON public.artist_members;
DROP POLICY IF EXISTS "artist_members_self_view" ON public.artist_members;

create policy "artist_members_owner_manage"
  on public.artist_members
  for all
  to authenticated
  using (public.has_artist_role(artist_id, array['owner']))
  with check (public.has_artist_role(artist_id, array['owner']));

create policy "artist_members_self_view"
  on public.artist_members
  for select
  to authenticated
  using (lower(member_email) = lower(coalesce((auth.jwt() ->> 'email'), '')));

grant select, insert, update, delete on public.artist_members to authenticated;

-- 4) Stock columns
alter table public.products
  add column if not exists stock_total integer,
  add column if not exists stock_reserved integer not null default 0,
  add column if not exists stock_sold integer not null default 0,
  add column if not exists is_unlimited boolean not null default true;

-- Backfill existing rows
update public.products
set is_unlimited = true
where is_unlimited is null;

alter table public.products
  drop constraint if exists products_stock_non_negative;

alter table public.products
  add constraint products_stock_non_negative
  check (
    (stock_total is null or stock_total >= 0)
    and stock_reserved >= 0
    and stock_sold >= 0
  );

-- 5) Queue/POS RPC helpers
create or replace function public.set_artist_queue_broadcast(
  p_artist_id uuid,
  p_message text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_artist_role(p_artist_id, array['owner', 'queue_only', 'queue_pos']) then
    raise exception 'forbidden';
  end if;

  update public.artists
  set broadcast_message = p_message,
      is_queue_open = case when p_message = 'Queue closed temporarily' then false else true end
  where id = p_artist_id;

  return true;
end;
$$;

create or replace function public.set_booth_open_status(
  p_event_id uuid,
  p_is_open boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_artist_id uuid;
begin
  select e.artist_id into v_artist_id
  from public.events e
  where e.id = p_event_id;

  if v_artist_id is null then
    raise exception 'event_not_found';
  end if;

  if not public.has_artist_role(v_artist_id, array['owner', 'queue_only', 'queue_pos']) then
    raise exception 'forbidden';
  end if;

  update public.events
  set is_booth_open = p_is_open,
      last_updated_at = now()
  where id = p_event_id;

  return true;
end;
$$;

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

  insert into public.orders (event_id, queue_id, status, total_price, currency, payment_method)
  values (v_event.id, v_queue.id, 'confirmed', 0, 'THB', null)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::integer, 1));

    select p.* into v_product
    from public.products p
    where p.id = (v_item ->> 'product_id')::uuid
      and p.artist_id = v_queue.artist_id
      and p.deleted_at is null
      and p.status = 'enable'
    for update;

    if v_product.id is null then
      raise exception 'invalid_product';
    end if;

    if v_currency is null then
      v_currency := v_product.currency;
    elsif v_currency <> v_product.currency then
      raise exception 'mixed_currency_not_allowed';
    end if;

    if not v_product.is_unlimited then
      v_available := coalesce(v_product.stock_total, 0) - coalesce(v_product.stock_reserved, 0) - coalesce(v_product.stock_sold, 0);
      if v_available < v_qty then
        raise exception 'insufficient_stock';
      end if;

      update public.products
      set stock_reserved = stock_reserved + v_qty,
          updated_at = now()
      where id = v_product.id;
    end if;

    insert into public.order_items (order_id, product_id, quantity, price_per_unit, notes, currency)
    values (
      v_order_id,
      v_product.id,
      v_qty,
      v_product.price,
      coalesce(v_item ->> 'notes', ''),
      v_product.currency
    );

    v_total := v_total + (v_product.price * v_qty);
  end loop;

  update public.orders
  set total_price = v_total,
      currency = coalesce(v_currency, 'THB')
  where id = v_order_id;

  return v_order_id;
end;
$$;

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
    select oi.product_id, oi.quantity, p.is_unlimited
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = v_order.id
    for update of p
  loop
    if not v_item.is_unlimited then
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
    select oi.product_id, oi.quantity, p.is_unlimited, p.stock_reserved, p.stock_sold, p.stock_total
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = v_order.id
    for update of p
  loop
    if v_item.is_unlimited then
      continue;
    end if;

    v_reserved := least(coalesce(v_item.stock_reserved, 0), v_item.quantity);
    v_missing := v_item.quantity - v_reserved;
    v_unreserved_available := coalesce(v_item.stock_total, 0) - coalesce(v_item.stock_sold, 0) - coalesce(v_item.stock_reserved, 0);

    if v_missing > v_unreserved_available then
      raise exception 'insufficient_stock_on_complete';
    end if;

    update public.products
    set stock_reserved = greatest(stock_reserved - v_reserved, 0),
        stock_sold = stock_sold + v_item.quantity,
        updated_at = now()
    where id = v_item.product_id;
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

  insert into public.orders (event_id, queue_id, status, total_price, currency, payment_method)
  values (p_event_id, null, 'completed', 0, 'THB', p_payment_method)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::integer, 1));

    select p.* into v_product
    from public.products p
    where p.id = (v_item ->> 'product_id')::uuid
      and p.artist_id = v_event.artist_id
      and p.deleted_at is null
      and p.status = 'enable'
    for update;

    if v_product.id is null then
      raise exception 'invalid_product';
    end if;

    if v_currency is null then
      v_currency := v_product.currency;
    elsif v_currency <> v_product.currency then
      raise exception 'mixed_currency_not_allowed';
    end if;

    if not v_product.is_unlimited then
      v_available := coalesce(v_product.stock_total, 0) - coalesce(v_product.stock_reserved, 0) - coalesce(v_product.stock_sold, 0);
      if v_available < v_qty then
        raise exception 'insufficient_stock';
      end if;

      update public.products
      set stock_sold = stock_sold + v_qty,
          updated_at = now()
      where id = v_product.id;
    end if;

    insert into public.order_items (order_id, product_id, quantity, price_per_unit, notes, currency)
    values (
      v_order_id,
      v_product.id,
      v_qty,
      v_product.price,
      coalesce(v_item ->> 'notes', ''),
      v_product.currency
    );

    v_total := v_total + (v_product.price * v_qty);
  end loop;

  update public.orders
  set total_price = v_total,
      currency = coalesce(v_currency, 'THB')
  where id = v_order_id;

  return v_order_id;
end;
$$;

-- 6) ETA helper
create or replace function public.estimate_queue_eta(
  p_event_id uuid,
  p_queue_number integer
)
returns table (
  people_ahead integer,
  average_service_seconds numeric,
  eta_min_minutes integer,
  eta_max_minutes integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_people integer := 0;
  v_avg_seconds numeric := 90;
  v_eta numeric := 0;
begin
  select count(*)::integer
  into v_people
  from public.queues q
  where q.event_id = p_event_id
    and q.queue_number < p_queue_number
    and q.status in ('waiting', 'calling', 'serving');

  select coalesce(avg(extract(epoch from (q.completed_at - q.served_at))), 90)
  into v_avg_seconds
  from (
    select served_at, completed_at
    from public.queues
    where event_id = p_event_id
      and status = 'complete'
      and served_at is not null
      and completed_at is not null
    order by completed_at desc
    limit 30
  ) q;

  if v_avg_seconds <= 0 then
    v_avg_seconds := 90;
  end if;

  v_eta := (v_people * v_avg_seconds) / 60.0;

  return query
  select
    v_people,
    v_avg_seconds,
    ceil(v_eta * 0.7)::integer,
    ceil(v_eta * 1.3)::integer;
end;
$$;

-- 7) Staff access policies for queue/POS
DROP POLICY IF EXISTS "queues_staff_read" ON public.queues;
DROP POLICY IF EXISTS "queues_staff_update" ON public.queues;
DROP POLICY IF EXISTS "orders_queue_pos_manage" ON public.orders;
DROP POLICY IF EXISTS "order_items_queue_pos_manage" ON public.order_items;

create policy "queues_staff_read"
  on public.queues
  for select
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'queue_only', 'queue_pos']));

create policy "queues_staff_update"
  on public.queues
  for update
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'queue_only', 'queue_pos']))
  with check (public.has_artist_role(artist_id, array['owner', 'queue_only', 'queue_pos']));

create policy "orders_queue_pos_manage"
  on public.orders
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.events e
      where e.id = orders.event_id
        and public.has_artist_role(e.artist_id, array['owner', 'queue_pos'])
    )
  )
  with check (
    exists (
      select 1
      from public.events e
      where e.id = orders.event_id
        and public.has_artist_role(e.artist_id, array['owner', 'queue_pos'])
    )
  );

create policy "order_items_queue_pos_manage"
  on public.order_items
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      join public.events e on e.id = o.event_id
      where o.id = order_items.order_id
        and public.has_artist_role(e.artist_id, array['owner', 'queue_pos'])
    )
  )
  with check (
    exists (
      select 1
      from public.orders o
      join public.events e on e.id = o.event_id
      where o.id = order_items.order_id
        and public.has_artist_role(e.artist_id, array['owner', 'queue_pos'])
    )
  );

-- 8) Grants for RPCs
grant execute on function public.has_artist_role(uuid, text[]) to authenticated;
grant execute on function public.get_actor_context() to authenticated;
grant execute on function public.set_artist_queue_broadcast(uuid, text) to authenticated;
grant execute on function public.set_booth_open_status(uuid, boolean) to authenticated;
grant execute on function public.create_customer_order_with_stock(uuid, jsonb) to anon, authenticated;
grant execute on function public.cancel_customer_order_with_stock_release(uuid) to anon, authenticated;
grant execute on function public.complete_order_with_stock(uuid, text) to authenticated;
grant execute on function public.create_walkin_order_with_stock(uuid, jsonb, text) to authenticated;
grant execute on function public.estimate_queue_eta(uuid, integer) to anon, authenticated;
