# Manager Invitation Signup Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe the legacy `/staff-signup` flow as manager-only invitation signup while removing the obsolete public staff-account entry point from login.

**Architecture:** Keep the existing route and auth behavior intact for backward compatibility, and change only the presentation layer plus manager invitation messaging. Login remains the shared entry point for creator/manager password login and staff magic-link login, while manager account creation becomes invitation-driven only.

**Tech Stack:** React, TypeScript, React Router, Supabase Edge Functions, Playwright regression tests

---

## File Map

- `src/pages/ManageLogin.tsx`
  - Remove the public footer link that suggests invited staff should create accounts.
- `src/pages/StaffSignup.tsx`
  - Reword the existing invitation signup screen to be manager-specific while preserving behavior and route compatibility.
- `src/pages/creators/ManageTeam.tsx`
  - Update the manager invitation success message to describe manager account creation correctly.
- `supabase/functions/notify-team-invitation/index.ts`
  - Update manager invitation email CTA/body copy from staff-account language to manager-account language.
- `src/tests/regression/regression.spec.ts`
  - Cover login footer visibility and manager-specific signup copy.
- `src/tests/e2e/pages/LoginPage.ts`
  - Remove stale helper expectations if they still reference the old footer link.

### Task 1: Remove the obsolete staff-account entry point from login

**Files:**
- Modify: `src/pages/ManageLogin.tsx`
- Test: `src/tests/regression/regression.spec.ts`

- [ ] **Step 1: Write the failing regression test**

```ts
test('manage login does not expose public staff account creation link', async ({ page }) => {
  await page.goto('/manage-login');
  await expect(page.getByText('Invited as staff?')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Create a staff account' })).toHaveCount(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx playwright test src/tests/regression/regression.spec.ts --grep "does not expose public staff account creation link"
```

Expected: FAIL because the legacy footer link is still rendered.

- [ ] **Step 3: Remove the obsolete footer block**

Delete the `Invited as staff? Create a staff account` footer from `ManageLogin`.

- [ ] **Step 4: Re-run the focused test**

Run:

```bash
npx playwright test src/tests/regression/regression.spec.ts --grep "does not expose public staff account creation link"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ManageLogin.tsx src/tests/regression/regression.spec.ts
git commit -m "Remove public staff signup entry point from login"
```

### Task 2: Reframe invitation signup UI as manager-only

**Files:**
- Modify: `src/pages/StaffSignup.tsx`
- Test: `src/tests/regression/regression.spec.ts`

- [ ] **Step 1: Write the failing regression test**

```ts
test('manager invitation signup uses manager-specific copy', async ({ page }) => {
  await page.goto('/staff-signup?email=manager@example.com&workspace=NireQ');
  await expect(page.getByRole('heading', { name: 'Create Manager Account' })).toBeVisible();
  await expect(page.getByText(/manager invitation/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create manager account' })).toBeVisible();
});
```

- [ ] **Step 2: Run the focused test**

Run:

```bash
npx playwright test src/tests/regression/regression.spec.ts --grep "manager invitation signup uses manager-specific copy"
```

Expected: FAIL because the screen still says `Create Staff Account`.

- [ ] **Step 3: Update visible copy without changing behavior**

Replace:

```tsx
<h1>Create Staff Account</h1>
```

with:

```tsx
<h1>Create Manager Account</h1>
```

Use manager-specific language in the workspace paragraph, fallback paragraph, error fallback, and submit button:

```tsx
You've been invited to join {workspaceName} as a manager. Create a manager account with this email to accept the workspace invitation.
This account is only for accepting a manager invitation. It will not create a creator profile or public booth page.
Could not create manager account.
Create manager account
```

- [ ] **Step 4: Re-run the focused test**

Run:

```bash
npx playwright test src/tests/regression/regression.spec.ts --grep "manager invitation signup uses manager-specific copy"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/StaffSignup.tsx src/tests/regression/regression.spec.ts
git commit -m "Reframe invitation signup as manager account creation"
```

