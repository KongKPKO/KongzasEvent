-- The parent owns merchandising; products retain the existing sellable UUIDs.
-- Keeping these child records preserves order, allocation and promotion references.
create table public.product_parents (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 250),
  legacy_group_key text,
  description text not null default '', category text not null default 'Other',
  tags text[] not null default '{}', image_url text,
  currency text not null default 'THB', base_price numeric not null default 0 check (base_price >= 0),
  product_kind text not null default 'single' check (product_kind in ('single','photo','bundle','preorder','service')),
  gallery_images jsonb not null default '[]' check (jsonb_typeof(gallery_images) = 'array' and jsonb_array_length(gallery_images) <= 50),
  bundle_items jsonb not null default '[]' check (jsonb_typeof(bundle_items) = 'array' and jsonb_array_length(bundle_items) <= 100),
  preorder_closes_at timestamptz, preorder_eta text,
  service_duration_minutes integer check (service_duration_minutes > 0),
  service_slots integer check (service_slots >= 0), service_kind text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,artist_id)
);
alter table public.products
  add column parent_product_id uuid,
  add column price_override numeric check (price_override >= 0),
  add column product_kind text not null default 'single',
  add column gallery_images jsonb not null default '[]',
  add column bundle_items jsonb not null default '[]',
  add column preorder_closes_at timestamptz, add column preorder_eta text,
  add column service_duration_minutes integer, add column service_slots integer, add column service_kind text;

-- Only explicit groups with compatible shared data are normalized together.
-- Inconsistent historical descriptions/categories/currencies remain separate families.
do $$
declare g record; parent_id uuid;
begin
  for g in
    select artist_id, coalesce(nullif(btrim(variant_group_name),''),id::text) group_key,
      coalesce(description,'') description, coalesce(category,'Other') category,
      coalesce(currency,'THB') currency, coalesce(tags,'{}') tags,
      array_agg(id order by variant_sort_order,created_at,id) ids,
      min(nullif(lower(btrim(variant_group_name)),'')) legacy_group_key,
      (array_agg(coalesce(nullif(btrim(variant_group_name),''),name) order by variant_sort_order,created_at,id))[1] name,
      (array_agg(image_url order by variant_sort_order,created_at,id))[1] image_url,
      least(greatest(coalesce(min(price),0),0),999999999999) base_price
    from public.products where artist_id is not null
    group by artist_id,coalesce(nullif(btrim(variant_group_name),''),id::text),
      coalesce(description,''),coalesce(category,'Other'),coalesce(currency,'THB'),coalesce(tags,'{}')
  loop
    insert into public.product_parents(artist_id,name,description,category,currency,tags,image_url,base_price,legacy_group_key)
      values(g.artist_id,g.name,g.description,g.category,g.currency,g.tags,g.image_url,g.base_price,g.legacy_group_key) returning id into parent_id;
    update public.products set parent_product_id=parent_id,
      price_override=case when price is distinct from g.base_price then price else null end
      where id=any(g.ids);
  end loop;
end $$;
alter table public.products add constraint products_parent_same_artist
  foreign key(parent_product_id,artist_id) references public.product_parents(id,artist_id);
-- Orphan legacy records are retained for investigation; all owned rows require a parent.
alter table public.products add constraint products_owned_parent_required check (artist_id is null or parent_product_id is not null);
create index products_parent_idx on public.products(parent_product_id,variant_sort_order) where deleted_at is null;

alter table public.product_parents enable row level security;
create policy parent_staff_read on public.product_parents for select to authenticated
  using(public.has_artist_role(artist_id,array['owner','manager','seller','queue_staff']) or public.is_platform_admin());
create policy parent_public_read on public.product_parents for select to anon,authenticated
  using(exists(select 1 from public.products p where p.parent_product_id=product_parents.id
    and p.deleted_at is null and p.status in ('enable','soldout'))
    and exists(select 1 from public.artists a where a.id=artist_id and a.is_public and a.is_verified and a.published_at is not null));
-- Parent writes go through the atomic family RPC. Child writes keep existing role policies.
grant select on public.product_parents to anon,authenticated;
grant all on public.product_parents to service_role;

