-- Rebalance ETA estimation to reduce outlier impact and reflect call cadence.
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
begin
  select count(*)::integer
  into v_people
  from public.queues q
  where q.event_id = p_event_id
    and q.queue_number < p_queue_number
    and q.status in ('waiting', 'calling', 'serving');

  -- Robust service duration estimate from recent completed queues.
  select percentile_cont(0.5) within group (order by s.service_seconds)
  into v_service_seconds
  from (
    select least(greatest(extract(epoch from (q.completed_at - q.served_at)), 20), 600) as service_seconds
    from public.queues q
    where q.event_id = p_event_id
      and q.status = 'complete'
      and q.served_at is not null
      and q.completed_at is not null
    order by q.completed_at desc
    limit 80
  ) s;

  -- Queue movement cadence from called timestamps.
  with recent_calls as (
    select called_at
    from public.queues
    where event_id = p_event_id
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
    -- Bias toward call cadence so customer-facing ETA feels closer to real queue movement.
    v_effective_seconds := (v_call_seconds * 0.7) + (v_service_seconds * 0.3);
  elsif v_call_seconds is not null then
    v_effective_seconds := v_call_seconds;
  elsif v_service_seconds is not null then
    v_effective_seconds := v_service_seconds;
  else
    v_effective_seconds := 75;
  end if;

  -- Keep ETA within a practical UX range and avoid extreme values.
  v_effective_seconds := least(180, greatest(30, v_effective_seconds));

  if v_people <= 0 then
    return query
    select
      0,
      v_effective_seconds,
      0,
      0;
    return;
  end if;

  v_eta := (v_people * v_effective_seconds) / 60.0;
  v_min := greatest(1, floor(v_eta * 0.8)::integer);
  v_max := greatest(v_min, ceil(v_eta * 1.2)::integer);

  return query
  select
    v_people,
    v_effective_seconds,
    v_min,
    v_max;
end;
$$;

grant execute on function public.estimate_queue_eta(uuid, integer) to anon, authenticated;
