import { test, expect } from '@playwright/test';

test('Escape closes nested select before dialog and restores focus', async ({ page }) => {
  await page.goto('/src/tests/fixtures/phase4-dialog/');
  const open = page.getByRole('button', { name: 'Open dialog' });
  await open.focus();
  await open.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Test dialog' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Test select' }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
});
