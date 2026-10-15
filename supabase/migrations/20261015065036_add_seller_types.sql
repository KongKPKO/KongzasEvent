alter table public.artists
  add column if not exists seller_type text not null default 'creator';

alter table public.artists
  drop constraint if exists artists_seller_type_check;

alter table public.artists
  add constraint artists_seller_type_check
  check (seller_type in ('creator', 'cosplayer', 'shop'));

alter table public.creator_applications
  add column if not exists seller_type text not null default 'creator';

alter table public.creator_applications
  drop constraint if exists creator_applications_seller_type_check;

alter table public.creator_applications
  add constraint creator_applications_seller_type_check
  check (seller_type in ('creator', 'cosplayer', 'shop'));

create or replace function public.auto_create_creator_workspace_from_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
begin
  if new.auth_user_id is null then
    raise exception 'Creator signup requires an auth user';
  end if;

  if not exists (
    select 1
    from auth.users u
    where u.id = new.auth_user_id
      and u.email_confirmed_at is not null
  ) then
    raise exception 'Email must be confirmed before workspace creation';
  end if;

  if new.status not in ('pending', 'auto_approved') then
    raise exception 'Creator signup cannot start with status %', new.status;
  end if;

  if exists (
    select 1
    from public.artists a
    where lower(a.slug) = lower(new.desired_slug)
      and a.id <> new.auth_user_id
  ) then
    raise exception 'Desired URL slug is already taken';
  end if;

  if exists (
    select 1
    from public.creator_applications ca
    where lower(ca.desired_slug) = lower(new.desired_slug)
      and ca.status in ('pending', 'auto_approved', 'approved')
      and ca.auth_user_id <> new.auth_user_id
  ) then
    raise exception 'Desired URL slug is already taken';
  end if;

  insert into public.artists (
    id,
    slug,
    display_name,
    email,
    seller_type,
    facebook_url,
    ig_url,
    x_url,
    tiktok_url,
    is_public,
    is_verified,
    published_at
  )
  values (
    new.auth_user_id,
    new.desired_slug,
    new.creator_name,
    lower(new.email),
    new.seller_type,
    nullif(new.facebook_url, ''),
    nullif(new.instagram_url, ''),
    nullif(new.x_url, ''),
    nullif(new.tiktok_url, ''),
    false,
    true,
    null
  )
  on conflict (id) do update
  set slug = excluded.slug,
      display_name = excluded.display_name,
      email = excluded.email,
      seller_type = excluded.seller_type,
      facebook_url = excluded.facebook_url,
      ig_url = excluded.ig_url,
      x_url = excluded.x_url,
      tiktok_url = excluded.tiktok_url,
      is_verified = true,
      updated_at = now();

  select m.id
  into v_member_id
  from public.artist_members m
  where m.artist_id = new.auth_user_id
    and lower(m.member_email) = lower(new.email)
  limit 1;

  if v_member_id is null then
    insert into public.artist_members (
      artist_id,
      member_email,
      role,
      status,
      created_by
    )
    values (
      new.auth_user_id,
      lower(new.email),
      'owner',
      'active',
      new.auth_user_id
    );
  else
    update public.artist_members
    set role = 'owner',
        status = 'active',
        updated_at = now()
    where id = v_member_id;
  end if;

  new.status := 'auto_approved';
  new.reviewed_at := coalesce(new.reviewed_at, now());
  new.reviewed_by := null;
  new.review_note := 'Workspace auto-created after email verification.';

  return new;
end;
$$;

revoke all on function public.auto_create_creator_workspace_from_application() from public, anon, authenticated;

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
  v_seller_type text;
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
  v_seller_type := coalesce(nullif(trim(coalesce(v_meta ->> 'seller_type', '')), ''), 'creator');

  if v_creator_name is null
    or v_contact_name is null
    or v_desired_slug is null
    or v_primary_social_url is null
    or v_application_note is null then
    raise exception 'Creator signup metadata is incomplete';
  end if;

  if v_seller_type not in ('creator', 'cosplayer', 'shop') then
    raise exception 'invalid_seller_type';
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
    seller_type,
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
    v_seller_type,
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

