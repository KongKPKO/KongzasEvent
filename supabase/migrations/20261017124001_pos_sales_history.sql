-- Paginated, read-only sales history for the live-event POS. The exposed
-- wrappers stay security-invoker functions; privileged reads live in the
-- private schema and perform their own event-role check before reading rows.

create index if not exists idx_orders_pos_history_created
  on public.orders (event_id, created_at desc, id desc)
  where campaign_id is null
    and (order_type is null or order_type in ('live_queue', 'pos_walkin'));

create or replace function private.list_pos_sales_history(
  p_event_id uuid,
  p_search text default null,
  p_order_status text default null,
  p_payment_method text default null,
  p_payment_status text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := lower(btrim(coalesce(p_search, '')));
  v_queue_search text;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 20), 1), 50);
  v_result jsonb;
begin
  if auth.uid() is null
     or not public.has_event_role(p_event_id, array['owner', 'manager', 'seller']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if char_length(v_search) > 100 then
    raise exception 'search_too_long';
  end if;

  if p_from is not null and p_to is not null and p_from >= p_to then
    raise exception 'invalid_date_range';
  end if;

  v_queue_search := nullif(regexp_replace(v_search, '[^0-9]', '', 'g'), '');

  with filtered as (
    select
      o.id,
      coalesce(nullif(o.pickup_code, ''), upper(left(replace(o.id::text, '-', ''), 8))) as order_number,
      o.created_at,
      o.status,
      o.total_price,
      o.payment_method,
      o.currency,
      o.queue_id,
      q.queue_number,
      case when o.queue_id is null then 'walk_in' else 'queue' end as customer_type,
      coalesce(
        op.payment_status,
        case
          when o.status = 'completed' then 'payment_confirmed'
          when o.status = 'cancelled' then 'payment_cancelled'
          else 'awaiting_payment'
        end
      ) as payment_status
    from public.orders o
    left join public.queues q on q.id = o.queue_id and q.event_id = o.event_id
    left join public.order_payments op on op.order_id = o.id
    where o.event_id = p_event_id
      and o.campaign_id is null
      and (o.order_type is null or o.order_type in ('live_queue', 'pos_walkin'))
      and (nullif(btrim(coalesce(p_order_status, '')), '') is null or o.status = p_order_status)
      and (nullif(btrim(coalesce(p_payment_method, '')), '') is null or o.payment_method = p_payment_method)
      and (
        nullif(btrim(coalesce(p_payment_status, '')), '') is null
        or coalesce(
          op.payment_status,
          case
            when o.status = 'completed' then 'payment_confirmed'
            when o.status = 'cancelled' then 'payment_cancelled'
            else 'awaiting_payment'
          end
        ) = p_payment_status
      )
      and (p_from is null or o.created_at >= p_from)
      and (p_to is null or o.created_at < p_to)
      and (
        v_search = ''
        or lower(o.id::text) like '%' || v_search || '%'
        or lower(replace(o.id::text, '-', '')) like '%' || replace(v_search, '-', '') || '%'
        or lower(coalesce(o.pickup_code, '')) like '%' || v_search || '%'
        or (v_queue_search is not null and q.queue_number::text like '%' || v_queue_search || '%')
      )
  ),
  page_rows as (
    select *
    from filtered
    order by created_at desc, id desc
    limit v_page_size
    offset (v_page - 1) * v_page_size
  )
  select jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'order_number', p.order_number,
          'created_at', p.created_at,
          'status', p.status,
          'payment_status', p.payment_status,
          'payment_method', p.payment_method,
          'total_price', p.total_price,
          'currency', p.currency,
          'customer_type', p.customer_type,
          'queue_id', p.queue_id,
          'queue_number', p.queue_number,
          'item_count', coalesce((
            select sum(oi.quantity)::integer
            from public.order_items oi
            where oi.order_id = p.id
          ), 0)
        )
        order by p.created_at desc, p.id desc
      )
      from page_rows p
    ), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'page', v_page,
    'page_size', v_page_size
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.list_pos_sales_history(
  p_event_id uuid,
  p_search text default null,
  p_order_status text default null,
  p_payment_method text default null,
  p_payment_status text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.list_pos_sales_history(
    p_event_id,
    p_search,
    p_order_status,
    p_payment_method,
    p_payment_status,
    p_from,
    p_to,
    p_page,
    p_page_size
  );
$$;

create or replace function private.get_pos_sale_detail(
  p_event_id uuid,
  p_order_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null
     or not public.has_event_role(p_event_id, array['owner', 'manager', 'seller']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', o.id,
    'order_number', coalesce(nullif(o.pickup_code, ''), upper(left(replace(o.id::text, '-', ''), 8))),
    'created_at', o.created_at,
    'status', o.status,
    'payment_status', coalesce(
      op.payment_status,
      case
        when o.status = 'completed' then 'payment_confirmed'
        when o.status = 'cancelled' then 'payment_cancelled'
        else 'awaiting_payment'
      end
    ),
    'payment_method', o.payment_method,
    'customer_type', case when o.queue_id is null then 'walk_in' else 'queue' end,
    'queue_id', o.queue_id,
    'queue_number', q.queue_number,
    'currency', o.currency,
    'subtotal_price', coalesce(o.subtotal_price, o.total_price + coalesce(o.discount_total, 0)),
    'discount_total', coalesce(o.discount_total, 0),
    'total_price', o.total_price,
    'note', nullif(o.customer_note, ''),
    'pricing_breakdown', coalesce(o.pricing_breakdown, '[]'::jsonb),
    'payment', jsonb_build_object(
      'amount_expected', coalesce(op.amount_expected, o.total_price),
      'status', coalesce(
        op.payment_status,
        case
          when o.status = 'completed' then 'payment_confirmed'
          when o.status = 'cancelled' then 'payment_cancelled'
          else 'awaiting_payment'
        end
      ),
      'method', o.payment_method,
      'submitted_at', op.submitted_at,
      'confirmed_at', op.confirmed_at,
      'refunded_at', op.refunded_at,
      'refund_note', op.refund_note,
      'refund_reference', op.refund_reference
    ),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', oi.id,
          'product_id', oi.product_id,
          'name', coalesce(nullif(oi.product_name_snapshot, ''), p.name),
          'variant_name', case
            when nullif(oi.product_name_snapshot, '') is null then nullif(p.variant_name, '')
            else null
          end,
          'sku', coalesce(nullif(oi.sku_snapshot, ''), p.sku),
          'quantity', oi.quantity,
          'price_per_unit', oi.price_per_unit,
          'line_total', oi.quantity * oi.price_per_unit,
          'currency', oi.currency,
          'line_type', oi.line_type,
          'promotion_name', promo.name,
          'note', nullif(oi.notes, ''),
          'components', private.order_bundle_components(oi.id),
          'discount_amount', null
        )
        order by oi.id
      )
      from public.order_items oi
      left join public.products p on p.id = oi.product_id
      left join public.artist_promotions promo on promo.id = oi.promotion_id
      where oi.order_id = o.id
    ), '[]'::jsonb),
    'status_history', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'event_type', pre.event_type,
          'from_status', pre.from_status,
          'to_status', pre.to_status,
          'actor_role', pre.actor_role,
          'created_at', pre.created_at
        )
        order by pre.created_at, pre.id
      )
      from public.payment_review_events pre
      where pre.order_id = o.id
    ), '[]'::jsonb)
  ) into v_result
  from public.orders o
  left join public.queues q on q.id = o.queue_id and q.event_id = o.event_id
  left join public.order_payments op on op.order_id = o.id
  where o.id = p_order_id
    and o.event_id = p_event_id
    and o.campaign_id is null
    and (o.order_type is null or o.order_type in ('live_queue', 'pos_walkin'));

  return v_result;
end;
$$;

create or replace function public.get_pos_sale_detail(
  p_event_id uuid,
  p_order_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_pos_sale_detail(p_event_id, p_order_id);
$$;

revoke all on function private.list_pos_sales_history(uuid, text, text, text, text, timestamptz, timestamptz, integer, integer)
  from public, anon, authenticated;
revoke all on function public.list_pos_sales_history(uuid, text, text, text, text, timestamptz, timestamptz, integer, integer)
  from public, anon, authenticated;
revoke all on function private.get_pos_sale_detail(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.get_pos_sale_detail(uuid, uuid)
  from public, anon, authenticated;

grant usage on schema private to authenticated;
grant execute on function private.list_pos_sales_history(uuid, text, text, text, text, timestamptz, timestamptz, integer, integer)
  to authenticated;
grant execute on function public.list_pos_sales_history(uuid, text, text, text, text, timestamptz, timestamptz, integer, integer)
  to authenticated;
grant execute on function private.get_pos_sale_detail(uuid, uuid)
  to authenticated;
grant execute on function public.get_pos_sale_detail(uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';
