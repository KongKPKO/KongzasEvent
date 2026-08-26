# Creator Google Signup And Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google-first creator signup and Google creator login while preserving email/password fallback, database-backed roles, guest customer flows, and same-email automatic identity linking.

**Architecture:** Reuse the existing browser Supabase client, session listeners, creator metadata contract, and idempotent `complete_verified_creator_signup()` RPC. Google authenticates before the creator form; authenticated onboarding then updates the existing signup metadata and invokes the existing completion path. No new OAuth library, onboarding draft table, authorization claim, or schema migration is planned.

**Tech Stack:** React 18, TypeScript, React Router 6, `@supabase/supabase-js` 2.x, Supabase Auth/Postgres, Playwright, Vite, Firebase Hosting

---

## File Map

- Create `src/tests/creator-google-auth.spec.ts`: focused Google initiation, authenticated creator onboarding, recovery-copy, and no-workspace tests.
- Create `src/utils/authRedirect.ts`: shared parsing for OAuth errors returned in query parameters or URL fragments.
- Modify `src/pages/ManageLogin.tsx`: Google login action and contextual creator-application recovery.
- Modify `src/pages/CreatorRegister.tsx`: Google-first entry, authenticated form state, authenticated completion, and neutral duplicate-email recovery copy.
- Modify `src/i18n.tsx`: Thai and English copy for Google auth, same-email limitation, authenticated onboarding, and recovery states.
- Modify `supabase/config.toml`: local Google provider configuration using environment-backed credentials.
- Modify `.env.example`: document local Google OAuth variable names without values.
- No database migration is expected. If the existing RPC proves insufficient, stop and obtain approval for a separate append-only migration instead of changing schema opportunistically.

### Task 1: Add Google Login To The Creator Portal

**Files:**
- Create: `src/tests/creator-google-auth.spec.ts`
- Create: `src/utils/authRedirect.ts`
- Modify: `src/pages/ManageLogin.tsx`
- Modify: `src/i18n.tsx`

- [ ] **Step 1: Write the failing Google login initiation test**

Create `src/tests/creator-google-auth.spec.ts` with:

```ts
import { expect, test } from '@playwright/test';

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
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npx playwright test src/tests/creator-google-auth.spec.ts --project=desktop-chromium
```

Expected: FAIL because `Continue with Google` does not exist.

- [ ] **Step 3: Add the bilingual login copy**

Add these keys to both language objects in `src/i18n.tsx`:

```ts
// English
continueWithGoogle: 'Continue with Google',
orUseEmail: 'or use email',
googleSameEmailHint: 'Already have a Nireq account? Choose the Google account with the same email. Linking different emails is not supported yet.',
googleLoginFailed: 'Google sign-in could not start. Try again or use email.',
loginApplyAsCreator: 'Apply as a creator with this account',

// Thai
continueWithGoogle: 'ดำเนินการต่อด้วย Google',
orUseEmail: 'หรือใช้อีเมล',
googleSameEmailHint: 'มีบัญชี Nireq แล้ว? เลือก Google ที่ใช้อีเมลเดียวกัน ขณะนี้ยังไม่รองรับการเชื่อมคนละอีเมล',
googleLoginFailed: 'เริ่มเข้าสู่ระบบด้วย Google ไม่สำเร็จ ลองใหม่หรือใช้อีเมล',
loginApplyAsCreator: 'สมัครเป็น Creator ด้วยบัญชีนี้',
```

- [ ] **Step 4: Add one shared OAuth redirect-error parser**

Create `src/utils/authRedirect.ts`:

```ts
export const getAuthRedirectError = () => {
  if (typeof window === 'undefined') return null;

  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const raw = query.get('error_description')
    || hash.get('error_description')
    || query.get('error')
    || hash.get('error');

  return raw ? raw.replace(/\+/g, ' ') : null;
};
```

Import `getAuthRedirectError` in `ManageLogin` and replace its query-only initialization:

```tsx
const [errorMsg, setErrorMsg] = useState<string | null>(() => {
  const authError = getAuthRedirectError();
  if (!authError) return null;
  if (/expired|invalid/i.test(authError)) {
    return 'This email link is expired or invalid. Return to registration to resend confirmation, or reset your password if the account is already confirmed.';
  }
  return authError;
});
```

