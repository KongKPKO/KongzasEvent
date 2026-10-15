import { expect, test, type Page, type Route } from '@playwright/test';

const artistId = '10000000-0000-4000-8000-000000000001';
const preorderEventId = '20000000-0000-4000-8000-000000000001';
const postorderEventId = '20000000-0000-4000-8000-000000000002';
const closedEventId = '20000000-0000-4000-8000-000000000003';
const artistSlug = 'event-card-shop';
const now = Date.now();

const json = (route: Route, body: unknown) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const productFor = (eventId: string) => ({
  id: eventId === preorderEventId
    ? '30000000-0000-4000-8000-000000000001'
    : '30000000-0000-4000-8000-000000000002',
  artist_id: artistId,
  name: eventId === preorderEventId ? 'Preorder-only product' : 'Postorder-only product',
  price: 120,
  image_url: null,
  description: 'Event-scoped product',
  category: 'Event items',
  tags: [],
  status: 'enable',
  currency: 'THB',
  stock_total: 10,
  stock_reserved: 0,
  stock_sold: 0,
  is_unlimited: false,
  event_product_id: eventId === preorderEventId
    ? '40000000-0000-4000-8000-000000000001'
    : '40000000-0000-4000-8000-000000000002',
});

const eventRows = [
  {
    id: preorderEventId,
    artist_id: artistId,
    event_name: 'Future Preorder Event',
    start_date: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    end_date: new Date(now + 48 * 60 * 60 * 1000).toISOString(),
    event_timezone: 'Asia/Bangkok',
    selling_mode: 'live',
    preorder_enabled: true,
    preorder_opens_at: new Date(now - 60 * 60 * 1000).toISOString(),
    preorder_closes_at: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
    postorder_enabled: false,
    postorder_opens_at: null,
    postorder_closes_at: null,
    sales_status_override: 'auto',
    location: 'Preorder Hall',
    booth_detail: 'P01',
    status: 'Confirmed',
    is_booth_open: false,
  },
  {
    id: postorderEventId,
    artist_id: artistId,
    event_name: 'Ended Postorder Event',
    start_date: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
    end_date: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    event_timezone: 'Asia/Bangkok',
    selling_mode: 'live',
    preorder_enabled: false,
    preorder_opens_at: null,
    preorder_closes_at: null,
    postorder_enabled: true,
    postorder_opens_at: new Date(now - 12 * 60 * 60 * 1000).toISOString(),
    postorder_closes_at: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
    sales_status_override: 'auto',
    location: 'Postorder Hall',
    booth_detail: 'Z09',
    status: 'Ended',
    is_booth_open: false,
  },
  {
    id: closedEventId,
    artist_id: artistId,
    event_name: 'Closed Ended Event',
    start_date: new Date(now - 72 * 60 * 60 * 1000).toISOString(),
    end_date: new Date(now - 60 * 60 * 60 * 1000).toISOString(),
    event_timezone: 'Asia/Bangkok',
    selling_mode: 'live',
    preorder_enabled: false,
    preorder_opens_at: null,
    preorder_closes_at: null,
    postorder_enabled: true,
    postorder_opens_at: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
    postorder_closes_at: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    sales_status_override: 'auto',
    location: 'Closed Hall',
    booth_detail: 'C00',
    status: 'Ended',
    is_booth_open: false,
  },
];

const mockCustomerStorefront = async (page: Page) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path.includes('/rest/v1/rpc/list_public_online_campaigns')) {
      return json(route, [{
        id: '50000000-0000-4000-8000-000000000001',
        artist_id: artistId,
        artist_slug: artistSlug,
        slug: 'separate-online-drop',
        name: 'Separate Online Drop',
        description: 'This campaign remains its own sales channel.',
        opens_at: new Date(now - 60 * 60 * 1000).toISOString(),
        closes_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        campaign_timezone: 'Asia/Bangkok',
        state: 'open',
        image_url: null,
      }]);
    }

    if (path.includes('/rest/v1/rpc/get_store_suspension')) return json(route, false);
    if (path.includes('/rest/v1/rpc/list_active_promotions')) return json(route, []);

    if (path.includes('/rest/v1/rpc/list_event_products')) {
      const body = JSON.parse(route.request().postData() || '{}') as { p_event_id?: string };
      return json(route, body.p_event_id ? [productFor(body.p_event_id)] : []);
    }

    if (path.includes('/rest/v1/event_appearances')) return json(route, []);
    if (path.includes('/rest/v1/events')) return json(route, eventRows);

    if (path.includes('/rest/v1/artists')) {
      return json(route, {
        id: artistId,
        slug: artistSlug,
        display_name: 'Event Card Shop',
        bio: 'Event card regression fixture',
        image_url: null,
        broadcast_message: null,
        is_queue_open: true,
        is_public: true,
        published_at: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
        seller_type: 'creator',
      });
    }

    if (path.includes('/realtime/v1')) return route.abort();
    return route.continue();
  });
};

test('event cards open their own preorder and postorder catalogs while online campaigns stay separate', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
  await mockCustomerStorefront(page);
  await page.goto(`/${artistSlug}/home`);

  await expect(page.getByText('Pre-order open', { exact: true })).toBeVisible();
  await expect(page.getByText('Post-order open', { exact: true })).toBeVisible();
  await expect(page.getByText('Closed Ended Event', { exact: true })).toHaveCount(0);

  const campaignLink = page.getByRole('link', { name: /Separate Online Drop/ });
  await expect(campaignLink).toHaveAttribute('href', `/${artistSlug}/campaign/separate-online-drop`);

  const preorderLink = page.getByRole('link', { name: /Future Preorder Event.*Pre-order open/ });
  await expect(preorderLink).toHaveAttribute('href', `/${artistSlug}/menu`);
  await preorderLink.click();
  await expect(page).toHaveURL(new RegExp(`/${artistSlug}/menu$`));
  await expect(page.getByRole('article', { name: 'Preorder-only product' })).toBeVisible();
  await expect.poll(() => page.evaluate(
    (key) => localStorage.getItem(key),
    `customerSelectedEventId:${artistId}`
  )).toBe(preorderEventId);

  await page.goto(`/${artistSlug}/home`);
  const postorderLink = page.getByRole('link', { name: /Ended Postorder Event.*Post-order open/ });
  await expect(postorderLink).toHaveAttribute('href', `/${artistSlug}/menu`);
  await postorderLink.click();
  await expect(page.getByText('Post-event store', { exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Postorder-only product' })).toBeVisible();
  await expect.poll(() => page.evaluate(
    (key) => localStorage.getItem(key),
    `customerSelectedEventId:${artistId}`
  )).toBe(postorderEventId);
});
