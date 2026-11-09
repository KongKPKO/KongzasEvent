begin;
select no_plan();
create temp table eta_ids as select gen_random_uuid() artist,gen_random_uuid() event;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role)
select artist,'queue-eta@example.test','{}','{}','authenticated','authenticated' from eta_ids;
insert into public.artists(id,slug,display_name) select artist,'queue-eta-test','Queue ETA test' from eta_ids;
insert into public.events(id,artist_id,event_name,start_date,end_date,event_timezone,status,is_booth_open)
select event,artist,'Queue ETA test',now()-interval '1 hour',now()+interval '1 day','Asia/Bangkok','Confirmed',true from eta_ids;
insert into public.queues(id,artist_id,event_id,queue_number,status,queue_service_date)
select gen_random_uuid(),artist,event,n,case when n=1 then 'calling' else 'waiting' end,(now() at time zone 'Asia/Bangkok')::date
from eta_ids cross join generate_series(1,7) n;
select is((select people_ahead from public.estimate_queue_eta((select event from eta_ids),2)),0,'called no-show does not block the next batch');
select is((select eta_min_minutes from public.estimate_queue_eta((select event from eta_ids),2)),14,'initial minimum uses the sample batch range');
select is((select eta_max_minutes from public.estimate_queue_eta((select event from eta_ids),2)),52,'initial maximum uses the sample batch range');
select is((select eta_min_minutes from public.estimate_queue_eta((select event from eta_ids),7)),28,'six waiting tickets require two initial batches');
select is((select eta_max_minutes from public.estimate_queue_eta((select event from eta_ids),7)),104,'two initial batches retain the wide range');
insert into private.queue_call_batches(event_id,request_id,actor_id,batch_size,queue_ids,created_at)
select event,gen_random_uuid(),artist,5,array_fill(gen_random_uuid(),array[5]),now()-make_interval(mins=>n)
from eta_ids cross join unnest(array[6,4,2,0]) n;
select ok((select eta_min_minutes between 1 and 2 and eta_max_minutes between 2 and 3 from public.estimate_queue_eta((select event from eta_ids),2)),'observed calls replace the sample with current batch timing');
select ok((select eta_min_minutes between 3 and 4 and eta_max_minutes between 4 and 5 from public.estimate_queue_eta((select event from eta_ids),7)),'observed timing scales in batches');
delete from private.queue_call_batches where event_id=(select event from eta_ids);
insert into private.queue_call_batches(event_id,request_id,actor_id,batch_size,queue_ids,created_at)
select event,gen_random_uuid(),artist,5,array_fill(gen_random_uuid(),array[5]),now()-interval '60 minutes' from eta_ids;
select ok((select eta_min_minutes is null and eta_max_minutes is null from public.estimate_queue_eta((select event from eta_ids),2)),'an overdue call is shown as uncertain instead of a false imminent promise');
select is((select count(*) from public.estimate_queue_eta(gen_random_uuid(),2)),0::bigint,'unknown event has no estimate');
select ok(has_function_privilege('anon','public.estimate_queue_eta(uuid,integer)','EXECUTE'),'customers may still request the estimate');
select * from finish();
rollback;
