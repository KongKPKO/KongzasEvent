import { expect, type Page } from '@playwright/test';

export async function expectSignedInAccount(page: Page) {
  const account = page.getByRole('button', { name: /^(Account|บัญชี):/ }).first();
  const workspaceMenu = page.getByRole('button', { name: /Open workspace menu|เปิดเมนูเวิร์กสเปซ/ }).first();
  await expect.poll(async () => await account.isVisible() || await workspaceMenu.isVisible(), { timeout: 20000 }).toBe(true);
}

export async function openAccountMenu(page: Page) {
  const signOut = page.getByRole('button', { name: /^(Sign out|ออกจากระบบ)$/ }).first();
  if (await signOut.isVisible()) return;
  await expectSignedInAccount(page);
  const account = page.getByRole('button', { name: /^(Account|บัญชี):/ }).first();
  if (await account.isVisible()) await account.click();
  else await page.getByRole('button', { name: /Open workspace menu|เปิดเมนูเวิร์กสเปซ/ }).first().click();
  await expect(signOut).toBeVisible();
}
