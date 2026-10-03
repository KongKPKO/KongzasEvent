import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ensureOwnerArtistFixture } from '../helpers/adminFixture';

const EMAIL = 'online-campaign-e2e@nireq.local';
const PASSWORD = 'LocalOnlyOnlineCampaign123!';
const ARTIST_SLUG = 'online-campaign-e2e';
const CAMPAIGN_SLUG = 'cheki-online-e2e';

let fixture: Awaited<ReturnType<typeof ensureOwnerArtistFixture>>;
let campaignId = '';
let productId = '';

async function login(page: Page) {
  await page.goto('/manage-login');
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: /Login to Dashboard|Sign in|Login/i }).click();
  await expect(page).not.toHaveURL(/manage-login/, { timeout: 20_000 });
}

async function cleanup() {
  if (!fixture) return;
  const service = fixture.service;
  const campaigns = await service.from('online_campaigns').select('id').eq('artist_id', fixture.userId);
  const campaignIds = (campaigns.data || []).map((row) => row.id);
  if (campaignIds.length > 0) {
    const orders = await service.from('orders').select('id').in('campaign_id', campaignIds);
    const orderIds = (orders.data || []).map((row) => row.id);
    if (orderIds.length > 0) {
      await service.from('payment_review_events').delete().in('order_id', orderIds);
      await service.from('order_payments').delete().in('order_id', orderIds);
      await service.from('order_items').delete().in('order_id', orderIds);
      await service.from('orders').delete().in('id', orderIds);
    }
    await service.from('campaign_payment_methods').delete().in('campaign_id', campaignIds);
    await service.from('campaign_pickup_points').delete().in('campaign_id', campaignIds);
    await service.from('online_campaign_products').delete().in('campaign_id', campaignIds);
    await service.from('online_campaigns').delete().in('id', campaignIds);
  }
  await service.from('products').delete().eq('artist_id', fixture.userId);
}