create function public.sync_product_child() returns trigger language plpgsql security definer set search_path='' as $$
declare parent public.product_parents%rowtype;
begin
  if new.artist_id is null then return new; end if;
  if tg_op='UPDATE' and (new.parent_product_id is distinct from old.parent_product_id or new.artist_id is distinct from old.artist_id) then
    raise exception 'variant_parent_immutable';
  end if;
  if new.parent_product_id is null then
    if nullif(btrim(new.variant_group_name),'') is not null then
      -- CSV/template import remains compatible and converges concurrent group inserts.
      perform pg_advisory_xact_lock(hashtextextended(new.artist_id::text||lower(btrim(new.variant_group_name)),0));
      select * into parent from public.product_parents pp where pp.artist_id=new.artist_id
        and pp.legacy_group_key=lower(btrim(new.variant_group_name))
        and pp.description=coalesce(new.description,'') and pp.category=coalesce(new.category,'Other')
        and pp.tags=coalesce(new.tags,'{}') and pp.currency=coalesce(new.currency,'THB')
        order by pp.created_at,pp.id limit 1 for update;
    end if;
    if parent.id is null then
      insert into public.product_parents(artist_id,name,description,category,tags,image_url,currency,base_price,legacy_group_key)
        values(new.artist_id,coalesce(nullif(btrim(new.variant_group_name),''),new.name),coalesce(new.description,''),coalesce(new.category,'Other'),coalesce(new.tags,'{}'),new.image_url,coalesce(new.currency,'THB'),coalesce(new.price,0),nullif(lower(btrim(new.variant_group_name)),''))
        returning * into parent;
    end if;
    new.parent_product_id:=parent.id;
    new.price_override:=case when new.price is distinct from parent.base_price then new.price else null end;
  else
    select * into parent from public.product_parents where id=new.parent_product_id;
    if parent.id is null or parent.artist_id <> new.artist_id then raise exception 'variant_parent_mismatch'; end if;
    -- Legacy price editors change an override, never the parent's shared base price.
    if tg_op='UPDATE' and new.price is distinct from old.price and new.price_override is not distinct from old.price_override
      and new.price is distinct from coalesce(new.price_override,parent.base_price) then
      new.price_override:=new.price;
    end if;
  end if;
  new.price:=coalesce(new.price_override,parent.base_price);
  new.product_kind:=parent.product_kind; new.gallery_images:=parent.gallery_images; new.bundle_items:=parent.bundle_items;
  new.preorder_closes_at:=parent.preorder_closes_at; new.preorder_eta:=parent.preorder_eta;
  new.service_duration_minutes:=parent.service_duration_minutes; new.service_slots:=parent.service_slots; new.service_kind:=parent.service_kind;
  return new;
end $$;
create trigger sync_product_child before insert or update on public.products for each row execute function public.sync_product_child();
revoke all on function public.sync_product_child() from public,anon,authenticated;

