import { randomUUID } from 'node:crypto';
import { expect, test, type Locator } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';
import { LoginPage } from './e2e/pages/LoginPage';

const runId = randomUUID();
const password = 'LocalPosQueueDrawer123!';
const ownerEmail = `pos-queue-owner-${runId}@example.test`;
const sellerEmail = `pos-queue-seller-${runId}@example.test`;
const queueStaffEmail = `pos-queue-staff-${runId}@example.test`;
const eventId = randomUUID();
const productId = randomUUID();
const sellerMemberId = randomUUID();
const queueStaffMemberId = randomUUID();
const productName = `Queue drawer item ${runId.slice(0, 8)}`;

let service: SupabaseClient;
let artistId = '';
let sellerUserId = '';
let queueStaffUserId = '';

const must = (result: { error: { message: string } | null }, action: string) => {
  if (result.error) throw new Error(`${action}: ${result.error.message}`);
};

const dataOrThrow = <T>(result: { data: T; error: { message: string } | null }, action: string): NonNullable<T> => {
  must(result, action);
  if (result.data == null) throw new Error(`${action}: response data missing`);
  return result.data;
};

const serviceDate = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const rowFor = (drawer: Locator, queueNumber: number) => drawer
  .getByRole('listitem')
  .filter({ hasText: `#${queueNumber}` });

test.beforeAll(async () => {
  const testEnv = resolveSupabaseTestEnv();
  if (!['127.0.0.1', 'localhost'].includes(new URL(testEnv.url).hostname)) {
    throw new Error('POS queue drawer fixtures require disposable local Supabase');
  }

  const fixture = await ensureOwnerArtistFixture({
    email: ownerEmail,
    password,
    slug: `pos-queue-${runId.slice(0, 8)}`,
    displayName: 'POS queue drawer fixture',
  });
  service = fixture.service;
  artistId = fixture.userId;

  const seller = await service.auth.admin.createUser({
    email: sellerEmail,
    password,
    email_confirm: true,
  });
  if (seller.error) throw seller.error;
  sellerUserId = seller.data.user.id;

  const queueStaff = await service.auth.admin.createUser({
    email: queueStaffEmail,
    password,
    email_confirm: true,
  });
  if (queueStaff.error) throw queueStaff.error;
  queueStaffUserId = queueStaff.data.user.id;

  must(await service.from('artist_members').insert([
    {
      id: sellerMemberId,
      artist_id: artistId,
      member_email: sellerEmail,
      role: 'seller',
      status: 'active',
    },
    {
      id: queueStaffMemberId,
      artist_id: artistId,
      member_email: queueStaffEmail,
      role: 'queue_staff',
      status: 'active',
    },
  ]), 'seed POS queue staff');

  const now = Date.now();
  must(await service.from('events').insert({
    id: eventId,
    artist_id: artistId,
    event_name: 'POS Queue Drawer Event',
    start_date: new Date(now - 60 * 60 * 1000).toISOString(),
    end_date: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    event_timezone: 'Asia/Bangkok',
    status: 'Confirmed',
    is_booth_open: true,
  }), 'seed POS queue event');

  must(await service.from('event_member_assignments').insert([
    { artist_id: artistId, event_id: eventId, member_id: sellerMemberId },
    { artist_id: artistId, event_id: eventId, member_id: queueStaffMemberId },
  ]), 'assign staff to POS queue event');

  must(await service.from('products').insert({
    id: productId,
    artist_id: artistId,
    name: productName,
    sku: `POS-QUEUE-${runId.slice(0, 8)}`,
    price: 125,
    currency: 'THB',
    category: 'Queue drawer fixture',
    stock_total: 50,
    is_unlimited: false,
    status: 'enable',
  }), 'seed POS queue product');

  must(await service.from('event_products').insert({
    event_id: eventId,
    product_id: productId,
    artist_id: artistId,
    stock_total: 50,
    is_unlimited: false,
    is_enabled: true,
  }), 'seed POS queue event product');

  must(await service.from('queues').insert(
    Array.from({ length: 5 }, (_, index) => ({
      id: randomUUID(),
      artist_id: artistId,
      event_id: eventId,
      queue_number: index + 1,
      status: 'waiting',
      queue_service_date: serviceDate(),
    })),
  ), 'seed waiting queues');
});

