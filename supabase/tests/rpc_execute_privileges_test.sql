begin;

select plan(7);

create function public.rpc_default_privilege_probe()
returns boolean
language sql
as $$ select true $$;

select ok(
  not has_function_privilege('anon', 'public.rpc_default_privilege_probe()', 'execute'),
  'new public functions are not executable by anon by default'
);

drop function public.rpc_default_privilege_probe();

with public_rpc(signature) as (
  values
    ('public.cancel_customer_order_with_stock_release(uuid)'),
    ('public.cancel_public_preorder_before_payment(uuid,text)'),
    ('public.create_customer_order_with_stock(uuid,jsonb,uuid)'),
    ('public.create_online_campaign_order(uuid,jsonb,text,uuid,text,text,text,text,text,uuid)'),
    ('public.create_preorder_with_stock(uuid,jsonb,text,text,text,uuid,text,text,text,text)'),
    ('public.create_queue_ticket(uuid,uuid,text)'),
    ('public.estimate_queue_eta(uuid,integer)'),
    ('public.get_customer_order_status(uuid,uuid)'),
    ('public.get_public_order_receipt(uuid,text)'),
    ('public.get_public_online_campaign(text,text)'),
    ('public.get_public_online_order_by_code(text,text)'),
    ('public.get_public_preorder_by_code(text,text)'),
    ('public.has_artist_role(uuid,text[])'),
    ('public.has_event_role(uuid,text[])'),
    ('public.is_creator_slug_available(text)'),
    ('public.is_platform_admin()'),
    ('public.leave_queue_ticket(uuid,text)'),
    ('public.list_event_products(uuid)'),
    ('public.begin_online_payment_upload(text,text)'),
    ('public.submit_online_payment_evidence(text,text,text,uuid)'),
    ('public.submit_preorder_payment_evidence(uuid,text,text,uuid)')
)
select is(
  (
    select count(*)
    from public_rpc r
    where to_regprocedure(r.signature) is not null
      and has_function_privilege('anon', to_regprocedure(r.signature), 'execute')
  ),
  21::bigint,
  'anon retains every intentional public RPC and RLS helper'
);

with public_rpc(signature) as (
  values
    ('public.cancel_customer_order_with_stock_release(uuid)'),
    ('public.cancel_public_preorder_before_payment(uuid,text)'),
    ('public.create_customer_order_with_stock(uuid,jsonb,uuid)'),
    ('public.create_online_campaign_order(uuid,jsonb,text,uuid,text,text,text,text,text,uuid)'),
    ('public.create_preorder_with_stock(uuid,jsonb,text,text,text,uuid,text,text,text,text)'),
    ('public.create_queue_ticket(uuid,uuid,text)'),
    ('public.estimate_queue_eta(uuid,integer)'),
    ('public.get_customer_order_status(uuid,uuid)'),
    ('public.get_public_order_receipt(uuid,text)'),
    ('public.get_public_online_campaign(text,text)'),
    ('public.get_public_online_order_by_code(text,text)'),
    ('public.get_public_preorder_by_code(text,text)'),
    ('public.has_artist_role(uuid,text[])'),
    ('public.has_event_role(uuid,text[])'),
    ('public.is_creator_slug_available(text)'),
    ('public.is_platform_admin()'),
    ('public.leave_queue_ticket(uuid,text)'),
    ('public.list_event_products(uuid)'),
    ('public.begin_online_payment_upload(text,text)'),
    ('public.submit_online_payment_evidence(text,text,text,uuid)'),
    ('public.submit_preorder_payment_evidence(uuid,text,text,uuid)')
)
select is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')
      and not exists (
        select 1
        from public_rpc r
        where to_regprocedure(r.signature) = p.oid
      )
  ),
  0::bigint,
  'anon cannot execute authenticated or internal security-definer functions'
);

with authenticated_rpc(signature) as (
  values
    ('public.approve_creator_application(uuid,text)'),
    ('public.complete_order_with_stock(uuid,text,uuid)'),
    ('public.confirm_preorder_payment(uuid,text)'),
    ('public.get_actor_context()'),
    ('public.mark_order_shipped(uuid,text,text)'),
    ('public.save_event_catalog(uuid,jsonb,text,boolean)'),
    ('public.set_booth_open_status(uuid,boolean)'),
    ('public.update_artist_member_role(uuid,text)')
)
select is(
  (
    select count(*)
    from authenticated_rpc r
    where not has_function_privilege('anon', to_regprocedure(r.signature), 'execute')
      and has_function_privilege('authenticated', to_regprocedure(r.signature), 'execute')
  ),
  8::bigint,
  'authenticated RPCs reject anon without breaking signed-in callers'
);

with internal_rpc(signature) as (
  values
    ('public.append_payment_review_event(uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb)'),
    ('public.generate_pickup_code(uuid)'),
    ('public.release_preorder_order_stock(uuid)'),
    ('public.reserve_preorder_order_stock(uuid)')
)
select is(
  (
    select count(*)
    from internal_rpc r
    where not has_function_privilege('anon', to_regprocedure(r.signature), 'execute')
      and not has_function_privilege('authenticated', to_regprocedure(r.signature), 'execute')
      and has_function_privilege('service_role', to_regprocedure(r.signature), 'execute')
  ),
  4::bigint,
  'internal helpers are executable only by trusted backend roles'
);

select ok(
  not has_function_privilege('anon', 'private.expire_preorder_stock_holds()', 'execute')
  and not has_function_privilege('authenticated', 'private.expire_preorder_stock_holds()', 'execute'),
  'stock-hold cleanup is unavailable to API roles'
);

select is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where n.nspname = 'public'
      and p.prosecdef
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  0::bigint,
  'security-definer functions never grant EXECUTE to PUBLIC'
);

select * from finish();

rollback;
