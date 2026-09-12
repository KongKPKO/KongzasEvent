-- Match the existing artists_public_read visibility rule; unpublished stores
-- must not disclose their restriction state to anonymous callers.
create or replace function private.get_store_suspension(p_artist_id uuid)
returns boolean language sql security definer set search_path='' as $$
  select coalesce((select r.suspended from public.artists a left join private.store_restrictions r on r.artist_id=a.id
    where a.id=p_artist_id and ((a.is_public and a.is_verified and a.published_at is not null) or public.is_platform_admin()
      or public.has_artist_role(a.id,array['owner','manager','seller','queue_staff']))),false);
$$;
