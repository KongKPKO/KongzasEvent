-- Online sales campaigns are intentionally separate from physical events.
-- Public checkout and order access are added below as narrowly scoped RPCs.

create extension if not exists pgcrypto;

alter table public.products
  add column if not exists sku text;

create or replace function public.generate_product_sku()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if nullif(trim(coalesce(new.sku, '')), '') is null then
    new.sku := 'NQ-' || upper(substr(md5(gen_random_uuid()::text), 1, 10));
  else
    new.sku := upper(trim(new.sku));
  end if;
  return new;
end;
$$;

update public.products
set sku = 'NQ-' || upper(substr(md5(id::text), 1, 10))
where sku is null or trim(sku) = '';

create unique index if not exists products_artist_sku_unique
  on public.products (artist_id, lower(sku))
  where sku is not null and deleted_at is null;

drop trigger if exists trg_products_generate_sku on public.products;
create trigger trg_products_generate_sku
  before insert or update of sku on public.products
  for each row execute function public.generate_product_sku();

create table if not exists public.online_campaigns (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text not null default '',
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  campaign_timezone text not null default 'Asia/Bangkok',
  currency text not null default 'THB',
  shipping_enabled boolean not null default false,
  flat_shipping_fee numeric not null default 0 check (flat_shipping_fee >= 0),
  pickup_enabled boolean not null default false,
  publication_status text not null default 'draft'
    check (publication_status in ('draft', 'published', 'cancelled', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artist_id, slug),
  check (opens_at < closes_at)
);

create table if not exists public.online_campaign_products (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.online_campaigns(id) on delete cascade,
  product_id uuid not null references public.products(id),
  artist_id uuid not null references public.artists(id) on delete cascade,
  is_enabled boolean not null default true,
  price_override numeric check (price_override is null or price_override >= 0),
  stock_total integer,
  stock_reserved integer not null default 0,
  stock_sold integer not null default 0,
  is_unlimited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, product_id),
  check (
    stock_reserved >= 0
    and stock_sold >= 0
    and (
      (is_unlimited and stock_total is null)
      or (
        not is_unlimited
        and stock_total is not null
        and stock_total >= 0
        and stock_reserved + stock_sold <= stock_total
      )
    )
  )
);

