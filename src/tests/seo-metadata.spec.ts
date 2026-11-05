import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getSeoDetails } from '../lib/seo';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';

test('public canonical URLs use Paimon and private or preview pages are not indexed', () => {
  expect(getSeoDetails('/discover', 'en', 'paimonq.com')).toMatchObject({ canonical: 'https://paimonq.com/', noindex: false });
  expect(getSeoDetails('/a-shop', 'th', 'paimonq.com', 'ร้านตัวอย่าง')).toMatchObject({ canonical: 'https://paimonq.com/a-shop/home', noindex: false, title: 'ร้านตัวอย่าง · หน้าร้าน | Paimon' });
  expect(getSeoDetails('/manage-art', 'en', 'paimonq.com')).toMatchObject({ canonical: 'https://paimonq.com/manage-art/home', noindex: false });
  expect(getSeoDetails('/manage-art/home', 'en', 'paimonq.com')).toMatchObject({ canonical: 'https://paimonq.com/manage-art/home', noindex: false });
  expect(getSeoDetails('/manage-products', 'en', 'paimonq.com').noindex).toBe(true);
  expect(getSeoDetails('/manage-events/home', 'en', 'paimonq.com').noindex).toBe(true);
  expect(getSeoDetails('/creator/register', 'en', 'paimonq.com').noindex).toBe(true);
  expect(getSeoDetails('/for-sellers', 'en', 'paimonq.com').noindex).toBe(false);
  expect(getSeoDetails('/a-shop/menu', 'en', 'paimonq.com').canonical).toBe('https://paimonq.com/a-shop/menu');
  expect(getSeoDetails('/a-shop/campaign/sale', 'en', 'paimonq.com').canonical).toBe('https://paimonq.com/a-shop/campaign/sale');
  expect(getSeoDetails('/a-shop/campaign/sale', 'en', 'paimonq.com', 'Sale', '  Public\n campaign  ').description).toBe('Public campaign');
  expect(getSeoDetails('/a-shop/campaign/sale', 'en', 'paimonq.com', 'Sale', 'x'.repeat(200)).description).toHaveLength(160);
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
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://paimonq.com/pwa-512x512.png');
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary');
  expect(JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() || '{}')).toMatchObject({ '@type': 'WebSite', name: 'Paimon', url: 'https://paimonq.com/' });
  await page.goto('/privacy');
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://paimonq.com/privacy');
  await expect(page).toHaveTitle(/Privacy policy|นโยบายความเป็นส่วนตัว/);
  await page.goto('/nonexistent-seo-fixture-23841/home');
  await expect(page.getByRole('heading', { name: /Shop not found|ไม่พบร้าน/ })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('meta[property="og:image"]')).toHaveCount(0);
  await page.goto('/nonexistent-seo-fixture-23841/campaign/unknown');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});

test('sitemap and robots allow public manage-prefixed shops while excluding signup', async ({ request }) => {
  const robots = await (await request.get('/robots.txt')).text();
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(robots).not.toContain('Disallow: /manage-');
  expect(robots).not.toContain('Disallow: /live/');
  expect(robots).not.toContain('Disallow: /admin/');
  expect(sitemap).toContain('https://paimonq.com/for-sellers');
  expect(sitemap).not.toContain('/creator/register');
});

test('hosting sends noindex headers for private routes without hiding public shop slugs', () => {
  const config = JSON.parse(readFileSync('firebase.prod.json', 'utf8'));
  const rule = config.hosting.headers.find((entry: { regex?: string }) => entry.regex?.includes('manage-events'));
  const pattern = new RegExp(rule.regex);
  for (const path of ['/manage-products', '/manage-events/event/catalog', '/live/pos', '/creator/register', '/shop/queue', '/shop/order/code']) expect(pattern.test(path), path).toBe(true);
  for (const path of ['/', '/for-sellers', '/manage-art/home', '/manage-products/home', '/help/guide']) expect(pattern.test(path), path).toBe(false);
  expect(rule.headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex, nofollow' });
  const preview = JSON.parse(readFileSync('firebase.json', 'utf8'));
  expect(preview.hosting.headers.some((entry: { source?: string; headers: Array<{ key: string; value: string }> }) => entry.source === '**' && entry.headers.some(header => header.key === 'X-Robots-Tag' && header.value === 'noindex, nofollow'))).toBe(true);
});

test('shop metadata requires publication even when its owner is signed in', async ({ page }) => {
  const id = randomUUID();
  const slug = `seo-${id.slice(0, 8)}`;
  const email = `seo-${id}@example.test`;
  const password = 'LocalSeoOwner123!';
  const { service, userId } = await ensureOwnerArtistFixture({ email, password, slug, displayName: 'SEO fixture' });
  try {
    const draft = await service.from('artists').update({ is_public: false, bio: 'A public shop description' }).eq('id', userId);
    if (draft.error) throw draft.error;
    await page.goto('/manage-login');
    await page.locator('input[type=email]').fill(email);
    await page.locator('input[type=password]').fill(password);
    await page.getByRole('button', { name: /Login/i }).click();
    await expect(page).not.toHaveURL(/manage-login/);
    await page.goto(`/${slug}/home`);
    await expect(page.getByRole('heading', { name: 'SEO fixture' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    const published = await service.from('artists').update({ is_public: true }).eq('id', userId);
    if (published.error) throw published.error;
    await page.reload();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'A public shop description');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://paimonq.com/${slug}/home`);
  } finally {
    const deleted = await service.auth.admin.deleteUser(userId);
    if (deleted.error) throw deleted.error;
  }
});
