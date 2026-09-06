-- Expose immutable promotion snapshots on customer order-status pages.
create or replace function public.get_public_online_order_by_code(p_artist_slug text, p_order_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  select jsonb_build_object(
    'order_id', o.id, 'campaign_id', o.campaign_id, 'campaign_name', c.name,
    'campaign_slug', c.slug, 'artist_slug', a.slug, 'artist_name', a.display_name,
    'status', o.status, 'fulfillment_status', o.pickup_status,
    'fulfillment_method', o.fulfillment_method, 'order_code', o.pickup_code,
    'customer_name', o.customer_name,
    'customer_email_masked', case when coalesce(o.customer_email, '') = '' then '' else left(split_part(o.customer_email, '@', 1), 2) || '***@' || split_part(o.customer_email, '@', 2) end,
    'subtotal_price', o.subtotal_price, 'discount_total', o.discount_total,
    'shipping_fee', o.shipping_fee, 'total_price', o.total_price,
    'pricing_breakdown', o.pricing_breakdown, 'currency', o.currency,
    'shipping_address', o.shipping_address, 'pickup_point', o.pickup_point_snapshot,
    'tracking_number', o.tracking_number, 'shipping_carrier', o.shipping_carrier,
    'shipped_at', o.shipped_at, 'picked_up_at', o.picked_up_at, 'created_at', o.created_at,
    'payment_status', op.payment_status, 'slip_url', op.slip_url,
    'submitted_at', op.submitted_at, 'confirmed_at', op.confirmed_at,
    'expired_at', op.expired_at, 'review_note', op.review_note,
    'stock_hold_expires_at', op.stock_hold_expires_at,
    'upload_grace_expires_at', op.upload_grace_expires_at,
    'late_payment_reported_at', op.late_payment_reported_at, 'refunded_at', op.refunded_at,
    'payment_methods', case when op.payment_status = 'awaiting_payment' and greatest(op.stock_hold_expires_at, coalesce(op.upload_grace_expires_at, op.stock_hold_expires_at)) > now()
      then coalesce((select jsonb_agg(to_jsonb(pm) - 'artist_id' - 'created_at' - 'updated_at') from public.campaign_payment_methods pm where pm.campaign_id = c.id and pm.is_enabled), '[]'::jsonb)
      else '[]'::jsonb end,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'product_id', oi.product_id, 'name', coalesce(oi.product_name_snapshot, p.name),
      'sku', coalesce(oi.sku_snapshot, p.sku), 'quantity', oi.quantity,
      'price_per_unit', oi.price_per_unit, 'currency', oi.currency,
      'line_type', oi.line_type, 'promotion_name', promo.name
    ) order by oi.id)
      from public.order_items oi join public.products p on p.id = oi.product_id
      left join public.artist_promotions promo on promo.id = oi.promotion_id
      where oi.order_id = o.id), '[]'::jsonb)
  ) into v_result
  from public.orders o
  join public.online_campaigns c on c.id = o.campaign_id
  join public.artists a on a.id = c.artist_id
  join public.order_payments op on op.order_id = o.id
  where lower(a.slug) = lower(trim(p_artist_slug))
    and upper(o.pickup_code) = upper(trim(p_order_code)) and o.order_type = 'online_sale';
  return v_result;
end;
$$;

revoke all on function public.get_public_online_order_by_code(text, text) from public;
grant execute on function public.get_public_online_order_by_code(text, text) to anon, authenticated;

drop function if exists public.get_public_preorder_by_code(text, text);
create function public.get_public_preorder_by_code(p_artist_slug text, p_pickup_code text)
returns table (
  order_id uuid, event_id uuid, event_name text, artist_name text, order_type text,
  shipping_address text, tracking_number text, shipping_carrier text, shipped_at timestamptz,
  artist_facebook_url text, status text, pickup_status text, pickup_code text,
  customer_name text, customer_email_masked text, total_price numeric,
  subtotal_price numeric, discount_total numeric, pricing_breakdown jsonb,
  currency text, pickup_instructions text, payment_status text, slip_url text,
  submitted_at timestamptz, confirmed_at timestamptz, rejected_at timestamptz,
  review_note text, payment_methods jsonb, payment_deadline_at timestamptz,
  created_at timestamptz, picked_up_at timestamptz, items jsonb
)
language plpgsql security definer set search_path = ''
as $$
declare v_order_id uuid;
begin
  select o.id into v_order_id from public.orders o
  join public.events e on e.id = o.event_id join public.artists a on a.id = e.artist_id
  where a.slug = lower(trim(p_artist_slug)) and o.pickup_code = upper(trim(p_pickup_code))
    and o.order_type in ('preorder', 'post_event') order by o.created_at desc limit 1;
  if v_order_id is not null then perform private.expire_preorder_stock_hold(v_order_id); end if;

  return query select
    result.order_id, result.event_id, result.event_name, result.artist_name, result.order_type,
    result.shipping_address, result.tracking_number, result.shipping_carrier, result.shipped_at,
    result.artist_facebook_url, result.status, result.pickup_status, result.pickup_code,
    result.customer_name, result.customer_email_masked, result.total_price,
    o.subtotal_price, o.discount_total, o.pricing_breakdown,
    result.currency, result.pickup_instructions, result.payment_status, result.slip_url,
    result.submitted_at, result.confirmed_at, result.rejected_at, result.review_note,
    result.payment_methods,
    case when result.order_type in ('preorder', 'post_event') and result.payment_status = 'awaiting_payment' then op.stock_hold_expires_at else result.payment_deadline_at end,
    result.created_at, result.picked_up_at,
    coalesce((select jsonb_agg(jsonb_build_object(
      'product_id', oi.product_id, 'name', coalesce(oi.product_name_snapshot, p.name),
      'quantity', oi.quantity, 'price_per_unit', oi.price_per_unit, 'currency', oi.currency,
      'line_type', oi.line_type, 'promotion_name', promo.name
    ) order by oi.id) from public.order_items oi
      join public.products p on p.id = oi.product_id
      left join public.artist_promotions promo on promo.id = oi.promotion_id
      where oi.order_id = result.order_id), '[]'::jsonb)
  from private.get_public_preorder_by_code_base(p_artist_slug, p_pickup_code) result
  join public.orders o on o.id = result.order_id
  left join public.order_payments op on op.order_id = result.order_id;
end;
$$;

revoke all on function public.get_public_preorder_by_code(text, text) from public;
grant execute on function public.get_public_preorder_by_code(text, text) to anon, authenticated;