test.describe('online campaign', () => {
  test.beforeAll(async () => {
    fixture = await ensureOwnerArtistFixture({
      email: EMAIL,
      password: PASSWORD,
      slug: ARTIST_SLUG,
      displayName: 'Online Campaign E2E',
    });
    await cleanup();

    const now = Date.now();
    const product = await fixture.service.from('products').insert({
      artist_id: fixture.userId,
      name: 'E2E Cheki',
      category: 'Cheki',
      image_url: 'public/e2e-cheki.webp',
      price: 100,
      currency: 'THB',
      status: 'enable',
      stock_total: 20,
      stock_reserved: 0,
      stock_sold: 0,
      is_unlimited: false,
    }).select('id').single();
    if (product.error) throw product.error;
    productId = product.data.id;

    const campaign = await fixture.service.from('online_campaigns').insert({
      artist_id: fixture.userId,
      name: 'Cheki Online E2E',
      slug: CAMPAIGN_SLUG,
      description: 'Public online campaign test',
      opens_at: new Date(now - 60_000).toISOString(),
      closes_at: new Date(now + 86_400_000).toISOString(),
      currency: 'THB',
      shipping_enabled: true,
      flat_shipping_fee: 40,
      pickup_enabled: true,
      publication_status: 'published',
    }).select('id').single();
    if (campaign.error) throw campaign.error;
    campaignId = campaign.data.id;

    const setup = await Promise.all([
      fixture.service.from('online_campaign_products').insert({
        campaign_id: campaignId,
        product_id: product.data.id,
        artist_id: fixture.userId,
        stock_total: 10,
        is_unlimited: false,
        is_enabled: true,
      }),
      fixture.service.from('campaign_pickup_points').insert({
        campaign_id: campaignId,
        artist_id: fixture.userId,
        name: 'Siam pickup',
        address: 'Siam Square',
        starts_at: new Date(now + 86_400_000).toISOString(),
        ends_at: new Date(now + 90_000_000).toISOString(),
      }),
      fixture.service.from('campaign_payment_methods').insert({
        campaign_id: campaignId,
        artist_id: fixture.userId,
        method_type: 'promptpay',
        display_name: 'PromptPay',
        promptpay_id: '0812345678',
      }),
      fixture.service.from('online_campaigns').insert({
        artist_id: fixture.userId,
        name: 'Closed Campaign E2E',
        slug: 'closed-campaign-e2e',
        description: 'Closed but readable',
        opens_at: new Date(now - 172_800_000).toISOString(),
        closes_at: new Date(now - 86_400_000).toISOString(),
        currency: 'THB',
        shipping_enabled: true,
        flat_shipping_fee: 40,
        pickup_enabled: false,
        publication_status: 'published',
      }),
    ]);
    for (const result of setup) if (result.error) throw result.error;
  });

  test.afterAll(cleanup);

  test('customer checks out with flat shipping and gets a 15-minute hold', async ({ page }) => {
    await page.goto(`/${ARTIST_SLUG}/campaign/${CAMPAIGN_SLUG}`);
    await expect(page.getByRole('heading', { name: 'Cheki Online E2E' })).toBeVisible();
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByRole('button', { name: /Increase quantity|เพิ่มจำนวน/ }).click();
    await page.getByRole('button', { name: /Checkout|สั่งซื้อ/ }).click();
    await page.getByPlaceholder(/Customer name|ชื่อลูกค้า/).fill('Shipping Buyer');
    await page.getByPlaceholder(/Email|อีเมล/).fill('shipping@example.com');
    await page.getByPlaceholder(/Phone or contact|โทรศัพท์/).fill('0800000000');
    await page.getByPlaceholder(/Shipping address|ที่อยู่จัดส่ง/).fill('Bangkok');
    await expect(page.getByText(/140(?:\.00)?/)).toBeVisible();
    await page.getByRole('button', { name: /Confirm order and hold stock|ยืนยันออเดอร์/ }).click();
    await expect(page).toHaveURL(new RegExp(`/${ARTIST_SLUG}/order/`), { timeout: 15_000 });
    await expect(page.getByText(/Awaiting payment|รอชำระเงิน/)).toBeVisible();
    await expect(page.getByText(/^1[34]:\d{2}$/)).toBeVisible();
    await expect(page.locator('.order-amount')).toContainText('140');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.route('**/rest/v1/rpc/get_public_online_order_by_code', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Unavailable"}' }));
    await page.reload();
    await expect(page.getByRole('alert')).toContainText(/Could not load your order|โหลดออเดอร์ไม่สำเร็จ/);
    await page.unroute('**/rest/v1/rpc/get_public_online_order_by_code');
    await page.getByRole('button', { name: /Try again|ลองอีกครั้ง/ }).click();
    await expect(page.getByText(/Awaiting payment|รอชำระเงิน/)).toBeVisible();
    const orderCode = decodeURIComponent(new URL(page.url()).pathname.split('/').pop() || '');
    await expect.poll(async () => {
      const order = await fixture.service.from('orders').select('id').eq('pickup_code', orderCode).single();
      if (!order.data) return null;
      const delivery = await fixture.service.from('preorder_notification_deliveries')
        .select('status').eq('order_id', order.data.id).eq('delivery_key', 'campaign:created').maybeSingle();
      return delivery.data?.status || null;
    }, { timeout: 15_000 }).toBe('delivered');
  });

  test('storefront search preserves quantity and filters can be cleared', async ({ page }) => {
    await page.goto(`/${ARTIST_SLUG}/campaign/${CAMPAIGN_SLUG}`);
    const product = page.getByRole('article', { name: 'E2E Cheki' });
    await product.getByRole('button', { name: /Increase quantity|เพิ่มจำนวน/ }).click();
    await page.getByRole('searchbox').fill('No matching product');
    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Checkout|สั่งซื้อ/ })).toBeVisible();
    await page.getByRole('button', { name: /Clear filters|ล้างตัวกรอง/ }).click();
    await expect(product.getByRole('button', { name: /Decrease quantity|ลดจำนวน/ })).toBeEnabled();
    await expect(product.locator('.shop-quantity')).toContainText('1');
  });

  test('closed campaign stays readable and rejects cart actions', async ({ page }) => {
    await page.goto(`/${ARTIST_SLUG}/campaign/closed-campaign-e2e`);
    await expect(page.getByRole('heading', { name: 'Closed Campaign E2E' })).toBeVisible();
    await expect(page.getByText(/Sales are not open|ไม่ได้เปิดขาย/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Increase quantity|เพิ่มจำนวน/ })).toHaveCount(0);
  });

  test('legacy campaign product image resolves through the public Menu URL', async ({ page }) => {
    await page.route(/e2e-cheki\.webp/, (route) => route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    }));
    await page.goto(`/${ARTIST_SLUG}/campaign/${CAMPAIGN_SLUG}`);
    await expect(page.getByRole('img', { name: 'E2E Cheki' })).toHaveAttribute(
      'src',
      /storage\/v1\/object\/public\/Menu\/public\/e2e-cheki\.webp/,
    );
  });

  test('broken campaign product image falls back cleanly', async ({ page }) => {
    await page.route(/e2e-cheki\.webp/, (route) => route.abort());
    await page.goto(`/${ARTIST_SLUG}/campaign/${CAMPAIGN_SLUG}`);
    await expect(page.getByRole('img', { name: /E2E Cheki: (Image unavailable|ไม่มีภาพสินค้า)/ })).toBeVisible();
  });

  test('merchant limits a campaign product quantity per order', async ({ page }) => {
    try {
      await login(page);
      await page.goto(`/manage-online-sales/${campaignId}`);
      await page.getByRole('button', { name: /Products|สินค้า/ }).click();
      await page.getByPlaceholder(/Search product name or SKU|ค้นหาชื่อสินค้า หรือ SKU/).fill('E2E Cheki');
      const campaignRow = page.getByRole('row').filter({ hasText: 'E2E Cheki' });
      const limitInput = campaignRow.getByLabel(/Maximum per order|จำกัดสูงสุด\/ออเดอร์/);
      await limitInput.fill('2');
      await limitInput.blur();

      await expect.poll(async () => {
        const row = await fixture.service.from('online_campaign_products')
          .select('max_quantity_per_order')
          .eq('campaign_id', campaignId)
          .eq('product_id', productId)
          .single();
        return row.data?.max_quantity_per_order;
      }).toBe(2);

      await page.goto(`/${ARTIST_SLUG}/campaign/${CAMPAIGN_SLUG}`);
      await expect(page.getByText(/Maximum 2 per order|สูงสุด 2 ชิ้นต่อออเดอร์/)).toBeVisible();
      const increase = page.getByRole('button', { name: /Increase quantity|เพิ่มจำนวน/ });
      await increase.click();
      await increase.click();
      await expect(increase).toBeDisabled();
    } finally {
      await fixture.service.from('online_campaign_products')
        .update({ max_quantity_per_order: null })
        .eq('campaign_id', campaignId)
        .eq('product_id', productId);
    }
  });

  test('checkout can retry a failed price check without losing customer details', async ({ page }) => {
    await page.goto(`/${ARTIST_SLUG}/campaign/${CAMPAIGN_SLUG}`);
    await page.route('**/rest/v1/rpc/quote_sale_promotions', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Unavailable"}' }));
    await page.getByRole('button', { name: /Increase quantity|เพิ่มจำนวน/ }).click();
    await page.getByRole('button', { name: /Checkout|สั่งซื้อ/ }).click();
    const dialog = page.getByRole('dialog');
    await page.getByPlaceholder(/Customer name|ชื่อลูกค้า/).fill('Retry Buyer');
    await expect(dialog.getByRole('alert')).toContainText(/Could not check prices|ตรวจราคาไม่สำเร็จ/);
    const confirm = dialog.getByRole('button', { name: /Confirm order and hold stock|ยืนยันออเดอร์/ });
    await expect(confirm).toBeDisabled();
    await page.unroute('**/rest/v1/rpc/quote_sale_promotions');
    await dialog.getByRole('button', { name: /Retry price check|ตรวจราคาอีกครั้ง/ }).click();
    await expect(confirm).toBeEnabled();
    await expect(page.getByPlaceholder(/Customer name|ชื่อลูกค้า/)).toHaveValue('Retry Buyer');
  });

  test('checkout keeps details when editing items and switching fulfillment', async ({ page }, testInfo) => {
    await page.goto(`/${ARTIST_SLUG}/campaign/${CAMPAIGN_SLUG}`);
    await page.getByRole('button', { name: /Increase quantity|เพิ่มจำนวน/ }).click();
    const openCheckout = page.getByRole('button', { name: /Checkout|สั่งซื้อ/, exact: true });
    await openCheckout.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('region', { name: /Order items|รายการสินค้า/ })).toContainText('E2E Cheki');
    await page.getByPlaceholder(/Customer name|ชื่อลูกค้า/).fill('Checkout Review');
    await page.getByPlaceholder(/Email|อีเมล/).fill('review@example.com');
    await page.getByPlaceholder(/Shipping address|ที่อยู่จัดส่ง/).fill('Saved address');
    await dialog.getByRole('button', { name: /^Pickup$|^รับเอง$/ }).click();
    await expect(dialog.getByText('Siam Square')).toBeVisible();
    await dialog.getByRole('button', { name: /^Shipping$|^จัดส่ง$/ }).click();
    await expect(page.getByPlaceholder(/Shipping address|ที่อยู่จัดส่ง/)).toHaveValue('Saved address');
    await dialog.getByRole('button', { name: /Edit your items|กลับไปแก้รายการสินค้า/ }).click();
    await expect(dialog).not.toBeVisible();
    await openCheckout.press('Enter');
    await expect(page.getByPlaceholder(/Customer name|ชื่อลูกค้า/)).toHaveValue('Checkout Review');
    await expect(page.getByPlaceholder(/Email|อีเมล/)).toHaveValue('review@example.com');
    await expect(dialog.getByRole('button', { name: /Confirm order and hold stock|ยืนยันออเดอร์/ })).toBeEnabled();
    await dialog.getByRole('button', { name: /Confirm order and hold stock|ยืนยันออเดอร์/ }).click();
    await expect(dialog).toBeVisible(); // Native required phone validation prevents submission.
    await expect(dialog.locator('input[name="customer_phone"]')).toBeFocused();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('checkout.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(openCheckout).toBeFocused();
  });

  test('pickup checkout has no shipping fee', async ({ page }) => {
    await page.goto(`/${ARTIST_SLUG}/campaign/${CAMPAIGN_SLUG}`);
    await page.getByRole('button', { name: /Increase quantity|เพิ่มจำนวน/ }).click();
    await page.getByRole('button', { name: /Checkout|สั่งซื้อ/ }).click();
    await page.getByRole('button', { name: /^Pickup$|^รับเอง$/ }).click();
    await page.getByPlaceholder(/Customer name|ชื่อลูกค้า/).fill('Pickup Buyer');
    await page.getByPlaceholder(/Email|อีเมล/).fill('pickup@example.com');
    await page.getByPlaceholder(/Phone or contact|โทรศัพท์/).fill('0800000001');
    const fee = page.getByText(/Shipping fee per order|ค่าส่งต่อออเดอร์/).locator('..');
    await expect(fee).toContainText(/0/);
    await page.getByRole('button', { name: /Confirm order and hold stock|ยืนยันออเดอร์/ }).click();
    await expect(page).toHaveURL(new RegExp(`/${ARTIST_SLUG}/order/`), { timeout: 15_000 });
  });

  test('expired order hides payment instructions and offers late-payment recovery', async ({ page }) => {
    const created = await fixture.service.rpc('create_online_campaign_order', {
      p_campaign_id: campaignId,
      p_items: [{ product_id: productId, quantity: 1 }],
      p_fulfillment_method: 'shipping',
      p_pickup_point_id: null,
      p_customer_name: 'Late Buyer',
      p_customer_email: 'late@example.com',
      p_customer_phone: '0800000002',
      p_shipping_address: 'Bangkok',
      p_customer_note: '',
      p_client_request_id: randomUUID(),
    });
    if (created.error) throw created.error;
    const order = created.data[0];
    const payment = await fixture.service.from('order_payments').update({
      payment_status: 'payment_expired',
      expired_at: new Date().toISOString(),
    }).eq('order_id', order.order_id);
    if (payment.error) throw payment.error;
    const cancelled = await fixture.service.from('orders').update({ status: 'cancelled', pickup_status: 'expired' }).eq('id', order.order_id);
    if (cancelled.error) throw cancelled.error;
    const allocation = await fixture.service.from('online_campaign_products').select('stock_reserved').eq('campaign_id', campaignId).eq('product_id', productId).single();
    if (allocation.error) throw allocation.error;
    const released = await fixture.service.from('online_campaign_products').update({ stock_reserved: Math.max(0, Number(allocation.data.stock_reserved) - 1) }).eq('campaign_id', campaignId).eq('product_id', productId);
    if (released.error) throw released.error;

    await page.goto(`/${ARTIST_SLUG}/order/${order.order_code}`);
    await expect(page.getByText(/Order expired and stock was released|ออเดอร์หมดเวลา/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Transferred already|โอนเงินไปแล้ว/ })).toBeVisible();
    await expect(page.getByText('0812345678')).toHaveCount(0);
  });

  test('merchant previews payment evidence without leaving the workspace', async ({ page }, testInfo) => {
    const created = await fixture.service.rpc('create_online_campaign_order', {
      p_campaign_id: campaignId,
      p_items: [{ product_id: productId, quantity: 1 }],
      p_fulfillment_method: 'shipping',
      p_pickup_point_id: null,
      p_customer_name: 'Evidence Buyer',
      p_customer_email: 'evidence@example.com',
      p_customer_phone: '0800000003',
      p_shipping_address: 'Bangkok',
      p_customer_note: '',
      p_client_request_id: randomUUID(),
    });
    if (created.error) throw created.error;
    const order = created.data[0];
    await page.goto(`/${ARTIST_SLUG}/order/${order.order_code}`);
    await page.locator('input[type=file]').first().setInputFiles({
      name: 'evidence.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    });
    await page.getByRole('button', { name: /Submit payment evidence|ส่งหลักฐาน/ }).click();
    await expect.poll(async () => (await fixture.service.from('order_payments').select('payment_status').eq('order_id', order.order_id).single()).data?.payment_status).toBe('payment_submitted');
    const { data: payment } = await fixture.service.from('order_payments').select('slip_url').eq('order_id', order.order_id).single();
    const slipPath = payment?.slip_url || '';
    expect(slipPath).toMatch(/\.webp$/);

    try {
      await login(page);
      await page.goto(`/manage-online-sales/${campaignId}`);
      await page.getByRole('button', { name: /Orders|คำสั่งซื้อ/ }).click();
      const orderCard = page.locator('article').filter({ hasText: order.order_code });
      await orderCard.getByRole('button', { name: /View payment evidence|ดูหลักฐานการชำระเงิน/ }).click();
      const preview = page.getByRole('dialog', { name: /Payment evidence|หลักฐานการชำระเงิน/ });
      await expect(preview).toBeVisible();
      await expect(preview).toContainText(order.order_code);
      await expect(preview.locator('img')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('evidence-review.png') });
      await preview.getByRole('button', { name: /Zoom evidence|ขยายสลิป/ }).click();
      await expect(preview.locator('img')).toHaveClass(/is-zoomed/);
      await preview.getByRole('button', { name: /Fit image|ย่อรูป/ }).click();
      await expect(preview.getByRole('button', { name: /Confirm payment|ยืนยันการชำระเงิน/ })).toBeVisible();
      const downloadPromise = page.waitForEvent('download');
      await preview.getByRole('button', { name: /Download payment evidence|ดาวน์โหลดสลิป/ }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(`payment-${order.order_code}.webp`);
      expect(await download.failure()).toBeNull();
      await preview.getByRole('button', { name: /Close payment evidence|ปิดหลักฐานการชำระเงิน/ }).click();
      await expect(preview).toHaveCount(0);
      await page.locator('article').filter({ hasText: order.order_code }).getByRole('button', { name: /Confirm payment|ยืนยันการชำระเงิน/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: /Confirm payment|ยืนยันการชำระเงิน/ }).click();
      await expect.poll(async () => (await fixture.service.from('order_payments').select('payment_status').eq('order_id', order.order_id).single()).data?.payment_status).toBe('payment_confirmed');
      const row = page.locator('article').filter({ hasText: order.order_code });
      await row.getByRole('button', { name: /Add tracking & ship|ใส่เลขพัสดุและจัดส่ง/ }).click();
      const shippingDialog = page.getByRole('dialog');
      await expect(shippingDialog).toContainText(order.order_code);
      await expect(shippingDialog.getByRole('button', { name: /Confirm this order|ยืนยันรายการนี้/ })).toBeDisabled();
      await shippingDialog.getByLabel(/Carrier|ขนส่ง/).fill('Thailand Post');
      await shippingDialog.getByLabel(/Tracking number|เลขพัสดุ/).fill('LOCAL-TRACK-001');
      let shippingCalls = 0;
      await page.route('**/rest/v1/rpc/mark_online_order_shipped', async route => {
        shippingCalls++;
        if (shippingCalls === 1) await route.abort(); else await route.continue();
      });
      await shippingDialog.getByRole('button', { name: /Confirm this order|ยืนยันรายการนี้/ }).click();
      await expect(shippingDialog.getByRole('alert')).toBeVisible();
      await expect(shippingDialog.getByLabel(/Tracking number|เลขพัสดุ/)).toHaveValue('LOCAL-TRACK-001');
      await shippingDialog.getByRole('button', { name: /Confirm this order|ยืนยันรายการนี้/ }).click();
      await expect(shippingDialog).toHaveCount(0);
      await expect.poll(async () => (await fixture.service.from('orders').select('pickup_status').eq('id', order.order_id).single()).data?.pickup_status).toBe('shipped');
      expect(shippingCalls).toBe(2);

    } finally {
      await fixture.service.storage.from('PaymentEvidence').remove([slipPath]);
    }
  });

  test('customer problem survives a lost response and remains private to management', async ({ page }) => {
    const created = await fixture.service.rpc('create_online_campaign_order', {
      p_campaign_id: campaignId, p_items: [{ product_id: productId, quantity: 1 }],
      p_fulfillment_method: 'shipping', p_pickup_point_id: null,
      p_customer_name: 'Problem Buyer', p_customer_email: 'problem@example.com',
      p_customer_phone: '0800000003', p_shipping_address: 'Bangkok', p_customer_note: '',
      p_client_request_id: randomUUID(),
    });
    if (created.error) throw created.error;
    const order = created.data[0];
    await page.goto(`/${ARTIST_SLUG}/order/${order.order_code}`);
    const form = page.locator('details').filter({ hasText: /Report an order problem|แจ้งปัญหาออเดอร์/ });
    await form.locator('summary').click();
    await form.getByLabel('Description', { exact: true }).fill('Package is missing a sticker');
    await form.getByLabel(/Contact details/).fill('problem@example.com');
    await form.getByRole('checkbox').check();
    let lost = false;
    await page.route('**/rest/v1/rpc/submit_order_problem', async route => {
      if (!lost) { lost = true; await route.fetch(); await route.abort(); } else await route.continue();
    });
    await form.getByRole('button', { name: 'Send report to shop' }).click();
    await expect(form.getByRole('button', { name: 'Retry submission' })).toBeEnabled();
    await form.getByRole('button', { name: 'Retry submission' }).click();
    await expect(form.getByRole('status').first()).toContainText('Report saved');
    await expect.poll(async () => (await fixture.service.from('order_problem_reports').select('notification_status').eq('order_id', order.order_id).single()).data?.notification_status).toBe('sent');
    const reports = await fixture.service.from('order_problem_reports').select('id').eq('order_id', order.order_id);
    expect(reports.data).toHaveLength(1);
    const anonymous = await page.evaluate(async () => {
      const path = '/src/supabaseClient.ts'; const { supabase } = await import(path);
      const result = await supabase.from('order_problem_reports').select('contact');
      return { error: Boolean(result.error), count: result.data?.length || 0 };
    });
    expect(anonymous.error || anonymous.count === 0).toBe(true);
    await login(page);
    await page.goto('/manage-order-problems');
    const report = page.locator('article').filter({ hasText: 'Package is missing a sticker' });
    await expect(report).toContainText('problem@example.com');
    await report.getByLabel('Agreed resolution').fill('Replacement arranged with buyer');
    await report.getByRole('button', { name: 'Mark resolved' }).click();
    await expect(report).toHaveCount(0);
    await page.getByLabel('Report status').selectOption('resolved');
    await expect(page.getByText('Replacement arranged with buyer')).toBeVisible();
  });

  test('customer order status labels carrier and tracking number', async ({ page }) => {
    const created = await fixture.service.rpc('create_online_campaign_order', {
      p_campaign_id: campaignId,
      p_items: [{ product_id: productId, quantity: 1 }],
      p_fulfillment_method: 'shipping',
      p_pickup_point_id: null,
      p_customer_name: 'Tracking Buyer',
      p_customer_email: 'tracking@example.com',
      p_customer_phone: '0800000004',
      p_shipping_address: 'Bangkok',
      p_customer_note: '',
      p_client_request_id: randomUUID(),
    });
    if (created.error) throw created.error;
    const order = created.data[0];
    const payment = await fixture.service.from('order_payments').update({
      payment_status: 'payment_confirmed',
      confirmed_at: new Date().toISOString(),
    }).eq('order_id', order.order_id);
    if (payment.error) throw payment.error;
    const shipped = await fixture.service.from('orders').update({
      status: 'completed',
      pickup_status: 'shipped',
      shipping_carrier: 'Thailand Post',
      tracking_number: 'TH1234567890',
      shipped_at: new Date().toISOString(),
    }).eq('id', order.order_id);
    if (shipped.error) throw shipped.error;

    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (value: string) => localStorage.setItem('copied-tracking', value),
          readText: async () => localStorage.getItem('copied-tracking') || '',
        },
      });
    });
    await page.goto(`/${ARTIST_SLUG}/order/${order.order_code}`);
    await expect(page.getByText(/Carrier|บริษัทขนส่ง/)).toBeVisible();
    await expect(page.getByText('Thailand Post')).toBeVisible();
    await expect(page.getByText(/Tracking number|หมายเลขติดตามพัสดุ/)).toBeVisible();
    await expect(page.getByText('TH1234567890')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Order shipped|จัดส่งแล้ว|Shipped/i })).toBeVisible();
    const copyButton = page.getByRole('button', { name: /Copy tracking number|คัดลอกหมายเลขติดตาม/ });
    await copyButton.click();
    await expect(copyButton).toContainText(/Copied|คัดลอกแล้ว/);
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('TH1234567890');
  });

  test('merchant sees campaign workspace and can add a generated-SKU product to it', async ({ page }) => {
    await login(page);
    await page.goto(`/manage-online-sales/${campaignId}`);
    await expect(page.getByRole('heading', { name: 'Cheki Online E2E' })).toBeVisible();
    const readiness = page.getByRole('region', { name: /Before sales open|ตรวจความพร้อมก่อนเปิดขาย/ });
    await expect(readiness).toContainText('6/6');
    await expect(page.getByRole('button', { name: /Orders|คำสั่งซื้อ/ })).toBeVisible();
    await page.getByRole('button', { name: /Products|สินค้า/ }).click();
    await expect(page.getByLabel(/Product category|หมวดหมู่สินค้า/)).toContainText('Cheki');
    await page.getByPlaceholder(/Search product name or SKU|ค้นหาชื่อสินค้า หรือ SKU/).fill('E2E Cheki');
    await expect(page.getByRole('row').filter({ hasText: 'E2E Cheki' })).toContainText('Cheki');
    const campaignTable = page.getByRole('table');
    const tableViewportWidth = await campaignTable.evaluate((table) => table.parentElement?.clientWidth || 0);
    if (tableViewportWidth >= 1080) {
      await expect.poll(() => campaignTable.evaluate((table) => {
        const scroller = table.parentElement;
        return Boolean(scroller && scroller.scrollWidth <= scroller.clientWidth + 1);
      })).toBe(true);
    }
    const campaignRow = page.getByRole('row').filter({ hasText: 'E2E Cheki' });
    const productCellWidth = await campaignRow.locator('td').first().evaluate((cell) => cell.getBoundingClientRect().width);
    expect(productCellWidth).toBeGreaterThanOrEqual(250);

    await page.goto('/manage-products');
    await page.getByRole('button', { name: /^Add product$|^เพิ่มสินค้า$/i }).first().click();
    const productName = `Quick Cheki ${randomUUID().slice(0, 6)}`;
    await page.getByLabel(/Product name|ชื่อสินค้า/i).fill(productName);
    await page.getByRole('dialog').getByLabel('Base price *', { exact: true }).fill('120');
    await page.getByRole('dialog').getByRole('button', { name: 'Create product', exact: true }).click();
    const handoff = page.locator('form').filter({ has: page.getByRole('heading', { name: /Add to sale|เพิ่มไปยังช่องทางขาย/ }) });
    await expect(handoff).toBeVisible({ timeout: 15_000 });
    await handoff.getByLabel(/Choose where to sell|เลือกช่องทางขาย/).selectOption(campaignId);
    await handoff.getByRole('button', { name: /^Add to sale$|^เพิ่มไปยังช่องทางขาย$/ }).click();

    await expect.poll(async () => {
      const row = await fixture.service.from('products').select('id, sku').eq('artist_id', fixture.userId).eq('name', productName).single();
      if (!row.data?.sku) return false;
      const allocation = await fixture.service.from('online_campaign_products').select('id').eq('campaign_id', campaignId).eq('product_id', row.data.id).maybeSingle();
      return Boolean(allocation.data?.id);
    }).toBe(true);
  });

  test('fully event-allocated catalog product can join a campaign with zero stock', async ({ page }) => {
    const legacyProductId = randomUUID();
    const activeEventId = randomUUID();
    const productName = `Allocated Cheki ${legacyProductId.slice(0, 6)}`;

    try {
      const product = await fixture.service.from('products').insert({
        id: legacyProductId,
        artist_id: fixture.userId,
        name: productName,
        price: 350,
        currency: 'THB',
        status: 'enable',
        stock_total: 8,
        stock_reserved: 0,
        stock_sold: 0,
        is_unlimited: false,
      });
      if (product.error) throw product.error;

      const activeEvent = await fixture.service.from('events').insert({
        id: activeEventId,
        artist_id: fixture.userId,
        event_name: 'Active allocated event',
        start_date: new Date(Date.now() - 60_000).toISOString(),
        end_date: new Date(Date.now() + 3_600_000).toISOString(),
        status: 'Confirmed',
      });
      if (activeEvent.error) throw activeEvent.error;

      const allocation = await fixture.service.from('event_products').insert({
        event_id: activeEventId,
        product_id: legacyProductId,
        artist_id: fixture.userId,
        stock_total: 8,
        stock_reserved: 0,
        stock_sold: 0,
        is_unlimited: false,
        is_enabled: true,
      });
      if (allocation.error) throw allocation.error;

      await login(page);
      await page.goto('/manage-products');
      const productCard = page.locator('article').filter({ has: page.getByRole('heading', { name: productName }) });
      await productCard.getByRole('button', { name: /Choose sales channel|เลือกช่องทางขาย/ }).click();

      const handoff = page.locator('form').filter({ has: page.getByRole('heading', { name: /Add to sale|เพิ่มไปยังช่องทางขาย/ }) });
      await handoff.getByLabel(/Choose where to sell|เลือกช่องทางขาย/).selectOption(campaignId);
      await expect(handoff.getByLabel(/Allocated stock|สต็อกที่จัดสรร/)).toHaveValue('0');
      await expect(handoff.getByText(/All stock is assigned|สต็อกทั้งหมดถูกจัด/)).toBeVisible();
      await handoff.getByRole('button', { name: /^Add to sale$|^เพิ่มไปยังช่องทางขาย$/ }).click();

      await expect.poll(async () => {
        const row = await fixture.service.from('online_campaign_products').select('stock_total,is_enabled').eq('campaign_id', campaignId).eq('product_id', legacyProductId).maybeSingle();
        return row.data?.is_enabled === true && row.data.stock_total === 0;
      }).toBe(true);

      await page.goto(`/manage-online-sales/${campaignId}`);
      await page.getByRole('button', { name: /Products|สินค้า/ }).click();
      await page.getByPlaceholder(/Search product name or SKU|ค้นหาชื่อสินค้า หรือ SKU/).fill(productName);
      const campaignRow = page.getByRole('row').filter({ hasText: productName });
      await expect(campaignRow).toBeVisible();
      await expect(campaignRow.getByText(/Included|อยู่ในแคมเปญ/)).toBeVisible();
      await expect(page.getByRole('columnheader', { name: /Total stock|สต็อกทั้งหมด/ })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: /Ready to allocate|พร้อมจัดสรร/ })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: /This campaign|แคมเปญนี้/ })).toBeVisible();
      await expect(campaignRow.getByText(/In other sales or reservations: 8|อีก 8 ชิ้นอยู่ในช่องทางขายอื่น/)).toBeVisible();
      await page.getByLabel(/Campaign membership|สถานะในแคมเปญ/).selectOption('not_added');
      await expect(campaignRow).toHaveCount(0);
    } finally {
      await fixture.service.from('online_campaign_products').delete().eq('campaign_id', campaignId).eq('product_id', legacyProductId);
      await fixture.service.from('event_products').delete().eq('event_id', activeEventId);
      await fixture.service.from('events').delete().eq('id', activeEventId);
      await fixture.service.from('products').delete().eq('id', legacyProductId);
    }
  });

  test('merchant manages pickup and payment settings with visible feedback', async ({ page }) => {
    await login(page);
    await page.goto(`/manage-online-sales/${campaignId}`);
    await page.getByRole('button', { name: /Settings|ตั้งค่า/ }).click();

    const campaignName = page.getByLabel(/Campaign name|ชื่อแคมเปญ/);
    await campaignName.fill('Cheki Online E2E edited');
    const beforeSave = await fixture.service.from('online_campaigns').select('name').eq('id', campaignId).single();
    expect(beforeSave.data?.name).toBe('Cheki Online E2E');
    await page.getByRole('button', { name: /Save changes|บันทึกการเปลี่ยนแปลง/ }).click();
    await expect.poll(async () => {
      const saved = await fixture.service.from('online_campaigns').select('name').eq('id', campaignId).single();
      return saved.data?.name;
    }).toBe('Cheki Online E2E edited');

    await expect(page.getByText('Siam pickup')).toBeVisible();
    await expect(page.getByText(/•••• 5678/)).toBeVisible();

    await page.getByRole('button', { name: /^Add pickup point$|^เพิ่มจุดรับสินค้า$/ }).click();
    let pickupForm = page.locator('form').filter({ has: page.getByPlaceholder(/Pickup point name|ชื่อจุดรับ/) });
    await pickupForm.getByPlaceholder(/Pickup point name|ชื่อจุดรับ/).fill('Asok pickup');
    await pickupForm.getByPlaceholder(/Address|ที่อยู่/).fill('BTS Asok exit 3');
    await pickupForm.locator('[name="starts_at"]').fill('2026-09-10T18:00');
    await pickupForm.locator('[name="ends_at"]').fill('2026-09-10T20:00');
    await pickupForm.getByRole('button', { name: /Save pickup point|บันทึกจุดรับ/ }).click();
    await expect(page.getByRole('status')).toContainText(/Pickup point added|เพิ่มจุดรับสินค้าแล้ว/);
    await expect(page.getByRole('heading', { name: 'Asok pickup' })).toBeVisible();

    await page.getByRole('button', { name: /^Add pickup point$|^เพิ่มจุดรับสินค้า$/ }).click();
    pickupForm = page.locator('form').filter({ has: page.getByPlaceholder(/Pickup point name|ชื่อจุดรับ/) });
    await pickupForm.getByPlaceholder(/Pickup point name|ชื่อจุดรับ/).fill(' asok pickup ');
    await pickupForm.getByPlaceholder(/Address|ที่อยู่/).fill(' BTS ASOK EXIT 3 ');
    await pickupForm.locator('[name="starts_at"]').fill('2026-09-10T18:00');
    await pickupForm.locator('[name="ends_at"]').fill('2026-09-10T20:00');
    await pickupForm.getByRole('button', { name: /Save pickup point|บันทึกจุดรับ/ }).click();
    await expect(page.getByRole('status')).toContainText(/already exists|มีรายการนี้แล้ว/);
    const pickupCount = await fixture.service.from('campaign_pickup_points').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).ilike('name', 'Asok pickup');
    expect(pickupCount.count).toBe(1);

    await page.getByRole('button', { name: /^(Cancel|ยกเลิก)$/ }).click();
    await page.getByRole('button', { name: /Remove pickup point Asok pickup|ลบจุดรับสินค้า Asok pickup/ }).click();
    await page.getByRole('button', { name: /^(Cancel|ยกเลิก)$/ }).click();
    await expect(page.getByRole('heading', { name: 'Asok pickup' })).toBeVisible();
    await page.getByRole('button', { name: /Remove pickup point Asok pickup|ลบจุดรับสินค้า Asok pickup/ }).click();
    await page.getByRole('button', { name: /Confirm remove|ยืนยันการลบ/ }).click();
    await expect(page.getByRole('heading', { name: 'Asok pickup' })).toHaveCount(0);

    await page.getByRole('button', { name: /^Add payment method$|^เพิ่มช่องทางชำระเงิน$/ }).click();
    let paymentForm = page.locator('form').filter({ has: page.getByPlaceholder(/PromptPay ID|หมายเลขพร้อมเพย์/) });
    await paymentForm.locator('[name="display_name"]').fill('Backup PromptPay');
    await paymentForm.getByPlaceholder(/PromptPay ID|หมายเลขพร้อมเพย์/).fill('0899994321');
    await paymentForm.getByRole('button', { name: /Save payment method|บันทึกช่องทางชำระเงิน/ }).click();
    await expect(page.getByRole('status')).toContainText(/Payment method added|เพิ่มช่องทางชำระเงินแล้ว/);
    await expect(page.getByText(/•••• 4321/)).toBeVisible();

    await page.getByRole('button', { name: /^Add payment method$|^เพิ่มช่องทางชำระเงิน$/ }).click();
    paymentForm = page.locator('form').filter({ has: page.getByPlaceholder(/PromptPay ID|หมายเลขพร้อมเพย์/) });
    await paymentForm.locator('[name="display_name"]').fill(' backup promptpay ');
    await paymentForm.getByPlaceholder(/PromptPay ID|หมายเลขพร้อมเพย์/).fill('0899994321');
    await paymentForm.getByRole('button', { name: /Save payment method|บันทึกช่องทางชำระเงิน/ }).click();
    await expect(page.getByRole('status')).toContainText(/already exists|มีรายการนี้แล้ว/);
    const paymentCount = await fixture.service.from('campaign_payment_methods').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('promptpay_id', '0899994321');
    expect(paymentCount.count).toBe(1);
  });
});
