begin;
select no_plan();
insert into auth.users (id,email) values ('e0000000-0000-4000-8000-000000000001','atomic@promotion.test');
insert into public.artists (id,slug,display_name) values ('e0000000-0000-4000-8000-000000000001','atomic-promo-test','Atomic');
select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into public.online_campaigns (id,artist_id,name,slug,opens_at,closes_at)
values ('e0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001','Atomic','atomic',now(),now()+interval '1 day');
insert into public.products (id,artist_id,name,price,is_unlimited)
values ('e0000000-0000-4000-8000-000000000003','e0000000-0000-4000-8000-000000000001','Cheki',100,true);
insert into public.online_campaign_products (campaign_id,artist_id,product_id,is_unlimited)
values ('e0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000003',true);
create temp table draft as select jsonb_build_object(
 'artist_id','e0000000-0000-4000-8000-000000000001','name','Original',
 'promotion_type','quantity_discount','target_type','all','buy_quantity',3,'reward_value',50,
 'assignments',jsonb_build_array(jsonb_build_object('campaign_id','e0000000-0000-4000-8000-000000000002','is_paused',false,'combination_policy','combine'))
) as payload;
create temp table original as select public.save_promotion_definition(payload) as id from draft;
update draft set payload = payload || jsonb_build_object('id',(select id from original),'name','Edited');
-- Seed the competing rule without the wrapper to reproduce an existing overlap.
insert into public.artist_promotions (id,artist_id,name,target_type,rule_type,promotion_type,buy_quantity,reward_value,lifecycle_status)
values ('e0000000-0000-4000-8000-000000000004','e0000000-0000-4000-8000-000000000001','Competing','all','discount','quantity_discount',3,30,'ready');
insert into public.promotion_assignments (promotion_id,artist_id,campaign_id,combination_policy)
values ('e0000000-0000-4000-8000-000000000004','e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002','combine');
create temp table before_state as select to_jsonb(p) as definition from public.artist_promotions p where id = (select id from original);

create function pg_temp.attempt_save(payload jsonb) returns jsonb language plpgsql as $$
declare details text;
begin
  perform public.save_promotion_definition(payload);
  return '{"saved":true}'::jsonb;
exception when others then
  get stacked diagnostics details = pg_exception_detail;
  return jsonb_build_object('message',sqlerrm,'details',case when details = '' then null else details::jsonb end);
end $$;
create temp table attempt as select pg_temp.attempt_save(payload) as result from draft;
select is((select result->>'message' from attempt),'promotion_conflict_confirmation_required','collision requires confirmation');
select is((select to_jsonb(p) from public.artist_promotions p where id=(select id from original)),(select definition from before_state),'cancelled attempt leaves original row and revision unchanged');
select ok((select bool_and(not is_paused) from public.promotion_assignments where promotion_id=(select id from original)),'original remains active while awaiting confirmation');
select is((select count(*) from public.artist_promotions where artist_id='e0000000-0000-4000-8000-000000000001'),2::bigint,'preview creates no extra definition');
update draft set payload=payload || jsonb_build_object('confirmation_token',(select result#>>'{details,confirmation_token}' from attempt));
select is((select pg_temp.attempt_save(payload)->>'saved' from draft),'true','confirmed save succeeds');
select is((select name from public.artist_promotions where id=(select id from original)),'Edited','new definition is committed');
select ok((select bool_and(not is_paused) from public.promotion_assignments where promotion_id=(select id from original)),'confirmed promotion remains active');
select is((select pg_temp.attempt_save(payload || '{"name":"Changed again"}'::jsonb)->>'message' from draft),'promotion_conflict_confirmation_required','token cannot confirm a different draft');
select is((select pg_temp.attempt_save(payload || '{"expected_revision":0}'::jsonb)->>'message' from draft),'promotion_changed','stale editor cannot overwrite newer revision');
update public.artist_promotions set reward_value=40 where id='e0000000-0000-4000-8000-000000000004';
select is((select pg_temp.attempt_save(payload)->>'message' from draft),'promotion_conflict_confirmation_required','changed competing offer requires fresh confirmation');
update public.promotion_assignments set is_paused=true where promotion_id='e0000000-0000-4000-8000-000000000004';
create temp table revision_before as select revision from public.artist_promotions where id=(select id from original);
select lives_ok($$select public.save_promotion_definition(payload) from draft$$,'no-conflict save succeeds');
select is((select revision from public.artist_promotions where id=(select id from original)),(select revision+1 from revision_before),'save advances revision even without commercial field changes');
select ok(not has_function_privilege('authenticated','private.save_promotion_definition_base(jsonb)','execute'),'base write path is inaccessible to API users');
select * from finish();
rollback;
