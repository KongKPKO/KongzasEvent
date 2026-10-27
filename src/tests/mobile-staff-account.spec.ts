import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

for (const role of ['queue_staff', 'seller'] as const) {
  test(`mobile ${role} can identify their account and sign out without an active event`, async ({ page }) => {
    test.setTimeout(60_000);
    const env = resolveSupabaseTestEnv();
    if (!['127.0.0.1', 'localhost'].includes(new URL(env.url).hostname)) throw new Error('Staff account fixtures require disposable local Supabase');
    const suffix = randomUUID().slice(0, 8);
    const password = 'MobileStaffFixture123!';
    const ownerEmail = `mobile-owner-${suffix}@example.test`;
    const staffEmail = `mobile-staff-${suffix}@example.test`;
    const { userId: artistId, service } = await ensureOwnerArtistFixture({ email: ownerEmail, password, slug: `mobile-staff-${suffix}`, displayName: 'Mobile Staff Shop' });
    let staffId = '';
    try {
      const created = await service.auth.admin.createUser({ email: staffEmail, password, email_confirm: true });
      if (created.error) throw created.error;
      staffId = created.data.user.id;
      await service.from('artist_members').insert({ artist_id: artistId, member_email: staffEmail, role, status: 'active' }).throwOnError();
      await service.from('events').insert({ artist_id: artistId, event_name: 'Future event', start_date: new Date(Date.now() + 86400000).toISOString(), end_date: new Date(Date.now() + 172800000).toISOString(), status: 'Confirmed' }).throwOnError();
      await page.setViewportSize({ width: 390, height: role === 'queue_staff' ? 600 : 844 });
      await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
      await page.goto('/manage-login');
      await page.getByLabel('Email', { exact: true }).fill(staffEmail);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByTestId('creator-login-submit').click();
      await expect(page).toHaveURL(role === 'seller' ? /\/live\/pos/ : /\/live\/queue/);
      await expect(page.getByText('Future event', { exact: true }).first()).toBeVisible();
      await page.reload();
      await expect(page.getByRole('button', { name: 'Open workspace menu' })).toBeVisible();
      await page.evaluate(() => localStorage.setItem('posPaymentAttempt:mobile-test', 'keep-existing-attempt'));
      if (role === 'queue_staff') await page.route('**/rest/v1/rpc/list_actor_workspaces', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Workspace lookup unavailable' }) }));
      await page.getByRole('button', { name: 'Open workspace menu' }).click();
      const menu = page.locator('#workspace-menu');
      await expect(menu.getByText(staffEmail, { exact: true })).toBeVisible();
      await expect(menu.getByText(role === 'seller' ? 'Seller' : 'Queue staff', { exact: false })).toBeVisible();
      if (role === 'queue_staff') await expect(menu.getByRole('alert')).toBeVisible();
      await menu.getByRole('button', { name: 'Sign out', exact: true }).click({ timeout: 7000 });
      await expect(page).toHaveURL(/\/manage-login/);
      expect(await page.evaluate(() => localStorage.getItem('posPaymentAttempt:mobile-test'))).toBe('keep-existing-attempt');
      if (role === 'queue_staff') await page.unroute('**/rest/v1/rpc/list_actor_workspaces');
      await page.getByLabel('Email', { exact: true }).fill(ownerEmail);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByTestId('creator-login-submit').click();
      await expect(page).not.toHaveURL(/\/manage-login/);
      await page.getByRole('button', { name: 'Open workspace menu' }).click();
      await expect(page.locator('#workspace-menu').getByText(ownerEmail, { exact: true })).toBeVisible();
      await expect(page.locator('#workspace-menu').getByText(/ · Owner$/)).toBeVisible();
      await expect(page.locator('#workspace-menu').getByText(staffEmail, { exact: true })).toHaveCount(0);
    } finally {
      await service.from('artists').delete().eq('id', artistId).throwOnError();
      if (staffId) await service.auth.admin.deleteUser(staffId);
      await service.auth.admin.deleteUser(artistId);
    }
  });
}
