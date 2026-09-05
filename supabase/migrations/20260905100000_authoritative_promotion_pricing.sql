create or replace function private.promotion_matches_product(
  p_target_type text,
  p_match_category text,
  p_match_tag text,
  p_match_product_id uuid,
  p_match_product_ids uuid[],
  p_product_id uuid,
  p_category text,
  p_tags text[]
)
returns boolean
language sql
immutable
set search_path = public, private, pg_temp
as $$
  select case p_target_type
    when 'all' then true
    when 'product' then
      p_product_id = p_match_product_id
      or p_product_id = any(coalesce(p_match_product_ids, '{}'::uuid[]))
    when 'category' then lower(trim(coalesce(p_category, ''))) = lower(trim(coalesce(p_match_category, '')))
    when 'tag' then exists (
      select 1 from unnest(coalesce(p_tags, '{}'::text[])) tag
      where lower(trim(tag)) = lower(trim(coalesce(p_match_tag, '')))
    )
    when 'category_tag' then
      lower(trim(coalesce(p_category, ''))) = lower(trim(coalesce(p_match_category, '')))
      and exists (
        select 1 from unnest(coalesce(p_tags, '{}'::text[])) tag
        where lower(trim(tag)) = lower(trim(coalesce(p_match_tag, '')))
      )
    else false
  end;
$$;

create or replace function private.promotion_target_product_ids(
  p_promotion_id uuid,
  p_event_id uuid,
  p_campaign_id uuid
)
returns table (product_id uuid)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  with promotion as (
    select * from public.artist_promotions where id = p_promotion_id
  ), channel_products as (
    select ep.product_id
    from public.event_products ep
    where p_event_id is not null
      and ep.event_id = p_event_id
      and ep.is_enabled
      and ep.is_sellable
    union all
    select cp.product_id
    from public.online_campaign_products cp
    where p_campaign_id is not null
      and cp.campaign_id = p_campaign_id
      and cp.is_enabled
      and cp.is_sellable
  )
  select p.id
  from promotion ap
  join channel_products cp on true
  join public.products p on p.id = cp.product_id
  where p.deleted_at is null
    and private.promotion_matches_product(
      ap.target_type,
      ap.match_category,
      ap.match_tag,
      ap.match_product_id,
      ap.match_product_ids,
      p.id,
      p.category,
      p.tags
    );
$$;

create or replace function private.promotion_reward_options(
  p_promotion_id uuid,
  p_tier_id uuid,
  p_event_id uuid,
  p_campaign_id uuid,
  p_needed integer
)
returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select coalesce(jsonb_agg(option_row.value order by option_row.sort_order, option_row.name), '[]'::jsonb)
  from (
    select
      prp.sort_order,
      p.name,
      jsonb_build_object(
        'product_id', p.id,
        'name', p.name,
        'sku', p.sku,
        'is_unlimited', ep.is_unlimited,
        'available', case
          when ep.is_unlimited then null
          else greatest(coalesce(ep.stock_total, 0) - ep.stock_reserved - ep.stock_sold, 0)
        end,
        'channel_product_id', ep.id
      ) as value
    from public.promotion_reward_products prp
    join public.products p on p.id = prp.product_id and p.deleted_at is null
    join public.event_products ep
      on p_event_id is not null
     and ep.event_id = p_event_id
     and ep.product_id = prp.product_id
     and ep.is_enabled
    where prp.promotion_id = p_promotion_id
      and prp.promotion_tier_id is not distinct from p_tier_id
      and (ep.is_unlimited or coalesce(ep.stock_total, 0) - ep.stock_reserved - ep.stock_sold >= p_needed)

    union all

    select
      prp.sort_order,
      p.name,
      jsonb_build_object(
        'product_id', p.id,
        'name', p.name,
        'sku', p.sku,
        'is_unlimited', cp.is_unlimited,
        'available', case
          when cp.is_unlimited then null
          else greatest(coalesce(cp.stock_total, 0) - cp.stock_reserved - cp.stock_sold, 0)
        end,
        'channel_product_id', cp.id
      ) as value
    from public.promotion_reward_products prp
    join public.products p on p.id = prp.product_id and p.deleted_at is null
    join public.online_campaign_products cp
      on p_campaign_id is not null
     and cp.campaign_id = p_campaign_id
     and cp.product_id = prp.product_id
     and cp.is_enabled
    where prp.promotion_id = p_promotion_id
      and prp.promotion_tier_id is not distinct from p_tier_id
      and (cp.is_unlimited or coalesce(cp.stock_total, 0) - cp.stock_reserved - cp.stock_sold >= p_needed)
  ) option_row;
$$;

