import { expect, test, type Page, type Route } from '@playwright/test';
import { activityRewardStateForOrder, getActivityRewards } from '../utils/activityRewards';

const json = (route: Route, body: unknown) => route.fulfill({ json: body });

const activityPricing = [
  {
    id: 'promotion-one',
    name: 'Convention activity bonus',
    discount_amount: 0,
    activity_reward: {
      name: 'Mascot photo session',
      instructions: 'Show this order to booth staff at activity desk B.',
      quantity: 2,
    },
  },
  { name: 'Malformed historic row', activity_reward: { name: '', instructions: 42, quantity: -1 } },
];

const paymentMethod = {
  id: 'payment-one', method_type: 'bank_transfer', display_name: 'Test transfer',
  account_name: 'Test shop', account_number: '0000', promptpay_id: null,
  qr_image_url: null, instructions: null, payment_deadline_at: null, is_enabled: true,
};

const preorder = (paymentStatus: string, status = 'confirmed') => ({
  order_id: '11111111-1111-4111-8111-111111111111', event_id: '22222222-2222-4222-8222-222222222222',
  event_name: 'Activity Event', artist_name: 'Activity Shop', artist_facebook_url: null,
  order_type: 'preorder', shipping_address: null, tracking_number: null, shipping_carrier: null, shipped_at: null,
  status, pickup_status: paymentStatus === 'payment_confirmed' ? 'awaiting_pickup' : 'not_required', pickup_code: 'ACTIVITY01',
  customer_name: 'Test Buyer', customer_email_masked: 't***@example.test', total_price: 100,
  subtotal_price: 100, discount_total: 0, pricing_breakdown: activityPricing, currency: 'THB',
  pickup_instructions: 'Collect at the booth.', payment_status: paymentStatus, slip_url: null,
  submitted_at: null, confirmed_at: paymentStatus === 'payment_confirmed' ? new Date().toISOString() : null,
  rejected_at: null, review_note: null, payment_methods: [paymentMethod],
  payment_deadline_at: new Date(Date.now() + 15 * 60_000).toISOString(), created_at: new Date().toISOString(),
  picked_up_at: null, items: [],
});

const campaign = (paymentStatus: string, status = 'pending') => ({
  id: '33333333-3333-4333-8333-333333333333', order_id: '33333333-3333-4333-8333-333333333333',
  campaign_id: '44444444-4444-4444-8444-444444444444', campaign_name: 'Activity Campaign', campaign_slug: 'activity',
  artist_name: 'Activity Shop', order_code: 'ACTIVITY02', created_at: new Date().toISOString(), status,
  customer_name: 'Test Buyer', fulfillment_method: 'pickup', fulfillment_status: 'awaiting_pickup',
  pickup_point: null, subtotal_price: 100, discount_total: 0, shipping_fee: 0, total_price: 100, currency: 'THB',
  payment_status: paymentStatus, payment_methods: [paymentMethod], items: [], pricing_breakdown: activityPricing,
  stock_hold_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
});

async function useEnglish(page: Page) {
  await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
}

test('activity reward parser rejects malformed untrusted snapshot values', () => {
  expect(getActivityRewards(null)).toEqual([]);
  expect(getActivityRewards({ activity_reward: activityPricing[0].activity_reward })).toEqual([]);
  expect(getActivityRewards([
    null,
    { activity_reward: null },
    { activity_reward: { name: '', instructions: 'Missing name', quantity: 1 } },
    { activity_reward: { name: 'Wrong instructions', instructions: 42, quantity: 1 } },
    { activity_reward: { name: 'Decimal', instructions: '', quantity: 1.5 } },
    { activity_reward: { name: 'String quantity', instructions: '', quantity: '2' } },
  ])).toEqual([]);
  expect(activityRewardStateForOrder('completed', 'refunded')).toBe('inactive');
  expect(activityRewardStateForOrder('completed', 'payment_confirmed')).toBe('earned');
  expect(activityRewardStateForOrder('pending', 'awaiting_payment')).toBe('provisional');
});

test('confirmed preorder displays earned activity rewards from the saved pricing snapshot', async ({ page }) => {
  await useEnglish(page);
  await page.route('**/rest/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/get_public_online_order_by_code')) return json(route, null);
    if (path.endsWith('/get_public_preorder_by_code')) return json(route, [preorder('payment_confirmed')]);
    return json(route, []);
  });

  await page.goto('/activity-shop/order/ACTIVITY01');
  const rewards = page.getByTestId('activity-rewards');
  await expect(rewards).toContainText('Activity rewards earned');
  await expect(rewards).toContainText('Mascot photo session');
  await expect(rewards).toContainText('Show this order to booth staff at activity desk B.');
  await expect(rewards).toContainText('× 2');
  await expect(rewards).not.toContainText('Malformed historic row');
});

test('awaiting campaign payment labels activity rewards as provisional', async ({ page }) => {
  await useEnglish(page);
  await page.route('**/rest/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/get_public_online_order_by_code')) return json(route, campaign('awaiting_payment'));
    return json(route, []);
  });

  await page.goto('/activity-shop/order/ACTIVITY02');
  const rewards = page.getByTestId('activity-rewards');
  await expect(rewards).toContainText('Activity rewards after payment confirmation');
  await expect(rewards).toContainText('These rewards are provisional');
});

test('refunded campaign keeps the snapshot visible but marks rewards inactive', async ({ page }) => {
  await useEnglish(page);
  await page.route('**/rest/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/get_public_online_order_by_code')) return json(route, campaign('refunded', 'completed'));
    return json(route, []);
  });

  await page.goto('/activity-shop/order/ACTIVITY02');
  const rewards = page.getByTestId('activity-rewards');
  await expect(rewards).toContainText('Activity rewards are no longer active');
  await expect(rewards).toContainText('original saved details are shown for reference');
  await expect(rewards).toContainText('manually review any reward already handed out');
});
