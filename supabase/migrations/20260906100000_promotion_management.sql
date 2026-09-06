alter table public.order_items
  drop constraint if exists order_items_promotion_tier_id_fkey,
  add constraint order_items_promotion_tier_id_fkey
    foreign key (promotion_tier_id) references public.promotion_tiers(id) on delete set null;

create or replace function public.save_promotion_definition(p_definition jsonb)
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

  if v_type not in ('quantity_discount', 'quantity_gift', 'spend_tier_gift') then
    raise exception 'promotion_type_invalid';
  end if;

  if v_id is not null and not exists (
    select 1 from public.artist_promotions
    where id = v_id and artist_id = v_artist_id
  ) then
    raise exception 'promotion_not_found';
  end if;

  if v_id is null then
    insert into public.artist_promotions (
      artist_id, name, target_type, rule_type, promotion_type,
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

  if v_type = 'quantity_gift' then
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

create or replace function public.archive_promotion_definition(p_promotion_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_artist_id uuid;
begin
  select artist_id into v_artist_id
  from public.artist_promotions
  where id = p_promotion_id;

  if v_artist_id is null then raise exception 'promotion_not_found'; end if;
  if not public.has_artist_role(v_artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;

  update public.artist_promotions
  set lifecycle_status = 'archived', status = 'inactive', updated_by = auth.uid()
  where id = p_promotion_id;
  update public.promotion_assignments set is_paused = true where promotion_id = p_promotion_id;
  return true;
end;
$$;

revoke all on function public.save_promotion_definition(jsonb) from public;
revoke all on function public.archive_promotion_definition(uuid) from public;
grant execute on function public.save_promotion_definition(jsonb) to authenticated;
grant execute on function public.archive_promotion_definition(uuid) to authenticated;
