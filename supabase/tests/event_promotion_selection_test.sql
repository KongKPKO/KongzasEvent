begin;
select no_plan();

select has_function(
  'public',
  'save_event_promotion_selection',
  array['uuid', 'uuid', 'bigint', 'jsonb', 'text'],
  'event promotion selection has a dedicated atomic RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.save_event_promotion_selection(uuid,uuid,bigint,jsonb,text)',
    'execute'
  ),
  'anonymous callers cannot execute the selection RPC'
);

insert into auth.users(id, email, email_confirmed_at) values
  ('e2200000-0000-4000-8000-000000000001', 'event-promo-owner@example.test', now()),
  ('e2200000-0000-4000-8000-000000000002', 'event-promo-manager@example.test', now()),
  ('e2200000-0000-4000-8000-000000000003', 'event-promo-seller@example.test', now()),
  ('e2200000-0000-4000-8000-000000000004', 'event-promo-other@example.test', now());

insert into public.artists(id, slug, display_name) values
  ('e2200000-0000-4000-8000-000000000101', 'event-promo-selection', 'Event promotion selection'),
  ('e2200000-0000-4000-8000-000000000102', 'event-promo-foreign', 'Foreign promotion shop');

insert into public.artist_members(artist_id, member_email, role, status) values
  ('e2200000-0000-4000-8000-000000000101', 'event-promo-owner@example.test', 'owner', 'active'),
  ('e2200000-0000-4000-8000-000000000101', 'event-promo-manager@example.test', 'manager', 'active'),
  ('e2200000-0000-4000-8000-000000000101', 'event-promo-seller@example.test', 'seller', 'active'),
  ('e2200000-0000-4000-8000-000000000102', 'event-promo-other@example.test', 'owner', 'active');

insert into public.events(id, artist_id, event_name, status, start_date, end_date) values
  ('e2200000-0000-4000-8000-000000000201', 'e2200000-0000-4000-8000-000000000101', 'Selected event', 'Confirmed', now() - interval '1 day', now() + interval '2 days'),
  ('e2200000-0000-4000-8000-000000000202', 'e2200000-0000-4000-8000-000000000101', 'Other event', 'Confirmed', now() - interval '1 day', now() + interval '2 days'),
  ('e2200000-0000-4000-8000-000000000203', 'e2200000-0000-4000-8000-000000000102', 'Foreign event', 'Confirmed', now() - interval '1 day', now() + interval '2 days');

insert into public.online_campaigns(id, artist_id, name, slug, opens_at, closes_at) values
  ('e2200000-0000-4000-8000-000000000301', 'e2200000-0000-4000-8000-000000000101', 'Untouched campaign', 'event-promo-campaign', now() - interval '1 day', now() + interval '2 days');

insert into public.products(id, artist_id, name, sku, price, status, is_unlimited) values
  ('e2200000-0000-4000-8000-000000000401', 'e2200000-0000-4000-8000-000000000101', 'Saved reward', 'EVENT-REWARD', 100, 'enable', true),
  ('e2200000-0000-4000-8000-000000000402', 'e2200000-0000-4000-8000-000000000101', 'Unavailable reward', 'EVENT-MISSING', 80, 'enable', true);

insert into public.event_products(event_id, artist_id, product_id, is_enabled, is_sellable, is_unlimited)
values
  ('e2200000-0000-4000-8000-000000000201', 'e2200000-0000-4000-8000-000000000101', 'e2200000-0000-4000-8000-000000000401', true, true, true),
  ('e2200000-0000-4000-8000-000000000202', 'e2200000-0000-4000-8000-000000000101', 'e2200000-0000-4000-8000-000000000401', true, true, true),
  ('e2200000-0000-4000-8000-000000000202', 'e2200000-0000-4000-8000-000000000101', 'e2200000-0000-4000-8000-000000000402', true, true, true);

insert into public.online_campaign_products(campaign_id, artist_id, product_id, is_enabled, is_sellable, is_unlimited)
values ('e2200000-0000-4000-8000-000000000301', 'e2200000-0000-4000-8000-000000000101', 'e2200000-0000-4000-8000-000000000401', true, true, true);

