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

const dataOrThrow = <T>(result: { data: T; error: { message: string } | null }, action: string): NonNullable<T> => {
  must(result, action);
  if (result.data == null) throw new Error(`${action}: response data missing`);
  return result.data;
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

test.describe('full queue and POS service loop', () => {
  test('customer joins, staff calls and serves, then records payment', async ({ browser }) => {
    test.setTimeout(120_000);
    const adminContext = await browser.newContext();
    const customerContext = await browser.newContext();

    try {
      const adminPage = await adminContext.newPage();
      const login = new LoginPage(adminPage);
      await login.goto();
      await login.login(adminEmail, adminPassword);
      await expect(adminPage.getByRole('button', { name: /Sign out|Logout|ออกจากระบบ/i }).first()).toBeVisible({ timeout: 20_000 });

      await adminPage.goto(`/manage-pos-queues?eventId=${eventId}`);
      await expect(adminPage.getByTestId('pos-event-selector')).toHaveValue(eventId, { timeout: 20_000 });
      await expect(adminPage.getByTestId('booth-status')).toHaveText('Booth Open');

      const customerPage = await customerContext.newPage();
      await customerPage.goto(`/${artistSlug}/queue`);
      const joinButton = customerPage.getByRole('button', { name: /Get Ticket|Join (?:the )?Queue/i });
      await expect(joinButton).toBeEnabled({ timeout: 20_000 });
      await joinButton.click();

      const ticketNumber = Number((await customerPage.locator('.queue-ticket-number').innerText()).replace('#', '').trim());
      expect(ticketNumber).toBeGreaterThan(0);

      const ticketResult = await service
        .from('queues')
        .select('id, status')
        .eq('event_id', eventId)
        .eq('queue_number', ticketNumber)
        .single();
      const ticket = dataOrThrow(ticketResult, 'read created queue ticket');
      const ticketId = ticket.id as string;
      expect(ticket.status).toBe('waiting');

      await adminPage.reload();
      const callNext = adminPage.getByRole('button', { name: new RegExp(`^Call Next \\(#${ticketNumber}\\)$`, 'i') });
      await expect(callNext).toBeEnabled({ timeout: 20_000 });
      await callNext.click();
      await expect.poll(async () => {
        const result = await service.from('queues').select('status').eq('id', ticketId).single();
        return dataOrThrow(result, 'read called queue ticket').status;
      }).toBe('calling');
      await expect(customerPage.getByText(/It's Your Turn|Now Serving|Please proceed/i).first()).toBeVisible({ timeout: 20_000 });

      const arrived = adminPage.getByRole('button', { name: 'ARRIVED', exact: true });
      await expect(arrived).toBeVisible({ timeout: 20_000 });
      await arrived.click();
      await expect.poll(async () => {
        const result = await service.from('queues').select('status').eq('id', ticketId).single();
        return dataOrThrow(result, 'read serving queue ticket').status;
      }).toBe('serving');

      const queueTab = adminPage.getByRole('button', { name: `Queue #${ticketNumber}`, exact: true });
      await expect(queueTab).toBeVisible({ timeout: 20_000 });
      await queueTab.click();
      await adminPage.getByRole('button', { name: new RegExp(productName) }).first().click();
      const charge = adminPage.getByRole('button', { name: /Charge/ });
      await expect(charge).toBeEnabled({ timeout: 20_000 });
      await charge.click();
      await adminPage.getByRole('button', { name: /CASH/i }).click();

      await expect.poll(async () => {
        const result = await service.from('queues').select('status').eq('id', ticketId).single();
        return dataOrThrow(result, 'read completed queue ticket').status;
      }, { timeout: 20_000 }).toBe('complete');

      const order = await service
        .from('orders')
        .select('id, status, payment_method, total_price')
        .eq('event_id', eventId)
        .eq('queue_id', ticketId)
        .single();
      const paidOrder = dataOrThrow(order, 'read paid order');
      expect(paidOrder).toMatchObject({ status: 'completed', payment_method: 'cash', total_price: 100 });

      const items = await service.from('order_items').select('product_id, quantity, price_per_unit').eq('order_id', paidOrder.id);
      must(items, 'read paid order items');
      expect(items.data).toEqual([{ product_id: productId, quantity: 1, price_per_unit: 100 }]);

      const stock = await service
        .from('event_products')
        .select('stock_total, stock_reserved, stock_sold')
        .eq('event_id', eventId)
        .eq('product_id', productId)
        .single();
      expect(dataOrThrow(stock, 'read event stock after payment')).toEqual({ stock_total: 5, stock_reserved: 0, stock_sold: 1 });
      await expect(customerPage.getByText(/Completed|Order complete|Thank you/i).first()).toBeVisible({ timeout: 20_000 });
      await expect(queueTab).toBeHidden();
    } finally {
      await adminContext.close();
      await customerContext.close();
    }
  });
});
