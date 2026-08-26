import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

const { url: SUPABASE_URL, key: SUPABASE_KEY } = resolveSupabaseTestEnv();
const localPassword = 'LocalCreatorSessionRace123!';

const getLocalCreatorSession = async (email: string) => {
  const auth = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signUp = await auth.auth.signUp({ email, password: localPassword });
  const session = signUp.data.session
    || (await auth.auth.signInWithPassword({ email, password: localPassword })).data.session;
  expect(session).toBeTruthy();
  const update = await auth.auth.updateUser({ data: { full_name: 'Google Prefilled Name' } });
  expect(update.error).toBeNull();
  return session!;
};

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

    const session = await getLocalCreatorSession('creator-session-race@example.com');

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

  test('same-user refresh keeps only genuine Google-prefill markers', async ({ page }) => {
    test.skip(!SUPABASE_URL.includes('127.0.0.1'), 'Prefill regression requires local Supabase');
    const session = await getLocalCreatorSession('creator-prefill-refresh@example.com');

    await page.route('**/rest/v1/rpc/get_actor_context', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
    });
    await page.route('**/rest/v1/artist_members**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route('**/rest/v1/artists**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.goto('/robots.txt');
    const setSession = async (tokens: { access_token: string; refresh_token: string }) => {
      await page.evaluate(async (nextTokens) => {
        const modulePath = '/src/supabaseClient.ts';
        const { supabase } = await import(modulePath);
        await supabase.auth.setSession(nextTokens);
      }, tokens);
    };
    const signOut = async () => {
      await page.evaluate(async () => {
        const modulePath = '/src/supabaseClient.ts';
        const { supabase } = await import(modulePath);
        await supabase.auth.signOut({ scope: 'local' });
      });
    };
    const refreshSession = async () => await page.evaluate(async () => {
      const modulePath = '/src/supabaseClient.ts';
      const { supabase } = await import(modulePath);
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) throw error || new Error('Missing refreshed session');
      return { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
    });

    await setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    await page.goto('/creator/register');
    const contactName = page.getByLabel('Contact name');
    await expect(contactName).toHaveValue('Google Prefilled Name');

    await refreshSession();
    await page.waitForTimeout(100);
    await signOut();
    await expect(contactName).toHaveValue('');

    const editedSession = await getLocalCreatorSession('creator-prefill-edited@example.com');
    await setSession({ access_token: editedSession.access_token, refresh_token: editedSession.refresh_token });
    await expect(contactName).toHaveValue('Google Prefilled Name');
    await contactName.fill('My saved draft name');
    await refreshSession();
    await page.waitForTimeout(100);
    await signOut();
    await expect(contactName).toHaveValue('My saved draft name');
  });
});
