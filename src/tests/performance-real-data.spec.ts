import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.TEST_SUPABASE_SERVICE_KEY || '';
const PRODUCT_COUNT = Number(process.env.PERF_PRODUCT_COUNT || '300');
const ARTIST_ID = randomUUID();
const EVENT_ID = randomUUID();
const ARTIST_SLUG = `perf-${Date.now()}`;

test.skip(!SERVICE_KEY, 'Set the service-role test key to seed and clean real-data performance fixtures.');

const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const chunk = <T,>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const cleanup = async () => {
  await service.from('event_products').delete().eq('event_id', EVENT_ID);
  await service.from('products').delete().eq('artist_id', ARTIST_ID);
  await service.from('events').delete().eq('id', EVENT_ID);
  await service.from('artists').delete().eq('id', ARTIST_ID);
};

test.describe('Real-data customer menu performance', () => {
  test.beforeAll(async () => {
    await cleanup();

    const now = new Date();
    const startsAt = new Date(now.getTime() - 60 * 60 * 1000);
    const endsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const artistInsert = await service.from('artists').insert({
      id: ARTIST_ID,
      slug: ARTIST_SLUG,
      display_name: 'Performance Load Artist',
      bio: 'Performance fixture artist',
      is_public: true,
      is_verified: true,
      is_queue_open: true,
      published_at: now.toISOString(),
    });
    expect(artistInsert.error).toBeNull();

    const eventInsert = await service.from('events').insert({
      id: EVENT_ID,
      artist_id: ARTIST_ID,
      event_name: 'Performance Load Event',
      start_date: startsAt.toISOString(),
      end_date: endsAt.toISOString(),
      status: 'Confirmed',
      is_booth_open: true,
      event_timezone: 'Asia/Bangkok',
    });
    expect(eventInsert.error).toBeNull();

    const products = Array.from({ length: PRODUCT_COUNT }, (_, index) => {
      const lineNumber = Math.floor(index / 20) + 1;
      const variantNumber = (index % 20) + 1;
      return {
        artist_id: ARTIST_ID,
        name: `Perf Sticker ${String(index + 1).padStart(3, '0')}`,
        price: 50 + (index % 8) * 10,
        description: `Performance fixture product ${index + 1}`,
        category: index % 3 === 0 ? 'Sticker' : index % 3 === 1 ? 'Keyring' : 'Print',
        tags: [index % 2 === 0 ? 'Genshin Impact' : 'Original', `Line ${lineNumber}`],
        image_url: '',
        status: 'enable',
        currency: 'THB',
        stock_total: 30,
        stock_reserved: index % 5,
        stock_sold: index % 7,
        is_unlimited: false,
        variant_group_name: `Perf Line ${lineNumber}`,
        variant_name: `Option ${variantNumber}`,
        variant_sort_order: variantNumber,
      };
    });

    for (const productChunk of chunk(products, 100)) {
      const productInsert = await service.from('products').insert(productChunk);
      expect(productInsert.error).toBeNull();
    }
  });

  test.afterAll(async () => {
    await cleanup();
  });

  test('customer menu renders, filters, and opens details with 300 products', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const responseTimes: number[] = [];
    const requestStarts = new Map<string, number>();
    page.on('request', (request) => {
      if (request.url().includes('/rest/v1/') || request.url().includes('/rpc/')) {
        requestStarts.set(`${request.method()} ${request.url()}`, Date.now());
      }
    });
    page.on('response', (response) => {
      if (response.url().includes('/rest/v1/') || response.url().includes('/rpc/')) {
        const key = `${response.request().method()} ${response.url()}`;
        const start = requestStarts.get(key);
        if (start) responseTimes.push(Date.now() - start);
      }
    });

    const navigationStartedAt = Date.now();
    await page.goto(`${BASE_URL}/${ARTIST_SLUG}/menu`);
    await expect(page.getByText('Perf Sticker 001')).toBeVisible({ timeout: 10000 });
    const firstProductVisibleMs = Date.now() - navigationStartedAt;

    await expect(page.getByText(`Perf Sticker ${String(PRODUCT_COUNT).padStart(3, '0')}`)).toBeVisible({ timeout: 10000 });
    const allProductsVisibleMs = Date.now() - navigationStartedAt;

    const filterStartedAt = Date.now();
    await page.getByPlaceholder(/search/i).fill('Perf Sticker 250');
    const filteredProductCard = page.getByRole('button', { name: /Perf Sticker 250/ });
    await expect(filteredProductCard).toBeVisible({ timeout: 3000 });
    const filterMs = Date.now() - filterStartedAt;

    const modalStartedAt = Date.now();
    await filteredProductCard.click();
    await expect(page.getByRole('dialog', { name: 'Perf Sticker 250' })).toBeVisible({ timeout: 3000 });
    const modalMs = Date.now() - modalStartedAt;

    const averageApiMs = responseTimes.length
      ? responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length
      : 0;

    console.info('[perf-real-data]', {
      products: PRODUCT_COUNT,
      firstProductVisibleMs,
      allProductsVisibleMs,
      filterMs,
      modalMs,
      apiRequests: responseTimes.length,
      averageApiMs: Math.round(averageApiMs),
    });

    expect(firstProductVisibleMs).toBeLessThan(6000);
    expect(allProductsVisibleMs).toBeLessThan(9000);
    expect(filterMs).toBeLessThan(1500);
    expect(modalMs).toBeLessThan(1000);
    if (responseTimes.length > 0) {
      expect(averageApiMs).toBeLessThan(1000);
    }
  });
});
