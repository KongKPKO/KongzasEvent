import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Production readiness public UX', () => {
  test('Paimon public surfaces retain saved language and remain accessible at mobile and desktop widths', async ({ page }, testInfo) => {
    await page.addInitScript(() => localStorage.setItem('nireq-language', 'th'));
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['/', '/manage-login']) {
        await page.goto(path);
        await expect(page.locator('html')).toHaveAttribute('lang', 'th');
        await expect(page.locator('.brand-wordmark-text').first()).toHaveText('Paimon');
        await expect(page).toHaveTitle(/Paimon/);
        const mark = await page.locator('.brand-wordmark-text').first().evaluate(element => ({ height: element.getBoundingClientRect().height, line: parseFloat(getComputedStyle(element).lineHeight) }));
        expect(mark.height).toBeLessThanOrEqual(mark.line + 1);
        const nav = page.locator('.customer-brand-inner .public-nav-link:visible').last();
        expect(await nav.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        const navigation = await nav.boundingBox();
        const language = await page.locator('.customer-brand-inner button[data-language]').boundingBox();
        expect(navigation!.x + navigation!.width).toBeLessThanOrEqual(language!.x + 1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        expect(result.violations.filter(item => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`paimon-${path === '/' ? 'discovery' : 'login'}-${width}.png`), fullPage: true });
      }
    }
  });

  test('legal pages are public and linked from creator login', async ({ page }) => {
    for (const [path, heading] of [
      ['/privacy', 'Privacy Policy'],
      ['/terms', 'Terms of Service'],
      ['/cookies', 'Cookies & Local Storage'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.getByRole('link', { name: 'konglnwzas@gmail.com' })).toBeVisible();
    }

    await page.goto('/manage-login');
    await expect(page.getByRole('link', { name: 'Privacy', exact: true })).toHaveAttribute('href', '/privacy');
    await expect(page.getByRole('link', { name: 'Terms', exact: true })).toHaveAttribute('href', '/terms');
    await expect(page.getByRole('link', { name: 'Cookies', exact: true })).toHaveAttribute('href', '/cookies');
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
