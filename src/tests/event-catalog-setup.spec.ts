import { expect, test } from '@playwright/test';
import {
  buildEventCatalogInitializationItems,
  filterEventCatalogSetupProducts,
  type EventCatalogSetupProduct,
} from '../lib/eventCatalogSetup';

const products: EventCatalogSetupProduct[] = [
  { id: 'finite', name: 'Pink Print', category: 'Print', tags: ['new'], is_unlimited: false, available: 7 },
  { id: 'unlimited', name: 'Sketch Service', category: 'Service', tags: ['commission'], is_unlimited: true, available: Number.MAX_SAFE_INTEGER },
];

test('event setup filters by search and category before selecting in bulk', () => {
  expect(filterEventCatalogSetupProducts(products, 'pink', 'All').map((product) => product.id)).toEqual(['finite']);
  expect(filterEventCatalogSetupProducts(products, '', 'Service').map((product) => product.id)).toEqual(['unlimited']);
  expect(filterEventCatalogSetupProducts(products, 'commission', 'Service').map((product) => product.id)).toEqual(['unlimited']);
});

test('event setup starts finite allocations at zero and caps requested stock', () => {
  expect(buildEventCatalogInitializationItems(products, {
    mode: 'select',
    sourceEventId: '',
    selectedProductIds: ['finite', 'unlimited'],
    allocations: { finite: 99 },
  })).toEqual([
    { product_id: 'finite', stock_total: 7 },
    { product_id: 'unlimited', stock_total: null },
  ]);

  expect(buildEventCatalogInitializationItems(products, {
    mode: 'reuse',
    sourceEventId: 'old-event',
    selectedProductIds: ['finite'],
    allocations: { finite: 5 },
  })).toEqual([{ product_id: 'finite', stock_total: 5 }]);
});

