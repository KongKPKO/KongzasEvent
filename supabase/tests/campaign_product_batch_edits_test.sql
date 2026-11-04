begin;
select no_plan();
create temp table batch_ids as select gen_random_uuid() artist, gen_random_uuid() owner, gen_random_uuid() campaign, gen_random_uuid() a, gen_random_uuid() b;
insert into auth.users(id,email) select owner,'batch-owner@example.local' from batch_ids;
insert into public.artists(id,slug,display_name) select artist,'batch-fixture','Batch fixture' from batch_ids;
insert into public.artist_members(artist_id,member_email,role,status) select artist,'batch-owner@example.local','owner','active' from batch_ids;
select set_config('request.jwt.claims',jsonb_build_object('sub',owner,'email','batch-owner@example.local','role','authenticated')::text,true) from batch_ids;
insert into public.products(id,artist_id,name,price,stock_total,is_unlimited) select a,artist,'Batch A',100,20,false from batch_ids union all select b,artist,'Batch B',100,20,false from batch_ids;
insert into public.online_campaigns(id,artist_id,name,slug,opens_at,closes_at) select campaign,artist,'Batch','batch-test',now()-interval '1 hour',now()+interval '1 day' from batch_ids;
insert into public.online_campaign_products(campaign_id,artist_id,product_id,stock_total,is_unlimited,is_enabled) select campaign,artist,a,5,false,true from batch_ids union all select campaign,artist,b,5,false,true from batch_ids;
create function pg_temp.batch_payload() returns jsonb language sql as $$
 select jsonb_agg(jsonb_build_object('product_id',p,'is_enabled',true,'is_unlimited',false,'stock_total',6,'price_override',90,'max_quantity_per_order',2,'expected',jsonb_build_object('stock_total',5,'price_override',null,'max_quantity_per_order',null,'is_unlimited',false))) from (select a p from batch_ids union all select b from batch_ids) x
$$;
select lives_ok($$select public.save_campaign_product_edits((select campaign from batch_ids),pg_temp.batch_payload())$$,'saves several product edits atomically');
select is((select count(*) from public.online_campaign_products where campaign_id=(select campaign from batch_ids) and stock_total=6 and price_override=90 and max_quantity_per_order=2),2::bigint,'stock price and limits saved for both');
select throws_ok($$select public.save_campaign_product_edits((select campaign from batch_ids),pg_temp.batch_payload())$$,'campaign_product_changed','stale edit is rejected');
select is((select count(*) from public.online_campaign_products where campaign_id=(select campaign from batch_ids) and stock_total=6 and price_override=90 and max_quantity_per_order=2),2::bigint,'stale save leaves all values unchanged');
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
select throws_ok($$select public.save_campaign_product_edits((select campaign from batch_ids),pg_temp.batch_payload())$$,'forbidden','unrelated user cannot save campaign');
select * from finish();
rollback;
