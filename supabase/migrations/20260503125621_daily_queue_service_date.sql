alter table public.queues
  add column if not exists queue_service_date date;

update public.queues q
set queue_service_date = (
  q.created_at at time zone coalesce(nullif(e.event_timezone, ''), 'Asia/Bangkok')
)::date
from public.events e
where q.event_id = e.id
  and q.queue_service_date is null;

update public.queues
set queue_service_date = (created_at at time zone 'Asia/Bangkok')::date
where event_id is not null
  and queue_service_date is null;

drop index if exists public.queues_event_queue_number_uidx;

create unique index if not exists queues_event_service_date_queue_number_uidx
  on public.queues (event_id, queue_service_date, queue_number)
  where event_id is not null and queue_service_date is not null;

create index if not exists idx_queues_event_service_date_status_number
  on public.queues (event_id, queue_service_date, status, queue_number);

alter table public.queues
  drop constraint if exists queues_event_service_date_required_chk;

alter table public.queues
  add constraint queues_event_service_date_required_chk
  check (event_id is null or queue_service_date is not null);

drop function if exists public.create_queue_ticket(uuid, uuid);

create or replace function public.create_queue_ticket(
  p_artist_id uuid,
  p_event_id uuid
)
returns table (
  id uuid,
  event_id uuid,
  queue_number integer,
  status text,
  created_at timestamptz,
  queue_service_date date
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
  v_next_number integer;
  v_service_date date;
begin
  select e.*
  into v_event
  from public.events e
  where e.id = p_event_id
    and e.artist_id = p_artist_id
  for update;

  if v_event.id is null then
    raise exception 'event_not_found';
  end if;

  if v_event.status <> 'Confirmed' then
    raise exception 'event_not_active';
  end if;

  if v_event.is_booth_open is not true then
    raise exception 'booth_closed';
  end if;

  if v_event.start_date > now() or v_event.end_date < now() then
    raise exception 'event_not_in_window';
  end if;

  v_service_date := (
    now() at time zone coalesce(nullif(v_event.event_timezone, ''), 'Asia/Bangkok')
  )::date;

  select coalesce(max(q.queue_number), 0) + 1
  into v_next_number
  from public.queues q
  where q.event_id = p_event_id
    and q.queue_service_date = v_service_date;

  return query
  insert into public.queues (artist_id, event_id, queue_number, status, queue_service_date)
  values (p_artist_id, p_event_id, v_next_number, 'waiting', v_service_date)
  returning queues.id, queues.event_id, queues.queue_number, queues.status, queues.created_at, queues.queue_service_date;
end;
$$;

grant execute on function public.create_queue_ticket(uuid, uuid) to anon, authenticated;

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

grant execute on function public.create_customer_order_with_stock(uuid, jsonb) to anon, authenticated;

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
  v_service_seconds numeric;
  v_call_seconds numeric;
  v_effective_seconds numeric := 75;
  v_eta numeric := 0;
  v_min integer := 0;
  v_max integer := 0;
  v_service_date date;
begin
  select (now() at time zone coalesce(nullif(e.event_timezone, ''), 'Asia/Bangkok'))::date
  into v_service_date
  from public.events e
  where e.id = p_event_id;

  select count(*)::integer
  into v_people
  from public.queues q
  where q.event_id = p_event_id
    and q.queue_service_date = v_service_date
    and q.queue_number < p_queue_number
    and q.status in ('waiting', 'calling', 'serving');

  select percentile_cont(0.5) within group (order by s.service_seconds)
  into v_service_seconds
  from (
    select least(greatest(extract(epoch from (q.completed_at - q.served_at)), 20), 600) as service_seconds
    from public.queues q
    where q.event_id = p_event_id
      and q.queue_service_date = v_service_date
      and q.status = 'complete'
      and q.served_at is not null
      and q.completed_at is not null
    order by q.completed_at desc
    limit 80
  ) s;

  with recent_calls as (
    select called_at
    from public.queues
    where event_id = p_event_id
      and queue_service_date = v_service_date
      and called_at is not null
    order by called_at desc
    limit 80
  ),
  call_intervals as (
    select extract(epoch from (rc.called_at - lag(rc.called_at) over (order by rc.called_at asc))) as call_interval_seconds
    from recent_calls rc
  )
  select percentile_cont(0.5) within group (order by ci.call_interval_seconds)
  into v_call_seconds
  from call_intervals ci
  where ci.call_interval_seconds between 10 and 600;

  if v_call_seconds is not null and v_service_seconds is not null then
    v_effective_seconds := (v_call_seconds * 0.7) + (v_service_seconds * 0.3);
  elsif v_call_seconds is not null then
    v_effective_seconds := v_call_seconds;
  elsif v_service_seconds is not null then
    v_effective_seconds := v_service_seconds;
  else
    v_effective_seconds := 75;
  end if;

  v_effective_seconds := least(180, greatest(30, v_effective_seconds));

  if v_people <= 0 then
    return query select 0, v_effective_seconds, 0, 0;
    return;
  end if;

  v_eta := (v_people * v_effective_seconds) / 60.0;
  v_min := greatest(1, floor(v_eta * 0.8)::integer);
  v_max := greatest(v_min, ceil(v_eta * 1.2)::integer);

  return query select v_people, v_effective_seconds, v_min, v_max;
end;
$$;

grant execute on function public.estimate_queue_eta(uuid, integer) to anon, authenticated;
