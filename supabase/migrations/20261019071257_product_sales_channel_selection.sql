-- Membership edits do not allocate stock or rewrite prices, holds or production policies.
create or replace function public.save_product_sales_channels(
  p_product_id uuid,
  p_event_ids uuid[],
  p_campaign_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_artist_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select artist_id into v_artist_id from public.products where id=p_product_id and deleted_at is null;
  if v_artist_id is null then raise exception 'invalid_product'; end if;
  if not public.has_artist_role(v_artist_id,array['owner','manager']) then raise exception 'forbidden'; end if;
  if p_event_ids is null or p_campaign_ids is null
    or array_position(p_event_ids,null) is not null or array_position(p_campaign_ids,null) is not null
  then raise exception 'invalid_channels'; end if;


  -- Use the channel-before-product lock order of channel catalog saves.
  perform 1 from public.events where artist_id=v_artist_id order by id for update;
  perform 1 from public.online_campaigns where artist_id=v_artist_id and publication_status<>'archived' order by id for update;
  if exists(select 1 from unnest(p_event_ids) as selected(channel_id) where not exists(select 1 from public.events e where e.id=selected.channel_id and e.artist_id=v_artist_id))
    or exists(select 1 from unnest(p_campaign_ids) as selected(channel_id) where not exists(select 1 from public.online_campaigns c where c.id=selected.channel_id and c.artist_id=v_artist_id and c.publication_status<>'archived'))
  then raise exception 'invalid_channels'; end if;
  select * into v_product from public.products where id=p_product_id and artist_id=v_artist_id and deleted_at is null for update;
  if v_product.id is null then raise exception 'invalid_product'; end if;

  update public.event_products ep set is_enabled=(ep.event_id=any(p_event_ids))
  where ep.product_id=p_product_id and ep.artist_id=v_artist_id
    and ep.is_enabled is distinct from (ep.event_id=any(p_event_ids));
  insert into public.event_products(event_id,product_id,artist_id,is_enabled,is_unlimited,stock_total,stock_reserved,stock_sold,is_sellable)
  select distinct id,v_product.id,v_artist_id,true,coalesce(v_product.is_unlimited,true),case when coalesce(v_product.is_unlimited,true) then null else 0 end,0,0,true
  from unnest(p_event_ids) id
  on conflict(event_id,product_id) do nothing;

  update public.online_campaign_products cp set is_enabled=(cp.campaign_id=any(p_campaign_ids))
  where cp.product_id=p_product_id and cp.artist_id=v_artist_id
    and exists(select 1 from public.online_campaigns c where c.id=cp.campaign_id and c.publication_status<>'archived')
    and cp.is_enabled is distinct from (cp.campaign_id=any(p_campaign_ids));
  insert into public.online_campaign_products(campaign_id,product_id,artist_id,is_enabled,is_unlimited,stock_total,stock_reserved,stock_sold)
  select distinct id,v_product.id,v_artist_id,true,coalesce(v_product.is_unlimited,true),case when coalesce(v_product.is_unlimited,true) then null else 0 end,0,0
  from unnest(p_campaign_ids) id
  on conflict(campaign_id,product_id) do nothing;
end;
$$;
revoke all on function public.save_product_sales_channels(uuid,uuid[],uuid[]) from public, anon;
grant execute on function public.save_product_sales_channels(uuid,uuid[],uuid[]) to authenticated;
