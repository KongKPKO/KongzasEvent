create table public.admin_order_email_resends (
  id uuid primary key,
  actor_id uuid not null,
  order_id uuid not null,
  reason text not null check (char_length(reason) between 5 and 500),
  status text not null default 'sending' check (status in ('sending','accepted','failed','unknown')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on public.admin_order_email_resends(order_id,created_at desc);
alter table public.admin_order_email_resends enable row level security;
revoke all on public.admin_order_email_resends from public,anon,authenticated;
grant select,update on public.admin_order_email_resends to service_role;

create function private.admin_order_email_claim(p_order_id uuid,p_request_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  previous public.admin_order_email_resends;
  order_row public.orders;
  clean_reason text := btrim(coalesce(p_reason,''));
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  if p_request_id is null or char_length(clean_reason) not between 5 and 500 then raise exception 'invalid_request'; end if;
  select * into order_row from public.orders where id=p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  select * into previous from public.admin_order_email_resends where id=p_request_id;
  if found then
    if previous.actor_id<>auth.uid() or previous.order_id<>p_order_id or previous.reason<>clean_reason then raise exception 'request_conflict'; end if;
    return jsonb_build_object('send',false,'status',previous.status);
  end if;
  if order_row.order_type not in ('online_sale','preorder','post_event') then raise exception 'unsupported_order'; end if;
  if nullif(btrim(order_row.customer_email),'') is null or nullif(order_row.pickup_code,'') is null then raise exception 'missing_email_or_code'; end if;
  if exists(select 1 from public.admin_order_email_resends where order_id=p_order_id and created_at>clock_timestamp()-interval '60 seconds') then raise exception 'cooldown'; end if;
  insert into public.admin_order_email_resends(id,actor_id,order_id,reason)
    values(p_request_id,auth.uid(),p_order_id,clean_reason);
  return jsonb_build_object('send',true,'status','sending');
end $$;
create function public.admin_order_email_claim(p_order_id uuid,p_request_id uuid,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.admin_order_email_claim(p_order_id,p_request_id,p_reason);
$$;
revoke all on function private.admin_order_email_claim(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.admin_order_email_claim(uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.admin_order_email_claim(uuid,uuid,text) to authenticated;
grant execute on function public.admin_order_email_claim(uuid,uuid,text) to authenticated;

create function private.admin_support_history(p_order_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare detail jsonb; result jsonb;
begin
  -- Existing guard, reason validation and atomic access logging stay canonical.
  detail := private.admin_support('order',null,p_order_id,p_reason,null);
  if detail is null then return null; end if;
  select jsonb_build_object(
    'created_at',o.created_at,'submitted_at',p.submitted_at,'confirmed_at',p.confirmed_at,
    'rejected_at',p.rejected_at,'shipped_at',o.shipped_at,'picked_up_at',o.picked_up_at,
    'can_resend',o.order_type in ('online_sale','preorder','post_event') and nullif(btrim(o.customer_email),'') is not null and nullif(o.pickup_code,'') is not null,
    'deliveries',coalesce((select jsonb_agg(to_jsonb(r)) from (
      select notification_event,status,attempts,created_at,claimed_at,delivered_at
      from public.preorder_notification_deliveries where order_id=p_order_id order by created_at desc,id limit 25
    ) r),'[]'::jsonb),
    'resends',coalesce((select jsonb_agg(to_jsonb(r)) from (
      select id,actor_id,status,created_at,finished_at from public.admin_order_email_resends
      where order_id=p_order_id order by created_at desc,id limit 25
    ) r),'[]'::jsonb)
  ) into result from public.orders o left join public.order_payments p on p.order_id=o.id where o.id=p_order_id;
  return result;
end $$;
create function public.admin_support_history(p_order_id uuid,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.admin_support_history(p_order_id,p_reason);
$$;
revoke all on function private.admin_support_history(uuid,text) from public,anon,authenticated;
revoke all on function public.admin_support_history(uuid,text) from public,anon,authenticated;
grant execute on function private.admin_support_history(uuid,text) to authenticated;
grant execute on function public.admin_support_history(uuid,text) to authenticated;
