import { selectLanguage } from './helpers/languageMenu';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('creator discovery recovers from failures and preserves useful filters', async ({ page }) => {
  let failed = true;
  const rows = [
    { artist_id: 'mali', slug: 'mali-studio', display_name: 'Mali Studio', accepts_queue: true, is_booth_open: true, event_name: 'Art Fair', booth_detail: 'A12', has_online_shop: false, products: [{ id: 'art-one', artist_id: 'mali', name: 'Mali print', price: 10 }] },
    { artist_id: 'paper', slug: 'paper-moon', display_name: 'Paper Moon', accepts_queue: false, is_booth_open: false, event_name: '', has_online_shop: false, products: [] },
  ];
  await page.route('**/rest/v1/rpc/get_public_shop_directory', route => {
    if (failed) return route.fulfill({ status: 503, json: { message: 'Unavailable' } });
    const q = route.request().postDataJSON() as { p_query: string; p_open: boolean; p_queue: boolean; p_products: boolean };
    const matches = rows.filter(row => (!q.p_query || JSON.stringify(row).toLowerCase().includes(q.p_query.toLowerCase())) && (!q.p_open || row.is_booth_open) && (!q.p_queue || row.accepts_queue) && (!q.p_products || row.products.length));
    return route.fulfill({ json: { rows: matches, total: matches.length } });
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Could not load shops');
  failed = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByTestId('creator-card')).toHaveCount(2);
  await page.getByTestId('public-creator-search').fill('A12');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/discover\/shops.*q=A12/);
  await expect(page.getByTestId('creator-card')).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId('public-creator-search')).toHaveValue('A12');
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.getByTestId('public-open-now-filter').click();
  await expect(page.getByTestId('creator-card')).toHaveCount(1);
  await page.getByTestId('public-creator-search').fill('Paper');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByTestId('creator-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show all shops' }).click();
  await expect(page.getByTestId('creator-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Has queue', exact: true }).click();
  await expect(page.getByTestId('creator-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Has products', exact: true }).click();
  await expect(page.getByTestId('creator-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Like this creator shop: Mali Studio' }).click();
  await expect(page.getByRole('button', { name: 'Like this creator shop: Mali Studio' })).toHaveAttribute('aria-pressed', 'true');
  await selectLanguage(page, 'th');
  await expect(page.getByRole('heading', { name: 'ค้นหาร้านค้า', exact: true })).toBeVisible();
  for (const width of [320, 375, 414, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.locator('.public-entry').evaluate(el => el.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test('public entry pages fit small screens and retain accessible form controls', async ({ page }) => {
  for (const path of ['/', '/discover/shops', '/for-sellers', '/manage-login', '/creator/register', '/staff-signup']) {
    await page.goto(path);
    await expect(page.locator('.public-entry')).toBeVisible();
    for (const width of [320, 375, 414, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.locator('.public-entry').evaluate(el => el.scrollWidth), JSON.stringify(await page.locator('.public-entry').evaluate(el => [...el.querySelectorAll('*')].filter(node => node.getBoundingClientRect().right > innerWidth).map(node => [node.className, Math.round(node.getBoundingClientRect().right)])))).toBeLessThanOrEqual(width);
    }
    const results = await new AxeBuilder({ page }).include('.public-entry').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations).toEqual([]);
    await page.screenshot({ path: `/tmp/nireq-entry-${path.replace(/\//g, '') || 'home'}.png`, fullPage: true });
  }
  await page.goto('/manage-login');
  await page.getByRole('checkbox', { name: 'Show password' }).check();
  await expect(page.locator('#login-password')).toHaveAttribute('type', 'text');
  await page.goto('/creator/register');
  await expect(page.locator('#creator-website')).toBeHidden();
  await page.getByText('More social links (optional)', { exact: true }).click();
  await expect(page.locator('#creator-website')).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: '/tmp/nireq-entry-register-mobile.png', fullPage: true });
});

test('seller landing links to registration', async ({ page }) => {
  await page.goto('/for-sellers');
  await expect(page.getByRole('heading', { name: 'Prepare your shop for every stage of the event' })).toBeVisible();
  for (const width of [320, 375, 1280]) {
    await page.setViewportSize({ width, height: 812 });
    expect(await page.locator('.public-entry').evaluate(el => el.scrollWidth)).toBeLessThanOrEqual(width);
  }
  expect((await new AxeBuilder({ page }).include('.public-entry').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await expect(page.getByRole('heading', { name: 'Run an online sale between events' })).toBeVisible();
  await selectLanguage(page, 'th');
  await expect(page.getByRole('heading', { name: 'ไม่มีอีเวนต์ ก็เปิดรอบขายได้' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'จัดโปรโมชั่นให้เหมาะกับแต่ละรอบขาย' })).toBeVisible();
  const customerCards = page.locator('.seller-customer-grid article');
  await expect(customerCards).toHaveCount(5);
  for (const card of await customerCards.all()) {
    const screenshot = card.locator('img');
    await screenshot.scrollIntoViewIfNeeded();
    await expect.poll(() => screenshot.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  }
  await expect(page.getByRole('heading', { name: 'ทำ QR สำหรับติดที่บูธ' })).toBeVisible();
  await expect(page.getByText(/QR ของหน้าร้านไม่ได้ล็อกอีเวนต์/)).toBeVisible();
  const image = page.getByRole('img', { name: 'ตัวอย่างหน้าจัดการแคมเปญออนไลน์ของร้านจำลอง' });
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await selectLanguage(page, 'en');
  await page.getByRole('link', { name: 'Register your shop' }).first().click();
  await expect(page).toHaveURL(/\/creator\/register$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
});
