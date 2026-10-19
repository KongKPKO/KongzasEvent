import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { selectLanguage } from './helpers/languageMenu';

test('group discounts and activity rights can be previewed with zero allocated stock and saved together', async ({ page }) => {
  const run = randomUUID(), email = `flex-promo-${run}@nireq.local`, password = 'LocalFlexPromo123!';
  const { service, userId } = await ensureOwnerArtistFixture({ email, password, slug: `flex-promo-${run.slice(0, 8)}`, displayName: 'Flexible promo UI' });
  const eventId = randomUUID(), a = randomUUID(), b = randomUUID();
  const must = (result: { error: unknown }) => { if (result.error) throw result.error; };
  try {
    must(await service.from('events').insert({ id: eventId, artist_id: userId, event_name: 'Flexible promo event', start_date: new Date(Date.now() - 60000).toISOString(), end_date: new Date(Date.now() + 86400000).toISOString(), status: 'Confirmed', catalog_initialized_at: new Date().toISOString() }));
    must(await service.from('products').insert([{ id: a, artist_id: userId, name: 'Group A3', price: 250, is_unlimited: false, stock_total: 10, status: 'enable' }, { id: b, artist_id: userId, name: 'Group A4', price: 150, is_unlimited: false, stock_total: 10, status: 'enable' }]));
    must(await service.from('event_products').insert([a, b].map(product_id => ({ event_id: eventId, artist_id: userId, product_id, is_enabled: true, is_unlimited: false, stock_total: 0 }))));
    await page.goto('/manage-login');
    await page.locator('input[type=email]').fill(email);
    await page.locator('input[type=password]').fill(password);
    await page.getByRole('button', { name: /Login/i }).click();
    await expect(page).not.toHaveURL(/manage-login/);
    await page.goto(`/manage-events/${eventId}/promotion`);
    await selectLanguage(page, 'th');
    await page.getByRole('button', { name: 'สร้างโปรโมชัน', exact: true }).click();
    const form = page.locator('#promotion-editor');
    await form.getByLabel('ชื่อโปรโมชัน', { exact: true }).fill('กลุ่มลด 20% พร้อมสิทธิ์กิจกรรม');
    await form.getByRole('radio', { name: 'ซื้อสินค้าที่กำหนด', exact: true }).check();
    const conditionSearch = form.getByLabel('ค้นหาสินค้า', { exact: true }).first();
    for (const name of ['Group A3', 'Group A4']) {
      await conditionSearch.fill(name);
      await form.getByRole('button', { name: new RegExp(name) }).click();
    }
    await form.getByRole('checkbox', { name: /^ส่วนลด/ }).check();
    await form.getByLabel('รูปแบบส่วนลด').selectOption('percentage');
    await form.getByLabel('เปอร์เซ็นต์', { exact: true }).fill('20');
    await form.getByRole('checkbox', { name: /^สิทธิ์เข้าร่วมกิจกรรม/ }).check();
    await form.getByLabel('ชื่อกิจกรรม').fill('สุ่มของพิเศษ');
    await expect(form.getByLabel('วิธีใช้สิทธิ์ (ไม่บังคับ)', { exact: true })).toHaveValue('');
    await form.getByRole('checkbox', { name: 'ขายวันงาน', exact: true }).check();
    const preview = form.locator('.promotion-preview');
    await preview.getByLabel('ค้นหาสินค้า', { exact: true }).fill('Group A4');
    await preview.getByRole('button', { name: /Group A4/ }).click();
    await preview.getByRole('button', { name: 'คำนวณผลทดลอง', exact: true }).click();
    await expect(preview.locator('.promotion-preview-result')).toContainText('฿120');
    await expect(preview.locator('.promotion-preview-result')).toContainText('สุ่มของพิเศษ ×1');
    await form.getByRole('button', { name: 'บันทึกและเปิดใช้', exact: true }).click();
    await expect(form).toBeHidden();
    const saved = await service.from('artist_promotions').select('v1_config').eq('artist_id', userId).single();
    must(saved); expect(saved.data?.v1_config.condition.items).toHaveLength(2); expect(saved.data?.v1_config.activity.name).toBe('สุ่มของพิเศษ'); expect(saved.data?.v1_config.activity.instructions).toBe('');
  } finally {
    await service.from('artist_promotions').delete().eq('artist_id', userId);
    await service.from('event_products').delete().eq('event_id', eventId);
    await service.from('events').delete().eq('id', eventId);
    await service.from('products').delete().in('id', [a, b]);
  }
});