- [ ] **Step 5: Add the minimal OAuth handler to `ManageLogin`**

Add state and a handler inside `ManageLogin`:

```tsx
const [googleLoading, setGoogleLoading] = useState(false);
const [showCreatorApply, setShowCreatorApply] = useState(false);

const handleGoogleLogin = async () => {
  setGoogleLoading(true);
  setShowCreatorApply(false);
  setErrorMsg(null);

  const next = redirectTo?.startsWith('/') && !redirectTo.startsWith('//')
    ? `?redirect=${encodeURIComponent(redirectTo)}`
    : '';
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/manage-login${next}`,
    },
  });

  if (error) {
    setErrorMsg(t('googleLoginFailed'));
    setGoogleLoading(false);
  }
};
```

In the existing no-role branch of `routeAfterAuth`, set the recovery state:

```tsx
} else if (!isAdmin) {
  setShowCreatorApply(true);
  setErrorMsg(t('loginNoWorkspace'));
}
```

Render the Google action only in creator mode, above the email/password form:

```tsx
{loginMode === 'creator' && (
  <div className="mb-5 space-y-3">
    <Button
      type="button"
      onClick={() => void handleGoogleLogin()}
      disabled={googleLoading}
      className="w-full border border-gray-300 bg-white py-3 font-black text-gray-900 hover:bg-gray-50"
    >
      {googleLoading ? t('loginSubmitting') : t('continueWithGoogle')}
    </Button>
    <p className="text-xs leading-5 text-gray-500">{t('googleSameEmailHint')}</p>
    <div className="flex items-center gap-3 text-xs font-bold text-gray-400">
      <span className="h-px flex-1 bg-gray-200" />
      {t('orUseEmail')}
      <span className="h-px flex-1 bg-gray-200" />
    </div>
  </div>
)}
```

Render the contextual recovery action beside the no-workspace feedback:

```tsx
{showCreatorApply && (
  <Link
    to="/creator/register"
    className="mb-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-gray-900 px-4 py-3 text-sm font-black text-white"
  >
    {t('loginApplyAsCreator')}
  </Link>
)}
```

Reset `showCreatorApply` when login mode changes or a new password login begins.

- [ ] **Step 6: Run the focused login tests**

Run:

```bash
npx playwright test src/tests/creator-google-auth.spec.ts --project=desktop-chromium
```

Expected: 3 tests PASS. The authorize request may be aborted intentionally after its URL is asserted.

- [ ] **Step 7: Run existing login regressions**

Run:

```bash
npx playwright test src/tests/regression/regression.spec.ts --project=desktop-chromium --grep "Login defaults|Forgot password|Manage login"
```

Expected: existing creator/staff switching and password recovery tests PASS.

- [ ] **Step 8: Commit the login slice**

```bash
git add src/pages/ManageLogin.tsx src/i18n.tsx src/tests/creator-google-auth.spec.ts src/utils/authRedirect.ts
git commit -m "feat: add creator Google login"
```

### Task 2: Add Google-First Authenticated Creator Registration

**Files:**
- Modify: `src/pages/CreatorRegister.tsx`
- Modify: `src/i18n.tsx`
- Modify: `src/tests/creator-google-auth.spec.ts`

- [ ] **Step 1: Add the failing Google signup initiation test**

Append inside the existing test describe:

```ts
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
```

- [ ] **Step 2: Run the signup initiation test and verify it fails**

Run:

```bash
npx playwright test src/tests/creator-google-auth.spec.ts --project=desktop-chromium --grep "signup starts"
```

Expected: FAIL because the Google signup action does not exist.

- [ ] **Step 3: Add authenticated-session state to `CreatorRegister`**

Update imports:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { completePendingVerifiedCreatorSignup, fetchActorContext } from '../utils/access';
import { getAuthRedirectError } from '../utils/authRedirect';
```

Replace the existing error-state initialization:

```tsx
const [errorMsg, setErrorMsg] = useState<string | null>(() => getAuthRedirectError());
```

