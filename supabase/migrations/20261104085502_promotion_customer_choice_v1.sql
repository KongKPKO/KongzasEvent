begin;

create function private.resolve_v1_gift_choices(p_promotion uuid, p_earned integer, p_quota integer, p_options jsonb, p_choices jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare available integer; partial boolean; choice jsonb; ids jsonb; lines jsonb; pending jsonb;
begin
 select least(p_earned, p_quota, coalesce(sum(case when (value->>'is_unlimited')::boolean then p_earned else greatest(0,coalesce((value->>'available')::integer,0)) end),0))::integer
 into available from jsonb_array_elements(p_options);
 partial := available < p_earned;
 pending := jsonb_build_object('resolved',false,'exhausted',available=0,'lines','[]'::jsonb,'options',p_options,'available_quantity',available,'partial',partial);
 if available=0 then return pending; end if;
 select value into choice from jsonb_array_elements(coalesce(p_choices,'[]'::jsonb)) where value->>'promotion_id'=p_promotion::text and nullif(value->>'tier_id','') is null limit 1;
 if partial and (choice->>'accepted_quantity' is distinct from available::text or choice->>'accepted_earned_quantity' is distinct from p_earned::text) then return pending; end if;
 ids:=coalesce(choice->'product_ids','[]'::jsonb);
 if jsonb_typeof(ids)<>'array' or jsonb_array_length(ids)<>available then return pending; end if;
 if exists(select 1 from (select product_id,count(*) quantity from jsonb_array_elements_text(ids) selected(product_id) group by product_id) selected
   where not exists(select 1 from jsonb_array_elements(p_options) option(value) where option.value->>'product_id'=selected.product_id
     and (coalesce((option.value->>'is_unlimited')::boolean,false) or (option.value->>'available')::integer>=selected.quantity))) then return pending; end if;
 select jsonb_agg(option.value||jsonb_build_object('quantity',selected.quantity,'promotion_id',p_promotion,'tier_id',null,'earned_quantity',p_earned,'accepted_quantity',available,'partial',partial) order by selected.product_id)
 into lines from (select product_id,count(*)::integer quantity from jsonb_array_elements_text(ids) selected(product_id) group by product_id) selected
 join lateral (select value from jsonb_array_elements(p_options) where value->>'product_id'=selected.product_id limit 1) option on true;
 return pending||jsonb_build_object('resolved',true,'lines',lines);
end $$;
revoke all on function private.resolve_v1_gift_choices(uuid,integer,integer,jsonb,jsonb) from public,anon,authenticated;

-- Extend the existing version-one config without changing old fixed-gift offers.
do $patch$
declare definition text; updated text; marker text;
begin
 definition:=pg_get_functiondef('private.validate_promotion_v1(jsonb,uuid,jsonb)'::regprocedure);
 marker:=$old$   for a in select * from jsonb_array_elements(coalesce(p_assignments,'[]')) loop$old$;
 if position(marker in definition)=0 then raise exception 'choice_validation_patch_missing'; end if;
 updated:=replace(definition,marker,$new$   if g->>'selection_mode'='customer_choice' then
     if jsonb_typeof(g->'product_ids') is distinct from 'array' or jsonb_array_length(g->'product_ids') not between 2 and 100
       or (select count(*)<>count(distinct value) from jsonb_array_elements_text(g->'product_ids'))
       or not (g->'product_ids' ? (g->>'product_id')) then raise exception 'promotion_reward_product_invalid'; end if;
     for r in select value from jsonb_array_elements(g->'product_ids') loop
       if not exists(select 1 from public.products where id=(r#>>'{}')::uuid and artist_id=p_artist and deleted_at is null and status='enable') then raise exception 'promotion_reward_product_invalid'; end if;
       for a in select * from jsonb_array_elements(coalesce(p_assignments,'[]')) loop
         if a->>'event_id' is not null and not exists(select 1 from public.event_products where event_id=(a->>'event_id')::uuid and product_id=(r#>>'{}')::uuid and is_enabled) then raise exception 'promotion_reward_not_in_channel'; end if;
         if a->>'campaign_id' is not null and not exists(select 1 from public.online_campaign_products where campaign_id=(a->>'campaign_id')::uuid and product_id=(r#>>'{}')::uuid and is_enabled) then raise exception 'promotion_reward_not_in_channel'; end if;
       end loop;
     end loop;
   elsif g->>'selection_mode' is not null and g->>'selection_mode'<>'fixed' then raise exception 'promotion_reward_product_invalid'; end if;
   for a in select * from jsonb_array_elements(coalesce(p_assignments,'[]')) loop$new$);
 execute updated;

 definition:=pg_get_functiondef('private.save_promotion_definition_base(jsonb)'::regprocedure);
 marker:=$old$    insert into public.promotion_reward_products(promotion_id,product_id) values(v_id,(p_definition#>>'{v1_config,gift,product_id}')::uuid);$old$;
 if position(marker in definition)=0 then raise exception 'choice_save_patch_missing'; end if;
 updated:=replace(definition,marker,$new$    insert into public.promotion_reward_products(promotion_id,product_id)
    select v_id,value::uuid from jsonb_array_elements_text(case when p_definition#>>'{v1_config,gift,selection_mode}'='customer_choice' then p_definition#>'{v1_config,gift,product_ids}' else jsonb_build_array(p_definition#>>'{v1_config,gift,product_id}') end);$new$);
 execute updated;

 definition:=pg_get_functiondef('private.calculate_sale_promotions_v1(uuid,text,uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
 marker:=$old$        select jsonb_build_object('product_id',p.id,'name',p.name,'sku',p.sku,$old$;
 if position(marker in definition)=0 then raise exception 'choice_quote_start_missing'; end if;
 updated:=replace(definition,marker,$new$        if v_gift->>'selection_mode'='customer_choice' then
          select coalesce(sum(quantity),0)::integer into v_committed from private.promotion_gift_commitments c
          where c.promotion_id=(v_candidate->>'id')::uuid and (c.redeemed or (c.order_id is distinct from nullif(current_setting('nireq.production_quote_order',true),'')::uuid and private.promotion_hold_active(c.order_id)));
          v_quota:=case when v_gift->>'limit' is null then v_earned when p_draft is not null then greatest(0,(v_gift->>'limit')::integer) else greatest(0,(v_gift->>'limit')::integer-v_committed) end;
          select coalesce(jsonb_agg(jsonb_build_object('product_id',p.id,'name',p.name,'sku',p.sku,
            'available',case when p_draft is not null then null else private.promotion_gift_capacity(p.id,v_cart||v_reward_lines,p_event_id,p_event_phase,p_campaign_id) end,
            'is_unlimited',case when p_draft is not null then true else private.promotion_gift_capacity(p.id,v_cart||v_reward_lines,p_event_id,p_event_phase,p_campaign_id) is null end) order by opt.ord),'[]'::jsonb)
          into v_options from jsonb_array_elements_text(v_gift->'product_ids') with ordinality opt(id,ord)
          join public.products p on p.id=opt.id::uuid and p.deleted_at is null and p.status='enable'
          where (p_event_id is not null and exists(select 1 from public.event_products ep where ep.event_id=p_event_id and ep.product_id=p.id and ep.is_enabled))
             or (p_campaign_id is not null and exists(select 1 from public.online_campaign_products cp where cp.campaign_id=p_campaign_id and cp.product_id=p.id and cp.is_enabled));
          v_resolution:=private.resolve_v1_gift_choices((v_candidate->>'id')::uuid,v_earned,v_quota,v_options,p_reward_choices);
          if not (v_resolution->>'resolved')::boolean then
            v_required_choices:=v_required_choices||jsonb_build_array(jsonb_build_object('kind','reward','promotion_id',v_candidate->>'id','earned_quantity',v_earned,'exhausted',(v_resolution->>'exhausted')::boolean,'options',v_resolution->'options','available_quantity',v_resolution->'available_quantity','partial',v_resolution->'partial'));
          else
            -- Distinct rewards may share bundle components, so check the combined selection.
            v_tier_rewards:=v_reward_lines;
            v_granted:=1;
            for v_item in select value from jsonb_array_elements(v_resolution->'lines') loop
              v_available:=case when p_draft is not null then null else private.promotion_gift_capacity((v_item->>'product_id')::uuid,v_cart||v_tier_rewards,p_event_id,p_event_phase,p_campaign_id) end;
              if v_available is not null and v_available<(v_item->>'quantity')::integer then v_granted:=0; exit; end if;
              v_tier_rewards:=v_tier_rewards||jsonb_build_array(v_item);
            end loop;
            if v_granted=0 then
              v_required_choices:=v_required_choices||jsonb_build_array(jsonb_build_object('kind','reward','promotion_id',v_candidate->>'id','earned_quantity',v_earned,'exhausted',false,'options',v_resolution->'options','available_quantity',v_resolution->'available_quantity','partial',v_resolution->'partial','shared_stock_conflict',true));
              v_diagnostics:=v_diagnostics||jsonb_build_array(jsonb_build_object('promotion_id',v_candidate->>'id','code','gift_stock_insufficient','earned_quantity',v_earned));
            else
              select coalesce(jsonb_agg(x||jsonb_build_object('assignment_id',v_candidate->>'assignment_id')),'[]'::jsonb) into v_options from jsonb_array_elements(v_resolution->'lines') x;
              v_candidate:=jsonb_set(v_candidate,'{rewards}',v_options);
              v_reward_lines:=v_reward_lines||v_options;
            end if;
          end if;
        else
        select jsonb_build_object('product_id',p.id,'name',p.name,'sku',p.sku,$new$);
 marker:=$old$      else
        v_diagnostics:=v_diagnostics||jsonb_build_array(jsonb_build_object('promotion_id',v_candidate->>'id','code','applied','earned_quantity',0));$old$;
 if position(marker in updated)=0 then raise exception 'choice_quote_end_missing'; end if;
 updated:=replace(updated,marker,$new$        end if;
      else
        v_diagnostics:=v_diagnostics||jsonb_build_array(jsonb_build_object('promotion_id',v_candidate->>'id','code','applied','earned_quantity',0));$new$);
 execute updated;
end $patch$;
commit;
