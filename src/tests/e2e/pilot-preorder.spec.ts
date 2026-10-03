import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureOwnerArtistFixture } from '../helpers/adminFixture';
import { LoginPage } from './pages/LoginPage';

const runId = randomUUID();
const adminEmail = `pilot-preorder-${runId}@example.test`;
const adminPassword = 'LocalOnlyTestPassword123!';
const artistSlug = `po-${runId.slice(0, 8)}`;
const eventId = randomUUID();
const productId = randomUUID();
const productName = `Pilot Preorder Item ${runId}`;
const customerName = `Pilot Customer ${runId.slice(0, 8)}`;
const customerEmail = `pilot-customer-${runId}@example.test`;
const rejectReason = `Wrong slip ${runId.slice(0, 8)}`;
const slipPath = resolve('public/pwa-192x192.png');

let service: SupabaseClient;
let artistId = '';
let orderId = '';

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
    displayName: 'Pilot Preorder Browser Fixture',
  });
  service = fixture.service;
  artistId = fixture.userId;

  const now = Date.now();
  must(await service.from('events').insert({
    id: eventId,
    artist_id: artistId,
    event_name: `Pilot Preorder ${runId}`,
    start_date: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    end_date: new Date(now + 48 * 60 * 60 * 1000).toISOString(),
    status: 'Confirmed',
    is_booth_open: true,
    selling_mode: 'preorder',
    preorder_enabled: true,
    preorder_opens_at: new Date(now - 60 * 60 * 1000).toISOString(),
    preorder_closes_at: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
    preorder_pickup_instructions: 'Show the pickup code at the pilot booth.',
  }), 'seed preorder event');
  must(await service.from('products').insert({
    id: productId,
    artist_id: artistId,
    name: productName,
    price: 120,
    status: 'enable',
    category: 'Browser fixture',
    currency: 'THB',
    stock_total: 5,
    is_unlimited: false,
  }), 'seed preorder product');
  must(await service.from('event_products').insert({
    event_id: eventId,
    product_id: productId,
    artist_id: artistId,
    is_enabled: true,
    stock_total: 5,
    is_unlimited: false,
  }), 'seed preorder event product');
  must(await service.from('event_payment_methods').insert({
    event_id: eventId,
    artist_id: artistId,
    method_type: 'promptpay',
    display_name: 'Pilot PromptPay',
    promptpay_id: '0812345678',
    account_name: 'Pilot Merchant',
    is_enabled: true,
  }), 'seed preorder payment method');
});

test.afterAll(async () => {
  if (!service || !artistId) return;
  if (orderId) {
    const files = await service.storage.from('PaymentEvidence').list(`${eventId}/${orderId}`);
    must(files, 'list fixture slips for cleanup');
    const paths = (files.data || []).map((file) => `${eventId}/${orderId}/${file.name}`);
    if (paths.length > 0) must(await service.storage.from('PaymentEvidence').remove(paths), 'delete fixture slips');
  }
  must(await service.from('orders').delete().eq('event_id', eventId), 'delete fixture orders');
  must(await service.from('event_payment_methods').delete().eq('event_id', eventId), 'delete fixture payment method');
  must(await service.from('event_products').delete().eq('event_id', eventId), 'delete fixture event product');
  must(await service.from('products').delete().eq('id', productId), 'delete fixture product');
  must(await service.from('events').delete().eq('id', eventId), 'delete fixture event');
  must(await service.from('artists').delete().eq('id', artistId), 'delete fixture artist');
  const deletedUser = await service.auth.admin.deleteUser(artistId);
  if (deletedUser.error) throw new Error(`delete fixture user: ${deletedUser.error.message}`);
});