test('new event reuses a product list, reviews bulk stock and can explicitly start empty', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const { randomUUID } = await import('node:crypto');
  const { ensureOwnerArtistFixture } = await import('./helpers/adminFixture');
  const runId = randomUUID();
  const email = `event-setup-${runId}@nireq.local`, password = 'LocalEventSetup123!';
  const { service, userId } = await ensureOwnerArtistFixture({ email, password, slug: `event-setup-${runId.slice(0, 8)}`, displayName: 'Event setup UI' });
  const source = randomUUID(), finite = randomUUID(), unlimited = randomUUID(), fresh = randomUUID();
  const must = (result: { error: unknown }) => { if (result.error) throw result.error; };
  const createdIds: string[] = [];
  try {
    must(await service.from('products').insert([
      { id: finite, artist_id: userId, name: 'Existing print', price: 100, category: 'Print', stock_total: 20, is_unlimited: false, status: 'enable' },
      { id: unlimited, artist_id: userId, name: 'Unlimited old item', price: 50, category: 'Other', is_unlimited: true, status: 'enable' },
      { id: fresh, artist_id: userId, name: 'New print', price: 120, category: 'Print', stock_total: 10, is_unlimited: false, status: 'enable' },
    ]));
    must(await service.from('events').insert({ id: source, artist_id: userId, event_name: 'Previous event source', start_date: '2026-01-01T03:00:00Z', end_date: '2026-01-02T12:00:00Z', status: 'Ended' }));
    must(await service.from('event_products').insert([
      { event_id: source, artist_id: userId, product_id: finite, is_enabled: true, is_unlimited: false, stock_total: 8, stock_sold: 2, stock_reserved: 1, price_override: 80 },
      { event_id: source, artist_id: userId, product_id: unlimited, is_enabled: true, is_unlimited: true, stock_total: null, stock_sold: 0, stock_reserved: 0, price_override: null },
    ]));
    await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
    await page.goto('/manage-login');
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole('button', { name: /^Login/i }).click();
    await expect(page).not.toHaveURL(/manage-login/);
    await page.goto('/manage-events?view=all');
    const openForm = async (name: string) => {
      await page.goto('/manage-events?view=all');
      await page.getByRole('button', { name: 'Add Event', exact: true }).click();
      await page.locator('input[name="event_name"]').fill(name);
      await page.locator('input[name="start_date"]').fill('2027-01-01T10:00');
      await page.locator('input[name="end_date"]').fill('2027-01-02T18:00');
    };
    await openForm('Reused event UI');
    const setup = page.getByRole('region', { name: 'Starting event products' });
    await setup.getByRole('button', { name: 'Reuse previous list', exact: true }).click();
    await setup.getByLabel('Source event', { exact: true }).selectOption(source);
    await expect(setup.getByRole('checkbox', { name: 'Existing print', exact: true })).toBeChecked();
    await setup.getByRole('checkbox', { name: 'Unlimited old item', exact: true }).uncheck();
    await setup.getByLabel('Filter category').selectOption('Print');
    await setup.getByRole('button', { name: 'Select all filtered', exact: true }).click();
    await setup.getByLabel('Allocate selected visible products').fill('2');
    await setup.getByRole('button', { name: 'Apply quantity', exact: true }).click();
    await expect(setup.getByLabel('Stock Existing print', { exact: true })).toHaveValue('2');
    await setup.getByLabel('Stock Existing print', { exact: true }).fill('');
    await expect(setup.getByLabel('Stock Existing print', { exact: true })).toHaveValue('');
    await setup.getByLabel('Stock Existing print', { exact: true }).pressSequentially('5');
    await expect(setup.getByLabel('Stock Existing print', { exact: true })).toHaveValue('5');
    await setup.getByLabel('Stock Existing print', { exact: true }).fill('2');
    await expect(setup.getByLabel('Stock New print', { exact: true })).toHaveValue('2');
    await page.screenshot({ path: testInfo.outputPath('event-catalog-before-create.png') });
    await page.getByRole('button', { name: 'Save Event', exact: true }).click();
    await expect(page.locator('input[name="event_name"]')).toHaveCount(0);
    const created = await service.from('events').select('id').eq('artist_id', userId).eq('event_name', 'Reused event UI').single();
    must(created); createdIds.push(created.data!.id);
    const allocation = await service.from('event_products').select('product_id,stock_total,stock_sold,stock_reserved,price_override').eq('event_id', created.data!.id).order('product_id');
    must(allocation);
    expect(allocation.data).toHaveLength(2);
    for (const row of allocation.data || []) expect(row).toMatchObject({ stock_total: 2, stock_sold: 0, stock_reserved: 0, price_override: null });
    expect((await service.from('event_products').select('stock_total').eq('event_id', source).eq('product_id', finite).single()).data?.stock_total).toBe(8);
    await openForm('Empty event UI');
    await page.getByRole('button', { name: 'Save Event', exact: true }).click();
    await expect(page.locator('input[name="event_name"]')).toHaveCount(0);
    const empty = await service.from('events').select('id,catalog_initialized_at').eq('artist_id', userId).eq('event_name', 'Empty event UI').single();
    must(empty); createdIds.push(empty.data!.id);
    expect(empty.data!.catalog_initialized_at).toBeTruthy();
    const rows = await service.rpc('list_event_products', { p_event_id: empty.data!.id }); must(rows);
    expect(rows.data).toEqual([]);
  } finally {
    const allEvents = [source, ...createdIds];
    // Include a committed event if a browser assertion failed immediately after save.
    const saved = await service.from('events').select('id').eq('artist_id', userId); must(saved);
    allEvents.push(...(saved.data || []).map(row => row.id));
    must(await service.from('event_products').delete().in('event_id', [...new Set(allEvents)]));
    must(await service.from('events').delete().in('id', [...new Set(allEvents)]));
    must(await service.from('products').delete().in('id', [finite, unlimited, fresh]));
    must(await service.from('artist_members').delete().eq('artist_id', userId));
    must(await service.from('artists').delete().eq('id', userId));
    must(await service.auth.admin.deleteUser(userId));
  }
});