-- Preserve the existing campaign builders and append the seller classification
-- to their JSON objects without duplicating their product and pricing logic.
do $migration$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.get_public_online_campaign(text,text)'::regprocedure);
  if strpos(definition, '''payment_methods'', v_payment_methods') = 0 then
    raise exception 'Unexpected public campaign projection';
  end if;
  definition := replace(
    definition,
    '''payment_methods'', v_payment_methods',
    '''artist_seller_type'', (select a.seller_type from public.artists a where a.id = v_campaign.artist_id),
    ''payment_methods'', v_payment_methods'
  );
  execute definition;

  definition := pg_get_functiondef('public.get_public_online_order_by_code(text,text)'::regprocedure);
  if strpos(definition, '''artist_slug'', a.slug, ''artist_name'', a.display_name') = 0 then
    raise exception 'Unexpected public campaign order projection';
  end if;
  definition := replace(
    definition,
    '''artist_slug'', a.slug, ''artist_name'', a.display_name',
    '''artist_slug'', a.slug, ''artist_name'', a.display_name, ''artist_seller_type'', a.seller_type'
  );
  execute definition;
end
$migration$;

drop function if exists public.list_public_online_campaigns(text);

create function public.list_public_online_campaigns(
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
  image_url text,
  artist_seller_type text
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
    ) as image_url,
    a.seller_type as artist_seller_type
  from public.online_campaigns c
  join public.artists a on a.id = c.artist_id
  cross join lateral (
    select public.get_public_online_campaign(a.slug, c.slug) as data
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

drop function if exists public.get_public_preorder_by_code(text, text);

create function public.get_public_preorder_by_code(p_artist_slug text, p_pickup_code text)
returns table (
  order_id uuid, event_id uuid, event_name text, artist_name text, order_type text,
  shipping_address text, tracking_number text, shipping_carrier text, shipped_at timestamptz,
  artist_facebook_url text, status text, pickup_status text, pickup_code text,
  customer_name text, customer_email_masked text, total_price numeric,
  subtotal_price numeric, discount_total numeric, pricing_breakdown jsonb,
  currency text, pickup_instructions text, payment_status text, slip_url text,
  submitted_at timestamptz, confirmed_at timestamptz, rejected_at timestamptz,
  review_note text, payment_methods jsonb, payment_deadline_at timestamptz,
  created_at timestamptz, picked_up_at timestamptz, items jsonb,
  artist_seller_type text
)
language plpgsql
security definer
set search_path = ''
as $$
declare v_order_id uuid;
begin
  select o.id into v_order_id from public.orders o
  join public.events e on e.id = o.event_id join public.artists a on a.id = e.artist_id
  where a.slug = lower(trim(p_artist_slug)) and o.pickup_code = upper(trim(p_pickup_code))
    and o.order_type in ('preorder', 'post_event') order by o.created_at desc limit 1;
  if v_order_id is not null then perform private.expire_preorder_stock_hold(v_order_id); end if;

  return query select
    result.order_id, result.event_id, result.event_name, result.artist_name, result.order_type,
    result.shipping_address, result.tracking_number, result.shipping_carrier, result.shipped_at,
    result.artist_facebook_url, result.status, result.pickup_status, result.pickup_code,
    result.customer_name, result.customer_email_masked, result.total_price,
    o.subtotal_price, o.discount_total, o.pricing_breakdown,
    result.currency, result.pickup_instructions, result.payment_status, result.slip_url,
    result.submitted_at, result.confirmed_at, result.rejected_at, result.review_note,
    result.payment_methods,
    case when result.order_type in ('preorder', 'post_event') and result.payment_status = 'awaiting_payment'
      then op.stock_hold_expires_at else result.payment_deadline_at end,
    result.created_at, result.picked_up_at,
    coalesce((select jsonb_agg(jsonb_build_object(
      'product_id', oi.product_id, 'name', coalesce(oi.product_name_snapshot, p.name),
      'quantity', oi.quantity, 'price_per_unit', oi.price_per_unit, 'currency', oi.currency,
      'line_type', oi.line_type, 'promotion_name', promo.name
    ) order by oi.id) from public.order_items oi
      join public.products p on p.id = oi.product_id
      left join public.artist_promotions promo on promo.id = oi.promotion_id
      where oi.order_id = result.order_id), '[]'::jsonb),
    a.seller_type
  from private.get_public_preorder_by_code_base(p_artist_slug, p_pickup_code) result
  join public.orders o on o.id = result.order_id
  join public.events e on e.id = result.event_id
  join public.artists a on a.id = e.artist_id
  left join public.order_payments op on op.order_id = result.order_id;
end;
$$;

revoke all on function public.get_public_preorder_by_code(text, text) from public;
grant execute on function public.get_public_preorder_by_code(text, text) to anon, authenticated;

drop function if exists public.get_public_order_receipt(uuid, text);

create function public.get_public_order_receipt(p_order_id uuid, p_pickup_code text)
returns table (
  status text,
  pickup_status text,
  pickup_code text,
  customer_name text,
  total_price numeric,
  currency text,
  pickup_instructions text,
  payment_status text,
  slip_url text,
  payment_methods jsonb,
  payment_deadline_at timestamptz,
  artist_seller_type text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    o.status,
    o.pickup_status,
    o.pickup_code,
    o.customer_name,
    o.total_price,
    o.currency,
    coalesce(e.preorder_pickup_instructions, ''),
    coalesce(op.payment_status, 'awaiting_payment'),
    op.slip_url,
    coalesce((
      select jsonb_agg(to_jsonb(epm) - 'artist_id' - 'created_at' - 'updated_at')
      from public.event_payment_methods epm
      where epm.event_id = o.event_id
        and epm.is_enabled = true
    ), '[]'::jsonb),
    (
      select min(epm.payment_deadline_at)
      from public.event_payment_methods epm
      where epm.event_id = o.event_id
        and epm.is_enabled = true
        and epm.payment_deadline_at is not null
    ),
    a.seller_type
  from public.orders o
  join public.events e on e.id = o.event_id
  join public.artists a on a.id = e.artist_id
  left join public.order_payments op on op.order_id = o.id
  where o.id = p_order_id
    and o.pickup_code = upper(trim(p_pickup_code))
    and o.order_type = 'preorder'
  limit 1;
end;
$$;

revoke all on function public.get_public_order_receipt(uuid, text) from public;
grant execute on function public.get_public_order_receipt(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
