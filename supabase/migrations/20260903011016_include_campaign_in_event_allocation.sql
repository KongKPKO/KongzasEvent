create or replace function public.enforce_event_product_allocation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_product record;
  v_event record;
  v_other_event_committed integer := 0;
  v_campaign_committed integer := 0;
  v_new_committed integer := 0;
  v_committed integer := 0;
begin
  select p.id, p.artist_id, p.stock_total, p.stock_reserved, p.stock_sold,
         p.is_unlimited, p.deleted_at
  into v_product
  from public.products p
  where p.id = new.product_id
  for update;

  if v_product.id is null or v_product.artist_id <> new.artist_id or v_product.deleted_at is not null then
    raise exception 'invalid_event_product';
  end if;
  if new.price_override is not null and new.price_override < 0 then
    raise exception 'invalid_price_override';
  end if;
  if coalesce(v_product.is_unlimited, true) then return new; end if;
  if coalesce(new.is_unlimited, false) then raise exception 'event_stock_exceeds_catalog_stock'; end if;
  if new.stock_total is null or new.stock_total < 0 then raise exception 'invalid_event_stock'; end if;
  if new.stock_total < coalesce(new.stock_reserved, 0) + coalesce(new.stock_sold, 0) then
    raise exception 'event_stock_below_used_stock';
  end if;

  select e.id, e.status, e.end_date
  into v_event
  from public.events e
  where e.id = new.event_id;
  if v_event.id is null then raise exception 'event_not_found'; end if;

  select coalesce(sum(
    coalesce(ep.stock_sold, 0)
    + coalesce(ep.stock_reserved, 0)
    + case when ep.is_enabled = true
             and ep.is_unlimited = false
             and e.status in ('Confirmed', 'confirmed')
             and e.end_date >= now()
      then greatest(coalesce(ep.stock_total, 0) - coalesce(ep.stock_sold, 0) - coalesce(ep.stock_reserved, 0), 0)
      else 0 end
  ), 0)::integer
  into v_other_event_committed
  from public.event_products ep
  join public.events e on e.id = ep.event_id
  where ep.product_id = new.product_id
    and ep.event_id <> new.event_id;

  select coalesce(sum(
    coalesce(cp.stock_sold, 0)
    + coalesce(cp.stock_reserved, 0)
    + case when cp.is_enabled = true
             and cp.is_unlimited = false
             and c.publication_status not in ('cancelled', 'archived')
             and c.closes_at >= now()
      then greatest(coalesce(cp.stock_total, 0) - coalesce(cp.stock_sold, 0) - coalesce(cp.stock_reserved, 0), 0)
      else 0 end
  ), 0)::integer
  into v_campaign_committed
  from public.online_campaign_products cp
  join public.online_campaigns c on c.id = cp.campaign_id
  where cp.product_id = new.product_id;

  v_new_committed := coalesce(new.stock_sold, 0) + coalesce(new.stock_reserved, 0);
  if coalesce(new.is_enabled, true)
     and v_event.status in ('Confirmed', 'confirmed')
     and v_event.end_date >= now() then
    v_new_committed := v_new_committed
      + greatest(coalesce(new.stock_total, 0) - coalesce(new.stock_sold, 0) - coalesce(new.stock_reserved, 0), 0);
  end if;

  v_committed := coalesce(v_product.stock_sold, 0)
    + coalesce(v_product.stock_reserved, 0)
    + v_other_event_committed
    + v_campaign_committed
    + v_new_committed;

  if v_committed > coalesce(v_product.stock_total, 0) then
    raise exception 'event_stock_exceeds_catalog_stock';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_event_product_allocation() from public, anon, authenticated;

create or replace function public.enforce_online_campaign_product_allocation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_product record;
  v_campaign record;
  v_event_committed integer := 0;
  v_other_campaign_committed integer := 0;
  v_new_committed integer := 0;
  v_committed integer := 0;
begin
  select p.id, p.artist_id, p.stock_total, p.stock_reserved, p.stock_sold,
         p.is_unlimited, p.deleted_at
  into v_product
  from public.products p
  where p.id = new.product_id
  for update;

  if v_product.id is null or v_product.artist_id <> new.artist_id or v_product.deleted_at is not null then
    raise exception 'invalid_campaign_product';
  end if;
  if new.price_override is not null and new.price_override < 0 then
    raise exception 'invalid_price_override';
  end if;
  if coalesce(v_product.is_unlimited, true) then return new; end if;
  if coalesce(new.is_unlimited, false) then raise exception 'campaign_stock_exceeds_catalog_stock'; end if;
  if new.stock_total is null or new.stock_total < 0 then raise exception 'invalid_campaign_stock'; end if;
  if new.stock_total < coalesce(new.stock_reserved, 0) + coalesce(new.stock_sold, 0) then
    raise exception 'campaign_stock_below_used_stock';
  end if;

  select c.id, c.publication_status, c.closes_at
  into v_campaign
  from public.online_campaigns c
  where c.id = new.campaign_id;
  if v_campaign.id is null then raise exception 'campaign_not_found'; end if;

  select coalesce(sum(
    coalesce(ep.stock_sold, 0)
    + coalesce(ep.stock_reserved, 0)
    + case when ep.is_enabled = true
             and ep.is_unlimited = false
             and e.status in ('Confirmed', 'confirmed')
             and e.end_date >= now()
      then greatest(coalesce(ep.stock_total, 0) - coalesce(ep.stock_sold, 0) - coalesce(ep.stock_reserved, 0), 0)
      else 0 end
  ), 0)::integer
  into v_event_committed
  from public.event_products ep
  join public.events e on e.id = ep.event_id
  where ep.product_id = new.product_id;

  select coalesce(sum(
    coalesce(cp.stock_sold, 0)
    + coalesce(cp.stock_reserved, 0)
    + case when cp.is_enabled = true
             and cp.is_unlimited = false
             and c.publication_status not in ('cancelled', 'archived')
             and c.closes_at >= now()
      then greatest(coalesce(cp.stock_total, 0) - coalesce(cp.stock_sold, 0) - coalesce(cp.stock_reserved, 0), 0)
      else 0 end
  ), 0)::integer
  into v_other_campaign_committed
  from public.online_campaign_products cp
  join public.online_campaigns c on c.id = cp.campaign_id
  where cp.product_id = new.product_id
    and cp.campaign_id <> new.campaign_id;

  v_new_committed := coalesce(new.stock_sold, 0) + coalesce(new.stock_reserved, 0);
  if coalesce(new.is_enabled, true)
     and v_campaign.publication_status not in ('cancelled', 'archived')
     and v_campaign.closes_at >= now() then
    v_new_committed := v_new_committed
      + greatest(coalesce(new.stock_total, 0) - coalesce(new.stock_sold, 0) - coalesce(new.stock_reserved, 0), 0);
  end if;

  v_committed := coalesce(v_product.stock_sold, 0)
    + coalesce(v_product.stock_reserved, 0)
    + v_event_committed
    + v_other_campaign_committed
    + v_new_committed;

  if v_committed > coalesce(v_product.stock_total, 0) then
    raise exception 'campaign_stock_exceeds_catalog_stock';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_online_campaign_product_allocation() from public, anon, authenticated;

drop trigger if exists trg_online_campaign_products_allocation on public.online_campaign_products;
create trigger trg_online_campaign_products_allocation
before insert or update of product_id, artist_id, is_enabled, price_override,
  is_unlimited, stock_total, stock_reserved, stock_sold
on public.online_campaign_products
for each row execute function public.enforce_online_campaign_product_allocation();
