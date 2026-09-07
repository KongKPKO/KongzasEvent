-- Keep the established validation/write path, but never commit an unconfirmed
-- collision. Raising an exception rolls back definitions, tiers and assignments.
alter function public.save_promotion_definition(jsonb) rename to save_promotion_definition_base;
alter function public.save_promotion_definition_base(jsonb) set schema private;
revoke all on function private.save_promotion_definition_base(jsonb) from public, anon, authenticated;

create function public.save_promotion_definition(p_definition jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artist uuid := nullif(p_definition ->> 'artist_id', '')::uuid;
  v_id uuid := nullif(p_definition ->> 'id', '')::uuid;
  v_revision bigint;
  v_conflicts jsonb;
  v_token text;
begin
  if not public.has_artist_role(v_artist, array['owner','manager']) then
    raise exception 'forbidden';
  end if;
  -- Serialize promotion saves within a store, including creation of new offers.
  perform 1 from public.artists where id = v_artist for update;
  if v_id is not null then
    select revision into v_revision from public.artist_promotions
    where id = v_id and artist_id = v_artist for update;
    if v_revision is null then raise exception 'promotion_not_found'; end if;
    if p_definition ->> 'expected_revision' is not null
      and (p_definition ->> 'expected_revision')::bigint <> v_revision then
      raise exception 'promotion_changed';
    end if;
  end if;

  v_id := private.save_promotion_definition_base(p_definition);
  select coalesce(jsonb_agg(distinct conflict.value || jsonb_build_object('revision', other.revision)), '[]'::jsonb)
  into v_conflicts
  from public.promotion_assignments assignment
  cross join lateral jsonb_array_elements(public.promotion_assignment_conflicts(assignment.id) -> 'conflicts') conflict(value)
  join public.artist_promotions other on other.id = (conflict.value ->> 'promotion_id')::uuid
  where assignment.promotion_id = v_id and not assignment.is_paused;

  if jsonb_array_length(v_conflicts) > 0 then
    v_token := md5(v_conflicts::text || (p_definition - 'confirmation_token')::text);
    if p_definition ->> 'confirmation_token' is distinct from v_token then
      raise exception 'promotion_conflict_confirmation_required'
        using detail = jsonb_build_object('confirmation_token', v_token, 'conflicts', v_conflicts)::text;
    end if;
  end if;
  -- Assignment/tier-only edits also invalidate other open editors.
  if v_revision is not null then
    update public.artist_promotions set revision = greatest(revision, v_revision + 1)
    where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_promotion_definition(jsonb) from public, anon;
grant execute on function public.save_promotion_definition(jsonb) to authenticated;
