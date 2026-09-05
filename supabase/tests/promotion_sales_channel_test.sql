begin;

select plan(19);

select has_table('public', 'promotion_assignments', 'promotion assignments exist');
select has_table('public', 'promotion_tiers', 'promotion tiers exist');
select has_table('public', 'promotion_reward_products', 'promotion reward products exist');
select has_column('public', 'artist_promotions', 'promotion_type', 'promotions have an explicit type');
select has_column('public', 'artist_promotions', 'lifecycle_status', 'promotions have a reusable lifecycle');
select has_column('public', 'artist_promotions', 'revision', 'promotions track commercial revisions');
select has_column('public', 'event_products', 'is_sellable', 'event reward-only products are supported');
select has_column('public', 'online_campaign_products', 'is_sellable', 'campaign reward-only products are supported');
select has_column('public', 'order_items', 'line_type', 'order items distinguish rewards');

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_artist uuid := gen_random_uuid();
  v_other_artist uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_campaign uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_other_product uuid := gen_random_uuid();
  v_promotion uuid := gen_random_uuid();
  v_spend_promotion uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, aud, role
  ) values (
    v_owner, 'promotion.owner@nireq.local', 'x', now(), now(), now(),
    '{}', '{}', 'authenticated', 'authenticated'
  );

  insert into public.artists (id, slug, display_name, is_public, is_verified, published_at)
  values
    (v_artist, 'promotion-test-artist', 'Promotion Test Artist', true, true, now()),
    (v_other_artist, 'promotion-other-artist', 'Promotion Other Artist', true, true, now());

  insert into public.artist_members (artist_id, member_email, role, status)
  values (v_artist, 'promotion.owner@nireq.local', 'owner', 'active');

  insert into public.events (id, artist_id, event_name, start_date, end_date)
  values (v_event, v_artist, 'Promotion Event', now() - interval '1 hour', now() + interval '1 day');

  insert into public.online_campaigns (
    id, artist_id, name, slug, opens_at, closes_at, publication_status
  ) values (
    v_campaign, v_artist, 'Promotion Campaign', 'promotion-campaign',
    now() - interval '1 hour', now() + interval '1 day', 'published'
  );

  insert into public.products (
    id, artist_id, name, category, tags, price, currency,
    stock_total, stock_reserved, stock_sold, is_unlimited, status
  ) values
    (v_product, v_artist, 'Gift Postcard', 'Postcard', array['Genshin'], 100, 'THB', 10, 0, 0, false, 'enable'),
    (v_other_product, v_other_artist, 'Other Gift', 'Postcard', array['Other'], 100, 'THB', 10, 0, 0, false, 'enable');

  insert into public.artist_promotions (
    id, artist_id, name, target_type, rule_type, promotion_type,
    buy_quantity, reward_quantity, reward_selection_mode, lifecycle_status
  ) values (
    v_promotion, v_artist, 'Buy 3 get gift', 'all', 'free_items', 'quantity_gift',
    3, 1, 'fixed', 'ready'
  );

  insert into public.artist_promotions (
    id, artist_id, name, target_type, rule_type, promotion_type,
    buy_quantity, reward_quantity, tier_grant_mode, lifecycle_status
  ) values (
    v_spend_promotion, v_artist, 'Spend tiers', 'all', 'free_items', 'spend_tier_gift',
    null, null, 'highest_only', 'ready'
  );

  create temp table _promotion_ids (
    owner_id uuid,
    artist_id uuid,
    other_artist_id uuid,
    event_id uuid,
    campaign_id uuid,
    product_id uuid,
    other_product_id uuid,
    promotion_id uuid,
    spend_promotion_id uuid
  ) on commit drop;

  insert into _promotion_ids values (
    v_owner, v_artist, v_other_artist, v_event, v_campaign,
    v_product, v_other_product, v_promotion, v_spend_promotion
  );
end $$;

select lives_ok(
  $$ insert into public.promotion_assignments
       (promotion_id, artist_id, event_id, event_phase)
     values (
       (select promotion_id from _promotion_ids),
       (select artist_id from _promotion_ids),
       (select event_id from _promotion_ids),
       'preorder'
     ) $$,
  'an Event phase assignment is valid'
);

select lives_ok(
  $$ insert into public.promotion_assignments
       (promotion_id, artist_id, campaign_id)
     values (
       (select promotion_id from _promotion_ids),
       (select artist_id from _promotion_ids),
       (select campaign_id from _promotion_ids)
     ) $$,
  'an Online Campaign assignment is valid'
);

select throws_ok(
  $$ insert into public.promotion_assignments
       (promotion_id, artist_id, event_id, event_phase, campaign_id)
     values (
       (select promotion_id from _promotion_ids),
       (select artist_id from _promotion_ids),
       (select event_id from _promotion_ids),
       'live',
       (select campaign_id from _promotion_ids)
     ) $$,
  '23514',
  null,
  'an assignment cannot target an Event and Campaign together'
);

select throws_ok(
  $$ insert into public.promotion_assignments
       (promotion_id, artist_id, event_id, event_phase)
     values (
       (select promotion_id from _promotion_ids),
       (select other_artist_id from _promotion_ids),
       (select event_id from _promotion_ids),
       'live'
     ) $$,
  'P0001',
  'promotion_assignment_artist_mismatch',
  'assignment ownership cannot cross artists'
);

select lives_ok(
  $$ insert into public.promotion_reward_products (promotion_id, product_id)
     values (
       (select promotion_id from _promotion_ids),
       (select product_id from _promotion_ids)
     ) $$,
  'a reward product from the same artist is valid'
);

select throws_ok(
  $$ insert into public.promotion_reward_products (promotion_id, product_id)
     values (
       (select promotion_id from _promotion_ids),
       (select other_product_id from _promotion_ids)
     ) $$,
  'P0001',
  'promotion_reward_artist_mismatch',
  'reward products cannot cross artists'
);

select is(
  (select revision from public.artist_promotions where id = (select promotion_id from _promotion_ids)),
  1::bigint,
  'new promotions begin at revision one'
);

update public.artist_promotions
set buy_quantity = 4
where id = (select promotion_id from _promotion_ids);

select is(
  (select revision from public.artist_promotions where id = (select promotion_id from _promotion_ids)),
  2::bigint,
  'editing commercial terms increments the revision'
);

select lives_ok(
  $$ insert into public.promotion_tiers (
       promotion_id, threshold_amount, reward_quantity, reward_selection_mode
     ) values (
       (select spend_promotion_id from _promotion_ids), 500, 1, 'fixed'
     ) $$,
  'positive spend tiers are accepted'
);

select throws_ok(
  $$ insert into public.promotion_tiers (
       promotion_id, threshold_amount, reward_quantity, reward_selection_mode
     ) values (
       (select spend_promotion_id from _promotion_ids), 0, 1, 'fixed'
     ) $$,
  '23514',
  null,
  'zero-value spend tiers are rejected'
);

select * from finish();
rollback;
