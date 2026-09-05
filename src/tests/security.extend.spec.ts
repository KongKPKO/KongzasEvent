import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

const TEST_USER_Y_EMAIL = process.env.TEST_USER_Y_EMAIL || 'local-user-y@example.com';
const TEST_USER_Y_PASS = process.env.TEST_USER_Y_PASS || 'LocalOnlyUserYPassword123!';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';

// Setup Supabase Client
const { url: SUPABASE_URL, anonKey: SUPABASE_KEY, serviceKey: SERVICE_KEY } = resolveSupabaseTestEnv();
const service = createClient(SUPABASE_URL, SERVICE_KEY || SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Helpers
async function ensureTestUserAndArtist() {
  const { userId } = await ensureOwnerArtistFixture({
    email: TEST_USER_Y_EMAIL,
    password: TEST_USER_Y_PASS,
    slug: 'test-security',
    displayName: 'Security Test Artist',
  });
  return userId;
}

async function clickSignOut(page: import('@playwright/test').Page) {
  const signOut = page.getByRole('button', { name: /Sign out|Logout|ออกจากระบบ/i }).first();
  try {
    await expect(signOut).toBeVisible({ timeout: 20000 });
    await signOut.click();
    return;
  } catch {
    // Mobile layouts keep sign out inside the workspace menu.
  }

  const menuButton = page.getByRole('button', { name: /Open workspace menu/i }).first();
  await expect(menuButton).toBeVisible({ timeout: 20000 });
  await menuButton.click();
  await page.getByRole('button', { name: /Sign out|Logout|ออกจากระบบ/i }).first().click();
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

    // Trigger logout from header or responsive workspace menu
    await clickSignOut(page);
    await expect(page).toHaveURL(/\/manage-login/, { timeout: 10000 });

    // Try visiting a protected route again. Some mobile WebKit runs redirect so
    // quickly that Playwright reports the protected navigation as interrupted.
    await page.goto(`${BASE_URL}/manage-products`).catch((error) => {
      if (!String(error).includes('interrupted by another navigation')) throw error;
    });
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

  test('Security: Password reset feedback is neutral and validates missing email', async ({ page }) => {
    await page.goto(`${BASE_URL}/manage-login`);

    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await expect(page.getByRole('dialog', { name: 'Reset password' })).toBeVisible();

    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText('Please enter your creator or manager email first.')).toBeVisible();

    await page.getByLabel('Reset email').fill('unknown@example.com');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('dialog', { name: 'Reset password' }).getByText(/If an account exists for this email/i)).toBeVisible();
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
    const search = page.getByPlaceholder(/Search products|ค้นหาสินค้า/);
    await expect(search).toBeVisible({ timeout: 20000 });

    const patterns = ["' OR '1'='1 --", '"; DROP TABLE products; --', '%_[]^', '\\0'];
    for (const pattern of patterns) {
      await search.fill(pattern);
      await page.waitForTimeout(500);
      // Catalog workspace should stay rendered after hostile-looking input.
      await expect(page.getByRole('heading', { name: /Product catalog|คลังสินค้า/ })).toBeVisible();
      await expect(page.getByText(/\d+ of \d+ products|\d+ จาก \d+ รายการ/)).toBeVisible();
    }
  });

  // 5) Direct resource access to another artist should be blocked (authorization)
  test('Security: Cannot access another artist\'s event dashboard via direct navigation', async ({ page }) => {
    // Ensure we are logged in
    await page.goto(`${BASE_URL}/manage-login`);
    await page.fill('input[type="email"]', TEST_USER_Y_EMAIL);
    await page.fill('input[type="password"]', TEST_USER_Y_PASS);
    await page.getByRole('button', { name: /Login/i }).click();
    await expect(page).toHaveURL(/\/manage-events/);

    const foreignArtistId = randomUUID();
    const foreignEventId = randomUUID();
    const suffix = foreignArtistId.slice(0, 8);

    try {
      expect((await service.from('artists').insert({
        id: foreignArtistId,
        email: `foreign-${suffix}@example.com`,
        slug: `foreign-${suffix}`,
        display_name: 'Foreign Event Route Guard',
        is_public: true,
        is_verified: true,
        published_at: new Date().toISOString(),
      })).error).toBeNull();
      expect((await service.from('events').insert({
        id: foreignEventId,
        artist_id: foreignArtistId,
        event_name: 'Foreign Public Event Metadata',
        start_date: new Date(Date.now() - 60_000).toISOString(),
        end_date: new Date(Date.now() + 3_600_000).toISOString(),
        status: 'Confirmed',
      })).error).toBeNull();

      await page.goto(`${BASE_URL}/manage-events/${foreignEventId}/dashboard`);
      await expect(page).toHaveURL(`${BASE_URL}/manage-events`);
      await expect(page.getByText('Foreign Public Event Metadata')).toHaveCount(0);
    } finally {
      await service.from('events').delete().eq('id', foreignEventId);
      await service.from('artists').delete().eq('id', foreignArtistId);
    }
  });

  test('Event catalog requires an explicit first save before POS use', async ({ page }) => {
    const userId = await ensureTestUserAndArtist();
    const eventId = randomUUID();
    const productId = randomUUID();

    try {
      expect((await service.from('products').insert({
        id: productId,
        artist_id: userId,
        name: 'Unsaved Catalog Regression Product',
        price: 100,
        currency: 'THB',
        status: 'enable',
        is_unlimited: false,
        stock_total: 5,
      })).error).toBeNull();
      expect((await service.from('events').insert({
        id: eventId,
        artist_id: userId,
        event_name: 'Unsaved Catalog Regression Event',
        start_date: new Date(Date.now() + 3_600_000).toISOString(),
        end_date: new Date(Date.now() + 7_200_000).toISOString(),
        status: 'Confirmed',
      })).error).toBeNull();

      await page.goto(`${BASE_URL}/manage-login`);
      await page.fill('input[type="email"]', TEST_USER_Y_EMAIL);
      await page.fill('input[type="password"]', TEST_USER_Y_PASS);
      await page.getByRole('button', { name: /Login/i }).click();
      await expect(page).toHaveURL(/\/manage-events/);

      await page.goto(`${BASE_URL}/manage-events/${eventId}/catalog`);
      const save = page.getByRole('button', { name: 'Save Changes', exact: true });
      await expect(save).toBeVisible({ timeout: 20000 });
      await save.click();
      await expect.poll(async () => {
        const persisted = await service
          .from('event_products')
          .select('id')
          .eq('event_id', eventId)
          .eq('product_id', productId)
          .maybeSingle();
        expect(persisted.error).toBeNull();
        return persisted.data?.id;
      }, { timeout: 20000 }).toBeTruthy();
    } finally {
      await service.from('event_products').delete().eq('event_id', eventId);
      await service.from('events').delete().eq('id', eventId);
      await service.from('products').delete().eq('id', productId);
    }
  });
});
