-- CSV import creates complete families atomically; existing families remain unchanged.
create function public.import_product_families(p_artist_id uuid, p_families jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; parent jsonb; variant jsonb; saved uuid; imported integer:=0; variants integer:=0; skipped jsonb:='[]'; ids jsonb:='[]'; keys text[]:='{}'; key text;
begin
  if auth.uid() is null or p_artist_id is null or not public.has_artist_role(p_artist_id,array['owner','manager']) then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_families) is distinct from 'array' or jsonb_array_length(p_families) not between 1 and 200 then raise exception 'invalid_import_families'; end if;
  if (select coalesce(sum(case when jsonb_typeof(f->'variants')='array' then jsonb_array_length(f->'variants') else 0 end),0) from jsonb_array_elements(p_families) f)>2000 then raise exception 'invalid_import_rows'; end if;
  -- Serialize repeated uploads for a shop without changing existing stock or metadata.
  perform pg_advisory_xact_lock(hashtextextended('product_csv_import:'||p_artist_id::text,0));
  for item in select value from jsonb_array_elements(p_families) loop
    parent:=item->'parent';
    if nullif(parent->>'id','') is not null or parent->>'artist_id' is distinct from p_artist_id::text then raise exception 'invalid_import_parent'; end if;
    if jsonb_typeof(item->'variants') is distinct from 'array' or jsonb_array_length(item->'variants') not between 1 and 200 then raise exception 'invalid_variants'; end if;
    for variant in select value from jsonb_array_elements(item->'variants') loop
      if nullif(variant->>'id','') is not null then raise exception 'import_create_only'; end if;
    end loop;
    key:=lower(btrim(parent->>'name'))||chr(31)||lower(coalesce(nullif(btrim(parent->>'category'),''),'Other'))||chr(31)||upper(coalesce(nullif(parent->>'currency',''),'THB'));
    if key=any(keys) then raise exception 'duplicate_import_family'; end if;
    keys:=array_append(keys,key);
    if exists(select 1 from public.product_parents pp where pp.artist_id=p_artist_id
      and lower(btrim(pp.name))=lower(btrim(parent->>'name'))
      and lower(btrim(pp.category))=lower(coalesce(nullif(btrim(parent->>'category'),''),'Other'))
      and upper(pp.currency)=upper(coalesce(nullif(parent->>'currency',''),'THB'))
      and exists(select 1 from public.products p where p.parent_product_id=pp.id and p.deleted_at is null)) then
      skipped:=skipped||jsonb_build_array(parent->>'name');
      continue;
    end if;
    saved:=public.save_product_family(null,parent,item->'variants');
    imported:=imported+1; variants:=variants+jsonb_array_length(item->'variants'); ids:=ids||jsonb_build_array(saved);
  end loop;
  return jsonb_build_object('imported_products',imported,'imported_variants',variants,'skipped_products',skipped,'parent_ids',ids);
end $$;
revoke all on function public.import_product_families(uuid,jsonb) from public,anon;
grant execute on function public.import_product_families(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
