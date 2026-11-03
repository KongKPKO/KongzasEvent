import { expectSignedInAccount } from '../helpers/accountMenu';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureOwnerArtistFixture } from '../helpers/adminFixture';
import { LoginPage } from './pages/LoginPage';

const runId = randomUUID();
const adminEmail = `full-service-${runId}@example.test`;
const adminPassword = 'LocalOnlyTestPassword123!';
const artistSlug = `fs-${runId.slice(0, 8)}`;
const eventId = randomUUID();
const productId = randomUUID();
const eventName = `Full Service ${runId}`;
const productName = `Full Service Item ${runId}`;

let service: SupabaseClient;
let artistId = '';

const must = (result: { error: { message: string } | null }, action: string) => {
  if (result.error) throw new Error(`${action}: ${result.error.message}`);
};

test.beforeAll(async () => {
  const fixture = await ensureOwnerArtistFixture({
    email: adminEmail,
    password: adminPassword,
    slug: artistSlug,
    displayName: 'Full Service Browser Fixture',
  });
  service = fixture.service;
  artistId = fixture.userId;

  const now = Date.now();
  must(await service.from('events').insert({
    id: eventId,
    artist_id: artistId,
    event_name: eventName,
    start_date: new Date(now - 60 * 60 * 1000).toISOString(),
    end_date: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    status: 'Confirmed',
    is_booth_open: true,
  }), 'seed event');
  must(await service.from('products').insert({
    id: productId,
    artist_id: artistId,
    name: productName,
    price: 100,
    status: 'enable',
    category: 'Browser fixture',
    currency: 'THB',
    stock_total: 5,
    is_unlimited: false,
  }), 'seed product');
  must(await service.from('event_products').insert({
    event_id: eventId,
    product_id: productId,
    artist_id: artistId,
    is_enabled: true,
    stock_total: 5,
    is_unlimited: false,
  }), 'seed event product');
});

test.afterAll(async () => {
  if (!service || !artistId) return;

  const orders = await service.from('orders').select('id').eq('event_id', eventId);
  must(orders, 'list fixture orders for cleanup');
  const orderIds = (orders.data || []).map(({ id }) => id);
  if (orderIds.length > 0) {
    must(await service.from('order_items').delete().in('order_id', orderIds), 'delete fixture order items');
    must(await service.from('order_payments').delete().in('order_id', orderIds), 'delete fixture payments');
    must(await service.from('orders').delete().in('id', orderIds), 'delete fixture orders');
  }
  must(await service.from('queues').delete().eq('event_id', eventId), 'delete fixture queues');
  must(await service.from('event_products').delete().eq('event_id', eventId), 'delete fixture event products');
  must(await service.from('products').delete().eq('id', productId), 'delete fixture product');
  must(await service.from('events').delete().eq('id', eventId), 'delete fixture event');
  must(await service.from('artists').delete().eq('id', artistId), 'delete fixture artist');
  const deletedUser = await service.auth.admin.deleteUser(artistId);
  if (deletedUser.error) throw new Error(`delete fixture user: ${deletedUser.error.message}`);
});

test.describe('storefront visibility', () => {
  test('publication explains a missing visible product and succeeds after adding one', async ({ page }) => {
    must(await service.from('artists').update({ is_public: false }).eq('id', artistId), 'hide fixture storefront');
    must(await service.from('events').update({ event_timezone: 'Asia/Bangkok', location: 'Hall A', booth_detail: 'A12' }).eq('id', eventId), 'complete event details');
    must(await service.from('event_products').update({ is_enabled: false }).eq('event_id', eventId).eq('product_id', productId), 'hide fixture product');
    const login = new LoginPage(page);
    await login.goto();
    await login.login(adminEmail, adminPassword);
    await expectSignedInAccount(page);
    await page.goto('/manage-profile');
    await page.getByRole('button', { name: 'Publish booth', exact: true }).click();
    await expect(page.getByText('Add at least one enabled product to the customer catalog before publishing.')).toBeVisible();
    await expect(page.getByText('[object Object]')).toHaveCount(0);
    await page.evaluate(() => localStorage.setItem('nireq-language', 'th'));
    await page.reload();
    await page.getByRole('button', { name: 'เผยแพร่ร้าน', exact: true }).click();
    await expect(page.getByText('เพิ่มสินค้าและเปิดแสดงอย่างน้อย 1 รายการในอีเวนต์ก่อนเผยแพร่ร้าน')).toBeVisible();
    must(await service.from('event_products').update({ is_enabled: true }).eq('event_id', eventId).eq('product_id', productId), 'enable fixture product');
    await page.evaluate(() => localStorage.setItem('nireq-language', 'en'));
    await page.reload();
    await page.getByRole('button', { name: 'Publish booth', exact: true }).click();
    await expect(page.getByText('Storefront is visible', { exact: true })).toBeVisible();
    await expect.poll(async () => (await service.from('artists').select('is_public').eq('id', artistId).single()).data?.is_public).toBe(true);
  });

  test('walk-in sale works while the storefront is hidden', async ({ page }) => {
    test.setTimeout(120_000);
    const login = new LoginPage(page);
    await login.goto();
    await login.login(adminEmail, adminPassword);
    await expectSignedInAccount(page);
    await page.goto('/manage-profile');
    await page.getByRole('button', { name: 'Hide storefront', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Hide storefront', exact: true }).click();
    await expect(page.getByText('Storefront is hidden', { exact: true })).toBeVisible();

    await page.goto(`/live/pos?eventId=${eventId}`);
    await expect(page.getByTestId('pos-active-event')).toHaveAttribute('data-event-id', eventId);
    const products = page.getByRole('region', { name: /Product list|Product grid/ });
    await products.getByRole('button').filter({ hasText: productName }).first().click();
    await page.getByRole('button', { name: /Charge/ }).click();
    await page.getByRole('button', { name: /CASH/i }).click();
    await expect.poll(async () => {
      const result = await service.from('orders').select('status, payment_method').eq('event_id', eventId).eq('status', 'completed');
      must(result, 'read completed walk-in sale');
      return result.data?.some(order => order.payment_method === 'cash');
    }).toBe(true);

  });

});
