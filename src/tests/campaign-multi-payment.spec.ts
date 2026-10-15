import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';

const run = randomUUID().slice(0, 8);
const email = `campaign-payment-${run}@example.test`;
const password = 'LocalOnlyCampaignPayment123!';
const artistSlug = `campaign-payment-${run}`;
const campaignSlug = `multiple-payment-${run}`;

let fixture: Awaited<ReturnType<typeof ensureOwnerArtistFixture>>;
let campaignId = '';
let productId = '';

async function login(page: Page) {
  await page.goto('/manage-login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /Login to Dashboard|Sign in|Login/i }).click();
  await expect(page).not.toHaveURL(/manage-login/, { timeout: 20_000 });
}

test.describe('campaign payment methods', () => {
  test.beforeAll(async () => {
    fixture = await ensureOwnerArtistFixture({
      email,
      password,
      slug: artistSlug,
      displayName: 'Campaign payment test',
    });
    const now = Date.now();
    const campaign = await fixture.service.from('online_campaigns').insert({
      artist_id: fixture.userId,
      name: 'Multiple payment campaign',
      slug: campaignSlug,
      description: 'Payment setup regression',
      opens_at: new Date(now - 60_000).toISOString(),
      closes_at: new Date(now + 86_400_000).toISOString(),
      currency: 'THB',
      shipping_enabled: true,
      flat_shipping_fee: 0,
      pickup_enabled: false,
      publication_status: 'published',
    }).select('id').single();
    if (campaign.error) throw campaign.error;
    campaignId = campaign.data.id;

    const product = await fixture.service.from('products').insert({
      artist_id: fixture.userId,
      name: 'Unlimited payment test item',
      category: 'Test',
      price: 100,
      status: 'enable',
      is_unlimited: true,
    }).select('id').single();
    if (product.error) throw product.error;
    productId = product.data.id;

    const allocation = await fixture.service.from('online_campaign_products').insert({
      campaign_id: campaignId,
      artist_id: fixture.userId,
      product_id: productId,
      is_enabled: true,
      is_unlimited: true,
    });
    if (allocation.error) throw allocation.error;
  });

  test.afterAll(async () => {
    if (!fixture || !campaignId) return;
    await fixture.service.from('campaign_payment_methods').delete().eq('campaign_id', campaignId);
    await fixture.service.from('online_campaign_products').delete().eq('campaign_id', campaignId);
    await fixture.service.from('online_campaigns').delete().eq('id', campaignId);
    if (productId) await fixture.service.from('products').delete().eq('id', productId);
  });

  test('saves combined details, allows multiple accounts, and blocks an exact duplicate', async ({ page }) => {
    await page.route('**/functions/v1/upload-image', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: `qr/${run}.webp` }) });
    });
    await login(page);
    await page.goto(`/manage-online-sales/${campaignId}`);
    await page.getByRole('button', { name: /Settings|ตั้งค่า/, exact: true }).click();
    await page.getByRole('button', { name: /^Add payment method$|^เพิ่มช่องทางชำระเงิน$/ }).click();

    let form = page.getByTestId('campaign-payment-form');
    await expect(form.locator('[name="method_type"]')).toHaveCount(0);
    await form.getByTestId('payment-promptpay-id').fill('0812345678');
    await form.getByTestId('payment-bank-name').fill('SCB');
    await form.getByTestId('payment-account-name').fill('Nireq Creator');
    await form.getByTestId('payment-account-number').fill('1112223333');
    await form.getByTestId('payment-instructions').fill('Use the exact order total.');
    await form.getByTestId('payment-qr-input').setInputFiles({
      name: 'payment-qr.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nHEAAAAASUVORK5CYII=', 'base64'),
    });
    await expect(page.getByRole('status')).toContainText(/QR image uploaded|อัปโหลดรูป QR แล้ว/);
    await form.getByRole('button', { name: /Save payment method|บันทึกช่องทางชำระเงิน/ }).click();
    await expect(page.getByRole('status')).toContainText(/Payment method added|เพิ่มช่องทางชำระเงินแล้ว/);

    await expect(page.getByRole('heading', { name: 'PromptPay + Bank transfer + Payment QR / พร้อมเพย์ + โอนผ่านธนาคาร + คิวอาร์ชำระเงิน' })).toBeVisible();
    await expect(page.getByText(/SCB · •••• 3333/)).toBeVisible();
    await expect(page.getByRole('img', { name: /Payment QR|คิวอาร์ชำระเงิน/ })).toBeVisible();

    await page.getByRole('button', { name: /^Add payment method$|^เพิ่มช่องทางชำระเงิน$/ }).click();
    form = page.getByTestId('campaign-payment-form');
    await form.getByTestId('payment-promptpay-id').fill('0812345678');
    await form.getByTestId('payment-bank-name').fill('SCB');
    await form.getByTestId('payment-account-name').fill('Second Account');
    await form.getByTestId('payment-account-number').fill('4444555566');
    await form.getByRole('button', { name: /Save payment method|บันทึกช่องทางชำระเงิน/ }).click();
    await expect.poll(async () => {
      const result = await fixture.service
        .from('campaign_payment_methods')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId);
      if (result.error) throw result.error;
      return result.count;
    }).toBe(2);

    const saved = await fixture.service
      .from('campaign_payment_methods')
      .select('method_type, display_name, promptpay_id, bank_name, account_name, account_number, qr_image_url, instructions')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true });
    if (saved.error) throw saved.error;
    expect(saved.data).toHaveLength(2);
    const primaryPayment = saved.data?.find((method) => method.account_number === '1112223333');
    const secondPayment = saved.data?.find((method) => method.account_number === '4444555566');
    expect(primaryPayment).toMatchObject({
      method_type: 'promptpay',
      display_name: 'PromptPay + Bank transfer + Payment QR / พร้อมเพย์ + โอนผ่านธนาคาร + คิวอาร์ชำระเงิน',
      promptpay_id: '0812345678',
      bank_name: 'SCB',
      account_name: 'Nireq Creator',
      account_number: '1112223333',
      instructions: 'Use the exact order total.',
    });
    expect(primaryPayment?.qr_image_url).toContain(`/storage/v1/object/public/Avatar/qr/${run}.webp`);
    expect(secondPayment).toMatchObject({ account_name: 'Second Account', account_number: '4444555566' });

    await page.getByRole('button', { name: /^Add payment method$|^เพิ่มช่องทางชำระเงิน$/ }).click();
    form = page.getByTestId('campaign-payment-form');
    await form.getByTestId('payment-promptpay-id').fill('081-234-5678');
    await form.getByTestId('payment-bank-name').fill(' scb ');
    await form.getByTestId('payment-account-name').fill(' second account ');
    await form.getByTestId('payment-account-number').fill('444-455-5566');
    await form.getByTestId('payment-instructions').fill('Different wording does not create another account.');
    await form.getByRole('button', { name: /Save payment method|บันทึกช่องทางชำระเงิน/ }).click();
    await expect(page.getByRole('status')).toContainText(/already exists|มีรายการนี้แล้ว/);

    const count = await fixture.service
      .from('campaign_payment_methods')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId);
    expect(count.count).toBe(2);

    const publicCampaign = await fixture.service.rpc('get_public_online_campaign', {
      p_artist_slug: artistSlug,
      p_campaign_slug: campaignSlug,
    });
    if (publicCampaign.error) throw publicCampaign.error;
    const publicPayment = publicCampaign.data?.payment_methods?.find(
      (method: { account_number?: string | null }) => method.account_number === '1112223333',
    );
    expect(publicPayment).toMatchObject({
      promptpay_id: '0812345678',
      bank_name: 'SCB',
      account_name: 'Nireq Creator',
      account_number: '1112223333',
      instructions: 'Use the exact order total.',
    });
    expect(publicPayment?.qr_image_url).toContain(`/storage/v1/object/public/Avatar/qr/${run}.webp`);
  });
});
