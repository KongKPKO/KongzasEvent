create or replace function public.list_product_stock_summaries(p_artist_id uuid)
returns table (product_id uuid, on_hand integer, allocated integer, available integer)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_artist_role(p_artist_id, array['owner','manager']) then
    raise exception 'forbidden';
  end if;
  return query
  with channel_stock as (
    select ep.product_id, coalesce(ep.stock_sold,0) sold,
      coalesce(ep.stock_reserved,0) + case when ep.is_enabled and not ep.is_unlimited
        and e.status in ('Confirmed','confirmed') and e.end_date >= now()
        then greatest(coalesce(ep.stock_total,0)-coalesce(ep.stock_sold,0)-coalesce(ep.stock_reserved,0),0)
        else 0 end allocation
    from public.event_products ep join public.events e on e.id=ep.event_id
    where ep.artist_id=p_artist_id
    union all
    select cp.product_id, coalesce(cp.stock_sold,0),
      coalesce(cp.stock_reserved,0) + case when cp.is_enabled and not cp.is_unlimited
        and c.publication_status not in ('cancelled','archived') and c.closes_at >= now()
        then greatest(coalesce(cp.stock_total,0)-coalesce(cp.stock_sold,0)-coalesce(cp.stock_reserved,0),0)
        else 0 end
    from public.online_campaign_products cp join public.online_campaigns c on c.id=cp.campaign_id
    where cp.artist_id=p_artist_id
  ), commitments as (
    select s.product_id, sum(s.sold) sold, sum(s.allocation) allocation
    from channel_stock s group by s.product_id
  )
  select p.id, coalesce(p.stock_total,0)::integer, coalesce(c.allocation,0)::integer,
    greatest(coalesce(p.stock_total,0)-coalesce(p.stock_sold,0)-coalesce(p.stock_reserved,0)
      -coalesce(c.sold,0)-coalesce(c.allocation,0),0)::integer
  from public.products p left join commitments c on c.product_id=p.id
  where p.artist_id=p_artist_id and p.deleted_at is null and not coalesce(p.is_unlimited,true);
end $$;

-- Preserve the helper's "maximum unsold allocation for this event" contract.
-- Without an excluded event it returns genuinely unallocated catalog capacity.
create or replace function public.calculate_product_event_allocation_available(
  p_product_id uuid, p_exclude_event_id uuid default null
) returns integer language plpgsql security definer set search_path = '' as $$
declare p record; capacity integer; own_allocation integer := 0;
begin
  select * into p from public.products where id=p_product_id and deleted_at is null;
  if p.id is null then raise exception 'product_not_found'; end if;
  if not public.has_artist_role(p.artist_id,array['owner','manager']) then raise exception 'forbidden'; end if;
  if coalesce(p.is_unlimited,true) or p.stock_total is null then return 2147483647; end if;
  select s.available into capacity from public.list_product_stock_summaries(p.artist_id) s where s.product_id=p_product_id;
  select coalesce(sum(coalesce(ep.stock_reserved,0) + case when ep.is_enabled and not ep.is_unlimited
    and e.status in ('Confirmed','confirmed') and e.end_date >= now()
    then greatest(coalesce(ep.stock_total,0)-coalesce(ep.stock_sold,0)-coalesce(ep.stock_reserved,0),0)
    else 0 end),0)::integer into own_allocation
  from public.event_products ep join public.events e on e.id=ep.event_id
  where ep.product_id=p_product_id and ep.event_id=p_exclude_event_id;
  return capacity + own_allocation;
end $$;

-- Incremental adjustments need unallocated capacity, not the event's full limit.
do $$
declare definition text; signature text;
begin
  foreach signature in array array['public.add_event_stock(uuid,integer)','public.remove_event_stock(uuid,integer)'] loop
    definition := pg_get_functiondef(signature::regprocedure);
    definition := replace(definition,
      'calculate_product_event_allocation_available(v_row.product_id, v_row.event_id)',
      'calculate_product_event_allocation_available(v_row.product_id, null)');
    definition := replace(definition,
      'calculate_product_event_allocation_available(ep.product_id, ep.event_id)',
      'calculate_product_event_allocation_available(ep.product_id, null)');
    execute definition;
  end loop;
end $$;

revoke execute on function public.list_product_stock_summaries(uuid) from public, anon;
grant execute on function public.list_product_stock_summaries(uuid) to authenticated;
revoke execute on function public.calculate_product_event_allocation_available(uuid,uuid) from public, anon;
grant execute on function public.calculate_product_event_allocation_available(uuid,uuid) to authenticated;
