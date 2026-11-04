-- Save edited allocation, price and per-order limit together. Reject a stale
-- editor instead of silently overwriting another manager's changes.
create or replace function public.save_campaign_product_edits(p_campaign_id uuid, p_items jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare item jsonb; current_row public.online_campaign_products; artist uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'invalid_catalog_payload'; end if;
  if (select count(*) <> count(distinct value->>'product_id') from jsonb_array_elements(p_items)) then raise exception 'invalid_catalog_payload'; end if;
  select artist_id into artist from public.online_campaigns where id = p_campaign_id for update;
  if artist is null then raise exception 'campaign_not_found'; end if;
  if not public.has_artist_role(artist, array['owner','manager']) then raise exception 'forbidden'; end if;
  for item in select value from jsonb_array_elements(p_items) order by value->>'product_id' loop
    select * into current_row from public.online_campaign_products
      where campaign_id = p_campaign_id and product_id = (item->>'product_id')::uuid for update;
    if current_row.id is null or not current_row.is_enabled then raise exception 'campaign_product_changed'; end if;
    if current_row.stock_total is distinct from nullif(item#>>'{expected,stock_total}','')::integer
      or current_row.price_override is distinct from nullif(item#>>'{expected,price_override}','')::numeric
      or current_row.max_quantity_per_order is distinct from nullif(item#>>'{expected,max_quantity_per_order}','')::integer
      or current_row.is_unlimited is distinct from (item#>>'{expected,is_unlimited}')::boolean then
      raise exception 'campaign_product_changed';
    end if;
    if nullif(item->>'max_quantity_per_order','')::integer <= 0 then raise exception 'invalid_order_limit'; end if;
  end loop;
  perform public.save_online_campaign_products(p_campaign_id, p_items);
  for item in select value from jsonb_array_elements(p_items) loop
    update public.online_campaign_products set max_quantity_per_order = nullif(item->>'max_quantity_per_order','')::integer
    where campaign_id = p_campaign_id and product_id = (item->>'product_id')::uuid;
  end loop;
end $$;
revoke all on function public.save_campaign_product_edits(uuid,jsonb) from public, anon;
grant execute on function public.save_campaign_product_edits(uuid,jsonb) to authenticated;
