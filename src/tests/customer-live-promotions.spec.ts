import { randomUUID } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

const runId = randomUUID();
const slug = `live-promo-${runId.slice(0, 8)}`;
const eventId = randomUUID();
const productId = randomUUID();
const promotionId = randomUUID();
const productName = `Live promotion print ${runId.slice(0, 8)}`;

let service: SupabaseClient;
let artistId = '';

const must = <T extends { error: { message: string } | null }>(result: T, action: string): T => {
  if (result.error) throw new Error(`${action}: ${result.error.message}`);
  return result;
};

const serviceDate = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const seedCallingTicket = async (page: Page) => {
  const queueId = randomUUID();
  const fingerprint = randomUUID();
  must(await service.from('queues').insert({
    id: queueId,
    customer_fingerprint: fingerprint,
    artist_id: artistId,
    event_id: eventId,
    queue_number: Math.floor(Math.random() * 900_000) + 1,
    queue_service_date: serviceDate(),
    status: 'calling',
    called_at: new Date().toISOString(),
  }), 'seed calling queue ticket');
  await page.addInitScript(({ fixtureArtistId, fixtureQueueId, fixtureFingerprint }) => {
    localStorage.setItem('nireq-language', 'en');
    localStorage.setItem('nireq-replay-consent-v1', 'rejected');
    localStorage.setItem(`ticket_id_${fixtureArtistId}`, fixtureQueueId);
    localStorage.setItem(`customer_fingerprint_${fixtureArtistId}`, fixtureFingerprint);
  }, { fixtureArtistId: artistId, fixtureQueueId: queueId, fixtureFingerprint: fingerprint });
  return queueId;
};

const orderCount = async (queueId: string) => {
  const result = must(await service.from('orders').select('id', { count: 'exact', head: true }).eq('queue_id', queueId), 'count queue orders');
  return result.count || 0;
};

const continueAfter = async (route: Route, gate: Promise<void>) => {
  await gate;
  await route.continue();
};

const openCart = async (page: Page) => {
  if ((page.viewportSize()?.width || 1280) < 1024) {
    await page.locator('.shop-cart-panel').getByRole('button').filter({ hasText: /^Total/ }).click();
  }
};

test.beforeAll(async () => {
  if (!process.env.SUPABASE_WORKDIR) throw new Error('Live promotion regression requires disposable local Supabase');
  const env = resolveSupabaseTestEnv();
  if (!['127.0.0.1', 'localhost'].includes(new URL(env.url).hostname)) {
    throw new Error('Live promotion regression requires disposable local Supabase');
  }

  const fixture = await ensureOwnerArtistFixture({
    email: `${slug}@example.test`,
    password: 'LocalLivePromotions123!',
    slug,
    displayName: 'Live promotion browser fixture',
  });
  service = fixture.service;
  artistId = fixture.userId;

  const now = Date.now();
  must(await service.from('events').insert({
    id: eventId,
    artist_id: artistId,
    event_name: 'Live promotion event',
    start_date: new Date(now - 3_600_000).toISOString(),
    end_date: new Date(now + 86_400_000).toISOString(),
    event_timezone: 'Asia/Bangkok',
    status: 'Confirmed',
    is_booth_open: true,
  }), 'seed event');
  must(await service.from('products').insert({
    id: productId,
    artist_id: artistId,
    name: productName,
    sku: `LIVE-${runId.slice(0, 8)}`,
    category: 'Live promotion test',
    price: 250,
    currency: 'THB',
    stock_total: null,
    is_unlimited: true,
    status: 'enable',
  }), 'seed product');
  must(await service.from('event_products').insert({
    event_id: eventId,
    product_id: productId,
    artist_id: artistId,
    is_enabled: true,
    is_sellable: true,
    stock_total: null,
    is_unlimited: true,
  }), 'seed event product');
  must(await service.from('artist_promotions').insert({
    id: promotionId,
    artist_id: artistId,
    name: 'Live 20% off',
    promotion_type: 'condition_reward',
    rule_type: 'discount',
    target_type: 'all',
    lifecycle_status: 'ready',
    v1_config: {
      version: 1,
      condition: { kind: 'quantity', quantity: 1 },
      discount: { kind: 'percentage', value: 20 },
      gift: null,
      activity: null,
    },
  }), 'seed live promotion');
  must(await service.from('promotion_assignments').insert({
    promotion_id: promotionId,
    artist_id: artistId,
    event_id: eventId,
    event_phase: 'live',
    is_paused: false,
    combination_policy: 'combine',
  }), 'assign live promotion');
});

