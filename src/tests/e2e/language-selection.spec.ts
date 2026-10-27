import { selectLanguage } from '../helpers/languageMenu';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureOwnerArtistFixture } from '../helpers/adminFixture';
import { LoginPage } from './pages/LoginPage';

const runId = randomUUID();
const email = `language-${runId}@example.test`;
const password = 'LocalLanguageOnly123!';
const slug = `language-${runId.slice(0, 8)}`;
const eventId = randomUUID();
const productId = randomUUID();
let service: SupabaseClient;
let artistId = '';

test.beforeAll(async () => {
  if (!process.env.SUPABASE_WORKDIR) throw new Error('Language regression requires disposable local Supabase');
  const fixture = await ensureOwnerArtistFixture({ email, password, slug, displayName: 'Home' });
  service = fixture.service;
  artistId = fixture.userId;
  await service.from('events').insert({
    id: eventId, artist_id: artistId, event_name: 'Queue', status: 'Confirmed', is_booth_open: true,
    start_date: new Date(Date.now() - 3_600_000).toISOString(),
    end_date: new Date(Date.now() + 86_400_000).toISOString(), event_timezone: 'Asia/Bangkok',
    location: 'Home', booth_detail: 'Menu',
  }).throwOnError();
});

test.afterAll(async () => {
  if (!service || !artistId) return;
  await service.from('event_products').delete().eq('event_id', eventId).throwOnError();
  await service.from('products').delete().eq('artist_id', artistId).throwOnError();
  await service.from('events').delete().eq('id', eventId).throwOnError();
  await service.from('artists').delete().eq('id', artistId).throwOnError();
  const result = await service.auth.admin.deleteUser(artistId);
  if (result.error) throw result.error;
});