test.afterAll(async () => {
  if (!service || !artistId) return;

  const orders = await service.from('orders').select('id').eq('event_id', eventId);
  must(orders, 'list POS queue fixture orders');
  const orderIds = (orders.data || []).map(({ id }) => id);
  if (orderIds.length > 0) {
    must(await service.from('order_items').delete().in('order_id', orderIds), 'delete POS queue order items');
    must(await service.from('order_payments').delete().in('order_id', orderIds), 'delete POS queue payments');
    must(await service.from('orders').delete().in('id', orderIds), 'delete POS queue orders');
  }
  must(await service.from('queues').delete().eq('event_id', eventId), 'delete POS queue tickets');
  must(await service.from('event_products').delete().eq('event_id', eventId), 'delete POS queue event product');
  must(await service.from('products').delete().eq('id', productId), 'delete POS queue product');
  must(await service.from('event_member_assignments').delete().eq('event_id', eventId), 'delete POS queue assignments');
  must(await service.from('events').delete().eq('id', eventId), 'delete POS queue event');
  must(await service.from('artist_members').delete().in('id', [sellerMemberId, queueStaffMemberId]), 'delete POS queue staff');
  must(await service.from('artists').delete().eq('id', artistId), 'delete POS queue artist');
  if (sellerUserId) must(await service.auth.admin.deleteUser(sellerUserId), 'delete seller user');
  if (queueStaffUserId) must(await service.auth.admin.deleteUser(queueStaffUserId), 'delete queue staff user');
  must(await service.auth.admin.deleteUser(artistId), 'delete owner user');
});

