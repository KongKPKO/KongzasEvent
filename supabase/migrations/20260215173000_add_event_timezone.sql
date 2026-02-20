alter table public.events
  add column if not exists event_timezone text;

alter table public.events
  alter column event_timezone set default 'Asia/Bangkok';

update public.events
set event_timezone = 'Asia/Bangkok'
where coalesce(btrim(event_timezone), '') = '';
