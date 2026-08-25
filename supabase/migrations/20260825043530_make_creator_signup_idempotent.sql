with ranked_active_applications as (
  select
    id,
    row_number() over (
      partition by auth_user_id
      order by created_at, id
    ) as active_rank
  from public.creator_applications
  where auth_user_id is not null
    and status in ('pending', 'auto_approved', 'approved')
)
update public.creator_applications ca
set status = 'rejected',
    reviewed_at = coalesce(ca.reviewed_at, now()),
    review_note = 'Duplicate active self-serve application retired by signup idempotency migration.'
from ranked_active_applications ranked
where ca.id = ranked.id
  and ranked.active_rank > 1;

create unique index if not exists creator_applications_active_auth_user_uidx
  on public.creator_applications (auth_user_id)
  where auth_user_id is not null
    and status in ('pending', 'auto_approved', 'approved');

create or replace function public.complete_verified_creator_signup()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed_at timestamptz;
  v_meta jsonb;
  v_application_id uuid;
  v_creator_name text;
  v_contact_name text;
  v_desired_slug text;
  v_primary_social_url text;
  v_application_note text;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  select lower(u.email), u.email_confirmed_at, coalesce(u.raw_user_meta_data, '{}'::jsonb)
  into v_email, v_confirmed_at, v_meta
  from auth.users u
  where u.id = v_uid;

  if v_email is null then
    raise exception 'Authenticated user not found';
  end if;

  if exists (select 1 from public.artists a where a.id = v_uid) then
    return jsonb_build_object('status', 'exists');
  end if;

  if coalesce(v_meta ->> 'creator_signup', '') <> 'self_serve' then
    return jsonb_build_object('status', 'not_pending');
  end if;

  if v_confirmed_at is null then
    return jsonb_build_object('status', 'email_unconfirmed');
  end if;

  v_creator_name := nullif(trim(coalesce(v_meta ->> 'creator_name', '')), '');
  v_contact_name := nullif(trim(coalesce(v_meta ->> 'contact_name', '')), '');
  v_desired_slug := lower(nullif(trim(coalesce(v_meta ->> 'desired_slug', '')), ''));
  v_primary_social_url := nullif(trim(coalesce(v_meta ->> 'primary_social_url', '')), '');
  v_application_note := nullif(trim(coalesce(v_meta ->> 'application_note', '')), '');

  if v_creator_name is null
    or v_contact_name is null
    or v_desired_slug is null
    or v_primary_social_url is null
    or v_application_note is null then
    raise exception 'Creator signup metadata is incomplete';
  end if;

  if v_desired_slug !~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'
    or v_desired_slug = any (array['admin', 'settings', 'login', 'menu']) then
    raise exception 'Desired URL slug is invalid';
  end if;

  if exists (
    select 1
    from public.artists a
    where lower(a.slug) = v_desired_slug
  ) or exists (
    select 1
    from public.creator_applications ca
    where lower(ca.desired_slug) = v_desired_slug
      and ca.status in ('pending', 'auto_approved', 'approved')
      and ca.auth_user_id <> v_uid
  ) then
    raise exception 'Desired URL slug is already taken';
  end if;

  insert into public.creator_applications (
    auth_user_id,
    status,
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
    v_uid,
    'auto_approved',
    v_email,
    v_contact_name,
    v_creator_name,
    v_desired_slug,
    v_primary_social_url,
    nullif(trim(coalesce(v_meta ->> 'website_url', '')), ''),
    nullif(trim(coalesce(v_meta ->> 'instagram_url', '')), ''),
    nullif(trim(coalesce(v_meta ->> 'x_url', '')), ''),
    nullif(trim(coalesce(v_meta ->> 'facebook_url', '')), ''),
    nullif(trim(coalesce(v_meta ->> 'tiktok_url', '')), ''),
    v_application_note
  )
  returning id into v_application_id;

  return jsonb_build_object(
    'status', 'created',
    'application_id', v_application_id,
    'artist_id', v_uid
  );
end;
$$;

revoke all on function public.complete_verified_creator_signup() from public, anon, authenticated;
grant execute on function public.complete_verified_creator_signup() to authenticated;
