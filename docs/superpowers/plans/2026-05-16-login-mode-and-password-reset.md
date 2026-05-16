# Login Mode And Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate creator/manager and staff login flows on `/manage-login`, and add a creator/manager password reset entry point that uses the existing reset page.

**Architecture:** Keep the work inside the existing login surface rather than creating new auth pages. `ManageLogin.tsx` owns login mode state, reset-email submission, and flow-specific rendering; `i18n.tsx` owns new copy; tests assert mode visibility and reset entry behavior.

**Tech Stack:** React, TypeScript, React Router, Supabase Auth, Playwright

---

## File Structure

- Modify `src/pages/ManageLogin.tsx`
  - Add login mode state, segmented control UI, creator forgot-password flow, and mode-specific rendering.
- Modify `src/i18n.tsx`
  - Add English and Thai copy for creator/manager login, staff login, forgot-password text, and reset-email feedback.
- Modify `src/tests/e2e/pages/LoginPage.ts`
  - Add reusable locators/helpers for the new mode switcher and forgot-password link.
- Modify `src/tests/regression/regression.spec.ts`
  - Cover default creator mode, staff mode switching, and forgot-password visibility.
- Modify `src/tests/security.extend.spec.ts`
  - Verify the reset request flow does not expose account existence in UI messaging.

### Task 1: Add Login Copy

**Files:**
- Modify: `src/i18n.tsx`

- [ ] **Step 1: Add English strings**

Add keys for:

```ts
creatorManagerLoginTitle: 'Creator / Manager Login',
staffLoginTitle: 'Staff Login',
forgotPassword: 'Forgot password?',
sendPasswordReset: 'Send reset link',
passwordResetSentNeutral: 'If an account exists for this email, a password reset link has been sent.',
passwordResetEmailRequired: 'Enter your email first.',
```

- [ ] **Step 2: Add Thai strings**

Add corresponding Thai strings:

```ts
creatorManagerLoginTitle: 'เข้าสู่ระบบครีเอเตอร์ / ผู้จัดการ',
staffLoginTitle: 'เข้าสู่ระบบทีมงาน',
forgotPassword: 'ลืมรหัสผ่าน?',
sendPasswordReset: 'ส่งลิงก์รีเซ็ตรหัสผ่าน',
passwordResetSentNeutral: 'หากมีบัญชีนี้อยู่ ระบบได้ส่งลิงก์รีเซ็ตรหัสผ่านแล้ว',
passwordResetEmailRequired: 'กรอกอีเมลก่อน',
```

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run build
```

Expected: PASS with no missing translation key/type errors.

- [ ] **Step 4: Commit**

```bash
git add src/i18n.tsx
git commit -m "Add login mode and password reset copy"
```

### Task 2: Build Login Mode UI

**Files:**
- Modify: `src/pages/ManageLogin.tsx`

- [ ] **Step 1: Write the mode state**

Add:

```ts
type LoginMode = 'creator' | 'staff';
const [loginMode, setLoginMode] = useState<LoginMode>('creator');
```

When mode changes, clear flow-specific success/error messages so the next mode starts clean.

- [ ] **Step 2: Render the segmented control**

Add a two-option control near the top of the card:

```tsx
<div role="tablist" aria-label="Login mode">
  <button type="button" aria-selected={loginMode === 'creator'}>Creator / Manager</button>
  <button type="button" aria-selected={loginMode === 'staff'}>Staff</button>
</div>
```

Use the app's existing visual style: restrained, compact, and matching the current pink/gray palette.

- [ ] **Step 3: Split the rendered content by mode**

Render only one branch at a time:

```tsx
{loginMode === 'creator' ? (
  // email, password, forgot password, login button
) : (
  // staff explanation, staff email, magic-link button
)}
```

Keep the outer secondary access links visible outside the card.

- [ ] **Step 4: Run the page manually**

Run:

```bash
npm run dev
```

Open `/manage-login` and confirm:

- Creator/manager is selected by default.
- Staff section is hidden initially.
- Switching to Staff hides creator fields and reveals only the staff flow.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ManageLogin.tsx
git commit -m "Separate creator and staff login modes"
```

### Task 3: Add Forgot Password Flow

**Files:**
- Modify: `src/pages/ManageLogin.tsx`

- [ ] **Step 1: Add reset state**

