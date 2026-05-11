import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

const {
  url: SUPABASE_URL,
  serviceKey: SERVICE_KEY,
} = resolveSupabaseTestEnv();

const service = SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY) : null;
const publicArtistId = randomUUID();
const publicEventId = randomUUID();
const publicProductId = randomUUID();
const privateArtistId = randomUUID();
const publicSlug = `public-smoke-${Date.now()}`;
const privateSlug = `private-smoke-${Date.now()}`;

const seedPublicRouteFixtures = async () => {
  if (!service) return;

  const now = new Date();
  const start = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const end = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

  await service.from('artists').insert([
    {
      id: publicArtistId,
      slug: publicSlug,
      display_name: 'Public Smoke Artist',
      bio: 'Anonymous route smoke artist',
      email: `${publicSlug}@example.com`,
      is_public: true,
      is_verified: true,
      published_at: now.toISOString(),
    },
    {
      id: privateArtistId,
      slug: privateSlug,
      display_name: 'Private Smoke Artist',
      email: `${privateSlug}@example.com`,
      is_public: false,
      is_verified: false,
    },
  ]);

  await service.from('events').insert({
    id: publicEventId,
    artist_id: publicArtistId,
    event_name: 'Anonymous Booth Smoke Event',
    start_date: start,
    end_date: end,
    status: 'Confirmed',
    is_booth_open: true,
    event_timezone: 'Asia/Bangkok',
  });

  await service.from('products').insert({
    id: publicProductId,
    artist_id: publicArtistId,
    name: 'Anonymous Smoke Product',
    price: 99,
    status: 'enable',
    currency: 'THB',
    is_unlimited: true,
  });
};

const cleanupPublicRouteFixtures = async () => {
  if (!service) return;
  await service.from('products').delete().eq('id', publicProductId);
  await service.from('events').delete().eq('id', publicEventId);
  await service.from('artists').delete().in('id', [publicArtistId, privateArtistId]);
};

test.describe('Public Nireq smoke', () => {
  test.beforeAll(async () => {
    test.skip(!service, 'Supabase service key is required to seed public route smoke fixtures');
    await cleanupPublicRouteFixtures();
    await seedPublicRouteFixtures();
  });

  test.afterAll(async () => {
    await cleanupPublicRouteFixtures();
  });

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

  test('customer home and menu work anonymously for intentionally public artists', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.removeItem('nireq-language'));
    await page.context().clearCookies();

    await page.goto(`/${publicSlug}/home`);
    await expect(page.getByRole('heading', { name: 'Public Smoke Artist' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Anonymous Booth Smoke Event' })).toBeVisible();

    await page.goto(`/${publicSlug}/menu`);

    await expect(page.getByRole('button', { name: /switch language/i })).toBeVisible();
    await expect(page.getByText('Queue Number', { exact: true })).toBeVisible();
    await expect(page.getByText('Anonymous Smoke Product')).toBeVisible();

    await page.getByRole('button', { name: /switch language/i }).click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'th');
    await expect(page.getByText('หมายเลขคิว', { exact: true })).toBeVisible();
    await expect(page.getByText('สินค้า').first()).toBeVisible();
  });

  test('private creator slug remains hidden from anonymous public routes', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.removeItem('nireq-language'));
    await page.context().clearCookies();
    await page.goto(`/${privateSlug}/home`);

    await expect(page.getByRole('heading', { name: 'Creator not found' })).toBeVisible();
    await expect(page.getByText(privateSlug)).toBeVisible();
  });

  test('unknown creator slug shows a not found state', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.removeItem('nireq-language'));
    await page.goto('/missing-creator-smoke/home');

    await expect(page.getByRole('heading', { name: 'Creator not found' })).toBeVisible();
    await expect(page.getByText('missing-creator-smoke')).toBeVisible();
    await expect(page.getByRole('link', { name: /Browse creators/ })).toBeVisible();
  });
});
