create or replace function public.set_booth_open_status(
  p_event_id uuid,
  p_is_open boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_artist_id uuid;
begin
  select e.artist_id into v_artist_id
  from public.events e
  where e.id = p_event_id;

  if v_artist_id is null then
    raise exception 'event_not_found';
  end if;

  if not public.has_event_role(p_event_id, array['owner', 'queue_only', 'queue_pos']) then
    raise exception 'forbidden';
  end if;

  update public.events
  set is_booth_open = p_is_open,
      last_updated_at = now()
  where id = p_event_id;

  if p_is_open then
    update public.artists
    set is_queue_open = true,
        broadcast_message = null
    where id = v_artist_id;
  end if;

  return true;
end;
$$;

grant execute on function public.set_booth_open_status(uuid, boolean) to authenticated;
