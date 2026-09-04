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

revoke all on function public.get_online_campaign_workspace(uuid) from public;
grant execute on function public.get_online_campaign_workspace(uuid) to authenticated;
