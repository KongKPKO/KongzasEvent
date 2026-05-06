-- `event_products` is joined with LEFT JOIN in the order stock functions because
-- older/global menu items may not have an event catalog row. Postgres cannot
-- lock the nullable side of an outer join, so lock the product row only. The
-- event catalog row is still locked by any UPDATE that touches it.
do $$
declare
  v_function_name text;
  v_definition text;
begin
  foreach v_function_name in array array[
    'create_customer_order_with_stock',
    'sync_customer_order_items_with_stock',
    'cancel_customer_order_with_stock_release',
    'complete_order_with_stock',
    'create_walkin_order_with_stock'
  ]
  loop
    select pg_get_functiondef(p.oid)
    into v_definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = v_function_name;

    if v_definition is null then
      raise exception 'function_not_found: %', v_function_name;
    end if;

    execute replace(v_definition, 'for update of p, ep', 'for update of p');
  end loop;
end;
$$;
