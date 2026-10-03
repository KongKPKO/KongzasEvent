import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';
import { LoginPage } from './e2e/pages/LoginPage';
import { toDateInputValue } from '../lib/eventAppearances';

const runId = randomUUID();
const email = `family-flow-${runId}@example.test`;
const password = 'LocalOnlyFamilyPassword123!';
const slug = `family-${runId.slice(0, 8)}`;
const name = `Traveler family ${runId.slice(0, 8)}`;
const eventId = randomUUID();
let service: SupabaseClient;
let artistId = '';

const must = (result: { error: { message: string } | null }) => {
  if (result.error) throw new Error(result.error.message);
};

test.beforeAll(async () => {
  if (!['127.0.0.1', 'localhost'].includes(new URL(resolveSupabaseTestEnv().url).hostname)) throw new Error('Family fixtures require disposable local Supabase');
  const fixture = await ensureOwnerArtistFixture({ email, password, slug, displayName: 'Family flow fixture' });
  service = fixture.service;
  artistId = fixture.userId;
  const many = await service.from('product_parents').insert({ artist_id: artistId, name: 'Many designs', base_price: 90 }).select('id').single();
  must(many);
  must(await service.from('products').insert(Array.from({ length: 30 }, (_, index) => ({ artist_id: artistId, parent_product_id: many.data!.id, name: `Design ${index + 1}`, variant_name: `Design ${index + 1}`, variant_sort_order: index, stock_total: 10, is_unlimited: false, price: 90, status: 'enable' }))));
  must(await service.from('products').insert({ artist_id: artistId, name: 'Simple service', variant_name: 'Default', price: 200, stock_total: 20, is_unlimited: false, status: 'enable' }));
  must(await service.from('events').insert({ id: eventId, artist_id: artistId, event_name: 'Cosplay family event',
    start_date: new Date(Date.now() - 3600_000).toISOString(), end_date: new Date(Date.now() + 86_400_000).toISOString(),
    event_timezone: 'Asia/Bangkok', status: 'Confirmed', is_booth_open: true }));
});

test.afterAll(async () => {
  if (!service || !artistId) return;
  must(await service.from('event_appearances').delete().eq('event_id', eventId));
  must(await service.from('event_products').delete().eq('event_id', eventId));
  must(await service.from('events').delete().eq('id', eventId));
  must(await service.from('products').delete().eq('artist_id', artistId));
  must(await service.from('product_parents').delete().eq('artist_id', artistId));
  must(await service.from('artists').delete().eq('id', artistId));
  must(await service.auth.admin.deleteUser(artistId));
});

