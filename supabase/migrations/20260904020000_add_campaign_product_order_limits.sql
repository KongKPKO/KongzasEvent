alter table public.online_campaign_products
  add column if not exists max_quantity_per_order integer;

alter table public.online_campaign_products
  drop constraint if exists online_campaign_products_max_quantity_per_order_check;

alter table public.online_campaign_products
  add constraint online_campaign_products_max_quantity_per_order_check
  check (max_quantity_per_order is null or max_quantity_per_order > 0);

create or replace function private.enforce_campaign_product_order_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  if new.campaign_product_id is null then
    return new;
  end if;

  select cp.max_quantity_per_order
  into v_limit
  from public.online_campaign_products cp
  where cp.id = new.campaign_product_id;

  if v_limit is not null and new.quantity > v_limit then
    raise exception 'campaign_product_order_limit_exceeded';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_campaign_product_order_limit() from public, anon, authenticated;

drop trigger if exists trg_order_items_campaign_product_order_limit on public.order_items;
create trigger trg_order_items_campaign_product_order_limit
before insert or update of quantity, campaign_product_id
on public.order_items
for each row execute function private.enforce_campaign_product_order_limit();

create or replace function public.get_public_online_campaign(
  p_artist_slug text,
  p_campaign_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign record;
  v_state text;
  v_has_sellable boolean;
  v_products jsonb;
  v_pickup_points jsonb;
  v_payment_methods jsonb;
begin
  select
    c.*,
    a.slug as artist_slug,
    a.display_name as artist_name,
    a.image_url as artist_image_url
  into v_campaign
  from public.online_campaigns c
  join public.artists a on a.id = c.artist_id
  where lower(a.slug) = lower(trim(p_artist_slug))
    and lower(c.slug) = lower(trim(p_campaign_slug))
    and a.is_public = true
    and a.is_verified = true
    and c.publication_status in ('published', 'cancelled');

  if v_campaign.id is null then
    return null;
  end if;

  select exists (
    select 1
    from public.online_campaign_products cp
    join public.products p on p.id = cp.product_id
    where cp.campaign_id = v_campaign.id
      and cp.is_enabled = true
      and p.deleted_at is null
      and p.status = 'enable'
      and (
        cp.is_unlimited
        or cp.stock_total - cp.stock_reserved - cp.stock_sold > 0
      )
  ) into v_has_sellable;

  v_state := case
    when v_campaign.publication_status = 'cancelled' then 'cancelled'
    when now() < v_campaign.opens_at then 'scheduled'
    when now() >= v_campaign.closes_at then 'closed'
    when not v_has_sellable then 'sold_out'
    else 'open'
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'campaign_product_id', cp.id,
    'product_id', p.id,
    'name', p.name,
    'description', p.description,
    'category', p.category,
    'tags', p.tags,
    'image_url', p.image_url,
    'sku', p.sku,
    'variant_group_name', p.variant_group_name,
    'variant_name', p.variant_name,
    'price', coalesce(cp.price_override, p.price),
    'currency', v_campaign.currency,
    'is_unlimited', cp.is_unlimited,
    'max_quantity_per_order', cp.max_quantity_per_order,
    'available_quantity', case
      when cp.is_unlimited then null
      else greatest(cp.stock_total - cp.stock_reserved - cp.stock_sold, 0)
    end
  ) order by p.variant_group_name nulls first, p.variant_sort_order, p.name), '[]'::jsonb)
  into v_products
  from public.online_campaign_products cp
  join public.products p on p.id = cp.product_id
  where cp.campaign_id = v_campaign.id
    and cp.is_enabled = true
    and p.deleted_at is null
    and p.status = 'enable';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pp.id,
    'name', pp.name,
    'address', pp.address,
    'starts_at', pp.starts_at,
    'ends_at', pp.ends_at,
    'instructions', pp.instructions
  ) order by pp.starts_at), '[]'::jsonb)
  into v_pickup_points
  from public.campaign_pickup_points pp
  where pp.campaign_id = v_campaign.id
    and pp.is_enabled = true;

  if v_state = 'open' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', pm.id,
      'method_type', pm.method_type,
      'display_name', pm.display_name,
      'account_name', pm.account_name,
      'account_number', pm.account_number,
      'bank_name', pm.bank_name,
      'promptpay_id', pm.promptpay_id,
      'qr_image_url', pm.qr_image_url,
      'instructions', pm.instructions
    ) order by pm.created_at), '[]'::jsonb)
    into v_payment_methods
    from public.campaign_payment_methods pm
    where pm.campaign_id = v_campaign.id
      and pm.is_enabled = true;
  else
    v_payment_methods := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'id', v_campaign.id,
    'artist_id', v_campaign.artist_id,
    'artist_slug', v_campaign.artist_slug,
    'artist_name', v_campaign.artist_name,
    'artist_image_url', v_campaign.artist_image_url,
    'name', v_campaign.name,
    'slug', v_campaign.slug,
    'description', v_campaign.description,
    'opens_at', v_campaign.opens_at,
    'closes_at', v_campaign.closes_at,
    'campaign_timezone', v_campaign.campaign_timezone,
    'currency', v_campaign.currency,
    'shipping_enabled', v_campaign.shipping_enabled,
    'flat_shipping_fee', v_campaign.flat_shipping_fee,
    'pickup_enabled', v_campaign.pickup_enabled,
    'state', v_state,
    'products', v_products,
    'pickup_points', v_pickup_points,
    'payment_methods', v_payment_methods
  );
