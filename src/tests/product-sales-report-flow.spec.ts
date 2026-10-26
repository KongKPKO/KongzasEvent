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
const images = Array.from({ length: 6 }, (_, index) => `https://report-images.example.test/image-${index + 1}.svg`);
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
  const parent = await service.from('product_parents').insert({ artist_id: artistId, name: 'Original set', category: 'Print', base_price: 100, product_kind: 'photo' }).select('id').single();
  must(parent);
  parentId = parent.data!.id;
  const products = await service.from('products').insert([
    { artist_id: artistId, parent_product_id: parentId, name: 'Current set — New A', variant_name: 'New A', variant_gallery_images: images.slice(0, 5), variant_group_name: 'Current set', sku: `CURRENT-A-${runId.slice(0, 6)}`, price: 100, is_unlimited: true, status: 'enable' },
    { artist_id: artistId, parent_product_id: parentId, name: 'Current set — New B', variant_name: 'New B', variant_gallery_images: images.slice(5), variant_group_name: 'Current set', sku: `CURRENT-B-${runId.slice(0, 6)}`, price: 200, is_unlimited: true, status: 'enable' },
  ]).select('id');
  must(products);
  productIds = products.data!.map((item) => item.id);
  must(await service.from('events').insert({ id: eventId, artist_id: artistId, event_name: 'Product report event', start_date: '2026-10-16T00:00:00Z', end_date: '2026-10-20T00:00:00Z', event_timezone: 'Asia/Bangkok', status: 'Confirmed' }));
  const order = await service.from('orders').insert({ event_id: eventId, status: 'completed', total_price: 270, subtotal_price: 300, discount_total: 30, pricing_breakdown: [{ ruleId: 'saved-offer', label: 'Saved 10 percent', discountAmount: 30 }], payment_method: 'cash', currency: 'THB', created_at: '2026-10-17T03:00:00Z' }).select('id').single();
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
  const loadedImages = new Set<string>();
  await page.route('https://report-images.example.test/**', route => {
    loadedImages.add(route.request().url());
    return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160"><rect width="120" height="160" fill="pink"/></svg>' });
  });
  await new LoginPage(page).goto();
  await new LoginPage(page).login(email, password);
  await expect(page).toHaveURL(/manage-events/, { timeout: 20_000 });
  await page.route('**/rest/v1/orders?**', route => route.abort());
  await page.goto(`/manage-events/${eventId}/dashboard?from=2026-10-17&to=2026-10-17`);

  const metrics = page.locator('.report-metrics').first().locator(':scope > div');
  await expect(metrics).toHaveCount(4);
  const metricAppearance = () => metrics.first().evaluate(element => {
    const css = getComputedStyle(element);
    return { padding: css.paddingLeft, background: css.backgroundColor, border: css.borderTopColor, accent: css.borderTopWidth };
  });
  await expect.poll(metricAppearance).toEqual({ padding: '16px', background: 'rgb(255, 255, 255)', border: 'rgb(40, 103, 158)', accent: '3px' });
  const queuePanel = page.locator('details.report-panel').first();
  await queuePanel.locator('summary').click();
  await expect.poll(() => queuePanel.evaluate(element => ({ padding: getComputedStyle(element).paddingLeft, background: getComputedStyle(element).backgroundColor }))).toEqual({ padding: '24px', background: 'rgb(255, 255, 255)' });
  await expect(page.locator('.report-metrics').nth(1).locator(':scope > div').first()).toHaveCSS('padding-left', '16px');
  await page.screenshot({ path: testInfo.outputPath('sales-summary-desktop.png'), fullPage: true });
  const report = page.locator('.product-sales-breakdown');
  await expect(report.getByRole('heading', { name: 'Product sales breakdown' })).toBeVisible();
  await expect(report.getByText('1 product found')).toBeVisible();
  const parentRow = report.locator('.product-sales-parent-row');
  await expect(parentRow).toContainText('Original set');
  await expect(parentRow.locator('td').nth(2)).toHaveText('2');
  await expect(parentRow.locator('td').nth(3)).toContainText('300');
  await expect(parentRow.locator('td')).toHaveCount(4);
  await expect(report.getByRole('columnheader', { name: 'Discount', exact: true })).toHaveCount(0);
  const promotions = page.getByRole('region', { name: 'Promotion usage', exact: true });
  await expect(promotions).toContainText('Saved 10 percent');
  await expect(promotions).toContainText('Used in 1 order');
  await expect(promotions).toContainText('30');
  const search = report.getByRole('searchbox', { name: 'Search products' });
  expect(await search.evaluate(input => parseFloat(getComputedStyle(input).paddingLeft))).toBeGreaterThanOrEqual(40);
  const galleryTrigger = parentRow.getByRole('button', { name: 'View all 6 images of Original set' });
  await expect(galleryTrigger.locator('img')).toHaveCount(4);
  await expect(galleryTrigger).toContainText('+2');
  expect(loadedImages.has(images[4])).toBe(false);
  await galleryTrigger.click();
  const gallery = page.getByRole('dialog', { name: 'Product images: Original set', exact: true });
  await expect(gallery).toBeVisible();
  await expect(gallery.locator('img')).toHaveCount(1);
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight');
  await expect(gallery.locator('img')).toHaveAttribute('src', images[4]);
  await expect.poll(() => loadedImages.has(images[4])).toBe(true);
  await page.keyboard.press('Escape');
  await expect(gallery).toHaveCount(0);
  await expect(galleryTrigger).toBeFocused();
  await report.getByRole('button', { name: 'Expand Original set variants' }).click();
  await expect(report.locator('.product-sales-variant-row')).toHaveCount(2);
  await expect(report.locator('.product-sales-variant-row').first()).toContainText('Option A');
  await expect(report.locator('.product-sales-variant-row').last()).toContainText('OLD-B');
  await expect(report.locator('.product-sales-variant-row').first().getByRole('button', { name: 'View all 5 images of Option A' })).toBeVisible();
  await expect(report.locator('.product-sales-variant-row').last().getByRole('button', { name: 'View all 1 images of Option B' })).toBeVisible();

  await report.getByRole('searchbox', { name: 'Search products' }).fill('OLD-B');
  await expect(report.getByText('1 product found')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await report.getByRole('button', { name: 'Export product CSV' }).click();
  const download = await downloadPromise;
  const csvPath = testInfo.outputPath('product-sales.csv');
  await download.saveAs(csvPath);
  const csv = await readFile(csvPath, 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xFEFF);
  expect(csv).toContain('"Product","Variant","Product code"');
  expect(csv).toContain('"Original set","Option B","OLD-B"');
  expect(csv).toContain('"1","200","THB"');
  expect(csv).not.toContain('Allocated discount');

  await page.screenshot({ path: testInfo.outputPath('product-sales-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(report.locator('article')).toBeVisible();
  await expect(metrics.first()).toHaveCSS('padding-left', '16px');
  await expect(queuePanel).toHaveCSS('padding-left', '16px');
  await report.locator('article').getByRole('button', { name: 'View all 6 images of Original set' }).click();
  await expect(gallery).toBeVisible();
  expect(await gallery.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(390);
  await gallery.getByRole('button', { name: 'Close product images' }).click();
  await expect(gallery).toHaveCount(0);
  await expect(report.locator('.product-sales-table-wrap')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('product-sales-mobile.png'), fullPage: true });
  await page.route('**/rest/v1/products?**', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Media unavailable for test' }) }));
  await page.reload();
  await expect(report.getByRole('status').filter({ hasText: 'Additional product images could not load' })).toBeVisible();
  await expect(report.locator('article')).toContainText('300');
  await page.unroute('**/rest/v1/orders?**');
  await page.goto(`/manage-events/${eventId}/history`);
  await page.locator('.report-order summary').first().click();
  await expect(page.getByRole('region', { name: 'Promotions used in this order' })).toContainText('Saved 10 percent');
  const totals = page.getByRole('region', { name: 'Filtered totals' });
  await expect(totals).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(totals).toHaveCSS('padding-left', '16px');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(totals).toHaveCSS('padding-left', '24px');
});
