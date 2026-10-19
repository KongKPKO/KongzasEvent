import { selectLanguage } from './helpers/languageMenu';
import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
  ]).throwOnError();

  await service.from('events').insert({
    id: publicEventId,
    artist_id: publicArtistId,
    event_name: 'Anonymous Booth Smoke Event',
    start_date: start,
    end_date: end,
    status: 'Confirmed',
    is_booth_open: true,
    event_timezone: 'Asia/Bangkok',
  }).throwOnError();

  await service.from('products').insert({
    id: publicProductId,
    artist_id: publicArtistId,
    name: 'Anonymous Smoke Product',
    price: 99,
    status: 'enable',
    currency: 'THB',
    is_unlimited: true,
  }).throwOnError();
};

const cleanupPublicRouteFixtures = async () => {
  if (!service) return;
  await service.from('products').delete().eq('id', publicProductId).throwOnError();
  await service.from('events').delete().eq('id', publicEventId).throwOnError();
  await service.from('artists').delete().in('id', [publicArtistId, privateArtistId]).throwOnError();
};

test.describe('Public Nireq smoke', () => {
  test('home supports discovery locators and language switching', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.removeItem('nireq-language'));
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /Find shops and booths|ค้นหาร้านและบูธ/i })).toBeVisible();
    await expect(page.getByTestId('public-creator-search')).toBeVisible();
    await expect(page.getByTestId('public-discovery')).toBeVisible();

    await selectLanguage(page, 'th');

    await expect(page.locator('html')).toHaveAttribute('lang', 'th');
    const thaiHeading = page.getByRole('heading', { name: /ค้นหาร้านและบูธ/ });
    await expect(thaiHeading).toBeVisible();
    await expect(thaiHeading).toHaveCSS('font-family', /Noto Sans Thai/);
    expect((await thaiHeading.boundingBox())?.height).toBeGreaterThan(0);
    await expect(page.getByText(/Mobile Test Artist|Security Test Artist|Performance/i)).toHaveCount(0);
  });

  test('creator application form exposes stable fields and validation', async ({ page }, testInfo) => {
    await page.addInitScript(() => window.localStorage.removeItem('nireq-language'));
    await page.goto('/creator/register');

    await expect(page.getByTestId('creator-register-form')).toBeVisible();
    await expect(page.locator('#creator-email')).toBeVisible();
    await expect(page.locator('#creator-slug')).toBeVisible();
    await expect(page.getByTestId('creator-primary-social')).toBeVisible();

    const submit = page.getByTestId('creator-register-submit');
    await expect(submit).toBeDisabled();
    await expect(submit).toContainText(/Complete required fields|กรอกข้อมูลจำเป็นให้ครบ/);
    for (const id of ['creator-contact-name', 'creator-name', 'creator-slug', 'creator-primary-social', 'creator-application-note']) await expect(page.locator(`#${id}`)).toHaveValue('');
    await expect(page.locator('.public-slug-prefix')).toHaveText('nireqapp.com/');
    await expect(page.locator('#creator-slug')).toHaveAccessibleName(/Your shop link/);
    await selectLanguage(page, 'th');
    await expect(page.locator('#creator-slug')).toHaveAttribute('placeholder', 'เช่น mali-art');
    await expect(page.locator('#creator-slug')).toHaveAccessibleName(/ลิงก์ร้านของคุณ/);
    const colors = await page.locator('#creator-name').evaluate(element => ({ value: getComputedStyle(element).color, placeholder: getComputedStyle(element, '::placeholder').color }));
    expect(colors.placeholder).not.toBe(colors.value);
    await page.locator('#creator-name').fill('Mali Art');
    await expect(page.locator('#creator-slug')).toHaveValue('mali-art');
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const input = await page.locator('#creator-slug').boundingBox();
      expect(input!.width).toBeGreaterThan(70);
      if (width === 320) await page.screenshot({ path: testInfo.outputPath('registration-shop-link-mobile.png'), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }

  });

  test('failed creator registration keeps the error beside the submit action on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.route('**/rest/v1/rpc/is_creator_slug_available', route => route.fulfill({ json: true }));
    await page.route('**/auth/v1/signup**', route => route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'unexpected_failure', msg: 'Registration service unavailable' }),
    }));
    await page.goto('/creator/register');

    await page.locator('#creator-email').fill('mobile-error@example.com');
    await page.locator('#creator-password').fill('Registration123!');
    await page.locator('#creator-confirm-password').fill('Registration123!');
    await page.locator('#creator-contact-name').fill('Mobile Seller');
    await page.locator('#creator-name').fill('Mobile Error Booth');
    await page.locator('#creator-slug').fill('mobile-error-booth');
    await page.getByTestId('creator-primary-social').fill('https://instagram.com/mobile-error-booth');
    await page.getByTestId('creator-application-note').fill('Testing failed registration feedback on mobile.');
    await page.getByTestId('creator-truthful').check();

    const submit = page.getByTestId('creator-register-submit');
    await submit.click();

    const error = page.getByTestId('creator-register-error');
    await expect(error).toContainText('Registration service unavailable');
    await expect(error).toBeInViewport();
    await expect(page.locator('[data-testid="creator-register-submit"], [data-testid="creator-register-error"]')).toHaveCount(2);
    expect(await page.locator('[data-testid="creator-register-submit"], [data-testid="creator-register-error"]').evaluateAll(elements =>
      elements.map(element => element.getAttribute('data-testid'))
    )).toEqual(['creator-register-submit', 'creator-register-error']);
  });
});

