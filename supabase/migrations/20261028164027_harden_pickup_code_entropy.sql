create or replace function public.generate_pickup_code(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_attempt integer := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    v_code := upper(replace(gen_random_uuid()::text, '-', ''));

    exit when not exists (
      select 1
      from public.orders o
      join public.events existing_event on existing_event.id = o.event_id
      join public.events requested_event on requested_event.id = p_event_id
      where existing_event.artist_id = requested_event.artist_id
        and o.pickup_code = v_code
    );

    if v_attempt >= 10 then
      raise exception 'pickup_code_generation_failed';
    end if;
  end loop;
  return v_code;
end;
$$;
