-- Issue queue tickets atomically per event. This prevents duplicate queue
-- numbers when multiple customers join at the same time.

create unique index if not exists queues_event_queue_number_uidx
  on public.queues (event_id, queue_number)
  where event_id is not null;

create or replace function public.create_queue_ticket(
  p_artist_id uuid,
  p_event_id uuid
)
returns table (
  id uuid,
  event_id uuid,
  queue_number integer,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
  v_next_number integer;
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

  select coalesce(max(q.queue_number), 0) + 1
  into v_next_number
  from public.queues q
  where q.event_id = p_event_id;

  return query
  insert into public.queues (artist_id, event_id, queue_number, status)
  values (p_artist_id, p_event_id, v_next_number, 'waiting')
  returning queues.id, queues.event_id, queues.queue_number, queues.status, queues.created_at;
end;
$$;

grant execute on function public.create_queue_ticket(uuid, uuid) to anon, authenticated;
