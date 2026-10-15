import { expect, test, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { LoginPage } from './e2e/pages/LoginPage';

test('event order settings preserve, disable, and add multiple payment methods without duplicate retries', async ({ page }) => {
  const runId = randomUUID();
  const email = `event-payments-${runId}@example.test`;
  const password = 'LocalOnlyPaymentMethods123!';
  const fixture = await ensureOwnerArtistFixture({
    email,
    password,
    slug: `event-payments-${runId.slice(0, 8)}`,
    displayName: 'Event payment methods test',
  });
  const eventId = randomUUID();
  const primaryMethodId = randomUUID();
  const disabledMethodId = randomUUID();
  const now = Date.now();

  try {
    const seededEvent = await fixture.service.from('events').insert({
      id: eventId,
      artist_id: fixture.userId,
      event_name: `Multiple payment methods ${runId}`,
      start_date: new Date(now + 7 * 86400000).toISOString(),
      end_date: new Date(now + 8 * 86400000).toISOString(),
      event_timezone: 'Asia/Bangkok',
      status: 'Confirmed',
      selling_mode: 'preorder',
      preorder_enabled: true,
      preorder_opens_at: new Date(now - 3600000).toISOString(),
      preorder_closes_at: new Date(now + 6 * 86400000).toISOString(),
      postorder_enabled: true,
      postorder_opens_at: new Date(now + 9 * 86400000).toISOString(),
      postorder_closes_at: new Date(now + 10 * 86400000).toISOString(),
    });
    if (seededEvent.error) throw seededEvent.error;

    const seededMethods = await fixture.service.from('event_payment_methods').insert([
      {
        id: primaryMethodId,
        event_id: eventId,
        artist_id: fixture.userId,
        method_type: 'promptpay',
        display_name: 'Main KBank account',
        promptpay_id: '0811111111',
        bank_name: 'KBank',
        account_name: 'Main Artist',
        account_number: '111-1-11111-1',
        qr_image_url: '/pwa-192x192.png',
        instructions: 'Use this account first.',
        is_enabled: true,
      },
      {
        id: disabledMethodId,
        event_id: eventId,
        artist_id: fixture.userId,
        method_type: 'bank_transfer',
        display_name: 'Backup SCB account',
        promptpay_id: '0822222222',
        bank_name: 'SCB',
        account_name: 'Backup Artist',
        account_number: '222-2-22222-2',
        qr_image_url: '/pwa-512x512.png',
        instructions: 'Enable this account when needed.',
        is_enabled: false,
      },
    ]);
    if (seededMethods.error) throw seededMethods.error;

    await page.addInitScript(() => window.localStorage.setItem('nireq-language', 'en'));
    const login = new LoginPage(page);
    await login.goto();
    await login.login(email, password);
    await expect(page).not.toHaveURL(/manage-login/);
    await page.goto(`/manage-events/${eventId}/preorder`);

    const cards = page.getByTestId('payment-method-card');
    await expect(cards).toHaveCount(2);
    await expect(page.getByText('Method type', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/require payment and slip submission within 15 minutes/)).toBeVisible();

    const primaryCard = cards.filter({ has: page.locator('input[value="Main KBank account"]') });
    const disabledCard = cards.filter({ has: page.locator('input[value="Backup SCB account"]') });
    await expect(primaryCard.getByLabel('Display name')).toHaveValue('Main KBank account');
    await expect(primaryCard.getByLabel('PromptPay ID')).toHaveValue('0811111111');
    await expect(primaryCard.getByLabel('Bank name')).toHaveValue('KBank');
    await expect(primaryCard.getByLabel('Account name')).toHaveValue('Main Artist');
    await expect(primaryCard.getByLabel('Account number')).toHaveValue('111-1-11111-1');
    await expect(primaryCard.getByAltText('Payment QR preview')).toBeVisible();
    await expect(primaryCard.getByLabel('Enabled')).toBeChecked();

    await expect(disabledCard.getByLabel('Display name')).toHaveValue('Backup SCB account');
    await expect(disabledCard.getByLabel('PromptPay ID')).toHaveValue('0822222222');
    await expect(disabledCard.getByLabel('Bank name')).toHaveValue('SCB');
    await expect(disabledCard.getByLabel('Account number')).toHaveValue('222-2-22222-2');
    await expect(disabledCard.getByAltText('Payment QR preview')).toBeVisible();
    await expect(disabledCard.getByLabel('Enabled')).not.toBeChecked();

    await primaryCard.getByLabel('Enabled').uncheck();
    await disabledCard.getByLabel('Extra instructions').fill('Keep this disabled account for order history.');
    await page.getByRole('button', { name: 'Add payment method', exact: true }).click();
    await expect(cards).toHaveCount(3);

    const newCard = cards.nth(2);
    await newCard.getByLabel('Display name').fill('Event Krungthai account');
    await newCard.getByLabel('PromptPay ID').fill('0833333333');
    await newCard.getByLabel('Bank name').fill('Krungthai');
    await newCard.getByLabel('Account name').fill('Event Artist');
    await newCard.getByLabel('Account number').fill('333-3-33333-3');
    await newCard.getByLabel('Extra instructions').fill('Upload the transfer slip after paying.');
    await page.getByRole('button', { name: 'Add payment method', exact: true }).click();
    await expect(cards).toHaveCount(4);

    const paymentRoute = '**/rest/v1/event_payment_methods*';
    const failPaymentSave = async (route: Route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Simulated payment save failure' }),
        });
        return;
      }
      await route.continue();
    };
    await page.route(paymentRoute, failPaymentSave);
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Order settings failed');
    const failedSaveRows = await fixture.service.from('event_payment_methods').select('id').eq('event_id', eventId);
    if (failedSaveRows.error) throw failedSaveRows.error;
    expect(failedSaveRows.data).toHaveLength(2);
    await page.unroute(paymentRoute, failPaymentSave);

    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Order settings saved');
    await expect(cards).toHaveCount(3);

    const afterFirstSave = await fixture.service
      .from('event_payment_methods')
      .select('id, method_type, display_name, promptpay_id, bank_name, account_name, account_number, instructions, is_enabled, payment_deadline_at')
      .eq('event_id', eventId);
    if (afterFirstSave.error) throw afterFirstSave.error;
    expect(afterFirstSave.data).toHaveLength(3);
    expect(afterFirstSave.data.find((method) => method.id === primaryMethodId)).toMatchObject({
      method_type: 'promptpay',
      is_enabled: false,
    });
    expect(afterFirstSave.data.find((method) => method.id === disabledMethodId)).toMatchObject({
      method_type: 'bank_transfer',
      is_enabled: false,
      instructions: 'Keep this disabled account for order history.',
    });
    expect(afterFirstSave.data.find((method) => method.display_name === 'Event Krungthai account')).toMatchObject({
      promptpay_id: '0833333333',
      bank_name: 'Krungthai',
      account_name: 'Event Artist',
      account_number: '333-3-33333-3',
      is_enabled: true,
      payment_deadline_at: null,
    });

    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect.poll(async () => {
      const rows = await fixture.service.from('event_payment_methods').select('id').eq('event_id', eventId);
      if (rows.error) throw rows.error;
      return rows.data.length;
    }).toBe(3);
  } finally {
    await fixture.service.from('event_payment_methods').delete().eq('event_id', eventId);
    await fixture.service.from('events').delete().eq('id', eventId);
    await fixture.service.from('artists').delete().eq('id', fixture.userId);
    const deletedUser = await fixture.service.auth.admin.deleteUser(fixture.userId);
    if (deletedUser.error) throw deletedUser.error;
  }
});
