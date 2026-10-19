-- Activity rights are order-level snapshots, never inventory or customer records.
create or replace function private.validate_promotion_v1(p_config jsonb,p_artist uuid,p_assignments jsonb default '[]') returns void
language plpgsql security definer set search_path='' as $$
declare c jsonb:=p_config->'condition'; d jsonb:=nullif(p_config->'discount','null'); g jsonb:=nullif(p_config->'gift','null'); activity jsonb:=nullif(p_config->'activity','null'); r jsonb; a jsonb; n numeric;
begin
 if p_config is null or p_config->>'version' is distinct from '1' or coalesce(c->>'kind','') not in ('quantity','spend','product','recipe') then raise exception 'promotion_condition_invalid'; end if;
 if c->>'kind'='quantity' then
   n:=(c->>'quantity')::numeric;
   if n is null or n<=0 or n<>trunc(n) or n>1000000 then raise exception 'promotion_quantity_invalid'; end if;
 elsif c->>'kind'='spend' then
   n:=(c->>'amount')::numeric;
   if n is null or n<=0 or n>1000000000 or n<>round(n,2) then raise exception 'promotion_amount_invalid'; end if;
 else
   if jsonb_typeof(c->'items') is distinct from 'array' or jsonb_array_length(c->'items') not between 1 and 100
     or (c->>'kind'='product' and jsonb_array_length(c->'items')<>1) then raise exception 'promotion_recipe_invalid'; end if;
   if (select count(*)<>count(distinct x->>'product_id') from jsonb_array_elements(c->'items') x) then raise exception 'promotion_duplicate_product'; end if;
   for r in select * from jsonb_array_elements(c->'items') loop
     n:=(r->>'quantity')::numeric;
     if n is null or n<=0 or n<>trunc(n) or n>1000000 then raise exception 'promotion_quantity_invalid'; end if;
     if not exists(select 1 from public.products where id=(r->>'product_id')::uuid and artist_id=p_artist and deleted_at is null and status='enable') then raise exception 'promotion_product_invalid'; end if;
   end loop;
 end if;
 if d is null and g is null and activity is null then raise exception 'promotion_reward_required'; end if;
 if activity is not null then
   if c->>'kind' is distinct from 'spend' or jsonb_typeof(activity) is distinct from 'object'
     or jsonb_typeof(activity->'name') is distinct from 'string'
     or length(btrim(activity->>'name')) not between 1 and 120
     or jsonb_typeof(activity->'instructions') is distinct from 'string'
     or length(activity->>'instructions')>1000 then raise exception 'promotion_activity_invalid'; end if;
   n:=(activity->>'quantity')::numeric;
   if n is null or n<=0 or n<>trunc(n) or n>1000000 then raise exception 'promotion_quantity_invalid'; end if;
 end if;
 if d is not null then
   n:=(d->>'value')::numeric;
   if coalesce(d->>'kind','') not in ('fixed','percentage') or n is null or n<=0 or n<>round(n,2) or n>1000000000 or (d->>'kind'='percentage' and n>100) then raise exception 'promotion_discount_invalid'; end if;
 end if;
 if g is not null then
   n:=(g->>'quantity')::numeric;
   if n is null or n<=0 or n<>trunc(n) or n>1000000 then raise exception 'promotion_quantity_invalid'; end if;
   if g->>'limit' is not null then
     n:=(g->>'limit')::numeric;
     if n<0 or n<>trunc(n) or n>1000000000 then raise exception 'promotion_gift_limit_invalid'; end if;
   end if;
   if not exists(select 1 from public.products where id=(g->>'product_id')::uuid and artist_id=p_artist and deleted_at is null and status='enable') then raise exception 'promotion_reward_product_invalid'; end if;
   for a in select * from jsonb_array_elements(coalesce(p_assignments,'[]')) loop
     if a->>'event_id' is not null and not exists(select 1 from public.event_products where event_id=(a->>'event_id')::uuid and product_id=(g->>'product_id')::uuid and is_enabled) then raise exception 'promotion_reward_not_in_channel'; end if;
     if a->>'campaign_id' is not null and not exists(select 1 from public.online_campaign_products where campaign_id=(a->>'campaign_id')::uuid and product_id=(g->>'product_id')::uuid and is_enabled) then raise exception 'promotion_reward_not_in_channel'; end if;
   end loop;
 end if;
end $$;
revoke all on function private.validate_promotion_v1(jsonb,uuid,jsonb) from public,anon,authenticated;


