alter table public.orders
  add column if not exists subtotal_price numeric not null default 0,
  add column if not exists discount_total numeric not null default 0,
  add column if not exists pricing_breakdown jsonb not null default '[]'::jsonb;

update public.orders
set subtotal_price = coalesce(total_price, 0),
    discount_total = 0,
    pricing_breakdown = '[]'::jsonb
where subtotal_price is null
   or discount_total is null
   or pricing_breakdown is null;

create table if not exists public.artist_promotions (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  name text,
  target_type text not null check (target_type in ('category', 'tag', 'category_tag', 'product')),
  rule_type text not null check (rule_type in ('discount', 'free_items')),
  match_category text,
  match_tag text,
  match_product_id uuid references public.products(id) on delete cascade,
  buy_quantity integer not null check (buy_quantity > 0),
  reward_value numeric,
  reward_quantity integer,
  priority integer not null default 100,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artist_promotions_target_fields_check check (
    (target_type = 'category' and match_category is not null and match_tag is null and match_product_id is null)
    or (target_type = 'tag' and match_tag is not null and match_category is null and match_product_id is null)
    or (target_type = 'category_tag' and match_category is not null and match_tag is not null and match_product_id is null)
    or (target_type = 'product' and match_product_id is not null and match_category is null and match_tag is null)
  ),
  constraint artist_promotions_reward_fields_check check (
    (rule_type = 'discount' and reward_value is not null and reward_value > 0 and reward_quantity is null)
    or (rule_type = 'free_items' and reward_quantity is not null and reward_quantity > 0 and reward_value is null)
  )
);

create index if not exists idx_artist_promotions_artist_status_priority
  on public.artist_promotions (artist_id, status, priority, created_at desc);

create index if not exists idx_artist_promotions_match_product
  on public.artist_promotions (match_product_id)
  where match_product_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_artist_promotions_updated_at'
  ) then
    create trigger trg_artist_promotions_updated_at
      before update on public.artist_promotions
      for each row
      execute function public.set_updated_at_timestamp();
  end if;
end $$;

alter table public.artist_promotions enable row level security;

drop policy if exists "artist_promotions_owner_manage" on public.artist_promotions;
drop policy if exists "artist_promotions_pos_read" on public.artist_promotions;

create policy "artist_promotions_owner_manage"
  on public.artist_promotions
  for all
  to authenticated
  using (public.has_artist_role(artist_id, array['owner']))
  with check (public.has_artist_role(artist_id, array['owner']));

create policy "artist_promotions_pos_read"
  on public.artist_promotions
  for select
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'queue_pos']));

grant select, insert, update, delete on public.artist_promotions to authenticated;

create or replace function public.apply_order_pricing(
  p_order_id uuid,
  p_subtotal_price numeric,
  p_discount_total numeric,
  p_total_price numeric,
  p_pricing_breakdown jsonb default '[]'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
begin
  if coalesce(p_total_price, 0) < 0 or coalesce(p_subtotal_price, 0) < 0 or coalesce(p_discount_total, 0) < 0 then
    raise exception 'invalid_pricing';
  end if;

  select o.id, e.artist_id
  into v_order
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  if not public.has_artist_role(v_order.artist_id, array['owner', 'queue_pos']) then
    raise exception 'forbidden';
  end if;

  update public.orders
  set subtotal_price = coalesce(p_subtotal_price, 0),
      discount_total = coalesce(p_discount_total, 0),
      total_price = coalesce(p_total_price, 0),
      pricing_breakdown = coalesce(p_pricing_breakdown, '[]'::jsonb)
  where id = p_order_id;

  return true;
end;
$$;

revoke all on function public.apply_order_pricing(uuid, numeric, numeric, numeric, jsonb) from public;
grant execute on function public.apply_order_pricing(uuid, numeric, numeric, numeric, jsonb) to authenticated;
