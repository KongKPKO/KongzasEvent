import type { Page } from '@playwright/test';

export async function selectLanguage(page: Page, language: 'th' | 'en') {
  await page.getByRole('button', { name: /^(Language|ภาษา)$/ }).first().click();
  await page.getByRole('menuitemradio', { name: language === 'th' ? 'TH · ไทย' : 'EN · English', exact: true }).click();
}
