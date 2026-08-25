-- New functions must opt into public API access explicitly.
alter default privileges for role postgres
  revoke execute on functions from public;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon;

-- CREATE OR REPLACE preserves old ACLs, so remove inherited public access from
-- every privileged function that exists when this migration is applied.
do $$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute format(
      'revoke execute on function %s from public, anon',
      v_function
    );
  end loop;
end
$$;

-- These helpers are called only by trusted database functions.
revoke execute on function public.append_payment_review_event(uuid, uuid, uuid, uuid, text, text, text, text, text, jsonb) from authenticated;
revoke execute on function public.generate_pickup_code(uuid) from authenticated;
revoke execute on function public.release_preorder_order_stock(uuid) from authenticated;
revoke execute on function public.reserve_preorder_order_stock(uuid) from authenticated;

-- Anonymous customer flows and public-read RLS helpers intentionally exposed.
grant execute on function public.cancel_customer_order_with_stock_release(uuid) to anon, authenticated;
grant execute on function public.cancel_public_preorder_before_payment(uuid, text) to anon, authenticated;
grant execute on function public.create_customer_order_with_stock(uuid, jsonb, uuid) to anon, authenticated;
grant execute on function public.create_preorder_with_stock(uuid, jsonb, text, text, text, uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.create_queue_ticket(uuid, uuid, text) to anon, authenticated;
grant execute on function public.estimate_queue_eta(uuid, integer) to anon, authenticated;
grant execute on function public.get_customer_order_status(uuid, uuid) to anon, authenticated;
grant execute on function public.get_public_order_receipt(uuid, text) to anon, authenticated;
grant execute on function public.get_public_preorder_by_code(text, text) to anon, authenticated;
grant execute on function public.has_artist_role(uuid, text[]) to anon, authenticated;
grant execute on function public.has_event_role(uuid, text[]) to anon, authenticated;
grant execute on function public.is_creator_slug_available(text) to anon, authenticated;
grant execute on function public.is_platform_admin() to anon, authenticated;
grant execute on function public.leave_queue_ticket(uuid, text) to anon, authenticated;
grant execute on function public.list_event_products(uuid) to anon, authenticated;
grant execute on function public.submit_preorder_payment_evidence(uuid, text, text, uuid) to anon, authenticated;
