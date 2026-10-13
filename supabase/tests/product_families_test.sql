begin;
select no_plan();
create temp table family_ids as select gen_random_uuid() artist,gen_random_uuid() other_artist,gen_random_uuid() owner,gen_random_uuid() other_owner;
insert into auth.users(id,email) select owner,'family-owner@example.local' from family_ids union all select other_owner,'family-other@example.local' from family_ids;
insert into public.artists(id,slug,display_name,is_public,is_verified,published_at)
select artist,'family-fixture','Family fixture',true,true,now() from family_ids
union all select other_artist,'family-other','Other fixture',false,false,null from family_ids;
insert into public.artist_members(artist_id,member_email,role,status)
select artist,'family-owner@example.local','owner','active' from family_ids
union all select artist,'family-seller@example.local','seller','active' from family_ids;
select set_config('request.jwt.claims',jsonb_build_object('sub',owner,'email','family-owner@example.local','role','authenticated')::text,true) from family_ids;
create temp table saved_family(id uuid);
insert into saved_family select public.save_product_family(null,jsonb_build_object('artist_id',artist,'name','Traveler stand','base_price',120,'product_kind','photo','gallery_images',jsonb_build_array('a','b','c','d','e')),
  '[{"name":"Aether","sku":"FAM-A","stock_total":10,"is_unlimited":false},{"name":"Lumine","sku":"FAM-L","stock_total":8,"price_override":130,"is_unlimited":false}]') from family_ids;
