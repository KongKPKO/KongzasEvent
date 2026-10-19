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
   if jsonb_typeof(c->'items') is distinct from 'array' or jsonb_array_length(c->'items') not between 1 and 100 then raise exception 'promotion_recipe_invalid'; end if;
   if (select count(*)<>count(distinct x->>'product_id') from jsonb_array_elements(c->'items') x) then raise exception 'promotion_duplicate_product'; end if;
   for r in select * from jsonb_array_elements(c->'items') loop
     n:=(r->>'quantity')::numeric;
     if n is null or n<=0 or n<>trunc(n) or n>1000000 then raise exception 'promotion_quantity_invalid'; end if;
     if not exists(select 1 from public.products where id=(r->>'product_id')::uuid and artist_id=p_artist and deleted_at is null and status='enable') then raise exception 'promotion_product_invalid'; end if;
   end loop;
 end if;
 if d is null and g is null and activity is null then raise exception 'promotion_reward_required'; end if;
 if activity is not null then
   if jsonb_typeof(activity) is distinct from 'object'
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


create or replace function private.promotion_activity_reward(p_rule jsonb,p_cart jsonb,p_discount numeric) returns jsonb
language plpgsql stable set search_path='' as $$
declare activity jsonb:=nullif(p_rule#>'{v1_config,activity}','null'); amount numeric; quantity numeric;
begin
 if activity is null then return null; end if;
 -- Use the same qualifying net-spend base as V1, after all selected discounts.
 select greatest(0,coalesce(sum((x->>'quantity')::integer*(x->>'price')::numeric),0)-p_discount)
 into amount from jsonb_array_elements(p_cart) x
 where coalesce(p_rule->'eligible_product_ids','[]'::jsonb) ? (x->>'product_id');
 if p_rule#>>'{v1_config,condition,kind}'='spend' then
   quantity:=floor(amount/(p_rule#>>'{v1_config,condition,amount}')::numeric)*(activity->>'quantity')::numeric;
 else
   quantity:=coalesce((p_rule->>'bundle_count')::numeric,0)*(activity->>'quantity')::numeric;
 end if;
 if quantity<=0 then return null; end if;
 if quantity>2147483647 then raise exception 'promotion_activity_quantity_invalid'; end if;
 return jsonb_build_object('name',btrim(activity->>'name'),'instructions',activity->>'instructions','quantity',quantity::integer);
end $$;
revoke all on function private.promotion_activity_reward(jsonb,jsonb,numeric) from public,anon,authenticated;


create or replace function private.promotion_v1_candidate(p_rule jsonb,p_cart jsonb,p_previous_discount numeric) returns jsonb
language plpgsql stable set search_path='' as $$
declare c jsonb:=p_rule#>'{v1_config,condition}'; d jsonb:=nullif(p_rule#>'{v1_config,discount}','null'); eligible jsonb; ids jsonb;
 qty integer; amount numeric; groups integer:=0; matched numeric:=0; discount numeric:=0; r jsonb; have integer; count_required integer; remaining integer;
begin
 select coalesce(jsonb_agg(x),'[]'),coalesce(sum((x->>'quantity')::integer),0),coalesce(sum((x->>'quantity')::integer*(x->>'price')::numeric),0)
 into eligible,qty,amount from jsonb_array_elements(p_cart) x where private.promotion_matches_product(p_rule->>'target_type',p_rule->>'match_category',p_rule->>'match_tag',
 null,array(select jsonb_array_elements_text(coalesce(nullif(p_rule->'match_product_ids','null'),'[]')))::uuid[],(x->>'product_id')::uuid,x->>'category',array(select jsonb_array_elements_text(x->'tags')));
 if c->>'kind'='quantity' then
   groups:=floor(qty/(c->>'quantity')::numeric); remaining:=groups*(c->>'quantity')::integer;
   -- Complete groups consume the highest-priced qualifying units first.
   for r in select * from jsonb_array_elements(eligible) x order by (x->>'price')::numeric desc,x->>'product_id' loop
     count_required:=least(remaining,(r->>'quantity')::integer); matched:=matched+count_required*(r->>'price')::numeric; remaining:=remaining-count_required;
   end loop;
 elsif c->>'kind'='spend' then
   matched:=greatest(0,amount-p_previous_discount);
   groups:=case when matched>=(c->>'amount')::numeric then 1 else 0 end;
 elsif c->>'kind'='product' then
   -- Each selected product qualifies independently; this is not an AND recipe.
   groups:=0;
   for r in select * from jsonb_array_elements(c->'items') loop
     select coalesce(sum((x->>'quantity')::integer),0) into have from jsonb_array_elements(eligible) x where x->>'product_id'=r->>'product_id';
     count_required:=floor(have/(r->>'quantity')::numeric)::integer;
     groups:=groups+count_required;
     select matched+coalesce(sum(count_required*(r->>'quantity')::integer*(x->>'price')::numeric),0) into matched from jsonb_array_elements(eligible) x where x->>'product_id'=r->>'product_id';
   end loop;
   select coalesce(jsonb_agg(x),'[]') into eligible from jsonb_array_elements(eligible) x where exists(select 1 from jsonb_array_elements(c->'items') req where req->>'product_id'=x->>'product_id');
 else
   groups:=2147483647;
   for r in select * from jsonb_array_elements(c->'items') loop
     select coalesce(sum((x->>'quantity')::integer),0) into have from jsonb_array_elements(eligible) x where x->>'product_id'=r->>'product_id';
     groups:=least(groups,floor(have/(r->>'quantity')::numeric)::integer);
     select matched+coalesce(sum((r->>'quantity')::integer*(x->>'price')::numeric),0) into matched from jsonb_array_elements(eligible) x where x->>'product_id'=r->>'product_id';
   end loop;
   matched:=matched*groups;
   select coalesce(jsonb_agg(x),'[]') into eligible from jsonb_array_elements(eligible) x where exists(select 1 from jsonb_array_elements(c->'items') req where req->>'product_id'=x->>'product_id');
 end if;
 if groups=0 then
   return jsonb_build_object('promotion_id',p_rule->>'id','code','condition_not_met','earned_quantity',0,'bundle_count',0,
     'missing_quantity',case when c->>'kind'='quantity' then greatest(0,(c->>'quantity')::integer-qty) else null end,
     'missing_amount',case when c->>'kind'='spend' then greatest(0,(c->>'amount')::numeric-matched) else null end,
     'missing_items',case when c->>'kind' in ('product','recipe') then (select coalesce(jsonb_agg(jsonb_build_object('product_id',req->>'product_id','quantity',greatest(0,(req->>'quantity')::integer-coalesce((select (x->>'quantity')::integer from jsonb_array_elements(eligible) x where x->>'product_id'=req->>'product_id'),0)))),'[]') from jsonb_array_elements(c->'items') req) else '[]'::jsonb end);
 end if;
 if d is not null then
   discount:=case when d->>'kind'='percentage' then round(matched*(d->>'value')::numeric/100,2) else groups*(d->>'value')::numeric end;
   discount:=least(matched,discount);
 end if;
 select coalesce(jsonb_agg(x->>'product_id'),'[]') into ids from jsonb_array_elements(eligible) x;
 return jsonb_build_object('id',p_rule->>'id','assignment_id',p_rule->>'assignment_id','revision',p_rule->'revision','name',coalesce(nullif(p_rule->>'name',''),'Promotion'),
 'rule_text',case c->>'kind' when 'quantity' then format('Every %s qualifying items',c->>'quantity') when 'spend' then format('Spend %s after discounts',c->>'amount') when 'product' then 'Buy any of the specified products' else 'Buy all specified products' end,
 'promotion_type','condition_reward','combination_policy',p_rule->>'combination_policy','eligible_product_ids',ids,'bundle_count',groups,'discount_amount',discount,
 'reached_tier_ids','[]'::jsonb,'rewards','[]'::jsonb,'v1_config',p_rule->'v1_config');
end $$;

-- A private preview-only normalizer retains membership, identity, supply and bundle
-- rules while allowing hypothetical quantities. Real checkout keeps the original.
do $patch$
declare definition text; old text;
begin
 definition:=pg_get_functiondef('private.normalize_sale_bundle_items(uuid,text,uuid,jsonb)'::regprocedure);
 definition:=replace(definition,'FUNCTION private.normalize_sale_bundle_items(', 'FUNCTION private.normalize_sale_bundle_items_preview(');
 old:='if v_available is not null and v_quantity>v_available then raise exception ''sale_product_unavailable''; end if;';
 if position(old in definition)=0 then raise exception 'preview_normalizer_stock_guard_missing'; end if;
 definition:=replace(definition,old,'-- Hypothetical quantities do not require a physical allocation.');
 execute definition;
end $patch$;
revoke all on function private.normalize_sale_bundle_items_preview(uuid,text,uuid,jsonb) from public,anon,authenticated;

do $patch$
declare definition text; old text; replacement text;
begin
 definition:=pg_get_functiondef('private.calculate_sale_promotions_v1(uuid,text,uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
 old:='  v_normalized := private.normalize_sale_bundle_items(p_event_id,p_event_phase,p_campaign_id,p_items);';
 replacement:='  if p_draft is not null then
    v_normalized := private.normalize_sale_bundle_items_preview(p_event_id,p_event_phase,p_campaign_id,p_items);
  else
    v_normalized := private.normalize_sale_bundle_items(p_event_id,p_event_phase,p_campaign_id,p_items);
  end if;';
 if position(old in definition)=0 then raise exception 'preview_calculator_normalizer_missing'; end if;
 definition:=replace(definition,old,replacement);
 old:='if not v_is_unlimited and v_quantity > v_available then';
 if position(old in definition)=0 then raise exception 'preview_calculator_stock_guard_missing'; end if;
 definition:=replace(definition,old,'if p_draft is null and not v_is_unlimited and v_quantity > v_available then');
 old:='        v_granted:=least(v_earned,v_quota,v_available);';
 replacement:='        if p_draft is not null and v_gift_option is not null then
          v_quota:=case when v_gift->>''limit'' is null then v_earned else greatest(0,(v_gift->>''limit'')::integer) end;
          v_available:=v_earned;
          v_gift_option:=jsonb_set(v_gift_option,''{available}'',''null''::jsonb);
        end if;
        v_granted:=least(v_earned,v_quota,v_available);';
 if position(old in definition)=0 then raise exception 'preview_gift_stock_guard_missing'; end if;
 definition:=replace(definition,old,replacement);
 execute definition;
end $patch$;
notify pgrst,'reload schema';
