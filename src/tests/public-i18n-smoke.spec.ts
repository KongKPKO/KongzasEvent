import { expect, test } from '@playwright/test';

test.describe('Public Nireq smoke', () => {
  test('home supports discovery locators and language switching', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.removeItem('nireq-language'));
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /Find creator booths|ค้นหาบูธครีเอเตอร์/i })).toBeVisible();
    await expect(page.getByTestId('public-creator-search')).toBeVisible();
    await expect(page.getByTestId('public-discovery')).toBeVisible();

    await page.getByRole('button', { name: /switch language|เปลี่ยนภาษา/i }).click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'th');
    await expect(page.getByRole('heading', { name: /ค้นหาบูธครีเอเตอร์/ })).toBeVisible();
    await expect(page.getByText(/Mobile Test Artist|Security Test Artist|Performance/i)).toHaveCount(0);
  });

  test('creator application form exposes stable fields and validation', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.removeItem('nireq-language'));
    await page.goto('/creator/register');

    await expect(page.getByTestId('creator-register-form')).toBeVisible();
    await expect(page.locator('#creator-email')).toBeVisible();
    await expect(page.locator('#creator-slug')).toBeVisible();
    await expect(page.getByTestId('creator-primary-social')).toBeVisible();

    const submit = page.getByTestId('creator-register-submit');
    await expect(submit).toBeDisabled();
    await expect(submit).toContainText(/Complete required fields|กรอกข้อมูลจำเป็นให้ครบ/);
  });

  test('customer menu exposes the language switcher and translates old UI text', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.removeItem('nireq-language'));
    await page.goto('/konglnwzas/menu');

    await expect(page.getByRole('button', { name: /switch language/i })).toBeVisible();
    await expect(page.getByText('Queue Number', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /switch language/i }).click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'th');
    await expect(page.getByText('หมายเลขคิว', { exact: true })).toBeVisible();
    await expect(page.getByText('สินค้า').first()).toBeVisible();
  });

  test('unknown creator slug shows a not found state', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.removeItem('nireq-language'));
    await page.goto('/missing-creator-smoke/home');

    await expect(page.getByRole('heading', { name: 'Creator not found' })).toBeVisible();
    await expect(page.getByText('missing-creator-smoke')).toBeVisible();
    await expect(page.getByRole('link', { name: /Browse creators/ })).toBeVisible();
  });
});
