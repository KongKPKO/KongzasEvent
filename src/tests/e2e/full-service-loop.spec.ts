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
      await expectSignedInAccount(adminPage);

      await adminPage.goto(`/manage-pos-queues?eventId=${eventId}`);
      await expect(adminPage.getByTestId('pos-active-event')).toHaveAttribute('data-event-id', eventId, { timeout: 20_000 });
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

      await customerPage.goto(`/${artistSlug}/menu?event=${eventId}`);
      await customerPage.getByRole('button', { name: `Add: ${productName}`, exact: true }).click();
      await customerPage.getByRole('button', { name: 'Confirm', exact: true }).click();
      await customerPage.getByRole('dialog', { name: 'Confirm Order?', exact: true }).getByRole('button', { name: 'Send Order', exact: true }).click();
      const closeNotice = customerPage.getByRole('button', { name: 'Close order notification', exact: true });
      await expect(closeNotice).toBeVisible();
      await closeNotice.click();
      await expect(customerPage.getByRole('button', { name: `Add: ${productName}`, exact: true })).toBeDisabled();
      await customerPage.getByRole('button', { name: 'View submitted order', exact: true }).click();
      await expect(closeNotice).toBeVisible();

      const arrived = adminPage.getByRole('button', { name: 'ARRIVED', exact: true });
      await expect(arrived).toBeVisible({ timeout: 20_000 });
      await arrived.click();
      await expect.poll(async () => {
        const result = await service.from('queues').select('arrived_at').eq('id', ticketId).single();
        return Boolean(dataOrThrow(result, 'read arrived queue ticket').arrived_at);
      }).toBe(true);
      await adminPage.getByRole('button', { name: 'Start serving', exact: true }).click();
      await expect.poll(async () => {
        const result = await service.from('queues').select('status').eq('id', ticketId).single();
        return dataOrThrow(result, 'read serving queue ticket').status;
      }).toBe('serving');

      await adminPage.setViewportSize({ width: 390, height: 700 });
      const mobileCustomer = adminPage.getByRole('combobox', { name: 'Select Customer', exact: true });
      await expect(mobileCustomer.locator(`option[value="${ticketId}"]`)).toHaveCount(1);
      await mobileCustomer.selectOption(ticketId);
      await expect(mobileCustomer).toHaveValue(ticketId);
      await mobileCustomer.selectOption('');
      await expect(mobileCustomer).toHaveValue('');
      await mobileCustomer.selectOption(ticketId);
      await adminPage.setViewportSize({ width: 1280, height: 800 });
      const queueTab = adminPage.getByRole('button', { name: `Queue #${ticketNumber}`, exact: true });
      await expect(queueTab).toBeVisible({ timeout: 20_000 });
      await queueTab.click();
      // The customer already sent one item; POS must retain that order.
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
      const nextTicketPage = await customerContext.newPage();
      await nextTicketPage.goto(`/${artistSlug}/queue`);
      await nextTicketPage.getByRole('button', { name: 'Close Ticket', exact: true }).click();
      await nextTicketPage.getByRole('button', { name: /Get Ticket|Join (?:the )?Queue/i }).click();
      const secondNumber = Number((await nextTicketPage.locator('.queue-ticket-number').innerText()).replace('#', '').trim());
      expect(secondNumber).toBeGreaterThan(ticketNumber);
      // The original menu tab must unlock without navigation or reload.
      const addAgain = customerPage.getByRole('button', { name: `Add: ${productName}`, exact: true });
      await expect(addAgain).toBeEnabled();
      // Recover a stale receipt written by the previous DEV version (no ticket binding).
      await customerPage.evaluate(({ artistId, orderId }) => {
        localStorage.setItem(`orderSent_${artistId}`, 'true');
        localStorage.setItem(`sentOrderId_${artistId}`, orderId);
        localStorage.setItem(`orderCompleted_${artistId}`, 'false');
        localStorage.removeItem(`sentOrderTicketId_${artistId}`);
      }, { artistId, orderId: String(paidOrder.id) });
      await customerPage.reload();
      await expect(addAgain).toBeEnabled({ timeout: 15_000 });
      await addAgain.click();
      await expect(customerPage.getByRole('button', { name: 'Wait', exact: true })).toBeDisabled();
      await adminPage.reload();
      await adminPage.getByRole('button', { name: new RegExp(`^Call Next \\(#${secondNumber}\\)$`, 'i') }).click();
      await expect(customerPage.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled({ timeout: 15_000 });
      await customerPage.getByRole('button', { name: 'Confirm', exact: true }).click();
      await customerPage.getByRole('dialog', { name: 'Confirm Order?', exact: true }).getByRole('button', { name: 'Send Order', exact: true }).click();
      await expect(closeNotice).toBeVisible();
      const orders = await service.from('orders').select('id,queue_id,status').eq('event_id', eventId);
      must(orders, 'read two customer rounds');
      expect(orders.data).toHaveLength(2);
      expect(orders.data!.find(row => row.id === paidOrder.id)?.status).toBe('completed');
      expect(orders.data!.find(row => row.id !== paidOrder.id)?.queue_id).not.toBe(ticketId);

    } finally {
      await adminContext.close();
      await customerContext.close();
    }
  });
});

