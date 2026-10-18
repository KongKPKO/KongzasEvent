-- Condition/reward V1 coexists with legacy mixed-choice and spend-tier offers.
alter table public.artist_promotions add column v1_config jsonb;
alter table public.artist_promotions drop constraint artist_promotions_promotion_type_check;
alter table public.artist_promotions add constraint artist_promotions_promotion_type_check check
 (promotion_type in ('quantity_discount','quantity_gift','spend_tier_gift','legacy_free_eligible_items','condition_reward'));

create function private.validate_promotion_v1(p_config jsonb,p_artist uuid,p_assignments jsonb default '[]') returns void
language plpgsql security definer set search_path='' as $$
declare c jsonb:=p_config->'condition'; d jsonb:=nullif(p_config->'discount','null'); g jsonb:=nullif(p_config->'gift','null'); r jsonb; a jsonb; n numeric;
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
 if d is null and g is null then raise exception 'promotion_reward_required'; end if;
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

-- Direct table writes receive the same validation as the editor RPC.
create function private.guard_promotion_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.promotion_type='condition_reward' then
   if tg_op='UPDATE' and new.v1_config is not distinct from old.v1_config and new.artist_id=old.artist_id and new.promotion_type=old.promotion_type then return new; end if;
   perform private.validate_promotion_v1(new.v1_config,new.artist_id);
   if new.v1_config#>>'{gift,limit}' is not null and (new.v1_config#>>'{gift,limit}')::integer <
     coalesce((select sum(c.quantity) from private.promotion_gift_commitments c where c.promotion_id=new.id and (c.redeemed or private.promotion_hold_active(c.order_id))),0) then
     raise exception 'promotion_gift_limit_below_committed';
   end if;
 elsif new.v1_config is not null then raise exception 'promotion_config_type_invalid'; end if;
 return new;
end $$;
create trigger guard_promotion_v1 before insert or update on public.artist_promotions for each row execute function private.guard_promotion_v1();

-- Preserve all legacy checks; V1 has a validated config and no legacy reward fields.

alter table public.artist_promotions drop constraint artist_promotions_reward_fields_check;
alter table public.artist_promotions add constraint artist_promotions_reward_fields_check check (
    (promotion_type='condition_reward' and v1_config is not null and buy_quantity is null and reward_value is null and reward_quantity is null and tier_grant_mode is null and reward_selection_mode is null) or
    (
      promotion_type = 'quantity_discount'
      and buy_quantity > 0
      and reward_value > 0
      and reward_quantity is null
      and tier_grant_mode is null
      and reward_selection_mode is null
    )
    or (
      promotion_type in ('quantity_gift', 'legacy_free_eligible_items')
      and buy_quantity > 0
      and reward_value is null
      and reward_quantity > 0
      and tier_grant_mode is null
      and (
        promotion_type = 'legacy_free_eligible_items'
        or reward_selection_mode in ('fixed', 'customer_choice')
      )
    )
    or (
      promotion_type = 'spend_tier_gift'
      and buy_quantity is null
      and reward_value is null
      and reward_quantity is null
      and tier_grant_mode in ('highest_only', 'cumulative')
      and reward_selection_mode is null
    )
  );

