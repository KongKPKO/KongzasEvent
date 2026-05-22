create or replace function public.submit_creator_application(
  p_auth_user_id uuid,
  p_email text,
  p_contact_name text,
  p_creator_name text,
  p_desired_slug text,
  p_primary_social_url text,
  p_website_url text default null,
  p_instagram_url text default null,
  p_x_url text default null,
  p_facebook_url text default null,
  p_tiktok_url text default null,
  p_application_note text default null
)
returns table (id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_auth_user_id is null then
    raise exception 'auth_user_id is required';
  end if;

  if nullif(trim(coalesce(p_email, '')), '') is null then
    raise exception 'email is required';
  end if;

  return query
  insert into public.creator_applications (
    auth_user_id,
    email,
    contact_name,
    creator_name,
    desired_slug,
    primary_social_url,
    website_url,
    instagram_url,
    x_url,
    facebook_url,
    tiktok_url,
    application_note
  )
  values (
    p_auth_user_id,
    lower(trim(p_email)),
    trim(p_contact_name),
    trim(p_creator_name),
    trim(p_desired_slug),
    trim(p_primary_social_url),
    nullif(trim(coalesce(p_website_url, '')), ''),
    nullif(trim(coalesce(p_instagram_url, '')), ''),
    nullif(trim(coalesce(p_x_url, '')), ''),
    nullif(trim(coalesce(p_facebook_url, '')), ''),
    nullif(trim(coalesce(p_tiktok_url, '')), ''),
    trim(p_application_note)
  )
  returning creator_applications.id;
end;
$$;

revoke all on function public.submit_creator_application(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from public;

grant execute on function public.submit_creator_application(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to anon, authenticated;
