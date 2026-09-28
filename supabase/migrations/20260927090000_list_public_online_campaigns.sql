create or replace function public.list_public_online_campaigns(
  p_artist_slug text default null
)
returns table (
  id uuid,
  artist_id uuid,
  artist_slug text,
  slug text,
  name text,
  description text,
  opens_at timestamptz,
  closes_at timestamptz,
  campaign_timezone text,
  state text,
  image_url text
)
language sql
security definer
set search_path = ''
as $$
  select
    c.id,
    c.artist_id,
    a.slug as artist_slug,
    c.slug,
    c.name,
    c.description,
    c.opens_at,
    c.closes_at,
    c.campaign_timezone,
    campaign.data ->> 'state' as state,
    (
      select product ->> 'image_url'
      from jsonb_array_elements(campaign.data -> 'products') product
      where nullif(trim(product ->> 'image_url'), '') is not null
      limit 1
    ) as image_url
  from public.online_campaigns c
  join public.artists a on a.id = c.artist_id
  cross join lateral (
    select public.get_public_online_campaign(a.slug, c.slug) as data
    -- Prevent inlining from repeating the storefront lookup for each selected field.
    offset 0
  ) campaign
  where c.publication_status = 'published'
    and c.closes_at > now()
    and a.is_public = true
    and a.is_verified = true
    and a.published_at is not null
    and (p_artist_slug is null or lower(a.slug) = lower(trim(p_artist_slug)))
    and not exists (
      select 1
      from private.store_restrictions restriction
      where restriction.artist_id = c.artist_id
        and restriction.suspended = true
    )
    and campaign.data ->> 'state' in ('open', 'scheduled', 'sold_out')
  order by
    case campaign.data ->> 'state'
      when 'open' then 1
      when 'scheduled' then 2
      else 3
    end,
    c.opens_at,
    c.id;
$$;

revoke all on function public.list_public_online_campaigns(text) from public;
grant execute on function public.list_public_online_campaigns(text) to anon, authenticated;
