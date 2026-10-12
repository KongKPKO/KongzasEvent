import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { resolveSupabaseTestEnv } from '../helpers/localSupabaseEnv';

const env = resolveSupabaseTestEnv();
const email = `pilot-auth-${randomUUID()}@example.test`;
const slug = `pilot-${randomUUID().slice(0, 8)}`;
const password = 'PilotLocalPassword123!';
const newPassword = 'PilotChangedPassword456!';
let userId = '';
const messageIds = new Set<string>();
const service = createClient(env.url, env.serviceKey, { auth: { persistSession: false } });

test.afterAll(async () => {
  if (userId) {
    await service.from('artist_members').delete().eq('artist_id', userId).throwOnError();
    await service.from('creator_applications').delete().eq('auth_user_id', userId).throwOnError();
    await service.from('artists').delete().eq('id', userId).throwOnError();
    const deletion = await service.auth.admin.deleteUser(userId);
    if (deletion.error) throw deletion.error;
  }
  for (const id of messageIds) {
    const deletion = await fetch(`${env.mailpitUrl}/api/v1/messages`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: [id] }), signal: AbortSignal.timeout(5000) });
    expect(deletion.ok).toBe(true);
  }
});

async function emailLink(request: APIRequestContext, subject: RegExp) {
  let messageId = '';
  await expect.poll(async () => {
    const response = await request.get(`${env.mailpitUrl}/api/v1/messages`);
    expect(response.ok()).toBe(true);
    const body = await response.json() as { messages: Array<{ ID: string; Subject: string; To: Array<{ Address: string }> }> };
    const message = body.messages.find(item => item.To.some(to => to.Address === email) && subject.test(item.Subject));
    messageId = message?.ID || '';
    return Boolean(messageId);
  }, { timeout: 20_000 }).toBe(true);
  messageIds.add(messageId);
  const response = await request.get(`${env.mailpitUrl}/api/v1/message/${messageId}`);
  expect(response.ok()).toBe(true);
  const body = await response.json() as { HTML: string };
  const link = body.HTML.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/)?.[1]?.replace(/&amp;/g, '&');
  if (!link || new URL(link).origin !== new URL(env.url).origin) throw new Error('Expected local Auth confirmation link');
  return link;
}

test('creator registers, confirms email, resets password and signs in again', async ({ page, request }) => {
  test.setTimeout(90_000);
  for (const url of [env.url, env.mailpitUrl]) {
    expect(url && ['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'Auth pilot requires local Supabase and Mailpit').toBe(true);
  }
  page.setDefaultTimeout(15_000);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
  await page.goto('/creator/register');
  for (const [id, value] of Object.entries({
    'creator-email': email,
    'creator-password': password,
    'creator-confirm-password': password,
    'creator-contact-name': 'Pilot Test Owner',
    'creator-name': 'Pilot Browser Shop',
    'creator-slug': slug,
    'creator-primary-social': 'https://example.com/pilot-test',
    'creator-application-note': 'Testing creator registration for the controlled beta release.',
  })) await page.locator(`#${id}`).fill(value);
  await page.getByTestId('creator-truthful').check();
  const signupResponse = page.waitForResponse(response => response.url().includes('/auth/v1/signup') && response.request().method() === 'POST');
  await page.getByTestId('creator-register-submit').click();
  const signup = await signupResponse;
  expect(signup.ok()).toBe(true);
  const signupBody = await signup.json();
  userId = signupBody.id || signupBody.user?.id || '';
  expect(Boolean(userId)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Check your email or sign in' })).toBeVisible();

  await page.goto(await emailLink(request, /confirm/i));
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible({ timeout: 20_000 });
  const artist = await service.from('artists').select('id, slug, is_public').eq('id', userId).single().throwOnError();
  expect(artist.data).toMatchObject({ id: userId, slug, is_public: false });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/manage-login/, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByLabel('Reset email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await page.goto(await emailLink(request, /reset/i));
  await expect(page).toHaveURL(/\/reset-password/);
  await page.locator('#new-password').fill(newPassword);
  await page.locator('#confirm-password').fill(newPassword);
  await page.getByRole('button', { name: 'Update Password', exact: true }).click();
  await expect(page).toHaveURL(/\/manage-login/, { timeout: 15_000 });
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(newPassword);
  await page.getByTestId('creator-login-submit').click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: `/tmp/nireq-beta-auth-${test.info().project.name}.png` });
  const auth = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
  const oldPassword = await auth.auth.signInWithPassword({ email, password });
  expect(oldPassword.error?.message).toMatch(/invalid login credentials/i);
});
