begin;
select no_plan();

create temp table gallery_ids as
select gen_random_uuid() artist, gen_random_uuid() manager, gen_random_uuid() seller;

insert into auth.users(id,email)
select manager,'gallery-manager@example.local' from gallery_ids
union all
select seller,'gallery-seller@example.local' from gallery_ids;

insert into public.artists(id,slug,display_name,is_public,is_verified,published_at)
select artist,'variant-gallery-fixture','Variant gallery fixture',true,true,now() from gallery_ids;

insert into public.artist_members(artist_id,member_email,role,status)
select artist,'gallery-manager@example.local','manager','active' from gallery_ids
union all
select artist,'gallery-seller@example.local','seller','active' from gallery_ids;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub',manager,'email','gallery-manager@example.local','role','authenticated')::text,
  true
) from gallery_ids;

create temp table gallery_family(id uuid);
insert into gallery_family
select public.save_product_family(
  null,
  jsonb_build_object(
    'artist_id',artist,
    'name','Gallery stand',
    'base_price',120,
    'product_kind','photo',
    'gallery_images',jsonb_build_array('shared-1.jpg','shared-2.jpg')
  ),
  jsonb_build_array(
    jsonb_build_object('name','Legacy','sku','GAL-LEGACY','stock_total',2,'is_unlimited',false),
    jsonb_build_object('name','Aether','sku','GAL-A','stock_total',2,'is_unlimited',false,'variant_gallery_images',jsonb_build_array('aether-1.jpg','aether-2.jpg')),
    jsonb_build_object('name','Lumine','sku','GAL-L','stock_total',2,'is_unlimited',false,'variant_gallery_images',jsonb_build_array('lumine.jpg')),
    jsonb_build_object('name','No gallery','sku','GAL-CLEAR','stock_total',2,'is_unlimited',false,'variant_gallery_images','[]'::jsonb)
  )
) from gallery_ids;

select is(
  (select variant_gallery_images from public.products where sku='GAL-LEGACY'),
  null::jsonb,
  'legacy variant payload stores no override'
);
select is(
  (select gallery_images from public.products where sku='GAL-LEGACY'),
  '["shared-1.jpg","shared-2.jpg"]'::jsonb,
  'null variant gallery inherits the shared parent gallery'
);
select is(
  (select gallery_images from public.products where sku='GAL-A'),
  '["aether-1.jpg","aether-2.jpg"]'::jsonb,
  'first child materializes its own gallery'
);
select is(
  (select gallery_images from public.products where sku='GAL-L'),
  '["lumine.jpg"]'::jsonb,
  'second child can materialize a different gallery'
);
select is(
  (select gallery_images from public.products where sku='GAL-CLEAR'),
  '[]'::jsonb,
  'an explicit empty child gallery clears inherited images'
);

create function pg_temp.gallery_parent_payload() returns jsonb language sql as $$
  select to_jsonb(p) from public.product_parents p where id=(select id from gallery_family)
$$;

create function pg_temp.gallery_variant_payload() returns jsonb language sql as $$
  select jsonb_agg(
    jsonb_build_object(
      'id',id,
      'name',variant_name,
      'sku',sku,
      'stock_total',stock_total,
      'is_unlimited',is_unlimited,
      'status',status,
      'variant_sort_order',variant_sort_order,
      'updated_at',updated_at,
      'variant_gallery_images',variant_gallery_images
    ) order by sku
  )
  from public.products
  where parent_product_id=(select id from gallery_family) and deleted_at is null
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub',seller,'email','gallery-seller@example.local','role','authenticated')::text,
  true
) from gallery_ids;
select throws_ok(
  $$select public.save_product_family((select id from gallery_family),pg_temp.gallery_parent_payload(),pg_temp.gallery_variant_payload())$$,
  'forbidden',
  'seller cannot save variant galleries'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub',manager,'email','gallery-manager@example.local','role','authenticated')::text,
  true
) from gallery_ids;
select lives_ok(
  $$select public.save_product_family((select id from gallery_family),pg_temp.gallery_parent_payload(),pg_temp.gallery_variant_payload())$$,
  'manager can save variant galleries'
);
select lives_ok(
  $$select public.save_product_family(
    (select id from gallery_family),
    pg_temp.gallery_parent_payload()||'{"gallery_images":["shared-next.jpg"]}'::jsonb,
    (select jsonb_agg(value-'variant_gallery_images') from jsonb_array_elements(pg_temp.gallery_variant_payload()))
  )$$,
  'legacy save payload remains accepted'
);
select is(
  (select gallery_images from public.products where sku='GAL-LEGACY'),
  '["shared-next.jpg"]'::jsonb,
  'legacy child without an override follows a changed parent gallery'
);
select is(
  (select gallery_images from public.products where sku='GAL-A'),
  '["aether-1.jpg","aether-2.jpg"]'::jsonb,
  'legacy save payload does not erase an existing child override'
);