create or replace function private.resolve_promotion_rewards(
  p_promotion_id uuid,
  p_tier_id uuid,
  p_selection_mode text,
  p_earned_quantity integer,
  p_options jsonb,
  p_reward_choices jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_choice jsonb;
  v_selected_ids jsonb;
  v_lines jsonb;
begin
  if jsonb_array_length(coalesce(p_options, '[]'::jsonb)) = 0 then
    return jsonb_build_object(
      'resolved', false,
      'exhausted', true,
      'lines', '[]'::jsonb,
      'options', '[]'::jsonb
    );
  end if;

  if p_selection_mode = 'fixed' then
    return jsonb_build_object(
      'resolved', true,
      'exhausted', false,
      'lines', jsonb_build_array(
        (p_options -> 0) || jsonb_build_object(
          'quantity', p_earned_quantity,
          'promotion_id', p_promotion_id,
          'tier_id', p_tier_id
        )
      ),
      'options', p_options
    );
  end if;

  select choice.value
  into v_choice
  from jsonb_array_elements(coalesce(p_reward_choices, '[]'::jsonb)) choice(value)
  where choice.value ->> 'promotion_id' = p_promotion_id::text
    and (
      (p_tier_id is null and nullif(choice.value ->> 'tier_id', '') is null)
      or choice.value ->> 'tier_id' = p_tier_id::text
    )
  limit 1;

  v_selected_ids := coalesce(v_choice -> 'product_ids', '[]'::jsonb);

  if jsonb_array_length(v_selected_ids) <> p_earned_quantity
     or exists (
       select 1
       from jsonb_array_elements_text(v_selected_ids) selected(product_id)
       where not exists (
         select 1
         from jsonb_array_elements(p_options) option_row(value)
         where option_row.value ->> 'product_id' = selected.product_id
       )
     ) then
    return jsonb_build_object(
      'resolved', false,
      'exhausted', false,
      'lines', '[]'::jsonb,
      'options', p_options
    );
  end if;

  select coalesce(jsonb_agg(
    option_row.value || jsonb_build_object(
      'quantity', selected.quantity,
      'promotion_id', p_promotion_id,
      'tier_id', p_tier_id
    )
    order by option_row.value ->> 'name'
  ), '[]'::jsonb)
  into v_lines
  from (
    select product_id, count(*)::integer as quantity
    from jsonb_array_elements_text(v_selected_ids) selected_id(product_id)
    group by product_id
  ) selected
  join lateral (
    select option_value.value
    from jsonb_array_elements(p_options) option_value(value)
    where option_value.value ->> 'product_id' = selected.product_id
    limit 1
  ) option_row on true;

  return jsonb_build_object(
    'resolved', true,
    'exhausted', false,
    'lines', v_lines,
    'options', p_options
  );
end;
$$;

create or replace function private.jsonb_text_arrays_overlap(p_left jsonb, p_right jsonb)
returns boolean
language sql
immutable
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from jsonb_array_elements_text(coalesce(p_left, '[]'::jsonb)) left_id(value)
    join jsonb_array_elements_text(coalesce(p_right, '[]'::jsonb)) right_id(value)
      on right_id.value = left_id.value
  );
$$;