Add state and session synchronization:

```tsx
const navigate = useNavigate();
const [authUser, setAuthUser] = useState<User | null>(null);
const [authLoading, setAuthLoading] = useState(true);
const [googleLoading, setGoogleLoading] = useState(false);

useEffect(() => {
  let active = true;

  const applySessionUser = async (user: User | null) => {
    if (!active) return;
    setAuthUser(user);
    setAuthLoading(false);
    if (!user) return;

    const actor = await fetchActorContext();
    if (!active) return;
    if (actor) {
      navigate('/manage-login', { replace: true });
      return;
    }

    setForm((current) => ({
      ...current,
      email: user.email || '',
      contactName: current.contactName || String(user.user_metadata?.full_name || user.user_metadata?.name || ''),
    }));
  };

  void supabase.auth.getSession().then(({ data }) => applySessionUser(data.session?.user || null));
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    void applySessionUser(session?.user || null);
  });

  return () => {
    active = false;
    subscription.unsubscribe();
  };
}, [navigate]);
```

This check uses database actor context only to avoid a duplicate creator application. Platform admins without a creator workspace still receive the form.

- [ ] **Step 4: Add the Google signup handler and Google-first entry**

Add:

```tsx
const handleGoogleSignup = async () => {
  setGoogleLoading(true);
  setErrorMsg(null);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/creator/register`,
    },
  });
  if (error) {
    setErrorMsg(t('googleLoginFailed'));
    setGoogleLoading(false);
  }
};
```

Above the form fields, render Google only when unauthenticated:

```tsx
{!authLoading && !authUser && (
  <div className="mb-6 space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
    <button
      type="button"
      onClick={() => void handleGoogleSignup()}
      disabled={googleLoading}
      className="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-black text-gray-900 hover:bg-gray-50"
    >
      {googleLoading ? t('loginSubmitting') : t('continueWithGoogle')}
    </button>
    <p className="text-xs leading-5 text-gray-500">{t('googleSameEmailHint')}</p>
    <div className="flex items-center gap-3 text-xs font-bold text-gray-400">
      <span className="h-px flex-1 bg-gray-200" />
      {t('orUseEmail')}
      <span className="h-px flex-1 bg-gray-200" />
    </div>
  </div>
)}
```

Render authenticated identity instead of editable email/password fields:

```tsx
{authUser ? (
  <div className="md:col-span-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
    <p className="text-xs font-black uppercase tracking-wide text-emerald-800">{t('registerSignedInAs')}</p>
    <p className="mt-1 break-all text-sm font-bold text-gray-900">{authUser.email}</p>
  </div>
) : (
  <>
    <Field label={t('registerEmail')} required>
      <IconInput id="creator-email" name="email" icon={<Mail size={17} />} type="email" autoComplete="email" value={form.email} onChange={(value) => updateField('email', value)} placeholder={t('registerEmailPlaceholder')} />
    </Field>
    <Field label={t('registerPassword')} required hint={t('registerPasswordHint')}>
      <IconInput id="creator-password" name="password" icon={<Lock size={17} />} type="password" autoComplete="new-password" value={form.password} onChange={(value) => updateField('password', value)} placeholder={t('registerPasswordPlaceholder')} />
    </Field>
    <Field label={t('registerConfirmPassword')} required>
      <IconInput id="creator-confirm-password" name="confirmPassword" icon={<Lock size={17} />} type="password" autoComplete="new-password" value={form.confirmPassword} onChange={(value) => updateField('confirmPassword', value)} placeholder={t('registerConfirmPasswordPlaceholder')} />
    </Field>
  </>
)}
<Field label={t('registerContactName')} required>
  <IconInput id="creator-contact-name" name="contactName" icon={<UserRound size={17} />} value={form.contactName} onChange={(value) => updateField('contactName', value)} placeholder={t('registerContactNamePlaceholder')} />
</Field>
```

Add translations:

```ts
// English
registerSignedInAs: 'Signed in as',
registerSubmitAuthenticated: 'Create creator workspace',

