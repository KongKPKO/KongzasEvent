-- Add a browser-scoped anonymous customer fingerprint so queue ticket creation
-- can be idempotent even when the local ticket id is stale, missing, or a
-- mutation is retried. Fingerprints are opaque client-generated ids; they are
-- not authentication credentials and are only used to deduplicate active queue
-- tickets for the same artist/event/service date.

alter table public.queues
  add column if not exists customer_fingerprint text;

create unique index if not exists queues_active_customer_fingerprint_uidx
  on public.queues (artist_id, event_id, queue_service_date, customer_fingerprint)
  where event_id is not null
    and queue_service_date is not null
    and customer_fingerprint is not null
    and status in ('waiting', 'calling', 'serving');

drop function if exists public.create_queue_ticket(uuid, uuid);
drop function if exists public.create_queue_ticket(uuid, uuid, text);

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

grant execute on function public.create_queue_ticket(uuid, uuid, text) to anon, authenticated;
