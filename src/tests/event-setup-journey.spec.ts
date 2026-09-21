import { expect, test } from '@playwright/test';
import { matchesEventDate } from '../components/EventDateFilter';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';

test('sales dates include both boundaries in the event timezone', () => {
  const matches = (value: string) => matchesEventDate(value, '2026-09-15', '2026-09-15', 'Asia/Bangkok');
  expect(matches('2026-09-14T16:59:59Z')).toBe(false);
  expect(matches('2026-09-14T17:00:00Z')).toBe(true);
  expect(matches('2026-09-15T16:59:59Z')).toBe(true);
  expect(matches('2026-09-15T17:00:00Z')).toBe(false);
  expect(matches('invalid')).toBe(false);
  expect(matchesEventDate(null, '', '', 'Asia/Bangkok')).toBe(true);
});

test('owner can follow Thai event setup, configure windows and keep report dates', async ({ page }) => {
  const checkWidths = async () => {
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  };
  const email = 'event-journey-e2e@nireq.local';
  const password = 'LocalEventJourney123!';
  const fixture = await ensureOwnerArtistFixture({ email, password, slug: 'event-journey-e2e', displayName: 'Event journey test' });
  const created = await fixture.service.from('events').insert({ artist_id: fixture.userId, event_name: 'Event journey test', start_date: '2030-09-15T03:00:00Z', end_date: '2030-09-15T12:00:00Z', event_timezone: 'Asia/Bangkok', status: 'Confirmed', location: 'Test hall', booth_detail: 'A1' }).select('id').single();
  if (created.error) throw created.error;
  const id = created.data.id;
  try {
    const seeded = await fixture.service.from('orders').insert([
      { event_id: id, created_at: '2030-09-14T17:00:00Z', total_price: 100, currency: 'THB', status: 'completed', payment_method: 'cash', order_type: 'pos_walkin' },
      { event_id: id, created_at: '2030-09-15T17:00:00Z', total_price: 200, currency: 'THB', status: 'completed', payment_method: 'transfer', order_type: 'pos_walkin' },
    ]);
    if (seeded.error) throw seeded.error;
    await page.goto('/manage-login');
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole('button', { name: /Login to Dashboard|Sign in|Login/i }).click();
    await expect(page).not.toHaveURL(/manage-login/);
    await page.goto(`/manage-events/${id}/workspace`);
    await page.getByRole('button', { name: 'TH', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'ตั้งค่าให้ครบ ก่อนเริ่มขาย' })).toBeVisible();
    await checkWidths();
    await page.getByRole('button', { name: 'เลือกสินค้าและจัดสรรสต็อก', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/manage-events/${id}/catalog`));
    await expect(page.getByRole('heading', { name: 'สินค้าและสต็อกของงาน', exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: 'เมนูอีเวนต์' }).getByRole('button', { name: 'ช่วงขายและรับเงิน', exact: true }).click();
    await page.getByText('ตรวจหรือแก้รายละเอียดงาน', { exact: true }).click();
    await expect(page.getByLabel('วันและเวลาเริ่มงาน')).toBeVisible();
    await page.getByRole('button', { name: /สั่งก่อนงาน/ }).click();
    await expect(page.getByLabel('เริ่มรับออเดอร์ก่อนงาน')).toBeVisible();
    await page.getByLabel('ปิดรับออเดอร์ก่อนงาน').fill('2030-09-16T10:00');
    await page.getByRole('button', { name: 'บันทึกการตั้งค่า', exact: true }).click();
    await expect(page.getByText('ตรวจชื่อและช่วงเวลาของงาน', { exact: true })).toBeVisible();
    await page.getByLabel('ปิดรับออเดอร์ก่อนงาน').fill('2030-09-15T09:00');
    await page.getByRole('button', { name: 'บันทึกการตั้งค่า', exact: true }).click();
    await expect(page.getByText('บันทึกการตั้งค่าแล้ว', { exact: true })).toBeVisible();
    await checkWidths();
    await page.setViewportSize({ width: 375, height: 900 });
    await page.getByRole('combobox', { name: 'หน้าของอีเวนต์', exact: true }).selectOption('promotion');
    await expect(page.getByRole('heading', { name: 'โปรโมชันของร้าน', exact: true })).toBeVisible();
    await checkWidths();
    await page.getByRole('button', { name: 'ออเดอร์ก่อนงาน', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'ออเดอร์ก่อนงาน', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'ออเดอร์หลังงาน', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'ออเดอร์หลังงาน', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'ยอดขาย', exact: true }).click();
    await page.getByLabel('ตั้งแต่วันที่').fill('2030-09-15');
    await page.getByLabel('ถึงวันที่').fill('2030-09-15');
    await expect(page.getByText('฿100', { exact: true }).first()).toBeVisible();
    await checkWidths();
    await page.getByRole('button', { name: 'ประวัติ', exact: true }).click();
    await expect(page.getByLabel('ตั้งแต่วันที่')).toHaveValue('2030-09-15');
    await expect(page.getByLabel('ถึงวันที่')).toHaveValue('2030-09-15');
    await expect(page.locator('.report-order')).toHaveCount(1);
    await expect(page.locator('.report-order')).toContainText('฿100');
    await page.getByRole('button', { name: 'ทุกช่วงเวลา', exact: true }).click();
    await expect(page.getByLabel('ตั้งแต่วันที่')).toHaveValue('');
    await expect(page.locator('.report-order')).toHaveCount(2);
    await page.getByLabel('การชำระเงิน', { exact: true }).selectOption('transfer');
    await expect(page.locator('.report-order')).toHaveCount(1);
    await expect(page.locator('.report-order')).toContainText('฿200');
    await page.getByLabel('ค้นหารายการ', { exact: true }).fill('no-matching-order');
    await expect(page.getByText('ไม่พบรายการขายที่ตรงกับตัวกรอง')).toBeVisible();
    await page.getByRole('button', { name: 'ล้างตัวกรองทั้งหมด' }).click();
    await expect(page.locator('.report-order')).toHaveCount(2);
    await page.locator('.report-order summary').first().click();
    await expect(page.getByText('ไม่มีรายละเอียดสินค้าในรายการนี้').first()).toBeVisible();
    await checkWidths();
    await page.screenshot({ path: '/tmp/nireq-sales-history.png', fullPage: true });
    await page.getByRole('button', { name: 'ยอดขาย', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'ภาพรวมยอดขาย' })).toBeVisible();
    await page.getByRole('button', { name: 'วันนี้', exact: true }).click();
    await expect(page.getByLabel('ตั้งแต่วันที่')).not.toHaveValue('');
    await expect(page.getByLabel('ถึงวันที่')).toHaveValue(await page.getByLabel('ตั้งแต่วันที่').inputValue());
    await page.getByRole('button', { name: 'ทุกช่วงเวลา', exact: true }).click();
    await expect(page.locator('.report-metrics').first()).toContainText('฿300');
    await page.screenshot({ path: '/tmp/nireq-sales-dashboard.png', fullPage: true });
  } finally {
    await fixture.service.from('orders').delete().eq('event_id', id);
    await fixture.service.from('events').delete().eq('id', id);
  }
});
