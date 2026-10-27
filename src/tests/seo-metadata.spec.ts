import { expect, test } from '@playwright/test';
import { getSeoDetails } from '../lib/seo';

test('public canonical URLs use Paimon and private or preview pages are not indexed', () => {
  expect(getSeoDetails('/discover', 'en', 'paimonq.com')).toMatchObject({ canonical: 'https://paimonq.com/', noindex: false });
  expect(getSeoDetails('/a-shop', 'th', 'paimonq.com', 'ร้านตัวอย่าง')).toMatchObject({ canonical: 'https://paimonq.com/a-shop/home', noindex: false, title: 'ร้านตัวอย่าง · หน้าร้าน | Paimon' });
  expect(getSeoDetails('/a-shop/menu', 'en', 'paimonq.com').canonical).toBe('https://paimonq.com/a-shop/menu');
  expect(getSeoDetails('/a-shop/campaign/sale', 'en', 'paimonq.com').canonical).toBe('https://paimonq.com/a-shop/campaign/sale');
  for (const path of ['/manage-products', '/live/queue', '/admin/support', '/a-shop/order/private-code', '/a-shop/queue']) {
    expect(getSeoDetails(path, 'en', 'paimonq.com')).toMatchObject({ noindex: true, canonical: null });
  }
  expect(getSeoDetails('/', 'en', 'nireqapp--dev.web.app')).toMatchObject({ noindex: true, canonical: null });
  expect(() => getSeoDetails('/%invalid', 'en', 'paimonq.com')).not.toThrow();
});

test('rendered metadata follows navigation and missing shops are not indexed', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Discover shops and events|ค้นหาร้านค้าและอีเวนต์/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://paimonq.com/');
  await page.goto('/privacy');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://paimonq.com/privacy');
  await expect(page).toHaveTitle(/Privacy policy|นโยบายความเป็นส่วนตัว/);
  await page.goto('/nonexistent-seo-fixture-23841/home');
  await expect(page.getByRole('heading', { name: /Shop not found|ไม่พบร้าน/ })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await page.goto('/nonexistent-seo-fixture-23841/campaign/unknown');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});
