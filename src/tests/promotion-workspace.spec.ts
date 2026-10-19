import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { selectLanguage } from './helpers/languageMenu';

test.use({ timezoneId: 'Asia/Bangkok' });

test('Promotion V1 combines a recipe discount and exact-SKU gift with a no-write preview', async ({ page }) => {
  test.setTimeout(90000);
  const email = 'promotion-workspace-e2e@nireq.local', password = 'LocalPromotionUX123!';
  const { service, userId } = await ensureOwnerArtistFixture({ email, password, slug: 'promotion-workspace-e2e', displayName: 'Promotion UX test' });
  const eventId = randomUUID(), firstProductId = randomUUID(), secondProductId = randomUUID(), giftId = randomUUID();
  const productIds = [firstProductId, secondProductId, giftId];
  const must = (result: { error: unknown }) => { if (result.error) throw result.error; };
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));

  try {
    must(await service.from('artist_promotions').delete().eq('artist_id', userId));
    must(await service.from('events').insert({ id: eventId, artist_id: userId, event_name: 'V1 Event', start_date: '2020-09-15T03:00:00Z', end_date: '2099-09-16T12:00:00Z', event_timezone: 'Asia/Bangkok', status: 'Confirmed' }));
    must(await service.from('products').insert([
      { id: firstProductId, artist_id: userId, name: 'Mavuika A3', sku: 'MAV-A3', category: 'Print', price: 250, is_unlimited: true, status: 'enable' },
      { id: secondProductId, artist_id: userId, name: 'Mavuika A4', sku: 'MAV-A4', category: 'Print', price: 150, is_unlimited: true, status: 'enable' },
      { id: giftId, artist_id: userId, name: 'Hairclip Tamon', sku: 'GIFT-HAIR', category: 'Accessory', price: 80, is_unlimited: true, status: 'enable' },
    ]));
    must(await service.from('event_products').insert(productIds.map(productId => ({ event_id: eventId, artist_id: userId, product_id: productId, is_enabled: true, is_unlimited: true }))));

    await page.goto('/manage-login');
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole('button', { name: /Login/i }).click();
    await expect(page).not.toHaveURL(/manage-login/);
    await page.goto(`/manage-events/${eventId}/promotion`);
    await selectLanguage(page, 'th');
    await page.getByRole('button', { name: 'สร้างโปรโมชัน', exact: true }).click();

    const form = page.locator('#promotion-editor');
    const review = page.getByRole('complementary', { name: 'สรุปก่อนบันทึก' });
    await expect(form.getByLabel('ชื่อโปรโมชัน', { exact: true })).toBeFocused();
    await expect(form.getByRole('heading', { name: /1\s*ข้อมูลโปรโมชัน/ })).toBeVisible();
    await expect(form.getByRole('heading', { name: /2\s*เงื่อนไขการซื้อ/ })).toBeVisible();
    await expect(form.getByRole('heading', { name: /3\s*สิทธิประโยชน์/ })).toBeVisible();
    await expect(form.getByRole('heading', { name: /4\s*ช่วงเวลา ช่องทาง และจำนวนสิทธิ์/ })).toBeVisible();

    await form.getByLabel('ชื่อโปรโมชัน', { exact: true }).fill('ซื้อครบชุด Mavuika รับส่วนลดและของแถม');
    await form.getByRole('radio', { name: 'ซื้อสินค้าครบชุด', exact: true }).check();
    const conditionSearch = form.getByLabel('ค้นหาสินค้า').first();
    await conditionSearch.fill('MAV-A3');
    await form.getByRole('button', { name: /Mavuika A3.*MAV-A3/ }).click();
    await conditionSearch.fill('MAV-A4');
    await form.getByRole('button', { name: /Mavuika A4.*MAV-A4/ }).click();
    await form.getByRole('checkbox', { name: 'ขายวันงาน', exact: true }).check();
    await form.getByRole('button', { name: 'บันทึกและเปิดใช้', exact: true }).click();
    await expect(form.getByRole('alert')).toContainText('เลือกสิทธิประโยชน์อย่างน้อย 1 อย่าง');

    await form.getByRole('checkbox', { name: /^ส่วนลด/ }).check();
    await form.getByLabel('จำนวนเงิน (บาท)').fill('20');
    await form.getByRole('checkbox', { name: /^ของแถมจากสินค้าที่มีอยู่/ }).check();
    const giftSearch = form.getByLabel('ค้นหาสินค้าของแถม');
    await giftSearch.fill('GIFT-HAIR');
    await form.getByRole('button', { name: /Hairclip Tamon.*GIFT-HAIR/ }).click();
    await form.getByLabel('จำกัดจำนวนสิทธิ์ทั้งหมด').fill('20');

    await expect(review).toContainText('Mavuika A3');
    await expect(review).toContainText('ลด ฿20');
    await expect(review).toContainText('Hairclip Tamon');

    const ordersBeforePreview = await service.from('orders').select('id', { count: 'exact', head: true }).eq('event_id', eventId);
    must(ordersBeforePreview);
    let previewDefinition: Record<string, unknown> | undefined;
    await page.route('**/rest/v1/rpc/preview_promotion_definition', async route => {
      previewDefinition = (JSON.parse(route.request().postData() || '{}') as { p_definition?: Record<string, unknown> }).p_definition;
      await route.continue();
    });
    const previewSearch = form.getByLabel('ค้นหาสินค้า').last();
    await previewSearch.fill('MAV-A3');
    await form.getByRole('button', { name: /Mavuika A3.*MAV-A3/ }).last().click();
    await previewSearch.fill('MAV-A4');
    await form.getByRole('button', { name: /Mavuika A4.*MAV-A4/ }).last().click();
    await form.getByRole('button', { name: 'คำนวณผลทดลอง', exact: true }).click();
    await expect(form).toContainText('ยอดสุทธิ');
    await expect(form).toContainText('฿380');
    await expect(form).toContainText('Hairclip Tamon');
    await expect(form).toContainText('เข้าเงื่อนไข');
    expect(previewDefinition?.promotion_type).toBe('condition_reward');
    expect(previewDefinition?.v1_config).toEqual({
      version: 1,
      condition: { kind: 'recipe', items: [{ product_id: firstProductId, quantity: 1 }, { product_id: secondProductId, quantity: 1 }] },
      discount: { kind: 'fixed', value: 20 },
      gift: { product_id: giftId, quantity: 1, limit: 20 },
    });
    expect((await service.from('artist_promotions').select('id', { count: 'exact', head: true }).eq('artist_id', userId)).count).toBe(0);
    expect((await service.from('orders').select('id', { count: 'exact', head: true }).eq('event_id', eventId)).count).toBe(ordersBeforePreview.count);

    await form.getByLabel('จำนวนเงิน (บาท)').fill('25');
    await expect(form.locator('.promotion-preview-result')).toBeHidden();
    await form.getByLabel('จำนวนเงิน (บาท)').fill('20');
    await form.getByRole('button', { name: 'คำนวณผลทดลอง', exact: true }).click();
    await expect(form.locator('.promotion-preview-result')).toContainText('฿380');

    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `../promotion-v1-${width}-local.png`, fullPage: true });
    }
    await expect(form).not.toContainText(/\bSKU\b/);
    const accessibility = await new AxeBuilder({ page }).include('.promotion-workspace').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(accessibility.violations).toEqual([]);
    await form.getByRole('button', { name: 'บันทึกและเปิดใช้', exact: true }).click();
    await expect(page.locator('.promotion-notice')).toContainText('บันทึกโปรโมชันแล้ว');
    const saved = await service.from('artist_promotions').select('promotion_type,v1_config').eq('artist_id', userId).single();
    must(saved);
    expect(saved.data?.promotion_type).toBe('condition_reward');
    expect(saved.data?.v1_config).toEqual({
      version: 1,
      condition: { kind: 'recipe', items: [{ product_id: firstProductId, quantity: 1 }, { product_id: secondProductId, quantity: 1 }] },
      discount: { kind: 'fixed', value: 20 },
      gift: { product_id: giftId, quantity: 1, limit: 20 },
    });
    expect(runtimeErrors).toEqual([]);
  } finally {
    await service.from('artist_promotions').delete().eq('artist_id', userId);
    await service.from('event_products').delete().eq('event_id', eventId);
    await service.from('products').delete().in('id', productIds);
    await service.from('events').delete().eq('id', eventId);
  }
});
