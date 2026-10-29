import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  must(await service.from('products').insert(Array.from({ length: 30 }, (_, index) => ({ artist_id: artistId, parent_product_id: many.data!.id, name: `Design ${index + 1}`, variant_group_name: 'Many designs', variant_name: `Design ${index + 1}`, variant_sort_order: index, stock_total: 10, is_unlimited: false, price: 90, status: 'enable' }))));
  must(await service.from('products').insert({ artist_id: artistId, name: 'Simple service', variant_name: 'Default', price: 200, stock_total: 20, is_unlimited: false, status: 'enable' }));
  must(await service.from('events').insert({ id: eventId, artist_id: artistId, event_name: 'Cosplay family event',
    start_date: new Date(Date.now() - 3600_000).toISOString(), end_date: new Date(Date.now() + 86_400_000).toISOString(),
    event_timezone: 'Asia/Bangkok', status: 'Confirmed', is_booth_open: true }));
});

test.afterAll(async () => {
  if (!service || !artistId) return;
  must(await service.from('event_appearances').delete().eq('event_id', eventId));
  must(await service.from('event_products').delete().eq('event_id', eventId));
  must(await service.from('queues').delete().eq('event_id', eventId));
  must(await service.from('events').delete().eq('id', eventId));
  must(await service.from('products').delete().eq('artist_id', artistId).eq('product_kind', 'bundle'));
  must(await service.from('products').delete().eq('artist_id', artistId));
  must(await service.from('product_parents').delete().eq('artist_id', artistId));
  must(await service.from('artists').delete().eq('id', artistId));
  must(await service.auth.admin.deleteUser(artistId));
});

