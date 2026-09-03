create or replace function public.list_product_stock_summaries(p_artist_id uuid)
returns table (
  product_id uuid,
  on_hand integer,
  allocated integer,
  available integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_artist_role(p_artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;

  return query
    with active_allocations as (
      select allocation.product_id, sum(allocation.quantity)::integer as allocated
      from (
        select
          ep.product_id,
          greatest(coalesce(ep.stock_total, 0) - coalesce(ep.stock_sold, 0), 0) as quantity
        from public.event_products ep
        join public.events e on e.id = ep.event_id
        where ep.artist_id = p_artist_id
          and ep.is_enabled = true
          and ep.is_unlimited = false
          and e.status in ('Confirmed', 'confirmed')
          and e.end_date >= now()

        union all

        select
          cp.product_id,
          greatest(coalesce(cp.stock_total, 0) - coalesce(cp.stock_sold, 0), 0) as quantity
        from public.online_campaign_products cp
        join public.online_campaigns c on c.id = cp.campaign_id
        where cp.artist_id = p_artist_id
          and cp.is_enabled = true
          and cp.is_unlimited = false
          and c.publication_status not in ('cancelled', 'archived')
          and c.closes_at >= now()
      ) allocation
      group by allocation.product_id
    )
    select
      p.id,
      coalesce(p.stock_total, 0)::integer as on_hand,
      coalesce(a.allocated, 0)::integer as allocated,
      greatest(
        coalesce(p.stock_total, 0)
          - coalesce(p.stock_reserved, 0)
          - coalesce(p.stock_sold, 0)
          - coalesce(a.allocated, 0),
        0
      )::integer as available
    from public.products p
    left join active_allocations a on a.product_id = p.id
    where p.artist_id = p_artist_id
      and p.deleted_at is null
      and coalesce(p.is_unlimited, true) = false;
end;
$$;

revoke execute on function public.list_product_stock_summaries(uuid) from public, anon;
grant execute on function public.list_product_stock_summaries(uuid) to authenticated;