// Thai
registerSignedInAs: 'เข้าสู่ระบบด้วย',
registerSubmitAuthenticated: 'สร้าง Creator workspace',
```

- [ ] **Step 5: Make validation conditional on an authenticated session**

Replace the password and submit predicates with:

```tsx
const passwordsMatch = authUser
  ? true
  : form.password.length >= 8 && form.password === form.confirmPassword;

const canSubmit = useMemo(() => (
  form.email.trim().length > 3
  && passwordsMatch
  && form.contactName.trim().length >= 2
  && form.creatorName.trim().length >= 2
  && slugValid
  && hasSocialProof
  && noteValid
  && form.truthful
), [form, hasSocialProof, noteValid, passwordsMatch, slugValid]);
```

Use `t('registerSubmitAuthenticated')` for the enabled submit label when `authUser` exists. Keep the current email/password label for unauthenticated signup.

- [ ] **Step 6: Run Google initiation and public form regressions**

Run:

```bash
npx playwright test src/tests/creator-google-auth.spec.ts src/tests/public-i18n-smoke.spec.ts --project=desktop-chromium
```

Expected: Google initiation and existing anonymous form checks PASS.

- [ ] **Step 7: Commit the Google-first registration UI**

```bash
git add src/pages/CreatorRegister.tsx src/i18n.tsx src/tests/creator-google-auth.spec.ts
git commit -m "feat: add Google-first creator registration"
```

### Task 3: Complete Authenticated Onboarding And Recovery Copy

**Files:**
- Modify: `src/pages/CreatorRegister.tsx`
- Modify: `src/pages/ManageLogin.tsx`
- Modify: `src/i18n.tsx`
- Modify: `src/tests/creator-google-auth.spec.ts`

- [ ] **Step 1: Add local authenticated-user fixture helpers to the focused test**

Add these imports and helpers at file scope:

```ts
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

const { url, serviceKey } = resolveSupabaseTestEnv();
const service = serviceKey ? createClient(url, serviceKey) : null;

