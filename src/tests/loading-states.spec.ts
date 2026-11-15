import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';

test('catalog and team show loading rather than empty results while requests are pending', async ({ page }) => {
  const id = randomUUID();
  const email = `loading-${id}@nireq.local`;
  const password = 'LocalLoadingTest123!';
  const { service, userId } = await ensureOwnerArtistFixture({ email, password, slug: `loading-${id.slice(0, 8)}`, displayName: 'Loading states' });
  const productId = randomUUID();
  try {
    const result = await service.from('products').insert({ id: productId, artist_id: userId, name: 'Loading fixture', price: 100, status: 'enable', is_unlimited: true });
    if (result.error) throw result.error;
    await page.addInitScript(() => { localStorage.setItem('nireq-language', 'en'); localStorage.setItem('nireq-replay-consent-v1', 'rejected'); });
    await page.goto('/manage-login');
    await page.locator('input[type=email]').fill(email);
    await page.locator('input[type=password]').fill(password);
    await page.getByRole('button', { name: /Login/i }).click();
    await expect(page).not.toHaveURL(/manage-login/);
    let releaseProducts!: () => void;
    const productsHeld = new Promise<void>(resolve => { releaseProducts = resolve; });
    await page.route('**/rest/v1/products?*', async route => { await productsHeld; await route.continue(); });
    await page.goto('/manage-products');
    await expect(page.getByText('Loading products...', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '0 Products' })).toHaveCount(0);
    releaseProducts();
    await expect(page.getByRole('button', { name: '1 Products' })).toBeVisible();
    await page.unroute('**/rest/v1/products?*');
    await page.getByRole('textbox', { name: 'Search products', exact: true }).fill('no-such-product');
    await expect(page.getByText('No products match your search or filters.')).toBeVisible();
    await page.getByRole('textbox', { name: 'Search products', exact: true }).clear();
    let failProducts = true;
    await page.route('**/rest/v1/products?*', route => failProducts ? route.fulfill({ status: 503, json: { message: 'Unavailable' } }) : route.continue());
    await page.reload();
    const catalogError = page.getByRole('alert').filter({ hasText: 'Could not load products' });
    await expect(catalogError).toBeVisible();
    await expect(page.getByText('No items available. Use Add Product to create the first catalog item.')).toHaveCount(0);
    failProducts = false;
    await catalogError.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId(`catalog-row-${productId}`)).toBeVisible();
    await page.unroute('**/rest/v1/products?*');
    let releaseEvents!: () => void;
    const eventsHeld = new Promise<void>(resolve => { releaseEvents = resolve; });
    await page.route('**/rest/v1/events?*', async route => { await eventsHeld; await route.continue(); });
    let releaseInvitations!: () => void;
    const invitationsHeld = new Promise<void>(resolve => { releaseInvitations = resolve; });
    await page.route('**/rest/v1/rpc/list_team_invitations', async route => { await invitationsHeld; await route.continue(); });
    await page.goto('/manage-team');
    await expect(page.getByText('Loading events…')).toBeVisible();
    await expect(page.getByText('Loading invitations…')).toBeVisible();
    await expect(page.getByText('No pending invitations.')).toHaveCount(0);
    releaseInvitations();
    await expect(page.getByText('No pending invitations.')).toBeVisible();
    await expect(page.getByText('Create a confirmed event before inviting event-limited staff.')).toHaveCount(0);
    releaseEvents();
    await expect(page.getByText('Create a confirmed event before inviting event-limited staff.')).toBeVisible();
  } finally {
    await service.from('products').delete().eq('id', productId);
    await service.auth.admin.deleteUser(userId);
  }
});

test('POS distinguishes a pending or failed catalog from an empty catalog', async ({ page }) => {
  const id = randomUUID();
  const email = `pos-loading-${id}@nireq.local`;
  const password = 'LocalLoadingTest123!';
  const { service, userId } = await ensureOwnerArtistFixture({ email, password, slug: `pos-load-${id.slice(0, 8)}`, displayName: 'POS loading' });
  const eventId = randomUUID(), productId = randomUUID();
  const must = (result: { error: unknown }) => { if (result.error) throw result.error; };
  try {
    must(await service.from('events').insert({ id: eventId, artist_id: userId, event_name: 'Loading event', start_date: new Date(Date.now() - 60000).toISOString(), end_date: new Date(Date.now() + 86400000).toISOString(), status: 'Confirmed', is_booth_open: true }));
    must(await service.from('products').insert({ id: productId, artist_id: userId, name: 'POS loading fixture', price: 100, status: 'enable', is_unlimited: true }));
    must(await service.from('event_products').insert({ event_id: eventId, product_id: productId, artist_id: userId, is_enabled: true, is_unlimited: true }));
    await page.addInitScript(() => { localStorage.setItem('nireq-language', 'en'); localStorage.setItem('nireq-replay-consent-v1', 'rejected'); });
    await page.goto('/manage-login');
    await page.locator('input[type=email]').fill(email);
    await page.locator('input[type=password]').fill(password);
    await page.getByRole('button', { name: /Login/i }).click();
    await expect(page).not.toHaveURL(/manage-login/);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let fail = true;
    await page.route('**/rest/v1/rpc/list_event_products_for_phase', async route => {
      await held;
      if (fail) await route.fulfill({ status: 503, json: { message: 'Unavailable' } });
      else await route.continue();
    });
    await page.goto(`/live/pos?eventId=${eventId}`);
    const grid = page.getByRole('region', { name: /Product grid|Product list/ });
    await expect(grid.getByRole('status')).toContainText('Loading');
    await expect(grid.getByText('No products found.')).toHaveCount(0);
    release();
    await expect(grid.getByRole('alert')).toContainText('Could not load products');
    fail = false;
    await grid.getByRole('button', { name: 'Retry' }).click();
    await expect(grid.getByRole('heading', { name: 'POS loading fixture' })).toBeVisible();
  } finally {
    await service.from('event_products').delete().eq('product_id', productId);
    await service.from('events').delete().eq('id', eventId);
    await service.from('products').delete().eq('id', productId);
    await service.auth.admin.deleteUser(userId);
  }
});
