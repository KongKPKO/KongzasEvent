# Google Auth Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Creator Login and Creator Signup a recognizable white Google button with the official Google G logo without changing authentication behavior.

**Architecture:** Keep the two existing OAuth handlers and button call sites. Add one local image asset, use the existing secondary button variant on Manage Login to prevent the primary gradient from overriding the white surface, and mirror the same explicit styling on Creator Register.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, existing `Button` component, Playwright.

---

### Task 1: Add failing visual-contract assertions

**Files:**
- Modify: `src/tests/creator-google-auth.spec.ts:68-94`

- [ ] **Step 1: Assert that both Google buttons contain the local logo**

Add the marked assertions to the existing login and signup tests:

```ts
const googleLoginButton = page.getByRole('button', { name: 'Continue with Google' });
await expect(googleLoginButton).toBeVisible();
await expect(googleLoginButton.getByTestId('google-auth-logo')).toBeVisible();

// On /creator/register:
const googleSignupButton = page.getByRole('button', { name: 'Continue with Google' });
await expect(googleSignupButton.getByTestId('google-auth-logo')).toBeVisible();
```

- [ ] **Step 2: Run the focused test and verify the new assertions fail**

Run:

```bash
npx playwright test src/tests/creator-google-auth.spec.ts --project=desktop-chromium --grep "Google login stays|creator signup starts"
```

Expected: FAIL because `google-auth-logo` does not exist yet.

### Task 2: Add the official logo and update both buttons

**Files:**
- Create: `public/google-g-logo.svg`
- Modify: `src/pages/ManageLogin.tsx:358-366`
- Modify: `src/pages/CreatorRegister.tsx:375-384`

- [ ] **Step 1: Store the official Google G asset locally**

Run:

```bash
curl -L --fail --silent --show-error \
  https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg \
  -o public/google-g-logo.svg
```

Confirm the file begins with SVG markup and contains no script:

```bash
head -n 2 public/google-g-logo.svg
rg -n "<script|javascript:" public/google-g-logo.svg
```

Expected: SVG markup is shown; `rg` returns no matches.

- [ ] **Step 2: Update the Manage Login button**

Replace the existing Google `Button` with:

```tsx
<Button
  type="button"
  variant="secondary"
  onClick={() => void handleGoogleLogin()}
  disabled={googleLoading}
  className="min-h-12 w-full border-gray-300 bg-white px-4 py-3 font-black text-gray-900 shadow-none hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:opacity-60"
>
  <img
    src="/google-g-logo.svg"
    alt=""
    aria-hidden="true"
    data-testid="google-auth-logo"
    className="h-5 w-5 shrink-0"
  />
  {googleLoading ? t('loginSubmitting') : t('continueWithGoogle')}
</Button>
```

- [ ] **Step 3: Update the Creator Signup button**

Replace the existing Google button with:

```tsx
<button
  type="button"
  onClick={() => void handleGoogleSignup()}
  disabled={googleLoading}
  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-black text-gray-900 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:opacity-60"
>
  <img
    src="/google-g-logo.svg"
    alt=""
    aria-hidden="true"
    data-testid="google-auth-logo"
    className="h-5 w-5 shrink-0"
  />
  {googleLoading ? t('loginSubmitting') : t('continueWithGoogle')}
</button>
```

- [ ] **Step 4: Run the focused Google auth tests**

Run:

```bash
npx playwright test src/tests/creator-google-auth.spec.ts --project=desktop-chromium --project=mobile-android-chrome-pixel5
```

Expected: all Creator Google auth tests pass on desktop and Pixel 5.

- [ ] **Step 5: Commit the implementation**

```bash
git add public/google-g-logo.svg src/pages/ManageLogin.tsx src/pages/CreatorRegister.tsx src/tests/creator-google-auth.spec.ts
git commit -m "style: add branded Google auth buttons"
```

### Task 3: Visual QA and release verification

**Files:**
- Create: `design-qa.md`
- Modify only if a confirmed visual issue is found: `src/pages/ManageLogin.tsx`, `src/pages/CreatorRegister.tsx`

- [ ] **Step 1: Start the existing local app**

Run:

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

Expected: Vite serves the existing app at `http://127.0.0.1:5173`.

- [ ] **Step 2: Capture matching desktop and Pixel 5 states**

Open `/manage-login` and `/creator/register`. Confirm the logo is 20px, the button is white with a subtle border, its text stays centered as a logo-and-label group, its touch target is at least 48px, and Staff mode contains no Google button.

- [ ] **Step 3: Record the visual comparison**

Create `design-qa.md` with the compared routes, viewports, findings, and `final result: passed`. Fix only P0-P2 mismatches before marking it passed.

- [ ] **Step 4: Run the full repository verification**

Run:

```bash
npm run verify
```

Expected: lint and the release suite pass.

- [ ] **Step 5: Review the diff and commit QA evidence**

```bash
git diff --check
git diff --stat HEAD~1
git add design-qa.md
git commit -m "test: verify Google auth button design"
```
