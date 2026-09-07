-- SECURITY DEFINER current_user is the function owner, never the API caller.
-- Preserve pricing logic while replacing only the two authorization guards.
do $migration$
declare
  definition text;
  old_guard text;
begin
  definition := pg_get_functiondef('public.calculate_sale_promotions(uuid,text,uuid,jsonb,jsonb,jsonb)'::regprocedure);
  old_guard := $guard$v_can_manage := current_user in ('postgres', 'service_role')
    or public.has_artist_role(v_artist_id, array['owner', 'manager', 'seller']);$guard$;
  if strpos(definition, old_guard) = 0 then
    raise exception 'Unexpected calculate_sale_promotions authorization definition';
  end if;
  execute replace(definition, old_guard,
    $guard$v_can_manage := public.has_artist_role(v_artist_id, array['owner', 'manager', 'seller']);$guard$);

  definition := pg_get_functiondef('public.promotion_assignment_conflicts(uuid)'::regprocedure);
  old_guard := $guard$if not public.has_artist_role(v_assignment.artist_id, array['owner', 'manager'])
    and current_user not in ('postgres', 'service_role') then$guard$;
  if strpos(definition, old_guard) = 0 then
    raise exception 'Unexpected promotion_assignment_conflicts authorization definition';
  end if;
  execute replace(definition, old_guard,
    $guard$if not public.has_artist_role(v_assignment.artist_id, array['owner', 'manager']) then$guard$);
end;
$migration$;

-- Default privileges may have granted these roles explicitly: revoking PUBLIC
-- alone does not remove those grants. Internal callers execute as the owner.
revoke all on function public.calculate_sale_promotions(uuid,text,uuid,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
revoke all on function public.promotion_assignment_conflicts(uuid) from public, anon;
grant execute on function public.promotion_assignment_conflicts(uuid) to authenticated;