insert into public.artist_promotions(
  id, artist_id, name, target_type, rule_type, promotion_type,
  tier_grant_mode, lifecycle_status
) values (
  'e2200000-0000-4000-8000-000000000501',
  'e2200000-0000-4000-8000-000000000101',
  'Reusable spend reward', 'all', 'free_items', 'spend_tier_gift',
  'highest_only', 'ready'
);
insert into public.artist_promotions(
  id, artist_id, name, target_type, rule_type, promotion_type,
  buy_quantity, reward_value, lifecycle_status
) values
  ('e2200000-0000-4000-8000-000000000502', 'e2200000-0000-4000-8000-000000000101', 'Competing offer', 'all', 'discount', 'quantity_discount', 2, 10, 'ready'),
  ('e2200000-0000-4000-8000-000000000503', 'e2200000-0000-4000-8000-000000000102', 'Foreign offer', 'all', 'discount', 'quantity_discount', 2, 10, 'ready'),
  ('e2200000-0000-4000-8000-000000000504', 'e2200000-0000-4000-8000-000000000101', 'Archived offer', 'all', 'discount', 'quantity_discount', 2, 10, 'archived');
insert into public.artist_promotions(
  id, artist_id, name, target_type, rule_type, promotion_type,
  buy_quantity, reward_quantity, reward_selection_mode, lifecycle_status
) values (
  'e2200000-0000-4000-8000-000000000505',
  'e2200000-0000-4000-8000-000000000101',
  'Unavailable gift offer', 'all', 'free_items', 'quantity_gift',
  1, 1, 'fixed', 'ready'
);

insert into public.promotion_tiers(
  id, promotion_id, threshold_amount, reward_quantity, reward_selection_mode, sort_order
) values (
  'e2200000-0000-4000-8000-000000000601',
  'e2200000-0000-4000-8000-000000000501',
  500, 1, 'fixed', 0
);
insert into public.promotion_reward_products(id, promotion_id, promotion_tier_id, product_id, sort_order) values
  ('e2200000-0000-4000-8000-000000000611', 'e2200000-0000-4000-8000-000000000501', 'e2200000-0000-4000-8000-000000000601', 'e2200000-0000-4000-8000-000000000401', 0),
  ('e2200000-0000-4000-8000-000000000612', 'e2200000-0000-4000-8000-000000000505', null, 'e2200000-0000-4000-8000-000000000402', 0);

insert into public.promotion_assignments(
  id, promotion_id, artist_id, event_id, event_phase,
  starts_at, ends_at, is_paused, combination_policy
) values
  ('e2200000-0000-4000-8000-000000000701', 'e2200000-0000-4000-8000-000000000501', 'e2200000-0000-4000-8000-000000000101', 'e2200000-0000-4000-8000-000000000201', 'live', '2026-10-22T01:00:00Z', '2026-10-22T12:00:00Z', true, 'combine'),
  ('e2200000-0000-4000-8000-000000000702', 'e2200000-0000-4000-8000-000000000501', 'e2200000-0000-4000-8000-000000000101', 'e2200000-0000-4000-8000-000000000202', 'postorder', '2026-10-23T01:00:00Z', '2026-10-23T12:00:00Z', false, 'combine'),
  ('e2200000-0000-4000-8000-000000000704', 'e2200000-0000-4000-8000-000000000502', 'e2200000-0000-4000-8000-000000000101', 'e2200000-0000-4000-8000-000000000201', 'live', null, null, false, 'exclusive');
insert into public.promotion_assignments(
  id, promotion_id, artist_id, campaign_id,
  starts_at, ends_at, is_paused, combination_policy
) values
  ('e2200000-0000-4000-8000-000000000703', 'e2200000-0000-4000-8000-000000000501', 'e2200000-0000-4000-8000-000000000101', 'e2200000-0000-4000-8000-000000000301', '2026-10-24T01:00:00Z', '2026-10-24T12:00:00Z', false, 'exclusive'),
  ('e2200000-0000-4000-8000-000000000705', 'e2200000-0000-4000-8000-000000000502', 'e2200000-0000-4000-8000-000000000101', 'e2200000-0000-4000-8000-000000000301', null, null, false, 'exclusive');