### Task 3: Correct manager invitation confirmation copy

**Files:**
- Modify: `src/pages/creators/ManageTeam.tsx`
- Test: `src/tests/regression/regression.spec.ts`

- [ ] **Step 1: Write or update a focused assertion**

Add an assertion to the existing manager invitation regression coverage that expects:

```ts
await expect(page.getByText('Manager invitation sent. They can create a password-based manager account without a creator profile.')).toBeVisible();
```

- [ ] **Step 2: Run the focused test**

Run:

```bash
npx playwright test src/tests/regression/regression.spec.ts --grep "manager invitation"
```

Expected: FAIL because the message still says `password staff account`.

- [ ] **Step 3: Update the success message**

Replace:

```ts
Manager invitation sent. They can create a password staff account without a creator profile.
```

with:

```ts
Manager invitation sent. They can create a password-based manager account without a creator profile.
```

- [ ] **Step 4: Re-run the focused test**

Run:

```bash
npx playwright test src/tests/regression/regression.spec.ts --grep "manager invitation"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/creators/ManageTeam.tsx src/tests/regression/regression.spec.ts
git commit -m "Clarify manager invitation success copy"
```

### Task 4: Update manager invitation email copy

**Files:**
- Modify: `supabase/functions/notify-team-invitation/index.ts`

- [ ] **Step 1: Add direct string expectations near the email builder tests if available**

If the existing test suite already covers invitation email rendering, extend it with assertions for:

```ts
expect(html).toContain('create a manager account');
expect(html).toContain('Create manager account');
expect(text).toContain('create a manager account');
```

If no direct test harness exists yet, keep this change scoped to the edge function and verify with source inspection plus build/typecheck.

- [ ] **Step 2: Update email body and CTA copy**

Change:

```ts
create a staff account
Create staff account
```

to:

```ts
create a manager account
Create manager account
```

Apply this to both the HTML and plain-text builders.

- [ ] **Step 3: Run available verification**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/notify-team-invitation/index.ts
git commit -m "Update manager invitation email copy"
```

### Task 5: Remove stale page-object references

**Files:**
- Modify: `src/tests/e2e/pages/LoginPage.ts`

- [ ] **Step 1: Inspect helper methods**

Look for any helper that targets:

```ts
Create a staff account
```

- [ ] **Step 2: Remove or update the stale helper**

Delete only references that are no longer part of the public login page contract.

- [ ] **Step 3: Run the login-focused regression tests**

Run:

```bash
npx playwright test src/tests/regression/regression.spec.ts --grep "manage login"
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/tests/e2e/pages/LoginPage.ts
git commit -m "Remove stale login page object reference"
```

### Task 6: Run integrated verification

**Files:**
- Verify only

- [ ] **Step 1: Build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 2: Run focused regression coverage**

```bash
npx playwright test src/tests/regression/regression.spec.ts --grep "manage login|manager invitation signup|manager invitation"
```

Expected: PASS.

- [ ] **Step 3: Manually verify the three visible surfaces**

Check:

1. `/manage-login`
2. `/staff-signup?email=manager@example.com&workspace=NireQ`
3. manager invite feedback in Team management

Expected:

- no public `Create a staff account` link on login
- invitation signup screen is manager-specific
- manager invite success copy is manager-specific

### Task 7: Final cleanup and commit hygiene

**Files:**
- Review all touched files

- [ ] **Step 1: Search for stale wording**

```bash
rg -n "Create staff account|password staff account|create a staff account" src supabase
```

Expected: no stale manager-facing occurrences remain.

- [ ] **Step 2: Review diff**

```bash
git diff --stat HEAD~5..HEAD
git diff HEAD~5..HEAD
```

Expected: only login, invitation signup, team copy, email copy, and tests changed.

- [ ] **Step 3: Commit any final polish if needed**

```bash
git add <files>
git commit -m "Polish manager invitation wording"
```
