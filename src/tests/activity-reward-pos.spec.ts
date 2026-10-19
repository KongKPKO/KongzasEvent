import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';
import { LoginPage } from './e2e/pages/LoginPage';

const runId = randomUUID();
const email = `activity-pos-${runId}@example.local`;
const password = 'LocalActivityPOS123!';
const eventId = randomUUID();
const productId = randomUUID();
const productName = 'Activity pass bundle';
const activityName = 'VIP stage game';
const activityInstructions = 'Show this order ID to staff at the activity desk.';

let service: SupabaseClient;
let artistId = '';
let promotionId = '';

const must = <T extends { error: { message: string } | null }>(result: T): T => {
  if (result.error) throw new Error(result.error.message);
  return result;
};

test.beforeAll(async () => {
  const env = resolveSupabaseTestEnv();
  if (!['127.0.0.1', 'localhost'].includes(new URL(env.url).hostname)) {
    throw new Error('Activity POS journey requires disposable local Supabase');
  }

  const fixture = await ensureOwnerArtistFixture({
    email,
    password,
    slug: `activity-pos-${runId.slice(0, 8)}`,
    displayName: 'Activity POS fixture',
  });
  service = fixture.service;
  artistId = fixture.userId;

  must(await service.from('events').insert({
    id: eventId,
    artist_id: artistId,
    event_name: 'Activity POS event',
    start_date: new Date(Date.now() - 3_600_000).toISOString(),
    end_date: new Date(Date.now() + 86_400_000).toISOString(),
    event_timezone: 'Asia/Bangkok',
    status: 'Confirmed',
    is_booth_open: true,
  }));
  must(await service.from('products').insert({
    id: productId,
    artist_id: artistId,
    name: productName,
    sku: 'ACTIVITY-POS-700',
    category: 'Activity test',
    price: 700,
    currency: 'THB',
    stock_total: null,
    is_unlimited: true,
    status: 'enable',
  }));
  must(await service.from('event_products').insert({
    event_id: eventId,
    product_id: productId,
    artist_id: artistId,
    stock_total: null,
    is_unlimited: true,
    is_enabled: true,
  }));

  const owner = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  must(await owner.auth.signInWithPassword({ email, password }));
  const saved = must(await owner.rpc('save_promotion_definition', {
    p_definition: {
      artist_id: artistId,
      name: 'Spend 500 for stage game',
      promotion_type: 'condition_reward',
      target_type: 'all',
      match_product_ids: [],
      assignments: [{
        event_id: eventId,
        event_phase: 'live',
        campaign_id: null,
        starts_at: null,
        ends_at: null,
        is_paused: false,
        combination_policy: 'combine',
      }],
      tiers: [],
      reward_product_ids: [],
      v1_config: {
        version: 1,
        condition: { kind: 'spend', amount: 500 },
        discount: null,
        gift: null,
        activity: { name: activityName, instructions: activityInstructions, quantity: 1 },
      },
    },
  }));
  promotionId = String(saved.data || '');
  if (!promotionId) throw new Error('Activity promotion was not saved');
  await owner.auth.signOut();
});

test.afterAll(async () => {
  if (!service || !artistId) return;
  const orders = must(await service.from('orders').select('id').eq('event_id', eventId));
  const orderIds = (orders.data || []).map((order) => order.id);
  if (orderIds.length > 0) {
    must(await service.from('payment_review_events').delete().in('order_id', orderIds));
    must(await service.from('order_payments').delete().in('order_id', orderIds));
    must(await service.from('order_items').delete().in('order_id', orderIds));
    must(await service.from('orders').delete().in('id', orderIds));
  }
  if (promotionId) must(await service.from('artist_promotions').delete().eq('id', promotionId));
  must(await service.from('event_products').delete().eq('event_id', eventId));
  must(await service.from('products').delete().eq('id', productId));
  must(await service.from('events').delete().eq('id', eventId));
  must(await service.from('artists').delete().eq('id', artistId));
  must(await service.auth.admin.deleteUser(artistId));
});

test('cash POS auto-dismisses earned activity notice and history keeps the immutable snapshot', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
  const login = new LoginPage(page);
  await login.goto();
  await login.login(email, password);
  await expect(page).toHaveURL(/manage-events/, { timeout: 30_000 });
  await page.goto(`/live/pos?eventId=${eventId}`);

  const productRegion = page.getByRole('region', { name: /Product list|Product grid/ });
  const productButton = productRegion.getByRole('button').filter({ hasText: productName }).first();
  await expect(productButton).toBeEnabled({ timeout: 20_000 });
  await productButton.click();
  await expect(page.getByRole('textbox', { name: /customer name/i })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Shopping cart' }).getByText(productName, { exact: true })).toBeVisible();

  const charge = page.getByRole('button', { name: 'Charge ฿700', exact: true });
  await expect(charge).toBeEnabled({ timeout: 20_000 });
  await charge.click();
  await page.getByRole('dialog', { name: 'Record payment' }).getByRole('button', { name: /CASH$/ }).click();

  await expect.poll(async () => {
    const result = await service.from('orders')
      .select('status')
      .eq('event_id', eventId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    must(result);
    return result.data?.status || null;
  }, { timeout: 30_000 }).toBe('completed');

  const orderResult = must(await service.from('orders')
    .select('id,status,pricing_breakdown')
    .eq('event_id', eventId)
    .eq('status', 'completed')
    .single());
  const orderId = orderResult.data!.id;
  expect(orderResult.data!.pricing_breakdown).toEqual(expect.arrayContaining([
    expect.objectContaining({
      name: 'Spend 500 for stage game',
      activity_reward: { name: activityName, instructions: activityInstructions, quantity: 1 },
    }),
  ]));
  const earned = page.getByTestId('activity-rewards');
  await expect(earned).toContainText('Activity rewards earned');
  await expect(earned).toContainText(activityName);
  await expect(earned).toContainText(activityInstructions);
  await expect(earned).toContainText(orderId);
  await expect(page.getByRole('region', { name: 'Shopping cart' })).toContainText('Cart is empty');

  await page.screenshot({ path: testInfo.outputPath('activity-pos-earned.png') });
  await expect(earned).toHaveCount(0, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Sales history', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Sales history', exact: true });
  const orderNumber = `#${orderId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  await history.getByText(orderNumber, { exact: true }).click();
  const detailRewards = history.getByTestId('pos-sale-detail').getByTestId('activity-rewards');
  await expect(detailRewards).toContainText('Activity rewards earned');
  await expect(detailRewards).toContainText(activityName);
  await expect(detailRewards).toContainText(activityInstructions);
  await expect(detailRewards).toContainText(orderNumber.slice(1));
});
