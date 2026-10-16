import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

const check = (result: { error: unknown }) => { if (result.error) throw result.error; };
const must = <T,>(result: { data: T; error: unknown }): T => { if (result.error) throw result.error; return result.data; };

test('opening count, production receipt preview, phase policy and mobile stock breakdown', async ({ page }) => {
  const env = resolveSupabaseTestEnv();
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(env.url)) throw new Error('Disposable local database required');
  const suffix = randomUUID().slice(0, 10), product = randomUUID(), event = randomUUID();
  const email = `production-${suffix}@example.local`, password = 'LocalInventoryTest123!';
  const { userId, service } = await ensureOwnerArtistFixture({ email, password, slug: `production-${suffix}`, displayName: 'Production fixture' });
  const anon = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
  const now = Date.now(), iso = (offset: number) => new Date(now+offset).toISOString();
  try {
    must(await service.from('products').insert({ id: product, artist_id: userId, name: 'Production photoset', price: 200, is_unlimited: true, status: 'enable' }));
    must(await service.from('events').insert({ id: event, artist_id: userId, event_name: 'Production event', status: 'Confirmed', start_date: iso(172800000), end_date: iso(259200000), preorder_enabled: true, preorder_opens_at: iso(-3600000), preorder_closes_at: iso(86400000) }));
    must(await service.from('event_products').insert({ event_id: event, artist_id: userId, product_id: product, is_enabled: true, is_unlimited: true }));
    const created = must(await anon.rpc('create_preorder_with_stock', { p_event_id: event, p_items: [{ product_id: product, quantity: 20 }], p_customer_name: 'Local fixture buyer', p_customer_email: 'buyer@example.local', p_customer_contact: 'local fixture' }))[0];
    must(await service.from('order_payments').update({ payment_status: 'payment_confirmed' }).eq('order_id', created.order_id));
    must(await service.from('orders').update({ status: 'confirmed', pickup_status: 'awaiting_pickup' }).eq('id', created.order_id));
    await page.addInitScript(() => { localStorage.setItem('nireq-language','en'); localStorage.setItem('nireq-replay-consent-v1','rejected'); });
    await page.goto('/manage-login');
    await page.locator('input[type=email]').fill(email); await page.locator('input[type=password]').fill(password);
    await page.getByRole('button', { name: /Login/i }).click(); await expect(page).toHaveURL(/manage-events/);
    await page.goto('/manage-products');
    await page.getByRole('button', { name: 'Track stock', exact: true }).click();
    await page.getByLabel('Physical units present now').fill('15');
    await expect(page.getByText(/Earmark 15 · available to allocate 0 · shortfall 5/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm opening count' }).click();
    await expect.poll(async () => must(await service.from('products').select('is_unlimited,stock_reserved').eq('id', product).single())).toEqual({ is_unlimited: false, stock_reserved: 15 });
    await expect(page.getByRole('button', { name: 'Do not track', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Adjust stock', exact: true }).first().click();
    await page.getByLabel('Quantity', { exact: true }).fill('35');
    await expect(page.getByText(/Receive 35 · earmark 5 · available 30 · shortfall 0/)).toBeVisible();
    await page.getByRole('button', { name: 'Save receipt', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByText('Stock and production breakdown', { exact: true }).click();
    await expect(page.locator('dl').getByText('Physical on hand', { exact: true }).locator('..')).toContainText('50');
    await expect(page.getByText('Unallocated', { exact: true }).locator('..')).toContainText('30');
    await expect(page.getByText('Earmarked for production / existing orders', { exact: true }).locator('..')).toContainText('20');
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/manage-events/${event}/catalog`);
    await page.getByText('Supply / made to order', { exact: false }).first().click();
    await page.getByLabel('preorder supply policy').first().selectOption('production');
    await page.getByLabel('Unlimited production orders').first().uncheck();
    await page.getByLabel('preorder production cap').first().fill('30');
    await page.getByRole('button', { name: 'Save policy', exact: true }).first().click();
    await expect(page.getByText('Saved. Existing orders keep their original supply policy.')).toBeVisible();
    const policy = must(await service.from('event_products').select('preorder_supply_mode,preorder_production_limit,postorder_supply_mode').eq('event_id',event).single());
    expect(policy).toEqual({ preorder_supply_mode: 'production', preorder_production_limit: 30, postorder_supply_mode: 'stock' });
    await page.screenshot({ path: 'output/playwright/production-inventory-event.png', fullPage: true });
    await page.goto(`/production-${suffix}/menu?eventId=${event}`);
    await expect(page.getByText('Made to order', { exact: true }).first()).toBeVisible();
    const nextOrder = must(await anon.rpc('create_preorder_with_stock', { p_event_id: event, p_items: [{ product_id: product, quantity: 10, expected_supply_mode: 'production' }], p_customer_name: 'New production buyer', p_customer_email: 'newbuyer@example.local', p_customer_contact: 'local fixture' }))[0];
    must(await service.from('order_payments').update({ payment_status: 'payment_confirmed' }).eq('order_id', nextOrder.order_id));
    must(await service.from('orders').update({ status: 'confirmed', pickup_status: 'awaiting_pickup' }).eq('id', nextOrder.order_id));
    expect(must(await service.from('products').select('stock_reserved').eq('id',product).single())?.stock_reserved).toBe(20);
    await page.goto('/manage-products');
    await page.getByRole('button', { name: 'Earmark existing ready stock', exact: true }).click();
    await expect(page.getByText(/Earmark up to 10 from 30 ready units; remaining 20/)).toBeVisible();
    await page.route('**/rest/v1/rpc/assign_production_stock', async route => {
      const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort('connectionreset');
    });
    await page.getByRole('button', { name: 'Confirm earmark', exact: true }).click();
    await expect.poll(async () => must(await service.from('products').select('stock_reserved').eq('id',product).single())?.stock_reserved).toBe(30);
    await page.reload(); await page.unroute('**/rest/v1/rpc/assign_production_stock');
    await page.getByRole('button', { name: 'Retry pending earmark', exact: true }).click();
    await expect(page.getByLabel('Maximum ready units to earmark')).toHaveValue('10');
    await page.getByRole('button', { name: 'Confirm earmark', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry pending earmark', exact: true })).toHaveCount(0);
    expect(must(await service.from('products').select('stock_reserved').eq('id',product).single())?.stock_reserved).toBe(30);

  } finally {
    must(await service.from('orders').delete().eq('event_id', event));
    must(await service.from('artists').delete().eq('id', userId));
    check(await service.auth.admin.deleteUser(userId));
  }
});

test('simultaneous production orders cannot exceed a channel cap and campaign policy survives reload', async ({ page }) => {
  const env = resolveSupabaseTestEnv();
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(env.url)) throw new Error('Disposable local database required');
  const suffix = randomUUID().slice(0, 10), product = randomUUID(), campaign = randomUUID();
  const email = `production-race-${suffix}@example.local`, password = 'LocalInventoryTest123!';
  const { userId, service } = await ensureOwnerArtistFixture({ email, password, slug: `production-race-${suffix}`, displayName: 'Production race' });
  const anon = createClient(env.url,env.anonKey,{ auth: { persistSession:false } });
  const owner = createClient(env.url,env.anonKey,{ auth: { persistSession:false } });
  try {
    check(await owner.auth.signInWithPassword({ email,password }));
    must(await service.from('products').insert({ id:product,artist_id:userId,name:'Production race item',price:200,is_unlimited:false,stock_total:0,status:'enable' }));
    must(await service.from('online_campaigns').insert({ id:campaign,artist_id:userId,name:'Production race',slug:`race-${suffix}`,publication_status:'published',shipping_enabled:true,opens_at:new Date(Date.now()-3600000).toISOString(),closes_at:new Date(Date.now()+86400000).toISOString() }));
    must(await service.from('online_campaign_products').insert({ campaign_id:campaign,artist_id:userId,product_id:product,is_enabled:true,is_unlimited:false,stock_total:0 }));
    must(await service.from('campaign_payment_methods').insert({ campaign_id:campaign,artist_id:userId,method_type:'promptpay',promptpay_id:'0000000000' }));
    must(await owner.rpc('configure_product_supply',{ p_product_id:product,p_event_id:null,p_campaign_id:campaign,p_phase:'campaign',p_mode:'production',p_limit:5 }));
    const results = await Promise.all(Array.from({ length:4 },()=>anon.rpc('create_online_campaign_order',{ p_campaign_id:campaign,p_items:[{product_id:product,quantity:3,expected_supply_mode:'production'}],p_fulfillment_method:'shipping',p_pickup_point_id:null,p_customer_name:'Local race buyer',p_customer_email:'race@example.local',p_customer_phone:'0800000000',p_shipping_address:'Local fixture address',p_customer_note:'',p_client_request_id:randomUUID() })));
    expect(results.filter(result=>!result.error)).toHaveLength(1);
    for (const result of results.filter(result=>result.error)) expect(result.error?.message).toContain('production_limit_exceeded');
    expect(must(await service.from('order_items').select('quantity,inventory_source').eq('product_id',product))).toEqual([{quantity:3,inventory_source:'production'}]);
    expect(must(await service.from('products').select('stock_total,stock_reserved,stock_sold').eq('id',product).single())).toEqual({stock_total:0,stock_reserved:0,stock_sold:0});
    const storefront = must(await anon.rpc('get_public_online_campaign', { p_artist_slug: `production-race-${suffix}`, p_campaign_slug: `race-${suffix}` }));
    expect(storefront.state).toBe('open');
    expect(storefront.products[0].available_quantity).toBe(2);
    await page.addInitScript(() => { localStorage.setItem('nireq-language','en'); localStorage.setItem('nireq-replay-consent-v1','rejected'); });
    await page.goto('/manage-login');
    await page.locator('input[type=email]').fill(email); await page.locator('input[type=password]').fill(password);
    await page.getByRole('button', { name: /Login/i }).click(); await expect(page).toHaveURL(/manage-events/);
    await page.goto(`/manage-online-sales/${campaign}`);
    await page.getByRole('button', { name: 'Products', exact: true }).click();
    await page.locator('summary').filter({ hasText: 'Supply / made to order' }).click();
    await expect(page.getByLabel('campaign supply policy')).toHaveValue('production');
    await expect(page.getByLabel('campaign production cap')).toHaveValue('5');
    await page.getByLabel('campaign production cap').fill('6');
    await page.getByRole('button', { name: 'Save policy', exact: true }).click();
    await expect.poll(async () => must(await service.from('online_campaign_products').select('production_limit').eq('campaign_id',campaign).single())?.production_limit).toBe(6);
    await page.reload();
    await page.getByRole('button', { name: 'Products', exact: true }).click();
    await page.locator('summary').filter({ hasText: 'Supply / made to order' }).click();
    await expect(page.getByLabel('campaign supply policy')).toHaveValue('production');
    await expect(page.getByLabel('campaign production cap')).toHaveValue('6');

  } finally {
    must(await service.from('orders').delete().eq('campaign_id',campaign));
    must(await service.from('artists').delete().eq('id',userId)); check(await service.auth.admin.deleteUser(userId));
  }
});
