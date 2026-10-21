import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { devices, expect, test, type Page } from '@playwright/test';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { completeAdminMfa } from './helpers/adminMfa';
import { expectSignedInAccount } from './helpers/accountMenu';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

// Never capture Authenticator setup secrets or credentials.
test.use({ trace: 'off', video: 'off', screenshot: 'off', actionTimeout: 15000 });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5V8AAAAASUVORK5CYII=', 'base64');

async function login(page: Page, email: string, password: string, redirect: string) {
  await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
  await page.goto(`/manage-login?redirect=${encodeURIComponent(redirect)}`);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByTestId('creator-login-submit').click();
}

test('management suspension denies an existing JWT while teammates fulfill orders and private evidence stays revocable', async ({ page, browser }) => {
  test.setTimeout(120000);
  const env = resolveSupabaseTestEnv();
  expect(new URL(env.url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  const suffix = randomUUID().slice(0, 8);
  const password = 'LocalSuspensionFixture123!';
  const adminEmail = `susp-admin-${suffix}@example.test`;
  const ownerEmail = `manage-shop-${suffix}@example.test`;
  const managerEmail = `susp-manager-${suffix}@example.test`;
  const admin = await ensureOwnerArtistFixture({ email: adminEmail, password, slug: `susp-admin-${suffix}`, displayName: 'Suspension admin fixture' });
  const owner = await ensureOwnerArtistFixture({ email: ownerEmail, password, slug: `manage-shop-${suffix}`, displayName: 'Suspension store fixture' });
  const { service } = owner;
  const managerResult = await service.auth.admin.createUser({ email: managerEmail, password, email_confirm: true });
  if (managerResult.error || !managerResult.data.user) throw managerResult.error || new Error('Manager fixture missing');
  const managerId = managerResult.data.user.id;
  const eventId = randomUUID();
  const orderId = randomUUID();
  const code = `AS${suffix.toUpperCase()}`;
  const path = `${eventId}/${orderId}/synthetic.png`;
  const device = test.info().project.name === 'mobile-android-chrome-pixel5' ? devices['Pixel 5']
    : test.info().project.name === 'mobile-ios-safari-iphone12' ? devices['iPhone 12'] : {};
  const ownerContext = await browser.newContext(device);
  const ownerPage = await ownerContext.newPage();
  const managerContext = await browser.newContext(device);
  const managerPage = await managerContext.newPage();
  const ownerClient = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const managerClient = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    await service.from('platform_admins').insert({ admin_email: adminEmail, auth_user_id: admin.userId }).throwOnError();
    await service.from('artist_members').insert({ artist_id: owner.userId, member_email: managerEmail, role: 'manager', status: 'active' }).throwOnError();
    await service.from('events').insert({ id: eventId, artist_id: owner.userId, event_name: 'Account suspension live fixture', status: 'Confirmed', start_date: new Date(Date.now() - 3600000).toISOString(), end_date: new Date(Date.now() + 86400000).toISOString(), is_booth_open: true }).throwOnError();
    await service.from('orders').insert({ id: orderId, event_id: eventId, order_type: 'preorder', total_price: 100, status: 'confirmed', pickup_status: 'awaiting_pickup', pickup_code: code, customer_name: 'Synthetic buyer', customer_email: 'buyer@example.test' }).throwOnError();
    await service.from('order_payments').insert({ order_id: orderId, event_id: eventId, artist_id: owner.userId, amount_expected: 100, payment_status: 'payment_confirmed', slip_url: path }).throwOnError();
    const uploaded = await service.storage.from('PaymentEvidence').upload(path, png, { contentType: 'image/png' });
    if (uploaded.error) throw uploaded.error;
    const ownerSignIn = await ownerClient.auth.signInWithPassword({ email: ownerEmail, password });
    const managerSignIn = await managerClient.auth.signInWithPassword({ email: managerEmail, password });
    if (ownerSignIn.error || managerSignIn.error) throw new Error('Synthetic staff sign in failed');
    const originalToken = ownerSignIn.data.session!.access_token;

    console.info('[suspension] evidence API');
    const allowedEvidence = await ownerClient.functions.invoke<Blob>('payment-evidence', { body: { path } });
    expect(allowedEvidence.error).toBeNull();
    expect(allowedEvidence.data).toBeInstanceOf(Blob);
    expect(Buffer.from(await allowedEvidence.data!.arrayBuffer())).toEqual(png);
    expect(allowedEvidence.response?.headers.get('cache-control')).toBe('private, no-store');
    expect((await ownerClient.storage.from('PaymentEvidence').createSignedUrl(path, 1800)).error).not.toBeNull();
    expect((await ownerClient.functions.invoke('payment-evidence', { body: { path: `${eventId}/other.png` } })).response?.status).toBe(404);
    const anonymous = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
    expect((await anonymous.functions.invoke('payment-evidence', { body: { path } })).response?.status).toBe(401);

    console.info('[suspension] owner login');
    await login(ownerPage, ownerEmail, password, '/manage-events');
    await expectSignedInAccount(ownerPage);
    console.info('[suspension] manager login');
    await login(managerPage, managerEmail, password, `/manage-events/${eventId}/preorder-dashboard`);
    await expectSignedInAccount(managerPage);
    await managerPage.goto(`/manage-events/${eventId}/preorder-dashboard`);
    await managerPage.getByRole('button', { name: /Confirmed/ }).first().click();
    await managerPage.getByRole('button', { name: 'Slip', exact: true }).click();
    const preview = managerPage.getByRole('dialog', { name: `Payment slip for ${code}` });
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    const previewUrl = await preview.locator('img').getAttribute('src');
    expect(previewUrl).toMatch(/^blob:/);
    await managerPage.getByRole('button', { name: 'Close slip preview', exact: true }).click();
    await expect(preview).toBeHidden();
    expect(await managerPage.evaluate(async url => { try { await fetch(url!); return false; } catch { return true; } }, previewUrl)).toBe(true);

    console.info('[suspension] admin login');
    await login(page, adminEmail, password, `/admin/users/${owner.userId}`);
    await completeAdminMfa(page);
    await page.getByRole('button', { name: 'Suspend management access', exact: true }).click();
    const suspendDialog = page.getByRole('dialog', { name: 'Suspend account management access', exact: true });
    await expect(suspendDialog).toContainText('Other team members can keep working');
    await expect(suspendDialog.getByRole('button', { name: 'Confirm suspension', exact: true })).toBeDisabled();
    await suspendDialog.getByRole('textbox').fill('Review owner management access');
    await suspendDialog.getByRole('button', { name: 'Confirm suspension', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Restore management access', exact: true })).toBeVisible();

    console.info('[suspension] suspended JWT');
    const role = await ownerClient.rpc('has_artist_role', { p_artist_id: owner.userId, p_allowed_roles: ['owner'] });
    expect(role.error).toBeNull(); expect(role.data).toBe(false);
    expect((await ownerClient.auth.getSession()).data.session!.access_token).toBe(originalToken);
    expect((await ownerClient.rpc('list_actor_workspaces')).data).toEqual([]);
    const orders = await ownerClient.from('orders').select('id').eq('id', orderId);
    expect(orders.error).toBeNull(); expect(orders.data).toEqual([]);
    expect((await ownerClient.rpc('mark_preorder_picked_up', { p_order_id: orderId })).error).not.toBeNull();
    expect((await ownerClient.functions.invoke('payment-evidence', { body: { path } })).response?.status).toBe(403);
    expect((await ownerClient.storage.from('Avatar').upload(`${owner.userId}/blocked.png`, png, { contentType: 'image/png' })).error).not.toBeNull();
    await ownerPage.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(ownerPage.getByRole('heading', { name: 'Management access suspended', exact: true })).toBeVisible({ timeout: 15000 });
    mkdirSync('output/playwright/phase3-suspension', { recursive: true });
    await ownerPage.screenshot({ path: `output/playwright/phase3-suspension/account-${test.info().project.name}.png` });
    await ownerPage.goto('/live/queue');
    await expect(ownerPage.getByRole('heading', { name: 'Management access suspended', exact: true })).toBeVisible();
    await ownerPage.goto(`/manage-shop-${suffix}/home`);
    await expect(ownerPage.getByText('Suspension store fixture', { exact: true }).first()).toBeVisible();
    await expect(ownerPage.getByRole('heading', { name: 'Management access suspended', exact: true })).toHaveCount(0);
    await ownerPage.goto('/manage-events');
    await expect(ownerPage.getByRole('heading', { name: 'Management access suspended', exact: true })).toBeVisible();
    const publicOrder = await ownerClient.rpc('get_public_preorder_by_code', { p_artist_slug: `manage-shop-${suffix}`, p_pickup_code: code });
    expect(publicOrder.error).toBeNull(); expect(publicOrder.data).toBeTruthy();
    expect((await ownerClient.rpc('is_account_active')).data).toBe(true);
    await ownerPage.getByRole('link', { name: 'Contact support', exact: true }).click();
    await expect(ownerPage.getByRole('heading', { name: 'How can we help?', exact: true })).toBeVisible();
    await ownerPage.getByLabel(/^Subject/).fill(`Access review ${suffix}`);
    await ownerPage.getByLabel(/^Details/).fill('Please review the management suspension for this synthetic test account.');
    await ownerPage.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(ownerPage.getByRole('status')).toContainText('Sent successfully');

    console.info('[suspension] teammate fulfillment');
    const managerEvidence = await managerClient.functions.invoke<Blob>('payment-evidence', { body: { path } });
    expect(managerEvidence.error).toBeNull();
    expect((await managerClient.rpc('mark_preorder_picked_up', { p_order_id: orderId })).error).toBeNull();
    const unchanged = await service.from('orders').select('status,total_price,pickup_status').eq('id', orderId).single();
    expect(unchanged.data).toMatchObject({ status: 'completed', total_price: 100, pickup_status: 'picked_up' });
    expect((await service.from('artist_members').select('status').eq('artist_id', owner.userId).single()).data?.status).toBe('active');

    // Simulate a lost acknowledgement, then retry from the stale dialog.
    console.info('[suspension] restoration retry');
    let discardResponse = true;
    await page.route('**/rest/v1/rpc/set_account_management_suspension', async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      if (!discardResponse) {
        const response = await route.fetch();
        expect(response.status()).toBe(409);
        expect((await response.json()).code).toBe('PT409');
        await route.fulfill({ response });
        return;
      }
      discardResponse = false;
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      await route.abort('failed');
    });
    await page.getByRole('button', { name: 'Restore management access', exact: true }).click();
    const restoreDialog = page.getByRole('dialog', { name: 'Restore account management access', exact: true });
    await restoreDialog.getByRole('textbox').fill('Management review resolved');
    await restoreDialog.getByRole('button', { name: 'Confirm restoration', exact: true }).click();
    await expect(restoreDialog.getByRole('alert')).toBeVisible();
    await restoreDialog.getByRole('button', { name: 'Confirm restoration', exact: true }).click();
    await expect(restoreDialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Suspend management access', exact: true })).toBeVisible();
    expect((await ownerClient.rpc('has_artist_role', { p_artist_id: owner.userId, p_allowed_roles: ['owner'] })).data).toBe(true);
    await ownerPage.goto('/manage-events');
    await expectSignedInAccount(ownerPage);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await service.storage.from('PaymentEvidence').remove([path]);
    await service.from('feedback_tickets').delete().eq('user_id', owner.userId).throwOnError();
    await service.from('orders').delete().eq('id', orderId).throwOnError();
    await service.from('events').delete().eq('id', eventId).throwOnError();
    await service.from('platform_admins').delete().eq('auth_user_id', admin.userId).throwOnError();
    await service.from('artist_members').delete().eq('artist_id', owner.userId).throwOnError();
    for (const id of [owner.userId, admin.userId]) await service.from('artists').delete().eq('id', id).throwOnError();
    for (const id of [managerId, owner.userId, admin.userId]) {
      const result = await service.auth.admin.deleteUser(id);
      if (result.error) throw result.error;
    }
    if (!ownerPage.isClosed()) await ownerContext.close();
    if (!managerPage.isClosed()) await managerContext.close();
  }
});
