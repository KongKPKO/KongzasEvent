import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';
import { LoginPage } from './e2e/pages/LoginPage';

const runId = randomUUID();
const ownerEmail = `pos-history-owner-${runId}@example.test`;
const queueStaffEmail = `pos-history-queue-${runId}@example.test`;
const password = 'LocalPosHistoryPassword123!';
const eventId = randomUUID();
const activeQueueId = randomUUID();
const historicalQueueId = randomUUID();
const historicalOrderId = randomUUID();
const productId = randomUUID();
const memberId = randomUUID();
let service: SupabaseClient;
let artistId = '';
let queueStaffUserId = '';

const must = (result: { error: { message: string } | null }) => {
  if (result.error) throw new Error(result.error.message);
};

const serviceDate = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

test.beforeAll(async () => {
  const testEnv = resolveSupabaseTestEnv();
  if (!['127.0.0.1', 'localhost'].includes(new URL(testEnv.url).hostname)) {
    throw new Error('POS sales-history fixtures require disposable local Supabase');
  }

  const fixture = await ensureOwnerArtistFixture({
    email: ownerEmail,
    password,
    slug: `pos-history-${runId.slice(0, 8)}`,
    displayName: 'POS history fixture',
  });
  service = fixture.service;
  artistId = fixture.userId;

  const queueUser = await service.auth.admin.createUser({
    email: queueStaffEmail,
    password,
    email_confirm: true,
  });
  if (queueUser.error) throw queueUser.error;
  queueStaffUserId = queueUser.data.user.id;

  must(await service.from('artist_members').insert({
    id: memberId,
    artist_id: artistId,
    member_email: queueStaffEmail,
    role: 'queue_staff',
    status: 'active',
  }));
  must(await service.from('events').insert({
    id: eventId,
    artist_id: artistId,
    event_name: 'POS Sales History Event',
    start_date: new Date(Date.now() - 3_600_000).toISOString(),
    end_date: new Date(Date.now() + 86_400_000).toISOString(),
    event_timezone: 'Asia/Bangkok',
    status: 'Confirmed',
    is_booth_open: true,
  }));
  must(await service.from('event_member_assignments').insert({
    artist_id: artistId,
    member_id: memberId,
    event_id: eventId,
  }));
  must(await service.from('products').insert({
    id: productId,
    artist_id: artistId,
    name: 'Current catalog name',
    sku: 'CURRENT-POS-SKU',
    price: 180,
    currency: 'THB',
    stock_total: 20,
    is_unlimited: false,
    status: 'enable',
  }));
  must(await service.from('event_products').insert({
    event_id: eventId,
    product_id: productId,
    artist_id: artistId,
    stock_total: 20,
    is_unlimited: false,
    is_enabled: true,
  }));
  must(await service.from('queues').insert([
    { id: activeQueueId, artist_id: artistId, event_id: eventId, queue_number: 2, status: 'serving', queue_service_date: serviceDate() },
    { id: historicalQueueId, artist_id: artistId, event_id: eventId, queue_number: 27, status: 'complete', queue_service_date: serviceDate() },
  ]));
  must(await service.from('orders').insert({
    id: historicalOrderId,
    event_id: eventId,
    queue_id: historicalQueueId,
    status: 'completed',
    total_price: 160,
    subtotal_price: 180,
    discount_total: 20,
    pricing_breakdown: [{ id: 'history-offer', name: 'Recorded promotion', discount_amount: 20, rule_text: 'Saved offer' }],
    payment_method: 'cash',
    currency: 'THB',
    order_type: 'live_queue',
  }));
  must(await service.from('order_items').insert({
    order_id: historicalOrderId,
    product_id: productId,
    quantity: 1,
    price_per_unit: 180,
    currency: 'THB',
    product_name_snapshot: 'Recorded sale name',
    sku_snapshot: 'RECORDED-POS-SKU',
  }));
});

