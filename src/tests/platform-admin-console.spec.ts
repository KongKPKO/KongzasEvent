import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { completeAdminMfa } from './helpers/adminMfa';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

// Authenticator enrollment contains a secret. This suite only takes screenshots after verification.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

const supportedConsoleProjects = new Set(['desktop-chromium', 'mobile-android-chrome-pixel5']);

async function signIn(page: Page, email: string, password: string, redirect: string) {
  await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
  await page.goto(`/manage-login?redirect=${encodeURIComponent(redirect)}`);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByTestId('creator-login-submit').click();
}

test('ordinary signed-in user cannot open the platform admin console', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop-chromium', 'One browser is enough for the gate regression.');
  const env = resolveSupabaseTestEnv();
  expect(new URL(env.url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  const suffix = randomUUID().slice(0, 8);
  const email = `console-denied-${suffix}@example.test`;
  const password = 'LocalConsoleDenied123!';
  const { userId, service } = await ensureOwnerArtistFixture({
    email,
    password,
    slug: `console-denied-${suffix}`,
    displayName: 'Console denied fixture',
  });
  let consoleRequests = 0;
  await page.route('**/rest/v1/rpc/platform_admin_console', (route) => {
    consoleRequests += 1;
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"must not be called"}' });
  });

  try {
    await signIn(page, email, password, '/admin');
    await expect(page.getByRole('heading', { name: 'Admin verification', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Platform Admin access required');
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toHaveCount(0);
    expect(consoleRequests).toBe(0);
  } finally {
    await service.from('artists').delete().eq('id', userId).throwOnError();
    const removed = await service.auth.admin.deleteUser(userId);
    if (removed.error) throw removed.error;
  }
});

test('verified admin uses desktop and mobile console navigation, details, pagination, and error state', async ({ page }) => {
  test.skip(!supportedConsoleProjects.has(test.info().project.name), 'Covered on one desktop and one mobile browser.');
  test.setTimeout(90000);
  const env = resolveSupabaseTestEnv();
  expect(new URL(env.url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  const suffix = randomUUID().slice(0, 8);
  const email = `console-ui-${suffix}@example.test`;
  const password = 'LocalConsoleUi123!';
  const { userId, service } = await ensureOwnerArtistFixture({
    email,
    password,
    slug: `console-ui-${suffix}`,
    displayName: 'Console UI fixture',
  });
  const firstUserId = randomUUID();
  const secondUserId = randomUUID();
  const storeId = randomUUID();
  const consoleRequests: Array<{ p_action: string; p_query: string | null; p_target: string | null; p_page: number }> = [];
  const adminChanges: Array<{ p_user_id: string; p_grant: boolean; p_reason: string }> = [];
  const generatedAt = new Date().toISOString();

  await page.route('**/rest/v1/rpc/platform_admin_console', async (route) => {
    const request = route.request().postDataJSON() as {
      p_action: string;
      p_query: string | null;
      p_target: string | null;
      p_page: number;
    };
    consoleRequests.push(request);
    if (request.p_query === 'malformed') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, action: request.p_action, generated_at: generatedAt }) });
      return;
    }
    if (request.p_query === 'broken') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Synthetic console outage"}' });
      return;
    }
    if (request.p_action === 'overview') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          action: 'overview',
          counts: {
            users: 21,
            creators: 4,
            events: 6,
            campaigns: 3,
            active_events: 2,
            active_campaigns: 1,
            open_orders: 8,
            active_queue_entries: 2,
            pending_applications: 1,
            open_feedback: 5,
          },
          recent_audit: [],
          generated_at: generatedAt,
        }),
      });
      return;
    }
    if (request.p_action === 'users') {
      const secondPage = request.p_page === 2;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          action: 'users',
          page: request.p_page,
          page_size: 20,
          total: 21,
          items: [{
            id: secondPage ? secondUserId : firstUserId,
            email_masked: secondPage ? 's***@example.test' : 'f***@example.test',
            display_name: secondPage ? 'Second page user' : 'First page user',
            status: 'active',
            suspended: false,
            suspended_reason: null,
            created_at: generatedAt,
            last_sign_in_at: generatedAt,
            membership_count: secondPage ? 0 : 1,
            creator_count: secondPage ? 0 : 1,
            is_platform_admin: false,
          }],
          generated_at: generatedAt,
        }),
      });
      return;
    }
    if (request.p_action === 'user' && request.p_target === firstUserId) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          action: 'user',
          detail: {
            id: firstUserId,
            email_masked: 'f***@example.test',
            display_name: 'First page user',
            status: 'active',
            suspended: false,
            suspended_reason: null,
            created_at: generatedAt,
            last_sign_in_at: generatedAt,
            membership_count: 1,
            creator_count: 1,
            is_platform_admin: false,
            memberships: [{ store_id: storeId, store_name: 'Masked Creator Shop', role: 'owner', status: 'active', created_at: generatedAt }],
          },
          generated_at: generatedAt,
        }),
      });
      return;
    }
    await route.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"Unexpected synthetic action"}' });
  });
  await page.route('**/rest/v1/rpc/change_platform_admin', async (route) => {
    adminChanges.push(route.request().postDataJSON() as { p_user_id: string; p_grant: boolean; p_reason: string });
    await route.fulfill({ status: 200, contentType: 'application/json', body: 'true' });
  });

  try {
    await service.from('platform_admins').insert({ admin_email: email, auth_user_id: userId }).throwOnError();
    await signIn(page, email, password, '/admin');
    await expect(page.getByRole('heading', { name: 'Admin verification', exact: true })).toBeVisible();
    expect(consoleRequests).toHaveLength(0);
    await completeAdminMfa(page);
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Users/ }).filter({ hasText: '21' })).toBeVisible();

    if ((page.viewportSize()?.width || 0) < 1024) {
      await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    }
    await page.getByRole('navigation', { name: 'Platform admin navigation' }).getByRole('link', { name: 'Users', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
    await expect(page.getByText('First page user', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: `View details ${firstUserId}`, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'User details', exact: true })).toBeVisible();
    await expect(page.getByText('Masked Creator Shop', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Grant admin access', exact: true }).click();
    const adminDialog = page.getByRole('dialog', { name: 'Grant platform administrator access', exact: true });
    await adminDialog.getByLabel('Reason (5–500 characters)', { exact: true }).fill('Approved by platform operations');
    await adminDialog.getByRole('button', { name: 'Confirm grant', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Administrator access granted');
    expect(adminChanges).toEqual([{ p_user_id: firstUserId, p_grant: true, p_reason: 'Approved by platform operations' }]);
    await page.getByRole('link', { name: 'Back to list', exact: true }).click();

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText('Second page user', { exact: true })).toBeVisible();
    await expect(page.getByText('2 / 2', { exact: true })).toBeVisible();

    await page.getByRole('searchbox').fill('broken');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Could not load data');
    expect(consoleRequests.some((request) => request.p_action === 'users' && request.p_page === 2)).toBe(true);
    expect(consoleRequests.some((request) => request.p_action === 'users' && request.p_query === 'broken')).toBe(true);
    await page.getByRole('searchbox').fill('malformed');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Could not load data');
    await expect.poll(() => consoleRequests.some(request => request.p_query === 'malformed')).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await service.from('platform_admins').delete().eq('auth_user_id', userId).throwOnError();
    await service.from('artists').delete().eq('id', userId).throwOnError();
    const removed = await service.auth.admin.deleteUser(userId);
    if (removed.error) throw removed.error;
  }
});