test('compact catalog and event tables retain stock controls on desktop and mobile', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const product = await service.from('products').select('id').eq('artist_id', artistId).eq('name', 'Simple service').single();
  must(product);
  must(await service.from('event_products').upsert({ artist_id: artistId, event_id: eventId, product_id: product.data!.id, stock_total: 5, is_enabled: true, is_unlimited: false }, { onConflict: 'event_id,product_id' }));
  await new LoginPage(page).goto();
  await new LoginPage(page).login(email, password);
  await expect(page).toHaveURL(/manage-events/);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/manage-products');
    await expect(page.getByRole('heading', { name: 'Main products (2)', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Table', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Product items (31)', exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Search products', exact: true }).fill('Design 30');
    await expect(page.getByRole('heading', { name: 'Product items (30)', exact: true })).toBeVisible();
    await expect(page.getByText('30 of 31 products', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Search products', exact: true }).clear();
    const catalog = page.getByRole('region', { name: 'Product catalog table' });
    const row = catalog.getByTestId(`catalog-row-${product.data!.id}`);
    await expect(row).toBeVisible();
    if (width === 390) {
      const left = (await catalog.boundingBox())!.x + 1;
      await catalog.evaluate(element => { element.scrollLeft = 500; });
      expect((await row.locator('.catalog-compact-grid > :first-child').boundingBox())!.x).toBeCloseTo(left, 0);
    }
    await expect(row.locator('details.stock-details')).not.toHaveAttribute('open', '');
    await row.getByText('Manage stock and details').click();
    await expect(row.getByRole('button', { name: 'Track stock', exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Adjust stock', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`catalog-table-${width}.png`) });
    await page.goto(`/manage-events/${eventId}/catalog`);
    await page.getByRole('button', { name: 'Operations', exact: true }).click();
    const eventTable = page.getByRole('region', { name: 'Event products and stock table' });
    const eventRow = eventTable.locator('.event-stock-grid').filter({ hasText: 'Simple service' });
    await expect(eventRow).toBeVisible();
    if (width === 390) {
      const left = (await eventTable.boundingBox())!.x + 1;
      await eventTable.evaluate(element => { element.scrollLeft = 500; });
      expect((await eventRow.locator(':scope > :first-child').boundingBox())!.x).toBeCloseTo(left, 0);
    }
    await expect(eventRow.locator('details.stock-details')).not.toHaveAttribute('open', '');
    await eventRow.getByText('Supply and stock settings').click();
    await expect(eventRow.getByText('Supply / made to order')).toBeVisible();
    await expect(eventRow.getByLabel('Event price for Simple service')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`event-table-${width}.png`) });
  }
});

test('catalog table shows each item image and respects cleared photo galleries', async ({ page }) => {
  const singleParent = randomUUID(), photoParent = randomUUID();
  const own = randomUUID(), inherited = randomUUID(), photo = randomUUID(), cleared = randomUUID();
  const base = 'https://example.test';
  must(await service.from('product_parents').insert([
    { id: singleParent, artist_id: artistId, name: 'Image test single', base_price: 10, product_kind: 'single', image_url: `${base}/parent.png` },
    { id: photoParent, artist_id: artistId, name: 'Image test photo', base_price: 10, product_kind: 'photo', image_url: `${base}/photo-parent.png` },
  ]));
  must(await service.from('products').insert([
    { id: own, artist_id: artistId, parent_product_id: singleParent, name: 'Own image', variant_name: 'Own image', price: 10, image_url: `${base}/own.png` },
    { id: inherited, artist_id: artistId, parent_product_id: singleParent, name: 'Inherited image', variant_name: 'Inherited image', price: 10 },
    { id: photo, artist_id: artistId, parent_product_id: photoParent, name: 'Photo image', variant_name: 'Photo image', price: 10, product_kind: 'photo', variant_gallery_images: [`${base}/photo-item.png`] },
    { id: cleared, artist_id: artistId, parent_product_id: photoParent, name: 'Cleared image', variant_name: 'Cleared image', price: 10, product_kind: 'photo', variant_gallery_images: [] },
  ]));
  await new LoginPage(page).goto();
  await new LoginPage(page).login(email, password);
  await expect(page).toHaveURL(/manage-events/);
  await page.goto('/manage-products');
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(page.getByTestId(`catalog-row-${own}`).locator('img').first()).toHaveAttribute('src', /own\.png/);
  await expect(page.getByTestId(`catalog-row-${inherited}`).locator('img').first()).toHaveAttribute('src', /parent\.png/);
  await expect(page.getByTestId(`catalog-row-${photo}`).locator('img').first()).toHaveAttribute('src', /photo-item\.png/);
  await expect(page.getByTestId(`catalog-row-${cleared}`).locator('img')).toHaveCount(0);
});

test('customer can search 30 items with fixed actions and preview images on desktop and mobile', async ({ page }) => {
  const result = await service.from('products').select('id').eq('artist_id', artistId).like('name', 'Design %');
  must(result);
  must(await service.from('event_products').upsert(result.data!.map(product => ({ artist_id: artistId, event_id: eventId, product_id: product.id, stock_total: 10, is_enabled: true, is_unlimited: false })), { onConflict: 'event_id,product_id' }));
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`/${slug}/menu?event=${eventId}`);
    await page.getByRole('article', { name: 'Many designs', exact: true }).getByRole('button', { name: 'Choose item', exact: true }).click();
    const detail = page.locator('.shop-product-dialog');
    const search = detail.getByRole('searchbox', { name: 'Search items' });
    await expect(search).toBeVisible();
    const list = detail.locator('.shop-item-options');
    await expect.poll(() => list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    const purchase = detail.locator('.shop-detail-purchase');
    const initial = await purchase.boundingBox();
    await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
    const after = await purchase.boundingBox();
    expect(after!.y).toBe(initial!.y);
    expect(after!.y + after!.height).toBeLessThanOrEqual(viewport.height);
    const close = await detail.getByRole('button', { name: 'Close product detail' }).boundingBox();
    expect(close!.y).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: `../customer-items-${viewport.width}-local.png` });
    await search.fill('Design 30');
    await expect(list.getByRole('button')).toHaveCount(1);
    await list.getByRole('button', { name: 'Design 30', exact: true }).click();
    await expect(search).toHaveValue('Design 30');
    const stockRefresh = page.waitForResponse(response => response.url().includes('/rpc/list_event_products') && response.ok());
    must(await service.from('event_products').update({ price_override: viewport.width === 1280 ? 91 : 92 }).eq('event_id', eventId).eq('product_id', result.data![0].id));
    await stockRefresh;
    await expect(search).toHaveValue('Design 30');
    await expect(detail.getByRole('heading', { name: 'Design 30', exact: true })).toBeVisible();
    await search.fill('missing design');
    await expect(list.getByRole('status')).toHaveText('No matching items');
    await search.fill('');
    await expect(list.getByText('preview images')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(detail).toBeHidden();
  }
});

test('mobile POS gives products most of the viewport and keeps tools and cart available', async ({ page }) => {
  const result = await service.from('products').select('id').eq('artist_id', artistId).like('name', 'Design %');
  must(result);
  must(await service.from('event_products').upsert(result.data!.map(product => ({ artist_id: artistId, event_id: eventId, product_id: product.id, stock_total: 10, is_enabled: true, is_unlimited: false })), { onConflict: 'event_id,product_id' }));
  await page.setViewportSize({ width: 390, height: 700 });
  await new LoginPage(page).goto();
  await new LoginPage(page).login(email, password);
  await expect(page).toHaveURL(/manage-events/, { timeout: 20_000 });
  await page.goto(`/manage-pos-queues?eventId=${eventId}`);
  await expect(page.getByRole('group', { name: 'Active sale queue' })).toBeVisible();
  const region = page.getByRole('region', { name: /^Product (?:list|grid)$/ });
  await expect(region.locator('[data-pos-family]')).toBeVisible();
  const bounds = await region.boundingBox();
  expect(bounds!.height).toBeGreaterThan(350);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByTestId('pos-active-event')).toBeVisible();
  await expect(page.getByTestId('booth-toggle')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to event', exact: true })).toBeVisible();
  await expect(page.getByTestId('pos-event-selector')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Select Customer', exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Sort products by', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await region.locator('summary').click();
  await region.getByRole('button', { name: /Design 1/, exact: false }).first().click();
  await page.locator('.pos-mobile-cartbar button').click();
  const cart = page.getByRole('dialog', { name: 'Shopping cart', exact: true });
  await expect(cart).toBeVisible();
  await expect(cart.getByText('Design 1', { exact: true })).toBeVisible();
  await cart.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(cart).toBeHidden();
  await page.screenshot({ path: '../pos-mobile-compact-local.png' });
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
  await editor.getByLabel('Product format', { exact: true }).selectOption('photo');
  // Stable local images exercise actual media layout without remote assets.
  const origin = new URL(page.url()).origin;
  await editor.locator('details').filter({ has: page.getByLabel('Shared photo gallery', { exact: true }) }).locator('summary').first().click();
  await editor.getByLabel('Shared photo gallery', { exact: true }).fill([1, 2, 3, 4, 5].map((n) => `${origin}/pwa-192x192.png?image=${n}`).join('\n'));
  await editor.getByLabel('Item name', { exact: true }).fill('Aether');
  await editor.getByRole('button', { name: 'Add item', exact: true }).first().click();
  const unnamedItem = editor.getByLabel('Item name', { exact: true }).nth(1);
  await expect(unnamedItem).toHaveValue('');
  await expect(unnamedItem).toHaveAttribute('required');
  await editor.getByRole('button', { name: 'Create product', exact: true }).click();
  await expect(editor).toBeVisible();
  expect(await unnamedItem.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  await editor.getByLabel('Item name', { exact: true }).nth(1).fill('Lumine');
  await editor.getByLabel('Stock', { exact: true }).first().fill('10');
  await editor.getByRole('button', { name: 'Apply to new items', exact: true }).click();
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
  await preview.getByLabel('Search products', { exact: true }).fill('Aether');
  await expect(preview.getByTestId('product-options-list').locator('article')).toHaveCount(1);
  await preview.getByLabel('Search products', { exact: true }).fill('not-a-design');
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
  await manyPreview.getByLabel('Search products', { exact: true }).fill('Design 30');
  await expect(manyPreview.getByTestId('product-options-list').locator('article')).toHaveCount(1);
  await manyPreview.getByRole('button', { name: /Adjust stock/ }).click();
  await expect(manyPreview).toBeHidden();
  const stockDialog = page.getByRole('dialog');
  await expect(stockDialog).toBeVisible();
  await stockDialog.getByRole('button', { name: /Cancel|ยกเลิก/ }).click();
  await expect(stockDialog).toBeHidden();
  await manyCard.getByRole('button', { name: 'Product options · 30 variants', exact: true }).click();
  await manyPreview.getByLabel('Search products', { exact: true }).fill('Design 30');
  await manyPreview.getByRole('button', { name: 'More actions for Design 30', exact: true }).click();
  const actionMenu = page.getByRole('menu');
  await expect(actionMenu).toBeVisible();
  const menuBounds = await actionMenu.boundingBox();
  expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
  expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  await page.getByRole('menuitem', { name: 'Stock history', exact: true }).click();
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
  await expect(detail.getByRole('button', { name: /^Lumine(?:\s|$)/ })).toBeVisible();
  await detail.getByRole('button', { name: /^Aether(?:\s|$)/ }).click();
  await expect(detail.getByRole('button', { name: 'View image 5 of 5', exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'View image 5 of 5', exact: true }).click();
  await detail.getByRole('button', { name: 'Preview image', exact: true }).click();
  const imagePreview = storefront.getByRole('dialog', { name: 'Preview image', exact: true });
  await expect(imagePreview).toBeVisible();
  await expect(imagePreview.locator('.shop-preview-count')).toHaveText('5 / 5');
  await imagePreview.getByRole('button', { name: 'Next image' }).click();
  await expect(imagePreview.locator('.shop-preview-count')).toHaveText('1 / 5');
  await storefront.keyboard.press('ArrowRight');
  await expect(imagePreview.locator('.shop-preview-count')).toHaveText('2 / 5');
  await storefront.setViewportSize({ width: 390, height: 844 });
  await imagePreview.locator('.shop-preview-stage').evaluate(stage => {
    stage.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [new Touch({ identifier: 1, target: stage, clientX: 300 })] }));
    stage.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [new Touch({ identifier: 1, target: stage, clientX: 120 })] }));
  });
  await expect(imagePreview.locator('.shop-preview-count')).toHaveText('3 / 5');
  await storefront.screenshot({ path: '../customer-image-preview-mobile-local.png' });
  await storefront.keyboard.press('Escape');
  await expect(imagePreview).toBeHidden();
  await expect(storefront.locator('.shop-product-dialog')).toBeVisible();
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

for (const photoCount of [1, 3]) {
test(`single-variant ${photoCount}-photo set survives navigation and reload and uses the new edit form`, async ({ page }) => {
  test.setTimeout(90_000);
  await new LoginPage(page).goto();
  await new LoginPage(page).login(email, password);
  await expect(page).toHaveURL(/manage-events/, { timeout: 30_000 });
  await page.goto('/manage-products');
  await page.getByRole('button', { name: /Add Product/i }).click();
  const editor = page.getByRole('dialog', { name: 'Create product', exact: true });
  const photoName = `Reload photoset ${photoCount} ${runId.slice(0, 8)}`;
  const origin = new URL(page.url()).origin;
  const gallery = [1, 2, 3].slice(0, photoCount).map(n => `${origin}/pwa-192x192.png?reload-photo=${n}`).join('\n');
  await editor.getByLabel('Product name *', { exact: true }).fill(photoName);
  await editor.getByLabel('Base price *', { exact: true }).fill('150');
  const itemName = editor.getByLabel('Item name', { exact: true });
  await expect(itemName).toHaveValue('');
  await expect(editor.getByLabel('Category', { exact: true })).toHaveValue('');
  await expect(itemName).toHaveAttribute('placeholder', 'e.g. A4 Mavuika');
  if (photoCount === 1) await editor.screenshot({ path: 'output/playwright/item-name-inherit.png' });
  await expect(itemName).not.toHaveAttribute('required');
  await expect(editor.getByText('(For one item, leave blank to use the product name)', { exact: true })).toBeVisible();

  await editor.getByLabel('Product format', { exact: true }).selectOption('photo');
  await editor.locator('details').filter({ has: page.getByLabel('Shared photo gallery', { exact: true }) }).locator('summary').first().click();
  await editor.getByLabel('Shared photo gallery', { exact: true }).fill(gallery);
  await editor.getByRole('button', { name: 'Do not track stock', exact: true }).click();
  await editor.getByRole('button', { name: 'Create product', exact: true }).click();
  await expect(editor).toBeHidden({ timeout: 30000 });
  const parent = await service.from('product_parents').select('id,product_kind,gallery_images,category').eq('artist_id', artistId).eq('name', photoName).single().throwOnError();
  expect(parent.data?.product_kind).toBe('photo');
  expect(parent.data?.category).toBe('Other');
  const savedItem = await service.from('products').select('name').eq('parent_product_id', parent.data!.id).single().throwOnError();
  expect(savedItem.data?.name).toBe(photoName);

  expect(parent.data?.gallery_images).toEqual(gallery.split('\n'));
  await page.goto('/manage-events');
  await page.goto('/manage-products');
  await page.reload();
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: photoName, exact: true }) });
  await expect(card.locator('img')).toHaveCount(photoCount);
  await card.scrollIntoViewIfNeeded();
  await expect.poll(() => card.locator('img').evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
  await card.getByRole('button', { name: `Edit ${photoName}`, exact: true }).click();
  const edit = page.getByRole('dialog', { name: `Edit ${photoName}`, exact: true });
  await expect(edit.getByLabel('Product format', { exact: true })).toHaveValue('photo');
  await expect(edit.getByLabel('Item name', { exact: true })).toHaveValue('');
  await expect(edit.getByLabel('Shared photo gallery', { exact: true })).toHaveValue(gallery);
  await edit.getByRole('button', { name: 'Save family', exact: true }).click();
  await expect(edit).toBeHidden();
  await page.reload();
  await expect(card.locator('img')).toHaveCount(photoCount);
});
}

