begin;
select no_plan();
create temporary table schedule_ids as select gen_random_uuid() artist, gen_random_uuid() upcoming, gen_random_uuid() active, gen_random_uuid() ended, gen_random_uuid() event;
insert into public.artists(id,slug,display_name) select artist,'schedule-guard-test','Schedule test' from schedule_ids;
insert into public.online_campaigns(id,artist_id,name,slug,opens_at,closes_at,publication_status)
select upcoming,artist,'Upcoming','schedule-upcoming',now()+interval '1 day',now()+interval '2 days','published' from schedule_ids
union all select active,artist,'Active','schedule-active',now()-interval '1 day',now()+interval '1 day','published' from schedule_ids
union all select ended,artist,'Ended','schedule-ended',now()-interval '2 days',now()-interval '1 day','published' from schedule_ids;
select lives_ok($$update public.online_campaigns set closes_at=closes_at+interval '1 day' where id=(select upcoming from schedule_ids)$$,'upcoming campaign end can be extended');
select lives_ok($$update public.online_campaigns set closes_at=closes_at+interval '1 day' where id=(select active from schedule_ids)$$,'active campaign end can be extended');
select throws_ok($$update public.online_campaigns set opens_at=opens_at-interval '1 hour' where id=(select active from schedule_ids)$$,'campaign_schedule_already_started','active campaign start is locked');
select throws_ok($$update public.online_campaigns set closes_at=now()+interval '1 day' where id=(select ended from schedule_ids)$$,'campaign_schedule_ended','expired campaign cannot reopen');
insert into public.events(id,artist_id,event_name,start_date,end_date,status,postorder_enabled,postorder_opens_at,postorder_closes_at)
select event,artist,'Event',now()-interval '3 days',now()-interval '2 days','Ended',true,now()-interval '1 day',now()+interval '1 day' from schedule_ids;
select lives_ok($$update public.events set postorder_closes_at=postorder_closes_at+interval '1 day' where id=(select event from schedule_ids)$$,'active postorder can be extended after event ends');
select throws_ok($$update public.events set end_date=now()+interval '1 day' where id=(select event from schedule_ids)$$,'event_schedule_ended','ended event cannot reopen');
select throws_ok($$update public.events set postorder_closes_at=postorder_closes_at-interval '1 hour' where id=(select event from schedule_ids)$$,'event_postorder_schedule_ended','postorder cannot be shortened after event ends');
select * from finish();
rollback;
