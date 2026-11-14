import { expect, type Page } from '@playwright/test';

export async function selectLanguage(page: Page, language: 'th' | 'en') {
  const toggle = page.getByRole('button', { name: /^(Language|ภาษา):/ }).first();
  const menu = page.getByRole('button', { name: /^(Open workspace menu|เปิดเมนู)$/ });
  await expect(async () => {
    if (!await toggle.isVisible()) await menu.click({ timeout: 1000 });
    await toggle.click({ timeout: 1000 });
  }).toPass({ timeout: 10000 });
  await page.getByRole('menuitemradio', { name: language === 'th' ? 'TH · ไทย' : 'EN · English', exact: true }).click();
}
