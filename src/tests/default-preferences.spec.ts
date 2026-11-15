import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';
import { selectLanguage } from './helpers/languageMenu';

test.use({ storageState: { cookies: [], origins: [] } });

test('first visit defaults to Thai and remembers explicit language', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'th');
  await expect(page.getByRole('button', { name: /^ภาษา:/ })).toBeVisible();
  await selectLanguage(page, 'en');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.goto('/manage-login');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await selectLanguage(page, 'th');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'th');
});

test('product views default to cards and persist independently across pages', async ({ page }, testInfo) => {
  if (!['127.0.0.1', 'localhost'].includes(new URL(resolveSupabaseTestEnv().url).hostname)) throw new Error('Product preference fixtures require disposable local Supabase');
  const id = randomUUID();
  const email = `view-${id}@example.test`;
  const password = 'LocalViewPreference123!';
  const fixture = await ensureOwnerArtistFixture({ email, password, slug: `view-${id.slice(0, 8)}`, displayName: 'View fixture' });
  const eventIds = [randomUUID(), randomUUID()];
  const now = Date.now();
  const eventRows = eventIds.map(eventId => ({ id: eventId, artist_id: fixture.userId, event_name: 'View event', start_date: new Date(now - 3600000).toISOString(), end_date: new Date(now + 86400000).toISOString(), status: 'Confirmed' }));
  const events = await fixture.service.from('events').insert(eventRows);
  if (events.error) throw events.error;
  const campaignIds = [randomUUID(), randomUUID()];
  const campaigns = await fixture.service.from('online_campaigns').insert(campaignIds.map((campaignId, index) => ({ id: campaignId, artist_id: fixture.userId, name: 'View campaign', slug: `view-${id.slice(0, 8)}-${index}`, opens_at: new Date(now - 60000).toISOString(), closes_at: new Date(now + 86400000).toISOString() })));
  if (campaigns.error) throw campaigns.error;
  const product = await fixture.service.from('products').insert({ artist_id: fixture.userId, name: 'View product', price: 100, stock_total: 10, is_unlimited: false, status: 'enable' });
  if (product.error) throw product.error;
  try {
    await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
    await page.goto('/manage-login');
    await page.locator('input[type=email]').fill(email);
    await page.locator('input[type=password]').fill(password);
    await page.locator('button[type=submit]').click();
    await expect(page).not.toHaveURL(/manage-login/);
    for (const width of [390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/manage-products');
      await expect(page.getByRole('button', { name: 'Product cards', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByText('View product', { exact: true }).first()).toBeVisible();
      await page.getByRole('button', { name: 'Product cards', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`catalog-first-${width}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.getByRole('button', { name: 'Table', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search products' }).fill('View');
    await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('combobox', { name: 'Sort products by' }).click();
    await page.getByRole('option', { name: 'Price (Low to High)' }).click();
    await page.getByRole('combobox', { name: 'Filter by catalog focus' }).click();
    await page.getByRole('option', { name: /^Inactive/ }).click();
    await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.goto(`/manage-events/${eventIds[0]}/catalog`);
    await expect(page.getByRole('button', { name: 'Visual', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => localStorage.setItem('paimon-product-view-event', 'invalid'));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Visual', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: 'View product', exact: true }).first()).toBeVisible();
    for (const width of [390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: 'Visual', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`event-first-${width}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.getByRole('button', { name: 'Operations', exact: true }).click();
    await page.goto(`/manage-events/${eventIds[1]}/catalog`);
    await expect(page.getByRole('button', { name: 'Operations', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Visual', exact: true }).click();
    await page.goto(`/manage-online-sales/${campaignIds[0]}`);
    await page.getByRole('button', { name: 'Products', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Product cards', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('View product', { exact: true }).first()).toBeVisible();
    for (const width of [390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: 'Product cards', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`campaign-first-${width}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.getByRole('button', { name: 'Table', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Products', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.goto(`/manage-online-sales/${campaignIds[1]}`);
    await page.getByRole('button', { name: 'Products', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.goto('/manage-products');
    await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.goto(`/manage-events/${eventIds[0]}/catalog`);
    await expect(page.getByRole('button', { name: 'Visual', exact: true })).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await fixture.service.from('online_campaigns').delete().in('id', campaignIds);
    await fixture.service.from('events').delete().in('id', eventIds);
    await fixture.service.from('products').delete().eq('artist_id', fixture.userId);
    await fixture.service.from('artists').delete().eq('id', fixture.userId);
    await fixture.service.auth.admin.deleteUser(fixture.userId);
  }
});
