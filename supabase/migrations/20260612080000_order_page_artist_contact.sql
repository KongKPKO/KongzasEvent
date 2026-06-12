-- Order page: include the artist's display name and contact link so
-- rejected/expired orders can point the customer at a real channel
-- instead of a dead end.

drop function if exists public.get_public_preorder_by_code(text, text);

create or replace function public.get_public_preorder_by_code(
  p_artist_slug text,
  p_pickup_code text
)
returns table (
  order_id uuid,
  event_id uuid,
  event_name text,
  artist_name text,
  artist_facebook_url text,
  status text,
  pickup_status text,
  pickup_code text,
  customer_name text,
  customer_email_masked text,
  total_price numeric,
  currency text,
  pickup_instructions text,
  payment_status text,
  slip_url text,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  rejected_at timestamptz,
  review_note text,
  payment_methods jsonb,
  payment_deadline_at timestamptz,
  created_at timestamptz,
  picked_up_at timestamptz,
  items jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    o.id,
    o.event_id,
    e.event_name,
    a.display_name,
    a.facebook_url,
    o.status,
    o.pickup_status,
    o.pickup_code,
    o.customer_name,
    case
      when coalesce(o.customer_email, '') = '' then ''
      else left(split_part(o.customer_email, '@', 1), 2) || '***@' || split_part(o.customer_email, '@', 2)
    end,
    o.total_price,
    o.currency,
    coalesce(e.preorder_pickup_instructions, ''),
    coalesce(op.payment_status, 'awaiting_payment'),
    op.slip_url,
    op.submitted_at,
    op.confirmed_at,
    op.rejected_at,
    op.review_note,
    coalesce((
      select jsonb_agg(to_jsonb(epm) - 'artist_id' - 'created_at' - 'updated_at')
      from public.event_payment_methods epm
      where epm.event_id = o.event_id
        and epm.is_enabled = true
    ), '[]'::jsonb),
    (
      select min(epm.payment_deadline_at)
      from public.event_payment_methods epm
      where epm.event_id = o.event_id
        and epm.is_enabled = true
        and epm.payment_deadline_at is not null
    ),
    o.created_at,
    o.picked_up_at,
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
  join public.events e on e.id = o.event_id
  join public.artists a on a.id = e.artist_id
  left join public.order_payments op on op.order_id = o.id
  where a.slug = lower(trim(p_artist_slug))
    and o.pickup_code = upper(trim(p_pickup_code))
    and o.order_type = 'preorder'
  order by o.created_at desc
  limit 1;
end;
$$;

revoke all on function public.get_public_preorder_by_code(text, text) from public;
grant execute on function public.get_public_preorder_by_code(text, text) to anon, authenticated;
