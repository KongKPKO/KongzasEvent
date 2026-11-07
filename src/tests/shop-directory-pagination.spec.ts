import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

test('home highlights four shops and directory searches all pages', async ({ page }) => {
  const env = resolveSupabaseTestEnv();
  if (!['localhost', '127.0.0.1'].includes(new URL(env.url).hostname)) throw new Error('Disposable local database required');
  const service = createClient(env.url, env.serviceKey, { auth: { persistSession: false } });
  const suffix = randomUUID().slice(0, 8);
  const ids = Array.from({ length: 15 }, () => randomUUID());
  try {
    const seeded = await service.from('artists').insert(ids.map((id, i) => ({ id, slug: `orchid-${suffix}-${i}`, display_name: `Orchid ${suffix} ${String(i).padStart(2, '0')}`, bio: `Orchid ${suffix}`, is_public: true, is_verified: true, published_at: new Date(Date.now() - i * 1000).toISOString() })));
    if (seeded.error) throw seeded.error;
    await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
    await page.goto('/');
    await expect(page.getByTestId('creator-card')).toHaveCount(4);
    await page.getByTestId('public-creator-search').fill(`Orchid ${suffix}`);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/\/discover\/shops\?q=/);
    await expect(page.getByTestId('creator-card')).toHaveCount(10);
    await expect(page.getByText('15 shops')).toBeVisible();
    await page.getByRole('link', { name: 'Next', exact: true }).click();
    await expect(page.getByTestId('creator-card')).toHaveCount(5);
    await expect(page.getByText('Page 2 / 2')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Page 2 / 2')).toBeVisible();
    await page.getByTestId('public-creator-search').fill(`Orchid ${suffix} 14`);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByTestId('creator-card')).toHaveCount(1);
    await expect(page.getByTestId('creator-card')).toContainText(`Orchid ${suffix} 14`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByTestId('creator-card').getByRole('link', { name: 'View booth' }).click();
    await page.getByRole('link', { name: 'Discover', exact: true }).click();
    await expect(page).toHaveURL(/\/discover\/shops$/);
    await expect(page.getByRole('heading', { name: 'Explore shops' })).toBeVisible();
  } finally {
    const result = await service.from('artists').delete().in('id', ids);
    if (result.error) throw result.error;
  }
});
