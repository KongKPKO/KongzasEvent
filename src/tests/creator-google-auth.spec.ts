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
});