end;
$$;

create or replace function public.get_online_campaign_workspace(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.online_campaigns%rowtype;
  v_can_manage boolean;
begin
  select c.* into v_campaign
  from public.online_campaigns c
  where c.id = p_campaign_id;

  if v_campaign.id is null then raise exception 'campaign_not_found'; end if;
  if not public.has_artist_role(v_campaign.artist_id, array['owner', 'manager', 'seller']) then
    raise exception 'forbidden';
  end if;
  v_can_manage := public.has_artist_role(v_campaign.artist_id, array['owner', 'manager']);

  return jsonb_build_object(
    'campaign', to_jsonb(v_campaign),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cp.id, 'product_id', p.id, 'name', p.name,
        'category', p.category, 'sku', p.sku,
        'price', p.price, 'price_override', cp.price_override,
        'stock_total', cp.stock_total, 'stock_reserved', cp.stock_reserved,
        'stock_sold', cp.stock_sold, 'is_unlimited', cp.is_unlimited,
        'max_quantity_per_order', cp.max_quantity_per_order,
        'is_enabled', cp.is_enabled
      ) order by p.name)
      from public.online_campaign_products cp
      join public.products p on p.id = cp.product_id
      where cp.campaign_id = v_campaign.id
    ), '[]'::jsonb),
    'catalog', case when v_can_manage then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'category', p.category,
        'sku', p.sku, 'price', p.price,
        'currency', p.currency, 'stock_total', p.stock_total,
        'stock_reserved', p.stock_reserved, 'stock_sold', p.stock_sold,
        'is_unlimited', p.is_unlimited, 'image_url', p.image_url
      ) order by p.name)
      from public.products p
      where p.artist_id = v_campaign.artist_id
        and p.deleted_at is null
        and p.status = 'enable'
    ), '[]'::jsonb) else '[]'::jsonb end,
    'pickup_points', coalesce((
      select jsonb_agg(to_jsonb(pp) order by pp.starts_at)
      from public.campaign_pickup_points pp
      where pp.campaign_id = v_campaign.id
    ), '[]'::jsonb),
    'payment_methods', case when v_can_manage then coalesce((
      select jsonb_agg(to_jsonb(pm) order by pm.created_at)
      from public.campaign_payment_methods pm
      where pm.campaign_id = v_campaign.id
    ), '[]'::jsonb) else '[]'::jsonb end,
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'order_code', o.pickup_code,
        'created_at', o.created_at,
        'status', o.status,
        'customer_name', o.customer_name,
        'customer_email', o.customer_email,
        'customer_phone', o.customer_phone,
        'shipping_address', o.shipping_address,
        'fulfillment_method', o.fulfillment_method,
        'fulfillment_status', o.pickup_status,
        'pickup_point', o.pickup_point_snapshot,
        'subtotal_price', o.subtotal_price,
        'discount_total', o.discount_total,
        'shipping_fee', o.shipping_fee,
        'total_price', o.total_price,
        'currency', o.currency,
        'tracking_number', o.tracking_number,
        'shipping_carrier', o.shipping_carrier,
        'payment_status', op.payment_status,
        'slip_url', case when v_can_manage then op.slip_url else null end,
        'submitted_at', case when v_can_manage then op.submitted_at else null end,
        'review_note', case when v_can_manage then op.review_note else null end,
        'stock_hold_expires_at', case when v_can_manage then op.stock_hold_expires_at else null end,
        'late_payment_reported_at', case when v_can_manage then op.late_payment_reported_at else null end,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', coalesce(oi.product_name_snapshot, p.name),
            'sku', coalesce(oi.sku_snapshot, p.sku),
            'quantity', oi.quantity,
            'price_per_unit', oi.price_per_unit
          ) order by oi.id)
          from public.order_items oi
          join public.products p on p.id = oi.product_id
          where oi.order_id = o.id
        ), '[]'::jsonb)
      ) order by o.created_at desc)
      from public.orders o
      join public.order_payments op on op.order_id = o.id
      where o.campaign_id = v_campaign.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_public_online_campaign(text, text) from public;
grant execute on function public.get_public_online_campaign(text, text) to anon, authenticated;

revoke all on function public.get_online_campaign_workspace(uuid) from public;
grant execute on function public.get_online_campaign_workspace(uuid) to authenticated;
