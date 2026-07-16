import { expect, test } from '@playwright/test';

test.describe('Production readiness public UX', () => {
  test('legal pages are public and linked from creator login', async ({ page }) => {
    for (const [path, heading] of [
      ['/privacy', 'นโยบายความเป็นส่วนตัว'],
      ['/terms', 'ข้อกำหนดการใช้งาน'],
      ['/cookies', 'การใช้คุกกี้และพื้นที่จัดเก็บ'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.getByRole('link', { name: 'kongphop.sunit@gmail.com' })).toBeVisible();
    }

    await page.goto('/manage-login');
    await expect(page.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    await expect(page.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    await expect(page.getByRole('link', { name: 'Cookies' })).toHaveAttribute('href', '/cookies');
  });

  test('password recovery dialog traps focus, closes on Escape, and restores focus', async ({ page }) => {
    await page.goto('/manage-login');
    const opener = page.getByRole('button', { name: /forgot password|ลืมรหัสผ่าน/i });
    await opener.click();

    const dialog = page.getByRole('dialog', { name: 'Reset password' });
    await expect(dialog).toBeVisible();
    const email = dialog.getByLabel('Reset email');
    await expect(email).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Send reset link' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(email).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
});
