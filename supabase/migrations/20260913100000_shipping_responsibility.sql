-- Shipping contact access requires an explicit owner assignment for sellers.
begin;
alter table public.artist_members add column can_manage_shipping boolean not null default false;
create function public.has_shipping_access(p_artist_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    public.has_artist_role(p_artist_id, array['owner','manager']) or exists (
      select 1 from public.artist_members m where m.artist_id = p_artist_id
        and m.status = 'active' and m.role = 'seller' and m.can_manage_shipping
        and lower(m.member_email) = lower(auth.jwt()->>'email')
    )
  );
$$;
revoke all on function public.has_shipping_access(uuid) from public, anon;
grant execute on function public.has_shipping_access(uuid) to authenticated;

-- Role changes/reactivation never silently restore an old shipping assignment.
create function public.reset_shipping_assignment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.role is distinct from old.role or new.status is distinct from old.status then
    new.can_manage_shipping := false;
  end if;
  return new;
end;
$$;
create trigger reset_shipping_assignment before update of role, status on public.artist_members
for each row execute function public.reset_shipping_assignment();
revoke all on function public.reset_shipping_assignment() from public, anon, authenticated;

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
    'can_manage_shipping', public.has_shipping_access(v_campaign.artist_id),
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
        'customer_email', case when public.has_shipping_access(v_campaign.artist_id) then o.customer_email else null end,
        'customer_phone', case when public.has_shipping_access(v_campaign.artist_id) then o.customer_phone else null end,
        'shipping_address', case when public.has_shipping_access(v_campaign.artist_id) then o.shipping_address else null end,
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

