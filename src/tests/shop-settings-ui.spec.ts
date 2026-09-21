import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';

test('profile saves independently from events and reports failed saves', async ({ page }) => {
  const email = 'shop-settings-ui@nireq.local';
  const password = 'LocalShopSettings123!';
  await ensureOwnerArtistFixture({ email, password, slug: 'shop-settings-ui', displayName: 'Settings UI' });
  await page.goto('/manage-login');
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.getByTestId('creator-login-submit').click();
  await expect(page).not.toHaveURL(/manage-login/);
  await page.goto('/manage-events?tab=profile');
  await expect(page.getByRole('heading', { name: 'Your public shop profile' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Event Workspaces' })).toHaveCount(0);
  await page.locator('#artist-bio').fill('Shop profile UI verification');
  await page.getByRole('button', { name: 'Save Updates' }).click();
  await expect(page.getByRole('status')).toContainText('Shop profile saved.');
  await page.reload();
  await expect(page.locator('#artist-bio')).toHaveValue('Shop profile UI verification');
  await page.route('**/rest/v1/artists?*', async route => {
    if (route.request().method() === 'PATCH') await route.fulfill({ status: 503, json: { message: 'Unavailable' } });
    else await route.continue();
  });
  await page.locator('#artist-bio').fill('Unsaved draft');
  await page.getByRole('button', { name: 'Save Updates' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save');
  await expect(page.locator('#artist-bio')).toHaveValue('Unsaved draft');
  await page.getByRole('button', { name: 'Switch language', exact: true }).click();
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: '/tmp/shop-settings-ui.png', fullPage: true });
});

test('help and legal navigation are public, bilingual and accessible', async ({ page }) => {
  for (const path of ['/help', '/privacy', '/terms', '/cookies']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    if (path === '/help') {
      await page.getByText('How do I prepare my shop?', { exact: true }).click();
      await expect(page.getByText('Set your shop name', { exact: false })).toBeVisible();
    } else {
      await page.getByRole('navigation', { name: 'On this page' }).getByRole('link').last().click();
      await expect(page).toHaveURL(/#section-/);
    }
    await page.setViewportSize({ width: 320, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('.public-entry').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  }
  await page.getByRole('button', { name: 'Switch language' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('การใช้คุกกี้และพื้นที่จัดเก็บ');
});
