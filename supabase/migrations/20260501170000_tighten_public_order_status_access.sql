-- Tighten anonymous order visibility. Customers can still check their own order
-- status through a narrow RPC that requires both order_id and queue_id.

drop policy if exists "orders_public_read_active_queue" on public.orders;
drop policy if exists "orders_public_insert_active_queue" on public.orders;
drop policy if exists "orders_public_delete_pending" on public.orders;
drop policy if exists "order_items_public_insert" on public.order_items;

create or replace function public.get_customer_order_status(
  p_order_id uuid,
  p_queue_id uuid
)
returns table (
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select o.status
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
    and o.queue_id = p_queue_id
    and e.status = 'Confirmed'
    and e.start_date <= now()
    and e.end_date >= now()
  limit 1;
end;
$$;

grant execute on function public.get_customer_order_status(uuid, uuid) to anon, authenticated;
