import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';
import { completeAdminMfa, totpCode } from './helpers/adminMfa';

// MFA setup responses contain a secret; capture only explicit post-verification screenshots.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test('TOTP helper matches the RFC test vector', () => {
  expect(totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000)).toBe('287082');
});

test('admin enrolls MFA, protected APIs deny AAL1, and a later login requires a code', async ({ page, browser }) => {
  test.setTimeout(90000);
  const env = resolveSupabaseTestEnv();
  expect(['127.0.0.1', 'localhost'].includes(new URL(env.url).hostname)).toBe(true);
  const suffix = randomUUID().slice(0, 8);
  const email = `admin-mfa-${suffix}@example.test`, password = 'LocalAdminMfa123!';
  const { userId, service } = await ensureOwnerArtistFixture({ email, password, slug: `mfa-${suffix}`, displayName: 'Synthetic MFA Admin' });
  try {
    await service.from('platform_admins').insert({ admin_email: email, auth_user_id: userId }).throwOnError();
    const caller = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const login = await caller.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
    expect((await caller.rpc('is_platform_admin_account')).data).toBe(true);
    expect((await caller.rpc('is_platform_admin')).data).toBe(false);
    expect((await caller.rpc('admin_support', { p_action: 'search_stores', p_query: 'Synthetic' })).error?.message).toContain('forbidden');
    const resend = await caller.functions.invoke('admin-resend-order-link', { body: { order_id: randomUUID(), request_id: randomUUID(), reason: 'Synthetic MFA test' } });
    expect(resend.error?.context?.status).toBe(403);
    await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
    await page.goto('/manage-login?redirect=/admin/support');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByTestId('creator-login-submit').click();
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toHaveCount(0);
    const secret = await completeAdminMfa(page);
    await expect(page.getByRole('heading', { name: 'Store support', exact: true })).toBeVisible();
    await page.getByLabel('Store name / slug / email', { exact: true }).fill('Synthetic');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Search results', exact: true })).toBeVisible();
    await page.screenshot({ path: `output/playwright/phase01/admin-mfa-verified-${test.info().project.name}.png` });
    await page.route('**/rest/v1/rpc/is_platform_admin', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Synthetic access check outage"}' }));
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('Could not check access');
    await expect(page.getByRole('heading', { name: 'Store support', exact: true })).toHaveCount(0);
    await page.unroute('**/rest/v1/rpc/is_platform_admin');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Store support', exact: true })).toBeVisible();

    // A new browser has no AAL2 session, even though the account already has a factor.
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const other = await context.newPage();
    try {
      await other.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
      await other.goto(new URL('/manage-login?redirect=/admin/applications', page.url()).href);
      await other.getByLabel('Email', { exact: true }).fill(email);
      await other.getByLabel('Password', { exact: true }).fill(password);
      await other.getByTestId('creator-login-submit').click();
      await expect(other.getByRole('heading', { name: 'Admin verification', exact: true })).toBeVisible();
      await expect(other.getByRole('button', { name: 'Set up authenticator', exact: true })).toHaveCount(0);
      await expect(other.getByRole('button', { name: 'Verify and continue', exact: true })).toBeDisabled();
      const valid = totpCode(secret);
      const invalid = ((Number(valid) + 1) % 1000000).toString().padStart(6, '0');
      await other.getByLabel('Six-digit code', { exact: true }).fill(invalid);
      await other.getByRole('button', { name: 'Verify and continue', exact: true }).click();
      await expect(other.getByRole('alert')).toContainText('Verification failed');
      expect(await other.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await other.screenshot({ path: 'output/playwright/phase01/admin-mfa-challenge-mobile.png' });
      await completeAdminMfa(other, secret);
      await expect(other.getByTestId('admin-applications-refresh')).toBeVisible();
    } finally { await context.close(); }
    // Enrollment does not upgrade a different, existing AAL1 session.
    expect((await caller.rpc('is_platform_admin')).data).toBe(false);
  } finally {
    await service.from('platform_admins').delete().eq('auth_user_id', userId).throwOnError();
    await service.from('artists').delete().eq('id', userId).throwOnError();
    const removed = await service.auth.admin.deleteUser(userId);
    if (removed.error) throw removed.error;
  }
});
