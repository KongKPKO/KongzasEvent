alter table public.artist_promotions
  add column if not exists excluded_event_ids uuid[];

create index if not exists idx_artist_promotions_excluded_event_ids_gin
  on public.artist_promotions using gin (excluded_event_ids);

drop function if exists public.list_active_promotions(uuid, uuid);

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
  excluded_event_ids uuid[],
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
    ap.excluded_event_ids,
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
        and ap.event_ids @> array[p_event_id]::uuid[]
      )
    )
    and (
      p_event_id is null
      or ap.excluded_event_ids is null
      or not (ap.excluded_event_ids @> array[p_event_id]::uuid[])
    )
  order by ap.priority asc, ap.created_at desc;
$$;

grant execute on function public.list_active_promotions(uuid, uuid) to anon, authenticated;
