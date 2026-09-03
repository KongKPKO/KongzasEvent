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
  });

  test('closed campaign stays readable and rejects cart actions', async ({ page }) => {
    await page.goto(`/${ARTIST_SLUG}/campaign/closed-campaign-e2e`);
    await expect(page.getByRole('heading', { name: 'Closed Campaign E2E' })).toBeVisible();
    await expect(page.getByText(/Sales are not open|ไม่ได้เปิดขาย/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Increase quantity|เพิ่มจำนวน/ })).toHaveCount(0);
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

  test('merchant sees campaign workspace and can add a generated-SKU product to it', async ({ page }) => {
    await login(page);
    await page.goto(`/manage-online-sales/${campaignId}`);
    await expect(page.getByRole('heading', { name: 'Cheki Online E2E' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Orders|คำสั่งซื้อ/ })).toBeVisible();

    await page.goto('/manage-products');
    await page.getByRole('button', { name: /^Add Product$|^เพิ่มสินค้า$/ }).first().click();
    const productName = `Quick Cheki ${randomUUID().slice(0, 6)}`;
    await page.getByLabel(/Product name|ชื่อสินค้า/i).fill(productName);
    await page.getByLabel(/Price & currency|ราคาและสกุลเงิน/i).fill('120');
    await page.getByRole('button', { name: /^Add product$|^เพิ่มสินค้า$/i }).last().click();
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
      await productCard.getByRole('button', { name: /Add to sale|เพิ่มไปยังช่องทางขาย/ }).click();

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
      const campaignCard = page.locator('article').filter({ has: page.getByRole('heading', { name: productName }) });
      await expect(campaignCard).toBeVisible();
      await expect(campaignCard.getByText(/Included|อยู่ในแคมเปญ/)).toBeVisible();
    } finally {
      await fixture.service.from('online_campaign_products').delete().eq('campaign_id', campaignId).eq('product_id', legacyProductId);
      await fixture.service.from('event_products').delete().eq('event_id', activeEventId);
      await fixture.service.from('events').delete().eq('id', activeEventId);
      await fixture.service.from('products').delete().eq('id', legacyProductId);
    }
  });
});
