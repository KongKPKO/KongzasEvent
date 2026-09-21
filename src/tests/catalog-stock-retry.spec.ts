import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

test('stock receipt survives lost response and reload without a second increment', async ({ page }) => {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(resolveSupabaseTestEnv().url)) throw new Error('Local database required');
  const suffix = randomUUID().slice(0, 12), productId = randomUUID();
  const email = `stock-${suffix}@example.com`, password = 'LocalStockTest123!';
  const { userId, service } = await ensureOwnerArtistFixture({ email, password, slug: `stock-${suffix}`, displayName: 'Stock retry test' });
  const must = (result: { error: unknown }) => { if (result.error) throw result.error; };
  try {
    must(await service.from('products').insert({ id: productId, artist_id: userId, name: 'Receipt test product', price: 50, stock_total: 20, is_unlimited: false, status: 'enable' }));
    await page.addInitScript(() => { localStorage.setItem('nireq-language', 'en'); localStorage.setItem('nireq-replay-consent-v1', 'rejected'); });
    await page.goto('/manage-login');
    await page.locator('input[type=email]').fill(email);
    await page.locator('input[type=password]').fill(password);
    await page.getByRole('button', { name: /Login/i }).click();
    await expect(page).toHaveURL(/manage-events/);
    await page.goto('/manage-products');
    await page.getByRole('button', { name: 'Adjust stock', exact: true }).first().click();
    await page.getByLabel('Quantity', { exact: true }).fill('7');
    await page.route('**/rest/v1/rpc/adjust_catalog_stock', async route => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort('connectionreset');
    });
    await page.getByRole('button', { name: 'Save receipt', exact: true }).click();
    await expect.poll(async () => (await service.from('products').select('stock_total').eq('id', productId).single()).data?.stock_total).toBe(27);
    await page.reload();
    await page.unroute('**/rest/v1/rpc/adjust_catalog_stock');
    await page.getByRole('button', { name: 'Adjust stock', exact: true }).first().click();
    await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('7');
    await page.getByRole('button', { name: 'Save receipt', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await service.from('products').select('stock_total').eq('id', productId).single()).data?.stock_total).toBe(27);
    expect((await service.from('catalog_stock_movements').select('id').eq('product_id', productId)).data).toHaveLength(1);
    await page.getByRole('button', { name: 'Adjust stock', exact: true }).first().click();
    await expect(page.getByText('Stock received', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Close stock adjustment', exact: true }).click();
    await page.getByRole('button', { name: 'More actions for Receipt test product', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Stock history', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('20 → 27');
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.getByRole('button', { name: 'More actions for Receipt test product', exact: true }).first().click();

    await page.getByRole('menuitem', { name: 'Edit product', exact: false }).click();
    // Another staff device receives stock while this metadata form stays open.
    must(await service.from('products').update({ stock_total: 30 }).eq('id', productId));
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Edit Product', exact: true })).toHaveCount(0);
    expect((await service.from('products').select('stock_total').eq('id', productId).single()).data?.stock_total).toBe(30);

  } finally {
    must(await service.from('artists').delete().eq('id', userId));
    must(await service.auth.admin.deleteUser(userId));
  }
});
