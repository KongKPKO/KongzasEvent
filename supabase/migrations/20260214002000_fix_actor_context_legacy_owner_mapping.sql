-- Fix legacy owner mapping for accounts where artists.id != auth.users.id
-- and owner identity is tracked via artists.email.

-- Backfill owner memberships by direct uid mapping (artists.id = auth.users.id).
insert into public.artist_members (artist_id, member_email, role, status, created_by)
select a.id, lower(u.email), 'owner', 'active', a.id
from public.artists a
join auth.users u on u.id = a.id
where u.email is not null
on conflict do nothing;

-- Backfill owner memberships by legacy email mapping (artists.email = auth.users.email).
insert into public.artist_members (artist_id, member_email, role, status, created_by)
select a.id, lower(u.email), 'owner', 'active', a.id
from public.artists a
join auth.users u
  on a.email is not null
 and lower(a.email) = lower(u.email)
where u.email is not null
on conflict do nothing;

-- Normalize existing member emails to lowercase for stable matching.
update public.artist_members
set member_email = lower(member_email)
where member_email <> lower(member_email);

create or replace function public.has_artist_role(p_artist_id uuid, p_allowed_roles text[])
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if auth.uid() is null then
    return false;
  end if;

  if auth.uid() = p_artist_id then
    return true;
  end if;

  v_email := lower(coalesce((auth.jwt() ->> 'email'), ''));
  if v_email = '' then
    return false;
  end if;

  if exists (
    select 1
    from public.artist_members m
    where m.artist_id = p_artist_id
      and m.status = 'active'
      and lower(m.member_email) = v_email
      and m.role = any(p_allowed_roles)
  ) then
    return true;
  end if;

  -- Legacy fallback: treat artist.email owner as owner role only.
  if array_position(p_allowed_roles, 'owner') is not null then
    return exists (
      select 1
      from public.artists a
      where a.id = p_artist_id
        and lower(coalesce(a.email, '')) = v_email
    );
  end if;

  return false;
end;
$$;

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

  if exists (select 1 from public.artists a where a.id = auth.uid()) then
    return query
    select auth.uid(), 'owner'::text, true, v_email;
    return;
  end if;

  return query
  select m.artist_id, m.role, (m.role = 'owner'), m.member_email
  from public.artist_members m
  where m.status = 'active'
    and lower(m.member_email) = v_email
  order by m.updated_at desc
  limit 1;

  if found then
    return;
  end if;

  -- Legacy fallback by artist profile email.
  return query
  select a.id, 'owner'::text, true, v_email
  from public.artists a
  where v_email <> ''
    and lower(coalesce(a.email, '')) = v_email
  order by a.updated_at desc
  limit 1;
end;
$$;
