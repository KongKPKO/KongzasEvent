alter table public.artist_promotions
  add column if not exists event_scope text not null default 'all',
  add column if not exists event_ids uuid[],
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz;

update public.artist_promotions
set event_scope = coalesce(event_scope, 'all')
where event_scope is null;

alter table public.artist_promotions
  drop constraint if exists artist_promotions_event_scope_check;

alter table public.artist_promotions
  add constraint artist_promotions_event_scope_check check (
    (
      event_scope = 'all'
      and (event_ids is null or array_length(event_ids, 1) is null)
    )
    or (
      event_scope = 'selected'
      and event_ids is not null
      and array_length(event_ids, 1) > 0
    )
  );

alter table public.artist_promotions
  drop constraint if exists artist_promotions_active_window_check;

alter table public.artist_promotions
  add constraint artist_promotions_active_window_check check (
    starts_at is null
    or ends_at is null
    or starts_at < ends_at
  );

create index if not exists idx_artist_promotions_event_ids_gin
  on public.artist_promotions using gin (event_ids);

create index if not exists idx_artist_promotions_active_window
  on public.artist_promotions (artist_id, status, starts_at, ends_at);

drop policy if exists "artist_promotions_public_read_active" on public.artist_promotions;

create policy "artist_promotions_public_read_active"
  on public.artist_promotions
  for select
  to anon, authenticated
  using (
    status = 'active'
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
  );

create or replace function public.list_active_promotions(
  p_artist_id uuid,
  p_event_id uuid default null
)
returns table (
  id uuid,
  artist_id uuid,
  name text,
  target_type text,
  rule_type text,
  match_category text,
  match_tag text,
  match_product_id uuid,
  match_product_ids uuid[],
  buy_quantity integer,
  reward_value numeric,
  reward_quantity integer,
  priority integer,
  status text,
  event_scope text,
  event_ids uuid[],
  starts_at timestamptz,
  ends_at timestamptz
)
language sql
security invoker
set search_path = public
as $$
  select
    ap.id,
    ap.artist_id,
    ap.name,
    ap.target_type,
    ap.rule_type,
    ap.match_category,
    ap.match_tag,
    ap.match_product_id,
    ap.match_product_ids,
    ap.buy_quantity,
    ap.reward_value,
    ap.reward_quantity,
    ap.priority,
    ap.status,
    ap.event_scope,
    ap.event_ids,
    ap.starts_at,
    ap.ends_at
  from public.artist_promotions ap
  where ap.artist_id = p_artist_id
    and ap.status = 'active'
    and (ap.starts_at is null or ap.starts_at <= now())
    and (ap.ends_at is null or ap.ends_at >= now())
    and (
      ap.event_scope = 'all'
      or (
        p_event_id is not null
        and ap.event_scope = 'selected'
        and ap.event_ids @> array[p_event_id]
      )
    )
  order by ap.priority asc, ap.created_at desc;
$$;

grant execute on function public.list_active_promotions(uuid, uuid) to anon, authenticated;

create or replace function public.get_promotion_analytics(p_artist_id uuid)
returns table (
  rule_id uuid,
  order_count bigint,
  bundle_count bigint,
  discount_total numeric,
  last_used_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with promotion_lines as (
    select
      nullif(line.value ->> 'ruleId', '')::uuid as rule_id,
      o.id as order_id,
      greatest(coalesce((line.value ->> 'bundleCount')::numeric, 1), 1)::bigint as bundle_count,
      greatest(coalesce((line.value ->> 'discountAmount')::numeric, 0), 0) as discount_amount,
      o.created_at
    from public.orders o
    join public.events e on e.id = o.event_id
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(coalesce(o.pricing_breakdown, '[]'::jsonb)) = 'array'
          then coalesce(o.pricing_breakdown, '[]'::jsonb)
        else '[]'::jsonb
      end
    ) as line(value)
    where e.artist_id = p_artist_id
      and o.status = 'completed'
  )
  select
    promotion_lines.rule_id,
    count(distinct promotion_lines.order_id) as order_count,
    coalesce(sum(promotion_lines.bundle_count), 0)::bigint as bundle_count,
    coalesce(sum(promotion_lines.discount_amount), 0) as discount_total,
    max(promotion_lines.created_at) as last_used_at
  from promotion_lines
  where promotion_lines.rule_id is not null
    and exists (
      select 1
      from public.artist_promotions ap
      where ap.id = promotion_lines.rule_id
        and ap.artist_id = p_artist_id
    )
    and public.has_artist_role(p_artist_id, array['owner', 'manager'])
  group by promotion_lines.rule_id;
$$;

revoke all on function public.get_promotion_analytics(uuid) from public;
grant execute on function public.get_promotion_analytics(uuid) to authenticated;