create or replace function public.calculate_sale_promotions(
  p_event_id uuid,
  p_event_phase text,
  p_campaign_id uuid,
  p_items jsonb,
  p_reward_choices jsonb,
  p_promotion_choices jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
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

  v_can_manage := current_user in ('postgres', 'service_role')
    or public.has_artist_role(v_artist_id, array['owner', 'manager', 'seller']);

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
        ep.is_unlimited,
        case when ep.is_unlimited then null
          else greatest(coalesce(ep.stock_total, 0) - ep.stock_reserved - ep.stock_sold, 0)
        end
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
        cp.is_unlimited,
        case when cp.is_unlimited then null
          else greatest(coalesce(cp.stock_total, 0) - cp.stock_reserved - cp.stock_sold, 0)
        end
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
    select ap.*, pa.id as assignment_id, pa.combination_policy
    from public.promotion_assignments pa
    join public.artist_promotions ap on ap.id = pa.promotion_id
    where pa.artist_id = v_artist_id
      and ap.lifecycle_status = 'ready'
      and not pa.is_paused
      and (pa.starts_at is null or pa.starts_at <= now())
      and (pa.ends_at is null or pa.ends_at > now())
      and (
        (p_event_id is not null and pa.event_id = p_event_id and pa.event_phase = p_event_phase)
        or (p_campaign_id is not null and pa.campaign_id = p_campaign_id)
      )
      and ap.promotion_type <> 'spend_tier_gift'
    order by ap.priority, ap.created_at, pa.id
  loop
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
        v_options := private.promotion_reward_options(
          v_rule.id, null, p_event_id, p_campaign_id, v_earned
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
            'options', v_resolution -> 'options'
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

  for v_rule in
    select ap.*, pa.id as assignment_id, pa.combination_policy
    from public.promotion_assignments pa
    join public.artist_promotions ap on ap.id = pa.promotion_id
    where pa.artist_id = v_artist_id
      and ap.lifecycle_status = 'ready'
      and ap.promotion_type = 'spend_tier_gift'
      and not pa.is_paused
      and (pa.starts_at is null or pa.starts_at <= now())
      and (pa.ends_at is null or pa.ends_at > now())
      and (
        (p_event_id is not null and pa.event_id = p_event_id and pa.event_phase = p_event_phase)
        or (p_campaign_id is not null and pa.campaign_id = p_campaign_id)
      )
    order by ap.priority, ap.created_at, pa.id
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
      v_options := private.promotion_reward_options(
        v_rule.id, v_tier.id, p_event_id, p_campaign_id, v_tier.reward_quantity
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
          'options', v_resolution -> 'options'
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
    'subtotal', v_subtotal,
    'discount_total', v_discount_total,
    'merchandise_total', greatest(0, v_subtotal - v_discount_total),
    'shipping_fee', 0,
    'total', greatest(0, v_subtotal - v_discount_total),
    'applied_promotions', v_applied,
    'reward_lines', v_reward_lines,
    'required_choices', v_required_choices
  );

  v_hash := encode(extensions.digest(convert_to(v_result::text, 'UTF8'), 'sha256'), 'hex');
  return v_result || jsonb_build_object('pricing_hash', v_hash);
end;
$$;

create or replace function public.quote_sale_promotions(
  p_event_id uuid,
  p_event_phase text,
  p_campaign_id uuid,
  p_items jsonb,
  p_reward_choices jsonb default '[]'::jsonb,
  p_promotion_choices jsonb default '[]'::jsonb
)
returns jsonb
language sql
security definer
set search_path = public, private, extensions, pg_temp
as $$
  select public.calculate_sale_promotions(
    p_event_id,
    p_event_phase,
    p_campaign_id,
    p_items,
    coalesce(p_reward_choices, '[]'::jsonb),
    coalesce(p_promotion_choices, '[]'::jsonb)
  );
$$;

create or replace function public.promotion_assignment_conflicts(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_assignment record;
  v_conflicts jsonb;
begin
  select pa.*, ap.name as promotion_name
  into v_assignment
  from public.promotion_assignments pa
  join public.artist_promotions ap on ap.id = pa.promotion_id
  where pa.id = p_assignment_id;

  if v_assignment.id is null then
    raise exception 'promotion_assignment_not_found';
  end if;

  if not public.has_artist_role(v_assignment.artist_id, array['owner', 'manager'])
    and current_user not in ('postgres', 'service_role') then
    raise exception 'forbidden';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'assignment_id', other_assignment.id,
    'promotion_id', other_assignment.promotion_id,
    'promotion_name', other_promotion.name,
    'overlapping_product_ids', overlap.product_ids,
    'current_policy', v_assignment.combination_policy,
    'other_policy', other_assignment.combination_policy
  ) order by other_promotion.name, other_assignment.id), '[]'::jsonb)
  into v_conflicts
  from public.promotion_assignments other_assignment
  join public.artist_promotions other_promotion on other_promotion.id = other_assignment.promotion_id
  cross join lateral (
    select coalesce(jsonb_agg(current_targets.product_id), '[]'::jsonb) as product_ids
    from private.promotion_target_product_ids(
      v_assignment.promotion_id,
      v_assignment.event_id,
      v_assignment.campaign_id
    ) current_targets
    join private.promotion_target_product_ids(
      other_assignment.promotion_id,
      other_assignment.event_id,
      other_assignment.campaign_id
    ) other_targets using (product_id)
  ) overlap
  where other_assignment.id <> v_assignment.id
    and other_assignment.artist_id = v_assignment.artist_id
    and other_promotion.lifecycle_status = 'ready'
    and not other_assignment.is_paused
    and (
      (v_assignment.event_id is not null
        and other_assignment.event_id = v_assignment.event_id
        and other_assignment.event_phase = v_assignment.event_phase)
      or (v_assignment.campaign_id is not null
        and other_assignment.campaign_id = v_assignment.campaign_id)
    )
    and coalesce(v_assignment.starts_at, '-infinity'::timestamptz)
      < coalesce(other_assignment.ends_at, 'infinity'::timestamptz)
    and coalesce(other_assignment.starts_at, '-infinity'::timestamptz)
      < coalesce(v_assignment.ends_at, 'infinity'::timestamptz)
    and jsonb_array_length(overlap.product_ids) > 0;

  return jsonb_build_object(
    'has_conflict', jsonb_array_length(v_conflicts) > 0,
    'conflicts', v_conflicts
  );
end;
$$;

revoke all on function public.calculate_sale_promotions(uuid, text, uuid, jsonb, jsonb, jsonb) from public;
revoke all on function public.quote_sale_promotions(uuid, text, uuid, jsonb, jsonb, jsonb) from public;
revoke all on function public.promotion_assignment_conflicts(uuid) from public;

grant execute on function public.quote_sale_promotions(uuid, text, uuid, jsonb, jsonb, jsonb)
  to anon, authenticated;
grant execute on function public.promotion_assignment_conflicts(uuid)
  to authenticated;