test.describe('Public Nireq fixture smoke', () => {
  test.beforeAll(async () => {
    expect(service, 'Supabase service key is required to seed public route smoke fixtures').toBeTruthy();
    await cleanupPublicRouteFixtures();
    await seedPublicRouteFixtures();
  });

  test.afterAll(async () => {
    await cleanupPublicRouteFixtures();
  });

  test('customer home and menu work anonymously for intentionally public artists', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.removeItem('nireq-language'));
    await page.context().clearCookies();

    const currentEventsRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith('/rest/v1/events') && url.searchParams.has('or');
    });
    const nearbyEventsRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith('/rest/v1/events') && url.searchParams.has('end_date');
    });
    await page.goto(`/${publicSlug}/home`);
    await expect(page.getByRole('heading', { name: 'Public Smoke Artist' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Anonymous Booth Smoke Event' })).toBeVisible();
    expect(new URL((await currentEventsRequest).url()).searchParams.get('or')).toMatch(/end_date\.gte\.\d{4}-\d{2}-\d{2}T/);
    expect(new URL((await nearbyEventsRequest).url()).searchParams.get('end_date')).toMatch(/^gte\.\d{4}-\d{2}-\d{2}T/);

    await page.goto(`/${publicSlug}/menu`);

    await expect(page.getByRole('button', { name: 'Language', exact: true })).toBeVisible();
    await expect(page.getByText('Queue Number', { exact: true })).toBeVisible();
    await expect(page.getByText('Anonymous Smoke Product')).toBeVisible();

    await selectLanguage(page, 'th');

    await expect(page.locator('html')).toHaveAttribute('lang', 'th');
    await expect(page.getByText('หมายเลขคิว', { exact: true })).toBeVisible();
    await expect(page.getByText('สินค้า').first()).toBeVisible();
  });

  test('private creator slug remains hidden from anonymous public routes', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.removeItem('nireq-language'));
    await page.context().clearCookies();
    await page.goto(`/${privateSlug}/home`);

    await expect(page.getByRole('heading', { name: 'Shop not found' })).toBeVisible();
    await expect(page.getByText(privateSlug)).toBeVisible();
  });

  test('unknown creator slug shows a not found state', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.removeItem('nireq-language'));
    await page.goto('/missing-creator-smoke/home');

    await expect(page.getByRole('heading', { name: 'Shop not found' })).toBeVisible();
    await expect(page.getByText('missing-creator-smoke')).toBeVisible();
    await expect(page.getByRole('link', { name: /Browse shops/ })).toBeVisible();
  });
});

test.describe('Public release assets', () => {
  test('robots, sitemap, manifest, and install icons are served', async ({ request }) => {
    for (const path of ['/robots.txt', '/sitemap.xml']) {
      const response = await request.get(path);
      expect(response.ok(), `${path} should be served`).toBeTruthy();
    }

    const manifest = JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8'));
    expect(manifest.name).toBe('Nireq');

    for (const icon of manifest.icons) {
      const response = await request.get(`/${icon.src}`);
      expect(response.ok(), icon.src).toBeTruthy();
      expect(response.headers()['content-type']).toContain('image/png');
    }
  });
});


test('discovery previews resolve stored images, include photosets and show distinct product families', async ({ page }) => {
  const artistId = '11111111-1111-4111-8111-111111111111';
  await page.route('**/preview-art.svg*', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="pink"/></svg>' }));
  await page.route('**/rest/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    const rows = path.endsWith('/artists') ? [{ id: artistId, slug: 'preview-shop', display_name: 'Preview Shop', published_at: new Date().toISOString() }]
      : path.endsWith('/products') ? [
        { id: 'photo-a', parent_product_id: 'photos', name: 'Photoset A', product_kind: 'photo', image_url: null, variant_gallery_images: ['preview-art.svg', 'preview-art.svg?two'] },
        { id: 'photo-b', parent_product_id: 'photos', name: 'Photoset B', product_kind: 'photo', image_url: null, gallery_images: ['preview-art.svg'] },
        ...[1, 2, 3, 4].map(index => ({ id: `single-${index}`, name: `Single ${index}`, image_url: 'preview-art.svg' })),
      ].map(product => ({ ...product, artist_id: artistId, price: 100 })) : [];
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(rows) });
  });
  await page.goto('/');
  const card = page.getByTestId('creator-card').filter({ hasText: 'Preview Shop' });
  await expect(card.locator('.discovery-work')).toHaveCount(4);
  await expect(card.getByRole('img', { name: 'Photoset A 1', exact: true })).toBeVisible();
  await expect(card.getByRole('img', { name: 'Photoset B', exact: true })).toHaveCount(0);
  const image = card.getByRole('img', { name: 'Single 1', exact: true });
  await expect(image).toHaveAttribute('src', /\/storage\/v1\/object\/public\/Menu\/preview-art.svg$/);
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});
