-- Keep reward-only stock available to promotion resolution, not paid-item menus.
do $migration$
declare
  definition text := pg_get_functiondef('public.list_event_products(uuid)'::regprocedure);
  old_filter text := 'and ep.is_enabled = true';
begin
  if strpos(definition, old_filter) = 0 then
    raise exception 'Unexpected list_event_products definition';
  end if;
  execute replace(definition, old_filter,
    old_filter || ' and ep.is_sellable = true');
end;
$migration$;
