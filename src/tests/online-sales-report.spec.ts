import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';
import { LoginPage } from './e2e/pages/LoginPage';
import { selectLanguage } from './helpers/languageMenu';

const id = randomUUID();
const email = `online-report-${id}@example.test`;
const sellerEmail = `online-report-seller-${id}@example.test`;
const password = 'LocalReportTest123!';

test('campaign report isolates confirmed sales, dates and permissions', async ({ browser }) => {
  test.setTimeout(90_000);
  const env = resolveSupabaseTestEnv();
  if (!['127.0.0.1', 'localhost'].includes(new URL(env.url).hostname)) throw new Error('This fixture requires a disposable local database');
  const owner = await ensureOwnerArtistFixture({ email, password, slug: `report-${id.slice(0, 8)}`, displayName: 'Online report fixture' });
  const service = owner.service;
  const seller = await service.auth.admin.createUser({ email: sellerEmail, password, email_confirm: true });
  if (seller.error || !seller.data.user) throw new Error(seller.error?.message || 'Seller fixture missing');
  const sellerId = seller.data.user.id;
  const campaignIds = Array.from({ length: 3 }, () => randomUUID());
  const productId = randomUUID();
  const promotionId = randomUUID();
  const assignmentId = randomUUID();
  const orderIds = Array.from({ length: 5 }, () => randomUUID());
  const ownerContext = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const sellerContext = await browser.newContext();
  try {
    await service.from('artist_members').insert({ artist_id: owner.userId, member_email: sellerEmail, role: 'seller', status: 'active' }).throwOnError();
    await service.from('online_campaigns').insert(campaignIds.map((campaignId, i) => ({
      id: campaignId, artist_id: owner.userId, name: ['Past campaign', 'New campaign', 'Dollar campaign'][i], slug: `report-${i}-${id.slice(0, 8)}`,
      opens_at: '2026-01-01T00:00:00Z', closes_at: '2026-01-02T00:00:00Z', currency: i === 2 ? 'USD' : 'THB', shipping_enabled: true,
      publication_status: i === 0 ? 'archived' : 'published',
    }))).throwOnError();
    const data = [
      { campaign: 0, amount: 100.1, payment: 'payment_confirmed', currency: 'THB' },
      { campaign: 1, amount: 0.2, payment: 'payment_confirmed', currency: 'THB' },
      { campaign: 0, amount: 999, payment: 'awaiting_payment', currency: 'THB' },
      { campaign: 0, amount: 888, payment: 'refunded', currency: 'THB' },
      { campaign: 2, amount: 12, payment: 'payment_confirmed', currency: 'USD' },
    ];
    await service.from('orders').insert(data.map((row, i) => ({
      id: orderIds[i], campaign_id: campaignIds[row.campaign], order_type: 'online_sale', fulfillment_method: 'shipping',
      pickup_status: 'awaiting_shipment', status: 'confirmed', pickup_code: randomUUID().replace(/-/g, '').toUpperCase(),
      customer_name: 'Synthetic buyer', customer_email: 'buyer@example.test', total_price: row.amount, currency: row.currency,
    }))).throwOnError();
    await service.from('order_payments').insert(data.map((row, i) => ({
      order_id: orderIds[i], campaign_id: campaignIds[row.campaign], artist_id: owner.userId,
      amount_expected: row.amount, currency: row.currency, payment_status: row.payment,
    }))).throwOnError();

    await service.from('products').insert({ id: productId, artist_id: owner.userId, name: 'Example badge', category: 'Badge', image_url: 'public/report-example.png', price: 100, currency: 'THB', status: 'enable', is_unlimited: true }).throwOnError();
    await service.from('artist_promotions').insert({ id: promotionId, artist_id: owner.userId, name: 'Example promotion', target_type: 'all', rule_type: 'discount', promotion_type: 'quantity_discount', buy_quantity: 2, reward_value: 10, lifecycle_status: 'ready' }).throwOnError();
    await service.from('promotion_assignments').insert({ id: assignmentId, promotion_id: promotionId, artist_id: owner.userId, campaign_id: campaignIds[0], combination_policy: 'combine' }).throwOnError();
    await service.from('order_items').insert([
      { order_id: orderIds[0], product_id: productId, product_name_snapshot: 'Example badge', quantity: 2, price_per_unit: 50, currency: 'THB', line_type: 'purchase' },
      { order_id: orderIds[0], product_id: productId, product_name_snapshot: 'Example badge', quantity: 1, price_per_unit: 0, currency: 'THB', line_type: 'promotion_reward', promotion_id: promotionId, promotion_assignment_id: assignmentId },
      { order_id: orderIds[1], product_id: productId, product_name_snapshot: 'Example badge', quantity: 7, price_per_unit: 1, currency: 'THB', line_type: 'purchase' },
    ]).throwOnError();
    await service.from('orders').update({ subtotal_price: 100, discount_total: 10, shipping_fee: 10.1, pricing_breakdown: [{ id: 'test-promo', name: 'Example promotion', discount_amount: 10 }] }).eq('id', orderIds[0]).throwOnError();
    const client = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    const actual = await client.rpc('get_campaign_sales_analytics', { p_campaign_id: campaignIds[0] });
    expect(actual.error).toBeNull();
    expect(actual.data).toMatchObject({ orders: 1, revenue: 100.1, items: 2, gifts: 1 });
    expect(actual.data.promotions[0]).toMatchObject({ name: 'Example promotion', orders: 1, discount: 10 });
    expect(actual.data.products[0]).toMatchObject({ qty: 2, gifts: 1, revenue: 100 });
    const outside = await client.rpc('get_campaign_sales_analytics', { p_campaign_id: campaignIds[0], p_from: '2000-01-01', p_to: '2000-01-02' });
    expect(outside.data.orders).toBe(0);
    await service.from('online_campaigns').update({ currency: 'USD' }).eq('id', campaignIds[0]).throwOnError();
    const mixed = await client.rpc('get_campaign_sales_analytics', { p_campaign_id: campaignIds[0] });
    expect(mixed.error?.message).toContain('campaign_currency_mismatch');
    await service.from('online_campaigns').update({ currency: 'THB' }).eq('id', campaignIds[0]).throwOnError();
    const sellerClient = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await sellerClient.auth.signInWithPassword({ email: sellerEmail, password }).then(({ error }) => { if (error) throw error; });
    expect((await sellerClient.rpc('get_campaign_sales_analytics', { p_campaign_id: campaignIds[0] })).error).not.toBeNull();
    const page = await ownerContext.newPage();
    await page.route('**/storage/v1/object/public/Menu/public/report-example.png', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/6uoAAAAASUVORK5CYII=', 'base64') }));
    await page.addInitScript(() => { if (!localStorage.getItem('nireq-language')) localStorage.setItem('nireq-language', 'en'); });
    const login = new LoginPage(page);
    await login.goto(); await login.login(email, password);
    await expect(page).not.toHaveURL(/manage-login/, { timeout: 20_000 });
    await page.goto(`/manage-online-sales/${campaignIds[0]}`);
    await page.getByRole('button', { name: 'Sales', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sales dashboard' })).toBeVisible();
    await expect(page.getByText('Example promotion')).toBeVisible();
    await expect(page.getByText('Example badge').first()).toBeVisible();
    await expect(page.getByRole('img', { name: 'Example badge' })).toHaveCount(2);
    await expect(page.getByRole('heading', { name: 'Sales by hour' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Sales by day' })).toBeVisible();
    await page.getByLabel('Search products').fill('no matching product');
    await expect(page.getByText('Example badge')).toHaveCount(1);
    await page.getByLabel('Search products').clear();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export product CSV' }).click();
    expect((await download).suggestedFilename()).toMatch(/campaign-sales-.*\.csv/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const decline = page.getByRole('button', { name: 'Decline', exact: true });
    if (await decline.isVisible()) await decline.click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await selectLanguage(page, 'th');
    await page.reload();
    await page.getByRole('button', { name: 'ยอดขาย', exact: true }).click();
    await expect(page.getByText('Example promotion')).toBeVisible();
    await page.locator('.sales-reports').screenshot({ path: 'output/playwright/campaign-sales-report.png' });
  } finally {
    await ownerContext.close().catch(() => undefined);
    await sellerContext.close().catch(() => undefined);
    await service.from('order_items').delete().in('order_id', orderIds).throwOnError();
    await service.from('order_payments').delete().in('order_id', orderIds).throwOnError();
    await service.from('orders').delete().in('id', orderIds).throwOnError();
    await service.from('promotion_assignments').delete().eq('id', assignmentId).throwOnError();
    await service.from('artist_promotions').delete().eq('id', promotionId).throwOnError();
    await service.from('online_campaigns').delete().in('id', campaignIds).throwOnError();
    await service.from('artist_members').delete().eq('artist_id', owner.userId).throwOnError();
    await service.from('products').delete().eq('id', productId).throwOnError();
    await service.from('artists').delete().eq('id', owner.userId).throwOnError();
    await service.auth.admin.deleteUser(sellerId);
    await service.auth.admin.deleteUser(owner.userId);
  }
});
