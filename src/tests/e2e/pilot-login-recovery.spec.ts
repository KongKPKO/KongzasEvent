import { expectSignedInAccount } from '../helpers/accountMenu';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureOwnerArtistFixture } from '../helpers/adminFixture';
import { resolveSupabaseTestEnv } from '../helpers/localSupabaseEnv';
import { LoginPage } from './pages/LoginPage';

const runId = randomUUID();
const email = `login-recovery-${runId}@example.test`;
const password = 'LocalOnlyRecoveryPassword123!';
const name = `Login recovery shop ${runId.slice(0, 8)}`;
let service: SupabaseClient;
let artistId = '';
const eventId = randomUUID();

test.beforeAll(async () => {
  test.setTimeout(90_000);
  if (!process.env.SUPABASE_WORKDIR) throw new Error('Login recovery fixtures require a disposable local Supabase workdir');
  const env = resolveSupabaseTestEnv();
  if (!['127.0.0.1', 'localhost'].includes(new URL(env.url).hostname)) throw new Error('Expected local Auth target');
  const fixture = await ensureOwnerArtistFixture({ email, password, slug: `login-${runId.slice(0, 8)}`, displayName: name });
  service = fixture.service;
  artistId = fixture.userId;
  await service.from('events').insert({
    id: eventId, artist_id: artistId, event_name: 'Login recovery live event',
    start_date: new Date(Date.now() - 3600_000).toISOString(),
    end_date: new Date(Date.now() + 86400_000).toISOString(),
    status: 'Confirmed', is_booth_open: true,
  }).throwOnError();
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  if (!service || !artistId) return;
  await service.from('events').delete().eq('id', eventId).throwOnError();
  await service.from('artists').delete().eq('id', artistId).throwOnError();
  const deletion = await service.auth.admin.deleteUser(artistId);
  if (deletion.error) throw deletion.error;
});

test('a temporary account-check failure stays on login and can be retried without guessing a workspace', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => window.localStorage.setItem('nireq-language', 'en'));
  // Only the failing secondary account check is controlled. Password auth and
  // workspace authorization still use the real disposable backend.
  await page.route('**/auth/v1/user', (route) => route.fulfill({
    status: 504, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary account-check failure' }),
  }));
  const login = new LoginPage(page);
  await login.goto();
  await login.login(email, password);
  await expect(page.getByRole('alert')).toContainText('Could not load your workspace. Please try again.', { timeout: 30_000 });
  await expect(page).toHaveURL(/\/manage-login$/);
  await page.unroute('**/auth/v1/user');
  await page.getByRole('button', { name: 'Retry loading workspace', exact: true }).click();
  await expect(page.getByRole('alert')).toBeHidden({ timeout: 30_000 });
  await expectSignedInAccount(page);
  await expect(page.getByRole('heading', { name: 'Login recovery live event', exact: true, level: 1 })).toBeVisible({ timeout: 30_000 });
});


test('workspace access-check failure is retryable rather than a missing-role claim', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => window.localStorage.setItem('nireq-language', 'en'));
  const login = new LoginPage(page);
  await login.goto();
  await login.login(email, password);
  await expect(page.getByRole('heading', { name: 'Login recovery live event', exact: true, level: 1 })).toBeVisible({ timeout: 30_000 });
  await page.route('**/rest/v1/rpc/resolve_actor_workspace', (route) => route.fulfill({
    status: 504, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary access-check failure' }),
  }));
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Could not load your workspace. Please try again.', { timeout: 30_000 });
  await expect(page.getByText('Workspace Not Assigned', { exact: true })).toBeHidden();
  await expect(page).toHaveURL(/\/manage-events(?:\/|$)/);
  await page.unroute('**/rest/v1/rpc/resolve_actor_workspace');
  await page.getByRole('button', { name: 'Retry loading workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Login recovery live event', exact: true, level: 1 })).toBeVisible({ timeout: 30_000 });
});


test('live event load failure is not presented as an empty or closed booth', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => window.localStorage.setItem('nireq-language', 'en'));
  const login = new LoginPage(page);
  await login.goto();
  await login.login(email, password);
  await expect(page.getByRole('heading', { name: 'Login recovery live event', exact: true, level: 1 })).toBeVisible({ timeout: 30_000 });
  await page.route('**/rest/v1/rpc/list_accessible_pos_events', (route) => route.fulfill({
    status: 504, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary event-list failure' }),
  }));
  await page.goto(`/manage-pos-queues?eventId=${eventId}`);
  await expect(page.getByRole('alert')).toContainText('Could not load your workspace. Please try again.', { timeout: 30_000 });
  await expect(page.getByTestId('booth-status')).toBeHidden();
  await expect(page.getByText('No active event', { exact: true })).toBeHidden();
  await page.unroute('**/rest/v1/rpc/list_accessible_pos_events');
  await page.getByRole('button', { name: 'Retry loading workspace', exact: true }).click();
  await expect(page.getByTestId('pos-event-selector')).toHaveValue(eventId, { timeout: 30_000 });
  await expect(page.getByTestId('booth-status')).toHaveText('Booth Open');
});


