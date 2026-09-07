import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

test.use({ timezoneId: 'Asia/Bangkok' });
test('promotion edit preserves local time and cancelled conflicts never save', async ({ page }) => {
  test.setTimeout(90000);
  const env = resolveSupabaseTestEnv();
  const service = createClient(env.url, env.serviceKey, { auth: { persistSession: false } });
  const email = 'promotion-save-local@example.com';
  const password = 'LocalPromotionSave123!';
  const { userId } = await ensureOwnerArtistFixture({ email, password, slug: 'promotion-save-local', displayName: 'Promotion Save Test' });
  const campaign = randomUUID(), product = randomUUID(), original = randomUUID(), competing = randomUUID();
  const starts = '2026-09-07T06:00:23.000Z', ends = '2027-09-07T06:00:47.000Z';
  const must = (result: { error: unknown }) => { if (result.error) throw result.error; };
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  try {
    must(await service.from('online_campaigns').insert({ id: campaign, artist_id: userId, name: 'Save test campaign', slug: campaign, opens_at: starts, closes_at: ends }));
    must(await service.from('products').insert({ id: product, artist_id: userId, name: 'Save test Cheki', price: 100, is_unlimited: true }));
    must(await service.from('online_campaign_products').insert({ campaign_id: campaign, artist_id: userId, product_id: product, is_unlimited: true }));
    must(await service.from('artist_promotions').insert([original, competing].map((id) => ({ id, artist_id: userId, name: id === original ? 'Original offer' : 'Competing offer', target_type: 'all', rule_type: 'discount', promotion_type: 'quantity_discount', buy_quantity: 3, reward_value: 50, lifecycle_status: 'ready' }))));
    must(await service.from('promotion_assignments').insert([original, competing].map((id) => ({ promotion_id: id, artist_id: userId, campaign_id: campaign, starts_at: starts, ends_at: ends, combination_policy: 'combine' }))));
    await page.goto('/manage-login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.getByRole('button', { name: /Login/i }).click();
    await expect(page).toHaveURL(/manage-events/);
    await page.goto('/manage-promotions');
    await page.locator('article').filter({ has: page.getByRole('heading', { name: 'Original offer', exact: true }) }).getByRole('button', { name: 'Edit promotion' }).click();
    const form = page.locator('#promotion-editor');
    await expect(form.locator('input[type="datetime-local"]').first()).toHaveValue('2026-09-07T13:00');
    await form.getByLabel(/Promotion name|ชื่อโปรโมชั่น/).fill('Edited offer');
    // A request that never reaches the database must leave the active offer alone.
    await page.route('**/rest/v1/rpc/save_promotion_definition', (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'test_unavailable' }),
    }));
    await form.getByRole('button', { name: /Save changes|บันทึกการแก้ไข/ }).click();
    await expect(form).toContainText(/Could not save promotion|บันทึกโปรโมชั่นไม่สำเร็จ/);
    expect((await service.from('artist_promotions').select('name').eq('id', original).single()).data?.name).toBe('Original offer');
    await page.unroute('**/rest/v1/rpc/save_promotion_definition');
    page.once('dialog', (dialog) => dialog.dismiss());
    await form.getByRole('button', { name: /Save changes|บันทึกการแก้ไข/ }).click();
    await expect(form).toContainText(/Not saved|ยังไม่ได้บันทึก/);
    const unchanged = await service.from('artist_promotions').select('name').eq('id', original).single();
    expect(unchanged.data?.name).toBe('Original offer');
    const assignment = await service.from('promotion_assignments').select('is_paused').eq('promotion_id', original).single();
    expect(assignment.data?.is_paused).toBe(false);
    page.once('dialog', (dialog) => dialog.accept());
    await form.getByRole('button', { name: /Save changes|บันทึกการแก้ไข/ }).click();
    await expect(form).toContainText(/Promotion saved and activated|บันทึกและเปิดใช้โปรโมชั่นแล้ว/);
    const saved = await service.from('promotion_assignments').select('starts_at,ends_at,is_paused').eq('promotion_id', original).single();
    expect(new Date(saved.data!.starts_at).toISOString()).toBe(starts);
    expect(new Date(saved.data!.ends_at).toISOString()).toBe(ends);
    expect(saved.data?.is_paused).toBe(false);
    expect(runtimeErrors).toEqual([]);
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await page.screenshot({ path: `/tmp/nireq-promotion-save-${test.info().project.name}.png` });
  } finally {
    await service.from('promotion_assignments').delete().in('promotion_id', [original, competing]);
    await service.from('artist_promotions').delete().in('id', [original, competing]);
    await service.from('online_campaign_products').delete().eq('campaign_id', campaign);
    await service.from('online_campaigns').delete().eq('id', campaign);
    await service.from('products').delete().eq('id', product);
  }
});
