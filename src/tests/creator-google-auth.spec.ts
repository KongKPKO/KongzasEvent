import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

const { url: SUPABASE_URL, key: SUPABASE_KEY, serviceKey: SERVICE_KEY } = resolveSupabaseTestEnv();
const service = SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY) : null;
const localPassword = 'LocalCreatorSessionRace123!';

const createConfirmedUser = async (userMetadata?: Record<string, string>) => {
  if (!service) throw new Error('Local Supabase service key is required');
  const email = `google-onboarding-${randomUUID()}@example.com`;
  const password = 'CreatorPass123!';
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: userMetadata,
  });
  if (error || !data.user) throw error || new Error('Confirmed user was not created');
  return { userId: data.user.id, email, password };
};

const cleanupUser = async (userId: string) => {
  if (!service) return;
  await service.from('artist_members').delete().eq('artist_id', userId);
  await service.from('creator_applications').delete().eq('auth_user_id', userId);
  await service.from('artists').delete().eq('id', userId);
  await service.auth.admin.deleteUser(userId);
};

const signInThroughUi = async (page: import('@playwright/test').Page, email: string, password: string) => {
  await page.goto('/manage-login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByTestId('creator-login-submit').click();
  await expect(page.getByText('No workspace role assigned for this account.')).toBeVisible();
};

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

  test('same-user refresh preserves drafts while identity changes clear them', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'Draft privacy regression requires local Supabase');
    const firstUser = await createConfirmedUser({ full_name: 'First Google Prefill' });
    const secondUser = await createConfirmedUser({ full_name: 'Second Google Prefill' });
    const signIn = async (user: { email: string; password: string }) => {
      const auth = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await auth.auth.signInWithPassword(user);
      if (error || !data.session) throw error || new Error('Missing local test session');
      return data.session;
    };
    const session = await signIn(firstUser);
    const switchedSession = await signIn(secondUser);

    try {
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
    const refreshSession = async () => page.evaluate(async () => {
      const modulePath = '/src/supabaseClient.ts';
      const { supabase } = await import(modulePath);
      const { error } = await supabase.auth.refreshSession();
      if (error) throw error;
    });

    await setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    await page.goto('/creator/register');
    const contactName = page.locator('#creator-contact-name');
    const creatorName = page.locator('#creator-name');
    const slug = page.locator('#creator-slug');
    const primarySocial = page.getByTestId('creator-primary-social');
    const website = page.locator('#creator-website');
    const note = page.getByTestId('creator-application-note');
    const truthful = page.getByTestId('creator-truthful');
    await expect(contactName).toHaveValue('First Google Prefill');

    await contactName.fill('Private draft owner');
    await creatorName.fill('Private Draft Booth');
    await primarySocial.fill('https://instagram.com/private-draft');
    await website.fill('https://private.example.com');
    await note.fill('Private event plan that must not cross account identities.');
    await truthful.check();

    await refreshSession();
    await page.waitForTimeout(100);
    await expect(contactName).toHaveValue('Private draft owner');
    await expect(creatorName).toHaveValue('Private Draft Booth');
    await expect(slug).toHaveValue('private-draft-booth');
    await expect(primarySocial).toHaveValue('https://instagram.com/private-draft');
    await expect(website).toHaveValue('https://private.example.com');
    await expect(note).toHaveValue('Private event plan that must not cross account identities.');
    await expect(truthful).toBeChecked();

    await setSession({
      access_token: switchedSession.access_token,
      refresh_token: switchedSession.refresh_token,
    });
    await expect(page.getByText(secondUser.email)).toBeVisible();
    await expect(contactName).toHaveValue('Second Google Prefill');
    await expect(creatorName).toHaveValue('');
    await expect(slug).toHaveValue('');
    await expect(primarySocial).toHaveValue('');
    await expect(website).toHaveValue('');
    await expect(note).toHaveValue('');
    await expect(truthful).not.toBeChecked();

    await contactName.fill('Second private owner');
    await creatorName.fill('Second Private Booth');
    await note.fill('Another private event draft that must be cleared on sign-out.');
    await truthful.check();
    await signOut();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(contactName).toHaveValue('');
    await expect(creatorName).toHaveValue('');
    await expect(slug).toHaveValue('');
    await expect(note).toHaveValue('');
    await expect(truthful).not.toBeChecked();
    } finally {
      await cleanupUser(firstUser.userId);
      await cleanupUser(secondUser.userId);
    }
  });

  test('verified authenticated user creates one creator workspace without password fields', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'Local Supabase service key is required');
    if (!service) throw new Error('Local Supabase service key is required');
    const user = await createConfirmedUser();
    const slug = `google-${randomUUID().slice(0, 8)}`;

    try {
      await signInThroughUi(page, user.email, user.password);
      await page.getByRole('link', { name: 'Apply as a creator with this account' }).click();

      await expect(page.getByText(user.email)).toBeVisible();
      await expect(page.locator('#creator-password')).toHaveCount(0);
      await expect(page.locator('#creator-email')).toHaveCount(0);

      await page.locator('#creator-contact-name').fill('Google Creator');
      await page.locator('#creator-name').fill('Google Pilot Booth');
      await page.locator('#creator-slug').fill(slug);
      await page.getByTestId('creator-primary-social').fill('https://instagram.com/google-pilot');
      await page.getByTestId('creator-application-note').fill('Testing Google creator onboarding for an event booth.');
      await page.getByTestId('creator-truthful').check();
      await page.getByTestId('creator-register-submit').click();

      await expect(page).toHaveURL(/\/manage-events/, { timeout: 20000 });

      const [{ count: artists }, { count: applications }, { count: owners }] = await Promise.all([
        service.from('artists').select('*', { count: 'exact', head: true }).eq('id', user.userId),
        service.from('creator_applications').select('*', { count: 'exact', head: true }).eq('auth_user_id', user.userId),
        service.from('artist_members').select('*', { count: 'exact', head: true }).eq('artist_id', user.userId).eq('role', 'owner'),
      ]);
      expect({ artists, applications, owners }).toEqual({ artists: 1, applications: 1, owners: 1 });
    } finally {
      await cleanupUser(user.userId);
    }
  });

  test('duplicate email signup gives neutral login and reset guidance', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'Local Supabase service key is required');
    const user = await createConfirmedUser();

    try {
      await page.goto('/creator/register');
      await page.getByLabel('Email').fill(user.email);
      await page.locator('#creator-password').fill(user.password);
      await page.getByLabel('Confirm password').fill(user.password);
      await page.getByLabel('Contact name').fill('Existing Creator');
      await page.getByLabel('Creator / shop name').fill('Existing Pilot Booth');
      await page.getByLabel('Desired URL slug').fill(`existing-${randomUUID().slice(0, 8)}`);
      await page.getByTestId('creator-primary-social').fill('https://instagram.com/existing-pilot');
      await page.getByTestId('creator-application-note').fill('Testing neutral duplicate account recovery guidance.');
      await page.getByTestId('creator-truthful').check();
      await page.getByTestId('creator-register-submit').click();

      await expect(page.getByRole('heading', { name: 'Check your email or sign in' })).toBeVisible();
      await expect(page.getByText('Already used this email? Go to login and choose Forgot password.')).toBeVisible();
      await expect(page.getByText('No second account is created for an existing confirmed email.')).toBeVisible();
    } finally {
      await cleanupUser(user.userId);
    }
  });
});