insert into public.orders(
  id, event_id, order_type, status, total_price, subtotal_price,
  discount_total, pricing_breakdown, pickup_code, customer_name, customer_email
) values (
  'e2200000-0000-4000-8000-000000000801',
  'e2200000-0000-4000-8000-000000000201',
  'preorder', 'confirmed', 500, 500, 0,
  '[{"id":"e2200000-0000-4000-8000-000000000501","name":"Reusable spend reward","reached_tier_ids":["e2200000-0000-4000-8000-000000000601"]}]',
  'EVTPROMO', 'Saved buyer', 'saved-buyer@example.test'
);
insert into public.order_items(
  id, order_id, product_id, event_product_id, quantity, price_per_unit,
  notes, currency, product_name_snapshot, sku_snapshot, line_type,
  promotion_id, promotion_assignment_id, promotion_tier_id
) select
  'e2200000-0000-4000-8000-000000000901',
  'e2200000-0000-4000-8000-000000000801',
  'e2200000-0000-4000-8000-000000000401',
  ep.id, 1, 0, 'Saved reward note', 'THB', 'Saved reward snapshot',
  'SAVED-REWARD-SKU', 'promotion_reward',
  'e2200000-0000-4000-8000-000000000501',
  'e2200000-0000-4000-8000-000000000701',
  'e2200000-0000-4000-8000-000000000601'
from public.event_products ep
where ep.event_id = 'e2200000-0000-4000-8000-000000000201'
  and ep.product_id = 'e2200000-0000-4000-8000-000000000401';

create temp table _event_selection_before as
select
  (select revision from public.artist_promotions where id = 'e2200000-0000-4000-8000-000000000501') as revision,
  (select to_jsonb(p) - 'revision' - 'updated_at' - 'updated_by'
   from public.artist_promotions p
   where id = 'e2200000-0000-4000-8000-000000000501') as definition_fields,
  (select to_jsonb(oi) from public.order_items oi where id = 'e2200000-0000-4000-8000-000000000901') as reward_line,
  (select to_jsonb(o) from public.orders o where id = 'e2200000-0000-4000-8000-000000000801') as order_row,
  (select to_jsonb(t) from public.promotion_tiers t where id = 'e2200000-0000-4000-8000-000000000601') as tier_row,
  (select to_jsonb(r) from public.promotion_reward_products r where id = 'e2200000-0000-4000-8000-000000000611') as reward_mapping,
  (select jsonb_agg(to_jsonb(a) order by a.id)
   from public.promotion_assignments a
   where a.promotion_id = 'e2200000-0000-4000-8000-000000000501'
     and (a.event_id = 'e2200000-0000-4000-8000-000000000202'
       or a.campaign_id = 'e2200000-0000-4000-8000-000000000301')) as other_assignments;
grant select on _event_selection_before to authenticated;

create function pg_temp.attempt_event_selection(
  p_event uuid,
  p_promotion uuid,
  p_revision bigint,
  p_selected jsonb,
  p_token text default null
) returns jsonb
language plpgsql
as $$
declare
  detail text;
  saved uuid;
begin
  saved := public.save_event_promotion_selection(
    p_event, p_promotion, p_revision, p_selected, p_token
  );
  return jsonb_build_object('saved', saved);
exception when others then
  get stacked diagnostics detail = pg_exception_detail;
  return jsonb_build_object(
    'message', sqlerrm,
    'details', case when nullif(detail, '') is null then null else detail::jsonb end
  );
end
$$;
grant execute on function pg_temp.attempt_event_selection(uuid, uuid, bigint, jsonb, text) to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"e2200000-0000-4000-8000-000000000001","email":"event-promo-owner@example.test","role":"authenticated"}',
  true
);

create temp table _event_selection_attempt as
select pg_temp.attempt_event_selection(
  'e2200000-0000-4000-8000-000000000201',
  'e2200000-0000-4000-8000-000000000501',
  (select revision from _event_selection_before),
  '[{"event_phase":"live","starts_at":"2026-10-22T02:00:00Z","ends_at":"2026-10-22T11:00:00Z","combination_policy":"combine"}]',
  null
) as result;
grant select on _event_selection_attempt to authenticated;

