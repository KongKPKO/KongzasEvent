-- Estimate time until the next call, using batch throughput rather than service duration.
create or replace function public.estimate_queue_eta(p_event_id uuid, p_queue_number integer)
returns table (people_ahead integer, average_service_seconds numeric, eta_min_minutes integer, eta_max_minutes integer)
language plpgsql security definer set search_path = '' as $$
declare
 v_date date;
 v_tz text;
 v_ahead integer;
 v_samples integer;
 v_low numeric;
 v_middle numeric;
 v_high numeric;
 v_position integer;
 v_batch_size integer;
 v_batches integer;
 v_last_call timestamptz;
 v_elapsed numeric := 0;
 v_min integer;
 v_max integer;
begin
 select coalesce(nullif(event_timezone,''),'Asia/Bangkok') into v_tz from public.events where id=p_event_id;
 if v_tz is null or p_queue_number is null or p_queue_number < 1 then return; end if;
 v_date := (now() at time zone v_tz)::date;
 select count(*)::integer into v_ahead from public.queues q
 where q.event_id=p_event_id and q.queue_service_date=v_date
   and q.queue_number<p_queue_number and q.status in ('waiting','queued');

 with recent as (
  select created_at, request_id, cardinality(queue_ids) as called_count
  from private.queue_call_batches
  where event_id=p_event_id and (created_at at time zone v_tz)::date=v_date
    and cardinality(queue_ids)>0
  order by created_at desc, request_id desc limit 11
 ), intervals as (
  select called_count, extract(epoch from (created_at-lag(created_at) over (order by created_at,request_id))) / called_count as seconds_per_ticket
  from recent
 )
 select count(*)::integer,
        percentile_cont(0.1) within group (order by seconds_per_ticket),
        percentile_cont(0.5) within group (order by seconds_per_ticket),
        percentile_cont(0.9) within group (order by seconds_per_ticket),
        greatest(1,round(percentile_cont(0.5) within group (order by called_count))::integer)
 into v_samples,v_low,v_middle,v_high,v_batch_size from intervals where seconds_per_ticket>0;

 if v_samples < 3 then
  -- shortcut: initial range uses one event, replace it after three observed intervals.
  v_low:=14*60; v_middle:=254.0*60/9; v_high:=52*60; v_batch_size:=5;
 else
  v_low:=v_low*v_batch_size; v_middle:=v_middle*v_batch_size; v_high:=v_high*v_batch_size;
 end if;
 select max(created_at) into v_last_call from private.queue_call_batches
 where event_id=p_event_id and (created_at at time zone v_tz)::date=v_date and cardinality(queue_ids)>0;
 if v_last_call is not null then
  v_elapsed := greatest(0,extract(epoch from (clock_timestamp()-v_last_call)));
  if v_elapsed > v_high then return query select v_ahead,v_middle/v_batch_size,null::integer,null::integer; return; end if;
 end if;
 v_position := v_ahead+1;
 v_batches := ceil(v_position::numeric/v_batch_size)::integer;
 v_min := greatest(1,floor((v_batches*v_low-v_elapsed)/60)::integer);
 v_max := greatest(v_min,ceil((v_batches*v_high-v_elapsed)/60)::integer);
 return query select v_ahead,v_middle/v_batch_size,v_min,v_max;
end $$;