create or replace function private.save_promotion_definition_base(p_definition jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_id uuid := nullif(p_definition ->> 'id', '')::uuid;
  v_artist_id uuid := nullif(p_definition ->> 'artist_id', '')::uuid;
  v_type text := p_definition ->> 'promotion_type';
  v_assignment jsonb;
  v_existing_assignment_id uuid;
  v_tier jsonb;
  v_tier_id uuid;
  v_product_id text;
begin
  if v_artist_id is null
    or not public.has_artist_role(v_artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;

  if v_type not in ('quantity_discount', 'quantity_gift', 'spend_tier_gift','condition_reward') then
    raise exception 'promotion_type_invalid';
  end if;

  if v_type='condition_reward' then
    perform private.validate_promotion_v1(p_definition->'v1_config',v_artist_id,p_definition->'assignments');
  end if;

  if v_id is not null and not exists (
    select 1 from public.artist_promotions
    where id = v_id and artist_id = v_artist_id
  ) then
    raise exception 'promotion_not_found';
  end if;

  if v_id is null then
    insert into public.artist_promotions (
      artist_id, name, target_type, rule_type, promotion_type, v1_config,
      match_category, match_tag, match_product_id, match_product_ids,
      buy_quantity, reward_value, reward_quantity, reward_selection_mode,
      tier_grant_mode, priority, status, lifecycle_status, event_scope,
      event_ids, starts_at, ends_at, updated_by
    ) values (
      v_artist_id,
      nullif(trim(p_definition ->> 'name'), ''),
      p_definition ->> 'target_type',
      case when v_type = 'quantity_discount' then 'discount' else 'free_items' end,
      v_type,
      case when v_type='condition_reward' then p_definition->'v1_config' else null end,
      nullif(trim(p_definition ->> 'match_category'), ''),
      nullif(trim(p_definition ->> 'match_tag'), ''),
      null,
      case when p_definition ->> 'target_type' = 'product'
        then array(select jsonb_array_elements_text(coalesce(p_definition -> 'match_product_ids', '[]'::jsonb)))::uuid[]
        else null end,
      nullif(p_definition ->> 'buy_quantity', '')::integer,
      nullif(p_definition ->> 'reward_value', '')::numeric,
      nullif(p_definition ->> 'reward_quantity', '')::integer,
      nullif(p_definition ->> 'reward_selection_mode', ''),
      nullif(p_definition ->> 'tier_grant_mode', ''),
      10, 'inactive', 'ready', 'all', null, null, null, auth.uid()
    ) returning id into v_id;
  else
    update public.artist_promotions set
      name = nullif(trim(p_definition ->> 'name'), ''),
      target_type = p_definition ->> 'target_type',
      rule_type = case when v_type = 'quantity_discount' then 'discount' else 'free_items' end,
      promotion_type = v_type,
      v1_config = case when v_type='condition_reward' then p_definition->'v1_config' else null end,
      match_category = nullif(trim(p_definition ->> 'match_category'), ''),
      match_tag = nullif(trim(p_definition ->> 'match_tag'), ''),
      match_product_id = null,
      match_product_ids = case when p_definition ->> 'target_type' = 'product'
        then array(select jsonb_array_elements_text(coalesce(p_definition -> 'match_product_ids', '[]'::jsonb)))::uuid[]
        else null end,
      buy_quantity = nullif(p_definition ->> 'buy_quantity', '')::integer,
      reward_value = nullif(p_definition ->> 'reward_value', '')::numeric,
      reward_quantity = nullif(p_definition ->> 'reward_quantity', '')::integer,
      reward_selection_mode = nullif(p_definition ->> 'reward_selection_mode', ''),
      tier_grant_mode = nullif(p_definition ->> 'tier_grant_mode', ''),
      lifecycle_status = 'ready',
      status = 'inactive',
      event_scope = 'all', event_ids = null, starts_at = null, ends_at = null,
      updated_by = auth.uid()
    where id = v_id;
  end if;

  update public.promotion_assignments
  set is_paused = true
  where promotion_id = v_id;

  for v_assignment in
    select value from jsonb_array_elements(coalesce(p_definition -> 'assignments', '[]'::jsonb))
  loop
    select id into v_existing_assignment_id
    from public.promotion_assignments
    where promotion_id = v_id
      and (
        (nullif(v_assignment ->> 'campaign_id', '') is not null
          and campaign_id = (v_assignment ->> 'campaign_id')::uuid)
        or
        (nullif(v_assignment ->> 'event_id', '') is not null
          and event_id = (v_assignment ->> 'event_id')::uuid
          and event_phase = v_assignment ->> 'event_phase')
      )
    limit 1;

    if v_existing_assignment_id is null then
      insert into public.promotion_assignments (
        promotion_id, artist_id, event_id, event_phase, campaign_id,
        starts_at, ends_at, is_paused, combination_policy
      ) values (
        v_id, v_artist_id,
        nullif(v_assignment ->> 'event_id', '')::uuid,
        nullif(v_assignment ->> 'event_phase', ''),
        nullif(v_assignment ->> 'campaign_id', '')::uuid,
        nullif(v_assignment ->> 'starts_at', '')::timestamptz,
        nullif(v_assignment ->> 'ends_at', '')::timestamptz,
        coalesce((v_assignment ->> 'is_paused')::boolean, false),
        coalesce(nullif(v_assignment ->> 'combination_policy', ''), 'exclusive')
      );
    else
      update public.promotion_assignments set
        starts_at = nullif(v_assignment ->> 'starts_at', '')::timestamptz,
        ends_at = nullif(v_assignment ->> 'ends_at', '')::timestamptz,
        is_paused = coalesce((v_assignment ->> 'is_paused')::boolean, false),
        combination_policy = coalesce(nullif(v_assignment ->> 'combination_policy', ''), 'exclusive')
      where id = v_existing_assignment_id;
    end if;
    v_existing_assignment_id := null;
  end loop;

  delete from public.promotion_reward_products where promotion_id = v_id;
  delete from public.promotion_tiers where promotion_id = v_id;

  if v_type='condition_reward' and p_definition#>>'{v1_config,gift,product_id}' is not null then
    insert into public.promotion_reward_products(promotion_id,product_id) values(v_id,(p_definition#>>'{v1_config,gift,product_id}')::uuid);
  elsif v_type = 'quantity_gift' then
    for v_product_id in
      select jsonb_array_elements_text(coalesce(p_definition -> 'reward_product_ids', '[]'::jsonb))
    loop
      insert into public.promotion_reward_products (promotion_id, product_id)
      values (v_id, v_product_id::uuid);
    end loop;
  elsif v_type = 'spend_tier_gift' then
    for v_tier in
      select value from jsonb_array_elements(coalesce(p_definition -> 'tiers', '[]'::jsonb))
    loop
      insert into public.promotion_tiers (
        promotion_id, threshold_amount, reward_quantity, reward_selection_mode, sort_order
      ) values (
        v_id,
        (v_tier ->> 'threshold_amount')::numeric,
        (v_tier ->> 'reward_quantity')::integer,
        v_tier ->> 'reward_selection_mode',
        coalesce((v_tier ->> 'sort_order')::integer, 0)
      ) returning id into v_tier_id;

      for v_product_id in
        select jsonb_array_elements_text(coalesce(v_tier -> 'reward_product_ids', '[]'::jsonb))
      loop
        insert into public.promotion_reward_products (promotion_id, promotion_tier_id, product_id)
        values (v_id, v_tier_id, v_product_id::uuid);
      end loop;
    end loop;
  end if;

  return v_id;
end;
$$;


-- A paid redemption survives refund/deletion of its order. Unpaid commitments
-- follow the existing payment hold, evidence grace and cancellation states.
create table private.promotion_gift_commitments (
 id uuid primary key default gen_random_uuid(),
 promotion_id uuid not null references public.artist_promotions(id) on delete cascade,
 order_id uuid references public.orders(id) on delete set null,
 quantity integer not null check(quantity>0),
 redeemed boolean not null default false,
 unique(order_id,promotion_id)
);
alter table private.promotion_gift_commitments enable row level security;
revoke all on private.promotion_gift_commitments from public,anon,authenticated;
create index promotion_gift_commitments_promotion_idx on private.promotion_gift_commitments(promotion_id);

create function private.promotion_hold_active(p_order uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.orders o left join public.order_payments p on p.order_id=o.id
 where o.id=p_order and o.status<>'cancelled'
 and coalesce(p.payment_status,'') not in ('payment_expired','payment_cancelled','payment_rejected','refund_pending','refunded','payment_submitted_late')
 and (p.payment_status is distinct from 'awaiting_payment' or p.stock_hold_expires_at is null
 or p.stock_hold_expires_at>now() or p.upload_grace_expires_at>now()))
$$;
create function private.promotion_gift_remaining(p_promotion uuid,p_own_order uuid default null) returns integer
language sql stable security definer set search_path='' as $$
 select case when a.v1_config#>>'{gift,limit}' is null then null else
 greatest(0,(a.v1_config#>>'{gift,limit}')::integer-coalesce((select sum(c.quantity) from private.promotion_gift_commitments c
 where c.promotion_id=a.id and (c.redeemed or (c.order_id is distinct from p_own_order and private.promotion_hold_active(c.order_id)))),0))::integer end
 from public.artist_promotions a where a.id=p_promotion
$$;
create function private.sync_promotion_gift_commitments(p_order uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r record; current_quantity integer; existing_quantity integer; was_redeemed boolean; paid boolean; active boolean; remaining integer;
begin
 select (o.status='completed' or o.pickup_status in ('picked_up','shipped') or o.picked_up_at is not null or o.shipped_at is not null or p.payment_status='payment_confirmed')
 into paid from public.orders o left join public.order_payments p on p.order_id=o.id where o.id=p_order;
 active:=private.promotion_hold_active(p_order);
 for r in select a.id from public.artist_promotions a where a.promotion_type='condition_reward' and a.id in
 (select promotion_id from public.order_items where order_id=p_order and line_type='promotion_reward'
 union select promotion_id from private.promotion_gift_commitments where order_id=p_order) order by a.id for update of a loop
   select coalesce(sum(quantity),0)::integer into current_quantity from public.order_items where order_id=p_order and promotion_id=r.id and line_type='promotion_reward';
   select quantity,redeemed into existing_quantity,was_redeemed from private.promotion_gift_commitments where order_id=p_order and promotion_id=r.id;
   if coalesce(was_redeemed,false) then
     -- Reducing/refunding a paid order never creates new promotional rights.
     if current_quantity>existing_quantity then raise exception 'promotion_changed'; end if;
   elsif current_quantity=0 then
     delete from private.promotion_gift_commitments where order_id=p_order and promotion_id=r.id;
   else
     remaining:=private.promotion_gift_remaining(r.id,p_order);
     if (active or coalesce(paid,false)) and remaining is not null and current_quantity>remaining then raise exception 'promotion_changed'; end if;
     insert into private.promotion_gift_commitments(promotion_id,order_id,quantity,redeemed)
     values(r.id,p_order,current_quantity,coalesce(paid,false))
     on conflict(order_id,promotion_id) do update set quantity=excluded.quantity,redeemed=excluded.redeemed;
   end if;
 end loop;
end $$;
create function private.refresh_promotion_gift_commitments() returns trigger
language plpgsql security definer set search_path='' as $$
declare row_data jsonb;
begin
 if tg_op='DELETE' then row_data:=to_jsonb(old); else row_data:=to_jsonb(new); end if;
 perform private.sync_promotion_gift_commitments((row_data->>case when tg_table_name='orders' then 'id' else 'order_id' end)::uuid);
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger zzz_promotion_gift_item after insert or update or delete on public.order_items for each row execute function private.refresh_promotion_gift_commitments();
create trigger zzz_promotion_gift_order after update of status,pickup_status on public.orders for each row execute function private.refresh_promotion_gift_commitments();
create trigger zzz_promotion_gift_payment after insert or update of payment_status,stock_hold_expires_at,upload_grace_expires_at on public.order_payments for each row execute function private.refresh_promotion_gift_commitments();

create function public.promotion_gift_usage(p_artist_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.has_artist_role(p_artist_id,array['owner','manager']) then raise exception 'forbidden'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('promotion_id',a.id,
 'redeemed_quantity',coalesce((select sum(quantity) from private.promotion_gift_commitments c where c.promotion_id=a.id and c.redeemed),0),
 'held_quantity',coalesce((select sum(quantity) from private.promotion_gift_commitments c where c.promotion_id=a.id and not c.redeemed and private.promotion_hold_active(c.order_id)),0),
 'remaining_quantity',private.promotion_gift_remaining(a.id))),'[]') into result
 from public.artist_promotions a where a.artist_id=p_artist_id and a.promotion_type='condition_reward' and a.v1_config->>'gift' is not null;
 return result;
end $$;
revoke all on function private.promotion_hold_active(uuid),private.promotion_gift_remaining(uuid,uuid),private.sync_promotion_gift_commitments(uuid),private.refresh_promotion_gift_commitments() from public,anon,authenticated;
revoke all on function public.promotion_gift_usage(uuid) from public,anon;
grant execute on function public.promotion_gift_usage(uuid) to authenticated;

create function private.promotion_quote_rules(p_event uuid,p_phase text,p_campaign uuid,p_draft jsonb default null) returns setof jsonb
language plpgsql stable security definer set search_path='' as $$
declare a jsonb; draft_id uuid:=coalesce(nullif(p_draft->>'id','')::uuid,'00000000-0000-4000-8000-000000000001'::uuid);
begin
 return query select to_jsonb(ap)||jsonb_build_object('assignment_id',pa.id,'combination_policy',pa.combination_policy,
 'quote_active',ap.lifecycle_status='ready' and not pa.is_paused and (pa.starts_at is null or pa.starts_at<=now()) and (pa.ends_at is null or pa.ends_at>now()))
 from public.promotion_assignments pa join public.artist_promotions ap on ap.id=pa.promotion_id
 where ap.lifecycle_status<>'archived' and ((p_event is not null and pa.event_id=p_event and pa.event_phase=p_phase) or (p_campaign is not null and pa.campaign_id=p_campaign))
 and (p_draft is null or ap.id<>draft_id) order by ap.priority,ap.created_at,pa.id;
 if p_draft is not null then
   select x into a from jsonb_array_elements(coalesce(p_draft->'assignments','[]')) x
   where (p_event is not null and x->>'event_id'=p_event::text and x->>'event_phase'=p_phase) or (p_campaign is not null and x->>'campaign_id'=p_campaign::text) limit 1;
   return next p_draft||jsonb_build_object('id',draft_id,'assignment_id',coalesce(a->>'id','00000000-0000-4000-8000-000000000002'),
     'priority',10,'revision',0,'created_at',now(),'lifecycle_status','ready','combination_policy',coalesce(a->>'combination_policy','exclusive'),
     'quote_active',a is not null and not coalesce((a->>'is_paused')::boolean,false) and (a->>'starts_at' is null or (a->>'starts_at')::timestamptz<=now()) and (a->>'ends_at' is null or (a->>'ends_at')::timestamptz>now()));
 end if;
end $$;

create function private.promotion_v1_candidate(p_rule jsonb,p_cart jsonb,p_previous_discount numeric) returns jsonb
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
 'rule_text',case c->>'kind' when 'quantity' then format('Every %s qualifying items',c->>'quantity') when 'spend' then format('Spend %s after discounts',c->>'amount') when 'product' then 'Buy the specified product' else 'Buy all specified products' end,
 'promotion_type','condition_reward','combination_policy',p_rule->>'combination_policy','eligible_product_ids',ids,'bundle_count',groups,'discount_amount',discount,
 'reached_tier_ids','[]'::jsonb,'rewards','[]'::jsonb,'v1_config',p_rule->'v1_config');
end $$;
revoke all on function private.promotion_quote_rules(uuid,text,uuid,jsonb),private.promotion_v1_candidate(jsonb,jsonb,numeric) from public,anon,authenticated;

-- Subtract the cart's physical component demand, not just matching gift lines.
-- Otherwise a bundle purchase could promise its last component again as a gift.
create function private.promotion_gift_capacity(p_product uuid,p_cart jsonb,p_event uuid,p_phase text,p_campaign uuid) returns integer
language plpgsql stable security definer set search_path='' as $$
declare available integer; used integer; r record; result integer; owned uuid:=nullif(current_setting('nireq.production_quote_order',true),'')::uuid;
 production boolean:=case when p_event is not null then private.event_production(p_event,p_product,p_phase) else private.campaign_production(p_campaign,p_product) end;
begin
 if private.is_component_bundle(p_product) and not production then
   for r in select product_id,quantity from private.bundle_components where bundle_id=p_product loop
     if p_campaign is not null then
       select case when is_unlimited then null else greatest(0,stock_total-stock_reserved-stock_sold) end into available from public.online_campaign_products where campaign_id=p_campaign and product_id=r.product_id and is_enabled;
     else
       select case when is_unlimited then null else greatest(0,stock_total-stock_reserved-stock_sold) end into available from public.event_products where event_id=p_event and product_id=r.product_id and is_enabled;
     end if;
     if not found then return 0; end if;
     if available is not null then
       available:=available+coalesce((select sum(b.held)::integer from private.bundle_order_components b join public.order_items oi on oi.id=b.order_item_id where oi.order_id=owned and b.product_id=r.product_id and b.source='stock'),0)
       +case when coalesce(current_setting('nireq.pos_reprice_released',true),'')<>'true' then coalesce((select sum(oi.quantity)::integer from public.order_items oi where oi.order_id=owned and oi.product_id=r.product_id and oi.inventory_source='stock' and not private.is_component_bundle(oi.product_id)),0) else 0 end;
       select coalesce(sum((x->>'quantity')::integer*case when x->>'product_id'=r.product_id::text then 1 else coalesce(b.quantity,0) end),0)::integer into used
       from jsonb_array_elements(p_cart) x left join private.bundle_components b on b.bundle_id=(x->>'product_id')::uuid and b.product_id=r.product_id
       where not case when p_event is not null then private.event_production(p_event,(x->>'product_id')::uuid,p_phase) else private.campaign_production(p_campaign,(x->>'product_id')::uuid) end;
       result:=least(result,greatest(0,available-used)/r.quantity);
     end if;
   end loop;
   return result;
 end if;
 available:=case when p_event is not null then private.event_supply_available(p_event,p_product,p_phase) else private.campaign_supply_available(p_campaign,p_product) end;
 if available is null then return null; end if;
 select coalesce(sum((x->>'quantity')::integer*case when x->>'product_id'=p_product::text then 1 when production then 0 else coalesce(b.quantity,0) end),0)::integer into used
 from jsonb_array_elements(p_cart) x left join private.bundle_components b on b.bundle_id=(x->>'product_id')::uuid and b.product_id=p_product
 where x->>'product_id'=p_product::text or not case when p_event is not null then private.event_production(p_event,(x->>'product_id')::uuid,p_phase) else private.campaign_production(p_campaign,(x->>'product_id')::uuid) end;
 return greatest(0,available-used);
end $$;
revoke all on function private.promotion_gift_capacity(uuid,jsonb,uuid,text,uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.calculate_sale_promotions_v1(p_event_id uuid, p_event_phase text, p_campaign_id uuid, p_items jsonb, p_reward_choices jsonb, p_promotion_choices jsonb, p_draft jsonb default null)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $function$
declare
  v_artist_id uuid;
  v_can_manage boolean := false;
  v_cart jsonb := '[]'::jsonb;
  v_seen_product_ids uuid[] := '{}'::uuid[];
  v_item jsonb;
  v_product_id uuid;
  v_product_name text;
  v_product_sku text;
  v_product_category text;
  v_product_tags text[];
  v_quantity integer;
  v_price numeric;
  v_available integer;
  v_channel_product_id uuid;
  v_is_unlimited boolean;
  v_subtotal numeric := 0;
  v_candidates jsonb := '[]'::jsonb;
  v_selected jsonb := '[]'::jsonb;
  v_required_choices jsonb := '[]'::jsonb;
  v_reward_lines jsonb := '[]'::jsonb;
  v_applied jsonb := '[]'::jsonb;
  v_rule record;
  v_candidate jsonb;
  v_eligible_qty integer;
  v_eligible_amount numeric;
  v_eligible_ids jsonb;
  v_bundle_count integer;
  v_discount numeric;
  v_earned integer;
  v_options jsonb;
  v_resolution jsonb;
  v_conflict_ids text[];
  v_selected_choice text;
  v_discount_total numeric := 0;
  v_tier record;
  v_tier_ids jsonb;
  v_tier_rewards jsonb;
  v_net_eligible numeric;
  v_result jsonb;
  v_hash text;
  v_diagnostics jsonb := '[]';
  v_normalized jsonb;
  v_rule_json jsonb;
  v_gift jsonb;
  v_gift_option jsonb;
  v_granted integer;
  v_quota integer;
  v_committed integer;
  v_remaining_budget numeric;
  v_final_selected jsonb := '[]';
begin
  if (p_event_id is null) = (p_campaign_id is null) then
    raise exception 'promotion_context_required';
  end if;

  if p_event_id is not null then
    if p_event_phase not in ('preorder', 'live', 'postorder') then
      raise exception 'promotion_event_phase_invalid';
    end if;

    select e.artist_id
    into v_artist_id
    from public.events e
    where e.id = p_event_id;
  else
    if p_event_phase is not null then
      raise exception 'promotion_event_phase_invalid';
    end if;

    select c.artist_id
    into v_artist_id
    from public.online_campaigns c
    where c.id = p_campaign_id;
  end if;

  if v_artist_id is null then
    raise exception 'promotion_context_not_found';
  end if;

  v_can_manage := public.has_artist_role(v_artist_id, array['owner', 'manager', 'seller']);

  if not v_can_manage then
    if p_campaign_id is not null and not exists (
      select 1
      from public.online_campaigns c
      join public.artists a on a.id = c.artist_id
      where c.id = p_campaign_id
        and c.publication_status = 'published'
        and c.opens_at <= now()
        and c.closes_at > now()
        and a.is_public and a.is_verified and a.published_at is not null
    ) then
      raise exception 'promotion_context_closed';
    end if;

    if p_event_id is not null and not exists (
      select 1
      from public.events e
      join public.artists a on a.id = e.artist_id
      where e.id = p_event_id
        and e.status = 'Confirmed'
        and a.is_public and a.is_verified and a.published_at is not null
        and (
          (p_event_phase = 'live' and e.is_booth_open and e.start_date <= now() and e.end_date > now())
          or (p_event_phase = 'preorder' and e.preorder_enabled
            and coalesce(e.preorder_opens_at, '-infinity'::timestamptz) <= now()
            and coalesce(e.preorder_closes_at, e.start_date) > now())
          or (p_event_phase = 'postorder' and e.postorder_enabled
            and coalesce(e.postorder_opens_at, e.end_date) <= now()
            and coalesce(e.postorder_closes_at, 'infinity'::timestamptz) > now())
        )
    ) then
      raise exception 'promotion_context_closed';
    end if;
  end if;

  v_normalized := private.normalize_sale_bundle_items(p_event_id,p_event_phase,p_campaign_id,p_items);
  p_items := v_normalized->'items';

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'promotion_items_invalid';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item(value)
  loop
    begin
      v_quantity := (v_item ->> 'quantity')::integer;
    exception when others then
      raise exception 'promotion_quantity_invalid';
    end;

    if v_quantity <= 0 then
      raise exception 'promotion_quantity_invalid';
    end if;

    if (v_item ->> 'product_id')::uuid = any(v_seen_product_ids) then
      raise exception 'promotion_duplicate_product';
    end if;
    v_seen_product_ids := array_append(v_seen_product_ids, (v_item ->> 'product_id')::uuid);

    if p_event_id is not null then
      select
        p.id,
        p.name,
        p.sku,
        p.category,
        p.tags,
        coalesce(ep.price_override, p.price),
        ep.id,
        (private.event_supply_available(p_event_id,p.id,p_event_phase) is null),
        private.event_supply_available(p_event_id,p.id,p_event_phase)
      into
        v_product_id,
        v_product_name,
        v_product_sku,
        v_product_category,
        v_product_tags,
        v_price,
        v_channel_product_id,
        v_is_unlimited,
        v_available
      from public.event_products ep
      join public.products p on p.id = ep.product_id
      where ep.event_id = p_event_id
        and ep.product_id = (v_item ->> 'product_id')::uuid
        and ep.is_enabled
        and ep.is_sellable
        and p.deleted_at is null;
    else
      select
        p.id,
        p.name,
        p.sku,
        p.category,
        p.tags,
        coalesce(cp.price_override, p.price),
        cp.id,
        (private.campaign_supply_available(p_campaign_id,p.id) is null),
        private.campaign_supply_available(p_campaign_id,p.id)
      into
        v_product_id,
        v_product_name,
        v_product_sku,
        v_product_category,
        v_product_tags,
        v_price,
        v_channel_product_id,
        v_is_unlimited,
        v_available
      from public.online_campaign_products cp
      join public.products p on p.id = cp.product_id
      where cp.campaign_id = p_campaign_id
        and cp.product_id = (v_item ->> 'product_id')::uuid
        and cp.is_enabled
        and cp.is_sellable
        and p.deleted_at is null;
    end if;

    if v_product_id is null then
      raise exception 'sale_product_unavailable';
    end if;

    if not v_is_unlimited and v_quantity > v_available then
      raise exception 'sale_product_unavailable';
    end if;

    v_subtotal := v_subtotal + v_price * v_quantity;
    v_cart := v_cart || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'name', v_product_name,
      'sku', v_product_sku,
      'category', v_product_category,
      'tags', to_jsonb(coalesce(v_product_tags, '{}'::text[])),
      'price', v_price,
      'quantity', v_quantity,
      'channel_product_id', v_channel_product_id,
      'is_unlimited', v_is_unlimited,
      'available', v_available
    ));

    v_product_id := null;
  end loop;

  for v_rule in
    select (jsonb_populate_record(null::public.artist_promotions,r)).*, (r->>'assignment_id')::uuid assignment_id, r->>'combination_policy' combination_policy,
      coalesce((r->>'quote_active')::boolean,false) quote_active
    from private.promotion_quote_rules(p_event_id,p_event_phase,p_campaign_id,p_draft) r
    where r->>'promotion_type'<>'spend_tier_gift' and not (r->>'promotion_type'='condition_reward' and r#>>'{v1_config,condition,kind}'='spend')
    order by (r->>'priority')::integer,(r->>'created_at')::timestamptz,r->>'assignment_id'
  loop
    if not v_rule.quote_active then
      if v_rule.promotion_type='condition_reward' then v_diagnostics:=v_diagnostics||jsonb_build_array(jsonb_build_object('promotion_id',v_rule.id,'code','inactive','earned_quantity',0)); end if;
      continue;
    end if;
    if v_rule.promotion_type='condition_reward' then
      v_candidate:=private.promotion_v1_candidate(to_jsonb(v_rule),v_cart,0);
      if (v_candidate->>'bundle_count')::integer>0 then v_candidates:=v_candidates||jsonb_build_array(v_candidate);
      else v_diagnostics:=v_diagnostics||jsonb_build_array(v_candidate-'bundle_count'); end if;
      continue;
    end if;
    select
      coalesce(sum((cart_item.value ->> 'quantity')::integer), 0)::integer,
      coalesce(sum((cart_item.value ->> 'quantity')::integer * (cart_item.value ->> 'price')::numeric), 0),
      coalesce(jsonb_agg(cart_item.value ->> 'product_id'), '[]'::jsonb)
    into v_eligible_qty, v_eligible_amount, v_eligible_ids
    from jsonb_array_elements(v_cart) cart_item(value)
    where private.promotion_matches_product(
      v_rule.target_type,
      v_rule.match_category,
      v_rule.match_tag,
      v_rule.match_product_id,
      v_rule.match_product_ids,
      (cart_item.value ->> 'product_id')::uuid,
      cart_item.value ->> 'category',
      array(select jsonb_array_elements_text(cart_item.value -> 'tags'))
    );

    if v_rule.promotion_type = 'quantity_discount' then
      v_bundle_count := floor(v_eligible_qty / v_rule.buy_quantity);
      v_discount := least(v_eligible_amount, v_bundle_count * v_rule.reward_value);
      if v_bundle_count > 0 and v_discount > 0 then
        v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
          'id', v_rule.id,
          'assignment_id', v_rule.assignment_id,
          'revision', v_rule.revision,
          'name', coalesce(nullif(trim(v_rule.name), ''), 'Promotion'),
          'rule_text', format('Every %s qualifying items, save %s', v_rule.buy_quantity, v_rule.reward_value),
          'promotion_type', v_rule.promotion_type,
          'combination_policy', v_rule.combination_policy,
          'eligible_product_ids', v_eligible_ids,
          'bundle_count', v_bundle_count,
          'discount_amount', v_discount,
          'reached_tier_ids', '[]'::jsonb,
          'rewards', '[]'::jsonb
        ));
      end if;
    elsif v_rule.promotion_type = 'legacy_free_eligible_items' then
      v_bundle_count := floor(v_eligible_qty / (v_rule.buy_quantity + v_rule.reward_quantity));
      v_earned := v_bundle_count * v_rule.reward_quantity;
      if v_earned > 0 then
        select coalesce(sum(unit_price), 0)
        into v_discount
        from (
          select (cart_item.value ->> 'price')::numeric as unit_price
          from jsonb_array_elements(v_cart) cart_item(value)
          cross join lateral generate_series(1, (cart_item.value ->> 'quantity')::integer)
          where (cart_item.value ->> 'product_id')::uuid in (
            select value::uuid from jsonb_array_elements_text(v_eligible_ids)
          )
          order by unit_price
          limit v_earned
        ) cheapest;

        v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
          'id', v_rule.id,
          'assignment_id', v_rule.assignment_id,
          'revision', v_rule.revision,
          'name', coalesce(nullif(trim(v_rule.name), ''), 'Promotion'),
          'rule_text', format('Buy %s qualifying items, get %s eligible item free', v_rule.buy_quantity, v_rule.reward_quantity),
          'promotion_type', v_rule.promotion_type,
          'combination_policy', v_rule.combination_policy,
          'eligible_product_ids', v_eligible_ids,
          'bundle_count', v_bundle_count,
          'discount_amount', least(v_eligible_amount, v_discount),
          'reached_tier_ids', '[]'::jsonb,
          'rewards', '[]'::jsonb
        ));
      end if;
    elsif v_rule.promotion_type = 'quantity_gift' then
      v_bundle_count := floor(v_eligible_qty / v_rule.buy_quantity);
      v_earned := v_bundle_count * v_rule.reward_quantity;
      if v_earned > 0 then
        v_options := private.production_reward_options(
          v_rule.id, null, p_event_id, p_campaign_id, v_earned, p_event_phase
        );
        v_resolution := private.resolve_promotion_rewards(
          v_rule.id,
          null,
          v_rule.reward_selection_mode,
          v_earned,
          v_options,
          p_reward_choices
        );

        if not (v_resolution ->> 'resolved')::boolean then
          v_required_choices := v_required_choices || jsonb_build_array(jsonb_build_object(
            'kind', 'reward',
            'promotion_id', v_rule.id,
            'earned_quantity', v_earned,
            'exhausted', (v_resolution ->> 'exhausted')::boolean,
            'options', v_resolution -> 'options',
            'available_quantity', v_resolution -> 'available_quantity',
            'partial', v_resolution -> 'partial'
          ));
        else
          v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
            'id', v_rule.id,
            'assignment_id', v_rule.assignment_id,
            'revision', v_rule.revision,
            'name', coalesce(nullif(trim(v_rule.name), ''), 'Promotion'),
            'rule_text', format('Every %s qualifying items, receive %s gift', v_rule.buy_quantity, v_rule.reward_quantity),
            'promotion_type', v_rule.promotion_type,
            'combination_policy', v_rule.combination_policy,
            'eligible_product_ids', v_eligible_ids,
            'bundle_count', v_bundle_count,
            'discount_amount', 0,
            'reached_tier_ids', '[]'::jsonb,
            'rewards', v_resolution -> 'lines'
          ));
        end if;
      end if;
    end if;
  end loop;

  for v_candidate in
    select candidate.value
    from jsonb_array_elements(v_candidates) candidate(value)
    order by (candidate.value ->> 'discount_amount')::numeric desc,
      candidate.value ->> 'id'
  loop
    select coalesce(array_agg(selected_item.value ->> 'id'), '{}'::text[])
    into v_conflict_ids
    from jsonb_array_elements(v_selected) selected_item(value)
    where private.jsonb_text_arrays_overlap(
      selected_item.value -> 'eligible_product_ids',
      v_candidate -> 'eligible_product_ids'
    )
      and not (
        selected_item.value ->> 'combination_policy' = 'combine'
        and v_candidate ->> 'combination_policy' = 'combine'
      );

    if cardinality(v_conflict_ids) = 0 then
      v_selected := v_selected || jsonb_build_array(v_candidate);
    elsif v_candidate ->> 'promotion_type' in ('quantity_discount', 'legacy_free_eligible_items')
      and not exists (
        select 1
        from jsonb_array_elements(v_selected) selected_item(value)
        where selected_item.value ->> 'id' = any(v_conflict_ids)
          and selected_item.value ->> 'promotion_type' not in ('quantity_discount', 'legacy_free_eligible_items')
      ) then
      -- Candidates are ordered by customer discount, so the already-selected rule wins ties.
      continue;
    else
      select choice.value ->> 'selected_promotion_id'
      into v_selected_choice
      from jsonb_array_elements(coalesce(p_promotion_choices, '[]'::jsonb)) choice(value)
      where choice.value ->> 'selected_promotion_id' = v_candidate ->> 'id'
         or choice.value ->> 'selected_promotion_id' = any(v_conflict_ids)
      limit 1;

      if v_selected_choice = v_candidate ->> 'id' then
        select coalesce(jsonb_agg(selected_item.value), '[]'::jsonb)
        into v_selected
        from jsonb_array_elements(v_selected) selected_item(value)
        where not (selected_item.value ->> 'id' = any(v_conflict_ids));
        v_selected := v_selected || jsonb_build_array(v_candidate);
      elsif v_selected_choice = any(v_conflict_ids) then
        continue;
      else
        select coalesce(jsonb_agg(selected_item.value), '[]'::jsonb)
        into v_selected
        from jsonb_array_elements(v_selected) selected_item(value)
        where not (selected_item.value ->> 'id' = any(v_conflict_ids));

        v_required_choices := v_required_choices || jsonb_build_array(jsonb_build_object(
          'kind', 'exclusive_promotion',
          'promotion_id', v_candidate ->> 'id',
          'options', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'id', option_item.value ->> 'id',
              'name', option_item.value ->> 'name',
              'benefit_text', option_item.value ->> 'rule_text'
            )), '[]'::jsonb)
            from (
              select selected_item.value
              from jsonb_array_elements(v_candidates) selected_item(value)
              where selected_item.value ->> 'id' = any(v_conflict_ids)
                 or selected_item.value ->> 'id' = v_candidate ->> 'id'
            ) option_item
          )
        ));
      end if;
    end if;
  end loop;

  select coalesce(sum((selected_item.value ->> 'discount_amount')::numeric), 0)
  into v_discount_total
  from jsonb_array_elements(v_selected) selected_item(value);
  v_discount_total := least(v_subtotal, v_discount_total);

  v_candidates:='[]';
  for v_rule_json in
    select r from private.promotion_quote_rules(p_event_id,p_event_phase,p_campaign_id,p_draft) r
    where r->>'promotion_type'='condition_reward' and r#>>'{v1_config,condition,kind}'='spend'
    order by (r->>'priority')::integer,(r->>'created_at')::timestamptz,r->>'assignment_id'
  loop
    if not coalesce((v_rule_json->>'quote_active')::boolean,false) then
      v_diagnostics:=v_diagnostics||jsonb_build_array(jsonb_build_object('promotion_id',v_rule_json->>'id','code','inactive','earned_quantity',0));
      continue;
    end if;
    v_candidate:=private.promotion_v1_candidate(v_rule_json,v_cart,v_discount_total);
    if (v_candidate->>'bundle_count')::integer>0 then
      v_candidates:=v_selected||jsonb_build_array(v_candidate);
  for v_candidate in
    select candidate.value
    from jsonb_array_elements(v_candidates) candidate(value)
    where candidate.value->>'id'=v_rule_json->>'id'
    order by (candidate.value ->> 'discount_amount')::numeric desc,
      candidate.value ->> 'id'
  loop
    select coalesce(array_agg(selected_item.value ->> 'id'), '{}'::text[])
    into v_conflict_ids
    from jsonb_array_elements(v_selected) selected_item(value)
    where private.jsonb_text_arrays_overlap(
      selected_item.value -> 'eligible_product_ids',
      v_candidate -> 'eligible_product_ids'
    )
      and not (
        selected_item.value ->> 'combination_policy' = 'combine'
        and v_candidate ->> 'combination_policy' = 'combine'
      );

    if cardinality(v_conflict_ids) = 0 then
      v_selected := v_selected || jsonb_build_array(v_candidate);
    elsif v_candidate ->> 'promotion_type' in ('quantity_discount', 'legacy_free_eligible_items')
      and not exists (
        select 1
        from jsonb_array_elements(v_selected) selected_item(value)
        where selected_item.value ->> 'id' = any(v_conflict_ids)
          and selected_item.value ->> 'promotion_type' not in ('quantity_discount', 'legacy_free_eligible_items')
      ) then
      -- Candidates are ordered by customer discount, so the already-selected rule wins ties.
      continue;
    else
      select choice.value ->> 'selected_promotion_id'
      into v_selected_choice
      from jsonb_array_elements(coalesce(p_promotion_choices, '[]'::jsonb)) choice(value)
      where choice.value ->> 'selected_promotion_id' = v_candidate ->> 'id'
         or choice.value ->> 'selected_promotion_id' = any(v_conflict_ids)
      limit 1;

      if v_selected_choice = v_candidate ->> 'id' then
        select coalesce(jsonb_agg(selected_item.value), '[]'::jsonb)
        into v_selected
        from jsonb_array_elements(v_selected) selected_item(value)
        where not (selected_item.value ->> 'id' = any(v_conflict_ids));
        v_selected := v_selected || jsonb_build_array(v_candidate);
      elsif v_selected_choice = any(v_conflict_ids) then
        continue;
      else
        select coalesce(jsonb_agg(selected_item.value), '[]'::jsonb)
        into v_selected
        from jsonb_array_elements(v_selected) selected_item(value)
        where not (selected_item.value ->> 'id' = any(v_conflict_ids));

        v_required_choices := v_required_choices || jsonb_build_array(jsonb_build_object(
          'kind', 'exclusive_promotion',
          'promotion_id', v_candidate ->> 'id',
          'options', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'id', option_item.value ->> 'id',
              'name', option_item.value ->> 'name',
              'benefit_text', option_item.value ->> 'rule_text'
            )), '[]'::jsonb)
            from (
              select selected_item.value
              from jsonb_array_elements(v_candidates) selected_item(value)
              where selected_item.value ->> 'id' = any(v_conflict_ids)
                 or selected_item.value ->> 'id' = v_candidate ->> 'id'
            ) option_item
          )
        ));
      end if;
    end if;
  end loop;


      select least(v_subtotal,coalesce(sum((x->>'discount_amount')::numeric),0)) into v_discount_total from jsonb_array_elements(v_selected) x;
    else v_diagnostics:=v_diagnostics||jsonb_build_array(v_candidate-'bundle_count');
    end if;
  end loop;

  for v_rule in
    select (jsonb_populate_record(null::public.artist_promotions,r)).*,(r->>'assignment_id')::uuid assignment_id,r->>'combination_policy' combination_policy
    from private.promotion_quote_rules(p_event_id,p_event_phase,p_campaign_id,p_draft) r
    where r->>'promotion_type'='spend_tier_gift' and (r->>'quote_active')::boolean
    order by (r->>'priority')::integer,(r->>'created_at')::timestamptz,r->>'assignment_id'
  loop
    select
      coalesce(sum((cart_item.value ->> 'quantity')::integer * (cart_item.value ->> 'price')::numeric), 0),
      coalesce(jsonb_agg(cart_item.value ->> 'product_id'), '[]'::jsonb)
    into v_eligible_amount, v_eligible_ids
    from jsonb_array_elements(v_cart) cart_item(value)
    where private.promotion_matches_product(
      v_rule.target_type,
      v_rule.match_category,
      v_rule.match_tag,
      v_rule.match_product_id,
      v_rule.match_product_ids,
      (cart_item.value ->> 'product_id')::uuid,
      cart_item.value ->> 'category',
      array(select jsonb_array_elements_text(cart_item.value -> 'tags'))
    );

    v_net_eligible := greatest(0, v_eligible_amount - v_discount_total);
    v_tier_ids := '[]'::jsonb;
    v_tier_rewards := '[]'::jsonb;

    for v_tier in
      select pt.*
      from public.promotion_tiers pt
      where pt.promotion_id = v_rule.id
        and pt.threshold_amount <= v_net_eligible
      order by
        case when v_rule.tier_grant_mode = 'highest_only' then pt.threshold_amount end desc,
        pt.threshold_amount asc
      limit case when v_rule.tier_grant_mode = 'highest_only' then 1 else 2147483647 end
    loop
      v_options := private.production_reward_options(
        v_rule.id, v_tier.id, p_event_id, p_campaign_id, v_tier.reward_quantity, p_event_phase
      );
      v_resolution := private.resolve_promotion_rewards(
        v_rule.id,
        v_tier.id,
        v_tier.reward_selection_mode,
        v_tier.reward_quantity,
        v_options,
        p_reward_choices
      );

      if not (v_resolution ->> 'resolved')::boolean then
        v_required_choices := v_required_choices || jsonb_build_array(jsonb_build_object(
          'kind', 'reward',
          'promotion_id', v_rule.id,
          'tier_id', v_tier.id,
          'earned_quantity', v_tier.reward_quantity,
          'exhausted', (v_resolution ->> 'exhausted')::boolean,
          'options', v_resolution -> 'options',
            'available_quantity', v_resolution -> 'available_quantity',
            'partial', v_resolution -> 'partial'
        ));
      else
        v_tier_ids := v_tier_ids || to_jsonb(v_tier.id::text);
        v_tier_rewards := v_tier_rewards || (v_resolution -> 'lines');
      end if;
    end loop;

    if jsonb_array_length(v_tier_ids) > 0 then
      v_selected := v_selected || jsonb_build_array(jsonb_build_object(
        'id', v_rule.id,
        'assignment_id', v_rule.assignment_id,
        'revision', v_rule.revision,
        'name', coalesce(nullif(trim(v_rule.name), ''), 'Promotion'),
        'rule_text', case v_rule.tier_grant_mode
          when 'cumulative' then 'Receive every reached spend-tier gift'
          else 'Receive the highest reached spend-tier gift'
        end,
        'promotion_type', v_rule.promotion_type,
        'combination_policy', v_rule.combination_policy,
        'eligible_product_ids', v_eligible_ids,
        'bundle_count', 0,
        'discount_amount', 0,
        'reached_tier_ids', v_tier_ids,
        'rewards', v_tier_rewards
      ));
    end if;
  end loop;

  -- Legacy rewards retain their explicit mixed/partial choice behavior. V1 fixed
  -- gifts are best effort, independently of the discount, and share SKU capacity.
  select coalesce(jsonb_agg(r),'[]') into v_reward_lines from jsonb_array_elements(v_selected) s
  cross join lateral jsonb_array_elements(s->'rewards') r;
  select coalesce(sum((x->>'discount_amount')::numeric),0) into v_remaining_budget from jsonb_array_elements(v_selected) x where x->>'promotion_type'<>'condition_reward';
  v_remaining_budget:=greatest(0,v_subtotal-v_remaining_budget);
  for v_candidate in select * from jsonb_array_elements(v_selected) loop
    if v_candidate->>'promotion_type'='condition_reward' then
      v_discount:=least(v_remaining_budget,(v_candidate->>'discount_amount')::numeric);
      v_remaining_budget:=v_remaining_budget-v_discount;
      v_candidate:=jsonb_set(v_candidate,'{discount_amount}',to_jsonb(v_discount));
      v_gift:=nullif(v_candidate#>'{v1_config,gift}','null');
      if v_gift is not null then
        v_earned:=least(2147483647,(v_candidate->>'bundle_count')::numeric*(v_gift->>'quantity')::numeric)::integer;
        select jsonb_build_object('product_id',p.id,'name',p.name,'sku',p.sku,
          'available',private.promotion_gift_capacity(p.id,v_cart||v_reward_lines,p_event_id,p_event_phase,p_campaign_id))
        into v_gift_option from public.products p where p.id=(v_gift->>'product_id')::uuid and p.deleted_at is null and p.status='enable'
        and ((p_event_id is not null and exists(select 1 from public.event_products ep where ep.event_id=p_event_id and ep.product_id=p.id and ep.is_enabled))
          or (p_campaign_id is not null and exists(select 1 from public.online_campaign_products cp where cp.campaign_id=p_campaign_id and cp.product_id=p.id and cp.is_enabled)));
        select coalesce(sum(quantity),0)::integer into v_committed from private.promotion_gift_commitments c
        where c.promotion_id=(v_candidate->>'id')::uuid and (c.redeemed or (c.order_id is distinct from nullif(current_setting('nireq.production_quote_order',true),'')::uuid and private.promotion_hold_active(c.order_id)));
        v_quota:=case when v_gift->>'limit' is null then v_earned else greatest(0,(v_gift->>'limit')::integer-v_committed) end;
        v_available:=case when v_gift_option is null then 0 when v_gift_option->>'available' is null then v_earned else (v_gift_option->>'available')::integer end;
        v_granted:=least(v_earned,v_quota,v_available);
        if v_granted>0 then
          v_item:=v_gift_option||jsonb_build_object('quantity',v_granted,'promotion_id',v_candidate->>'id','assignment_id',v_candidate->>'assignment_id','tier_id',null,'is_unlimited',v_gift_option->>'available' is null);
          v_candidate:=jsonb_set(v_candidate,'{rewards}',jsonb_build_array(v_item));
          v_reward_lines:=v_reward_lines||jsonb_build_array(v_item);
        end if;
        v_diagnostics:=v_diagnostics||jsonb_build_array(jsonb_build_object('promotion_id',v_candidate->>'id',
          'code',case when v_granted=v_earned then 'applied' when v_quota<v_earned and v_quota<=v_available then 'gift_limit_reached' else 'gift_stock_insufficient' end,
          'earned_quantity',v_earned,'available_quantity',v_granted,'remaining_quantity',case when v_gift->>'limit' is null then null else v_quota end));
      else
        v_diagnostics:=v_diagnostics||jsonb_build_array(jsonb_build_object('promotion_id',v_candidate->>'id','code','applied','earned_quantity',0));
      end if;
      if v_discount=0 and jsonb_array_length(v_candidate->'rewards')=0 then continue; end if;
    end if;
    v_final_selected:=v_final_selected||jsonb_build_array(v_candidate);
  end loop;
  v_selected:=v_final_selected;
  select least(v_subtotal,coalesce(sum((x->>'discount_amount')::numeric),0)) into v_discount_total from jsonb_array_elements(v_selected) x;

  select coalesce(jsonb_agg(reward_item.value), '[]'::jsonb)
  into v_reward_lines
  from jsonb_array_elements(v_selected) selected_item(value)
  cross join lateral jsonb_array_elements(coalesce(selected_item.value -> 'rewards', '[]'::jsonb)) reward_item(value);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', selected_item.value ->> 'id',
    'assignment_id', selected_item.value ->> 'assignment_id',
    'revision', (selected_item.value ->> 'revision')::bigint,
    'name', selected_item.value ->> 'name',
    'rule_text', selected_item.value ->> 'rule_text',
    'bundle_count', (selected_item.value ->> 'bundle_count')::integer,
    'discount_amount', (selected_item.value ->> 'discount_amount')::numeric,
    'reached_tier_ids', selected_item.value -> 'reached_tier_ids',
    'rewards', selected_item.value -> 'rewards'
  )), '[]'::jsonb)
  into v_applied
  from jsonb_array_elements(v_selected) selected_item(value);

  v_result := jsonb_build_object(
    'normalized_items', (select coalesce(jsonb_agg(jsonb_build_object('product_id',x->>'product_id','quantity',(x->>'quantity')::integer) order by x->>'product_id'),'[]') from jsonb_array_elements(p_items) x),
    'subtotal', v_subtotal,
    'discount_total', v_discount_total,
    'merchandise_total', greatest(0, v_subtotal - v_discount_total),
    'shipping_fee', 0,
    'total', greatest(0, v_subtotal - v_discount_total),
    'applied_promotions', v_applied,
    'reward_lines', v_reward_lines,
    'supply_policies', (select coalesce(jsonb_agg(jsonb_build_object('product_id',line.product_id,'mode',
      case when p_campaign_id is not null then case when private.campaign_production(p_campaign_id,line.product_id) then 'production' else 'stock' end
      else case when private.event_production(p_event_id,line.product_id,p_event_phase) then 'production' else 'stock' end end) order by line.product_id),'[]'::jsonb)
      from (select distinct (x->>'product_id')::uuid product_id from jsonb_array_elements(v_cart||v_reward_lines) x) line),
    'bundle_components', (select coalesce(jsonb_agg(jsonb_build_object('product_id',p.id,'components',p.bundle_items) order by p.id),'[]'::jsonb) from public.products p where private.is_component_bundle(p.id) and p.id in(select (x->>'product_id')::uuid from jsonb_array_elements(v_cart||v_reward_lines)x)), 'required_choices', v_required_choices
  );

  v_hash := encode(extensions.digest(convert_to(v_result::text, 'UTF8'), 'sha256'), 'hex');
  return v_result || jsonb_build_object('pricing_hash', v_hash,'diagnostics',v_diagnostics,'auto_sets',coalesce(v_normalized->'auto_sets','[]'));
