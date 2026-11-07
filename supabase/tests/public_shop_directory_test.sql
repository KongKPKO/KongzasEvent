begin;
select no_plan();
insert into public.artists(id,slug,display_name,bio,is_public,is_verified,published_at)
select gen_random_uuid(),'directory-fixture-'||i,'Directory Fixture '||i,'unique-directory-fixture',true,true,now()-i*interval '1 minute' from generate_series(1,15) i;
insert into public.artists(id,slug,display_name,bio,is_public,is_verified,published_at)
values(gen_random_uuid(),'directory-private','Directory Private','unique-directory-fixture',false,true,now());
update public.artists set is_queue_open=true where slug='directory-fixture-1';
insert into public.events(id,artist_id,event_name,start_date,end_date,status,is_booth_open,queue_enabled,location,booth_detail)
select gen_random_uuid(),id,'Unique Art Fair',now()-interval '1 hour',now()+interval '1 day','Confirmed',true,true,'Unique Hall','ZZ42' from public.artists where slug='directory-fixture-1';
insert into public.products(id,artist_id,name,price,status,is_unlimited,image_url,created_at)
select gen_random_uuid(),a.id,'Fixture product '||i,10,'enable',true,'fixture-'||i||'.png',now()-i*interval '1 minute' from public.artists a cross join generate_series(1,6) i where a.slug='directory-fixture-1';
insert into public.product_parents(id,artist_id,name,base_price,product_kind,image_url)
select 'c3000000-0000-4000-8000-000000000001',id,'Photo family',10,'photo','old-photo.png' from public.artists where slug='directory-fixture-1';
insert into public.products(id,artist_id,parent_product_id,name,price,status,is_unlimited,image_url,product_kind,variant_gallery_images,created_at)
select gen_random_uuid(),id,'c3000000-0000-4000-8000-000000000001','Cleared photo',10,'enable',true,'old-photo.png','photo','[]'::jsonb,now()+interval '1 minute' from public.artists where slug='directory-fixture-1';
set local role anon;
select is((public.get_public_shop_directory('unique-directory-fixture')->>'total')::integer,15,'count covers all public results and excludes private shops');
select is(jsonb_array_length(public.get_public_shop_directory('unique-directory-fixture')->'rows'),10,'first page returns ten shops');
select is(jsonb_array_length(public.get_public_shop_directory('unique-directory-fixture',p_page=>2)->'rows'),5,'second page returns remaining shops');
select is(jsonb_array_length(public.get_public_shop_directory('unique-directory-fixture',p_featured=>true)->'rows'),4,'featured selection returns four shops');
select is(public.get_public_shop_directory('unique-directory-fixture',p_featured=>true)->'rows',public.get_public_shop_directory('unique-directory-fixture',p_featured=>true)->'rows','featured order is stable within the half-hour');
select is((public.get_public_shop_directory('Directory Fixture 15')->>'total')::integer,1,'search finds a shop outside the first page');
select is((public.get_public_shop_directory('Directory Private')->>'total')::integer,0,'private shop cannot be searched');
select is((select count(distinct v->>'artist_id')::integer from jsonb_array_elements((public.get_public_shop_directory('unique-directory-fixture')->'rows') || (public.get_public_shop_directory('unique-directory-fixture',p_page=>2)->'rows')) v),15,'pages do not duplicate shops');
select is((public.get_public_shop_directory('unique-directory-fixture',p_open=>true)->>'total')::integer,1,'open filter covers matching shops');
select is((public.get_public_shop_directory('unique-directory-fixture',p_queue=>true)->>'total')::integer,1,'queue filter covers matching shops');
select is((public.get_public_shop_directory('unique-directory-fixture',p_products=>true)->>'total')::integer,1,'product filter covers matching shops');
select is((public.get_public_shop_directory('ZZ42')->>'total')::integer,1,'search covers event booth numbers');
select is(jsonb_array_length(public.get_public_shop_directory('Directory Fixture 1')->'rows'->0->'products'),4,'product previews are capped at four');
select ok(not exists(select 1 from jsonb_array_elements(public.get_public_shop_directory('Directory Fixture 1')->'rows'->0->'products') p where p->>'name'='Cleared photo'),'cleared photo galleries do not resurrect an inherited image');
select * from finish();
rollback;
