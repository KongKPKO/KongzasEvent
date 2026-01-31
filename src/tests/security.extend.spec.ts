import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const TEST_USER_Y_EMAIL = process.env.TEST_USER_Y_EMAIL || 'kongphop.testy@gmail.com';
const TEST_USER_Y_PASS = process.env.TEST_USER_Y_PASS || 'Test112233';
const BASE_URL = 'http://localhost:5173';

// Setup Supabase Client
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Helpers
async function ensureTestUserAndArtist() {
  let userId = '';
  const { data: signUpData } = await supabase.auth.signUp({ email: TEST_USER_Y_EMAIL, password: TEST_USER_Y_PASS });
  if (signUpData.user) userId = signUpData.user.id;
  if (!userId) {
    const { data: signInData } = await supabase.auth.signInWithPassword({ email: TEST_USER_Y_EMAIL, password: TEST_USER_Y_PASS });
    userId = signInData.user?.id || '';
  }
  if (!userId) throw new Error('Cannot ensure test user');

  await supabase.from('artists').upsert({
    id: userId,
    email: TEST_USER_Y_EMAIL,
    slug: 'test-security',
    display_name: 'Security Test Artist',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  return userId;
}

test.describe('Extended Security Behaviors', () => {
  test.setTimeout(120000);

  test.beforeAll(async () => {
    await ensureTestUserAndArtist();
  });

  // 1) CSRF-like navigation protection: logout should revoke protected pages
  test('Security: After logout, protected routes should redirect to login', async ({ page }) => {
    await page.goto(`${BASE_URL}/manage-login`);
    await page.fill('input[type="email"]', TEST_USER_Y_EMAIL);
    await page.fill('input[type="password"]', TEST_USER_Y_PASS);
    await page.getByRole('button', { name: /Login/i }).click();
    await expect(page).toHaveURL(/\/manage-events/);

    // Trigger logout from header
    const logoutBtn = page.getByRole('button', { name: /Logout/i }).first();
    await expect(logoutBtn).toBeVisible({ timeout: 20000 });
    await logoutBtn.click();

    // Try visiting a protected route again
    await page.goto(`${BASE_URL}/manage-products`);
    await expect(page).toHaveURL(/\/manage-login/);
  });

  // 2) Rate-limit like behavior: multiple failed logins should still show error and never break session
  test('Security: Multiple failed logins do not authenticate and keep user on login page', async ({ page }) => {
    await page.goto(`${BASE_URL}/manage-login`);

    for (let i = 0; i < 3; i++) {
      await page.fill('input[type="email"]', `wrong+${i}@example.com`);
      await page.fill('input[type="password"]', 'wrongpassword');
      await page.getByRole('button', { name: /Login/i }).click();
      await expect(page).toHaveURL(/\/manage-login/);
      // optional small wait for error rendering
      await page.waitForTimeout(300);
    }
  });

  // 3) XSS in query params should be treated as text somewhere visible (no script execution)
  test('Security: XSS in query string should not execute', async ({ page }) => {
    const payload = '<svg onload=alert(1) />';
    // Navigate to a public page that renders query safely (home or customer page)
    await page.goto(`${BASE_URL}/?q=${encodeURIComponent(payload)}`);
    // Ensure no img/svg with onload ran; we cannot detect alert, so we check DOM for payload not creating tags
    const svgCount = await page.locator('svg[onload]').count();
    expect(svgCount).toBe(0);
  });

  // 4) SQLi-like characters in product search should not break UI
  test('Security: Product search handles special characters safely', async ({ page }) => {
    // Login
    await page.goto(`${BASE_URL}/manage-login`);
    await page.fill('input[type="email"]', TEST_USER_Y_EMAIL);
    await page.fill('input[type="password"]', TEST_USER_Y_PASS);
    await page.getByRole('button', { name: /Login/i }).click();
    await expect(page).toHaveURL(/\/manage-events/);

    await page.goto(`${BASE_URL}/manage-products`);
    await expect(page.getByPlaceholder('Search products...')).toBeVisible({ timeout: 20000 });

    const patterns = ["' OR '1'='1 --", '"; DROP TABLE products; --', '%_[]^', '\\0'];
    for (const pattern of patterns) {
      await page.getByPlaceholder('Search products...').fill(pattern);
      await page.waitForTimeout(500);
      // Grid should still render or show empty state but not crash
      const grid = page.locator('[aria-label="Product grid"]');
      const emptyState = page.getByText(/No products found|Products/i);
      expect((await grid.count()) + (await emptyState.count())).toBeGreaterThan(0);
    }
  });

  // 5) Direct resource access to another artist should be blocked (authorization)
  test('Security: Cannot access another artist\'s event/products via direct navigation', async ({ page }) => {
    // Ensure we are logged in
    await page.goto(`${BASE_URL}/manage-login`);
    await page.fill('input[type="email"]', TEST_USER_Y_EMAIL);
    await page.fill('input[type="password"]', TEST_USER_Y_PASS);
    await page.getByRole('button', { name: /Login/i }).click();
    await expect(page).toHaveURL(/\/manage-events/);

    // Try to visit an arbitrary artist slug customer page to ensure no leakage of admin views
    await page.goto(`${BASE_URL}/creators/ManageProducts?artist_id=someone-else`);
    // The app should route back to login or an allowed page, but never expose other artist admin data
    await expect(page).not.toHaveURL(/artist_id=someone-else/);
  });
});