test.afterAll(async () => {
  if (!service || !artistId) return;
  const orders = must(await service.from('orders').select('id').eq('event_id', eventId), 'list fixture orders');
  const orderIds = (orders.data || []).map(({ id }) => id);
  if (orderIds.length > 0) {
    must(await service.from('order_items').delete().in('order_id', orderIds), 'delete fixture order items');
    must(await service.from('order_payments').delete().in('order_id', orderIds), 'delete fixture order payments');
    must(await service.from('orders').delete().in('id', orderIds), 'delete fixture orders');
  }
  must(await service.from('queues').delete().eq('event_id', eventId), 'delete fixture queues');
  must(await service.from('promotion_assignments').delete().eq('promotion_id', promotionId), 'delete promotion assignment');
  must(await service.from('artist_promotions').delete().eq('id', promotionId), 'delete promotion');
  must(await service.from('event_products').delete().eq('event_id', eventId), 'delete event product');
  must(await service.from('products').delete().eq('id', productId), 'delete product');
  must(await service.from('events').delete().eq('id', eventId), 'delete event');
  must(await service.from('artists').delete().eq('id', artistId), 'delete artist');
  const deleted = await service.auth.admin.deleteUser(artistId);
  if (deleted.error) throw deleted.error;
});

test('live cart uses server pricing, invalidates stale quotes, and reviews a changed quote before creating an order', async ({ page }) => {
  test.setTimeout(120_000);
  const queueId = await seedCallingTicket(page);
  await page.goto(`/${slug}/menu?event=${eventId}`);

  await page.getByRole('button', { name: `Add: ${productName}`, exact: true }).click();
  await openCart(page);
  const cart = page.locator('.shop-cart-panel');
  const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
  await expect(cart.getByText('Live 20% off', { exact: true })).toBeVisible();
  await expect(cart.getByText('฿250', { exact: true }).last()).toBeVisible();
  await expect(cart.getByText('- ฿50', { exact: true }).last()).toBeVisible();
  await expect(cart.getByText('฿200', { exact: true }).last()).toBeVisible();
  await expect(confirm).toBeEnabled();

  let releaseQuantityQuote!: () => void;
  const quantityQuoteGate = new Promise<void>((resolve) => { releaseQuantityQuote = resolve; });
  let delayedQuantityQuote = false;
  await page.route('**/rest/v1/rpc/quote_sale_promotions', async (route) => {
    const body = route.request().postDataJSON() as { p_items?: Array<{ product_id: string; quantity: number }> };
    if (!delayedQuantityQuote && body.p_items?.some((item) => item.product_id === productId && item.quantity === 2)) {
      delayedQuantityQuote = true;
      await continueAfter(route, quantityQuoteGate);
      return;
    }
    await route.continue();
  });

  await cart.getByRole('button', { name: `Increase quantity of ${productName}`, exact: true }).click();
  await expect.poll(() => delayedQuantityQuote).toBe(true);
  await expect(cart.getByText('Calculating offers and total…', { exact: true })).toBeVisible();
  await expect(cart.getByText('฿200', { exact: true })).toHaveCount(0);
  await expect(cart.getByText('—', { exact: true }).last()).toBeVisible();
  await expect(confirm).toBeDisabled();
  releaseQuantityQuote();
  await expect(cart.getByText('฿500', { exact: true }).last()).toBeVisible();
  await expect(cart.getByText('- ฿100', { exact: true }).last()).toBeVisible();
  await expect(cart.getByText('฿400', { exact: true }).last()).toBeVisible();
  await expect(confirm).toBeEnabled();
  await page.unroute('**/rest/v1/rpc/quote_sale_promotions');

  await cart.getByRole('button', { name: `Decrease quantity of ${productName}`, exact: true }).click();
  await expect(cart.getByText('฿200', { exact: true }).last()).toBeVisible();
  await confirm.click();
  const dialog = page.getByRole('dialog', { name: 'Confirm Order?', exact: true });
  const receipt = dialog.getByRole('complementary');
  await expect(dialog).toContainText(productName);
  await expect(receipt.getByText('฿250', { exact: true })).toBeVisible();
  await expect(receipt.getByText('−฿50', { exact: true })).toBeVisible();
  await expect(receipt.getByText('฿200', { exact: true })).toBeVisible();

  let returnChangedQuote = true;
  await page.route('**/rest/v1/rpc/quote_sale_promotions', async (route) => {
    const response = await route.fetch();
    const quote = await response.json() as Record<string, unknown>;
    if (!returnChangedQuote) {
      await route.fulfill({ response, json: quote });
      return;
    }
    await route.fulfill({
      response,
      json: {
        ...quote,
        discount_total: 25,
        merchandise_total: 225,
        total: 225,
        pricing_hash: `${String(quote.pricing_hash)}-changed-for-review`,
        applied_promotions: Array.isArray(quote.applied_promotions)
          ? quote.applied_promotions.map((promotion) => ({ ...(promotion as Record<string, unknown>), discount_amount: 25 }))
          : [],
      },
    });
  });

  await dialog.getByRole('button', { name: 'Send Order', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Offers or totals changed. Review the updated total and confirm again.' })).toBeVisible();
  await expect.poll(() => orderCount(queueId)).toBe(0);
  await expect(cart.getByText('฿225', { exact: true }).last()).toBeVisible();

  await confirm.click();
  await expect(receipt.getByText('฿225', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Send Order', exact: true }).click();
  await expect.poll(() => orderCount(queueId), { timeout: 20_000 }).toBe(1);
  const savedOrder = must(await service.from('orders').select('id,status,total_price,subtotal_price').eq('queue_id', queueId).single(), 'read live order');
  expect(savedOrder.data).toMatchObject({ status: 'confirmed', total_price: 250, subtotal_price: 250 });
  const savedItems = must(await service.from('order_items').select('product_id,quantity,price_per_unit').eq('order_id', savedOrder.data!.id), 'read live order items');
  expect(savedItems.data).toEqual([{ product_id: productId, quantity: 1, price_per_unit: 250 }]);
  returnChangedQuote = false;
});

test('a failed live price check disables confirmation and never reports or creates an order', async ({ page }) => {
  const queueId = await seedCallingTicket(page);
  await page.route('**/rest/v1/rpc/quote_sale_promotions', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'live_quote_unavailable' }),
  }));
  await page.goto(`/${slug}/menu?event=${eventId}`);
  await page.getByRole('button', { name: `Add: ${productName}`, exact: true }).click();
  await openCart(page);

  const cart = page.locator('.shop-cart-panel');
  await expect(cart.getByRole('alert')).toContainText('Could not calculate promotions');
  await expect(cart.getByText('—', { exact: true }).last()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  await expect(page.getByText('Order Sent!', { exact: true })).toHaveCount(0);
  await expect.poll(() => orderCount(queueId)).toBe(0);
});

test('a committed live order keeps its receipt when the response arrives after postorder begins', async ({ page }) => {
  test.setTimeout(120_000);
  const browserNow = Date.now();
  const eventEndsAt = new Date(browserNow + 59_000).toISOString();
  must(await service.from('events').update({
    start_date: new Date(browserNow - 3_600_000).toISOString(),
    end_date: eventEndsAt,
    status: 'Confirmed',
    postorder_enabled: true,
    postorder_opens_at: new Date(browserNow - 3_600_000).toISOString(),
    postorder_closes_at: new Date(browserNow + 86_400_000).toISOString(),
    sales_status_override: 'auto',
  }).eq('id', eventId), 'move event close to the live/postorder boundary for committed response');

  const queueId = await seedCallingTicket(page);
  const quotedPhases: string[] = [];
  page.on('request', (request) => {
    if (!request.url().includes('/rest/v1/rpc/quote_sale_promotions')) return;
    quotedPhases.push(String((request.postDataJSON() as { p_event_phase?: string }).p_event_phase || ''));
  });
  await page.clock.install({ time: new Date(browserNow) });

  let releaseCreateResponse!: () => void;
  const createResponseGate = new Promise<void>((resolve) => { releaseCreateResponse = resolve; });
  let finishCreateRoute!: () => void;
  const createRouteFinished = new Promise<void>((resolve) => { finishCreateRoute = resolve; });
  let createRequested = false;
  await page.route('**/rest/v1/rpc/create_customer_order_with_stock', async (route) => {
    const response = await route.fetch();
    createRequested = response.ok();
    await createResponseGate;
    try {
      await route.fulfill({ response });
    } finally {
      finishCreateRoute();
    }
  });

  try {
    await page.goto(`/${slug}/menu?event=${eventId}`);
    await page.getByRole('button', { name: `Add: ${productName}`, exact: true }).click();
    await openCart(page);
    await expect(page.locator('.shop-cart-panel').getByText('฿200', { exact: true }).last()).toBeVisible();
    // Move close to the phase boundary before starting the timed HTTP request.
    const beforeBoundary = browserNow + 55_000 - await page.evaluate(() => Date.now());
    await page.clock.fastForward(Math.max(0, beforeBoundary));
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.getByRole('dialog', { name: 'Confirm Order?', exact: true })
      .getByRole('button', { name: 'Send Order', exact: true })
      .click();

    await expect.poll(() => createRequested).toBe(true);
    await expect.poll(() => orderCount(queueId)).toBe(1);
    await page.clock.fastForward(6_000);
    await expect.poll(() => quotedPhases).toContain('postorder');

    await page.clock.resume();
    releaseCreateResponse();
    await createRouteFinished;
    await expect.poll(() => orderCount(queueId), { timeout: 20_000 }).toBe(1);

    const savedOrder = must(await service.from('orders').select('id,total_price,subtotal_price').eq('queue_id', queueId).single(), 'read committed live order');
    expect(savedOrder.data).toMatchObject({ total_price: 250, subtotal_price: 250 });
    await expect.poll(() => page.evaluate(({ fixtureArtistId, expectedOrderId }) => {
      const storedCart = JSON.parse(localStorage.getItem(`cart_${fixtureArtistId}`) || '{}') as { items?: Record<string, number> };
      return {
        orderId: localStorage.getItem(`sentOrderId_${fixtureArtistId}`),
        ticketId: localStorage.getItem(`sentOrderTicketId_${fixtureArtistId}`),
        cartItems: storedCart.items || {},
        expectedOrderId,
      };
    }, { fixtureArtistId: artistId, expectedOrderId: savedOrder.data!.id })).toEqual({
      orderId: savedOrder.data!.id,
      ticketId: queueId,
      cartItems: {},
      expectedOrderId: savedOrder.data!.id,
    });
    await expect.poll(() => orderCount(queueId)).toBe(1);
  } finally {
    releaseCreateResponse?.();
    await page.unroute('**/rest/v1/rpc/create_customer_order_with_stock');
  }
});

test('an open menu invalidates its live quote and requotes when the event crosses into postorder', async ({ page }) => {
  const browserNow = Date.now();
  const eventEndsAt = new Date(browserNow + 30_000).toISOString();
  must(await service.from('events').update({
    start_date: new Date(browserNow - 3_600_000).toISOString(),
    end_date: eventEndsAt,
    status: 'Confirmed',
    postorder_enabled: true,
    postorder_opens_at: new Date(browserNow - 3_600_000).toISOString(),
    postorder_closes_at: new Date(browserNow + 86_400_000).toISOString(),
    sales_status_override: 'auto',
  }).eq('id', eventId), 'move event close to the live/postorder boundary');

  const quotedPhases: string[] = [];
  page.on('request', (request) => {
    if (!request.url().includes('/rest/v1/rpc/quote_sale_promotions')) return;
    quotedPhases.push(String((request.postDataJSON() as { p_event_phase?: string }).p_event_phase || ''));
  });
  await page.clock.install({ time: new Date(browserNow) });
  await page.addInitScript(() => { localStorage.setItem('nireq-language', 'en'); localStorage.setItem('nireq-replay-consent-v1', 'rejected'); });
  await page.goto(`/${slug}/menu?event=${eventId}`);
  await page.getByRole('button', { name: `Add: ${productName}`, exact: true }).click();
  await openCart(page);

  const cart = page.locator('.shop-cart-panel');
  await expect(cart.getByText('Live 20% off', { exact: true })).toBeVisible();
  await expect(cart.getByText('฿200', { exact: true }).last()).toBeVisible();
  await expect.poll(() => quotedPhases).toContain('live');

  await page.clock.fastForward(61_000);
  await expect.poll(() => quotedPhases).toContain('postorder');
  await expect(cart.getByText('Live 20% off', { exact: true })).toHaveCount(0);
  await expect(cart.getByText('฿200', { exact: true })).toHaveCount(0);
  await expect(cart.getByText('฿250', { exact: true }).last()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Place post-event order', exact: true })).toBeVisible();
});