select is(
  (select result ->> 'message' from _event_selection_attempt),
  'promotion_conflict_confirmation_required',
  'an overlapping Event phase requires confirmation'
);
select ok(
  nullif((select result #>> '{details,confirmation_token}' from _event_selection_attempt), '') is not null
    and jsonb_array_length((select result #> '{details,conflicts}' from _event_selection_attempt)) = 1,
  'the conflict response returns a token and only this Event phase conflict'
);
select is(
  (select is_paused from public.promotion_assignments where id = 'e2200000-0000-4000-8000-000000000701'),
  true,
  'an unconfirmed selection rolls back its assignment change'
);
select is(
  (select revision from public.artist_promotions where id = 'e2200000-0000-4000-8000-000000000501'),
  (select revision from _event_selection_before),
  'an unconfirmed selection does not advance the revision'
);
select is(
  (select pg_temp.attempt_event_selection(
    'e2200000-0000-4000-8000-000000000201',
    'e2200000-0000-4000-8000-000000000501',
    (select revision from _event_selection_before),
    '[{"event_phase":"live","starts_at":"2026-10-22T02:00:00Z","ends_at":"2026-10-22T11:00:00Z","combination_policy":"exclusive"}]',
    (select result #>> '{details,confirmation_token}' from _event_selection_attempt)
  ) ->> 'message'),
  'promotion_conflict_confirmation_required',
  'a confirmation token cannot approve different selection settings'
);
select is(
  public.save_event_promotion_selection(
    'e2200000-0000-4000-8000-000000000201',
    'e2200000-0000-4000-8000-000000000501',
    (select revision from _event_selection_before),
    '[{"event_phase":"live","starts_at":"2026-10-22T02:00:00Z","ends_at":"2026-10-22T11:00:00Z","combination_policy":"combine"}]',
    (select result #>> '{details,confirmation_token}' from _event_selection_attempt)
  ),
  'e2200000-0000-4000-8000-000000000501'::uuid,
  'the owner can confirm the exact Event selection'
);
select results_eq(
  $$ select id, is_paused, starts_at, ends_at, combination_policy
     from public.promotion_assignments
     where promotion_id = 'e2200000-0000-4000-8000-000000000501'
       and event_id = 'e2200000-0000-4000-8000-000000000201'
       and event_phase = 'live' $$,
  $$ values (
       'e2200000-0000-4000-8000-000000000701'::uuid,
       false,
       '2026-10-22T02:00:00Z'::timestamptz,
       '2026-10-22T11:00:00Z'::timestamptz,
       'combine'::text
     ) $$,
  'selection updates the existing phase row without replacing its ID'
);
select is(
  (select jsonb_agg(to_jsonb(a) order by a.id)
   from public.promotion_assignments a
   where a.promotion_id = 'e2200000-0000-4000-8000-000000000501'
     and (a.event_id = 'e2200000-0000-4000-8000-000000000202'
       or a.campaign_id = 'e2200000-0000-4000-8000-000000000301')),
  (select other_assignments from _event_selection_before),
  'other Event and Campaign assignment rows remain byte-for-byte unchanged'
);
select is(
  (select to_jsonb(oi) from public.order_items oi where id = 'e2200000-0000-4000-8000-000000000901'),
  (select reward_line from _event_selection_before),
  'selection keeps every existing reward order-line field unchanged'
);
reset role;
select is(
  (select to_jsonb(o) from public.orders o where id = 'e2200000-0000-4000-8000-000000000801'),
  (select order_row from _event_selection_before),
  'selection keeps the existing order pricing snapshot unchanged'
);
select ok(
  (select to_jsonb(t) from public.promotion_tiers t where id = 'e2200000-0000-4000-8000-000000000601')
    = (select tier_row from _event_selection_before)
  and (select to_jsonb(r) from public.promotion_reward_products r where id = 'e2200000-0000-4000-8000-000000000611')
    = (select reward_mapping from _event_selection_before),
  'assignment-only selection does not rewrite tiers or reward mappings'
);
select is(
  (select to_jsonb(p) - 'revision' - 'updated_at' - 'updated_by'
   from public.artist_promotions p
   where id = 'e2200000-0000-4000-8000-000000000501'),
  (select definition_fields from _event_selection_before),
  'selection changes only definition revision metadata'
);
select is(
  (select revision from public.artist_promotions where id = 'e2200000-0000-4000-8000-000000000501'),
  (select revision + 1 from _event_selection_before),
  'a confirmed selection advances the promotion revision once'
);

set local role authenticated;
select is(
  pg_temp.attempt_event_selection(
    'e2200000-0000-4000-8000-000000000201',
    'e2200000-0000-4000-8000-000000000501',
    (select revision from _event_selection_before),
    '[]', null
  ) ->> 'message',
  'promotion_changed',
  'a stale Event editor cannot overwrite the confirmed selection'
);
select is(
  pg_temp.attempt_event_selection(
    'e2200000-0000-4000-8000-000000000201',
    'e2200000-0000-4000-8000-000000000501',
    null, '[]', null
  ) ->> 'message',
  'promotion_changed',
  'the expected revision is mandatory'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e2200000-0000-4000-8000-000000000002","email":"event-promo-manager@example.test","role":"authenticated"}',
  true
);
select is(
  public.save_event_promotion_selection(
    'e2200000-0000-4000-8000-000000000201',
    'e2200000-0000-4000-8000-000000000501',
    (select revision from public.artist_promotions where id = 'e2200000-0000-4000-8000-000000000501'),
    '[{"event_phase":"preorder","starts_at":null,"ends_at":null,"combination_policy":"exclusive"}]',
    null
  ),
  'e2200000-0000-4000-8000-000000000501'::uuid,
  'an active manager can change this Event selection'
);
select results_eq(
  $$ select event_phase, is_paused
     from public.promotion_assignments
     where promotion_id = 'e2200000-0000-4000-8000-000000000501'
       and event_id = 'e2200000-0000-4000-8000-000000000201'
     order by event_phase $$,
  $$ values ('live'::text, true), ('preorder'::text, false) $$,
  'omitted Event phases are paused while selected phases are active'
);

create temp table _before_empty_selection as
select jsonb_agg(to_jsonb(a) - 'is_paused' - 'updated_at' order by a.event_phase) as stable_fields
from public.promotion_assignments a
where a.promotion_id = 'e2200000-0000-4000-8000-000000000501'
  and a.event_id = 'e2200000-0000-4000-8000-000000000201';
grant select on _before_empty_selection to authenticated;

select set_config(
  'request.jwt.claims',
  '{"sub":"e2200000-0000-4000-8000-000000000001","email":"event-promo-owner@example.test","role":"authenticated"}',
  true
);
select is(
  public.save_event_promotion_selection(
    'e2200000-0000-4000-8000-000000000201',
    'e2200000-0000-4000-8000-000000000501',
    (select revision from public.artist_promotions where id = 'e2200000-0000-4000-8000-000000000501'),
    '[]', null
  ),
  'e2200000-0000-4000-8000-000000000501'::uuid,
  'an empty selection pauses this Event without deleting assignments'
);
select ok(
  (select bool_and(is_paused)
   from public.promotion_assignments
   where promotion_id = 'e2200000-0000-4000-8000-000000000501'
     and event_id = 'e2200000-0000-4000-8000-000000000201'),
  'empty selection pauses every existing phase for this Event'
);
select is(
  (select jsonb_agg(to_jsonb(a) - 'is_paused' - 'updated_at' order by a.event_phase)
   from public.promotion_assignments a
   where a.promotion_id = 'e2200000-0000-4000-8000-000000000501'
     and a.event_id = 'e2200000-0000-4000-8000-000000000201'),
  (select stable_fields from _before_empty_selection),
  'pausing preserves assignment IDs, dates and combination policies'
);
select is(
  (select to_jsonb(oi) from public.order_items oi where id = 'e2200000-0000-4000-8000-000000000901'),
  (select reward_line from _event_selection_before),
  'pausing also leaves the full historical reward line unchanged'
);
select is(
  (select jsonb_agg(to_jsonb(a) order by a.id)
   from public.promotion_assignments a
   where a.promotion_id = 'e2200000-0000-4000-8000-000000000501'
     and (a.event_id = 'e2200000-0000-4000-8000-000000000202'
       or a.campaign_id = 'e2200000-0000-4000-8000-000000000301')),
  (select other_assignments from _event_selection_before),
  'pausing this Event still leaves every other channel unchanged'
);

select is(
  pg_temp.attempt_event_selection(
    'e2200000-0000-4000-8000-000000000201',
    'e2200000-0000-4000-8000-000000000501',
    (select revision from public.artist_promotions where id = 'e2200000-0000-4000-8000-000000000501'),
    '[{"event_phase":"live"},{"event_phase":"live"}]', null
  ) ->> 'message',
  'promotion_assignments_invalid',
  'duplicate phases are rejected'
);
select is(
  pg_temp.attempt_event_selection(
    'e2200000-0000-4000-8000-000000000201',
    'e2200000-0000-4000-8000-000000000501',
    (select revision from public.artist_promotions where id = 'e2200000-0000-4000-8000-000000000501'),
    '[{"event_phase":"live","event_id":"e2200000-0000-4000-8000-000000000202"}]', null
  ) ->> 'message',
  'promotion_assignments_invalid',
  'selection items cannot smuggle another context key'
);
select is(
  pg_temp.attempt_event_selection(
    'e2200000-0000-4000-8000-000000000201',
    'e2200000-0000-4000-8000-000000000501',
    (select revision from public.artist_promotions where id = 'e2200000-0000-4000-8000-000000000501'),
    '[{"event_phase":"postorder","starts_at":"2026-10-22T12:00:00Z","ends_at":"2026-10-22T11:00:00Z","combination_policy":"combine"}]', null
  ) ->> 'message',
  'promotion_assignments_invalid',
  'an invalid phase date window is rejected'
);
select is(
  pg_temp.attempt_event_selection(
    'e2200000-0000-4000-8000-000000000201',
    'e2200000-0000-4000-8000-000000000501',
    (select revision from public.artist_promotions where id = 'e2200000-0000-4000-8000-000000000501'),
    '[{"event_phase":"live"},{"event_phase":"preorder"},{"event_phase":"postorder"},{"event_phase":"live"}]', null
  ) ->> 'message',
  'promotion_assignments_invalid',
  'selection accepts at most the three Event phases'
);

select is(
  pg_temp.attempt_event_selection(
    'e2200000-0000-4000-8000-000000000201',
    'e2200000-0000-4000-8000-000000000503',
    1, '[]', null
  ) ->> 'message',
  'promotion_not_found',
  'a promotion from another shop cannot be assigned to this Event'
);
select is(
  pg_temp.attempt_event_selection(
    'e2200000-0000-4000-8000-000000000201',
    'e2200000-0000-4000-8000-000000000504',
    1, '[]', null
  ) ->> 'message',
  'promotion_not_ready',
  'an archived promotion cannot receive Event selections'
);
select is(
  pg_temp.attempt_event_selection(
    'e2200000-0000-4000-8000-000000000201',
    'e2200000-0000-4000-8000-000000000505',
    1,
    '[{"event_phase":"live","starts_at":null,"ends_at":null,"combination_policy":"exclusive"}]',
    null
  ) ->> 'message',
  'promotion_reward_not_in_channel',
  'a gift must be enabled in the target Event before selection'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e2200000-0000-4000-8000-000000000003","email":"event-promo-seller@example.test","role":"authenticated"}',
  true
);
select is(
  pg_temp.attempt_event_selection(
    'e2200000-0000-4000-8000-000000000201',
    'e2200000-0000-4000-8000-000000000501',
    (select revision from public.artist_promotions where id = 'e2200000-0000-4000-8000-000000000501'),
    '[]', null
  ) ->> 'message',
  'forbidden',
  'a seller cannot change promotion selections'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"e2200000-0000-4000-8000-000000000004","email":"event-promo-other@example.test","role":"authenticated"}',
  true
);
select is(
  pg_temp.attempt_event_selection(
    'e2200000-0000-4000-8000-000000000201',
    'e2200000-0000-4000-8000-000000000501',
    (select revision from public.artist_promotions where id = 'e2200000-0000-4000-8000-000000000501'),
    '[]', null
  ) ->> 'message',
  'forbidden',
  'an owner of another shop cannot change this Event'
);

select * from finish();
rollback;
