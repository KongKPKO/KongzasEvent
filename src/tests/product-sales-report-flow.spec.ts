import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';
import { LoginPage } from './e2e/pages/LoginPage';

const runId = randomUUID();
const email = `product-report-${runId}@example.test`;
const password = 'LocalOnlyProductReport123!';
const slug = `product-report-${runId.slice(0, 8)}`;
const eventId = randomUUID();
let service: SupabaseClient;
let artistId = '';
let parentId = '';
let productIds: string[] = [];

const must = (result: { error: { message: string } | null }) => {
  if (result.error) throw new Error(result.error.message);
};

test.beforeAll(async () => {
  const local = resolveSupabaseTestEnv();
  if (!['127.0.0.1', 'localhost'].includes(new URL(local.url).hostname)) throw new Error('Product report fixtures require disposable local Supabase');
  const fixture = await ensureOwnerArtistFixture({ email, password, slug, displayName: 'Product report fixture' });
  service = fixture.service;
  artistId = fixture.userId;
  const parent = await service.from('product_parents').insert({ artist_id: artistId, name: 'Original set', category: 'Print', base_price: 100 }).select('id').single();
  must(parent);
  parentId = parent.data!.id;
  const products = await service.from('products').insert([
    { artist_id: artistId, parent_product_id: parentId, name: 'Current set — New A', variant_name: 'New A', variant_group_name: 'Current set', sku: `CURRENT-A-${runId.slice(0, 6)}`, price: 100, is_unlimited: true, status: 'enable' },
    { artist_id: artistId, parent_product_id: parentId, name: 'Current set — New B', variant_name: 'New B', variant_group_name: 'Current set', sku: `CURRENT-B-${runId.slice(0, 6)}`, price: 200, is_unlimited: true, status: 'enable' },
  ]).select('id');
  must(products);
  productIds = products.data!.map((item) => item.id);
  must(await service.from('events').insert({ id: eventId, artist_id: artistId, event_name: 'Product report event', start_date: '2026-10-16T00:00:00Z', end_date: '2026-10-20T00:00:00Z', event_timezone: 'Asia/Bangkok', status: 'Confirmed' }));
  const order = await service.from('orders').insert({ event_id: eventId, status: 'completed', total_price: 270, subtotal_price: 300, discount_total: 30, payment_method: 'cash', currency: 'THB', created_at: '2026-10-17T03:00:00Z' }).select('id').single();
  must(order);
  must(await service.from('order_items').insert([
    { order_id: order.data!.id, product_id: productIds[0], quantity: 1, price_per_unit: 100, currency: 'THB', product_name_snapshot: 'Original set — Option A', sku_snapshot: 'OLD-A' },
    { order_id: order.data!.id, product_id: productIds[1], quantity: 1, price_per_unit: 200, currency: 'THB', product_name_snapshot: 'Original set — Option B', sku_snapshot: 'OLD-B' },
  ]));
});

test.afterAll(async () => {
  if (!service || !artistId) return;
  must(await service.from('orders').delete().eq('event_id', eventId));
  must(await service.from('events').delete().eq('id', eventId));
  if (productIds.length) must(await service.from('products').delete().in('id', productIds));
  if (parentId) must(await service.from('product_parents').delete().eq('id', parentId));
  must(await service.from('artists').delete().eq('id', artistId));
  must(await service.auth.admin.deleteUser(artistId));
});

test('management report expands historical variants, filters, exports Thai-safe CSV and stays responsive', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await new LoginPage(page).goto();
  await new LoginPage(page).login(email, password);
  await expect(page).toHaveURL(/manage-events/, { timeout: 20_000 });
  await page.route('**/rest/v1/orders?**', route => route.abort());
  await page.goto(`/manage-events/${eventId}/dashboard?from=2026-10-17&to=2026-10-17`);

  const report = page.locator('.product-sales-breakdown');
  await expect(report.getByRole('heading', { name: 'Product sales breakdown' })).toBeVisible();
  await expect(report.getByText('1 product found')).toBeVisible();
  const parentRow = report.locator('.product-sales-parent-row');
  await expect(parentRow).toContainText('Original set');
  await expect(parentRow.locator('td').nth(2)).toHaveText('2');
  await expect(parentRow.locator('td').nth(3)).toContainText('300');
  await expect(parentRow.locator('td').nth(4)).toContainText('30');
  await expect(parentRow.locator('td').nth(6)).toContainText('270');
  await report.getByRole('button', { name: 'Expand Original set variants' }).click();
  await expect(report.locator('.product-sales-variant-row')).toHaveCount(2);
  await expect(report.locator('.product-sales-variant-row').first()).toContainText('Option A');
  await expect(report.locator('.product-sales-variant-row').last()).toContainText('OLD-B');

  await report.getByRole('searchbox', { name: 'Search product or SKU' }).fill('OLD-B');
  await expect(report.getByText('1 product found')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await report.getByRole('button', { name: 'Export product CSV' }).click();
  const download = await downloadPromise;
  const csvPath = testInfo.outputPath('product-sales.csv');
  await download.saveAs(csvPath);
  const csv = await readFile(csvPath, 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xFEFF);
  expect(csv).toContain('"Product","Variant","SKU"');
  expect(csv).toContain('"Original set","Option B","OLD-B"');
  expect(csv).toContain('"20","","180","THB"');

  await page.screenshot({ path: testInfo.outputPath('product-sales-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(report.locator('article')).toBeVisible();
  await expect(report.locator('.product-sales-table-wrap')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('product-sales-mobile.png'), fullPage: true });
});
