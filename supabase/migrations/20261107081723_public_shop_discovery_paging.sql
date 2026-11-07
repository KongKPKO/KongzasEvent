-- Public discovery runs with the caller's RLS; only the selected page carries product previews.
create or replace function public.get_public_shop_directory(
 p_query text default '', p_open boolean default false, p_queue boolean default false,
 p_products boolean default false, p_online boolean default false, p_page integer default 1,
 p_featured boolean default false
) returns jsonb language sql stable security invoker set search_path='' as $$
 with online as materialized (
   select distinct artist_id from public.list_public_online_campaigns(null)
 ), candidates as materialized (
   select a.id artist_id,a.slug,a.display_name,a.bio,a.image_url,a.published_at,a.seller_type,
     coalesce(e.is_booth_open,false) is_booth_open,
     (e.id is not null and e.queue_enabled is distinct from false and coalesce(a.is_queue_open,false)) accepts_queue,
     e.id event_id,e.event_name,e.start_date,
     coalesce(nullif(trim(e.location),''),nullif(concat_ws(', ',nullif(trim(e.location_name),''),nullif(trim(e.location_detail),'')),'')) location,
     coalesce(nullif(trim(e.booth_detail),''),e.booth_number) booth_detail,
     exists(select 1 from online o where o.artist_id=a.id) has_online_shop,
     exists(select 1 from public.products p where p.artist_id=a.id and p.deleted_at is null and not p.gift_only and p.status in ('enable','soldout')) has_products
   from public.artists a
   left join lateral (select e.* from public.events e where e.artist_id=a.id and e.status in ('Confirmed','confirmed') and e.end_date>=now() order by e.is_booth_open desc,e.start_date asc,e.id limit 1) e on true
   where a.is_public and a.is_verified and a.published_at is not null
     and coalesce(a.display_name,'') !~* '(test|demo|performance|security|resilience|accessibility|network|mobile)'
     and coalesce(a.slug,'') !~* '(test|demo|performance|security|resilience|accessibility|network|mobile)'
     and coalesce(a.bio,'') !~* '(test|demo|performance|security|resilience|accessibility|network|mobile)'
 ), filtered as materialized (
   select * from candidates c where
    (coalesce(trim(p_query),'')='' or position(lower(left(trim(p_query),200)) in lower(concat_ws(' ',c.display_name,c.event_name,c.location,c.slug,c.bio,c.booth_detail)))>0)
    and (not coalesce(p_open,false) or c.is_booth_open)
    and (not coalesce(p_queue,false) or c.accepts_queue)
    and (not coalesce(p_products,false) or c.has_products)
    and (not coalesce(p_online,false) or c.has_online_shop)
 ), selected as materialized (
   select * from filtered c
   order by case when p_featured then md5(c.artist_id::text || ':' || floor(extract(epoch from now())/1800)::bigint::text) end,
     case when not p_featured then c.is_booth_open end desc,
     case when not p_featured then c.published_at end desc,c.artist_id
   limit case when p_featured then 4 else 10 end
   offset case when p_featured then 0 else (greatest(1,least(coalesce(p_page,1),100000))-1)*10 end
 ), cards as (
   select c.*,coalesce((select string_agg(category,' · ' order by category) from (select distinct p.category from public.products p where p.artist_id=c.artist_id and p.deleted_at is null and not p.gift_only and p.status in ('enable','soldout') and nullif(trim(p.category),'') is not null order by p.category limit 3) cats),'') categories,
     coalesce((select jsonb_agg(to_jsonb(preview) order by preview.created_at desc,preview.id) from (select * from (
       select distinct on (coalesce(p.parent_product_id,p.id)) p.id,p.artist_id,p.name,p.price,p.image_url,p.category,p.parent_product_id,p.product_kind,p.gallery_images,p.variant_gallery_images,p.created_at
       from public.products p where p.artist_id=c.artist_id and p.deleted_at is null and not p.gift_only and p.status in ('enable','soldout') and (case
         when p.variant_gallery_images is not null and (p.product_kind='photo' or (p.product_kind is null and (jsonb_array_length(case when jsonb_typeof(p.gallery_images)='array' then p.gallery_images else '[]'::jsonb end)>0 or jsonb_array_length(case when jsonb_typeof(p.variant_gallery_images)='array' then p.variant_gallery_images else '[]'::jsonb end)>0)))
           then jsonb_array_length(case when jsonb_typeof(p.variant_gallery_images)='array' then p.variant_gallery_images else '[]'::jsonb end)>0
         else nullif(trim(p.image_url),'') is not null or jsonb_array_length(case when jsonb_typeof(p.gallery_images)='array' then p.gallery_images else '[]'::jsonb end)>0 end)
       order by coalesce(p.parent_product_id,p.id),p.created_at desc,p.id
     ) candidates where candidates.image_url is not null or jsonb_array_length(case when jsonb_typeof(candidates.gallery_images)='array' then candidates.gallery_images else '[]'::jsonb end)>0 or jsonb_array_length(case when jsonb_typeof(candidates.variant_gallery_images)='array' then candidates.variant_gallery_images else '[]'::jsonb end)>0 order by candidates.created_at desc,candidates.id limit 4) preview),'[]'::jsonb) products
   from selected c
 )
 select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(c) order by case when p_featured then md5(c.artist_id::text || ':' || floor(extract(epoch from now())/1800)::bigint::text) end,case when not p_featured then c.is_booth_open end desc,case when not p_featured then c.published_at end desc,c.artist_id) from cards c),'[]'::jsonb));
$$;
revoke all on function public.get_public_shop_directory(text,boolean,boolean,boolean,boolean,integer,boolean) from public;
grant execute on function public.get_public_shop_directory(text,boolean,boolean,boolean,boolean,integer,boolean) to anon, authenticated;
notify pgrst, 'reload schema';
