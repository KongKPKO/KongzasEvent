-- Preserve existing stock and role checks while saving gift-only settings with
-- the same optimistic concurrency guarantees as the rest of the batch.
do $$
declare d text; marker text;
begin
  select pg_get_functiondef('public.get_online_campaign_workspace(uuid)'::regprocedure) into d;
  marker := '''is_enabled'', cp.is_enabled';
  if (length(d)-length(replace(d,marker,''))) <> length(marker) then raise exception 'unexpected_campaign_workspace'; end if;
  execute replace(d,marker,marker || ', ''is_sellable'', cp.is_sellable');
  select pg_get_functiondef('public.save_campaign_product_edits(uuid,jsonb)'::regprocedure) into d;
  marker := '    if nullif(item->>''max_quantity_per_order'','''')::integer <= 0 then';
  if position(marker in d)=0 then raise exception 'unexpected_campaign_edits'; end if;
  d := replace(d,marker,$patch$    if item ? 'is_sellable' and (jsonb_typeof(item->'is_sellable') is distinct from 'boolean' or jsonb_typeof(item#>'{expected,is_sellable}') is distinct from 'boolean') then raise exception 'invalid_campaign_sellable'; end if;
    if item ? 'is_sellable' and current_row.is_sellable is distinct from (item#>>'{expected,is_sellable}')::boolean then raise exception 'campaign_product_changed'; end if;
$patch$ || marker);
  marker := '    update public.online_campaign_products set max_quantity_per_order = nullif(item->>''max_quantity_per_order'','''')::integer';
  if position(marker in d)=0 then raise exception 'unexpected_campaign_edits_update'; end if;
  d := replace(d,marker,'    update public.online_campaign_products set is_sellable = case when item ? ''is_sellable'' then (item->>''is_sellable'')::boolean else is_sellable end, max_quantity_per_order = nullif(item->>''max_quantity_per_order'','''')::integer');
  execute d;
end $$;

-- Only the selected campaign assignment changes; store terms and historical
-- orders remain untouched. Serialize with the store promotion editor.
create function public.save_campaign_promotion_selection(p_campaign_id uuid, p_promotion_id uuid, p_expected_revision bigint, p_assignment jsonb, p_confirmation_token text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a uuid; p public.artist_promotions%rowtype; v_start timestamptz; v_end timestamptz; v_policy text; assignment_id uuid; normalized jsonb := '[]'; conflicts jsonb; token text;
begin
  select artist_id into a from public.online_campaigns where id=p_campaign_id;
  if a is null then raise exception 'promotion_context_not_found'; end if;
  if not coalesce(public.has_artist_role(a,array['owner','manager']),false) then raise exception 'forbidden'; end if;
  perform 1 from public.artists where id=a for update;
  select * into p from public.artist_promotions where id=p_promotion_id and artist_id=a for update;
  if not found then raise exception 'promotion_not_found'; end if;
  if p_expected_revision is null or p_expected_revision <> p.revision then raise exception 'promotion_changed'; end if;
  if p.lifecycle_status <> 'ready' then raise exception 'promotion_not_ready'; end if;
  if p_assignment is not null and p_assignment <> 'null'::jsonb then
    if jsonb_typeof(p_assignment) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_assignment) k where k not in ('starts_at','ends_at','combination_policy')) then raise exception 'promotion_assignments_invalid'; end if;
    begin v_start:=nullif(p_assignment->>'starts_at','')::timestamptz; v_end:=nullif(p_assignment->>'ends_at','')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then raise exception 'promotion_assignments_invalid'; end;
    if (v_start is not null and not isfinite(v_start)) or (v_end is not null and not isfinite(v_end)) or (v_start is not null and v_end is not null and v_start >= v_end) then raise exception 'promotion_assignments_invalid'; end if;
    v_policy:=coalesce(nullif(p_assignment->>'combination_policy',''),'combine');
    if v_policy not in ('combine','exclusive') then raise exception 'promotion_assignments_invalid'; end if;
    normalized:=jsonb_build_array(jsonb_build_object('event_id',null,'event_phase',null,'campaign_id',p_campaign_id,'starts_at',v_start,'ends_at',v_end,'combination_policy',v_policy));
    if p.promotion_type='condition_reward' then perform private.validate_promotion_v1(p.v1_config,a,normalized); end if;
    if exists(select 1 from public.promotion_reward_products r where r.promotion_id=p_promotion_id and not exists(select 1 from public.online_campaign_products cp where cp.campaign_id=p_campaign_id and cp.product_id=r.product_id and cp.is_enabled)) then raise exception 'promotion_reward_not_in_channel'; end if;
  end if;
  update public.promotion_assignments set is_paused=true where promotion_id=p_promotion_id and campaign_id=p_campaign_id and not is_paused;
  if jsonb_array_length(normalized)>0 then
    select id into assignment_id from public.promotion_assignments where promotion_id=p_promotion_id and campaign_id=p_campaign_id;
    if assignment_id is null then
      insert into public.promotion_assignments(promotion_id,artist_id,campaign_id,starts_at,ends_at,combination_policy,is_paused) values(p_promotion_id,a,p_campaign_id,v_start,v_end,v_policy,false) returning id into assignment_id;
    else
      update public.promotion_assignments set starts_at=v_start,ends_at=v_end,combination_policy=v_policy,is_paused=false where id=assignment_id;
    end if;
    select coalesce(jsonb_agg(c.value order by c.value::text),'[]'::jsonb) into conflicts from (
      select distinct conflict.value || jsonb_build_object('revision',other.revision) value from jsonb_array_elements(public.promotion_assignment_conflicts(assignment_id)->'conflicts') conflict(value)
      join public.artist_promotions other on other.id=(conflict.value->>'promotion_id')::uuid
    ) c;
    if jsonb_array_length(conflicts)>0 then
      token:=md5(jsonb_build_object('campaign',p_campaign_id,'promotion',p_promotion_id,'revision',p_expected_revision,'assignments',normalized,'conflicts',conflicts)::text);
      if p_confirmation_token is distinct from token then raise exception 'promotion_conflict_confirmation_required' using detail=jsonb_build_object('confirmation_token',token,'conflicts',conflicts)::text; end if;
    end if;
  end if;
  update public.artist_promotions set revision=p.revision+1,updated_by=auth.uid() where id=p_promotion_id;
  return p_promotion_id;
end $$;
revoke all on function public.save_campaign_promotion_selection(uuid,uuid,bigint,jsonb,text) from public,anon;
grant execute on function public.save_campaign_promotion_selection(uuid,uuid,bigint,jsonb,text) to authenticated;
