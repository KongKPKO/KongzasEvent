-- Reliable role update path for team management UI.
-- Avoids silent no-op updates under RLS by validating permission explicitly.

create or replace function public.update_artist_member_role(
  p_member_id uuid,
  p_next_role text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.artist_members%rowtype;
begin
  if p_next_role not in ('owner', 'queue_only', 'queue_pos') then
    raise exception 'invalid_role';
  end if;

  select *
  into v_member
  from public.artist_members
  where id = p_member_id;

  if v_member.id is null then
    raise exception 'member_not_found';
  end if;

  if not public.has_artist_role(v_member.artist_id, array['owner']) then
    raise exception 'forbidden';
  end if;

  update public.artist_members
  set role = p_next_role,
      updated_at = now()
  where id = p_member_id;

  return true;
end;
$$;

revoke all on function public.update_artist_member_role(uuid, text) from public;
grant execute on function public.update_artist_member_role(uuid, text) to authenticated;
