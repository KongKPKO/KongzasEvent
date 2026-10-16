import { expect, test } from '@playwright/test';

for (const channel of ['campaign', 'preorder', 'post_event']) {
  test(`${channel} displays PromptPay, QR and several bank accounts together`, async ({ page }) => {
    const deadline = new Date(Date.now() + 15 * 60_000).toISOString();
    const methods = [
      { id: 'one', method_type: 'promptpay', display_name: 'All payment options', promptpay_id: 'TEST-PROMPTPAY', bank_name: 'Test Bank A', account_number: 'TEST-ACCOUNT-A', account_name: 'Test Merchant A', qr_image_url: 'https://ik.imagekit.io/kongzas/Menu/testqr.png', instructions: 'Choose any listed destination.', bank_accounts: [{ bank_name: 'Test Bank A', account_number: 'TEST-ACCOUNT-A', account_name: 'Test Merchant A' }, { bank_name: 'Test Bank A2', account_number: 'TEST-ACCOUNT-A2', account_name: 'Test Merchant A' }] },
      { id: 'two', method_type: 'bank_transfer', display_name: 'Second bank', bank_name: 'Test Bank B', account_number: 'TEST-ACCOUNT-B', account_name: 'Test Merchant B' },
      { id: 'three', method_type: 'bank_transfer', display_name: 'Third bank', bank_name: 'Test Bank C', account_number: 'TEST-ACCOUNT-C', account_name: 'Test Merchant C' },
    ];
    const order = {
      order_id: '11111111-1111-4111-8111-111111111111', event_id: '22222222-2222-4222-8222-222222222222',
      campaign_id: '33333333-3333-4333-8333-333333333333', campaign_slug: 'test-campaign', event_name: 'Test Event', artist_name: 'Test Shop',
      order_type: channel, order_code: 'TESTORDER', pickup_code: 'TESTORDER', status: 'draft', pickup_status: 'not_required',
      payment_status: 'awaiting_payment', stock_hold_expires_at: deadline, payment_deadline_at: deadline,
      fulfillment_type: 'pickup', fulfillment_status: 'pending', pickup_point_snapshot: { name: 'Test pickup' },
      created_at: new Date().toISOString(), customer_name: 'Test Buyer', customer_email_masked: 't***@example.test',
      currency: 'THB', total_price: 100, subtotal_price: 100, shipping_fee: 0, discount_total: 0,
      payment_methods: methods, pickup_instructions: '', items: [],
    };
    await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
    await page.route('**/testqr.png', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40"/></svg>' }));
    await page.route('**/rest/v1/**', route => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({ json: path.endsWith('/get_public_online_order_by_code') ? (channel === 'campaign' ? order : null)
        : path.endsWith('/get_public_preorder_by_code') ? [order] : [] });
    });
    await page.goto('/test-shop/order/TESTORDER');
    await expect(page.getByTestId('payment-method-card')).toHaveCount(3);
    const combined = page.getByTestId('payment-method-card').first();
    for (const text of ['TEST-PROMPTPAY', 'Test Bank A', 'TEST-ACCOUNT-A', 'Test Merchant A']) await expect(combined).toContainText(text);
    await expect(combined.getByTestId('payment-bank-account')).toHaveCount(2);
    await expect(combined.getByText('Account number: TEST-ACCOUNT-A2', { exact: true })).toBeVisible();
    await expect(page.getByTestId('payment-method-card').nth(1).getByTestId('payment-bank-account')).toHaveCount(1);
    await expect(page.getByText('Account number: TEST-ACCOUNT-B', { exact: true })).toBeVisible();
    await expect(page.getByText('Account number: TEST-ACCOUNT-C', { exact: true })).toBeVisible();
    const qr = combined.getByRole('img', { name: 'All payment options QR' });
    await expect(qr).toHaveAttribute('src', /\/storage\/v1\/object\/public\/Menu\/testqr.png$/);
    await expect.poll(() => qr.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(qr).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
