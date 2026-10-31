create or replace function public.unpublish_artist_public_booth(p_artist_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_artist_role(p_artist_id, array['owner', 'manager']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.artists set is_public = false, updated_at = now()
  where id = p_artist_id;
  if not found then raise exception 'artist_not_found'; end if;
  return true;
end;
$$;
revoke all on function public.unpublish_artist_public_booth(uuid) from public, anon;
grant execute on function public.unpublish_artist_public_booth(uuid) to authenticated;

-- Do not allow a direct customer RPC to bypass storefront visibility.
create or replace function public.create_queue_ticket(
  p_artist_id uuid,
  p_event_id uuid,
  p_customer_fingerprint text default null
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
  v_customer_fingerprint text;
begin
  v_customer_fingerprint := nullif(left(btrim(p_customer_fingerprint), 128), '');

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

  perform 1 from public.artists a where a.id = p_artist_id and a.is_public and a.is_verified for share;
  if not found then
    raise exception 'artist_not_public';
  end if;

  v_service_date := (
    now() at time zone coalesce(nullif(v_event.event_timezone, ''), 'Asia/Bangkok')
  )::date;

  if v_customer_fingerprint is not null then
    return query
    select q.id, q.event_id, q.queue_number, q.status, q.created_at, q.queue_service_date
    from public.queues q
    where q.artist_id = p_artist_id
      and q.event_id = p_event_id
      and q.queue_service_date = v_service_date
      and q.customer_fingerprint = v_customer_fingerprint
      and q.status in ('waiting', 'calling', 'serving')
    order by q.created_at asc
    limit 1;

    if found then
      return;
    end if;
  end if;

  select coalesce(max(q.queue_number), 0) + 1
  into v_next_number
  from public.queues q
  where q.event_id = p_event_id
    and q.queue_service_date = v_service_date;

  return query
  insert into public.queues (artist_id, event_id, queue_number, status, queue_service_date, customer_fingerprint)
  values (p_artist_id, p_event_id, v_next_number, 'waiting', v_service_date, v_customer_fingerprint)
  returning queues.id, queues.event_id, queues.queue_number, queues.status, queues.created_at, queues.queue_service_date;
end;
$$;

-- Existing queue tickets cannot be used to place new customer orders while hidden.
create or replace function public.create_customer_order_with_stock(
  p_queue_id uuid, p_items jsonb, p_customer_fingerprint text,
  p_payment_idempotency_key uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_fingerprint text; v_artist_id uuid;
begin
  select q.customer_fingerprint, q.artist_id into v_fingerprint, v_artist_id
  from public.queues q where q.id = p_queue_id for update;
  if v_fingerprint is null or p_customer_fingerprint is null
     or v_fingerprint !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_fingerprint <> p_customer_fingerprint then
    raise exception 'ticket_ownership_mismatch';
  end if;
  perform 1 from public.artists a where a.id = v_artist_id and a.is_public and a.is_verified for share;
  if not found then raise exception 'artist_not_public'; end if;
  return private.create_customer_order_authorized(p_queue_id, p_items, p_payment_idempotency_key);
end $$;