create or replace function public.mark_online_order_shipped(
  p_order_id uuid,
  p_carrier text,
  p_tracking_number text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
begin
  if length(trim(coalesce(p_tracking_number, ''))) = 0 then
    raise exception 'tracking_number_required';
  end if;

  select o.*, c.artist_id, op.id as payment_id, op.payment_status
  into v_order
  from public.orders o
  join public.online_campaigns c on c.id = o.campaign_id
  join public.order_payments op on op.order_id = o.id
  where o.id = p_order_id
    and o.order_type = 'online_sale'
  for update of o, op;

  if v_order.id is null then raise exception 'order_not_found'; end if;
  if not public.has_shipping_access(v_order.artist_id) then
    raise exception 'forbidden';
  end if;

  if v_order.pickup_status = 'shipped' then
    return jsonb_build_object('order_id', v_order.id, 'fulfillment_status', 'shipped');
  end if;

  if v_order.status <> 'confirmed'
     or v_order.payment_status <> 'payment_confirmed'
     or v_order.fulfillment_method <> 'shipping'
     or v_order.pickup_status <> 'awaiting_shipment' then
    raise exception 'shipment_not_allowed';
  end if;

  update public.orders
  set status = 'completed',
      pickup_status = 'shipped',
      shipping_carrier = nullif(trim(coalesce(p_carrier, '')), ''),
      tracking_number = trim(p_tracking_number),
      shipped_at = now()
  where id = v_order.id;

  perform private.append_campaign_payment_review_event(
    v_order.id, v_order.payment_id, v_order.campaign_id, v_order.artist_id,
    'order_shipped', 'awaiting_shipment', 'shipped',
    null, trim(p_tracking_number),
    jsonb_build_object('carrier', nullif(trim(coalesce(p_carrier, '')), ''))
  );

  return jsonb_build_object('order_id', v_order.id, 'fulfillment_status', 'shipped');
end;
$$;

create or replace function public.mark_order_shipped(
  p_order_id uuid,
  p_tracking_number text,
  p_carrier text default ''
)
returns table (
  order_id uuid,
  pickup_status text,
  shipped_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_payment record;
  v_item record;
  v_now timestamptz := now();
begin
  if length(trim(coalesce(p_tracking_number, ''))) = 0 then
    raise exception 'tracking_required';
  end if;

  select o.*, e.artist_id
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  if not public.has_event_role(v_order.event_id, array['owner', 'manager', 'seller'])
    or not public.has_shipping_access(v_order.artist_id) then
    raise exception 'forbidden';
  end if;

  if v_order.order_type <> 'post_event' then
    raise exception 'not_post_order';
  end if;

  select op.*
  into v_payment
  from public.order_payments op
  where op.order_id = v_order.id
  for update;

  if coalesce(v_payment.payment_status, '') <> 'payment_confirmed' then
    raise exception 'payment_not_confirmed';
  end if;

  if v_order.pickup_status = 'shipped' then
    return query select v_order.id, 'shipped'::text, v_order.shipped_at;
    return;
  end if;

  for v_item in
    select
      oi.product_id,
      oi.event_product_id,
      oi.quantity,
      p.is_unlimited as product_unlimited,
      ep.is_unlimited as event_unlimited
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    left join public.event_products ep on ep.id = oi.event_product_id
    where oi.order_id = v_order.id
    for update of p
  loop
    if v_item.event_product_id is not null then
      if not coalesce(v_item.event_unlimited, true) then
        update public.event_products
        set stock_reserved = greatest(stock_reserved - v_item.quantity, 0),
            stock_sold = stock_sold + v_item.quantity
        where id = v_item.event_product_id;
      end if;
    elsif not coalesce(v_item.product_unlimited, true) then
      update public.products
      set stock_reserved = greatest(stock_reserved - v_item.quantity, 0),
          stock_sold = stock_sold + v_item.quantity,
          updated_at = now()
      where id = v_item.product_id;
    end if;
  end loop;

  update public.orders
  set tracking_number = trim(p_tracking_number),
      shipping_carrier = nullif(trim(coalesce(p_carrier, '')), ''),
      shipped_at = v_now,
      pickup_status = 'shipped',
      status = 'completed'
  where id = v_order.id;

  return query select v_order.id, 'shipped'::text, v_now;
end;
$$;

create or replace function public.list_preorder_payment_review(
  p_event_id uuid,
  p_payment_status text default null
)
returns table (
  order_id uuid,
  pickup_code text,
  customer_name text,
  order_type text,
  shipping_address text,
  tracking_number text,
  shipping_carrier text,
  shipped_at timestamptz,
  pickup_status text,
  customer_contact text,
  customer_phone text,
  customer_social text,
  customer_email text,
  customer_note text,
  total_price numeric,
  currency text,
  payment_status text,
  slip_url text,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  rejected_at timestamptz,
  expired_at timestamptz,
  review_note text,
  items jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
begin
  select e.* into v_event from public.events e where e.id = p_event_id;
  if v_event.id is null then
    raise exception 'event_not_found';
  end if;
  if not public.has_event_role(p_event_id, array['owner', 'manager', 'seller']) then
    raise exception 'forbidden';
  end if;

  return query
  select
    o.id,
    o.pickup_code,
    o.customer_name,
    o.order_type,
    case when public.has_shipping_access(v_event.artist_id) then o.shipping_address else null end,
    o.tracking_number,
    o.shipping_carrier,
    o.shipped_at,
    o.pickup_status,
    case when public.has_shipping_access(v_event.artist_id) then o.customer_contact else null end,
    case when public.has_shipping_access(v_event.artist_id) then o.customer_phone else null end,
    case when public.has_shipping_access(v_event.artist_id) then o.customer_social else null end,
    case when public.has_shipping_access(v_event.artist_id) then o.customer_email else null end,
    case when public.has_shipping_access(v_event.artist_id) then o.customer_note else null end,
    o.total_price,
    o.currency,
    op.payment_status,
    op.slip_url,
    op.submitted_at,
    op.confirmed_at,
    op.rejected_at,
    op.expired_at,
    op.review_note,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id', oi.product_id,
        'name', p.name,
        'quantity', oi.quantity,
        'price_per_unit', oi.price_per_unit,
        'currency', oi.currency
      ) order by p.name)
      from public.order_items oi
      join public.products p on p.id = oi.product_id
      where oi.order_id = o.id
    ), '[]'::jsonb)
  from public.orders o
  join public.order_payments op on op.order_id = o.id
  where o.event_id = p_event_id
    and o.order_type in ('preorder', 'post_event')
    and (p_payment_status is null or op.payment_status = p_payment_status)
  order by coalesce(op.submitted_at, o.created_at) desc;
end;
$$;
-- Contact fields are available through authorized RPCs, not broad order reads.
revoke select (customer_contact, customer_phone, customer_social, customer_email, customer_note, shipping_address)
on public.orders from anon, authenticated;
commit;