test('TH/EN dropdown changes the workspace, survives navigation/reload and preserves merchant content', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const login = new LoginPage(page);
  await login.goto();
  await login.login(email, password);
  await expect(page.getByRole('heading', { level: 1, name: 'Queue', exact: true })).toBeVisible({ timeout: 30_000 });
  const headingBounds = await page.getByRole('heading', { level: 1, name: 'Queue', exact: true }).boundingBox();
  const eventNavBounds = await page.getByRole('navigation', { name: 'Event sections', exact: true }).boundingBox();
  expect(headingBounds).not.toBeNull();
  expect(eventNavBounds).not.toBeNull();
  expect(headingBounds!.y + headingBounds!.height).toBeLessThan(eventNavBounds!.y);
  await selectLanguage(page, 'th');
  await expect(page.getByRole('button', { name: /^ภาษา:/ })).toHaveAttribute('data-language', 'th');
  await expect(page.getByRole('heading', { name: 'ตั้งค่าให้ครบ ก่อนเริ่มขาย', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Queue', exact: true })).toBeVisible();
  await expect(page.getByText('Home', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'เตรียมงาน', exact: true })).toBeVisible();
  await expect(page.getByText('ยังไม่มีสินค้าในงาน', { exact: true })).toBeVisible();
  await expect(page.getByText('เลือกเปิดใช้ได้', { exact: true })).toBeVisible();
  await expect(page.getByText('ไม่มีรายการรอรับสินค้า', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'โปรโมชัน', exact: true }).first()).toBeVisible();
  if (process.env.NIREQ_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.NIREQ_SCREENSHOT_DIR}/NireQ-Language-TH.png`, fullPage: true });
    await selectLanguage(page, 'en');
    await expect(page.getByRole('heading', { name: 'Set up before you start selling', exact: true })).toBeVisible();
    await page.screenshot({ path: `${process.env.NIREQ_SCREENSHOT_DIR}/NireQ-Language-EN.png`, fullPage: true });
    await selectLanguage(page, 'th');
  }

  await page.getByRole('button', { name: 'แคตตาล็อก', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'คลังสินค้า', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^ภาษา:/ })).toHaveAttribute('data-language', 'th');
  await selectLanguage(page, 'en');
  await expect(page.getByRole('heading', { name: 'Product catalog', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /^Language:/ })).toHaveAttribute('data-language', 'en');
  await page.goto(`/manage-events/${eventId}/workspace`);
  await selectLanguage(page, 'th');
  await expect(page.getByRole('heading', { name: 'ตั้งค่าให้ครบ ก่อนเริ่มขาย', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('public login and legal pages follow the selected language after reload', async ({ page }) => {
  await page.goto('/manage-login');
  await selectLanguage(page, 'th');
  await expect(page.getByRole('tab', { name: 'ผู้ขาย / ผู้จัดการ', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /^ภาษา:/ })).toHaveAttribute('data-language', 'th');
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1, name: 'นโยบายความเป็นส่วนตัว', exact: true })).toBeVisible();
  await selectLanguage(page, 'en');
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payment evidence', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('switching POS language preserves the cart and total without requesting a new promotion quote', async ({ page }) => {
  test.setTimeout(90_000);
  await service.from('products').insert({ id: productId, artist_id: artistId, name: 'Menu', price: 150, currency: 'THB', category: 'Other', stock_total: 3, is_unlimited: false, status: 'enable' }).throwOnError();
  await service.from('event_products').insert({ event_id: eventId, product_id: productId, artist_id: artistId, stock_total: 3, is_unlimited: false, is_enabled: true }).throwOnError();
  const login = new LoginPage(page);
  await login.goto();
  await login.login(email, password);
  await expect(page).toHaveURL(/manage-events/, { timeout: 30_000 });
  let releaseOrderRead!: () => void;
  const orderRead = new Promise<void>(resolve => { releaseOrderRead = resolve; });
  await page.route('**/rest/v1/orders?*', async route => {
    await orderRead;
    await route.continue();
  });
  await page.goto(`/live/pos?eventId=${eventId}`);
  let quotes = 0;
  page.on('request', request => { if (request.url().includes('/rpc/quote_sale_promotions')) quotes++; });
  const item = page.getByRole('region', { name: /Product list|Product grid/ }).getByRole('button').filter({ has: page.getByRole('heading', { name: 'Menu', exact: true }) }).first();
  await expect(item).toBeVisible({ timeout: 30000 });
  await expect(item).toBeDisabled();
  releaseOrderRead();
  await expect(item).toBeEnabled();
  await item.click();
  await expect(page.getByRole('button', { name: 'Charge ฿150', exact: true })).toBeEnabled();
  const before = quotes;
  expect(before).toBe(1);
  await selectLanguage(page, 'th');
  await expect(page.getByRole('button', { name: 'รับชำระ ฿150', exact: true })).toBeEnabled();
  await expect(page.getByRole('region', { name: 'ตะกร้าสินค้า', exact: true }).getByText('Menu', { exact: true })).toBeVisible();
  await selectLanguage(page, 'en');
  await expect(page.getByRole('button', { name: 'Charge ฿150', exact: true })).toBeEnabled();
  expect(quotes).toBe(before);
});

test('all event menus show the event before navigation and action feedback closes after two seconds', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto('/manage-login');
  await new LoginPage(page).login(email, password);
  await expect(page).not.toHaveURL(/manage-login/);
  await selectLanguage(page, 'en');
  const menus = [
    ['workspace', 'overview', 'Prepare event'], ['catalog', 'catalog', 'Products & stock'],
    ['preorder', 'settings', 'Schedule & payment'], ['promotion', 'promotion', 'Promotions'],
    ['preorder-dashboard', 'preorder', 'Pre-orders'], ['postorder-dashboard', 'postorder', 'Post-orders'],
    ['pickup', 'pickup', 'Pickup'], ['dashboard', 'dashboard', 'Sales'], ['history', 'history', 'History'],
  ];
  for (const [path, key, label] of menus) {
    await page.goto(`/manage-events/${eventId}/${path}`);
    const context = page.locator(`[data-event-context="${eventId}"]`);
    await expect(context.getByRole('heading', { level: 1, name: 'Queue', exact: true })).toBeVisible();
    await expect(context.getByText(`Current page · ${label}`, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Events', exact: true }).first()).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', { name: 'Catalog', exact: true }).first()).not.toHaveAttribute('aria-current', 'page');
    const nav = context.getByRole('navigation', { name: 'Event sections' });
    await expect(nav.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    const titleBounds = await context.getByRole('heading', { level: 1 }).boundingBox();
    const navBounds = await nav.boundingBox();
    expect(titleBounds!.y + titleBounds!.height).toBeLessThan(navBounds!.y);
    await page.setViewportSize({ width: 375, height: 900 });
    await expect(nav.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    if (key === 'catalog') await page.screenshot({ path: testInfo.outputPath('event-context.png'), fullPage: true });
  }
  await page.goto(`/manage-events/${eventId}/preorder`);
  await page.clock.install();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  const toast = page.getByRole('status').filter({ hasText: 'Order settings saved' });
  await expect(toast).toBeVisible();
  await page.clock.fastForward(1500);
  await expect(toast).toBeVisible();
  await page.clock.fastForward(600);
  await expect(toast).toHaveCount(0);
  await selectLanguage(page, 'th');
  await expect(page.locator(`[data-event-context="${eventId}"]`)).toContainText('หน้าปัจจุบัน · ช่วงขายและรับเงิน');
});
