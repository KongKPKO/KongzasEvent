create table if not exists public.event_appearances (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  character_name text not null,
  series_name text,
  image_url text,
  appearance_date date not null,
  day_label text,
  start_time time without time zone,
  end_time time without time zone,
  note text,
  booth text,
  zone text,
  is_public boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_appearances_character_name_check
    check (char_length(trim(character_name)) between 1 and 120),
  constraint event_appearances_series_name_check
    check (series_name is null or char_length(series_name) <= 160),
  constraint event_appearances_day_label_check
    check (day_label is null or char_length(day_label) <= 40),
  constraint event_appearances_note_check
    check (note is null or char_length(note) <= 1000),
  constraint event_appearances_booth_check
    check (booth is null or char_length(booth) <= 120),
  constraint event_appearances_zone_check
    check (zone is null or char_length(zone) <= 120),
  constraint event_appearances_time_check
    check (end_time is null or start_time is null or end_time > start_time)
);

create index if not exists idx_event_appearances_event_public_date
  on public.event_appearances (event_id, is_public, appearance_date, sort_order, created_at);

create index if not exists idx_event_appearances_artist_date
  on public.event_appearances (artist_id, appearance_date, sort_order, created_at);

create or replace function private.validate_event_appearance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artist_id uuid;
  v_start_date date;
  v_end_date date;
begin
  select
    e.artist_id,
    (e.start_date at time zone coalesce(e.event_timezone, 'Asia/Bangkok'))::date,
    (e.end_date at time zone coalesce(e.event_timezone, 'Asia/Bangkok'))::date
  into v_artist_id, v_start_date, v_end_date
  from public.events e
  where e.id = new.event_id;

  if v_artist_id is null then
    raise exception 'event_not_found';
  end if;

  if new.artist_id <> v_artist_id then
    raise exception 'appearance_artist_must_match_event';
  end if;

  if new.appearance_date < v_start_date or new.appearance_date > v_end_date then
    raise exception 'appearance_date_outside_event';
  end if;

  new.character_name := trim(new.character_name);
  new.series_name := nullif(trim(coalesce(new.series_name, '')), '');
  new.image_url := nullif(trim(coalesce(new.image_url, '')), '');
  new.day_label := nullif(trim(coalesce(new.day_label, '')), '');
  new.note := nullif(trim(coalesce(new.note, '')), '');
  new.booth := nullif(trim(coalesce(new.booth, '')), '');
  new.zone := nullif(trim(coalesce(new.zone, '')), '');
  return new;
end;
$$;

revoke all on function private.validate_event_appearance() from public, anon, authenticated;

drop trigger if exists validate_event_appearance on public.event_appearances;
create trigger validate_event_appearance
  before insert or update on public.event_appearances
  for each row execute function private.validate_event_appearance();

drop trigger if exists set_event_appearances_updated_at on public.event_appearances;
create trigger set_event_appearances_updated_at
  before update on public.event_appearances
  for each row execute function public.set_updated_at_timestamp();

alter table public.event_appearances enable row level security;

create or replace function public.is_public_event_appearance_visible(
  p_event_id uuid,
  p_artist_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.events e
    join public.artists a on a.id = e.artist_id
    where e.id = p_event_id
      and e.artist_id = p_artist_id
      and a.is_public = true
      and a.is_verified = true
      and a.published_at is not null
      and e.status in ('Confirmed', 'Cancelled')
      and e.end_date >= now()
  );
$$;

revoke all on function public.is_public_event_appearance_visible(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_public_event_appearance_visible(uuid, uuid) to anon, authenticated;

drop policy if exists event_appearances_public_read on public.event_appearances;
create policy event_appearances_public_read
  on public.event_appearances
  for select
  to anon, authenticated
  using (
    (
      is_public
      and public.is_public_event_appearance_visible(event_id, artist_id)
    )
    or public.has_artist_role(artist_id, array['owner', 'manager', 'seller', 'queue_staff'])
    or public.is_platform_admin()
  );

drop policy if exists event_appearances_manager_insert on public.event_appearances;
create policy event_appearances_manager_insert
  on public.event_appearances
  for insert
  to authenticated
  with check (
    public.has_artist_role(artist_id, array['owner', 'manager'])
    and exists (
      select 1 from public.events e
      where e.id = event_appearances.event_id
        and e.artist_id = event_appearances.artist_id
    )
  );

drop policy if exists event_appearances_manager_update on public.event_appearances;
create policy event_appearances_manager_update
  on public.event_appearances
  for update
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager']))
  with check (
    public.has_artist_role(artist_id, array['owner', 'manager'])
    and exists (
      select 1 from public.events e
      where e.id = event_appearances.event_id
        and e.artist_id = event_appearances.artist_id
    )
  );

drop policy if exists event_appearances_manager_delete on public.event_appearances;
create policy event_appearances_manager_delete
  on public.event_appearances
  for delete
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager']));

revoke all on table public.event_appearances from public, anon, authenticated;
grant select on table public.event_appearances to anon, authenticated;
grant insert, update, delete on table public.event_appearances to authenticated;