select is((select count(*)::integer from public.products where parent_product_id=(select id from saved_family)),2,'two sellable children under one parent');
select is((select price from public.products where sku='FAM-A'),120::numeric,'null override inherits base');
select is((select price from public.products where sku='FAM-L'),130::numeric,'explicit variant price preserved');
select is((select jsonb_array_length(gallery_images) from public.products where sku='FAM-A'),5,'presentation copied to checkout projection');
create function pg_temp.family_payload() returns jsonb language sql as $$
select to_jsonb(p) from public.product_parents p where id=(select id from saved_family)
$$;
create function pg_temp.variant_payload() returns jsonb language sql as $$
select jsonb_agg(jsonb_build_object('id',id,'name',variant_name,'sku',sku,'price_override',price_override,'stock_total',stock_total,'is_unlimited',is_unlimited,'status',status,'variant_sort_order',variant_sort_order) order by sku) from public.products where parent_product_id=(select id from saved_family) and deleted_at is null
$$;
select lives_ok($$select public.save_product_family((select id from saved_family),pg_temp.family_payload()||'{"base_price":150}',pg_temp.variant_payload())$$,'change shared base price');
select is((select price from public.products where sku='FAM-A'),150::numeric,'inherited price follows base');
select is((select price from public.products where sku='FAM-L'),130::numeric,'override unaffected by base change');
select lives_ok($$select public.save_product_family((select id from saved_family),pg_temp.family_payload(),jsonb_set(pg_temp.variant_payload(),'{0,price_override}','0'))$$,'zero is a valid override');
select is((select price from public.products where sku='FAM-A'),0::numeric,'zero does not fall back to base');
select throws_ok($$select public.save_product_family((select id from saved_family),pg_temp.family_payload()||'{"updated_at":"2000-01-01T00:00:00Z"}',pg_temp.variant_payload())$$,'product_family_changed_reload','stale family save rejected');
update public.products set stock_reserved=6 where sku='FAM-A';
select throws_ok($$select public.save_product_family((select id from saved_family),pg_temp.family_payload()||'{"name":"Must roll back"}',jsonb_set(pg_temp.variant_payload(),'{0,stock_total}','2'))$$,'insufficient_catalog_available_stock','cannot remove held units');
select is((select name from public.product_parents where id=(select id from saved_family)),'Traveler stand','failed stock save rolls parent back');
select throws_ok($$select public.save_product_family((select id from saved_family),pg_temp.family_payload(),jsonb_build_array(pg_temp.variant_payload()->1))$$,'variant_in_use_disable_in_channels_first','cannot remove held child');
select throws_ok($$select public.save_product_family((select id from saved_family),pg_temp.family_payload(),jsonb_set(pg_temp.variant_payload(),'{1,name}','"Aether"'))$$,'duplicate_variant_name','duplicate names rejected');
select throws_ok($$select public.save_product_family((select id from saved_family),pg_temp.family_payload(),jsonb_set(pg_temp.variant_payload(),'{1,id}',to_jsonb(gen_random_uuid()::text)))$$,'variant_not_in_family','unknown or foreign child rejected');
select set_config('request.jwt.claims',jsonb_build_object('sub',other_owner,'email','family-other@example.local','role','authenticated')::text,true) from family_ids;
select throws_ok($$select public.save_product_family((select id from saved_family),pg_temp.family_payload(),pg_temp.variant_payload())$$,'forbidden','cross-shop write forbidden');
select set_config('request.jwt.claims',jsonb_build_object('sub',other_owner,'email','family-seller@example.local','role','authenticated')::text,true) from family_ids;
select throws_ok($$select public.save_product_family((select id from saved_family),pg_temp.family_payload(),pg_temp.variant_payload())$$,'forbidden','seller cannot edit family');
select set_config('request.jwt.claims',jsonb_build_object('sub',owner,'email','family-owner@example.local','role','authenticated')::text,true) from family_ids;
update public.products set stock_reserved=0 where sku='FAM-A';
select lives_ok($$select public.save_product_family((select id from saved_family),pg_temp.family_payload(),jsonb_build_array(pg_temp.variant_payload()->1))$$,'unallocated variant can be removed');
select ok((select deleted_at is not null from public.products where sku='FAM-A'),'removed child is archived retaining its UUID');
insert into public.products(artist_id,name,price) select artist,'Legacy simple',50 from family_ids;
select ok((select parent_product_id is not null from public.products where name='Legacy simple'),'legacy simple insert receives parent');
select is((select price from public.products where name='Legacy simple'),50::numeric,'legacy insert preserves price');
set local role anon;
select is((select count(*)::integer from public.product_parents where name='Traveler stand'),1,'public can read visible published family');
reset role;
update public.artists set is_public=false where id=(select artist from family_ids);
set local role anon;
select is((select count(*)::integer from public.product_parents where name='Traveler stand'),0,'unpublished shop parent is hidden');
select ok(not has_function_privilege('anon','public.save_product_family(uuid,jsonb,jsonb)','EXECUTE'),'anonymous RPC write denied');
reset role;

select throws_ok($$select public.save_product_family((select id from saved_family),pg_temp.family_payload(),jsonb_set(pg_temp.variant_payload(),'{0,updated_at}','"2000-01-01T00:00:00Z"'))$$,
  'product_family_changed_reload','stale child stock snapshot rejected');
insert into public.products(artist_id,name,price,variant_group_name,variant_name)
select artist,'Imported Red',50,'Imported keychain','Red' from family_ids;
insert into public.products(artist_id,name,price,variant_group_name,variant_name)
select artist,'Imported Blue',60,'Imported keychain','Blue' from family_ids;
select is((select count(distinct parent_product_id)::integer from public.products where variant_group_name='Imported keychain'),1,'CSV/template grouped inserts share a real parent');
select is((select price from public.products where name='Imported Blue'),60::numeric,'imported child override preserves its existing price');
select lives_ok($$select public.save_product_family((select id from saved_family),pg_temp.family_payload()||'{"product_kind":"preorder","preorder_closes_at":"2000-01-01T00:00:00Z"}',pg_temp.variant_payload())$$,'can display historical closed preorder');
select throws_ok($$insert into public.order_items(order_id,product_id,quantity,price_per_unit) select gen_random_uuid(),id,1,price from public.products where sku='FAM-L'$$,
  'product_preorder_closed','database blocks a stale client after product preorder closes');
select * from finish();
rollback;
