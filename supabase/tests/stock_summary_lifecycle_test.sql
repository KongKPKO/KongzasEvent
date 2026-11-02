begin;
select no_plan();
create temp table _summary_ids as select gen_random_uuid() artist, gen_random_uuid() product,
  gen_random_uuid() campaign, gen_random_uuid() event, gen_random_uuid() owner;
insert into auth.users(id,email) select owner,'summary-owner@example.local' from _summary_ids;
insert into public.artists(id,slug,display_name) select artist,'summary-fixture','Summary fixture' from _summary_ids;
insert into public.artist_members(artist_id,member_email,role,status)
select artist,'summary-owner@example.local','owner','active' from _summary_ids;
select set_config('request.jwt.claims',jsonb_build_object('sub',owner,'email','summary-owner@example.local','role','authenticated')::text,true) from _summary_ids;
insert into public.products(id,artist_id,name,price,stock_total,stock_reserved,stock_sold,is_unlimited)
select product,artist,'Summary product',100,30,0,0,false from _summary_ids;
insert into public.online_campaigns(id,artist_id,name,slug,opens_at,closes_at)
select campaign,artist,'Summary campaign','summary-campaign',now()-interval '1 hour',now()+interval '1 day' from _summary_ids;
insert into public.online_campaign_products(campaign_id,artist_id,product_id,stock_total,stock_reserved,stock_sold,is_unlimited)
select campaign,artist,product,20,0,0,false from _summary_ids;
create function pg_temp.summary_available() returns integer language sql as $$
  select available from public.list_product_stock_summaries((select artist from _summary_ids));
$$;
select is(pg_temp.summary_available(),10,'allocate 20 of 30 leaves 10');
update public.online_campaign_products set stock_sold=1 where campaign_id=(select campaign from _summary_ids);
select is(pg_temp.summary_available(),10,'campaign sale does not return stock');
update public.online_campaign_products set stock_reserved=1 where campaign_id=(select campaign from _summary_ids);
select is(pg_temp.summary_available(),10,'active campaign hold is not subtracted twice');
update public.online_campaigns set closes_at=now()-interval '1 minute' where id=(select campaign from _summary_ids);
select is(pg_temp.summary_available(),28,'closed campaign still commits sold and held units');
update public.online_campaign_products set stock_reserved=0 where campaign_id=(select campaign from _summary_ids);
select is(pg_temp.summary_available(),29,'released hold returns one unit, sold stays committed');
update public.online_campaigns set publication_status='archived' where id=(select campaign from _summary_ids);
select is(pg_temp.summary_available(),29,'archive does not restore sold stock');
insert into public.events(id,artist_id,event_name,start_date,end_date,status)
select event,artist,'Summary event',now()-interval '1 hour',now()+interval '1 day','Confirmed' from _summary_ids;
insert into public.event_products(event_id,artist_id,product_id,stock_total,stock_reserved,stock_sold,is_unlimited,is_enabled)
select event,artist,product,20,0,0,false,true from _summary_ids;
select is(pg_temp.summary_available(),9,'event allocation and historical campaign sale both count');
update public.event_products set is_enabled=false where event_id=(select event from _summary_ids);
select is(pg_temp.summary_available(),9,'hidden event retains its allocation');
select is(public.calculate_product_event_allocation_available((select product from _summary_ids),null),9,'hidden event allocation reduces capacity elsewhere');
select is(public.calculate_product_event_allocation_available((select product from _summary_ids),(select event from _summary_ids)),29,'hidden event can edit its own allocation');
select is(private.catalog_free_stock((select product from _summary_ids)),9,'production stock calculation includes hidden event allocation');
select is((private.inventory_overview((select artist from _summary_ids))->0->>'available')::integer,9,'inventory overview includes hidden event allocation');
select * from public.remove_event_stock((select id from public.event_products where event_id=(select event from _summary_ids)),2);
select is(pg_temp.summary_available(),11,'returning hidden event stock releases it for other channels');
select * from public.add_event_stock((select id from public.event_products where event_id=(select event from _summary_ids)),2);
select is(pg_temp.summary_available(),9,'adding hidden event stock reserves it again');
insert into public.online_campaigns(id,artist_id,name,slug,opens_at,closes_at)
select gen_random_uuid(),artist,'Other campaign','summary-other',now()-interval '1 hour',now()+interval '1 day' from _summary_ids;
select throws_ok($$insert into public.online_campaign_products(campaign_id,artist_id,product_id,stock_total,stock_reserved,stock_sold,is_unlimited,is_enabled) select c.id,s.artist,s.product,10,0,0,false,true from _summary_ids s join public.online_campaigns c on c.artist_id=s.artist and c.slug='summary-other'$$,'campaign_stock_exceeds_catalog_stock','campaign cannot take stock held by hidden event');
insert into public.online_campaign_products(campaign_id,artist_id,product_id,stock_total,stock_reserved,stock_sold,is_unlimited,is_enabled)
select c.id,s.artist,s.product,9,0,0,false,true from _summary_ids s join public.online_campaigns c on c.artist_id=s.artist and c.slug='summary-other';
select is(pg_temp.summary_available(),0,'campaign can allocate the remaining stock only');
select throws_ok($$update public.event_products set stock_total=21 where event_id=(select event from _summary_ids)$$,'event_stock_exceeds_catalog_stock','hidden event cannot overallocate');
update public.online_campaigns set publication_status='archived' where slug='summary-other';
update public.event_products set is_enabled=true where event_id=(select event from _summary_ids);
update public.event_products set stock_sold=1,stock_reserved=1 where event_id=(select event from _summary_ids);
select is(pg_temp.summary_available(),9,'event sale and hold stay inside its allocation');
select is(public.calculate_product_event_allocation_available((select product from _summary_ids),null),9,
  'event helper includes campaign sold stock and matches summary');
select is(public.calculate_product_event_allocation_available((select product from _summary_ids),(select event from _summary_ids)),28,
  'event edit limit excludes its own unsold allocation but not historical sales');
select throws_ok($$select * from public.add_event_stock((select id from public.event_products where event_id=(select event from _summary_ids)),10)$$,
  'insufficient_catalog_available_stock','increment cannot consume current allocation a second time');
update public.events set end_date=now()-interval '1 minute' where id=(select event from _summary_ids);
select is(pg_temp.summary_available(),27,'ended event preserves sold and held units');
update public.event_products set is_enabled=false where event_id=(select event from _summary_ids);
select is(pg_temp.summary_available(),27,'disabled event product preserves commitments');
update public.event_products set stock_reserved=0 where event_id=(select event from _summary_ids);
select is(pg_temp.summary_available(),28,'event hold release leaves both historical sales committed');
select throws_ok($$select * from public.remove_catalog_stock((select product from _summary_ids),29,'damaged')$$,
  'insufficient_catalog_available_stock','catalog removal cannot remove sold stock');
update public.products set stock_reserved=1,stock_sold=1 where id=(select product from _summary_ids);
select is(pg_temp.summary_available(),26,'legacy catalog sold and held units are also deducted');
select is((select on_hand from public.list_product_stock_summaries((select artist from _summary_ids))),30,'original total is not rewritten');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select * from public.list_product_stock_summaries((select artist from _summary_ids))$$,'forbidden','missing caller cannot read stock');
select throws_ok($$select public.calculate_product_event_allocation_available((select product from _summary_ids),null)$$,'forbidden','helper cannot bypass summary authorization');
select * from finish();
rollback;
