import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';
import { LoginPage } from './e2e/pages/LoginPage';

const token = randomUUID();
const email = `auto-bundle-${token}@example.local`;
const password = 'LocalAutoBundle123!';
const componentName = `Auto component ${token.slice(0, 8)}`;
const bundleName = `Auto bundle ${token.slice(0, 8)}`;
let service: SupabaseClient;
let artistId = '';

const must = (result: { error: { message: string } | null }) => {
  if (result.error) throw new Error(result.error.message);
};

test.beforeAll(async () => {
  if (!['127.0.0.1', 'localhost'].includes(new URL(resolveSupabaseTestEnv().url).hostname)) {
    throw new Error('Auto-bundle editor fixtures require disposable local Supabase');
  }
  const fixture = await ensureOwnerArtistFixture({
    email,
    password,
    slug: `auto-bundle-${token.slice(0, 8)}`,
    displayName: 'Auto bundle fixture',
  });
  service = fixture.service;
  artistId = fixture.userId;
  must(await service.from('products').insert({
    artist_id: artistId,
    name: componentName,
    price: 100,
    stock_total: 20,
    is_unlimited: false,
    status: 'enable',
  }));
});

test.afterAll(async () => {
  if (!service || !artistId) return;
  must(await service.from('products').delete().eq('artist_id', artistId).eq('product_kind', 'bundle'));
  must(await service.from('products').delete().eq('artist_id', artistId));
  must(await service.from('product_parents').delete().eq('artist_id', artistId));
  must(await service.from('artists').delete().eq('id', artistId));
  must(await service.auth.admin.deleteUser(artistId));
});

test('bundle editor saves and reloads the explicit automatic matching opt-in', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('nireq-language', 'en'));
  const login = new LoginPage(page);
  await login.goto();
  await login.login(email, password);
  await expect(page).toHaveURL(/manage-events/, { timeout: 20_000 });
  await page.goto('/manage-products');

  await page.getByRole('button', { name: 'Create bundle', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create bundle', exact: true });
  await dialog.getByLabel('Bundle name', { exact: true }).fill(bundleName);
  await dialog.getByLabel('Bundle price', { exact: true }).fill('80');
  await dialog.getByLabel('Automatically bundle matching items').check();
  await dialog.getByLabel('Search products to add').fill(componentName);
  await dialog.getByRole('button', { name: componentName, exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: '../auto-bundle-editor-mobile-local.png' });
  await dialog.getByRole('button', { name: 'Save bundle', exact: true }).click();
  await expect(dialog).toBeHidden();

  const saved = await service.from('product_parents')
    .select('id,auto_bundle_enabled')
    .eq('artist_id', artistId)
    .eq('name', bundleName)
    .single();
  must(saved);
  expect(saved.data!.auto_bundle_enabled).toBe(true);

  await page.getByRole('button', { name: `Edit ${bundleName}`, exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit bundle', exact: true });
  await expect(edit.getByLabel('Automatically bundle matching items')).toBeChecked();
});
