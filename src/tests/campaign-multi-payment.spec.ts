import { expect, test, type Locator, type Page } from '@playwright/test';
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

async function fillBankAccount(scope: Locator, index: number, account: { bank: string; name: string; number: string }) {
  const group = scope.getByRole('group', { name: new RegExp(`Bank account ${index}|บัญชีธนาคาร ${index}`) });
  await group.getByLabel(/Bank name|ธนาคาร/).fill(account.bank);
  await group.getByLabel(/Account name|ชื่อบัญชี/).fill(account.name);
  await group.getByLabel(/Account number|เลขบัญชี/).fill(account.number);
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

  test('keeps multiple bank accounts under one recipient and supports adding another later', async ({ page }) => {
    await page.route('**/functions/v1/upload-image', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: `qr/${run}.webp` }) });
    });
    await login(page);
    await page.goto(`/manage-online-sales/${campaignId}`);
    await page.getByRole('button', { name: /Settings|ตั้งค่า/, exact: true }).click();
    await page.getByRole('button', { name: /^Add payment method$|^เพิ่มช่องทางชำระเงิน$/ }).click();

    let form = page.getByTestId('campaign-payment-form');
    await expect(form.locator('[name="method_type"]')).toHaveCount(0);
    await expect(form.locator('[name="display_name"]')).toHaveCount(0);
    await form.getByTestId('payment-promptpay-id').fill('0812345678');
    await fillBankAccount(form, 1, { bank: 'SCB', name: 'Nireq Creator', number: '1112223333' });
    await form.getByRole('button', { name: /^Add bank account$|^เพิ่มบัญชีธนาคาร$/ }).click();
    await fillBankAccount(form, 2, { bank: 'KBank', name: 'Nireq Creator', number: '2222333344' });
    await form.getByTestId('payment-instructions').fill('Use the exact order total.');
    await form.getByTestId('payment-qr-input').setInputFiles({
      name: 'payment-qr.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nHEAAAAASUVORK5CYII=', 'base64'),
    });
    await expect(page.getByRole('status')).toContainText(/QR image uploaded|อัปโหลดรูป QR แล้ว/);
    await form.getByRole('button', { name: /Save payment method|บันทึกช่องทางชำระเงิน/ }).click();
    await expect(page.getByRole('status')).toContainText(/Payment method added|เพิ่มช่องทางชำระเงินแล้ว/);

    await expect(page.getByRole('heading', { name: /^Payment method 1$|^ช่องทางชำระเงิน 1$/ })).toBeVisible();
    await expect(page.getByText(/SCB · •••• 3333/)).toBeVisible();
    await expect(page.getByText(/KBank · •••• 3344/)).toBeVisible();
    await expect(page.getByRole('img', { name: /Payment method 1 QR|ช่องทางชำระเงิน 1 QR/ })).toBeVisible();

    let saved = await fixture.service
      .from('campaign_payment_methods')
      .select('id, method_type, display_name, promptpay_id, bank_accounts, bank_name, account_name, account_number, qr_image_url, instructions')
      .eq('campaign_id', campaignId);
    if (saved.error) throw saved.error;
    expect(saved.data).toHaveLength(1);
    const primaryId = saved.data?.[0].id as string;
    expect(saved.data?.[0]).toMatchObject({
      method_type: 'promptpay',
      display_name: null,
      promptpay_id: '0812345678',
      bank_name: 'SCB',
      account_name: 'Nireq Creator',
      account_number: '1112223333',
      bank_accounts: [
        { bank_name: 'SCB', account_name: 'Nireq Creator', account_number: '1112223333' },
        { bank_name: 'KBank', account_name: 'Nireq Creator', account_number: '2222333344' },
      ],
      instructions: 'Use the exact order total.',
    });
    expect(saved.data?.[0].qr_image_url).toContain(`/storage/v1/object/public/Avatar/qr/${run}.webp`);

    const firstMethod = page.getByTestId('campaign-payment-method').first();
    await firstMethod.getByRole('button', { name: /^Add bank account$|^เพิ่มบัญชีธนาคาร$/ }).click();
    await fillBankAccount(firstMethod, 3, { bank: 'BBL', name: 'Nireq Creator', number: '3333444455' });
    await firstMethod.getByRole('button', { name: /Save bank accounts|บันทึกบัญชีธนาคาร/ }).click();
    await expect.poll(async () => {
      const result = await fixture.service.from('campaign_payment_methods').select('bank_accounts').eq('id', primaryId).single();
      if (result.error) throw result.error;
      return result.data.bank_accounts?.length;
    }).toBe(3);
    await expect(firstMethod.getByText(/BBL · •••• 4455/)).toBeVisible();

    await page.getByRole('button', { name: /^Add payment method$|^เพิ่มช่องทางชำระเงิน$/ }).click();
    form = page.getByTestId('campaign-payment-form');
    await fillBankAccount(form, 1, { bank: 'Krungthai', name: 'Second Recipient', number: '4444555566' });
    await form.getByRole('button', { name: /Save payment method|บันทึกช่องทางชำระเงิน/ }).click();
    await expect.poll(async () => {
      const result = await fixture.service
        .from('campaign_payment_methods')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId);
      if (result.error) throw result.error;
      return result.count;
    }).toBe(2);
    await expect(page.getByTestId('campaign-payment-method')).toHaveCount(2);
    await expect(page.getByRole('heading', { name: /^Payment method 2$|^ช่องทางชำระเงิน 2$/ })).toBeVisible();

    saved = await fixture.service
      .from('campaign_payment_methods')
      .select('id, method_type, display_name, promptpay_id, bank_accounts, bank_name, account_name, account_number, qr_image_url, instructions')
      .eq('campaign_id', campaignId);
    if (saved.error) throw saved.error;
    expect(saved.data).toHaveLength(2);
    const primaryPayment = saved.data?.find((method) => method.id === primaryId);
    const secondPayment = saved.data?.find((method) => method.account_number === '4444555566');
    expect(primaryPayment).toMatchObject({
      method_type: 'promptpay',
      display_name: null,
      promptpay_id: '0812345678',
      bank_name: 'SCB',
      account_name: 'Nireq Creator',
      account_number: '1112223333',
      bank_accounts: [
        { bank_name: 'SCB', account_name: 'Nireq Creator', account_number: '1112223333' },
        { bank_name: 'KBank', account_name: 'Nireq Creator', account_number: '2222333344' },
        { bank_name: 'BBL', account_name: 'Nireq Creator', account_number: '3333444455' },
      ],
      instructions: 'Use the exact order total.',
    });
    expect(primaryPayment?.qr_image_url).toContain(`/storage/v1/object/public/Avatar/qr/${run}.webp`);
    expect(secondPayment).toMatchObject({
      display_name: null,
      bank_accounts: [{ bank_name: 'Krungthai', account_name: 'Second Recipient', account_number: '4444555566' }],
      account_name: 'Second Recipient',
      account_number: '4444555566',
    });

    await page.getByRole('button', { name: /^Add payment method$|^เพิ่มช่องทางชำระเงิน$/ }).click();
    form = page.getByTestId('campaign-payment-form');
    await fillBankAccount(form, 1, { bank: ' krungthai ', name: ' second recipient ', number: '444-455-5566' });
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
      (method: { promptpay_id?: string | null }) => method.promptpay_id === '0812345678',
    );
    expect(publicPayment).toMatchObject({
      promptpay_id: '0812345678',
      bank_name: 'SCB',
      account_name: 'Nireq Creator',
      account_number: '1112223333',
      bank_accounts: [
        { bank_name: 'SCB', account_name: 'Nireq Creator', account_number: '1112223333' },
        { bank_name: 'KBank', account_name: 'Nireq Creator', account_number: '2222333344' },
        { bank_name: 'BBL', account_name: 'Nireq Creator', account_number: '3333444455' },
      ],
      instructions: 'Use the exact order total.',
    });
    expect(publicPayment?.qr_image_url).toContain(`/storage/v1/object/public/Avatar/qr/${run}.webp`);
    const publicSecondPayment = publicCampaign.data?.payment_methods?.find(
      (method: { bank_accounts?: Array<{ account_number?: string }> }) => method.bank_accounts?.some((account) => account.account_number === '4444555566'),
    );
    expect(publicSecondPayment).toMatchObject({
      bank_accounts: [{ bank_name: 'Krungthai', account_name: 'Second Recipient', account_number: '4444555566' }],
    });
  });
});