create table if not exists public.campaign_pickup_points (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.online_campaigns(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  address text not null check (length(trim(address)) > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  instructions text,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create table if not exists public.campaign_payment_methods (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.online_campaigns(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  method_type text not null check (method_type in ('promptpay', 'bank_transfer', 'qr_image', 'other')),
  display_name text,
  account_name text,
  account_number text,
  bank_name text,
  promptpay_id text,
  qr_image_url text,
  instructions text,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_online_campaigns_artist_status_window
  on public.online_campaigns (artist_id, publication_status, opens_at, closes_at);
create index if not exists idx_online_campaign_products_campaign_enabled
  on public.online_campaign_products (campaign_id, is_enabled);
create index if not exists idx_campaign_pickup_points_campaign_enabled
  on public.campaign_pickup_points (campaign_id, is_enabled);
create index if not exists idx_campaign_payment_methods_campaign_enabled
  on public.campaign_payment_methods (campaign_id, is_enabled);

drop trigger if exists trg_online_campaigns_updated_at on public.online_campaigns;
create trigger trg_online_campaigns_updated_at
  before update on public.online_campaigns
  for each row execute function public.set_updated_at_timestamp();

drop trigger if exists trg_online_campaign_products_updated_at on public.online_campaign_products;
create trigger trg_online_campaign_products_updated_at
  before update on public.online_campaign_products
  for each row execute function public.set_updated_at_timestamp();

drop trigger if exists trg_campaign_pickup_points_updated_at on public.campaign_pickup_points;
create trigger trg_campaign_pickup_points_updated_at
  before update on public.campaign_pickup_points
  for each row execute function public.set_updated_at_timestamp();

drop trigger if exists trg_campaign_payment_methods_updated_at on public.campaign_payment_methods;
create trigger trg_campaign_payment_methods_updated_at
  before update on public.campaign_payment_methods
  for each row execute function public.set_updated_at_timestamp();

alter table public.orders
  add column if not exists campaign_id uuid references public.online_campaigns(id),
  add column if not exists fulfillment_method text,
  add column if not exists shipping_fee numeric not null default 0,
  add column if not exists pickup_point_id uuid references public.campaign_pickup_points(id) on delete set null,
  add column if not exists pickup_point_snapshot jsonb;

alter table public.orders alter column event_id drop not null;
alter table public.orders drop constraint if exists orders_order_type_check;
alter table public.orders add constraint orders_order_type_check
  check (order_type in ('live_queue', 'pos_walkin', 'preorder', 'post_event', 'online_sale'));
alter table public.orders drop constraint if exists orders_sale_source_check;
alter table public.orders add constraint orders_sale_source_check
  check ((event_id is not null)::integer + (campaign_id is not null)::integer = 1);
alter table public.orders drop constraint if exists orders_fulfillment_method_check;
alter table public.orders add constraint orders_fulfillment_method_check
  check (
    (order_type <> 'online_sale' and fulfillment_method is null)
    or (order_type = 'online_sale' and fulfillment_method in ('shipping', 'pickup'))
  );
alter table public.orders drop constraint if exists orders_shipping_fee_check;
alter table public.orders add constraint orders_shipping_fee_check
  check (shipping_fee >= 0 and (fulfillment_method <> 'pickup' or shipping_fee = 0));

create index if not exists idx_orders_campaign_created
  on public.orders (campaign_id, created_at desc)
  where campaign_id is not null;

alter table public.order_items
  add column if not exists campaign_product_id uuid references public.online_campaign_products(id) on delete set null;
alter table public.order_items drop constraint if exists order_items_sale_product_source_check;
alter table public.order_items add constraint order_items_sale_product_source_check
  check (event_product_id is null or campaign_product_id is null);

create index if not exists idx_order_items_campaign_product
  on public.order_items (campaign_product_id)
  where campaign_product_id is not null;

alter table public.order_payments
  add column if not exists campaign_id uuid references public.online_campaigns(id) on delete cascade,
  add column if not exists evidence_upload_started_at timestamptz,
  add column if not exists upload_grace_expires_at timestamptz,
  add column if not exists late_payment_reported_at timestamptz,
  add column if not exists refunded_at timestamptz,
  add column if not exists refunded_by uuid,
  add column if not exists refund_note text,
  add column if not exists refund_reference text,
  add column if not exists refund_evidence_url text;

alter table public.order_payments alter column event_id drop not null;
alter table public.order_payments drop constraint if exists order_payments_payment_status_check;
alter table public.order_payments add constraint order_payments_payment_status_check
  check (payment_status in (
    'awaiting_payment', 'payment_submitted', 'payment_confirmed',
    'payment_rejected', 'payment_expired', 'payment_cancelled',
    'payment_submitted_late', 'refund_pending', 'refunded'
  ));
alter table public.order_payments drop constraint if exists order_payments_sale_source_check;
alter table public.order_payments add constraint order_payments_sale_source_check
  check ((event_id is not null)::integer + (campaign_id is not null)::integer = 1);
alter table public.order_payments drop constraint if exists order_payments_confirmed_at_check;
alter table public.order_payments add constraint order_payments_confirmed_at_check
  check (
    confirmed_at is null
    or payment_status in ('payment_confirmed', 'refund_pending', 'refunded')
  );
alter table public.order_payments drop constraint if exists order_payments_expired_at_check;
alter table public.order_payments add constraint order_payments_expired_at_check
  check (
    expired_at is null
    or payment_status in (
      'payment_expired', 'payment_submitted_late', 'payment_confirmed',
      'refund_pending', 'refunded'
    )
  );

create index if not exists idx_order_payments_campaign_status
  on public.order_payments (campaign_id, payment_status, submitted_at desc)
  where campaign_id is not null;

alter table public.payment_review_events
  add column if not exists campaign_id uuid references public.online_campaigns(id) on delete cascade;

alter table public.payment_review_events alter column event_id drop not null;
alter table public.payment_review_events drop constraint if exists payment_review_events_event_type_check;
alter table public.payment_review_events add constraint payment_review_events_event_type_check
  check (event_type in (
    'created', 'evidence_submitted', 'evidence_resubmitted',
    'late_evidence_submitted', 'payment_confirmed', 'payment_rejected',
    'payment_expired', 'stock_reserved', 'stock_released',
    'payment_cancelled', 'refund_required', 'refund_completed',
    'order_shipped', 'order_picked_up'
  ));
alter table public.payment_review_events drop constraint if exists payment_review_events_sale_source_check;
alter table public.payment_review_events add constraint payment_review_events_sale_source_check
  check ((event_id is not null)::integer + (campaign_id is not null)::integer = 1);

alter table public.online_campaigns enable row level security;
alter table public.online_campaign_products enable row level security;
alter table public.campaign_pickup_points enable row level security;
alter table public.campaign_payment_methods enable row level security;

create policy online_campaigns_staff_read
  on public.online_campaigns for select to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager', 'seller']));

create policy online_campaigns_manage
  on public.online_campaigns for all to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager']))
  with check (public.has_artist_role(artist_id, array['owner', 'manager']));

create policy online_campaign_products_staff_read
  on public.online_campaign_products for select to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager', 'seller']));

create policy online_campaign_products_manage
  on public.online_campaign_products for all to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager']))
  with check (public.has_artist_role(artist_id, array['owner', 'manager']));

create policy campaign_pickup_points_staff_read
  on public.campaign_pickup_points for select to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager', 'seller']));

create policy campaign_pickup_points_manage
  on public.campaign_pickup_points for all to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager']))
  with check (public.has_artist_role(artist_id, array['owner', 'manager']));

create policy campaign_payment_methods_staff_read
  on public.campaign_payment_methods for select to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager']));

create policy campaign_payment_methods_manage
  on public.campaign_payment_methods for all to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager']))
  with check (public.has_artist_role(artist_id, array['owner', 'manager']));

grant select, insert, update, delete on public.online_campaigns,
  public.online_campaign_products, public.campaign_pickup_points,
  public.campaign_payment_methods to authenticated;

revoke all on public.online_campaigns, public.online_campaign_products,
  public.campaign_pickup_points, public.campaign_payment_methods from anon;
