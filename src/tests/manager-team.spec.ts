import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

test('manager opens team, invites event staff and removes them without role editing', async ({ page, browser }) => {
  test.setTimeout(60000);
  const env = resolveSupabaseTestEnv();
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(env.url)) throw new Error('Local database required');
  const service = createClient(env.url, env.serviceKey, { auth: { persistSession: false } });
  const suffix = randomUUID();
  const email = `manager-${suffix}@example.com`, password = 'LocalManagerTest123!';
  const { userId } = await ensureOwnerArtistFixture({ email: `owner-${suffix}@example.com`, password, slug: `team-${suffix.slice(0, 12)}`, displayName: 'Manager scope test' });
  const manager = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (manager.error) throw manager.error;
  const must = (result: { error: unknown }) => { if (result.error) throw result.error; };
  const staffEmail = `staff-${suffix}@example.com`;
  const eventId = randomUUID();
  try {
    must(await service.from('artist_members').insert([
      { artist_id: userId, member_email: email, role: 'manager', status: 'active' },
      { artist_id: userId, member_email: staffEmail, role: 'seller', status: 'active' },
    ]));
    must(await service.from('events').insert({ id: eventId, artist_id: userId, event_name: 'Scope event', start_date: new Date().toISOString(), end_date: new Date(Date.now() + 86400000).toISOString(), status: 'Confirmed' }));
    await page.addInitScript(() => { localStorage.setItem('nireq-language', 'en'); localStorage.setItem('nireq-replay-consent-v1', 'rejected'); });
    await page.goto('/manage-login');
    await page.locator('input[type=email]').fill(email);
    await page.locator('input[type=password]').fill(password);
    await page.getByRole('button', { name: /Login/i }).click();
    await expect(page).toHaveURL(/manage-events/);
    await page.goto('/manage-team');
    await expect(page.getByText(staffEmail, { exact: true })).toBeVisible();
    const invite = page.locator('form');
    await expect(invite.locator('option[value=manager]')).toHaveCount(0);
    await invite.locator('input[type=email]').fill(`invite-${suffix}@example.com`);
    await invite.getByText('Scope event', { exact: true }).click();
    // Avoid sending an email; the invitation RPC itself uses the real local database.
    await page.route('**/auth/v1/otp*', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await invite.getByRole('button', { name: 'Invite', exact: true }).click();
    await expect(page.getByText('Magic link sent.', { exact: false })).toBeVisible();
    const row = page.locator('.divide-y > div').filter({ has: page.getByText(staffEmail, { exact: true }) });
    await expect(row.locator('select')).toBeDisabled();
    await expect(row.getByLabel('Shipping responsibility — access customer addresses and contacts')).toBeDisabled();
    const ownerPage = await browser.newPage();
    try {
      await ownerPage.addInitScript(() => { localStorage.setItem('nireq-language', 'en'); localStorage.setItem('nireq-replay-consent-v1', 'rejected'); });
      await ownerPage.goto('/manage-login');
      await ownerPage.locator('input[type=email]').fill(`owner-${suffix}@example.com`);
      await ownerPage.locator('input[type=password]').fill(password);
      await ownerPage.getByRole('button', { name: /Login/i }).click();
      await expect(ownerPage).toHaveURL(/manage-events/);
      await ownerPage.goto('/manage-team');
      const shipping = ownerPage.getByLabel('Shipping responsibility — access customer addresses and contacts');
      await shipping.click();
      await expect(shipping).toBeChecked();
      await expect.poll(async () => (await service.from('artist_members').select('can_manage_shipping').eq('artist_id', userId).eq('member_email', staffEmail).single()).data?.can_manage_shipping).toBe(true);
      const staffRow = ownerPage.locator('.divide-y > div').filter({ has: ownerPage.getByText(staffEmail, { exact: true }) });
      await expect(staffRow).toContainText('All events, including future events');
      const eventAccess = staffRow.getByLabel(/Scope event/);
      await eventAccess.click();
      await expect(eventAccess).toBeChecked();
      ownerPage.once('dialog', dialog => dialog.dismiss());
      await eventAccess.click();
      await expect(eventAccess).toBeChecked();
      await ownerPage.route('**/rest/v1/event_member_assignments?*', async route => {
        if (route.request().method() === 'DELETE') await route.fulfill({ status: 503, json: { message: 'Unavailable' } });
        else await route.continue();
      });
      ownerPage.once('dialog', dialog => dialog.accept());
      await eventAccess.click();
      await expect(ownerPage.getByRole('alert')).toContainText('Access update did not complete');
      await expect(eventAccess).toBeChecked();
      await ownerPage.getByRole('button', { name: 'Switch language' }).click();
      for (const width of [320, 375, 414, 768, 1280]) {
        await ownerPage.setViewportSize({ width, height: 900 });
        expect(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      await ownerPage.screenshot({ path: '/tmp/nireq-team-ui.png', fullPage: true });
      await ownerPage.goto('/invitations');
      await ownerPage.getByRole('button', { name: 'Switch language' }).click();
      await expect(ownerPage.getByRole('heading', { name: 'คำเชิญของฉัน' })).toBeVisible();
      await expect(ownerPage.getByText('ไม่มีคำเชิญที่รอตอบรับ', { exact: false })).toBeVisible();

    } finally { await ownerPage.close(); }

    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: `Remove ${staffEmail}`, exact: true }).click();
    await expect(page.getByText(staffEmail, { exact: true })).toHaveCount(0);
    expect((await service.from('artist_members').select('id').eq('artist_id', userId).eq('member_email', staffEmail)).data).toEqual([]);
  } finally {
    must(await service.from('artists').delete().eq('id', userId));
    must(await service.auth.admin.deleteUser(manager.data.user.id));
    must(await service.auth.admin.deleteUser(userId));
  }
});