test('photo items keep separate galleries through editor, Event, customer and POS', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await new LoginPage(page).goto();
  await new LoginPage(page).login(email, password);
  await expect(page).toHaveURL(/manage-events/);
  await page.goto('/manage-products');
  await page.getByRole('button', { name: /Add Product/i }).click();
  const editor = page.getByRole('dialog', { name: 'Create product', exact: true });
  await expect(editor.getByLabel('Product code', { exact: true })).toBeHidden();
  const familyName = `Photoset Genshin ${runId.slice(0, 8)}`;
  await editor.getByLabel('Product name *', { exact: true }).fill(familyName);
  await editor.getByLabel('Category', { exact: true }).fill('Photoset');
  await editor.getByLabel('Tags', { exact: true }).fill('Genshin Impact');
  await editor.getByLabel('Base price *', { exact: true }).fill('150');
  await editor.getByLabel('Product format', { exact: true }).selectOption('photo');
  await editor.getByLabel('Item name', { exact: true }).fill('Ronova');
  await editor.getByRole('button', { name: 'Add item', exact: true }).last().click();
  await editor.getByLabel('Item name', { exact: true }).nth(1).fill('Raiden');
  const origin = new URL(page.url()).origin;
  await editor.locator('details').filter({ has: page.getByLabel('Image path or URL', { exact: true }) }).locator('summary').first().click();
  await editor.getByLabel('Image path or URL', { exact: true }).fill(`${origin}/pwa-192x192.png?shared-cover`);
  const galleries = ['Ronova', 'Raiden'].map((name, index) => Array.from({ length: index + 3 }, (_, number) => `${origin}/pwa-192x192.png?set=${name}-${number}`));
  for (const [index, name] of ['Ronova', 'Raiden'].entries()) {
    const row = editor.locator('article').nth(index);
    await row.getByRole('button', { name: 'Use a gallery for this item', exact: true }).click();
    await row.locator('details > summary').click();
    await row.getByLabel(`Item photo gallery ${name}`, { exact: true }).fill(galleries[index].join('\n'));
    if (index === 0) {
      await row.getByLabel(`Upload gallery photos ${name}`, { exact: true }).setInputFiles('public/pwa-192x192.png');
      await expect(row.locator('img[alt^="Gallery photo"]')).toHaveCount(4, { timeout: 30_000 });
      await row.getByRole('button', { name: 'Remove photo 4', exact: true }).click();
      await expect(row.locator('img[alt^="Gallery photo"]')).toHaveCount(3);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await editor.locator('form').evaluate(form => form.scrollWidth <= form.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('editor-item-galleries-mobile.png'), fullPage: false });
  await page.setViewportSize({ width: 1280, height: 900 });
  await editor.getByRole('button', { name: 'Create product', exact: true }).click();
  await expect(editor).toBeHidden({ timeout: 30000 });
  const parent = await service.from('product_parents').select('id').eq('artist_id', artistId).eq('name', familyName).single().throwOnError();
  const items = await service.from('products').select('*').eq('parent_product_id', parent.data!.id).order('variant_sort_order').throwOnError();
  expect(items.data!.map(item => item.variant_gallery_images)).toEqual(galleries);
  expect(items.data!.every(item => Boolean(item.sku))).toBe(true);
  await page.reload();
  const familyCard = page.getByTestId(`catalog-family-card-${parent.data!.id}`);
  await familyCard.getByRole('button', { name: `Edit ${familyName}`, exact: true }).click();
  const edit = page.getByRole('dialog', { name: `Edit ${familyName}`, exact: true });
  for (const [index, gallery] of galleries.entries()) await expect(edit.locator('article').nth(index).locator('img[alt^="Gallery photo"]')).toHaveCount(gallery.length);
  await edit.getByRole('button', { name: 'Save family', exact: true }).click();
  await expect(edit).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  const single = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Simple service', exact: true }) });
  await single.getByRole('button', { name: /More actions/ }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('product-actions-mobile.png'), fullPage: false });
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });
  await service.from('event_products').insert(items.data!.map(item => ({ artist_id: artistId, event_id: eventId, product_id: item.id, is_enabled: true, is_unlimited: true }))).throwOnError();
  await page.goto(`/manage-events/${eventId}/catalog`);
  const eventFamily = page.locator(`[data-event-family="${parent.data!.id}"]`);
  await expect(eventFamily).toBeVisible();
  await eventFamily.locator(':scope > summary').click();
  for (const [index, item] of items.data!.entries()) {
    const card = eventFamily.locator('article').filter({ has: page.getByText(item.name, { exact: true }) });
    await expect(card.locator('img')).toHaveCount(galleries[index].length);
  }
  await page.screenshot({ path: testInfo.outputPath('event-item-galleries.png'), fullPage: true });
  await page.goto(`/live/pos?eventId=${eventId}`);
  const posFamily = page.locator(`[data-pos-family="parent:${parent.data!.id}"]`);
  await expect(posFamily).toBeVisible({ timeout: 30000 });
  await posFamily.locator('summary').click();
  const ronova = page.getByRole('region', { name: 'Product grid' }).getByRole('button').filter({ has: page.getByRole('heading', { name: 'Ronova', exact: true }) });
  await expect(ronova.locator('img')).toHaveCount(3);
  await ronova.click();
  await expect(page.getByRole('button', { name: 'Charge ฿150', exact: true })).toBeEnabled();
  await expect(page.getByAltText(items.data![0].name, { exact: true })).toHaveAttribute('src', /set=Ronova-0/);
  await page.getByRole('button', { name: 'Detail list product view', exact: true }).click();
  const compact = page.getByRole('region', { name: 'Product list' }).getByRole('button').filter({ has: page.getByText('Ronova', { exact: true }) });
  await expect(compact.locator('img')).toHaveAttribute('src', /set=Ronova-0/);
  await page.goto(`/${slug}/menu?event=${eventId}`);
  const customerFamily = page.locator('article').filter({ has: page.getByRole('heading', { name: familyName, exact: true }) });
  await customerFamily.getByRole('button', { name: 'Choose item', exact: true }).click();
  const details = page.getByRole('dialog');
  await expect(details.getByRole('heading', { name: 'Ronova', exact: true })).toBeVisible();
  await details.getByRole('button', { name: /Raiden/ }).click();
  await expect(details.getByRole('heading', { name: 'Raiden', exact: true })).toBeVisible();
  await expect(details.locator('.shop-detail-image img:visible')).toHaveCount(5); // selected image + four thumbnail images
  await page.screenshot({ path: testInfo.outputPath('customer-item-gallery.png'), fullPage: true });
  await details.getByRole('button', { name: `Add: ${items.data![1].name}`, exact: true }).click();
  await details.getByRole('button', { name: 'Ronova', exact: true }).click();
  await details.getByRole('button', { name: `Add: ${items.data![0].name}`, exact: true }).click();
  await page.keyboard.press('Escape');
  await page.goto(`/${slug}/queue`);
  await page.getByRole('button', { name: /Get Ticket|Join (?:the )?Queue/i }).click();
  await expect(page.locator('.queue-ticket-number')).toBeVisible();
  must(await service.from('queues').update({ status: 'calling' }).eq('event_id', eventId));
  await page.goto(`/${slug}/menu?event=${eventId}`);
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  const checkout = page.getByRole('dialog', { name: 'Confirm Order?', exact: true });
  await expect(checkout).toBeVisible();
  for (const [index, item] of items.data!.entries()) {
    const line = checkout.locator('.checkout-items li').filter({ has: page.getByText(item.name, { exact: true }) });
    await expect(line.locator('.checkout-product-media img')).toHaveCount(galleries[index].length);
    expect((await line.locator('.checkout-product-media').boundingBox())!.width).toBe(64);
    const sources = await line.locator('.checkout-product-media img').evaluateAll(images => images.map(image => (image as HTMLImageElement).src));
    expect(sources.every(source => source.includes(`set=${item.variant_name}-`))).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await checkout.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: '../customer-checkout-photoset-local.png' });
  await checkout.getByRole('button', { name: 'Close', exact: true }).click();

});


