begin;
select plan(10);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('ea000000-0000-4000-8000-000000000001', 'appearance-owner@nireq.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('ea000000-0000-4000-8000-000000000002', 'appearance-other@nireq.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('ea000000-0000-4000-8000-000000000003', 'appearance-staff@nireq.local', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated');

insert into public.artists (id, slug, display_name, email, is_public, is_verified, published_at)
values
  ('ea000000-0000-4000-8000-000000000001', 'appearance-owner', 'Appearance Owner', 'appearance-owner@nireq.local', true, true, now()),
  ('ea000000-0000-4000-8000-000000000002', 'appearance-other', 'Appearance Other', 'appearance-other@nireq.local', false, true, null);

insert into public.artist_members (artist_id, member_email, role, status)
values ('ea000000-0000-4000-8000-000000000001', 'appearance-staff@nireq.local', 'queue_staff', 'active');

insert into public.events (id, artist_id, event_name, start_date, end_date, event_timezone, status)
values
  ('eb000000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000001', 'Public Cosplay Event', now() + interval '1 day', now() + interval '3 days', 'Asia/Bangkok', 'Confirmed'),
  ('eb000000-0000-4000-8000-000000000002', 'ea000000-0000-4000-8000-000000000002', 'Private Cosplay Event', now() + interval '1 day', now() + interval '3 days', 'Asia/Bangkok', 'Confirmed');

insert into public.event_appearances (
  id, artist_id, event_id, character_name, series_name, appearance_date, day_label,
  start_time, end_time, booth, zone, is_public, sort_order
)
values
  ('ec000000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-000000000001', 'Frieren', 'Frieren', (now() at time zone 'Asia/Bangkok')::date + 2, 'Day 2', '11:00', '14:00', 'A12', 'Creator Hall', true, 0),
  ('ec000000-0000-4000-8000-000000000002', 'ea000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-000000000001', 'Secret Look', null, (now() at time zone 'Asia/Bangkok')::date + 2, null, null, null, null, null, false, 1),
  ('ec000000-0000-4000-8000-000000000003', 'ea000000-0000-4000-8000-000000000002', 'eb000000-0000-4000-8000-000000000002', 'Private Look', null, (now() at time zone 'Asia/Bangkok')::date + 2, null, null, null, null, null, true, 0);

set local role anon;
select results_eq(
  $$ select character_name from public.event_appearances where artist_id in ('ea000000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000002') order by character_name $$,
  $$ values ('Frieren'::text) $$,
  'anonymous visitors only see public appearances from published creators'
);
select throws_ok(
  $$ insert into public.event_appearances (artist_id, event_id, character_name, appearance_date) values ('ea000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-000000000001', 'Anon Look', current_date + 2) $$,
  '42501',
  null,
  'anonymous visitors cannot create appearances'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ea000000-0000-4000-8000-000000000001","email":"appearance-owner@nireq.local"}', true);
select results_eq(
  $$ select character_name from public.event_appearances where artist_id = 'ea000000-0000-4000-8000-000000000001' order by character_name $$,
  $$ values ('Frieren'::text), ('Secret Look'::text) $$,
  'owner sees public and hidden appearances'
);
select lives_ok(
  $$ insert into public.event_appearances (artist_id, event_id, character_name, appearance_date) values ('ea000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-000000000001', 'Fern', (now() at time zone 'Asia/Bangkok')::date + 2) $$,
  'owner can add an appearance to their event'
);
select lives_ok(
  $$ update public.event_appearances set is_public = false where id = 'ec000000-0000-4000-8000-000000000001' $$,
  'owner can hide an appearance'
);
select throws_ok(
  $$ insert into public.event_appearances (artist_id, event_id, character_name, appearance_date) values ('ea000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-000000000002', 'Wrong Creator', (now() at time zone 'Asia/Bangkok')::date + 2) $$,
  'P0001',
  'appearance_artist_must_match_event',
  'owner cannot attach an appearance to another creator event'
);
select throws_ok(
  $$ insert into public.event_appearances (artist_id, event_id, character_name, appearance_date) values ('ea000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-000000000001', 'Too Late', (now() at time zone 'Asia/Bangkok')::date + 10) $$,
  'P0001',
  'appearance_date_outside_event',
  'database rejects dates outside the event'
);
select lives_ok(
  $$ delete from public.event_appearances where character_name = 'Fern' $$,
  'owner can remove an appearance'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ea000000-0000-4000-8000-000000000003","email":"appearance-staff@nireq.local"}', true);
select results_eq(
  $$ select count(*) from public.event_appearances where artist_id = 'ea000000-0000-4000-8000-000000000001' $$,
  $$ values (2::bigint) $$,
  'queue staff can read the full event appearance plan'
);
select is_empty(
  $$ update public.event_appearances set note = 'staff edit' where id = 'ec000000-0000-4000-8000-000000000002' returning id $$,
  'queue staff cannot update appearances'
);
reset role;

select * from finish();
rollback;
