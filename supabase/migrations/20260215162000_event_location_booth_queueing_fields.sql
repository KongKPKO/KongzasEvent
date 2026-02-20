-- Event field redesign:
-- - replace location_name + location_detail with unified location
-- - add booth_detail for event details
-- - add queueing_area for customer calling instruction
alter table public.events
  add column if not exists location text,
  add column if not exists booth_detail text,
  add column if not exists queueing_area text;

-- Backfill unified location from legacy fields for existing rows.
update public.events
set location = concat_ws(', ', nullif(location_name, ''), nullif(location_detail, ''))
where coalesce(btrim(location), '') = ''
  and (coalesce(btrim(location_name), '') <> '' or coalesce(btrim(location_detail), '') <> '');

-- Backfill booth detail from legacy booth_number where available.
update public.events
set booth_detail = booth_number
where coalesce(btrim(booth_detail), '') = ''
  and coalesce(btrim(booth_number), '') <> '';
