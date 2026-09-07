import { test, expect } from '@playwright/test';

// Exercise the real storefront with controlled RPC stock changes; SQL tests cover transactions.
test('mixed gifts require complete selection and fresh partial acceptance', async ({ page }) => {
  let available = 2;
  let choices: Array<{ product_ids: string[]; accepted_quantity?: number; accepted_earned_quantity?: number }> = [];
  await page.route('**/rest/v1/rpc/get_public_online_campaign', route => route.fulfill({ json: {
    id: 'campaign', name: 'Gift test', artist_name: 'Test shop', state: 'open', currency: 'THB',
    opens_at: '2026-01-01', closes_at: '2027-01-01', shipping_enabled: true,
    pickup_enabled: false, flat_shipping_fee: 0, pickup_points: [],
    products: [{ product_id: 'paid', name: 'Cheki', price: 100, available_quantity: 10 }],
  } }));
  await page.route('**/rest/v1/rpc/quote_sale_promotions', route => {
    choices = route.request().postDataJSON().p_reward_choices;
    const resolved = choices.length > 0;
    return route.fulfill({ json: {
      merchandise_total: 100, discount_total: 0, pricing_hash: 'quote',
      applied_promotions: [], reward_lines: [],
      required_choices: resolved ? [] : [{ kind: 'reward', promotion_id: 'promo',
        earned_quantity: 2, available_quantity: available, exhausted: available === 0,
        options: available === 0 ? [] : [
          { product_id: 'A', name: 'Gift A', available: 1 },
          ...(available === 2 ? [{ product_id: 'B', name: 'Gift B', available: 1 }] : []),
        ],
      }],
    } });
  });
  await page.route('**/rest/v1/rpc/create_online_campaign_order', route => {
    available = 1;
    return route.fulfill({ status: 400, json: { message: 'promotion_reward_unavailable' } });
  });
  await page.goto('/test/campaign/gifts');
  await page.locator('article').getByRole('button').last().click();
  await page.getByRole('button', { name: /Checkout|ชำระเงิน/ }).click();
  const confirm = page.getByRole('button', { name: /Confirm selected gifts|ยืนยันของแถมที่เลือก/ });
  await expect(confirm).toBeDisabled();
  await page.getByRole('button', { name: /Increase Gift A|เพิ่ม Gift A/ }).click();
  await expect(confirm).toBeDisabled();
  await expect(page.getByRole('button', { name: /Increase Gift A|เพิ่ม Gift A/ })).toBeDisabled();
  await page.getByRole('button', { name: /Increase Gift B|เพิ่ม Gift B/ }).click();
  await confirm.click();
  await expect.poll(() => choices[0]?.product_ids).toEqual(['A', 'B']);
  await page.locator('[name="customer_name"]').fill('Buyer');
  await page.locator('[name="customer_email"]').fill('buyer@example.com');
  await page.locator('[name="customer_phone"]').fill('0800000000');
  await page.locator('[name="shipping_address"]').fill('Bangkok');
  await page.locator('form button:not([type])').click();
  await expect(page.getByRole('alert')).toContainText(/entitled to 2, only 1|ได้สิทธิ์ 2 ชิ้น เหลือให้รับ 1/);
  const partial = page.getByRole('button', { name: /Accept 1 of 2|ยืนยันรับของแถม 1 จาก 2/ });
  await expect(partial).toBeDisabled();
  await page.getByRole('button', { name: /Increase Gift A|เพิ่ม Gift A/ }).click();
  await page.screenshot({ path: `/tmp/nireq-mixed-gifts-${test.info().project.name}.png` });
  await partial.click();
  await expect.poll(() => choices[0]?.accepted_quantity).toBe(1);
  expect(choices[0].accepted_earned_quantity).toBe(2);
  expect(choices[0].product_ids).toEqual(['A']);
  available = 0;
  await page.reload();
  await page.locator('article').getByRole('button').last().click();
  await page.getByRole('button', { name: /Checkout|ชำระเงิน/ }).click();
  await expect(page.locator('form')).toContainText(/All gifts for this promotion are out of stock|ของแถมสำหรับโปรนี้หมดทั้งหมดแล้ว/);
  await expect(page.locator('form button:not([type])')).toBeDisabled();
  await page.getByRole('checkbox').check();
  await expect(page.locator('form button:not([type])')).toBeEnabled();
});
