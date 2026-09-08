create table private.admin_support_access (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  action text not null check (action in ('search_stores','search_orders','store','order')),
  store_id uuid,
  order_id uuid,
  reason text,
  created_at timestamptz not null default now()
);
alter table private.admin_support_access enable row level security;
revoke all on private.admin_support_access from public, anon, authenticated;
revoke all on sequence private.admin_support_access_id_seq from public, anon, authenticated;

create function private.admin_support(
  p_action text, p_query text, p_target uuid, p_reason text, p_store_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  q text := lower(btrim(coalesce(p_query,'')));
  reason text := btrim(coalesce(p_reason,''));
  result jsonb;
  store_id uuid;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  if p_action is null or p_action not in ('search_stores','search_orders','store','order') then
    raise exception 'invalid_action';
  end if;
  if p_action in ('search_stores','search_orders') then
    if char_length(q) not between 2 and 100 then raise exception 'invalid_query'; end if;
    if p_action = 'search_stores' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into result from (
        select a.id, a.display_name name, a.slug, a.is_public, a.is_verified, a.published_at
        from public.artists a
        where strpos(lower(coalesce(a.display_name,'')),q)>0
          or strpos(lower(coalesce(a.slug,'')),q)>0 or strpos(lower(coalesce(a.email,'')),q)>0
        order by a.display_name, a.id limit 25
      ) r;
    else
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into result from (
        select o.id, o.pickup_code code, o.created_at, o.status, a.id store_id,
          a.display_name store_name, coalesce(c.name,e.event_name) channel_name,
          case when c.id is not null then 'campaign' else 'event' end channel_type
        from public.orders o
        left join public.events e on e.id=o.event_id
        left join public.online_campaigns c on c.id=o.campaign_id
        join public.artists a on a.id=coalesce(c.artist_id,e.artist_id)
        where (lower(o.id::text)=q or lower(o.pickup_code)=q)
          and (p_store_id is null or a.id=p_store_id)
        order by o.created_at desc, o.id limit 25
      ) r;
    end if;
    insert into private.admin_support_access(actor_id,action) values(auth.uid(),p_action);
    return jsonb_build_object('results',result,'limited',jsonb_array_length(result)=25);
  end if;
  if char_length(reason) not between 5 and 500 then raise exception 'invalid_reason'; end if;
  if p_target is null then raise exception 'invalid_target'; end if;
  if p_action='store' then
    select jsonb_build_object('kind','store','id',a.id,'name',a.display_name,'slug',a.slug,
      'is_public',a.is_public,'is_verified',a.is_verified,'published_at',a.published_at,
      'events',coalesce((select jsonb_agg(to_jsonb(r)) from (
        select e.id,e.event_name name,e.status,e.start_date starts_at,e.end_date ends_at
        from public.events e where e.artist_id=a.id order by e.created_at desc,e.id limit 25
      ) r),'[]'::jsonb),
      'campaigns',coalesce((select jsonb_agg(to_jsonb(r)) from (
        select c.id,c.name,c.publication_status status,c.opens_at starts_at,c.closes_at ends_at
        from public.online_campaigns c where c.artist_id=a.id order by c.created_at desc,c.id limit 25
      ) r),'[]'::jsonb)) into result
    from public.artists a where a.id=p_target;
    store_id := p_target;
  else
    select a.id, jsonb_build_object('kind','order','id',o.id,'code',o.pickup_code,
      'store_id',a.id,'store_name',a.display_name,'channel_name',coalesce(c.name,e.event_name),
      'channel_type',case when c.id is not null then 'campaign' else 'event' end,
      'order_type',o.order_type,'created_at',o.created_at,'status',o.status,
      'customer_name',o.customer_name,
      'customer_email_masked',case when nullif(o.customer_email,'') is not null then '***@'||split_part(o.customer_email,'@',2) end,
      'customer_phone_masked',case when nullif(o.customer_phone,'') is not null then '***'||right(o.customer_phone,2) end,
      'currency',o.currency,'subtotal_price',o.subtotal_price,'discount_total',o.discount_total,
      'shipping_fee',o.shipping_fee,'total_price',o.total_price,
      'payment_status',op.payment_status,'submitted_at',op.submitted_at,
      'stock_hold_expires_at',op.stock_hold_expires_at,'upload_grace_expires_at',op.upload_grace_expires_at,
      'fulfillment_method',o.fulfillment_method,'fulfillment_status',o.pickup_status,
      'tracking_number',o.tracking_number,'shipping_carrier',o.shipping_carrier,
      'shipped_at',o.shipped_at,'picked_up_at',o.picked_up_at,
      'pickup_name',o.pickup_point_snapshot->>'name',
      'pickup_starts_at',o.pickup_point_snapshot->>'starts_at','pickup_ends_at',o.pickup_point_snapshot->>'ends_at',
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'id',i.id,'name',coalesce(i.product_name_snapshot,p.name),'sku',i.sku_snapshot,
        'quantity',i.quantity,'price_per_unit',i.price_per_unit,'currency',i.currency,'line_type',i.line_type
      ) order by i.id) from public.order_items i left join public.products p on p.id=i.product_id
        where i.order_id=o.id),'[]'::jsonb)) into store_id,result
    from public.orders o
    left join public.events e on e.id=o.event_id
    left join public.online_campaigns c on c.id=o.campaign_id
    join public.artists a on a.id=coalesce(c.artist_id,e.artist_id)
    left join public.order_payments op on op.order_id=o.id
    where o.id=p_target and (p_store_id is null or a.id=p_store_id);
  end if;
  if result is null then return null; end if;
  insert into private.admin_support_access(actor_id,action,store_id,order_id,reason)
    values(auth.uid(),p_action,store_id,case when p_action='order' then p_target end,reason);
  return result;
end $$;

create function public.admin_support(
  p_action text, p_query text default null, p_target uuid default null,
  p_reason text default null, p_store_id uuid default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.admin_support(p_action,p_query,p_target,p_reason,p_store_id);
$$;
revoke all on function private.admin_support(text,text,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.admin_support(text,text,uuid,text,uuid) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.admin_support(text,text,uuid,text,uuid) to authenticated;
grant execute on function public.admin_support(text,text,uuid,text,uuid) to authenticated;
