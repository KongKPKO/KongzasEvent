create function private.update_shop_profile(
  p_artist_id uuid,
  p_profile jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null
    or p_artist_id is null
    or not public.has_artist_role(p_artist_id, array['owner', 'manager'])
  then
    raise exception 'forbidden';
  end if;

  if jsonb_typeof(p_profile) is distinct from 'object' then
    raise exception 'invalid_profile';
  end if;

  if exists (
    select 1
    from jsonb_each(p_profile) as field(key, value)
    where not (field.key = any(array[
      'seller_type',
      'display_name',
      'bio',
      'x_url',
      'ig_url',
      'facebook_url',
      'tiktok_url',
      'email',
      'image_url'
    ]::text[]))
      or jsonb_typeof(field.value) not in ('string', 'null')
  ) then
    raise exception 'invalid_profile';
  end if;

  if p_profile ? 'seller_type'
    and coalesce(p_profile ->> 'seller_type', '') not in ('creator', 'cosplayer', 'shop')
  then
    raise exception 'invalid_seller_type';
  end if;

  if p_profile ? 'display_name'
    and nullif(btrim(coalesce(p_profile ->> 'display_name', '')), '') is null
  then
    raise exception 'invalid_display_name';
  end if;

  update public.artists as artist
  set seller_type = case
        when p_profile ? 'seller_type' then p_profile ->> 'seller_type'
        else artist.seller_type
      end,
      display_name = case
        when p_profile ? 'display_name' then p_profile ->> 'display_name'
        else artist.display_name
      end,
      bio = case
        when p_profile ? 'bio' then p_profile ->> 'bio'
        else artist.bio
      end,
      x_url = case
        when p_profile ? 'x_url' then p_profile ->> 'x_url'
        else artist.x_url
      end,
      ig_url = case
        when p_profile ? 'ig_url' then p_profile ->> 'ig_url'
        else artist.ig_url
      end,
      facebook_url = case
        when p_profile ? 'facebook_url' then p_profile ->> 'facebook_url'
        else artist.facebook_url
      end,
      tiktok_url = case
        when p_profile ? 'tiktok_url' then p_profile ->> 'tiktok_url'
        else artist.tiktok_url
      end,
      email = case
        when p_profile ? 'email' then p_profile ->> 'email'
        else artist.email
      end,
      image_url = case
        when p_profile ? 'image_url' then p_profile ->> 'image_url'
        else artist.image_url
      end
  where artist.id = p_artist_id
  returning jsonb_build_object(
    'id', artist.id,
    'seller_type', artist.seller_type
  ) into v_result;

  if v_result is null then
    raise exception 'shop_not_found';
  end if;

  return v_result;
end
$$;

create function public.update_shop_profile(
  p_artist_id uuid,
  p_profile jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.update_shop_profile(p_artist_id, p_profile);
$$;

revoke all on function private.update_shop_profile(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.update_shop_profile(uuid, jsonb) from public, anon, authenticated;

grant execute on function private.update_shop_profile(uuid, jsonb) to authenticated;
grant execute on function public.update_shop_profile(uuid, jsonb) to authenticated;
