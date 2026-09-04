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
    const orderCode = decodeURIComponent(new URL(page.url()).pathname.split('/').pop() || '');
    await expect.poll(async () => {
      const order = await fixture.service.from('orders').select('id').eq('pickup_code', orderCode).single();
      if (!order.data) return null;
      const delivery = await fixture.service.from('preorder_notification_deliveries')
        .select('status').eq('order_id', order.data.id).eq('delivery_key', 'campaign:created').maybeSingle();
      return delivery.data?.status || null;
    }, { timeout: 15_000 }).toBe('delivered');
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
      /(?:storage\/v1\/object\/public\/Menu|ik\.imagekit\.io\/kongzas\/Menu)\/public\/e2e-cheki\.webp/,
    );
  });

  test('broken campaign product image falls back cleanly', async ({ page }) => {
    await page.route(/e2e-cheki\.webp/, (route) => route.abort());
    await page.goto(`/${ARTIST_SLUG}/campaign/${CAMPAIGN_SLUG}`);
    await expect(page.getByTestId('campaign-product-image-fallback').first()).toBeVisible();
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

  test('merchant previews payment evidence without leaving the workspace', async ({ page }) => {
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
    const slipPath = `campaign/${campaignId}/${order.order_id}/evidence.png`;
    const upload = await fixture.service.storage.from('PaymentEvidence').upload(
      slipPath,
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
      { contentType: 'image/png', upsert: true },
    );
    if (upload.error) throw upload.error;
    const payment = await fixture.service.from('order_payments').update({
      payment_status: 'payment_submitted',
      slip_url: slipPath,
      submitted_at: new Date().toISOString(),
    }).eq('order_id', order.order_id);
    if (payment.error) throw payment.error;

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
      await preview.getByRole('button', { name: /Close payment evidence|ปิดหลักฐานการชำระเงิน/ }).click();
      await expect(preview).toHaveCount(0);
    } finally {
      await fixture.service.storage.from('PaymentEvidence').remove([slipPath]);
    }
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
    const copyButton = page.getByRole('button', { name: /Copy tracking number|คัดลอกหมายเลขติดตาม/ });
    await copyButton.click();
    await expect(copyButton).toContainText(/Copied|คัดลอกแล้ว/);
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('TH1234567890');
  });

  test('merchant sees campaign workspace and can add a generated-SKU product to it', async ({ page }) => {
    await login(page);
    await page.goto(`/manage-online-sales/${campaignId}`);
    await expect(page.getByRole('heading', { name: 'Cheki Online E2E' })).toBeVisible();
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
