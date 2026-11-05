-- Preserve the existing allocation and authorization checks while allowing each
-- event to exclude a product from sale without disabling promotion rewards.
do $$
declare
  v_definition text;
  v_marker text := '      updated_at = now();';
begin
  select pg_get_functiondef('public.save_event_catalog(uuid,jsonb,text,boolean)'::regprocedure) into v_definition;
  if position(v_marker in v_definition) = 0 or
     length(v_definition) - length(replace(v_definition, v_marker, '')) <> length(v_marker) then
    raise exception 'Unexpected save_event_catalog definition';
  end if;
  v_definition := replace(v_definition, v_marker, v_marker || $patch$
    if v_item ? 'is_sellable' then
      if jsonb_typeof(v_item->'is_sellable') is distinct from 'boolean' then
        raise exception 'invalid_event_sellable';
      end if;
      update public.event_products
      set is_sellable = (v_item->>'is_sellable')::boolean
      where event_id = p_event_id and product_id = v_product_id;
    end if;
$patch$);
  execute v_definition;
end $$;
