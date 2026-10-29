alter function public.create_customer_order_with_stock(uuid,jsonb,uuid) set schema private;
alter function private.create_customer_order_with_stock(uuid,jsonb,uuid) rename to create_customer_order_authorized;
revoke all on function private.create_customer_order_authorized(uuid,jsonb,uuid) from public,anon,authenticated;

create function public.create_customer_order_with_stock(p_queue_id uuid,p_items jsonb,p_payment_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_event uuid;
begin
  select event_id into v_event from public.queues where id=p_queue_id;
  if auth.uid() is null or not coalesce(public.has_event_role(v_event,array['owner','manager','seller']),false) then
    raise exception 'ticket_ownership_mismatch';
  end if;
  return private.create_customer_order_authorized(p_queue_id,p_items,p_payment_idempotency_key);
end $$;
revoke all on function public.create_customer_order_with_stock(uuid,jsonb,uuid) from public,anon;
grant execute on function public.create_customer_order_with_stock(uuid,jsonb,uuid) to authenticated;

create function public.create_customer_order_with_stock(p_queue_id uuid,p_items jsonb,p_customer_fingerprint text,p_payment_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_fingerprint text;
begin
  select customer_fingerprint into v_fingerprint from public.queues where id=p_queue_id for update;
  if v_fingerprint is null or p_customer_fingerprint is null
     or v_fingerprint !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_fingerprint <> p_customer_fingerprint then
    raise exception 'ticket_ownership_mismatch';
  end if;
  return private.create_customer_order_authorized(p_queue_id,p_items,p_payment_idempotency_key);
end $$;
revoke all on function public.create_customer_order_with_stock(uuid,jsonb,text,uuid) from public;
grant execute on function public.create_customer_order_with_stock(uuid,jsonb,text,uuid) to anon,authenticated;
