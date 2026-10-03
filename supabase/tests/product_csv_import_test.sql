begin;
select no_plan();
create temp table import_ids as select gen_random_uuid() artist,gen_random_uuid() other_artist,gen_random_uuid() owner;
insert into auth.users(id,email) select owner,'csv-owner@example.local' from import_ids;
insert into public.artists(id,slug,display_name) select artist,'csv-import-fixture','CSV fixture' from import_ids union all select other_artist,'csv-import-other','Other fixture' from import_ids;
insert into public.artist_members(artist_id,member_email,role,status) select artist,'csv-owner@example.local','owner','active' from import_ids;
select set_config('request.jwt.claims',jsonb_build_object('sub',owner,'email','csv-owner@example.local','role','authenticated')::text,true) from import_ids;
create function pg_temp.import_payload(p_name text default 'CSV Traveler') returns jsonb language sql as $$
select jsonb_build_array(jsonb_build_object('parent',jsonb_build_object('artist_id',artist,'name',p_name,'base_price',120,'category','Other','currency','THB','product_kind','photo','gallery_images',jsonb_build_array('a','b','c','d','e')),
  'variants','[{"name":"Aether","sku":"CSV-A","stock_total":10,"is_unlimited":false},{"name":"Lumine","sku":"CSV-L","price_override":0,"stock_total":8,"is_unlimited":false}]'::jsonb)) from import_ids
$$;
create temp table import_result as select public.import_product_families(artist,pg_temp.import_payload()) result from import_ids;
select is((select (result->>'imported_products')::integer from import_result),1,'one parent imported');
select is((select (result->>'imported_variants')::integer from import_result),2,'two child inventory rows imported');
select is((select price from public.products where sku='CSV-A'),120::numeric,'blank override inherits parent');
select is((select price from public.products where sku='CSV-L'),0::numeric,'explicit zero override preserved');
select is((select jsonb_array_length(gallery_images) from public.products where sku='CSV-A'),5,'gallery metadata reaches child projection');
update public.products set stock_sold=3 where sku='CSV-A';
select is((select (public.import_product_families(artist,pg_temp.import_payload())->>'imported_products')::integer from import_ids),0,'repeated import skips whole existing family');
select is((select stock_sold from public.products where sku='CSV-A'),3,'repeat import preserves sold inventory');
select is((select count(*)::integer from public.products where artist_id=(select artist from import_ids)),2,'repeat import creates no duplicate child');
select throws_ok($$ select public.import_product_families(other_artist,pg_temp.import_payload()) from import_ids $$,'forbidden','cannot import to another shop');
select throws_ok($$ select public.import_product_families(artist,jsonb_set(pg_temp.import_payload('Should not exist'),'{0,variants,0,id}',to_jsonb(gen_random_uuid()::text))) from import_ids $$,'import_create_only','cannot reference an existing child in create-only import');
-- The first family would be valid; the second violates database price invariants.
select throws_ok($$select public.import_product_families(artist,jsonb_build_array(
  (pg_temp.import_payload('Atomic first')->0)||jsonb_build_object('variants','[{"name":"Default","stock_total":1,"is_unlimited":false}]'::jsonb),
  jsonb_build_object('parent',jsonb_build_object('artist_id',artist,'name','Atomic invalid','base_price',-1),'variants','[{"name":"Default","stock_total":1,"is_unlimited":false}]'::jsonb))) from import_ids$$,
  '23514',null,'invalid later family rolls back the entire import');
select is((select count(*)::integer from public.product_parents where name in ('Atomic first','Atomic invalid')),0,'no partial parents remain after failed batch');
select throws_ok($$select public.import_product_families(artist,jsonb_set(pg_temp.import_payload('Duplicate in file'),'{0,variants}','[{"name":"Default","stock_total":1,"is_unlimited":false}]')||jsonb_set(pg_temp.import_payload('Duplicate in file'),'{0,variants}','[{"name":"Default","stock_total":1,"is_unlimited":false}]')) from import_ids$$,
  'duplicate_import_family','server rejects duplicate families in a batch');
select throws_ok($$select public.import_product_families(artist,(select jsonb_agg(jsonb_build_object('variants',(select jsonb_agg('{}'::jsonb) from generate_series(1,200)))) from generate_series(1,11))) from import_ids$$,'invalid_import_rows','server enforces batch row limit before writing');
select ok(not has_function_privilege('anon','public.import_product_families(uuid,jsonb)','EXECUTE'),'anonymous import denied');
select set_config('request.jwt.claims',jsonb_build_object('sub',owner,'email','csv-seller@example.local','role','authenticated')::text,true) from import_ids;
select throws_ok($$ select public.import_product_families(artist,pg_temp.import_payload()) from import_ids $$,'forbidden','nonmanager import denied');
select * from finish();
rollback;
