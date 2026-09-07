-- Each option only needs one unit; the resolver checks the combined entitlement.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('private.promotion_reward_options(uuid,uuid,uuid,uuid,integer)'::regprocedure);
  if strpos(definition, '>= p_needed') = 0 then raise exception 'Unexpected reward option definition'; end if;
  execute replace(definition, '>= p_needed', '>= 1');
end $$;

create or replace function private.resolve_promotion_rewards(
  p_promotion_id uuid, p_tier_id uuid, p_selection_mode text,
  p_earned_quantity integer, p_options jsonb, p_reward_choices jsonb
)
returns jsonb language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_options jsonb := coalesce(p_options, '[]'::jsonb);
  v_available integer;
  v_partial boolean;
  v_choice jsonb;
  v_ids jsonb;
  v_lines jsonb;
  v_pending jsonb;
begin
  if p_selection_mode = 'fixed' and jsonb_array_length(v_options) > 0 then
    v_options := jsonb_build_array(v_options -> 0);
  end if;
  select least(p_earned_quantity, coalesce(sum(case
    when (value ->> 'is_unlimited')::boolean then p_earned_quantity
    else greatest(0, coalesce((value ->> 'available')::integer, 0)) end), 0))::integer
  into v_available from jsonb_array_elements(v_options);
  v_partial := v_available < p_earned_quantity;
  v_pending := jsonb_build_object('resolved',false,'exhausted',v_available=0,
    'lines','[]'::jsonb,'options',v_options,'available_quantity',v_available,'partial',v_partial);
  if v_available = 0 then return v_pending; end if;

  select value into v_choice from jsonb_array_elements(coalesce(p_reward_choices,'[]'::jsonb))
  where value ->> 'promotion_id' = p_promotion_id::text
    and nullif(value ->> 'tier_id','') is not distinct from p_tier_id::text
  limit 1;
  if v_partial and (
    v_choice ->> 'accepted_quantity' is distinct from v_available::text
    or v_choice ->> 'accepted_earned_quantity' is distinct from p_earned_quantity::text
  ) then return v_pending; end if;

  if p_selection_mode = 'fixed' then
    select jsonb_agg(v_options -> 0 ->> 'product_id') into v_ids
    from generate_series(1,v_available);
  else
    v_ids := coalesce(v_choice -> 'product_ids','[]'::jsonb);
  end if;
  if jsonb_typeof(v_ids) <> 'array' then return v_pending; end if;
  if jsonb_array_length(v_ids) <> v_available or exists (
    select 1 from (select product_id,count(*) quantity
      from jsonb_array_elements_text(v_ids) selected(product_id) group by product_id) selected
    where not exists (
      select 1 from jsonb_array_elements(v_options) option(value)
      where option.value ->> 'product_id' = selected.product_id
        and (coalesce((option.value ->> 'is_unlimited')::boolean,false)
          or (option.value ->> 'available')::integer >= selected.quantity)
    )
  ) then return v_pending; end if;

  select jsonb_agg(option.value || jsonb_build_object(
    'quantity',selected.quantity,'promotion_id',p_promotion_id,'tier_id',p_tier_id,
    'earned_quantity',p_earned_quantity,'accepted_quantity',v_available,'partial',v_partial
  ) order by selected.product_id)
  into v_lines
  from (select product_id,count(*)::integer quantity
    from jsonb_array_elements_text(v_ids) selected(product_id) group by product_id) selected
  join lateral (select value from jsonb_array_elements(v_options)
    where value ->> 'product_id'=selected.product_id limit 1) option on true;
  return v_pending || jsonb_build_object('resolved',true,'lines',v_lines);
end;
$$;

do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.calculate_sale_promotions(uuid,text,uuid,jsonb,jsonb,jsonb)'::regprocedure);
  if strpos(definition, $old$'options', v_resolution -> 'options'$old$) = 0 then
    raise exception 'Unexpected required reward choices definition';
  end if;
  execute replace(definition, $old$'options', v_resolution -> 'options'$old$,
    $new$'options', v_resolution -> 'options',
            'available_quantity', v_resolution -> 'available_quantity',
            'partial', v_resolution -> 'partial'$new$);
end $$;
