import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

const { url: SUPABASE_URL, key: SUPABASE_KEY } = resolveSupabaseTestEnv();

test.describe('Creator Google auth', () => {
  test('creator login starts Google OAuth with the login return URL', async ({ page }) => {
    await page.route('**/auth/v1/authorize**', async (route) => route.abort());
    await page.goto('/manage-login');

    const authorizeRequest = page.waitForRequest((request) =>
      request.url().includes('/auth/v1/authorize')
    );
    await page.getByRole('button', { name: 'Continue with Google' }).click();

    const url = new URL((await authorizeRequest).url());
    expect(url.searchParams.get('provider')).toBe('google');
    expect(url.searchParams.get('redirect_to')).toBe('http://127.0.0.1:5173/manage-login');
  });

  test('Google login stays in creator mode and staff magic link remains available', async ({ page }) => {
    await page.goto('/manage-login');
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();

    await page.getByRole('tab', { name: 'Staff' }).click();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send staff magic link' })).toBeVisible();
  });

  test('login shows an OAuth error returned in the URL fragment', async ({ page }) => {
    await page.goto('/manage-login#error=access_denied&error_description=Google+sign-in+was+cancelled');
    await expect(page.getByText('Google sign-in was cancelled')).toBeVisible();
  });

  test('creator signup starts Google OAuth before the application form', async ({ page }) => {
    await page.route('**/auth/v1/authorize**', async (route) => route.abort());
    await page.goto('/creator/register');

    const authorizeRequest = page.waitForRequest((request) =>
      request.url().includes('/auth/v1/authorize')
    );
    await page.getByRole('button', { name: 'Continue with Google' }).click();

    const url = new URL((await authorizeRequest).url());
    expect(url.searchParams.get('provider')).toBe('google');
    expect(url.searchParams.get('redirect_to')).toBe('http://127.0.0.1:5173/creator/register');
  });

  test('creator signup recovers from a cancelled Google flow', async ({ page }) => {
    await page.goto('/creator/register#error=access_denied&error_description=Google+sign-in+was+cancelled');
    await expect(page.getByText('Google sign-in was cancelled')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  });

  test('creator signup ignores a stale actor response after sign-out', async ({ page }) => {
    test.skip(!SUPABASE_URL.includes('127.0.0.1'), 'Session-race regression requires local Supabase');

    const auth = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = 'creator-session-race@example.com';
    const password = 'LocalCreatorSessionRace123!';
    const signUp = await auth.auth.signUp({ email, password });
    const session = signUp.data.session
      || (await auth.auth.signInWithPassword({ email, password })).data.session;
    expect(session).toBeTruthy();

    await page.goto('/robots.txt');
    await page.evaluate(async (tokens) => {
      const modulePath = '/src/supabaseClient.ts';
      const { supabase } = await import(modulePath);
      await supabase.auth.setSession(tokens);
    }, { access_token: session!.access_token, refresh_token: session!.refresh_token });

    let releaseActorResponse = () => {};
    const actorResponseReleased = new Promise<void>((resolve) => {
      releaseActorResponse = resolve;
    });
    let actorRequestStarted = () => {};
    const actorRequest = new Promise<void>((resolve) => {
      actorRequestStarted = resolve;
    });
    await page.route('**/rest/v1/rpc/get_actor_context', async (route) => {
      actorRequestStarted();
      await actorResponseReleased;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ artist_id: 'stale-artist', role: 'owner', is_owner: true }]),
      });
    });

    await page.goto('/creator/register');
    await actorRequest;
    await page.evaluate(async () => {
      const modulePath = '/src/supabaseClient.ts';
      const { supabase } = await import(modulePath);
      await supabase.auth.signOut({ scope: 'local' });
    });
    const staleActorResponse = page.waitForResponse('**/rest/v1/rpc/get_actor_context');
    releaseActorResponse();
    await staleActorResponse;
    await page.waitForTimeout(100);

    await expect(page).toHaveURL(/\/creator\/register$/);
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  });
});