end;
$function$;

revoke all on function private.calculate_sale_promotions_v1(uuid,text,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
create or replace function public.calculate_sale_promotions(p_event_id uuid,p_event_phase text,p_campaign_id uuid,p_items jsonb,p_reward_choices jsonb,p_promotion_choices jsonb) returns jsonb
language sql security definer set search_path='' as $$
 select private.calculate_sale_promotions_v1(p_event_id,p_event_phase,p_campaign_id,p_items,p_reward_choices,p_promotion_choices)
$$;

create function public.preview_promotion_definition(p_definition jsonb,p_event_id uuid,p_event_phase text,p_campaign_id uuid,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare artist uuid; context_artist uuid;
begin
 artist:=nullif(p_definition->>'artist_id','')::uuid;
 if artist is null or not public.has_artist_role(artist,array['owner','manager']) then raise exception 'forbidden'; end if;
 if (p_event_id is null)=(p_campaign_id is null) then raise exception 'promotion_context_required'; end if;
 if p_event_id is not null then select artist_id into context_artist from public.events where id=p_event_id;
 else select artist_id into context_artist from public.online_campaigns where id=p_campaign_id; end if;
 if context_artist is distinct from artist then raise exception 'forbidden'; end if;
 if p_definition->>'promotion_type' is distinct from 'condition_reward' then raise exception 'promotion_type_invalid'; end if;
 if nullif(p_definition->>'id','') is not null and not exists(select 1 from public.artist_promotions where id=(p_definition->>'id')::uuid and artist_id=artist) then raise exception 'promotion_not_found'; end if;
 if coalesce(p_definition->>'target_type','') not in ('all','product','category','tag','category_tag') then raise exception 'promotion_target_invalid'; end if;
 perform private.validate_promotion_v1(p_definition->'v1_config',artist,p_definition->'assignments');
 return private.calculate_sale_promotions_v1(p_event_id,p_event_phase,p_campaign_id,p_items,'[]','[]',p_definition);
end $$;
revoke all on function public.preview_promotion_definition(jsonb,uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.preview_promotion_definition(jsonb,uuid,text,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
