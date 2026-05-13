-- Resolve workspace identity for staff/manager accounts by membership email.
-- Staff users do not own an artists row; they must still receive a stable
-- actor context after password signup, magic-link login, and browser relogin.

create or replace function public.get_actor_context()
returns table (
  artist_id uuid,
  role text,
  is_owner boolean,
  member_email text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if auth.uid() is null then
    return;
  end if;

  v_email := lower(coalesce((auth.jwt() ->> 'email'), ''));

  -- Direct owner mapping from the original prototype model.
  if exists (select 1 from public.artists a where a.id = auth.uid()) then
    return query
    select auth.uid(), 'owner'::text, true, v_email;
    return;
  end if;

  -- Team membership is the source of truth for manager/seller/queue_staff,
  -- and also covers owner accounts where the artist id differs from auth.uid().
  return query
  select
    m.artist_id,
    public.normalize_artist_role(m.role),
    public.normalize_artist_role(m.role) = 'owner',
    lower(m.member_email)
  from public.artist_members m
  where m.status = 'active'
    and v_email <> ''
    and lower(m.member_email) = v_email
  order by
    case public.normalize_artist_role(m.role)
      when 'owner' then 1
      when 'manager' then 2
      when 'seller' then 3
      when 'queue_staff' then 4
      else 5
    end,
    m.updated_at desc
  limit 1;

  if found then
    return;
  end if;

  -- Legacy owner fallback by artist profile email.
  return query
  select a.id, 'owner'::text, true, v_email
  from public.artists a
  where v_email <> ''
    and lower(coalesce(a.email, '')) = v_email
  order by a.updated_at desc nulls last
  limit 1;
end;
$$;

grant execute on function public.get_actor_context() to authenticated;
