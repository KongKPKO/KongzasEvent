alter table public.artist_promotions
  add column if not exists promotion_type text,
  add column if not exists lifecycle_status text not null default 'ready',
  add column if not exists tier_grant_mode text,
  add column if not exists reward_selection_mode text,
  add column if not exists revision bigint not null default 1,
  add column if not exists updated_by uuid references auth.users(id);

update public.artist_promotions
set promotion_type = case rule_type
  when 'discount' then 'quantity_discount'
  else 'legacy_free_eligible_items'
end
where promotion_type is null;

alter table public.artist_promotions
  alter column promotion_type set not null,
  alter column buy_quantity drop not null;

alter table public.artist_promotions
  drop constraint if exists artist_promotions_target_type_check,
  drop constraint if exists artist_promotions_target_fields_check,
  drop constraint if exists artist_promotions_reward_fields_check,
  drop constraint if exists artist_promotions_promotion_type_check,
  drop constraint if exists artist_promotions_lifecycle_status_check,
  drop constraint if exists artist_promotions_tier_grant_mode_check,
  drop constraint if exists artist_promotions_reward_selection_mode_check;

alter table public.artist_promotions
  add constraint artist_promotions_target_type_check check (
    target_type in ('all', 'category', 'tag', 'category_tag', 'product')
  ),
  add constraint artist_promotions_target_fields_check check (
    (target_type = 'all' and match_category is null and match_tag is null
      and match_product_id is null and coalesce(cardinality(match_product_ids), 0) = 0)
    or (target_type = 'category' and match_category is not null and match_tag is null
      and match_product_id is null and coalesce(cardinality(match_product_ids), 0) = 0)
    or (target_type = 'tag' and match_tag is not null and match_category is null
      and match_product_id is null and coalesce(cardinality(match_product_ids), 0) = 0)
    or (target_type = 'category_tag' and match_category is not null and match_tag is not null
      and match_product_id is null and coalesce(cardinality(match_product_ids), 0) = 0)
    or (target_type = 'product' and match_category is null and match_tag is null
      and (match_product_id is not null or coalesce(cardinality(match_product_ids), 0) > 0))
  ),
  add constraint artist_promotions_promotion_type_check check (
    promotion_type in (
      'quantity_discount',
      'quantity_gift',
      'spend_tier_gift',
      'legacy_free_eligible_items'
    )
  ),
  add constraint artist_promotions_lifecycle_status_check check (
    lifecycle_status in ('draft', 'ready', 'archived')
  ),
  add constraint artist_promotions_tier_grant_mode_check check (
    tier_grant_mode is null or tier_grant_mode in ('highest_only', 'cumulative')
  ),
  add constraint artist_promotions_reward_selection_mode_check check (
    reward_selection_mode is null or reward_selection_mode in ('fixed', 'customer_choice')
  ),
  add constraint artist_promotions_reward_fields_check check (
    (
      promotion_type = 'quantity_discount'
      and buy_quantity > 0
      and reward_value > 0
      and reward_quantity is null
      and tier_grant_mode is null
      and reward_selection_mode is null
    )
    or (
      promotion_type in ('quantity_gift', 'legacy_free_eligible_items')
      and buy_quantity > 0
      and reward_value is null
      and reward_quantity > 0
      and tier_grant_mode is null
      and (
        promotion_type = 'legacy_free_eligible_items'
        or reward_selection_mode in ('fixed', 'customer_choice')
      )
    )
    or (
      promotion_type = 'spend_tier_gift'
      and buy_quantity is null
      and reward_value is null
      and reward_quantity is null
      and tier_grant_mode in ('highest_only', 'cumulative')
      and reward_selection_mode is null
    )
  );