test('successful password auth can retry a failed workspace check without signing in again', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => window.localStorage.setItem('nireq-language', 'en'));
  await page.route('**/rest/v1/rpc/resolve_actor_workspace', (route) => route.fulfill({
    status: 504, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary access-check failure' }),
  }));
  await page.route('**/auth/v1/user', (route) => route.fulfill({
    status: 504, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary account-check failure' }),
  }));
  let passwordAttempts = 0;
  page.on('request', (request) => {
    if (request.url().includes('/auth/v1/token?grant_type=password')) passwordAttempts++;
  });
  const login = new LoginPage(page);
  await login.goto();
  await login.login(email, password);
  await expect(page.getByRole('alert')).toContainText('Could not load your workspace. Please try again.', { timeout: 30_000 });
  await expect(page).toHaveURL(/\/manage-login$/);
  await page.unroute('**/rest/v1/rpc/resolve_actor_workspace');
  await page.unroute('**/auth/v1/user');
  await page.getByRole('button', { name: 'Retry loading workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Login recovery live event', exact: true, level: 1 })).toBeVisible({ timeout: 30_000 });
  expect(passwordAttempts).toBe(1);
});

test('invitation lookup failure does not block an owner with a verified workspace', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
  await page.route('**/rest/v1/rpc/list_my_pending_invitations', route => route.fulfill({
    status: 504, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary invitation lookup failure' }),
  }));
  const login = new LoginPage(page);
  await login.goto();
  await login.login(email, password);
  await expect(page.getByRole('heading', { name: 'Login recovery live event', exact: true, level: 1 })).toBeVisible({ timeout: 30_000 });
});

test('failed admin destination check shows retry instead of claiming no workspace', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
  await page.route('**/rest/v1/rpc/is_platform_admin_account', route => route.fulfill({
    status: 504, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary admin check failure' }),
  }));
  await page.goto('/manage-login?redirect=%2Fadmin%2Fsupport');
  await new LoginPage(page).login(email, password);
  await expect(page).toHaveURL(/\/admin\/support$/);
  await expect(page.getByRole('alert')).toContainText('Could not check access. Try again.');
  await page.unroute('**/rest/v1/rpc/is_platform_admin_account');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Platform Admin access required.');
  await page.goto('/manage-events');
  await expect(page.getByRole('heading', { name: 'Login recovery live event', exact: true, level: 1 })).toBeVisible({ timeout: 30_000 });
});

test('rejected account token clears the local session and returns to login', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
  const login = new LoginPage(page);
  await login.goto();
  await login.login(email, password);
  await expect(page.getByRole('heading', { name: 'Login recovery live event', exact: true, level: 1 })).toBeVisible({ timeout: 30_000 });
  await page.route('**/rest/v1/rpc/resolve_actor_workspace', route => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Access check unavailable' }),
  }));
  await page.route('**/auth/v1/user', route => route.fulfill({
    status: 401, contentType: 'application/json', body: JSON.stringify({ msg: 'Invalid token', code: 'bad_jwt' }),
  }));
  await page.reload();
  await expect(page).toHaveURL(/\/manage-login(?:\?|$)/, { timeout: 30_000 });
  const signedOut = await page.evaluate(async () => {
    const modulePath = '/src/supabaseClient.ts';
    const { supabase } = await import(modulePath);
    const { data } = await supabase.auth.getSession();
    return data.session === null;
  });
  expect(signedOut).toBe(true);
});

test('canonical workspace failure is retryable without a client membership fallback', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
  await page.route('**/rest/v1/rpc/resolve_actor_workspace', route => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Access check unavailable' }),
  }));
  let legacyReads = 0;
  await page.route('**/rest/v1/artist_members?*', route => { legacyReads++; return route.fulfill({
    status: 504, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary membership read failure' }),
  }); });
  const login = new LoginPage(page);
  await login.goto();
  await login.login(email, password);
  await expect(page.getByRole('button', { name: 'Retry loading workspace', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.unroute('**/rest/v1/rpc/resolve_actor_workspace');
  expect(legacyReads).toBe(0);
  await page.unroute('**/rest/v1/artist_members?*');
  await page.getByRole('button', { name: 'Retry loading workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Login recovery live event', exact: true, level: 1 })).toBeVisible({ timeout: 30_000 });
});

test('expired session refresh failure can be retried without another password login', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
  const login = new LoginPage(page);
  await login.goto();
  await login.login(email, password);
  await expect(page.getByRole('heading', { name: 'Login recovery live event', exact: true, level: 1 })).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.endsWith('-auth-token'));
    if (!key) throw new Error('Expected stored local Auth session');
    const stored = JSON.parse(localStorage.getItem(key)!);
    stored.expires_at = Math.floor(Date.now() / 1000) - 60;
    localStorage.setItem(key, JSON.stringify(stored));
  });
  await page.route('**/auth/v1/token?grant_type=refresh_token', route => route.fulfill({
    status: 504, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary refresh failure' }),
  }));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Retry loading workspace', exact: true })).toBeVisible({ timeout: 45_000 });
  await page.unroute('**/auth/v1/token?grant_type=refresh_token');
  await page.getByRole('button', { name: 'Retry loading workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Login recovery live event', exact: true, level: 1 })).toBeVisible({ timeout: 30_000 });
});
