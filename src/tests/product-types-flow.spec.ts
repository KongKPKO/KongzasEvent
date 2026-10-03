import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

const run = randomUUID();
const slug = `types-${run.slice(0, 8)}`;
let service: SupabaseClient;
let artistId = '';
const must = (result: { error: { message: string } | null }) => { if (result.error) throw new Error(result.error.message); };

test.beforeAll(async () => {
  if (!['127.0.0.1', 'localhost'].includes(new URL(resolveSupabaseTestEnv().url).hostname)) throw new Error('Product fixtures require disposable local Supabase');
  const fixture = await ensureOwnerArtistFixture({ email: `types-${run}@example.test`, password: 'LocalOnlyTypesPassword123!', slug, displayName: 'Product types fixture' });
  service = fixture.service;
  artistId = fixture.userId;
  const origin = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';
  const parents = [
    ...[2, 3, 4].map((count) => ({ name: `Photo set ${count}`, product_kind: 'photo', gallery_images: Array.from({ length: count }, (_, n) => `${origin}/pwa-192x192.png?photo=${n}`) })),
    { name: 'Single stand', product_kind: 'single', image_url: `${origin}/pwa-192x192.png`, gallery_images: [`${origin}/pwa-512x512.png`] },
    { name: 'Traveler bundle', product_kind: 'bundle', bundle_items: [{ name: 'Postcard', quantity: 3 }, { name: 'Badge', quantity: 1 }] },
    { name: 'Upcoming preorder', product_kind: 'preorder', preorder_closes_at: new Date(Date.now() + 86_400_000).toISOString(), preorder_eta: 'Ships in November' },
    { name: 'Closed preorder', product_kind: 'preorder', preorder_closes_at: '2000-01-01T00:00:00Z', preorder_eta: 'Past edition' },
    { name: 'Cheki session', product_kind: 'service', service_kind: 'cheki', service_duration_minutes: 10, service_slots: 20 },
  ].map((parent) => ({ gallery_images: [], bundle_items: [], ...parent, id: randomUUID(), artist_id: artistId, base_price: 120, currency: 'THB' }));
  must(await service.from('product_parents').insert(parents));
  must(await service.from('products').insert(parents.map((parent) => ({ artist_id: artistId, parent_product_id: parent.id, name: parent.name, variant_name: 'Default', price: 120,
    stock_total: 10, stock_sold: parent.product_kind === 'service' ? 7 : 0, stock_reserved: parent.product_kind === 'service' ? 1 : 0, is_unlimited: false, status: 'enable' }))));
});

test.afterAll(async () => {
  if (!service || !artistId) return;
  must(await service.from('products').delete().eq('artist_id', artistId));
  must(await service.from('product_parents').delete().eq('artist_id', artistId));
  must(await service.from('artists').delete().eq('id', artistId));
  must(await service.auth.admin.deleteUser(artistId));
});

test('cards derive exact media count, bundle contents, preorder timing and service inventory', async ({ page }) => {
  await page.goto(`/${slug}/menu`);
  const card = (name: string) => page.locator('article.shop-product').filter({ has: page.getByRole('heading', { name, exact: true }) });
  for (const count of [2, 3, 4]) {
    await expect(card(`Photo set ${count}`).locator('img')).toHaveCount(count);
    await expect(card(`Photo set ${count}`).getByText(`${count} pics`, { exact: true })).toBeVisible();
  }
  await expect(card('Single stand').locator('img')).toHaveCount(1);
  await expect(card('Traveler bundle').getByText('4 items', { exact: true })).toBeVisible();
  await card('Traveler bundle').getByRole('button', { name: /details|รายละเอียด/ }).click();
  const detail = page.getByRole('dialog');
  await expect(detail.getByText('Postcard × 3', { exact: true })).toBeVisible();
  await expect(detail.getByText('Badge × 1', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();
  await expect(card('Upcoming preorder').getByText('Ships in November', { exact: false })).toBeVisible();
  await expect(card('Upcoming preorder').getByText(/^Closes:/)).toBeVisible();
  await expect(card('Upcoming preorder').getByText(/^Left/)).toHaveCount(0);
  await expect(card('Closed preorder').getByRole('button', { name: 'Pre-order closed', exact: true })).toBeDisabled();
  await expect(card('Cheki session').getByText('Duration 10 min', { exact: true })).toBeVisible();
  await expect(card('Cheki session').getByText('20 slots per session', { exact: true })).toBeVisible();
  await card('Cheki session').getByRole('button', { name: 'Select service', exact: true }).click();
  const increase = card('Cheki session').getByRole('button', { name: /Increase/i });
  await increase.click();
  await expect(increase).toBeDisabled(); // Two units are available, independently of service display metadata.
  await page.screenshot({ path: test.info().outputPath('product-types.png'), fullPage: true });
});
