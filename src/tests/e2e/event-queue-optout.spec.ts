import { expectSignedInAccount } from '../helpers/accountMenu';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveSupabaseTestEnv } from '../helpers/localSupabaseEnv';
import { ensureOwnerArtistFixture } from '../helpers/adminFixture';
import { LoginPage } from './pages/LoginPage';

const runId = randomUUID();
const adminEmail = `queue-optout-${runId}@example.test`;
const adminPassword = 'LocalOnlyTestPassword123!';
const artistSlug = `fs-${runId.slice(0, 8)}`;
const eventId = randomUUID();
const otherEventId = randomUUID();
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
    displayName: 'Queue Optout Fixture',
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
  must(await service.from('events').insert({ id: otherEventId, artist_id: artistId, event_name: 'Another event', start_date: new Date(now - 30 * 60 * 1000).toISOString(), end_date: new Date(now + 24 * 60 * 60 * 1000).toISOString(), status: 'Confirmed', is_booth_open: true }), 'seed another event');
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
  must(await service.from('queues').delete().eq('event_id', otherEventId), 'delete other fixture queues');
  must(await service.from('event_products').delete().eq('event_id', eventId), 'delete fixture event products');
  must(await service.from('products').delete().eq('id', productId), 'delete fixture product');
  must(await service.from('events').delete().eq('id', eventId), 'delete fixture event');
  must(await service.from('events').delete().eq('id', otherEventId), 'delete other event');
  must(await service.from('artists').delete().eq('id', artistId), 'delete fixture artist');
  const deletedUser = await service.auth.admin.deleteUser(artistId);
  if (deletedUser.error) throw new Error(`delete fixture user: ${deletedUser.error.message}`);
});

test('event queue can be disabled while the public shop and walk-in POS remain available', async ({ browser }) => {
  test.setTimeout(120_000);
  const owner = await browser.newPage();
  const customer = await browser.newPage();
  owner.setDefaultTimeout(15_000);
  customer.setDefaultTimeout(15_000);
  await owner.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
  await customer.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
  const login = new LoginPage(owner);
  const env = resolveSupabaseTestEnv();
  const anon = createClient(env.url, env.anonKey);
  const existing = await anon.rpc('create_queue_ticket', { p_artist_id: artistId, p_event_id: eventId, p_customer_fingerprint: randomUUID() });
  expect(existing.error).toBeNull();
  await login.goto();
  await login.login(adminEmail, adminPassword);
  await expectSignedInAccount(owner);
  await owner.goto(`/manage-events/${eventId}/workspace`);
  await owner.getByRole('button', { name: 'Queue settings', exact: true }).click();
  const dialog = owner.getByRole('dialog', { name: 'Edit Event' });
  await dialog.getByRole('checkbox', { name: /Use online queue for this event/ }).uncheck();
  await dialog.getByRole('button', { name: 'Save Event' }).click();
  await expect(owner.getByText('Off · customers can browse and buy at the booth')).toBeVisible();
  const denied = await anon.rpc('create_queue_ticket', { p_artist_id: artistId, p_event_id: eventId, p_customer_fingerprint: randomUUID() });
  expect(denied.error?.message).toContain('queue_not_enabled');
  const otherTicket = await anon.rpc('create_queue_ticket', { p_artist_id: artistId, p_event_id: otherEventId, p_customer_fingerprint: randomUUID() });
  expect(otherTicket.error).toBeNull();
  const original = await service.from('queues').select('status').eq('id', existing.data[0].id).single();
  expect(original.data?.status).toBe('waiting');
  const forbiddenUpdate = await anon.from('events').update({ queue_enabled: true }).eq('id', eventId).select('id');
  expect(forbiddenUpdate.data || []).toHaveLength(0);

  const existingCustomer = await browser.newPage();
  await existingCustomer.addInitScript(({ key, value }) => {
    localStorage.setItem('nireq-language', 'en');
    localStorage.setItem(key, value);
  }, { key: `ticket_id_${artistId}`, value: existing.data[0].id });
  await existingCustomer.goto(`/${artistSlug}/queue`);
  await expect(existingCustomer.locator('.queue-ticket-number')).toHaveText(`#${existing.data[0].queue_number}`);
  await existingCustomer.close();

  await customer.goto(`/${artistSlug}/home`);
  await expect(customer.getByText('This event does not use online queues. Browse products and purchase at the booth.')).toBeVisible();
  await customer.goto(`/${artistSlug}/menu`);
  await expect(customer.getByText('This event does not use online queues. Browse products and purchase at the booth.').first()).toBeVisible();
  await expect(customer.getByRole('button', { name: `Add: ${productName}`, exact: true })).toBeVisible();
  await customer.getByRole('button', { name: `Add: ${productName}`, exact: true }).click();
  await expect(customer.getByRole('button', { name: 'Wait', exact: true })).toHaveCount(0);
  await customer.goto(`/${artistSlug}/queue`);
  await expect(customer.getByText('Online queue is not used for this event').first()).toBeVisible();
  await expect(customer.getByRole('button', { name: /Get Ticket/ })).toHaveCount(0);

  await owner.goto(`/live/pos?eventId=${eventId}`);
  const products = owner.getByRole('region', { name: /Product list|Product grid/ });
  await products.getByRole('button').filter({ hasText: productName }).first().click();
  await owner.getByRole('button', { name: /Charge/ }).click();
  await owner.getByRole('button', { name: /CASH/i }).click();
  await expect.poll(async () => {
    const result = await service.from('orders').select('status, payment_method').eq('event_id', eventId).eq('status', 'completed');
    must(result, 'read walk-in sale');
    return result.data?.some(order => order.payment_method === 'cash');
  }).toBe(true);

  await owner.goto(`/manage-events/${eventId}/workspace`);
  await owner.getByRole('button', { name: 'Queue settings', exact: true }).click();
  const reopenDialog = owner.getByRole('dialog', { name: 'Edit Event' });
  await reopenDialog.getByRole('checkbox', { name: /Use online queue for this event/ }).check();
  await reopenDialog.getByRole('button', { name: 'Save Event' }).click();
  await expect(owner.getByText('On · customers can join when the booth is open')).toBeVisible();
  const allowed = await anon.rpc('create_queue_ticket', { p_artist_id: artistId, p_event_id: eventId, p_customer_fingerprint: randomUUID() });
  expect(allowed.error).toBeNull();
  await owner.close();
  await customer.close();
});