test('seller manages queues from a walk-in draft while queue staff updates sync in real time', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const sellerContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const queueStaffContext = await browser.newContext({ viewport: { width: 1100, height: 800 } });

  try {
    const sellerPage = await sellerContext.newPage();
    const sellerLogin = new LoginPage(sellerPage);
    await sellerLogin.goto();
    await sellerLogin.login(sellerEmail, password);
    await expect(sellerPage).toHaveURL(/manage-events|live\/(?:pos|queue)/, { timeout: 20_000 });
    await sellerPage.goto(`/live/pos?eventId=${eventId}`);
    await expect(sellerPage.getByTestId('pos-active-event')).toHaveAttribute('data-event-id', eventId, { timeout: 20_000 });
    await expect(sellerPage.getByTestId('booth-toggle')).toBeVisible();

    const activeSale = sellerPage.locator('[aria-label="Active sale queue"]');
    await expect(activeSale.getByText('Walk-in', { exact: true }).first()).toBeVisible();
    await expect(activeSale.getByRole('button', { name: 'Manage queues', exact: true })).toBeVisible();
    const summary = activeSale.getByRole('group', { name: 'Queue status summary' });
    await expect(summary).toContainText('Waiting5');
    await expect(summary).toContainText('Called0');
    await expect(summary).toContainText('Arrived0');
    await expect(sellerPage.getByRole('link', { name: 'Offline workspace', exact: true })).toHaveCount(0);
    const fullQueueButton = activeSale.getByRole('button', { name: 'Full queue dashboard', exact: true });
    await expect(fullQueueButton).toBeVisible();
    const fullQueueBounds = await fullQueueButton.boundingBox();
    const drawerButtonBounds = await activeSale.getByRole('button', { name: 'Manage queues', exact: true }).boundingBox();
    expect(fullQueueBounds!.y).toBe(drawerButtonBounds!.y);
    expect(fullQueueBounds!.height).toBeGreaterThanOrEqual(44);
    await sellerPage.screenshot({ path: testInfo.outputPath('pos-queue-actions-row.png') });
    await fullQueueButton.click();
    await expect(sellerPage.getByRole('button', { name: 'Queue Control', exact: true })).toBeVisible();
    await sellerPage.getByTestId('pos-tab').click();


    const productRegion = sellerPage.getByRole('region', { name: /Product list|Product grid/ });
    const productButton = productRegion.getByRole('button').filter({ hasText: productName }).first();
    await expect(productButton).toBeEnabled({ timeout: 20_000 });
    await productButton.click();
    const cart = sellerPage.getByRole('region', { name: 'Shopping cart' });
    await expect(cart.getByText(productName, { exact: true })).toBeVisible();

    await activeSale.getByRole('button', { name: 'Manage queues', exact: true }).click();
    let drawer = sellerPage.getByRole('dialog', { name: 'Manage queues', exact: true });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Call 5', exact: true })).toBeEnabled();
    const waiting = drawer.getByRole('region', { name: 'Waiting', exact: true });
    const firstTile = await rowFor(waiting, 1).boundingBox();
    const secondTile = await rowFor(waiting, 2).boundingBox();
    expect(firstTile!.y).toBe(secondTile!.y);
    expect(secondTile!.x).toBeGreaterThan(firstTile!.x);
    expect(firstTile!.width).toBeLessThan(110);
    await sellerPage.screenshot({ path: testInfo.outputPath('pos-waiting-queue-tiles.png') });

    await drawer.getByRole('button', { name: 'Close queue management', exact: true }).click();
    await expect(drawer).toBeHidden();
    await expect(cart.getByText(productName, { exact: true })).toBeVisible();

    await activeSale.getByRole('button', { name: 'Manage queues', exact: true }).click();
    drawer = sellerPage.getByRole('dialog', { name: 'Manage queues', exact: true });
    await drawer.getByRole('button', { name: 'Call 5', exact: true }).click();
    await expect.poll(async () => {
      const result = await service.from('queues').select('id', { count: 'exact', head: true })
        .eq('event_id', eventId)
        .eq('status', 'calling');
      must(result, 'count called queues');
      return result.count;
    }).toBe(5);

    const queueTwo = rowFor(drawer, 2);
    await queueTwo.getByRole('button', { name: 'Mark arrived', exact: true }).click();
    await expect.poll(async () => {
      const result = await service.from('queues').select('status, arrived_at').eq('event_id', eventId).eq('queue_number', 2).single();
      must(result, 'read queue 2 arrival');
      return result.data?.status === 'calling' && Boolean(result.data.arrived_at);
    }).toBe(true);
    const arrivalState = await service.from('queues').select('arrived_at').eq('event_id', eventId).eq('queue_number', 2).single();
    expect(dataOrThrow(arrivalState, 'verify queue 2 arrival timestamp').arrived_at).not.toBeNull();
    const queueOneBefore = await service.from('queues').select('status, arrived_at').eq('event_id', eventId).eq('queue_number', 1).single();
    must(queueOneBefore, 'verify queue 1 remains called');
    expect(queueOneBefore.data).toMatchObject({ status: 'calling', arrived_at: null });

    await rowFor(drawer, 2).getByRole('button', { name: 'Open sale for this queue', exact: true }).click();
    await expect(drawer).toBeHidden();
    await expect(activeSale.getByText('Queue #2 — Serving', { exact: true })).toBeVisible();
    await expect(cart.getByText(productName, { exact: true })).toHaveCount(0);
    const queueTwoServing = await service.from('queues').select('status, arrived_at, served_at').eq('event_id', eventId).eq('queue_number', 2).single();
    const servingState = dataOrThrow(queueTwoServing, 'verify queue 2 serving source');
    expect(servingState.status).toBe('serving');
    expect(servingState.arrived_at).not.toBeNull();
    expect(servingState.served_at).not.toBeNull();

    await activeSale.getByRole('button', { name: 'Walk-in', exact: true }).click();
    await expect(activeSale.getByText('Walk-in', { exact: true }).first()).toBeVisible();
    await expect(cart.getByText(productName, { exact: true })).toBeVisible();

    await activeSale.getByRole('button', { name: 'Queue #2', exact: true }).click();
    await expect(activeSale.getByText('Queue #2 — Serving', { exact: true })).toBeVisible();
    must(await service.from('queues').insert({
      id: randomUUID(),
      artist_id: artistId,
      event_id: eventId,
      queue_number: 6,
      status: 'waiting',
      queue_service_date: serviceDate(),
    }), 'insert incoming realtime queue');

    await activeSale.getByRole('button', { name: 'Manage queues', exact: true }).click();
    drawer = sellerPage.getByRole('dialog', { name: 'Manage queues', exact: true });
    await expect(rowFor(drawer, 6)).toBeVisible({ timeout: 20_000 });
    await expect(activeSale.getByText('Queue #2 — Serving', { exact: true })).toBeVisible();

    const queueStaffPage = await queueStaffContext.newPage();
    const queueStaffLogin = new LoginPage(queueStaffPage);
    await queueStaffLogin.goto();
    await queueStaffLogin.login(queueStaffEmail, password);
    await expect(queueStaffPage).toHaveURL(/live\/queue/, { timeout: 20_000 });
    await queueStaffPage.goto(`/live/queue?eventId=${eventId}`);
    await expect(queueStaffPage.getByTestId('pos-active-event')).toHaveAttribute('data-event-id', eventId, { timeout: 20_000 });
    await expect(queueStaffPage.getByTestId('booth-toggle')).toHaveCount(0);
    await expect(queueStaffPage.getByRole('switch', { name: /Open booth|Close booth/ })).toHaveCount(0);
    await expect(queueStaffPage.getByText('#1', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await queueStaffPage.getByRole('button', { name: 'ARRIVED', exact: true }).first().click();

    const arrivedRegion = drawer.getByRole('region', { name: 'Arrived' });
    await expect(arrivedRegion.getByText('#1', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(activeSale.getByText('Queue #2 — Serving', { exact: true })).toBeVisible();

    // Lose the response after the server committed its last waiting ticket.
    let retryRequestId: string | undefined;
    await sellerPage.route('**/rest/v1/rpc/call_queue_batch', async route => {
      retryRequestId = route.request().postDataJSON().p_request_id;
      await route.fetch();
      await route.abort('failed');
    }, { times: 1 });
    await drawer.getByRole('button', { name: 'Call 1', exact: true }).click();
    await expect(drawer.getByRole('alert')).toBeVisible();
    await expect.poll(async () => (await service.from('queues').select('status').eq('event_id', eventId).eq('queue_number', 6).single()).data?.status).toBe('calling');
    await expect(drawer.getByRole('button', { name: 'Call 1', exact: true })).toBeEnabled();
    const retryResponse = sellerPage.waitForResponse(response => response.url().includes('/rpc/call_queue_batch'));
    await drawer.getByRole('button', { name: 'Call 1', exact: true }).click();
    const replay = await retryResponse;
    expect(replay.request().postDataJSON().p_request_id).toBe(retryRequestId);
    await expect(drawer.getByRole('alert')).toHaveCount(0);
    await expect(activeSale.getByText('Queue #2 — Serving', { exact: true })).toBeVisible();

    await sellerPage.screenshot({ path: testInfo.outputPath('pos-queue-drawer-desktop.png'), fullPage: false });
    await sellerPage.setViewportSize({ width: 390, height: 844 });
    expect(await sellerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await sellerPage.screenshot({ path: testInfo.outputPath('pos-queue-drawer-mobile.png'), fullPage: false });
    await drawer.getByRole('button', { name: 'Close queue management', exact: true }).click();

    await sellerPage.setViewportSize({ width: 820, height: 1180 });
    await activeSale.getByRole('button', { name: 'Manage queues', exact: true }).click();
    drawer = sellerPage.getByRole('dialog', { name: 'Manage queues', exact: true });
    await expect(drawer).toBeVisible();
    expect(await sellerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await sellerPage.screenshot({ path: testInfo.outputPath('pos-queue-drawer-tablet.png'), fullPage: false });

    must(await service.from('queues').insert([7, 8].map((number, index) => ({
      id: randomUUID(), artist_id: artistId, event_id: eventId,
      queue_number: number, status: index === 0 ? 'missed' : 'expired', queue_service_date: serviceDate(),
    }))), 'seed mobile missed tickets');
    await queueStaffPage.evaluate(() => localStorage.setItem('nireq-language', 'th'));
    await queueStaffPage.reload();
    const lists = queueStaffPage.locator('.festival-queue-lists');
    await expect(lists.getByText('#8', { exact: true })).toBeAttached();
    for (const width of [320, 390, 430]) {
      await queueStaffPage.setViewportSize({ width, height: 700 });
      const sections = await lists.locator(':scope > *').evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom };
      }));
      for (let index = 1; index < sections.length; index += 1) expect(sections[index].top).toBeGreaterThanOrEqual(sections[index - 1].bottom);
      expect(await queueStaffPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await lists.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await queueStaffPage.screenshot({ path: testInfo.outputPath('queue-mobile-missed-no-overlap.png') });

  } finally {
    await sellerContext.close();
    await queueStaffContext.close();
  }
});
