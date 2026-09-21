import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('creator discovery recovers from failures and preserves useful filters', async ({ page }) => {
  let failed = true;
  await page.route('**/rest/v1/artists?*', route => route.fulfill({ status: failed ? 503 : 200, json: failed ? { message: 'Unavailable' } : [
    { id: 'mali', slug: 'mali-studio', display_name: 'Mali Studio', is_queue_open: true, published_at: '2026-01-01' },
    { id: 'paper', slug: 'paper-moon', display_name: 'Paper Moon', published_at: '2026-01-01' },
  ] }));
  await page.route('**/rest/v1/events?*', route => route.fulfill({ json: [
    { id: 'fair', artist_id: 'mali', event_name: 'Art Fair', location: 'Bangkok', booth_detail: 'A12', is_booth_open: true },
  ] }));
  await page.route('**/rest/v1/products?*', route => route.fulfill({ json: [{ id: 'art-one', artist_id: 'mali', name: 'Mali print', image_url: null, category: 'Art' }] }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Could not load creators');
  failed = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByTestId('creator-card')).toHaveCount(2);
  await page.getByTestId('public-creator-search').fill('A12');
  await expect(page.getByTestId('creator-card')).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId('public-creator-search')).toHaveValue('A12');
  await expect(page.getByTestId('creator-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.getByTestId('public-open-now-filter').click();
  await expect(page.getByTestId('creator-card')).toHaveCount(1);
  await page.getByTestId('public-creator-search').fill('Paper');
  await expect(page.getByTestId('creator-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show all creators' }).click();
  await expect(page.getByTestId('creator-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Has queue', exact: true }).click();
  await expect(page.getByTestId('creator-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Has products', exact: true }).click();
  await expect(page.getByTestId('creator-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Like this creator on this page: Mali Studio' }).click();
  await expect(page.getByRole('button', { name: 'Like this creator on this page: Mali Studio' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Illustrative booth · example data')).toBeVisible();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('#discovery-results')).toBeFocused();
  await page.getByRole('button', { name: 'All events', exact: true }).click();
  await expect(page.getByTestId('creator-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Switch language' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('ค้นหาบูธครีเอเตอร์');
  for (const width of [320, 375, 414, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.locator('.public-entry').evaluate(el => el.scrollWidth), JSON.stringify(await page.locator('.public-entry').evaluate(el => [...el.querySelectorAll('*')].filter(node => node.getBoundingClientRect().right > innerWidth).map(node => [node.className, Math.round(node.getBoundingClientRect().right)])))).toBeLessThanOrEqual(width);
  }
  await page.screenshot({ path: '/tmp/nireq-discovery-th.png', fullPage: true });
});

test('public entry pages fit small screens and retain accessible form controls', async ({ page }) => {
  for (const path of ['/', '/manage-login', '/creator/register', '/staff-signup']) {
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