Add dedicated state:

```ts
const [resetLoading, setResetLoading] = useState(false);
const [resetMessage, setResetMessage] = useState('');
```

- [ ] **Step 2: Implement the handler**

Add:

```ts
const handleForgotPassword = async () => {
  if (!email.trim()) {
    setErrorMsg(t('passwordResetEmailRequired'));
    return;
  }

  setResetLoading(true);
  setErrorMsg('');
  setResetMessage('');

  try {
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetMessage(t('passwordResetSentNeutral'));
  } finally {
    setResetLoading(false);
  }
};
```

Do not vary the visible success copy based on whether Supabase reports a known user.

- [ ] **Step 3: Add the creator-only control**

Render `Forgot password?` only in creator mode, below the password field and aligned to the right. After click, show neutral confirmation feedback in the creator flow.

- [ ] **Step 4: Verify route integration**

Confirm `/reset-password` is already registered in `src/App.tsx` and no routing change is needed.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ManageLogin.tsx
git commit -m "Add creator password reset entry point"
```

### Task 4: Extend Login Page Test Helpers

**Files:**
- Modify: `src/tests/e2e/pages/LoginPage.ts`

- [ ] **Step 1: Add locators**

Add helper accessors for:

```ts
creatorModeButton
staffModeButton
forgotPasswordLink
staffMagicLinkButton
```

- [ ] **Step 2: Add mode helpers**

Add methods:

```ts
async switchToStaffMode() { ... }
async switchToCreatorMode() { ... }
```

- [ ] **Step 3: Run any page-object dependent tests**

Run the relevant Playwright subset already using `LoginPage`.

- [ ] **Step 4: Commit**

```bash
git add src/tests/e2e/pages/LoginPage.ts
git commit -m "Extend login page test helpers"
```

### Task 5: Add Regression Coverage

**Files:**
- Modify: `src/tests/regression/regression.spec.ts`

- [ ] **Step 1: Add default-mode test**

Verify:

```ts
await page.goto('/manage-login');
await expect(page.getByText('Creator / Manager Login')).toBeVisible();
await expect(page.getByText('Staff Login')).not.toBeVisible();
await expect(page.getByText('Forgot password?')).toBeVisible();
```

- [ ] **Step 2: Add staff-switch test**

Verify:

```ts
await page.getByRole('button', { name: 'Staff' }).click();
await expect(page.getByText('Staff Login')).toBeVisible();
await expect(page.getByText('Creator / Manager Login')).not.toBeVisible();
await expect(page.getByText('Forgot password?')).not.toBeVisible();
```

- [ ] **Step 3: Run regression subset**

Run:

```bash
npx playwright test src/tests/regression/regression.spec.ts --grep "login"
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/tests/regression/regression.spec.ts
git commit -m "Cover login mode switching"
```

### Task 6: Add Password Reset Security Coverage

**Files:**
- Modify: `src/tests/security.extend.spec.ts`

- [ ] **Step 1: Add reset feedback test**

Mock or intercept the reset-password request and verify both known/unknown-looking email input paths show the same neutral confirmation text:

```ts
await page.goto('/manage-login');
await page.getByLabel('Email').fill('unknown@example.com');
await page.getByText('Forgot password?').click();
await expect(page.getByText(/If an account exists for this email/i)).toBeVisible();
```

- [ ] **Step 2: Add empty-email validation test**

Verify clicking `Forgot password?` with no email shows `Enter your email first.`

- [ ] **Step 3: Run security subset**

Run:

```bash
npx playwright test src/tests/security.extend.spec.ts --grep "password reset"
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/tests/security.extend.spec.ts
git commit -m "Cover password reset feedback"
```

### Task 7: Final Verification

**Files:**
- Verify only

- [ ] **Step 1: Run build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 2: Run focused tests**

```bash
npx playwright test src/tests/regression/regression.spec.ts src/tests/security.extend.spec.ts --grep "login|password reset"
```

Expected: PASS.

- [ ] **Step 3: Manually verify both modes**

Check:

- creator mode default
- creator login UI
- forgot-password feedback
- staff mode UI
- staff magic-link UI
- external supporting links remain visible

- [ ] **Step 4: Commit if any cleanup was needed**

```bash
git add .
git commit -m "Polish login mode and reset flow"
```