test('preorder slip rejection, resubmission, confirmation, and pickup', async ({ browser }) => {
  test.setTimeout(120_000);
  const customerContext = await browser.newContext();
  const adminContext = await browser.newContext();

  try {
    const customerPage = await customerContext.newPage();
    customerPage.setDefaultTimeout(15_000);
    await customerPage.addInitScript(() => window.localStorage.setItem('nireq-language', 'en'));
    await customerPage.goto(`/${artistSlug}/menu`);
    await expect(customerPage.getByText('Pre-order now. No queue ticket needed.').first()).toBeVisible({ timeout: 20_000 });
    await customerPage.getByRole('button', { name: `Add: ${productName}`, exact: true }).click();
    await customerPage.getByRole('button').filter({ hasText: /฿120|Total/i }).last().click();
    await customerPage.getByPlaceholder('Name for pickup').fill(customerName);
    await customerPage.getByPlaceholder('Email').fill(customerEmail);
    await customerPage.getByRole('button', { name: /^Pre-order$/ }).click();
    await customerPage.getByRole('button', { name: /Place Pre-order/i }).click();

    await expect(customerPage.getByText('Order code', { exact: true })).toBeVisible({ timeout: 20_000 });
    const created = dataOrThrow(await service
      .from('orders')
      .select('id, pickup_code')
      .eq('event_id', eventId)
      .eq('customer_email', customerEmail)
      .single(), 'read created preorder');
    orderId = created.id;
    const pickupCode = created.pickup_code as string;

    const readPaymentStatus = async () => dataOrThrow(await service
      .from('order_payments')
      .select('payment_status, review_note')
      .eq('order_id', orderId)
      .single(), 'read preorder payment');
    const readStock = async () => dataOrThrow(await service
      .from('event_products')
      .select('stock_total, stock_reserved, stock_sold')
      .eq('event_id', eventId)
      .eq('product_id', productId)
      .single(), 'read preorder stock');

    expect(await readStock()).toEqual({ stock_total: 5, stock_reserved: 1, stock_sold: 0 });
    await customerPage.locator('#order-slip-input').setInputFiles(slipPath);
    await customerPage.getByRole('button', { name: 'Send slip to seller', exact: true }).click();
    await expect.poll(async () => (await readPaymentStatus()).payment_status).toBe('payment_submitted');

    const adminPage = await adminContext.newPage();
    adminPage.setDefaultTimeout(15_000);
    const login = new LoginPage(adminPage);
    await login.goto();
    await login.login(adminEmail, adminPassword);
    await expect(adminPage.getByRole('button', { name: /Sign out|Logout|ออกจากระบบ/i }).first()).toBeVisible({ timeout: 20_000 });
    await adminPage.goto(`/manage-events/${eventId}/preorder-dashboard`);
    await expect(adminPage.getByText(pickupCode, { exact: true })).toBeVisible({ timeout: 20_000 });
    await adminPage.getByRole('button', { name: 'Reject', exact: true }).click();
    await adminPage.getByPlaceholder(/Transfer amount does not match/i).fill(rejectReason);
    await adminPage.getByRole('button', { name: 'Reject payment', exact: true }).click();
    await expect.poll(async () => (await readPaymentStatus()).payment_status).toBe('payment_rejected');
    expect(await readStock()).toEqual({ stock_total: 5, stock_reserved: 0, stock_sold: 0 });

    await customerPage.reload();
    await expect(customerPage.getByText(rejectReason, { exact: true })).toBeVisible({ timeout: 20_000 });
    await customerPage.locator('#order-slip-input').setInputFiles(slipPath);
    await customerPage.getByRole('button', { name: 'Send new slip', exact: true }).click();
    await expect.poll(async () => (await readPaymentStatus()).payment_status).toBe('payment_submitted');
    expect(await readStock()).toEqual({ stock_total: 5, stock_reserved: 1, stock_sold: 0 });

    await adminPage.reload();
    await expect(adminPage.getByText(pickupCode, { exact: true })).toBeVisible({ timeout: 20_000 });
    await adminPage.getByRole('button', { name: 'Confirm', exact: true }).click();
    await adminPage.getByRole('button', { name: 'Confirm transfer received', exact: true }).click();
    await expect.poll(async () => (await readPaymentStatus()).payment_status).toBe('payment_confirmed');

    const confirmedOrder = dataOrThrow(await service
      .from('orders')
      .select('pickup_status')
      .eq('id', orderId)
      .single(), 'read confirmed preorder');
    expect(confirmedOrder.pickup_status).toBe('awaiting_pickup');

    await adminPage.goto(`/manage-events/${eventId}/pickup`);
    await expect(adminPage.getByText(pickupCode, { exact: true })).toBeVisible({ timeout: 20_000 });
    await adminPage.getByRole('button', { name: 'Picked up', exact: true }).click();
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Picked up', exact: true }).click();
    await expect.poll(async () => dataOrThrow(await service
      .from('orders')
      .select('pickup_status')
      .eq('id', orderId)
      .single(), 'read picked-up preorder').pickup_status).toBe('picked_up');
    expect(await readStock()).toEqual({ stock_total: 5, stock_reserved: 0, stock_sold: 1 });
    await expect.poll(async () => {
      const deliveries = await service.from('preorder_notification_deliveries')
        .select('notification_event, status').eq('order_id', orderId).throwOnError();
      return deliveries.data.filter(row => row.status === 'delivered').map(row => row.notification_event).sort();
    }, { timeout: 15_000 }).toEqual(['confirmed', 'rejected', 'submitted', 'submitted']);
    await customerPage.reload();
    await expect(customerPage.getByRole('heading', { name: 'Picked up — thank you!', exact: true })).toBeVisible();
    await customerPage.screenshot({ path: `/tmp/nireq-beta-preorder-${test.info().project.name}.png` });
  } finally {
    await customerContext.close().catch(() => undefined);
    await adminContext.close().catch(() => undefined);
  }
});
