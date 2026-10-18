import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';
import { LoginPage } from './e2e/pages/LoginPage';

const token = randomUUID();
const email = `bundle-pos-${token}@example.local`, password = 'LocalBundlePOS123!';
const event = randomUUID(), component = randomUUID(), queue = randomUUID();
let service: SupabaseClient, artist = '', parent = '', bundle = '', order = '';
const must = (result: { error: { message: string } | null }) => { if (result.error) throw new Error(result.error.message); };

test.beforeAll(async () => {
  const env = resolveSupabaseTestEnv();
  if (!['localhost', '127.0.0.1'].includes(new URL(env.url).hostname)) throw new Error('Disposable local fixture required');
  const fixture = await ensureOwnerArtistFixture({ email, password, slug: `bundle-pos-${token.slice(0, 8)}`, displayName: 'Bundle POS fixture' });
  service = fixture.service; artist = fixture.userId;
  const owner = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
  must(await owner.auth.signInWithPassword({ email, password }));
  must(await service.from('products').insert({ id: component, artist_id: artist, name: 'Bundle component', price: 100, stock_total: 2, is_unlimited: false, status: 'enable' }));
  const saved = await owner.rpc('save_product_bundle', { p_parent: { artist_id: artist, name: 'Last stock bundle', base_price: 200 }, p_components: [{ product_id: component, quantity: 2 }] });
  must(saved); parent = saved.data;
  const item = await service.from('products').select('id').eq('parent_product_id', parent).single(); must(item); bundle = item.data!.id;
  must(await service.from('events').insert({ id: event, artist_id: artist, event_name: 'Last stock POS', start_date: new Date(Date.now() - 3600000).toISOString(), end_date: new Date(Date.now() + 86400000).toISOString(), status: 'Confirmed', is_booth_open: true, event_timezone: 'Asia/Bangkok' }));
  must(await service.from('event_products').insert([
    { artist_id: artist, event_id: event, product_id: component, is_unlimited: false, stock_total: 2, is_enabled: true, is_sellable: false },
    { artist_id: artist, event_id: event, product_id: bundle, is_unlimited: true, stock_total: null, is_enabled: true, is_sellable: true },
  ]));
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  must(await service.from('queues').insert({ id: queue, artist_id: artist, event_id: event, queue_number: 2, queue_service_date: date, status: 'serving', called_at: new Date().toISOString(), served_at: new Date().toISOString() }));
  const created = await owner.rpc('create_customer_order_with_stock', { p_queue_id: queue, p_items: [{ product_id: bundle, quantity: 1 }], p_payment_idempotency_key: null });
  must(created); order = created.data;
  await owner.auth.signOut();
});

test.afterAll(async () => {
  if (!service || !artist) return;
  // Completed ledgers deliberately resist deletion in the application. Purge only
  // this generated fixture through the confirmed disposable local database.
  if (order) {
    const project = readFileSync(resolve(process.env.SUPABASE_WORKDIR || '.', 'supabase/config.toml'), 'utf8').match(/^project_id\s*=\s*"([\w-]+)"/m)?.[1];
    if (!project || !/^[0-9a-f-]{36}$/.test(order)) throw new Error('Invalid fixture target');
    execFileSync('docker', ['exec', `supabase_db_${project}`, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `delete from private.bundle_order_components where order_item_id in(select id from public.order_items where order_id='${order}');`], { stdio: 'ignore' });
    must(await service.from('orders').delete().eq('id', order));
  }
  must(await service.from('event_products').delete().eq('event_id', event));
  must(await service.from('queues').delete().eq('event_id', event));
  must(await service.from('events').delete().eq('id', event));
  if (bundle) must(await service.from('products').delete().eq('id', bundle));
  must(await service.from('products').delete().eq('id', component));
  if (parent) must(await service.from('product_parents').delete().eq('id', parent));
  must(await service.from('artists').delete().eq('id', artist));
  must(await service.auth.admin.deleteUser(artist));
});

test('POS charges a queue’s last reserved bundle and history keeps component quantities', async ({ page }) => {
  await new LoginPage(page).goto(); await new LoginPage(page).login(email, password);
  await expect(page).toHaveURL(/manage-events/, { timeout: 20000 });
  await page.goto(`/live/pos?eventId=${event}`);
  await page.getByRole('button', { name: 'Queue #2', exact: true }).click();
  const charge = page.getByRole('button', { name: /Charge/ });
  await expect(charge).toBeEnabled({ timeout: 20000 });
  await charge.click(); await page.getByRole('button', { name: /CASH/i }).click();
  await expect.poll(async () => { const result = await service.from('orders').select('status').eq('id', order).single(); must(result); return result.data!.status; }).toBe('completed');
  const stock = await service.from('event_products').select('stock_reserved,stock_sold').eq('event_id', event).eq('product_id', component).single();
  must(stock); expect(stock.data).toMatchObject({ stock_reserved: 0, stock_sold: 2 });
  await page.getByRole('button', { name: 'Sales history', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Sales history', exact: true });
  await history.getByText(`#${order.replace(/-/g, '').slice(0, 8).toUpperCase()}`, { exact: true }).click();
  await expect(history.getByLabel('Recorded bundle components')).toContainText('Bundle component');
  await expect(history.getByLabel('Recorded bundle components')).toContainText('2');
});
