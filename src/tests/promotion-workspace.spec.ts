import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';

test.use({ timezoneId: 'Asia/Bangkok' });
test('Thai promotion editor explains gifts, schedules and tiers and persists them', async ({ page }) => {
  test.setTimeout(90000);
  const email = 'promotion-workspace-e2e@nireq.local', password = 'LocalPromotionUX123!';
  const { service, userId } = await ensureOwnerArtistFixture({ email, password, slug: 'promotion-workspace-e2e', displayName: 'Promotion UX test' });
  const eventId = randomUUID(), giftId = randomUUID();
  const must = (result: { error: unknown }) => { if (result.error) throw result.error; };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    must(await service.from('events').insert({ id: eventId, artist_id: userId, event_name: 'Gift Event', start_date: '2030-09-15T03:00:00Z', end_date: '2030-09-16T12:00:00Z', event_timezone: 'Asia/Bangkok', status: 'Confirmed' }));
    must(await service.from('products').insert({ id: giftId, artist_id: userId, name: 'Gift sticker', category: 'Sticker', price: 50, is_unlimited: true }));
    await page.goto('/manage-login');
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole('button', { name: /Login/i }).click();
    await expect(page).not.toHaveURL(/manage-login/);
    await page.goto(`/manage-events/${eventId}/promotion`);
    await page.getByRole('button', { name: 'TH', exact: true }).click();
    await page.getByRole('button', { name: 'สร้างโปรโมชัน', exact: true }).click();
    const form = page.locator('#promotion-editor');
    const review = page.getByRole('complementary', { name: 'สรุปก่อนบันทึก' });
    await expect(form.getByLabel('ชื่อโปรโมชัน', { exact: true })).toBeFocused();
    await form.getByLabel('ชื่อโปรโมชัน', { exact: true }).fill('ซื้อ 3 รับสติกเกอร์');
    await form.getByRole('radio', { name: /^ซื้อครบรับของแถม/ }).check();
    await form.getByRole('checkbox', { name: 'ขายวันงาน', exact: true }).check();
    await form.getByRole('button', { name: 'บันทึกและเปิดใช้', exact: true }).click();
    await expect(form.getByRole('alert')).toContainText('เลือกของแถม');
    await form.getByRole('checkbox', { name: 'Gift sticker', exact: true }).check();
    await expect(form.getByRole('alert')).toHaveCount(0);
    await form.getByLabel('เริ่มใช้ (ไม่บังคับ)').fill('2030-09-15T10:00');
    await form.getByLabel('สิ้นสุด (ไม่บังคับ)').fill('2030-09-16T18:00');
    await expect(review).toContainText('Gift sticker');
    await expect(review).toContainText('Gift Event · ขายวันงาน');
    await expect(review).toContainText('10:00');
    await expect(review).toContainText('จัดสรรสต็อกของแถม');
    for (const width of [320, 375, 414, 768, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/nireq-promotion-form-${width}.png`, fullPage: true });
    }
    const accessibility = await new AxeBuilder({ page }).include('.promotion-workspace').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(accessibility.violations).toEqual([]);
    await form.getByRole('button', { name: 'บันทึกและเปิดใช้', exact: true }).click();
    await expect(page.locator('.promotion-notice')).toContainText('บันทึกโปรโมชันแล้ว');
    const row = page.locator('article').filter({ has: page.getByRole('heading', { name: 'ซื้อ 3 รับสติกเกอร์', exact: true }) });
    await row.getByText(/เงื่อนไขและช่วงใช้งาน/).click();
    await expect(row).toContainText('รอเริ่ม');
    await expect(row).not.toContainText('กำลังใช้');
    const saved = await service.from('artist_promotions').select('id,promotion_type').eq('artist_id', userId).single();
    must(saved);
    expect(saved.data?.promotion_type).toBe('quantity_gift');
    const assignment = await service.from('promotion_assignments').select('starts_at').eq('promotion_id', saved.data!.id).single();
    expect(new Date(assignment.data!.starts_at).toISOString()).toBe('2030-09-15T03:00:00.000Z');
    await row.getByRole('button', { name: 'แก้ไขโปรโมชัน', exact: true }).click();
    await form.getByRole('radio', { name: /^ของแถมตามยอดซื้อ/ }).check();
    await form.getByLabel('เมื่อถึงหลายระดับ').selectOption('cumulative');
    await form.getByRole('checkbox', { name: 'Gift sticker', exact: true }).check();
    await form.getByRole('button', { name: 'เพิ่มระดับ', exact: true }).click();
    await form.getByLabel('ยอดถึง (บาท)', { exact: true }).nth(1).fill('1000');
    await form.getByRole('checkbox', { name: 'Gift sticker', exact: true }).nth(1).check();
    await expect(review).toContainText('รับของแถมทุกระดับที่ถึง');
    await expect(review).toContainText('฿1000');
    await form.getByRole('button', { name: 'บันทึกการแก้ไข', exact: true }).click();
    await expect(page.locator('.promotion-notice')).toContainText('บันทึกโปรโมชันแล้ว');
    expect((await service.from('promotion_tiers').select('id').eq('promotion_id', saved.data!.id)).data).toHaveLength(2);
    page.once('dialog', dialog => dialog.accept());
    await row.getByRole('button', { name: 'เก็บโปรโมชันเข้าคลัง', exact: true }).click();
    await expect(page.locator('.promotion-notice')).toContainText('เก็บโปรโมชันเข้าคลังแล้ว');
    await expect(row).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'แสดงที่เก็บเข้าคลัง', exact: true }).check();
    await expect(row).toContainText('เก็บเข้าคลังแล้ว');
    expect(errors).toEqual([]);
  } finally {
    // This dedicated owner only contains this test's offers; dependent rows cascade.
    await service.from('artist_promotions').delete().eq('artist_id', userId);
    await service.from('products').delete().eq('id', giftId);
    await service.from('events').delete().eq('id', eventId);
  }
});
