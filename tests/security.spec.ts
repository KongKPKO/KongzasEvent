import { test, expect } from '@playwright/test';

test.describe('Security Tests', () => {

  test('Unauthenticated user is redirected to login when accessing /admin', async ({ page }) => {
    // 1. Attempt to visit /admin without being logged in
    await page.goto('/admin');

    // 2. Expect redirection to /login
    await expect(page).toHaveURL(/\/login/);

    // 3. Verify Login page elements are present to confirm we are truly on login page
    await expect(page.getByRole('button', { name: 'Login to Dashboard' })).toBeVisible();
  });

  // SKIP: This test verifies a developer backdoor found in RequireAuth.tsx.
  // It is skipped by default to prevent "locking in" a vulnerability in the test suite.
  // Enable this test ONLY when verifying the development environment tools.
  // In a production security scan, this test should ideally be replaced with an assertion that the backdoor does NOT work.
  test.skip('Developer Backdoor Access (Ensure this is DEV only)', async ({ page }) => {
    // 1. Set the backdoor local storage item
    await page.goto('/'); // Go to a safe page first to set storage context
    await page.evaluate(() => {
        localStorage.setItem('test_auth', 'true');
    });

    // 2. Visit /admin
    await page.goto('/admin');

    // 3. Expect to remain on /admin and see the dashboard
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByText('Admin Dashboard')).toBeVisible();
  });

  test('Invalid login credentials show error', async ({ page }) => {
    await page.goto('/login');

    // 1. Enter invalid credentials
    await page.fill('input[type="email"]', 'wrong@example.com');
    await page.fill('input[type="password"]', 'wrongpassword');

    // 2. Click Login
    await page.click('button[type="submit"]');

    // 3. Expect error message
    await expect(page.getByText('Invalid email or password')).toBeVisible({ timeout: 10000 });
  });

  test('Admin controls are hidden from public queue page', async ({ page }) => {
    await page.goto('/queue');

    // 1. Ensure "Call Next" button (admin only) is NOT visible
    await expect(page.getByText('Call Next Ticket')).not.toBeVisible();

    // 2. Ensure "Reset Queue" button is NOT visible
    await expect(page.getByText('Reset Queue')).not.toBeVisible();
  });

  // SKIP: Same as above.
  test.skip('Session persists with backdoor across reloads', async ({ page }) => {
     // 1. Set auth
     await page.goto('/');
     await page.evaluate(() => {
        localStorage.setItem('test_auth', 'true');
    });

    // 2. Go to admin
    await page.goto('/admin');
    await expect(page.getByText('Admin Dashboard')).toBeVisible();

    // 3. Reload
    await page.reload();

    // 4. Still logged in
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByText('Admin Dashboard')).toBeVisible();
  });
});
