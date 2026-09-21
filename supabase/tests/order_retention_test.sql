begin;
select plan(13);
create temp table retention_test_ids as select gen_random_uuid() artist,gen_random_uuid() event;
insert into public.artists(id,slug,display_name) select artist,'retention-test','Retention' from retention_test_ids;
insert into public.events(id,artist_id,event_name,start_date,end_date,status) select event,artist,'Retention',now(),now()+interval '1 day','Confirmed' from retention_test_ids;
insert into public.orders(event_id,status,order_type,pickup_code,customer_name,picked_up_at)
select event,'completed','pos_walkin','RETAIN'||months,'Private name',now()-make_interval(months=>months) from retention_test_ids cross join (values(5),(7),(13)) ages(months);
select is((select retention_completed_at from public.orders where pickup_code='RETAIN7'),now()-interval '7 months','completion anchored to fulfillment');
select public.prepare_order_retention();
select is((select customer_name from public.orders where pickup_code='RETAIN5'),'Private name','under six months remains');
select is((select customer_name from public.orders where pickup_code='RETAIN7'),null::text,'over six months clears PII');
select ok((select financial_evidence_queued_at is null from public.orders where pickup_code='RETAIN7'),'financial evidence retained before twelve months');
select ok((select financial_evidence_queued_at is not null from public.orders where pickup_code='RETAIN13'),'financial retention starts after twelve months');
insert into public.order_problem_reports(id,order_id,artist_id,source,category,description,contact)
select gen_random_uuid(),o.id,t.artist,'customer','other','A later dispute','contact@example.test' from public.orders o cross join retention_test_ids t where pickup_code='RETAIN7';
select public.prepare_order_retention();
select is((select description from public.order_problem_reports r join public.orders o on o.id=r.order_id where pickup_code='RETAIN7'),'A later dispute','open report remains despite prior PII purge');
update public.order_problem_reports set status='resolved',resolved_at=now() where order_id=(select id from public.orders where pickup_code='RETAIN7');
select public.prepare_order_retention();
select is((select description from public.order_problem_reports r join public.orders o on o.id=r.order_id where pickup_code='RETAIN7'),'[Removed]','later resolved report is included in retention');
select ok(not has_function_privilege('authenticated','public.prepare_order_retention()','EXECUTE'),'authenticated cannot invoke retention');
select ok(not has_function_privilege('anon','public.claim_retention_files()','EXECUTE'),'anonymous cannot claim files');
insert into private.retention_files(bucket,path,order_id,reason)
select 'PaymentEvidence','retention-test.webp',id,'financial_retention' from public.orders where pickup_code='RETAIN13';
select is((select count(*)::integer from public.claim_retention_files() where path='retention-test.webp'),1,'eligible file is leased once');
select is((select count(*)::integer from public.claim_retention_files() where path='retention-test.webp'),0,'concurrent worker cannot claim active lease');
select ok((select retention_lock_until>now() from public.orders where pickup_code='RETAIN13'),'file lease guards a new dispute during deletion');
select public.finish_retention_file('PaymentEvidence','retention-test.webp');
select ok((select retention_lock_until is null from public.orders where pickup_code='RETAIN13'),'finishing final file releases dispute guard');
select * from finish();
rollback;
