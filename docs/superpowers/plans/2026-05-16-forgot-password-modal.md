# Forgot Password Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move creator / manager password recovery into a dedicated modal with its own blank email field and modal-local feedback.

**Architecture:** Keep the existing Supabase recovery call and `/reset-password` redirect, but separate the recovery state from the login form state inside `ManageLogin`. Add a small modal UI driven by dedicated state so opening, closing, and login-mode switching can reset the flow cleanly.

**Tech Stack:** React, TypeScript, Supabase Auth, Playwright regression/security tests

---

## File Map

- `src/pages/ManageLogin.tsx`
  - Add modal state, isolated reset-email state, open/close/reset helpers, and modal UI.
- `src/i18n.tsx`
  - Add any new translated strings required for modal title, helper copy, and actions if existing keys are insufficient.
- `src/tests/regression/regression.spec.ts`
  - Verify modal open/close behavior, blank default email, and staff-mode dismissal.
- `src/tests/security.extend.spec.ts`
  - Update forgot-password security coverage to submit through the modal while preserving neutral feedback expectations.
- `src/tests/e2e/pages/LoginPage.ts`
  - Add modal locators/helpers if the tests use the page object.

### Task 1: Add modal-specific regression coverage

**Files:**
- Modify: `src/tests/regression/regression.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
test('Forgot password opens a blank reset modal', async ({ page }) => {
  await page.fill('#login-email', 'creator@example.com');
  await page.getByRole('button', { name: 'Forgot password?' }).click();

  await expect(page.getByRole('dialog', { name: 'Reset password' })).toBeVisible();
  await expect(page.getByLabel('Reset email')).toHaveValue('');
});

test('Switching to staff closes the reset modal', async ({ page }) => {
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByRole('tab', { name: 'Staff' }).click();

  await expect(page.getByRole('dialog', { name: 'Reset password' })).toHaveCount(0);
});
```

- [ ] **Step 2: Run focused tests**

```bash
npx playwright test src/tests/regression/regression.spec.ts --grep "Forgot password opens a blank reset modal|Switching to staff closes the reset modal"
```

Expected: FAIL because the modal does not exist yet.

### Task 2: Implement modal state and UI

**Files:**
- Modify: `src/pages/ManageLogin.tsx`
- Modify if needed: `src/i18n.tsx`

- [ ] **Step 1: Add dedicated modal state**

```ts
const [isResetModalOpen, setIsResetModalOpen] = useState(false);
const [resetEmail, setResetEmail] = useState('');
const [resetErrorMsg, setResetErrorMsg] = useState<string | null>(null);
```

- [ ] **Step 2: Add open/close helpers**

```ts
const resetPasswordModalState = () => {
  setResetEmail('');
  setResetErrorMsg(null);
  setResetMsg(null);
  setResetLoading(false);
};

const openResetModal = () => {
  resetPasswordModalState();
  setIsResetModalOpen(true);
};

const closeResetModal = () => {
  setIsResetModalOpen(false);
  resetPasswordModalState();
};
```

- [ ] **Step 3: Move reset submission to modal-local email**

Use:

```ts
const normalizedEmail = resetEmail.trim().toLowerCase();
```

and show the required-email message through `resetErrorMsg` instead of the page-level `errorMsg`.

- [ ] **Step 4: Render the modal**

Use `role="dialog"`, `aria-modal="true"`, and an accessible label of `Reset password`.

Required visible pieces:

```tsx
<h3>Reset password</h3>
<p>Enter your creator or manager email and we'll send a reset link.</p>
<label htmlFor="reset-email">Reset email</label>
<input id="reset-email" type="email" ... />
<Button>Cancel</Button>
<Button>Send reset link</Button>
```

- [ ] **Step 5: Wire `Forgot password?` to open the modal**

Replace the direct reset handler on the login form with:

```tsx
onClick={openResetModal}
```

- [ ] **Step 6: Close the modal on staff-mode switch**

Inside `switchLoginMode`, when `nextMode === 'staff'`, call `closeResetModal()`.

- [ ] **Step 7: Run focused regression tests**

```bash
npx playwright test src/tests/regression/regression.spec.ts --grep "Forgot password opens a blank reset modal|Switching to staff closes the reset modal"
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/pages/ManageLogin.tsx src/i18n.tsx src/tests/regression/regression.spec.ts
git commit -m "Move password reset into dedicated modal"
```

### Task 3: Preserve neutral password-reset security behavior

**Files:**
- Modify: `src/tests/security.extend.spec.ts`
- Modify if needed: `src/tests/e2e/pages/LoginPage.ts`

- [ ] **Step 1: Update security tests to use modal email**

Expected interaction:

```ts
await page.getByRole('button', { name: 'Forgot password?' }).click();
await page.getByLabel('Reset email').fill('nobody@example.com');
await page.getByRole('button', { name: 'Send reset link' }).click();
await expect(page.getByText('If an account exists for this email, a password reset link has been sent.')).toBeVisible();
```

- [ ] **Step 2: Update page-object helpers if used**

Add locators/helpers such as:

```ts
get resetEmailInput() {
  return this.page.getByLabel('Reset email');
}

get sendResetLinkButton() {
  return this.page.getByRole('button', { name: 'Send reset link' });
}
```

- [ ] **Step 3: Run focused security coverage**

```bash
npx playwright test src/tests/security.extend.spec.ts --grep "password reset"
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/tests/security.extend.spec.ts src/tests/e2e/pages/LoginPage.ts
git commit -m "Update reset password coverage for modal flow"
```

### Task 4: Verify blank-email validation stays inside the modal

**Files:**
- Modify: `src/tests/regression/regression.spec.ts`

- [ ] **Step 1: Add failing validation test**

```ts
test('Reset modal requires its own email before sending', async ({ page }) => {
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByRole('button', { name: 'Send reset link' }).click();

  await expect(page.getByText('Please enter your creator or manager email first.')).toBeVisible();
});
```

- [ ] **Step 2: Run focused test**

```bash
npx playwright test src/tests/regression/regression.spec.ts --grep "Reset modal requires its own email before sending"
```

Expected: PASS once the modal implementation is correct.

- [ ] **Step 3: Commit**

```bash
git add src/tests/regression/regression.spec.ts
git commit -m "Cover reset modal validation"
```

### Task 5: Integrated verification

**Files:**
- Verify only

- [ ] **Step 1: Build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 2: Run focused regression/security suites**

```bash
npx playwright test src/tests/regression/regression.spec.ts src/tests/security.extend.spec.ts --grep "Forgot password|Reset modal|password reset"
```

Expected: PASS.

- [ ] **Step 3: Manually verify visible behavior**

Check:

1. `/manage-login`
2. open modal from creator / manager mode
3. type login email first, then open modal and confirm modal input remains blank
4. switch to staff mode and confirm modal disappears

### Task 6: Final cleanup

**Files:**
- Review touched files

- [ ] **Step 1: Search for reset behavior coupled to login email**

```bash
rg -n "resetPasswordForEmail|passwordResetEmailRequired|Forgot password" src/pages/ManageLogin.tsx src/tests
```

Expected: reset submission uses modal-local state, tests target modal flow.

- [ ] **Step 2: Review diff**

```bash
git diff --stat HEAD~4..HEAD
git diff HEAD~4..HEAD
```

Expected: only modal UI, translations if needed, and focused tests changed.