test('creates a component bundle separately with quantities and no item stock editor', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('nireq-language', 'en'));
  const login = new LoginPage(page);
  await login.goto(); await login.login(email, password);
  await expect(page).toHaveURL(/manage-events/, { timeout: 20000 });
  await page.goto('/manage-products');
  await page.getByRole('button', { name: 'Create bundle', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create bundle', exact: true });
  await expect(dialog.getByText('Items under this product', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('Bundle name', { exact: true }).fill('Shared bundle test');
  await dialog.getByLabel('Bundle price', { exact: true }).fill('250');
  await dialog.getByLabel('Search products to add').fill('Design 1');
  await dialog.getByRole('button', { name: 'Design 1', exact: true }).click();
  await dialog.getByRole('button', { name: 'Design 1', exact: true }).click();
  await expect(dialog.getByLabel('Quantity per bundle Design 1', { exact: true })).toHaveValue('2');
  await expect(dialog.getByText('This item uses 2 units per bundle.', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Save bundle', exact: true }).click();
  await expect(dialog).toBeHidden();
  const parent = await service.from('product_parents').select('id,bundle_items').eq('artist_id', artistId).eq('name','Shared bundle test').single().throwOnError();
  expect(parent.data!.bundle_items).toHaveLength(1);
  expect(parent.data!.bundle_items[0]).toMatchObject({quantity:2,name:'Design 1'});
  const item = await service.from('products').select('is_unlimited,stock_total').eq('parent_product_id',parent.data!.id).single().throwOnError();
  expect(item.data).toMatchObject({is_unlimited:true,stock_total:null});
});

// Competing cart checkouts must share a bundle's component allocation.
test('bundle and individual checkouts cannot both acquire the last component', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const env = resolveSupabaseTestEnv();
  const owner = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
  must(await owner.auth.signInWithPassword({ email, password }));
  const componentId = randomUUID(), campaignId = randomUUID(), secondCampaignId = randomUUID();
  let parentId = '', bundleId = '';
  const created: string[] = [];
  try {
    must(await service.from('products').insert({ id: componentId, artist_id: artistId, name: 'Race component', price: 100, stock_total: 1, is_unlimited: false, status: 'enable' }));
    const saved = await owner.rpc('save_product_bundle', { p_parent: { artist_id: artistId, name: 'Race bundle', base_price: 100, currency: 'THB' }, p_components: [{ product_id: componentId, quantity: 1 }] });
    must(saved); parentId = saved.data;
    const item = await service.from('products').select('id').eq('parent_product_id', parentId).single();
    must(item); bundleId = item.data!.id;
    must(await service.from('online_campaigns').insert({ id: campaignId, artist_id: artistId, name: 'Bundle race', slug: `bundle-race-${runId}`, opens_at: new Date(Date.now() - 3600000).toISOString(), closes_at: new Date(Date.now() + 86400000).toISOString(), publication_status: 'published', shipping_enabled: true }));
    must(await service.from('campaign_payment_methods').insert({ campaign_id: campaignId, artist_id: artistId, method_type: 'promptpay', promptpay_id: '0000000000' }));
    must(await service.from('online_campaign_products').insert([
      { campaign_id: campaignId, artist_id: artistId, product_id: componentId, stock_total: 1, is_unlimited: false, is_enabled: true },
      { campaign_id: campaignId, artist_id: artistId, product_id: bundleId, stock_total: null, is_unlimited: true, is_enabled: true },
    ]));
    for (let round = 0; round < 3; round++) {
      const outcomes = await Promise.all([componentId, bundleId].map(product_id => owner.rpc('create_online_campaign_order', { p_campaign_id: campaignId, p_items: [{ product_id, quantity: 1 }], p_fulfillment_method: 'shipping', p_pickup_point_id: null, p_customer_name: 'Race buyer', p_customer_email: 'bundle-race@example.local', p_customer_phone: '0800000000', p_shipping_address: 'Local fixture address', p_customer_note: '', p_client_request_id: randomUUID() })));
      const successes = outcomes.filter(outcome => !outcome.error);
      expect(successes, outcomes.map(outcome => outcome.error?.message || 'created').join(', ')).toHaveLength(1);
      const id = successes[0].data[0].order_id; created.push(id);
      const stock = await service.from('online_campaign_products').select('stock_reserved,stock_sold').eq('campaign_id', campaignId).eq('product_id', componentId).single();
      must(stock); expect(stock.data).toMatchObject({ stock_reserved: 1, stock_sold: 0 });
      const projectId = readFileSync(resolve(process.env.SUPABASE_WORKDIR || '.', 'supabase/config.toml'), 'utf8').match(/^project_id\s*=\s*"([\w-]+)"/m)?.[1];
      if (!projectId || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid disposable fixture identity');
      execFileSync('docker', ['exec', `supabase_db_${projectId}`, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `update public.order_payments set stock_hold_expires_at=now()-interval '1 second' where order_id='${id}'; select private.expire_online_campaign_hold('${id}'); select private.expire_online_campaign_hold('${id}');`], { stdio: 'ignore' });
      const released = await service.from('online_campaign_products').select('stock_reserved').eq('campaign_id', campaignId).eq('product_id', componentId).single();
      must(released); expect(released.data!.stock_reserved).toBe(0);
    }
    // Different channels do not serialize on the same campaign row. Their cart
    // locks must still agree when one sells a component plus its bundle.
    must(await service.from('products').update({ stock_total: 3 }).eq('id', componentId));
    must(await service.from('online_campaign_products').update({ stock_total: 2 }).eq('campaign_id', campaignId).eq('product_id', componentId));
    must(await service.from('online_campaigns').insert({ id: secondCampaignId, artist_id: artistId, name: 'Second bundle channel', slug: `second-bundle-race-${runId}`, opens_at: new Date(Date.now() - 3600000).toISOString(), closes_at: new Date(Date.now() + 86400000).toISOString(), publication_status: 'published', shipping_enabled: true }));
    must(await service.from('campaign_payment_methods').insert({ campaign_id: secondCampaignId, artist_id: artistId, method_type: 'promptpay', promptpay_id: '0000000000' }));
    must(await service.from('online_campaign_products').insert([
      { campaign_id: secondCampaignId, artist_id: artistId, product_id: componentId, stock_total: 1, is_unlimited: false, is_enabled: true },
      { campaign_id: secondCampaignId, artist_id: artistId, product_id: bundleId, stock_total: null, is_unlimited: true, is_enabled: true },
    ]));
    const crossChannel = await Promise.all([
      { campaign: campaignId, items: [{ product_id: componentId, quantity: 1 }, { product_id: bundleId, quantity: 1 }] },
      { campaign: secondCampaignId, items: [{ product_id: bundleId, quantity: 1 }] },
    ].map(cart => owner.rpc('create_online_campaign_order', { p_campaign_id: cart.campaign, p_items: cart.items, p_fulfillment_method: 'shipping', p_pickup_point_id: null, p_customer_name: 'Parallel buyer', p_customer_email: 'parallel@example.local', p_customer_phone: '0800000000', p_shipping_address: 'Local fixture address', p_customer_note: '', p_client_request_id: randomUUID() })));
    for (const outcome of crossChannel) { must(outcome); created.push(outcome.data[0].order_id); }
    const held = await service.from('online_campaign_products').select('stock_reserved').in('campaign_id', [campaignId, secondCampaignId]).eq('product_id', componentId);
    must(held); expect(held.data!.reduce((sum, row) => sum + row.stock_reserved, 0)).toBe(3);
  } finally {
    if (created.length) {
      must(await service.from('order_payments').update({ payment_status: 'payment_expired' }).in('order_id', created));
      must(await service.from('order_items').delete().in('order_id', created));
      must(await service.from('order_payments').delete().in('order_id', created));
      must(await service.from('orders').delete().in('id', created));
    }
    must(await service.from('online_campaign_products').delete().in('campaign_id', [campaignId, secondCampaignId]));
    must(await service.from('online_campaigns').delete().in('id', [campaignId, secondCampaignId]));
    if (bundleId) must(await service.from('products').delete().eq('id', bundleId));
    if (parentId) must(await service.from('product_parents').delete().eq('id', parentId));
    must(await service.from('products').delete().eq('id', componentId));
    await owner.auth.signOut();
  }
});
