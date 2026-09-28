begin;

select no_plan();

select has_function('public', 'list_public_online_campaigns', array['text']);

insert into public.artists (
  id, slug, display_name, image_url, is_public, is_verified, published_at
) values
  ('d1000000-0000-4000-8000-000000000001', 'discovery-visible', 'Discovery Visible', 'https://example.test/artist.jpg', true, true, now()),
  ('d1000000-0000-4000-8000-000000000002', 'discovery-suspended', 'Discovery Suspended', null, true, true, now()),
  ('d1000000-0000-4000-8000-000000000003', 'discovery-private', 'Discovery Private', null, false, true, now()),
  ('d1000000-0000-4000-8000-000000000004', 'discovery-unverified', 'Discovery Unverified', null, true, false, now()),
  ('d1000000-0000-4000-8000-000000000005', 'discovery-unpublished', 'Discovery Unpublished', null, true, true, null);

insert into public.products (
  id, artist_id, name, image_url, price, currency, stock_total,
  stock_reserved, stock_sold, is_unlimited, status
) values
  (
  'd2000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000001',
  'Blank First Product',
  null,
  50, 'THB', 1, 0, 0, false, 'enable'
  ), (
  'd2000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'Discovery Product',
  'https://example.test/product.jpg',
  100, 'THB', 4, 0, 0, false, 'enable'
);

insert into public.online_campaigns (
  id, artist_id, name, slug, opens_at, closes_at, publication_status
) values
  ('d3000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'Open Store', 'open-store', now() - interval '1 hour', now() + interval '1 day', 'published'),
  ('d3000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', 'Scheduled Store', 'scheduled-store', now() + interval '1 day', now() + interval '2 days', 'published'),
  ('d3000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000001', 'Sold Out Store', 'sold-out-store', now() - interval '1 hour', now() + interval '1 day', 'published'),
  ('d3000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000001', 'Closed Store', 'closed-store', now() - interval '2 days', now() - interval '1 day', 'published'),
  ('d3000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000001', 'Draft Store', 'draft-store', now() - interval '1 hour', now() + interval '1 day', 'draft'),
  ('d3000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000001', 'Cancelled Store', 'cancelled-store', now() - interval '1 hour', now() + interval '1 day', 'cancelled'),
  ('d3000000-0000-4000-8000-000000000007', 'd1000000-0000-4000-8000-000000000001', 'Archived Store', 'archived-store', now() - interval '1 hour', now() + interval '1 day', 'archived'),
  ('d3000000-0000-4000-8000-000000000008', 'd1000000-0000-4000-8000-000000000002', 'Suspended Store', 'suspended-store', now() + interval '1 day', now() + interval '2 days', 'published'),
  ('d3000000-0000-4000-8000-000000000009', 'd1000000-0000-4000-8000-000000000003', 'Private Store', 'private-store', now() + interval '1 day', now() + interval '2 days', 'published'),
  ('d3000000-0000-4000-8000-000000000010', 'd1000000-0000-4000-8000-000000000004', 'Unverified Store', 'unverified-store', now() + interval '1 day', now() + interval '2 days', 'published'),
  ('d3000000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000005', 'Unpublished Store', 'unpublished-store', now() + interval '1 day', now() + interval '2 days', 'published');

insert into public.online_campaign_products (
  campaign_id, product_id, artist_id, stock_total,
  stock_reserved, stock_sold, is_unlimited, is_enabled
) values
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', 1, 0, 0, false, true),
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 3, 0, 0, false, true),
  ('d3000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 1, 0, 1, false, true);

insert into private.store_restrictions (artist_id, suspended)
values ('d1000000-0000-4000-8000-000000000002', true);

set local role anon;

select ok(
  has_function_privilege('anon', 'public.list_public_online_campaigns(text)', 'execute'),
  'anonymous visitors can list discoverable campaigns'
);

select results_eq(
  $$ select slug from public.list_public_online_campaigns() $$,
  $$ values ('open-store'::text), ('scheduled-store'::text), ('sold-out-store'::text) $$,
  'discovery includes public campaigns in open, scheduled, then sold-out order'
);

select results_eq(
  $$ select slug, state from public.list_public_online_campaigns() order by slug $$,
  $$ values
       ('open-store'::text, 'open'::text),
       ('scheduled-store'::text, 'scheduled'::text),
       ('sold-out-store'::text, 'sold_out'::text) $$,
  'discovery reuses storefront state derivation'
);

select is(
  (select image_url from public.list_public_online_campaigns() where slug = 'open-store'),
  'https://example.test/product.jpg',
  'campaign image uses the first storefront product image'
);

select is(
  (select image_url from public.list_public_online_campaigns() where slug = 'scheduled-store'),
  null,
  'campaign without product artwork leaves the image empty'
);

select is(
  (select count(*) from public.list_public_online_campaigns('  DISCOVERY-VISIBLE  ')),
  3::bigint,
  'artist filter is trimmed and case insensitive'
);

select is(
  (select count(*) from public.list_public_online_campaigns('missing-artist')),
  0::bigint,
  'unknown artist has no discoverable campaigns'
);

select is(
  public.get_public_online_campaign('discovery-visible', 'sold-out-store') ->> 'state',
  'sold_out',
  'sold-out campaign remains directly reachable'
);

select is(
  public.get_public_online_campaign('discovery-visible', 'closed-store') ->> 'state',
  'closed',
  'closed campaign remains directly reachable'
);

select is(
  public.get_public_online_campaign('discovery-visible', 'cancelled-store') ->> 'state',
  'cancelled',
  'cancelled campaign remains directly reachable'
);

select is(
  public.get_public_online_campaign('discovery-visible', 'draft-store'),
  null,
  'draft campaign is private even by direct link'
);

select is(
  public.get_public_online_campaign('discovery-visible', 'archived-store'),
  null,
  'archived campaign is hidden even by direct link'
);

select is(
  (select count(*) from public.list_public_online_campaigns('discovery-suspended')),
  0::bigint,
  'suspended shops are absent from discovery'
);

select is(
  (select count(*) from public.list_public_online_campaigns()
   where artist_slug in ('discovery-private', 'discovery-unverified', 'discovery-unpublished')),
  0::bigint,
  'private, unverified, and unpublished shops are absent from discovery'
);

reset role;

select * from finish();

rollback;