const createConfirmedUser = async () => {
  if (!service) throw new Error('Local Supabase service key is required');
  const email = `google-onboarding-${randomUUID()}@example.com`;
  const password = 'CreatorPass123!';
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
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
```

- [ ] **Step 2: Write the failing authenticated onboarding test**

Append:

```ts
test('verified authenticated user creates one creator workspace without password fields', async ({ page }) => {
  test.skip(!serviceKey, 'Local Supabase service key is required');
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
```

- [ ] **Step 3: Run the authenticated onboarding test and verify it fails**

Run:

```bash
npx playwright test src/tests/creator-google-auth.spec.ts --project=desktop-chromium --grep "creates one creator workspace"
```

Expected: FAIL because authenticated registration does not yet update metadata and invoke creator completion.

- [ ] **Step 4: Reuse one metadata object for both signup paths**

Inside `handleSubmit`, build the metadata once after slug validation:

```tsx
const creatorMetadata = {
  creator_signup: 'self_serve',
  creator_name: form.creatorName.trim(),
  contact_name: form.contactName.trim(),
  desired_slug: desiredSlug,
  primary_social_url: form.primarySocialUrl.trim(),
  website_url: normalizeOptionalUrl(form.websiteUrl),
  instagram_url: normalizeOptionalUrl(form.instagramUrl),
  x_url: normalizeOptionalUrl(form.xUrl),
  facebook_url: normalizeOptionalUrl(form.facebookUrl),
  tiktok_url: normalizeOptionalUrl(form.tiktokUrl),
  application_note: form.applicationNote.trim(),
};
```

Pass `creatorMetadata` to the existing email/password `signUp` call instead of repeating its fields.

- [ ] **Step 5: Add the authenticated completion branch**

Before the existing email/password `signUp` call, add:

```tsx
if (authUser) {
  const { error: metadataError } = await supabase.auth.updateUser({
    data: creatorMetadata,
  });
  if (metadataError) throw metadataError;

  const completion = await completePendingVerifiedCreatorSignup();
  if (completion === 'created' || completion === 'exists') {
    navigate('/manage-login', { replace: true });
    return;
  }
  if (completion === 'email_unconfirmed') {
    throw new Error(t('loginConfirmEmailFirst'));
  }
  throw new Error(t('registerErrSubmit'));
}
```

Do not clear the form on failure. `updateUser` may trigger the existing App session listener and race with the explicit completion call; the existing RPC idempotency is the database integrity boundary.

- [ ] **Step 6: Make duplicate-email confirmation and resend copy neutral**

Replace the current confirmation strings with translations:

```ts
// English
registerApplicationReceived: 'Check your email or sign in',
registerApplicationReceivedBody: 'If this is a new email, use the verification link sent to {email}. If the account already exists, sign in or reset its password instead.',
registerApplicationLocked: 'No second account is created for an existing confirmed email.',
registerResendNeutral: 'If this email still needs confirmation, a new link has been requested. Existing confirmed accounts should sign in or reset the password.',
registerResetGuidance: 'Already used this email? Go to login and choose Forgot password.',

// Thai
registerApplicationReceived: 'เช็คอีเมลหรือเข้าสู่ระบบ',
registerApplicationReceivedBody: 'หากเป็นอีเมลใหม่ ให้ใช้ลิงก์ยืนยันที่ส่งไปยัง {email} แต่ถ้ามีบัญชีนี้อยู่แล้ว ให้เข้าสู่ระบบหรือรีเซ็ตรหัสผ่านแทน',
registerApplicationLocked: 'ระบบจะไม่สร้างบัญชีซ้ำให้อีเมลที่ยืนยันแล้ว',
registerResendNeutral: 'หากอีเมลนี้ยังต้องยืนยัน ระบบได้ขอลิงก์ใหม่แล้ว ส่วนบัญชีที่ยืนยันแล้วให้เข้าสู่ระบบหรือรีเซ็ตรหัสผ่าน',
registerResetGuidance: 'เคยใช้อีเมลนี้แล้ว? ไปหน้าเข้าสู่ระบบแล้วเลือก ลืมรหัสผ่าน',
```

Use `t('registerResendNeutral')` after a successful resend request, and render `t('registerResetGuidance')` beside the existing login link. Keep the resend error neutral as well.

- [ ] **Step 7: Run the focused creator auth suite**

Run:

```bash
npx playwright test src/tests/creator-google-auth.spec.ts --project=desktop-chromium
```

Expected: all focused Google initiation, no-workspace recovery, and authenticated onboarding tests PASS.

- [ ] **Step 8: Run the creator signup database regression**

Run:

```bash
supabase test db supabase/tests/creator_signup_idempotency_test.sql
```

Expected: pgTAP suite PASS, proving repeated completion still creates one active application and workspace and remains unavailable to anonymous users.

- [ ] **Step 9: Commit the onboarding slice**

```bash
git add src/pages/CreatorRegister.tsx src/pages/ManageLogin.tsx src/i18n.tsx src/tests/creator-google-auth.spec.ts
git commit -m "feat: complete authenticated creator onboarding"
```

### Task 4: Configure Google OAuth For Local And Hosted Environments

**Files:**
- Modify: `supabase/config.toml`
- Modify: `.env.example`

- [ ] **Step 1: Confirm the current Supabase CLI and provider schema before editing**

Run:

```bash
supabase --version
supabase config --help
curl -fsSL https://supabase.com/changelog.md | rg -i "oauth|google|auth|breaking"
curl -fsSL https://supabase.com/docs/guides/auth/social-login/auth-google.md | sed -n '1,220p'
```

Expected: current docs still use a Google Web client, the Supabase `/auth/v1/callback`, and `signInWithOAuth({ provider: 'google' })`. If the config keys differ, update this task to match the current official guide before editing.

- [ ] **Step 2: Add environment-backed local provider configuration**

Add to `supabase/config.toml`:

```toml
[auth.external.google]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)"
redirect_uri = ""
skip_nonce_check = false
email_optional = false
```

Add names only to `.env.example`:

```dotenv
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET=
```

Never add actual OAuth credentials to `.env.example`, tracked files, logs, or chat.

- [ ] **Step 3: Validate local configuration without printing credentials**

Export the two variables from a secure local source, then run:

```bash
supabase stop
supabase start
supabase status
```

Expected: local Auth is healthy and the CLI reports no missing Google provider configuration. Do not use `--debug` because it may expose configuration values.

- [ ] **Step 4: Commit the configuration contract**

```bash
git add supabase/config.toml .env.example
git commit -m "chore: configure local Google auth"
```

- [ ] **Step 5: Pause for explicit hosted-environment approval**

Before changing Google Cloud, Development Supabase, or Production Supabase, report the exact target and proposed redirect values. No hosted provider mutation is authorized merely by executing earlier plan tasks.

After approval, configure the Google Web client with:

```text
Authorized JavaScript origins:
https://nireqapp.com
https://nireqapp.web.app
https://nireqapp--dev-a3j04cfr.web.app
http://127.0.0.1:5173

Authorized redirect URIs:
https://fnutmjnzugpayccscvgr.supabase.co/auth/v1/callback
https://kdjqitvtxmcrnnpuxuyl.supabase.co/auth/v1/callback
http://127.0.0.1:54321/auth/v1/callback
```

Enable the Google provider in the approved Supabase target using the Google Client ID and Client Secret. Keep different-email manual linking disabled.

### Task 5: Verify Authorization, Real OAuth, And Release Readiness

**Files:**
- Modify only confirmed findings from review; no planned new file

- [ ] **Step 1: Run the focused browser checks across desktop and mobile**

Run:

```bash
npx playwright test src/tests/creator-google-auth.spec.ts --project=desktop-chromium --project=mobile-android-chrome-pixel5
```

Expected: Google actions, authenticated registration, recovery copy, and responsive form behavior PASS.

- [ ] **Step 2: Run auth, authorization, and public-flow regressions**

Run:

```bash
npm run test:security
npx playwright test src/tests/public-i18n-smoke.spec.ts src/tests/production-readiness.spec.ts --project=desktop-chromium
```

Expected: role/RLS checks, guest customer access, bilingual registration, legal links, and password recovery PASS.

- [ ] **Step 3: Run the repository release gate**

Run:

```bash
npm run verify
```

Expected: lint and the local release suite PASS.

- [ ] **Step 4: Review the diff with fresh context**

Run:

```bash
git diff HEAD~4 --check
git diff HEAD~4 -- src/pages/ManageLogin.tsx src/pages/CreatorRegister.tsx src/i18n.tsx src/tests/creator-google-auth.spec.ts supabase/config.toml .env.example
git status --short
```

Confirm:

- no Google secret is present;
- no unrelated user change is staged or modified;
- Google claims do not affect permission decisions;
- different-email manual linking is not exposed;
- customer routes remain account-free;
- every OAuth redirect is an approved Nireq or local URL.

Fix only confirmed findings, rerun the narrow failing check, then rerun `npm run verify`.

- [ ] **Step 5: Run real OAuth in the approved non-Production target**

Through a real browser, verify:

```text
1. New Google email → creator form → one application/workspace/owner membership.
2. Existing verified password account + same Google email → same auth user ID before and after linking.
3. Existing owner/manager → management workspace.
4. Existing seller/queue staff → only the assigned live workspace.
5. Existing platform admin → admin monitor.
6. OAuth cancel/deny → initiating page with no partial application.
7. Different Google email → separate account and visible unsupported-linking guidance.
8. Email/password signup/login, password recovery, and staff magic link still work.
```

Record exact test user IDs before and after same-email linking. Confirm negative permissions through RPC/database behavior, not only redirects. Remove only the isolated test users and creator data after resolving exact IDs.

- [ ] **Step 6: Obtain Production deployment approval**

Report automated results, real Development OAuth evidence, remaining risks, and the exact Production Google/Supabase/Firebase targets. Do not enable the Production provider or deploy until the user explicitly approves those mutations.

- [ ] **Step 7: Commit any verification-only corrections**

If review found no code issue, skip this commit. If it found a confirmed issue, stage only its exact files and commit:

```bash
git add src/pages/ManageLogin.tsx src/pages/CreatorRegister.tsx src/i18n.tsx src/tests/creator-google-auth.spec.ts supabase/config.toml .env.example
git commit -m "fix: close Google auth verification findings"
```