create function public.save_product_family(p_parent_id uuid,p_parent jsonb,p_variants jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  parent public.product_parents%rowtype; old_child public.products%rowtype;
  item jsonb; child_id uuid; kept uuid[] := '{}'; artist uuid;
  total integer; unlimited boolean; commitments bigint; v_override numeric;
begin
  artist:=(p_parent->>'artist_id')::uuid;
  if p_parent_id is not null then
    select * into parent from public.product_parents where id=p_parent_id for update;
    if parent.id is null then raise exception 'product_parent_not_found'; end if;
    if artist is not null and artist<>parent.artist_id then raise exception 'forbidden'; end if;
    artist:=parent.artist_id;

  end if;
  if auth.uid() is null or artist is null or not public.has_artist_role(artist,array['owner','manager']) then raise exception 'forbidden'; end if;
    if p_parent ? 'updated_at' and (p_parent->>'updated_at')::timestamptz is distinct from parent.updated_at then raise exception 'product_family_changed_reload'; end if;
  if jsonb_typeof(p_variants) is distinct from 'array' or jsonb_array_length(p_variants) not between 1 and 200 then raise exception 'invalid_variants'; end if;
  if exists(select 1 from jsonb_array_elements(p_variants) v where nullif(btrim(v->>'name'),'') is null) then raise exception 'variant_name_required'; end if;
  if (select count(*)<>count(distinct lower(btrim(v->>'name'))) from jsonb_array_elements(p_variants) v) then raise exception 'duplicate_variant_name'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_parent->'gallery_images','[]')) v where jsonb_typeof(v)<>'string') then raise exception 'invalid_gallery'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_parent->'bundle_items','[]')) v
    where nullif(btrim(v->>'name'),'') is null or coalesce((v->>'quantity')::numeric,0)<=0 or (v->>'quantity')::numeric<>trunc((v->>'quantity')::numeric)) then raise exception 'invalid_bundle_items'; end if;
  if parent.id is null then
    insert into public.product_parents(artist_id,name) values(artist,btrim(p_parent->>'name')) returning * into parent;
  end if;
  update public.product_parents set name=btrim(p_parent->>'name'),description=coalesce(p_parent->>'description',''),
    category=coalesce(nullif(p_parent->>'category',''),'Other'),tags=array(select jsonb_array_elements_text(coalesce(p_parent->'tags','[]'))),
    image_url=nullif(p_parent->>'image_url',''),currency=coalesce(nullif(p_parent->>'currency',''),'THB'),base_price=coalesce((p_parent->>'base_price')::numeric,0),
    product_kind=coalesce(p_parent->>'product_kind','single'),gallery_images=coalesce(p_parent->'gallery_images','[]'),bundle_items=coalesce(p_parent->'bundle_items','[]'),
    preorder_closes_at=nullif(p_parent->>'preorder_closes_at','')::timestamptz,preorder_eta=nullif(p_parent->>'preorder_eta',''),
    service_duration_minutes=nullif(p_parent->>'service_duration_minutes','')::integer,service_slots=nullif(p_parent->>'service_slots','')::integer,
    service_kind=nullif(p_parent->>'service_kind',''),updated_at=clock_timestamp()
    where id=parent.id returning * into parent;
  -- Stable lock ordering matches inventory UUID identity and serializes two family saves.
  perform 1 from public.products where parent_product_id=parent.id order by id for update;
  for item in select value from jsonb_array_elements(p_variants) loop
    child_id:=nullif(item->>'id','')::uuid;
    unlimited:=coalesce((item->>'is_unlimited')::boolean,false);
    total:=case when unlimited then null else coalesce((item->>'stock_total')::integer,0) end;
    if total<0 then raise exception 'invalid_stock_quantity'; end if;
    v_override:=nullif(item->>'price_override','')::numeric;
    if child_id is not null then
      if child_id=any(kept) then raise exception 'duplicate_variant_id'; end if;
      select * into old_child from public.products where id=child_id and parent_product_id=parent.id and deleted_at is null;
      if not found then raise exception 'variant_not_in_family'; end if;
      if item ? 'updated_at' and (item->>'updated_at')::timestamptz is distinct from old_child.updated_at then raise exception 'product_family_changed_reload'; end if;
      if old_child.is_unlimited is distinct from unlimited then
        select coalesce(old_child.stock_sold,0)+coalesce(old_child.stock_reserved,0)
          +(select count(*) from public.event_products where product_id=child_id)
          +(select count(*) from public.online_campaign_products where product_id=child_id)
          into commitments;
        if commitments>0 then raise exception 'allocated_variant_stock_mode_locked'; end if;
        update public.products set is_unlimited=unlimited,stock_total=total where id=child_id;
      elsif not unlimited then
        if total>coalesce(old_child.stock_total,0) then
          perform public.add_catalog_stock(child_id,total-coalesce(old_child.stock_total,0),'Variant editor');
        elsif total<coalesce(old_child.stock_total,0) then
          perform public.remove_catalog_stock(child_id,coalesce(old_child.stock_total,0)-total,'Variant editor correction');
        end if;
      end if;
      update public.products set name=case when jsonb_array_length(p_variants)=1 and item->>'name'='Default' then parent.name else parent.name||' — '||btrim(item->>'name') end,
        variant_name=btrim(item->>'name'),variant_group_name=case when jsonb_array_length(p_variants)>1 then parent.name else null end,
        variant_sort_order=coalesce((item->>'variant_sort_order')::integer,0),sku=nullif(item->>'sku',''),price_override=v_override,price=coalesce(v_override,parent.base_price),
        image_url=coalesce(nullif(item->>'image_url',''),parent.image_url),status=coalesce(item->>'status','enable'),
        description=parent.description,category=parent.category,tags=parent.tags,currency=parent.currency
        where id=child_id;
    else
      insert into public.products(artist_id,parent_product_id,name,variant_name,variant_group_name,variant_sort_order,sku,price_override,price,image_url,status,description,category,tags,currency,stock_total,is_unlimited)
        values(artist,parent.id,case when jsonb_array_length(p_variants)=1 and item->>'name'='Default' then parent.name else parent.name||' — '||btrim(item->>'name') end,
          btrim(item->>'name'),case when jsonb_array_length(p_variants)>1 then parent.name else null end,coalesce((item->>'variant_sort_order')::integer,0),nullif(item->>'sku',''),v_override,coalesce(v_override,parent.base_price),
          coalesce(nullif(item->>'image_url',''),parent.image_url),coalesce(item->>'status','enable'),parent.description,parent.category,parent.tags,parent.currency,total,unlimited)
        returning id into child_id;
    end if;
    kept:=array_append(kept,child_id);
  end loop;
  for old_child in select * from public.products where parent_product_id=parent.id and deleted_at is null and not(id=any(kept)) loop
    -- Never orphan a live allocation or hold. Historical sale references remain intact.
    if coalesce(old_child.stock_reserved,0)>0 or exists(select 1 from public.event_products where product_id=old_child.id and (is_enabled or stock_reserved>0))
      or exists(select 1 from public.online_campaign_products where product_id=old_child.id and (is_enabled or stock_reserved>0)) then
      raise exception 'variant_in_use_disable_in_channels_first';
    end if;
    update public.products set deleted_at=now(),status='disable' where id=old_child.id;
  end loop;
  return parent.id;