test('creator family editor saves and reorders variants, customer sees one family and public Cosplan', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await new LoginPage(page).goto();
  await new LoginPage(page).login(email, password);
  await expect(page).toHaveURL(/manage-events/, { timeout: 15_000 });
  await page.goto('/manage-products');
  await page.getByRole('button', { name: /Add Product/i }).click();
  const editor = page.getByRole('dialog', { name: 'Create product', exact: true });
  await expect(editor).toBeVisible();
  await editor.getByLabel('Product name *', { exact: true }).fill(name);
  await editor.getByLabel('Base price *', { exact: true }).fill('120');
  await editor.getByLabel('Product type', { exact: true }).selectOption('photo');
  // Stable local images exercise actual media layout without remote assets.
  const origin = new URL(page.url()).origin;
  await editor.getByLabel('Photo gallery', { exact: true }).fill([1, 2, 3, 4, 5].map((n) => `${origin}/pwa-192x192.png?image=${n}`).join('\n'));
  await editor.getByLabel('Variant name *', { exact: true }).fill('Aether');
  await editor.getByRole('button', { name: 'Add variant', exact: true }).click();
  await editor.getByLabel('Variant name *', { exact: true }).nth(1).fill('Lumine');
  await editor.getByLabel('Stock', { exact: true }).first().fill('10');
  await editor.getByRole('button', { name: 'Apply stock', exact: true }).click();
  await editor.getByLabel('Price', { exact: true }).nth(1).fill('130');
  await editor.getByRole('button', { name: 'Move Lumine up' }).click();
  await editor.getByRole('button', { name: 'Create product', exact: true }).click();
  await expect(editor).toBeHidden({ timeout: 15_000 });

  const parentResult = await service.from('product_parents').select('*').eq('artist_id', artistId).eq('name', name).single();
  must(parentResult);
  expect(parentResult.data).toBeTruthy();
  const parent = parentResult.data!;
  const variantsResult = await service.from('products').select('*').eq('parent_product_id', parent.id).order('variant_sort_order');
  must(variantsResult);
  expect(variantsResult.data?.map((row) => row.variant_name)).toEqual(['Lumine', 'Aether']);
  expect(variantsResult.data?.map((row) => row.price)).toEqual([130, 120]);
  expect(variantsResult.data?.every((row) => row.stock_total === 10 && !row.is_unlimited)).toBe(true);

  const family = page.locator(`[data-testid="catalog-family-row-${parent.id}"], [data-testid="catalog-family-card-${parent.id}"]`);
  await expect(family).toHaveCount(1);
  await expect(family.getByText('Lumine', { exact: true })).toBeHidden();
  const optionsTrigger = family.getByRole('button', { name: 'Product options · 2 variants', exact: true });
  const cardHeight = await family.evaluate((element) => element.getBoundingClientRect().height);
  await optionsTrigger.click();
  const preview = page.getByRole('dialog', { name, exact: true });
  await expect(preview.getByText('Lumine', { exact: true })).toBeVisible();
  await expect(preview.getByText('Aether', { exact: true })).toBeVisible();
  expect(await family.evaluate((element) => element.getBoundingClientRect().height)).toBe(cardHeight);
  await preview.getByLabel('Search variants or SKU', { exact: true }).fill('Aether');
  await expect(preview.getByTestId('product-options-list').locator('article')).toHaveCount(1);
  await preview.getByLabel('Search variants or SKU', { exact: true }).fill('not-a-design');
  await expect(preview.getByText('No matching variants', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();
  await expect(optionsTrigger).toBeFocused();
  const singleCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Simple service', exact: true }) });
  await expect(singleCard.getByRole('button', { name: /Product options/ })).toHaveCount(0);
  await expect(singleCard.getByText('Default', { exact: true })).toHaveCount(0);
  await expect(singleCard.getByRole('button', { name: /Adjust stock/ })).toBeVisible();
  const manyCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Many designs', exact: true }) });
  await manyCard.getByRole('button', { name: 'Product options · 30 variants', exact: true }).click();
  const manyPreview = page.getByRole('dialog', { name: 'Many designs', exact: true });
  await expect(manyPreview.getByTestId('product-options-list').locator('article')).toHaveCount(30);
  expect(await manyPreview.getByTestId('product-options-list').evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await manyPreview.getByLabel('Search variants or SKU', { exact: true }).fill('Design 30');
  await expect(manyPreview.getByTestId('product-options-list').locator('article')).toHaveCount(1);
  await manyPreview.getByRole('button', { name: /Adjust stock/ }).click();
  await expect(manyPreview).toBeHidden();
  const stockDialog = page.getByRole('dialog');
  await expect(stockDialog).toBeVisible();
  await stockDialog.getByRole('button', { name: /Cancel|ยกเลิก/ }).click();
  await expect(stockDialog).toBeHidden();
  await manyCard.getByRole('button', { name: 'Product options · 30 variants', exact: true }).click();
  await manyPreview.getByLabel('Search variants or SKU', { exact: true }).fill('Design 30');
  await manyPreview.getByRole('button', { name: 'More actions for Design 30', exact: true }).click();
  await manyPreview.getByRole('menuitem', { name: 'Stock history', exact: true }).click();
  await expect(manyPreview).toBeHidden();
  await page.getByRole('dialog', { name: 'Stock history', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  await optionsTrigger.click();
  await preview.getByRole('button', { name: 'Edit variants', exact: true }).click();
  const edit = page.getByRole('dialog', { name: `Edit ${name}`, exact: true });
  await edit.getByLabel('Base price *', { exact: true }).fill('150');
  await edit.getByRole('button', { name: 'Save family', exact: true }).click();
  await expect(edit).toBeHidden({ timeout: 15_000 });
  const afterResult = await service.from('products').select('price,variant_name').eq('parent_product_id', parent.id).order('variant_sort_order');
  must(afterResult);
  expect(afterResult.data?.map((row) => row.price)).toEqual([130, 150]);

  must(await service.from('event_products').insert(variantsResult.data!.map((row) => ({ event_id: eventId, artist_id: artistId, product_id: row.id, is_enabled: true, stock_total: 5, is_unlimited: false }))));
  await page.goto(`/manage-events/${eventId}/workspace`);
  await page.getByRole('button', { name: 'Add appearance', exact: true }).click();
  const appearance = page.getByRole('dialog', { name: 'Event appearance', exact: true });
  await appearance.getByLabel('Character / look *', { exact: true }).fill('Frieren');
  await appearance.getByLabel('Series', { exact: true }).fill('Beyond Journey');
  await appearance.getByLabel('Date *', { exact: true }).fill(toDateInputValue(new Date().toISOString(), 'Asia/Bangkok'));
  await appearance.getByLabel('Booth', { exact: true }).fill('A12');
  await appearance.getByLabel('From', { exact: true }).fill('12:00');
  await appearance.getByLabel('Note', { exact: true }).fill('Meet after lunch');
  await appearance.locator('input[type=file]').setInputFiles('public/pwa-192x192.png');
  await appearance.getByRole('button', { name: 'Add appearance', exact: true }).click();
  await expect(appearance).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId('event-appearance-list').getByText('Frieren', { exact: true })).toBeVisible();

  const customer = await browser.newContext();
  const storefront = await customer.newPage();
  await storefront.goto(`/${slug}/home`);
  await expect(storefront.getByTestId('public-event-appearances').getByText('Frieren', { exact: true })).toBeVisible();
  await storefront.goto(`/${slug}/menu?event=${eventId}`);
  const productGroup = storefront.getByRole('article', { name, exact: true });
  await expect(productGroup).toHaveCount(1);
  await expect(productGroup.getByText('+1', { exact: true })).toBeVisible();
  await productGroup.getByRole('button', { name: 'View details: ' + name, exact: true }).click();
  const detail = storefront.getByRole('dialog');
  await expect(detail.getByRole('button', { name: 'Lumine', exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Aether', exact: true }).click();
  await expect(detail.getByRole('button', { name: 'View image 5 of 5', exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'View image 5 of 5', exact: true }).click();
  await storefront.keyboard.press('Escape');
  await expect(detail).toBeHidden();

  await page.getByRole('button', { name: 'Edit Frieren', exact: true }).click();
  await appearance.getByLabel('Show publicly').uncheck();
  await appearance.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(appearance).toBeHidden({ timeout: 15_000 });
  await storefront.goto(`/${slug}/home`);
  await expect(storefront.getByTestId('public-event-appearances')).toBeHidden();
  await customer.close();
});
