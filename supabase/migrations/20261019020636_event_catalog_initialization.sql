alter table public.events
  add column if not exists catalog_initialized_at timestamptz,
  add column if not exists catalog_setup_hash text;

create or replace function private.event_catalog_is_initialized(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(e.catalog_initialized_at is not null, false)
    or exists (select 1 from public.event_products ep where ep.event_id = p_event_id)
  from public.events e
  where e.id = p_event_id
$$;

revoke all on function private.event_catalog_is_initialized(uuid) from public;
revoke all on function private.event_catalog_is_initialized(uuid) from anon, authenticated;

create or replace function private.initialize_event_catalog(
  p_event_id uuid,
  p_mode text,
  p_source_event_id uuid default null,
  p_items jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_source public.events%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_product_id uuid;
  v_stock_total integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_mode is null or p_mode not in ('empty', 'reuse', 'select') then raise exception 'invalid_catalog_setup_mode'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then raise exception 'invalid_catalog_payload'; end if;

  select * into v_event from public.events where id = p_event_id for update;
  if v_event.id is null then raise exception 'event_not_found'; end if;
  if not public.has_artist_role(v_event.artist_id, array['owner', 'manager']) then raise exception 'forbidden'; end if;
  if v_event.catalog_initialized_at is not null or exists(select 1 from public.event_products where event_id=p_event_id) then
    raise exception 'event_catalog_already_initialized';
  end if;

  if p_mode = 'reuse' then
    select * into v_source from public.events where id = p_source_event_id;
    if v_source.id is null or v_source.artist_id <> v_event.artist_id or v_source.id = v_event.id then
      raise exception 'invalid_source_event';
    end if;

  end if;
  if p_mode in ('select','reuse') then
    if (
      select count(*) <> count(distinct value ->> 'product_id')
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
    ) then raise exception 'duplicate_product'; end if;

    for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) order by value->>'product_id' loop
      v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
      select * into v_product
      from public.products
      where id = v_product_id and artist_id = v_event.artist_id and deleted_at is null
      for update;
      if v_product.id is null or v_product.status not in ('enable', 'soldout') then raise exception 'invalid_event_product'; end if;

      if coalesce(v_product.is_unlimited, true) then
        v_stock_total := null;
      else
        v_stock_total := coalesce(nullif(v_item ->> 'stock_total', '')::integer, 0);
        if v_stock_total < 0 then raise exception 'invalid_event_stock'; end if;
      end if;

      insert into public.event_products (
        event_id, product_id, artist_id, is_enabled, price_override,
        stock_total, stock_reserved, stock_sold, is_unlimited, is_sellable
      ) values (
        v_event.id, v_product.id, v_event.artist_id, true, null,
        v_stock_total, 0, 0, coalesce(v_product.is_unlimited, true), true
      );
    end loop;
  end if;

  update public.events set catalog_initialized_at = clock_timestamp() where id = v_event.id;
end;
$$;

revoke all on function private.initialize_event_catalog(uuid,text,uuid,jsonb) from public, anon, authenticated;


-- Existing order RPCs treated the absence of event_products rows as the legacy
-- global catalog. Include the explicit initialized marker so an intentionally
-- empty event cannot buy products through a direct RPC call.
do $$
declare
  v_signature text;
  v_definition text;
  v_before text;
  v_after text;
begin
  for v_signature, v_before, v_after in
    select * from (values
      ('private.sync_customer_order_items_with_stock_before_auto_matching(uuid,jsonb,uuid)',
       'select exists (select 1 from public.event_products ep where ep.event_id = v_order.event_id)' || chr(10) || '  into v_has_catalog;',
       'select private.event_catalog_is_initialized(v_order.event_id)' || chr(10) || '  into v_has_catalog;'),
      ('private.create_customer_order_with_stock_before_auto_matching(uuid,jsonb,uuid)',
       'select exists (select 1 from public.event_products ep where ep.event_id = v_event.id)' || chr(10) || '  into v_has_catalog;',
       'select private.event_catalog_is_initialized(v_event.id)' || chr(10) || '  into v_has_catalog;'),
      ('private.create_walkin_order_with_stock_base(uuid,jsonb,text,uuid)',
       'select exists (select 1 from public.event_products ep where ep.event_id = v_event.id)' || chr(10) || '  into v_has_catalog;',
       'select private.event_catalog_is_initialized(v_event.id)' || chr(10) || '  into v_has_catalog;'),
      ('private.create_preorder_with_stock_base(uuid,jsonb,text,text,text,uuid,text,text,text,text)',
       'select exists (select 1 from public.event_products ep where ep.event_id = p_event_id)' || chr(10) || '  into v_has_catalog;',
       'select private.event_catalog_is_initialized(p_event_id)' || chr(10) || '  into v_has_catalog;')
    ) replacements(signature, before_text, after_text)
  loop
    v_definition := pg_get_functiondef(v_signature::regprocedure);
    if position(v_before in v_definition) = 0 then raise exception 'catalog marker patch target missing: %', v_signature; end if;
    execute replace(v_definition, v_before, v_after);
  end loop;
end;
$$;

do $$
declare
  v_definition text;
  v_before text := 'select exists (' || chr(10) || '    select 1' || chr(10) || '    from public.event_products ep' || chr(10) || '    where ep.event_id = p_event_id' || chr(10) || '  ) into v_has_catalog;';
  v_after text := 'select private.event_catalog_is_initialized(p_event_id) into v_has_catalog;';
begin
  v_definition := pg_get_functiondef('public.list_event_products(uuid)'::regprocedure);
  if position(v_before in v_definition) = 0 then raise exception 'catalog marker patch target missing: list_event_products'; end if;
  execute replace(v_definition, v_before, v_after);
end;
$$;

create function private.create_event_with_catalog(p_event jsonb,p_mode text,p_source_event_id uuid,p_items jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare event public.events%rowtype; created public.events%rowtype; artist uuid:=(p_event->>'artist_id')::uuid;
 fingerprint text:=encode(extensions.digest(convert_to(jsonb_build_array(p_event,p_mode,p_source_event_id,p_items)::text,'UTF8'),'sha256'),'hex');
begin
 if auth.uid() is null or not coalesce(public.has_artist_role(artist,array['owner','manager']),false) then raise exception 'forbidden' using errcode='42501'; end if;
 if jsonb_typeof(p_event) is distinct from 'object' or nullif(btrim(p_event->>'event_name'),'') is null
   or p_event->>'status' is null or p_event->>'status' not in ('Confirmed','Cancelled','Ended')
   or nullif(p_event->>'start_date','') is null or nullif(p_event->>'end_date','') is null
   or (p_event->>'end_date')::timestamptz <= (p_event->>'start_date')::timestamptz
   or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_event->>'event_timezone') then raise exception 'invalid_event'; end if;
 select * into event from jsonb_populate_record(null::public.events,p_event);
 if event.id is null then raise exception 'event_request_id_required'; end if;
 -- Stable event UUID makes a lost-response retry return the same completed setup.
 perform pg_advisory_xact_lock(hashtextextended(event.id::text,0));
 select * into created from public.events where id=event.id;
 if found then
   if created.artist_id<>artist or created.catalog_initialized_at is null
     or created.catalog_setup_hash is distinct from fingerprint then
     raise exception 'event_setup_request_conflict';
   end if;
   return to_jsonb(created);
 end if;
 insert into public.events(id,artist_id,event_name,start_date,end_date,status,event_timezone,location,location_name,location_detail,booth_detail,booth_number,queueing_area,entrance_fee,transit_info)
 values(event.id,artist,btrim(event.event_name),event.start_date,event.end_date,event.status,event.event_timezone,
 event.location,event.location_name,event.location_detail,event.booth_detail,event.booth_number,event.queueing_area,event.entrance_fee,event.transit_info);
 perform private.initialize_event_catalog(event.id,p_mode,p_source_event_id,p_items);
 update public.events set catalog_setup_hash=fingerprint where id=event.id;
 select * into created from public.events where id=event.id;
 return to_jsonb(created);
end $$;
revoke all on function private.create_event_with_catalog(jsonb,text,uuid,jsonb) from public,anon;
grant execute on function private.create_event_with_catalog(jsonb,text,uuid,jsonb) to authenticated;
create function public.create_event_with_catalog(p_event jsonb,p_mode text,p_source_event_id uuid default null,p_items jsonb default '[]')
returns jsonb language sql security invoker set search_path='' as $$
 select private.create_event_with_catalog(p_event,p_mode,p_source_event_id,p_items);
$$;
revoke all on function public.create_event_with_catalog(jsonb,text,uuid,jsonb) from public,anon;
grant execute on function public.create_event_with_catalog(jsonb,text,uuid,jsonb) to authenticated;
