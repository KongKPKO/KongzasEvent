begin;
create or replace function public.list_preorder_production_summary_scoped(p_event_id uuid, p_order_type text)
returns table (
  product_id uuid,
  product_name text,
  category text,
  image_url text,
  submitted_quantity bigint,
  confirmed_quantity bigint,
  rejected_quantity bigint,
  total_to_prepare bigint,
  expected_amount numeric,
  confirmed_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
begin
  if p_order_type is null or p_order_type not in ('preorder', 'post_event') then raise exception 'invalid_order_type'; end if;
  select e.* into v_event from public.events e where e.id = p_event_id;
  if v_event.id is null then
    raise exception 'event_not_found';
  end if;
  if not public.has_event_role(p_event_id, array['owner', 'manager', 'seller']) then
    raise exception 'forbidden';
  end if;

  return query
  select
    p.id,
    p.name,
    p.category,
    p.image_url,
    coalesce(sum(oi.quantity) filter (where op.payment_status = 'payment_submitted'), 0)::bigint,
    coalesce(sum(oi.quantity) filter (where op.payment_status = 'payment_confirmed'), 0)::bigint,
    coalesce(sum(oi.quantity) filter (where op.payment_status in ('payment_rejected', 'payment_expired')), 0)::bigint,
    coalesce(sum(oi.quantity) filter (where op.payment_status in ('payment_submitted', 'payment_confirmed')), 0)::bigint,
    coalesce(sum(oi.quantity * oi.price_per_unit) filter (where op.payment_status in ('payment_submitted', 'payment_confirmed')), 0),
    coalesce(sum(oi.quantity * oi.price_per_unit) filter (where op.payment_status = 'payment_confirmed'), 0)
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  join public.order_payments op on op.order_id = o.id
  join public.products p on p.id = oi.product_id
  where o.event_id = p_event_id
    and o.order_type = p_order_type
  group by p.id, p.name, p.category, p.image_url
  order by p.name;
end;
$$;

revoke all on function public.list_preorder_production_summary_scoped(uuid,text) from public, anon;
grant execute on function public.list_preorder_production_summary_scoped(uuid,text) to authenticated;
do $patch$
declare definition text; marker text;
begin
 definition := pg_get_functiondef('private.validate_promotion_v1(jsonb,uuid,jsonb)'::regprocedure);
 marker := $old$   n:=(g->>'quantity')::numeric;$old$;
 if position(marker in definition)=0 then raise exception 'gift_limit_validation_patch_missing'; end if;
 definition := replace(definition,marker,$new$   if g->>'max_quantity_per_order' is not null then
     n:=(g->>'max_quantity_per_order')::numeric;
     if n<=0 or n<>trunc(n) or n>1000000 then raise exception 'promotion_gift_limit_invalid'; end if;
   end if;
   n:=(g->>'quantity')::numeric;$new$);
 execute definition;
 definition := pg_get_functiondef('private.calculate_sale_promotions_v1(uuid,text,uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
 marker := $old$        v_earned:=least(2147483647,(v_candidate->>'bundle_count')::numeric*(v_gift->>'quantity')::numeric)::integer;$old$;
 if position(marker in definition)=0 then raise exception 'gift_limit_calculation_patch_missing'; end if;
 definition := replace(definition,marker,marker || $new$
        if v_gift->>'max_quantity_per_order' is not null then
          v_earned:=least(v_earned,(v_gift->>'max_quantity_per_order')::integer);
        end if;$new$);
 execute definition;
end $patch$;
commit;
