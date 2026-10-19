import { selectLanguage } from './helpers/languageMenu';
import { expect, test, type Page, type Route } from '@playwright/test';

const artistId = '10000000-0000-4000-8000-000000000001';
const preorderEventId = '20000000-0000-4000-8000-000000000001';
const postorderEventId = '20000000-0000-4000-8000-000000000002';
const closedEventId = '20000000-0000-4000-8000-000000000003';
const artistSlug = 'event-card-shop';
const now = Date.now();

const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  status,
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

interface StorefrontMockState {
  broadcastMessage?: string;
  queueOpen?: boolean;
  failPromotionQuote?: boolean;
  postorderBoothOpen?: boolean;
  liveEndsAt?: string;
  delayGlobalCatalog?: boolean;
  globalCatalogFinished?: boolean;
}

const mockCustomerStorefront = async (page: Page, state: StorefrontMockState = {}) => {
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

    if (path.includes('/rest/v1/rpc/quote_sale_promotions')) {
      if (state.failPromotionQuote) return json(route, { message: 'Promotion quote unavailable' }, 503);
      const body = JSON.parse(route.request().postData() || '{}') as { p_items?: Array<{ quantity?: number }> };
      const subtotal = (body.p_items || []).reduce((sum, item) => sum + (item.quantity || 0) * 120, 0);
      return json(route, {
        subtotal,
        merchandise_total: subtotal,
        discount_total: 0,
        shipping_fee: 0,
        total: subtotal,
        applied_promotions: [],
        reward_lines: [],
        required_choices: [],
        pricing_hash: `event-card-quote-${subtotal}`,
      });
    }

    if (path.includes('/rest/v1/rpc/list_event_products')) {
      const body = JSON.parse(route.request().postData() || '{}') as { p_event_id?: string };
      return json(route, body.p_event_id ? [productFor(body.p_event_id)] : []);
    }

    if (path.includes('/rest/v1/event_appearances')) return json(route, []);
    if (path.includes('/rest/v1/events')) {
      if (state.delayGlobalCatalog) await new Promise(resolve => setTimeout(resolve, 100));
      return json(route, eventRows.map(event => event.id === postorderEventId && state.postorderBoothOpen ? { ...event, status: 'Confirmed', is_booth_open: true, ...(state.liveEndsAt ? { start_date: new Date(now - 60000).toISOString(), end_date: state.liveEndsAt } : {}) } : event));
    }
    if (path.includes('/rest/v1/products') && state.delayGlobalCatalog) {
      await new Promise(resolve => setTimeout(resolve, 800));
      await json(route, []);
      state.globalCatalogFinished = true;
      return;
    }

    if (path.includes('/rest/v1/artists')) {
      return json(route, {
        id: artistId,
        slug: artistSlug,
        display_name: 'Event Card Shop',
        bio: 'Event card regression fixture',
        image_url: null,
        broadcast_message: state.broadcastMessage || null,
        is_queue_open: state.queueOpen ?? true,
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
  await expect(page.getByText('Select items', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Pre-order unavailable', { exact: true })).toHaveCount(0);
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
  await page.getByRole('button', { name: 'Add: Postorder-only product', exact: true }).click();
  await expect(page.getByText('Shipping address (required for shipping)', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('Name, address, province, postal code, phone number', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(
    (key) => localStorage.getItem(key),
    `customerSelectedEventId:${artistId}`
  )).toBe(postorderEventId);
});

test('a failed re-quote clears stale preorder readiness and keeps checkout disabled', async ({ page }) => {
  const state: StorefrontMockState = {};
  await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
  await mockCustomerStorefront(page, state);
  await page.goto(`/${artistSlug}/home`);
  await page.getByRole('link', { name: /Future Preorder Event.*Pre-order open/ }).click();

  await expect(page.getByRole('article', { name: 'Preorder-only product' })).toBeVisible();
  await page.getByRole('button', { name: 'Add: Preorder-only product', exact: true }).click();
  const submitButton = page.getByRole('button', { name: 'Pre-order', exact: true });
  await expect(page.locator('.shop-cart-panel').getByText('Ready for pre-order', { exact: true })).toHaveCount(1);
  await expect(submitButton).toBeEnabled();

  state.failPromotionQuote = true;
  await page.getByRole('article', { name: 'Preorder-only product' }).getByRole('button', { name: 'Increase quantity of Preorder-only product', exact: true }).click();

  await expect(page.locator('.shop-cart-panel').getByText('Could not calculate promotions', { exact: true })).toHaveCount(1);
  await expect(page.locator('.shop-cart-panel').getByText('Pre-order unavailable', { exact: true })).toHaveCount(0);
  await expect(submitButton).toBeDisabled();
});


test('a late global catalog response cannot erase the selected event products', async ({ page }) => {
  const state: StorefrontMockState = { delayGlobalCatalog: true };
  await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
  await mockCustomerStorefront(page, state);
  await page.goto(`/${artistSlug}/menu`);
  await expect(page.getByRole('article', { name: 'Preorder-only product' })).toBeVisible();
  await expect.poll(() => state.globalCatalogFinished).toBe(true);
  await expect(page.getByRole('article', { name: 'Preorder-only product' })).toBeVisible();
});


test('an ended event cannot show queue intake while its post-order store remains open', async ({ page }, testInfo) => {
  await page.addInitScript(({ artistId, postorderEventId }) => {
    localStorage.setItem('nireq-language', 'en');
    localStorage.setItem(`customerSelectedEventId:${artistId}`, postorderEventId);
  }, { artistId, postorderEventId });
  await mockCustomerStorefront(page, { postorderBoothOpen: true });
  await page.goto(`/${artistSlug}/queue`);
  await expect(page.getByRole('heading', { name: 'Event ended', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get Ticket', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('ended-event-queue.png'), fullPage: true });
  await page.getByRole('link', { name: 'Merchandise', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Postorder-only product' })).toBeVisible();
  await expect(page.getByText('Post-event store', { exact: true })).toBeVisible();
});


test('an open queue removes ticket intake as soon as the event ends without a reload', async ({ page }) => {
  await page.clock.install({ time: new Date(now) });
  await page.addInitScript(({ artistId, postorderEventId }) => {
    localStorage.setItem('nireq-language', 'en');
    localStorage.setItem(`customerSelectedEventId:${artistId}`, postorderEventId);
  }, { artistId, postorderEventId });
  await mockCustomerStorefront(page, { postorderBoothOpen: true, liveEndsAt: new Date(now + 10000).toISOString() });
  await page.goto(`/${artistSlug}/queue`);
  await expect(page.getByRole('button', { name: 'Get Ticket', exact: true })).toBeVisible();
  await page.clock.runFor(10001);
  await expect(page.getByRole('button', { name: 'Get Ticket', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Event ended', exact: true }).first()).toBeVisible();
});


for (const [message, thaiTitle, englishTitle] of [
  ['Queue closed temporarily', 'หยุดรับคิวชั่วคราว', 'Queue temporarily closed'],
  ['Break time', 'ร้านกำลังพัก', 'The shop is taking a break'],
  ['Urgent matter, sorry for the inconvenience', 'ล่าช้าจากเหตุเร่งด่วน', 'Service delayed by an urgent matter'],
]) {
  test(`customer preset announcement translates and stays clear of navigation: ${message}`, async ({ page }, testInfo) => {
    await page.addInitScript(() => localStorage.setItem('nireq-language', 'th'));
    await page.setViewportSize({ width: 320, height: 700 });
    await mockCustomerStorefront(page, { broadcastMessage: message, queueOpen: message !== 'Queue closed temporarily', postorderBoothOpen: true, liveEndsAt: new Date(Date.now() + 3600000).toISOString() });
    await page.goto(`/${artistSlug}/queue`);
    const banner = page.getByTestId('queue-broadcast');
    await expect(banner.getByRole('heading', { name: thaiTitle, exact: true })).toBeVisible();
    await expect(banner).not.toContainText(message);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const header = await page.locator('header').first().boundingBox();
    const bounds = await banner.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
    await page.screenshot({ path: testInfo.outputPath('customer-queue-announcement-th.png') });
    await selectLanguage(page, 'en');
    await expect(banner.getByRole('heading', { name: englishTitle, exact: true })).toBeVisible();
    if (message === 'Queue closed temporarily') {
      await expect(page.locator('.queue-guidance')).toContainText(englishTitle);
      await expect(page.getByRole('button', { name: 'Get Ticket', exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByRole('button', { name: 'Get Ticket', exact: true })).toBeEnabled();
    }
  });
}