test.afterAll(async () => {
  if (!service || !artistId) return;
  must(await service.from('order_items').delete().eq('order_id', historicalOrderId));
  must(await service.from('orders').delete().eq('event_id', eventId));
  must(await service.from('queues').delete().eq('event_id', eventId));
  must(await service.from('event_products').delete().eq('event_id', eventId));
  must(await service.from('event_member_assignments').delete().eq('event_id', eventId));
  must(await service.from('events').delete().eq('id', eventId));
  must(await service.from('products').delete().eq('id', productId));
  must(await service.from('artist_members').delete().eq('id', memberId));
  must(await service.from('artists').delete().eq('id', artistId));
  if (queueStaffUserId) must(await service.auth.admin.deleteUser(queueStaffUserId));
  must(await service.auth.admin.deleteUser(artistId));
});

test('POS history is read-only and preserves the active queue and cart', async ({ page }, testInfo) => {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(ownerEmail, password);
  await expect(page).toHaveURL(/manage-events/, { timeout: 30_000 });
  await page.goto(`/live/pos?eventId=${eventId}`);

  const productRegion = page.getByRole('region', { name: /Product list|Product grid/ });
  const productButton = productRegion.getByRole('button').filter({ hasText: 'Current catalog name' }).first();
  await expect(productButton).toBeEnabled({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Queue #2', exact: true }).click();
  await productButton.click();
  await expect(page.getByRole('region', { name: 'Shopping cart' }).getByText('Current catalog name', { exact: true })).toBeVisible();

  const before = await service.from('orders').select('id', { count: 'exact', head: true }).eq('event_id', eventId);
  must(before);
  await page.getByRole('button', { name: 'Sales history', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Sales history', exact: true });
  await expect(drawer).toBeVisible();
  await drawer.getByPlaceholder('Order number or queue number').fill('queue #27');
  await expect(drawer.getByText('Queue #27', { exact: true }).first()).toBeVisible();
  await drawer.getByText(`#${historicalOrderId.replace(/-/g, '').slice(0, 8).toUpperCase()}`, { exact: true }).click();
  const detail = drawer.getByTestId('pos-sale-detail');
  await expect(detail.getByText('Recorded sale name', { exact: true })).toBeVisible();
  await expect(detail.getByRole('region', { name: 'Promotions used in this order' })).toContainText('Recorded promotion');
  await expect(detail.getByText('RECORDED-POS-SKU', { exact: false })).toBeVisible();
  await expect(detail.getByText('Queue #27', { exact: true })).toBeVisible();
  await expect(detail.getByText('The recorded discount is stored at order level and is not allocated to individual items.', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('pos-history-desktop.png') });
  await drawer.getByRole('button', { name: 'Close sales history', exact: true }).click();

  await expect(page.getByRole('region', { name: 'Shopping cart' }).getByText('Current catalog name', { exact: true })).toBeVisible();
  await expect(page.getByText('Editing preselected order for Queue #2.', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Sales history', exact: true }).click();
  await expect(drawer).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await drawer.getByText(`#${historicalOrderId.replace(/-/g, '').slice(0, 8).toUpperCase()}`, { exact: true }).click();
  await expect(drawer.getByTestId('pos-sale-detail').getByText('Recorded sale name', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('pos-history-mobile.png') });
  await drawer.getByRole('button', { name: 'Back to orders', exact: true }).click();
  await drawer.getByRole('button', { name: 'Close sales history', exact: true }).click();
  await page.locator('.pos-mobile-cartbar button').click();
  await expect(page.getByRole('dialog', { name: 'Shopping cart', exact: true }).getByText('Current catalog name', { exact: true })).toBeVisible();
  const after = await service.from('orders').select('id', { count: 'exact', head: true }).eq('event_id', eventId);
  must(after);
  expect(after.count).toBe(before.count);
});

test('queue staff cannot open POS sales history from the live route', async ({ page }) => {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(queueStaffEmail, password);
  await expect(page).toHaveURL(/live\/queue/, { timeout: 20000 });
  await page.goto(`/live/pos?eventId=${eventId}`);
  await expect(page.getByTestId('pos-tab')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sales history', exact: true })).toHaveCount(0);
});