create function private.promotion_activity_reward(p_rule jsonb,p_cart jsonb,p_discount numeric) returns jsonb
language plpgsql stable set search_path='' as $$
declare activity jsonb:=nullif(p_rule#>'{v1_config,activity}','null'); amount numeric; quantity numeric;
begin
 if activity is null then return null; end if;
 -- Use the same qualifying net-spend base as V1, after all selected discounts.
 select greatest(0,coalesce(sum((x->>'quantity')::integer*(x->>'price')::numeric),0)-p_discount)
 into amount from jsonb_array_elements(p_cart) x
 where coalesce(p_rule->'eligible_product_ids','[]'::jsonb) ? (x->>'product_id');
 quantity:=floor(amount/(p_rule#>>'{v1_config,condition,amount}')::numeric)*(activity->>'quantity')::numeric;
 if quantity<=0 then return null; end if;
 if quantity>2147483647 then raise exception 'promotion_activity_quantity_invalid'; end if;
 return jsonb_build_object('name',btrim(activity->>'name'),'instructions',activity->>'instructions','quantity',quantity::integer);
end $$;
revoke all on function private.promotion_activity_reward(jsonb,jsonb,numeric) from public,anon,authenticated;

-- Preserve the existing quote implementation and its permissions. Abort on drift.
do $patch$
declare definition text; old text; replacement text;
begin
 definition:=pg_get_functiondef('private.calculate_sale_promotions_v1(uuid,text,uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
 old:='if v_discount=0 and jsonb_array_length(v_candidate->''rewards'')=0 then continue; end if;';
 replacement:='if v_discount=0 and jsonb_array_length(v_candidate->''rewards'')=0 and nullif(v_candidate#>''{v1_config,activity}'',''null'') is null then continue; end if;';
 if position(old in definition)=0 then raise exception 'activity_quote_patch_missing_retention'; end if;
 definition:=replace(definition,old,replacement);
 old:=$old$  select coalesce(jsonb_agg(jsonb_build_object(
    'id', selected_item.value ->> 'id',$old$;
 replacement:=$new$  -- Rights use the final merchandise net and do not consume any stock or gift quota.
  select coalesce(jsonb_agg(item),'[]') into v_selected from (
    select candidate || jsonb_build_object('activity_reward',private.promotion_activity_reward(candidate,v_cart,v_discount_total)) item
    from jsonb_array_elements(v_selected) candidate
  ) rewards where nullif(item->'activity_reward','null') is not null
    or (item->>'discount_amount')::numeric>0 or jsonb_array_length(item->'rewards')>0;

  select coalesce(jsonb_agg(jsonb_build_object(
    'activity_reward', selected_item.value -> 'activity_reward',
    'id', selected_item.value ->> 'id',$new$;
 if position(old in definition)=0 then raise exception 'activity_quote_patch_missing_snapshot'; end if;
 definition:=replace(definition,old,replacement);
 execute definition;
end $patch$;

-- Merchant order surfaces need the same immutable snapshot as customer receipts.
do $patch$
declare definition text; old text;
begin
 definition:=pg_get_functiondef('public.get_online_campaign_workspace(uuid)'::regprocedure);
 old:=$old$'discount_total', o.discount_total,$old$;
 if position(old in definition)=0 then raise exception 'activity_workspace_patch_missing'; end if;
 execute replace(definition,old,old||E'\n        ''pricing_breakdown'', o.pricing_breakdown,');

 definition:=pg_get_functiondef('public.list_preorder_payment_review(uuid,text)'::regprocedure);
 old:='items jsonb)';
 if position(old in definition)=0 then raise exception 'activity_review_return_patch_missing'; end if;
 definition:=replace(definition,old,'items jsonb, pricing_breakdown jsonb)');
 old:=$old$), '[]'::jsonb)
  from public.orders o$old$;
 if position(old in definition)=0 then raise exception 'activity_review_query_patch_missing'; end if;
 definition:=replace(definition,old,$new$), '[]'::jsonb), o.pricing_breakdown
  from public.orders o$new$);
 -- PostgreSQL requires recreating a table-return function when adding an output.
 drop function public.list_preorder_payment_review(uuid,text);
 execute definition;
end $patch$;
revoke all on function public.list_preorder_payment_review(uuid,text) from public,anon;
grant execute on function public.list_preorder_payment_review(uuid,text) to authenticated,service_role;