select throws_ok(
  $$select public.save_product_family(
    (select id from gallery_family),
    pg_temp.gallery_parent_payload()||'{"name":"Must roll back"}'::jsonb,
    jsonb_set(pg_temp.gallery_variant_payload(),'{0,variant_gallery_images}','{"bad":true}'::jsonb)
  )$$,
  'invalid_variant_gallery',
  'variant gallery must be an array or null'
);
select is(
  (select name from public.product_parents where id=(select id from gallery_family)),
  'Gallery stand',
  'invalid variant gallery rolls back the parent update'
);
select throws_ok(
  $$select public.save_product_family(
    (select id from gallery_family),
    pg_temp.gallery_parent_payload(),
    jsonb_set(pg_temp.gallery_variant_payload(),'{0,variant_gallery_images}','["ok.jpg",7]'::jsonb)
  )$$,
  'invalid_variant_gallery',
  'variant gallery entries must be strings'
);
select throws_ok(
  $$select public.save_product_family(
    (select id from gallery_family),
    pg_temp.gallery_parent_payload(),
    jsonb_set(
      pg_temp.gallery_variant_payload(),
      '{0,variant_gallery_images}',
      (select jsonb_agg(to_jsonb('image-'||n||'.jpg')) from generate_series(1,51) n)
    )
  )$$,
  'invalid_variant_gallery',
  'variant gallery is limited to fifty images'
);

select is(
  (
    select (public.import_product_families(
      artist,
      jsonb_build_array(jsonb_build_object(
        'parent',jsonb_build_object(
          'artist_id',artist,
          'name','Imported galleries',
          'base_price',90,
          'category','Other',
          'currency','THB',
          'product_kind','photo',
          'gallery_images',jsonb_build_array('import-shared.jpg')
        ),
        'variants',jsonb_build_array(
          jsonb_build_object('name','Inherited','sku','IMP-GAL-I','stock_total',1,'is_unlimited',false),
          jsonb_build_object('name','Override','sku','IMP-GAL-O','stock_total',1,'is_unlimited',false,'variant_gallery_images',jsonb_build_array('import-override.jpg')),
          jsonb_build_object('name','Clear','sku','IMP-GAL-C','stock_total',1,'is_unlimited',false,'variant_gallery_images','[]'::jsonb)
        )
      ))
    )->>'imported_variants'
  )::integer from gallery_ids),
  3,
  'CSV import accepts optional per-row variant galleries'
);
select is((select gallery_images from public.products where sku='IMP-GAL-I'),'["import-shared.jpg"]'::jsonb,'import without child gallery remains backward compatible');
select is((select gallery_images from public.products where sku='IMP-GAL-O'),'["import-override.jpg"]'::jsonb,'import persists a child gallery override');
select is((select gallery_images from public.products where sku='IMP-GAL-C'),'[]'::jsonb,'import persists an explicit gallery clear');

set local role anon;
select is(
  (select gallery_images from public.products where sku='GAL-A'),
  '["aether-1.jpg","aether-2.jpg"]'::jsonb,
  'public product reads receive the effective child gallery'
);
select ok(
  not has_function_privilege('anon','public.save_product_family(uuid,jsonb,jsonb)','EXECUTE'),
  'anonymous family save remains denied'
);
reset role;

select throws_ok(
  $$update public.products set variant_gallery_images='[123]'::jsonb where sku='GAL-A'$$,
  '23514',
  'new row for relation "products" violates check constraint "products_variant_gallery_images_array"',
  'direct writes also reject non-string gallery entries'
);
select * from finish();
rollback;