create table if not exists public.promotion_assignments (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.artist_promotions(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  event_phase text,
  campaign_id uuid references public.online_campaigns(id) on delete cascade,
  starts_at timestamptz,
  ends_at timestamptz,
  is_paused boolean not null default false,
  combination_policy text not null default 'exclusive',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promotion_assignments_window_check check (
    starts_at is null or ends_at is null or starts_at < ends_at
  ),
  constraint promotion_assignments_combination_policy_check check (
    combination_policy in ('combine', 'exclusive')
  ),
  constraint promotion_assignments_context_check check (
    (
      event_id is not null
      and campaign_id is null
      and event_phase in ('preorder', 'live', 'postorder')
    )
    or (
      event_id is null
      and campaign_id is not null
      and event_phase is null
    )
  )
);

create unique index if not exists promotion_assignments_event_unique
  on public.promotion_assignments (promotion_id, event_id, event_phase)
  where event_id is not null;

create unique index if not exists promotion_assignments_campaign_unique
  on public.promotion_assignments (promotion_id, campaign_id)
  where campaign_id is not null;

create index if not exists promotion_assignments_event_active_idx
  on public.promotion_assignments (event_id, event_phase, is_paused, starts_at, ends_at)
  where event_id is not null;

create index if not exists promotion_assignments_campaign_active_idx
  on public.promotion_assignments (campaign_id, is_paused, starts_at, ends_at)
  where campaign_id is not null;

create table if not exists public.promotion_tiers (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.artist_promotions(id) on delete cascade,
  threshold_amount numeric not null check (threshold_amount > 0),
  reward_quantity integer not null check (reward_quantity > 0),
  reward_selection_mode text not null check (
    reward_selection_mode in ('fixed', 'customer_choice')
  ),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (promotion_id, threshold_amount)
);

create table if not exists public.promotion_reward_products (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.artist_promotions(id) on delete cascade,
  promotion_tier_id uuid references public.promotion_tiers(id) on delete cascade,
  product_id uuid not null references public.products(id),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists promotion_reward_products_unique
  on public.promotion_reward_products (
    promotion_id,
    coalesce(promotion_tier_id, '00000000-0000-0000-0000-000000000000'::uuid),
    product_id
  );

alter table public.event_products
  add column if not exists is_sellable boolean not null default true;

alter table public.online_campaign_products
  add column if not exists is_sellable boolean not null default true;

alter table public.order_items
  add column if not exists line_type text not null default 'purchase',
  add column if not exists promotion_id uuid references public.artist_promotions(id),
  add column if not exists promotion_assignment_id uuid references public.promotion_assignments(id),
  add column if not exists promotion_tier_id uuid references public.promotion_tiers(id);

alter table public.order_items
  drop constraint if exists order_items_line_type_check,
  add constraint order_items_line_type_check check (
    (
      line_type = 'purchase'
      and promotion_id is null
      and promotion_assignment_id is null
      and promotion_tier_id is null
    )
    or (
      line_type = 'promotion_reward'
      and promotion_id is not null
      and promotion_assignment_id is not null
      and price_per_unit = 0
    )
  );

create or replace function private.validate_promotion_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_promotion_artist_id uuid;
  v_context_artist_id uuid;
begin
  select artist_id
  into v_promotion_artist_id
  from public.artist_promotions
  where id = new.promotion_id;

  if v_promotion_artist_id is null then
    raise exception 'promotion_not_found';
  end if;

  if new.artist_id is distinct from v_promotion_artist_id then
    raise exception 'promotion_assignment_artist_mismatch';
  end if;

  if new.event_id is not null then
    select artist_id into v_context_artist_id
    from public.events
    where id = new.event_id;
  else
    select artist_id into v_context_artist_id
    from public.online_campaigns
    where id = new.campaign_id;
  end if;

  if v_context_artist_id is null then
    raise exception 'promotion_assignment_context_not_found';
  end if;

  if v_context_artist_id is distinct from v_promotion_artist_id then
    raise exception 'promotion_assignment_artist_mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_promotion_assignment on public.promotion_assignments;
create trigger trg_validate_promotion_assignment
  before insert or update on public.promotion_assignments
  for each row execute function private.validate_promotion_assignment();

create or replace function private.validate_promotion_tier()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.artist_promotions ap
    where ap.id = new.promotion_id
      and ap.promotion_type = 'spend_tier_gift'
  ) then
    raise exception 'promotion_tier_requires_spend_tier_gift';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_promotion_tier on public.promotion_tiers;
create trigger trg_validate_promotion_tier
  before insert or update on public.promotion_tiers
  for each row execute function private.validate_promotion_tier();

create or replace function private.validate_promotion_reward_product()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_promotion_artist_id uuid;
  v_product_artist_id uuid;
begin
  select artist_id into v_promotion_artist_id
  from public.artist_promotions
  where id = new.promotion_id;

  select artist_id into v_product_artist_id
  from public.products
  where id = new.product_id
    and deleted_at is null;

  if v_promotion_artist_id is null or v_product_artist_id is null then
    raise exception 'promotion_reward_not_found';
  end if;

  if v_promotion_artist_id is distinct from v_product_artist_id then
    raise exception 'promotion_reward_artist_mismatch';
  end if;

  if new.promotion_tier_id is not null and not exists (
    select 1
    from public.promotion_tiers pt
    where pt.id = new.promotion_tier_id
      and pt.promotion_id = new.promotion_id
  ) then
    raise exception 'promotion_reward_tier_mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_promotion_reward_product on public.promotion_reward_products;
create trigger trg_validate_promotion_reward_product
  before insert or update on public.promotion_reward_products
  for each row execute function private.validate_promotion_reward_product();

create or replace function private.bump_promotion_revision()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if row(
    new.name,
    new.promotion_type,
    new.target_type,
    new.match_category,
    new.match_tag,
    new.match_product_id,
    new.match_product_ids,
    new.buy_quantity,
    new.reward_value,
    new.reward_quantity,
    new.tier_grant_mode,
    new.reward_selection_mode,
    new.lifecycle_status
  ) is distinct from row(
    old.name,
    old.promotion_type,
    old.target_type,
    old.match_category,
    old.match_tag,
    old.match_product_id,
    old.match_product_ids,
    old.buy_quantity,
    old.reward_value,
    old.reward_quantity,
    old.tier_grant_mode,
    old.reward_selection_mode,
    old.lifecycle_status
  ) then
    new.revision := old.revision + 1;
    new.updated_by := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_artist_promotions_revision on public.artist_promotions;
create trigger trg_artist_promotions_revision
  before update on public.artist_promotions
  for each row execute function private.bump_promotion_revision();

drop trigger if exists trg_promotion_assignments_updated_at on public.promotion_assignments;
create trigger trg_promotion_assignments_updated_at
  before update on public.promotion_assignments
  for each row execute function public.set_updated_at_timestamp();

drop trigger if exists trg_promotion_tiers_updated_at on public.promotion_tiers;
create trigger trg_promotion_tiers_updated_at
  before update on public.promotion_tiers
  for each row execute function public.set_updated_at_timestamp();

alter table public.promotion_assignments enable row level security;
alter table public.promotion_tiers enable row level security;
alter table public.promotion_reward_products enable row level security;

create policy promotion_assignments_manage
  on public.promotion_assignments
  for all
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager']))
  with check (public.has_artist_role(artist_id, array['owner', 'manager']));

create policy promotion_assignments_staff_read
  on public.promotion_assignments
  for select
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager', 'seller']));

create policy promotion_tiers_manage
  on public.promotion_tiers
  for all
  to authenticated
  using (
    exists (
      select 1 from public.artist_promotions ap
      where ap.id = promotion_tiers.promotion_id
        and public.has_artist_role(ap.artist_id, array['owner', 'manager'])
    )
  )
  with check (
    exists (
      select 1 from public.artist_promotions ap
      where ap.id = promotion_tiers.promotion_id
        and public.has_artist_role(ap.artist_id, array['owner', 'manager'])
    )
  );

create policy promotion_reward_products_manage
  on public.promotion_reward_products
  for all
  to authenticated
  using (
    exists (
      select 1 from public.artist_promotions ap
      where ap.id = promotion_reward_products.promotion_id
        and public.has_artist_role(ap.artist_id, array['owner', 'manager'])
    )
  )
  with check (
    exists (
      select 1 from public.artist_promotions ap
      where ap.id = promotion_reward_products.promotion_id
        and public.has_artist_role(ap.artist_id, array['owner', 'manager'])
    )
  );

grant select, insert, update, delete on public.promotion_assignments to authenticated;
grant select, insert, update, delete on public.promotion_tiers to authenticated;
grant select, insert, update, delete on public.promotion_reward_products to authenticated;

insert into public.promotion_assignments (
  promotion_id,
  artist_id,
  event_id,
  event_phase,
  starts_at,
  ends_at,
  is_paused,
  combination_policy
)
select
  ap.id,
  ap.artist_id,
  e.id,
  phase.event_phase,
  ap.starts_at,
  ap.ends_at,
  ap.status <> 'active',
  'exclusive'
from public.artist_promotions ap
join public.events e
  on e.artist_id = ap.artist_id
cross join (
  values ('preorder'::text), ('live'::text), ('postorder'::text)
) phase(event_phase)
where (
    ap.event_scope = 'all'
    or ap.event_ids @> array[e.id]::uuid[]
  )
  and not coalesce(ap.excluded_event_ids @> array[e.id]::uuid[], false)
on conflict do nothing;

drop policy if exists event_products_public_read on public.event_products;
create policy event_products_public_read
  on public.event_products
  for select
  to anon, authenticated
  using (
    is_enabled = true
    and is_sellable = true
    and exists (
      select 1
      from public.events e
      join public.artists a on a.id = e.artist_id
      where e.id = event_products.event_id
        and e.artist_id = event_products.artist_id
        and e.status in ('Confirmed', 'Cancelled')
        and e.end_date >= now()
        and a.is_public = true
        and a.is_verified = true
        and a.published_at is not null
    )
  );