end $$;
revoke all on function public.save_product_family(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.save_product_family(uuid,jsonb,jsonb) to authenticated;

-- Extend existing RPCs without replacing their channel stock/visibility rules.
do $migration$
declare definition text; fields text := 'parent_product_id uuid, product_kind text, gallery_images jsonb, bundle_items jsonb, preorder_closes_at timestamp with time zone, preorder_eta text, service_duration_minutes integer, service_slots integer, service_kind text';
begin
  definition:=pg_get_functiondef('public.list_event_products(uuid)'::regprocedure);
  if strpos(definition,'variant_sort_order integer)')=0 or strpos(definition,'coalesce(p.variant_sort_order, 0) as variant_sort_order')=0 then raise exception 'Unexpected list_event_products signature'; end if;
  definition:=replace(definition,'variant_sort_order integer)','variant_sort_order integer, '||fields||')');
  definition:=replace(definition,'coalesce(p.variant_sort_order, 0) as variant_sort_order',
    'coalesce(p.variant_sort_order, 0) as variant_sort_order, p.parent_product_id, p.product_kind, p.gallery_images, p.bundle_items, p.preorder_closes_at, p.preorder_eta, p.service_duration_minutes, p.service_slots, p.service_kind');
  drop function public.list_event_products(uuid);
  execute definition;
  definition:=pg_get_functiondef('public.get_public_online_campaign(text,text)'::regprocedure);
  if strpos(definition,'''variant_group_name'', p.variant_group_name')=0 then raise exception 'Unexpected campaign product projection'; end if;
  definition:=replace(definition,'''variant_group_name'', p.variant_group_name',
    '''parent_product_id'', p.parent_product_id, ''product_kind'', p.product_kind, ''gallery_images'', p.gallery_images, ''bundle_items'', p.bundle_items, ''preorder_closes_at'', p.preorder_closes_at, ''preorder_eta'', p.preorder_eta, ''service_duration_minutes'', p.service_duration_minutes, ''service_slots'', p.service_slots, ''service_kind'', p.service_kind, ''variant_group_name'', p.variant_group_name');
  execute definition;
end $migration$;
revoke all on function public.list_event_products(uuid) from public;
grant execute on function public.list_event_products(uuid) to anon,authenticated;

-- A stale browser cannot place a new order after a product's preorder close.
create function public.check_product_preorder_close() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.products p where p.id=new.product_id and p.product_kind='preorder' and p.preorder_closes_at<=now()) then
    raise exception 'product_preorder_closed';
  end if;
  return new;
end $$;
create trigger check_product_preorder_close before insert on public.order_items for each row execute function public.check_product_preorder_close();
revoke all on function public.check_product_preorder_close() from public,anon,authenticated;
notify pgrst, 'reload schema';