for (const boundReceipt of [true, false]) {
  test(`ended event receipt does not block the next event (${boundReceipt ? 'bound' : 'legacy'} receipt)`, async ({ page }) => {
    test.setTimeout(90_000);
    const oldEvent = randomUUID(), oldQueue = randomUUID(), oldOrder = randomUUID();
    const now = Date.now();
    const eventAge = boundReceipt ? 86400000 : 0;
    try {
      // Cover yesterday and the same day; both Events remain Confirmed/open.
      must(await service.from('events').insert({ id: oldEvent, artist_id: artistId, event_name: 'Earlier event', start_date: new Date(now - eventAge - 7200000).toISOString(), end_date: new Date(now - eventAge - 3600000).toISOString(), status: 'Confirmed', is_booth_open: true }), 'seed earlier event');
      must(await service.from('queues').insert({ id: oldQueue, event_id: oldEvent, artist_id: artistId, queue_number: 77, status: 'calling', queue_service_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now - eventAge)) }), 'seed earlier ticket');
      must(await service.from('orders').insert({ id: oldOrder, event_id: oldEvent, queue_id: oldQueue, status: 'confirmed', total_price: 100, currency: 'THB' }), 'seed earlier order');
      await page.addInitScript(({ artistId, eventId, oldQueue, oldOrder, boundReceipt }) => {
        if (sessionStorage.getItem('old-receipt-seeded')) return;
        sessionStorage.setItem('old-receipt-seeded', 'true');
        localStorage.setItem('nireq-language', 'en');
        localStorage.setItem('nireq-replay-consent-v1', 'rejected');
        localStorage.setItem(`customerSelectedEventId:${artistId}`, eventId);
        localStorage.setItem(`ticket_id_${artistId}`, oldQueue);
        localStorage.setItem(`orderSent_${artistId}`, 'true');
        localStorage.setItem(`sentOrderId_${artistId}`, oldOrder);
        if (boundReceipt) localStorage.setItem(`sentOrderTicketId_${artistId}`, oldQueue);
      }, { artistId, eventId, oldQueue, oldOrder, boundReceipt });
      await page.goto(`/${artistSlug}/menu`);
      const add = page.getByRole('button', { name: `Add: ${productName}`, exact: true });
      await expect(add).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Close order notification', exact: true })).toBeHidden();
      await expect(page.getByRole('button', { name: /Your Turn.*Queue 77/ })).toBeHidden();
      await page.reload();
      await expect(add).toBeEnabled();
      await add.click();
      await page.goto(`/${artistSlug}/queue`);
      await page.getByRole('button', { name: /Get Ticket|Join (?:the )?Queue/i }).click();
      await expect(page.locator('.queue-ticket-number')).toBeVisible();
      const nextQueue = await page.evaluate(artistId => localStorage.getItem(`ticket_id_${artistId}`), artistId);
      expect(nextQueue).toBeTruthy(); expect(nextQueue).not.toBe(oldQueue);
      must(await service.from('queues').update({ status: 'calling' }).eq('id', nextQueue!), 'call next event ticket');
      await page.goto(`/${artistSlug}/menu`);
      await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Confirm', exact: true }).click();
      await page.getByRole('dialog', { name: 'Confirm Order?', exact: true }).getByRole('button', { name: 'Send Order', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Close order notification', exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('button', { name: 'Close order notification', exact: true })).toBeVisible();
      await expect(add).toBeDisabled();
      // A failed receipt check must not let this ticket submit a second order.
      await page.route('**/rest/v1/rpc/get_customer_order_status', route => route.abort('failed'));
      await page.reload();
      await expect(add).toBeEnabled();
      await add.click();
      await expect(page.getByRole('button', { name: 'Wait', exact: true })).toBeDisabled();
      await page.unroute('**/rest/v1/rpc/get_customer_order_status');
      await page.reload();
      await expect(page.getByRole('button', { name: 'Close order notification', exact: true })).toBeVisible();
      const nextOrder = dataOrThrow(await service.from('orders').select('event_id,status').eq('queue_id', nextQueue!).single(), 'read new event order');
      expect(nextOrder).toEqual({ event_id: eventId, status: 'confirmed' });
      const previousOrder = dataOrThrow(await service.from('orders').select('event_id,status,total_price').eq('id', oldOrder).single(), 'read preserved earlier order');
      expect(previousOrder).toEqual({ event_id: oldEvent, status: 'confirmed', total_price: 100 });
    } finally {
      must(await service.from('orders').delete().eq('id', oldOrder), 'delete earlier order');
      must(await service.from('queues').delete().eq('event_id', oldEvent), 'delete earlier queues');
      must(await service.from('events').delete().eq('id', oldEvent), 'delete earlier event');
    }
  });
}
