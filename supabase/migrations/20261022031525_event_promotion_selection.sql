-- Event selection changes assignments only; historical reward tiers and order
-- references must not be rebuilt by the store-definition editor's save path.
create function public.save_event_promotion_selection(
  p_event_id uuid,
  p_promotion_id uuid,
  p_expected_revision bigint,
  p_assignments jsonb,
  p_confirmation_token text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_artist uuid;
  v_promotion public.artist_promotions%rowtype;
  v_item jsonb;
  v_phase text;
  v_seen text[] := '{}';
  v_start timestamptz;
  v_end timestamptz;
  v_policy text;
  v_assignment_id uuid;
  v_normalized jsonb := '[]';
  v_conflicts jsonb;
  v_token text;
begin
  select artist_id into v_artist from public.events where id = p_event_id;
  if v_artist is null then raise exception 'promotion_context_not_found'; end if;
  if not coalesce(public.has_artist_role(v_artist, array['owner','manager']), false) then
    raise exception 'forbidden';
  end if;
  -- Same lock order as save_promotion_definition: edits across a shop serialize.
  perform 1 from public.artists where id = v_artist for update;
  select * into v_promotion from public.artist_promotions
    where id = p_promotion_id and artist_id = v_artist for update;
  if not found then raise exception 'promotion_not_found'; end if;
  if p_expected_revision is null or p_expected_revision <> v_promotion.revision then
    raise exception 'promotion_changed';
  end if;
  if v_promotion.lifecycle_status <> 'ready' then raise exception 'promotion_not_ready'; end if;
  if jsonb_typeof(p_assignments) is distinct from 'array' then raise exception 'promotion_assignments_invalid'; end if;
  if jsonb_array_length(p_assignments) > 3 then raise exception 'promotion_assignments_invalid'; end if;

  for v_item in select value from jsonb_array_elements(p_assignments) loop
    if jsonb_typeof(v_item) is distinct from 'object' then raise exception 'promotion_assignments_invalid'; end if;
    if exists (select 1 from jsonb_object_keys(v_item) as keys(name) where name not in ('event_phase','starts_at','ends_at','combination_policy')) then
      raise exception 'promotion_assignments_invalid';
    end if;
    v_phase := v_item ->> 'event_phase';
    if v_phase is null or v_phase not in ('preorder','live','postorder') or v_phase = any(v_seen) then
      raise exception 'promotion_assignments_invalid';
    end if;
    v_seen := array_append(v_seen, v_phase);
    if jsonb_typeof(v_item -> 'starts_at') not in ('string','null') or jsonb_typeof(v_item -> 'ends_at') not in ('string','null') then
      raise exception 'promotion_assignments_invalid';
    end if;
    begin
      v_start := nullif(v_item ->> 'starts_at', '')::timestamptz;
      v_end := nullif(v_item ->> 'ends_at', '')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'promotion_assignments_invalid';
    end;
    if (v_start is not null and not isfinite(v_start)) or (v_end is not null and not isfinite(v_end)) or (v_start is not null and v_end is not null and v_start >= v_end) then
      raise exception 'promotion_assignments_invalid';
    end if;
    v_policy := coalesce(nullif(v_item ->> 'combination_policy', ''), 'exclusive');
    if v_policy not in ('exclusive','combine') then raise exception 'promotion_assignments_invalid'; end if;
    v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
      'event_id', p_event_id, 'event_phase', v_phase, 'campaign_id', null,
      'starts_at', v_start, 'ends_at', v_end, 'combination_policy', v_policy
    ));
  end loop;

  if jsonb_array_length(v_normalized) > 0 then
    if v_promotion.promotion_type = 'condition_reward' then
      perform private.validate_promotion_v1(v_promotion.v1_config, v_artist, v_normalized);
    end if;
    if exists (
      select 1 from public.promotion_reward_products reward
      where reward.promotion_id = p_promotion_id and not exists (
        select 1 from public.event_products product
        where product.event_id = p_event_id and product.product_id = reward.product_id and product.is_enabled
      )
    ) then raise exception 'promotion_reward_not_in_channel'; end if;
  end if;

  update public.promotion_assignments set is_paused = true
    where promotion_id = p_promotion_id and event_id = p_event_id and not is_paused;
  for v_item in select value from jsonb_array_elements(v_normalized) loop
    select id into v_assignment_id from public.promotion_assignments
      where promotion_id = p_promotion_id and event_id = p_event_id and event_phase = v_item ->> 'event_phase';
    if v_assignment_id is null then
      insert into public.promotion_assignments(promotion_id, artist_id, event_id, event_phase, starts_at, ends_at, combination_policy, is_paused)
      values(p_promotion_id, v_artist, p_event_id, v_item ->> 'event_phase', (v_item ->> 'starts_at')::timestamptz, (v_item ->> 'ends_at')::timestamptz, v_item ->> 'combination_policy', false);
    else
      update public.promotion_assignments set starts_at = (v_item ->> 'starts_at')::timestamptz,
        ends_at = (v_item ->> 'ends_at')::timestamptz, combination_policy = v_item ->> 'combination_policy', is_paused = false
        where id = v_assignment_id;
    end if;
    v_assignment_id := null;
  end loop;

  select coalesce(jsonb_agg(conflicts.value order by conflicts.value::text), '[]'::jsonb)
    into v_conflicts from (
    select distinct conflict.value || jsonb_build_object('revision', other.revision) as value
    from public.promotion_assignments assignment
    cross join lateral jsonb_array_elements(public.promotion_assignment_conflicts(assignment.id) -> 'conflicts') conflict(value)
    join public.artist_promotions other on other.id = (conflict.value ->> 'promotion_id')::uuid
    where assignment.promotion_id = p_promotion_id and assignment.event_id = p_event_id and not assignment.is_paused
    ) conflicts;
  if jsonb_array_length(v_conflicts) > 0 then
    v_token := md5(jsonb_build_object('event', p_event_id, 'promotion', p_promotion_id, 'revision', p_expected_revision, 'assignments', v_normalized, 'conflicts', v_conflicts)::text);
    if p_confirmation_token is distinct from v_token then
      raise exception 'promotion_conflict_confirmation_required'
        using detail = jsonb_build_object('confirmation_token', v_token, 'conflicts', v_conflicts)::text;
    end if;
  end if;
  update public.artist_promotions set revision = v_promotion.revision + 1, updated_by = auth.uid()
    where id = p_promotion_id;
  return p_promotion_id;
end;
$$;
revoke all on function public.save_event_promotion_selection(uuid,uuid,bigint,jsonb,text) from public, anon;
grant execute on function public.save_event_promotion_selection(uuid,uuid,bigint,jsonb,text) to authenticated;
