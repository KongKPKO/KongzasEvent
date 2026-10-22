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
    await page.goto('/manage-promotions');
    await selectLanguage(page, 'th');
    await page.getByRole('button', { name: 'สร้างโปรโมชัน', exact: true }).click();

    const form = page.locator('#promotion-editor');
    const review = page.getByRole('complementary', { name: 'สรุปก่อนบันทึก' });
    await expect(form.getByLabel('ชื่อโปรโมชัน', { exact: true })).toBeFocused();
    await expect(form.getByRole('heading', { name: /1\s*ข้อมูลโปรโมชัน/ })).toBeVisible();
    await expect(form.getByRole('heading', { name: /2\s*เงื่อนไขการซื้อ/ })).toBeVisible();
    await expect(form.getByRole('heading', { name: /3\s*สิทธิประโยชน์/ })).toBeVisible();
    await expect(form.getByRole('heading', { name: /4\s*ช่วงเวลา ช่องทาง และจำนวนสิทธิ์/ })).toBeVisible();

    const previewSection = form.locator('.promotion-preview');
    await previewSection.getByRole('button', { name: 'คำนวณผลทดลอง', exact: true }).click();
    await expect(previewSection.getByRole('alert')).toHaveText('กรอกชื่อโปรโมชัน');
    await expect(previewSection.getByRole('alert')).toBeInViewport();
    await expect(review.getByRole('alert')).toHaveCount(0);
    await form.getByLabel('ชื่อโปรโมชัน', { exact: true }).fill('ซื้อครบชุด Mavuika รับส่วนลดและของแถม');
    await form.getByRole('radio', { name: 'ซื้อสินค้าครบชุด', exact: true }).check();
    const conditionSearch = form.getByLabel('ค้นหาสินค้า').first();
    await conditionSearch.fill('MAV-A3');
    await expect(form.locator('.promotion-sku-results')).not.toContainText('MAV-A3');
    await form.getByRole('button', { name: /Mavuika A3.*250/ }).click();
    await conditionSearch.fill('MAV-A4');
    await form.getByRole('button', { name: /Mavuika A4.*150/ }).click();
    await form.getByRole('checkbox', { name: 'ขายวันงาน', exact: true }).check();
    await form.getByRole('button', { name: 'บันทึกและเปิดใช้', exact: true }).click();
    await expect(form.getByRole('alert')).toContainText('เลือกสิทธิประโยชน์อย่างน้อย 1 อย่าง');

    await form.getByRole('checkbox', { name: /^ส่วนลด/ }).check();
    await form.getByLabel('จำนวนเงิน (บาท)').fill('20');
    await form.getByRole('checkbox', { name: /^ของแถมจากสินค้าที่มีอยู่/ }).check();
    const giftSearch = form.getByLabel('ค้นหาสินค้าของแถม');
    await giftSearch.fill('GIFT-HAIR');
    await form.getByRole('button', { name: /Hairclip Tamon.*80/ }).click();
    await form.getByLabel('จำกัดจำนวนสิทธิ์ทั้งหมด').fill('20');

    await expect(review).toContainText('Mavuika A3');
    await expect(review).toContainText('ลด ฿20');
    await expect(review).toContainText('Hairclip Tamon');

    await previewSection.getByRole('button', { name: 'คำนวณผลทดลอง', exact: true }).click();
    await expect(previewSection.getByRole('alert')).toHaveText('เพิ่มสินค้าในตะกร้าทดลอง');
    await expect(previewSection.getByRole('alert')).toBeInViewport();

    const ordersBeforePreview = await service.from('orders').select('id', { count: 'exact', head: true }).eq('event_id', eventId);
    must(ordersBeforePreview);
    let previewDefinition: Record<string, unknown> | undefined;
    await page.route('**/rest/v1/rpc/preview_promotion_definition', async route => {
      previewDefinition = (JSON.parse(route.request().postData() || '{}') as { p_definition?: Record<string, unknown> }).p_definition;
      await route.continue();
    });
    const previewSearch = form.getByLabel('ค้นหาสินค้า').last();
    await previewSearch.fill('MAV-A3');
    await form.getByRole('button', { name: /Mavuika A3.*250/ }).last().click();
    await previewSearch.fill('MAV-A4');
    await form.getByRole('button', { name: /Mavuika A4.*150/ }).last().click();
    await form.getByRole('button', { name: 'คำนวณผลทดลอง', exact: true }).click();
    await expect(previewSection.getByRole('alert')).toHaveCount(0);
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
      activity: null,
    });
    expect((await service.from('artist_promotions').select('id', { count: 'exact', head: true }).eq('artist_id', userId)).count).toBe(0);
    expect((await service.from('orders').select('id', { count: 'exact', head: true }).eq('event_id', eventId)).count).toBe(ordersBeforePreview.count);

    await page.route('**/rest/v1/rpc/preview_promotion_definition', route => route.fulfill({ status: 500, json: { message: 'preview_unavailable' } }), { times: 1 });
    await previewSection.getByRole('button', { name: 'คำนวณผลทดลอง', exact: true }).click();
    await expect(previewSection.getByRole('alert')).toContainText('ทดลองโปรโมชันไม่สำเร็จ');
    await expect(previewSection.getByRole('alert')).toBeInViewport();
    await expect(previewSection.locator('.promotion-preview-result')).toHaveCount(0);
    await previewSection.getByRole('button', { name: 'คำนวณผลทดลอง', exact: true }).click();
    await expect(previewSection.locator('.promotion-preview-result')).toContainText('฿380');

    await form.getByLabel('จำนวนเงิน (บาท)').fill('25');
    await expect(form.locator('.promotion-preview-result')).toBeHidden();
    await form.getByLabel('จำนวนเงิน (บาท)').fill('20');
    await form.getByRole('button', { name: 'คำนวณผลทดลอง', exact: true }).click();
    await expect(form.locator('.promotion-preview-result')).toContainText('฿380');

    await form.getByRole('radio', { name: 'ซื้อครบยอด', exact: true }).check();
    await form.getByLabel('ยอดซื้อ (บาท)').fill('200');
    const activityToggle = form.getByRole('checkbox', { name: /^สิทธิ์เข้าร่วมกิจกรรม/ });
    await expect(activityToggle).toBeEnabled();
    await activityToggle.check();
    await form.getByLabel('ชื่อกิจกรรม').fill('จับฉลากหน้าเวที');
    await form.getByLabel('จำนวนสิทธิ์ต่อยอดที่ครบ').fill('2');
    await form.getByLabel('วิธีใช้สิทธิ์').fill('แสดงเลขออเดอร์หลังยืนยันการชำระเงิน');
    await expect(review).toContainText('สิทธิ์กิจกรรม จับฉลากหน้าเวที ×2 ต่อยอดที่ครบ');
    await form.getByRole('button', { name: 'คำนวณผลทดลอง', exact: true }).click();
    await expect(form.locator('.promotion-preview-result')).toContainText('สิทธิ์กิจกรรมโดยประมาณ: จับฉลากหน้าเวที ×2');
    expect(previewDefinition?.v1_config).toEqual({
      version: 1,
      condition: { kind: 'spend', amount: 200 },
      discount: { kind: 'fixed', value: 20 },
      gift: { product_id: giftId, quantity: 1, limit: 20 },
      activity: { name: 'จับฉลากหน้าเวที', instructions: 'แสดงเลขออเดอร์หลังยืนยันการชำระเงิน', quantity: 2 },
    });
    await form.getByRole('radio', { name: 'ซื้อสินค้าครบชุด', exact: true }).check();
    await expect(activityToggle).toBeEnabled();
    await expect(activityToggle).toBeChecked();
    await activityToggle.uncheck();
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
    const saved = await service.from('artist_promotions').select('id,promotion_type,v1_config').eq('artist_id', userId).single();
    must(saved);
    expect(saved.data?.promotion_type).toBe('condition_reward');
    expect(saved.data?.v1_config).toEqual({
      version: 1,
      condition: { kind: 'recipe', items: [{ product_id: firstProductId, quantity: 1 }, { product_id: secondProductId, quantity: 1 }] },
      discount: { kind: 'fixed', value: 20 },
      gift: { product_id: giftId, quantity: 1, limit: 20 },
      activity: null,
    });
    must(await service.from('artist_promotions').update({
      v1_config: {
        version: 1,
        condition: { kind: 'spend', amount: 200 },
        discount: null,
        gift: null,
        activity: { name: 'จับฉลากหน้าเวที', instructions: 'แสดงเลขออเดอร์หลังยืนยันการชำระเงิน', quantity: 2 },
      },
    }).eq('id', saved.data?.id));
    await page.reload();
    const savedPromotion = page.locator('article').filter({ has: page.getByRole('heading', { name: 'ซื้อครบชุด Mavuika รับส่วนลดและของแถม', exact: true }) });
    await savedPromotion.getByRole('button', { name: 'แก้ไขโปรโมชัน' }).click();
    await expect(form.getByRole('radio', { name: 'ซื้อครบยอด', exact: true })).toBeChecked();
    await expect(form.getByRole('checkbox', { name: /^สิทธิ์เข้าร่วมกิจกรรม/ })).toBeChecked();
    await expect(form.getByLabel('ชื่อกิจกรรม')).toHaveValue('จับฉลากหน้าเวที');
    await expect(form.getByLabel('จำนวนสิทธิ์ต่อยอดที่ครบ')).toHaveValue('2');
    await expect(form.getByLabel('วิธีใช้สิทธิ์')).toHaveValue('แสดงเลขออเดอร์หลังยืนยันการชำระเงิน');
    expect(runtimeErrors).toEqual([]);
  } finally {
    await service.from('artist_promotions').delete().eq('artist_id', userId);
    await service.from('event_products').delete().eq('event_id', eventId);
    await service.from('products').delete().in('id', productIds);
    await service.from('events').delete().eq('id', eventId);
  }
});


test('store creates offers; event selection preserves other channels and cancelled saves', async ({ page }) => {
  test.setTimeout(90000);
  const suffix = randomUUID().slice(0, 8), email = `event-promo-${suffix}@example.test`, password = 'LocalPromotion123!';
  const { service, userId } = await ensureOwnerArtistFixture({ email, password, slug: `event-promo-${suffix}`, displayName: 'Event promotion selection' });
  const eventA = randomUUID(), eventB = randomUUID(), campaign = randomUUID(), product = randomUUID(), order = randomUUID(), competitor = randomUUID();
  const must = (result: { error: unknown }) => { if (result.error) throw result.error; };
  const start = new Date(Date.now() - 3600000).toISOString(), end = new Date(Date.now() + 86400000).toISOString();
  const name = `Reusable offer ${suffix}`;
  try {
    must(await service.from('events').insert([eventA, eventB].map((id, index) => ({ id, artist_id: userId, event_name: `Selection event ${index}`, start_date: new Date(Date.now() - 7200000).toISOString(), end_date: new Date(Date.now() + 172800000).toISOString(), status: 'Confirmed' }))));
    must(await service.from('online_campaigns').insert({ id: campaign, artist_id: userId, name: 'Untouched campaign', slug: campaign, opens_at: start, closes_at: end }));
    must(await service.from('products').insert({ id: product, artist_id: userId, name: 'Selection product', price: 100, status: 'enable', is_unlimited: true }));
    must(await service.from('event_products').insert([eventA, eventB].map(event_id => ({ event_id, artist_id: userId, product_id: product, is_enabled: true, is_unlimited: true }))));
    must(await service.from('online_campaign_products').insert({ campaign_id: campaign, artist_id: userId, product_id: product, is_enabled: true, is_unlimited: true }));
    await page.addInitScript(() => { localStorage.setItem('nireq-language', 'en'); localStorage.setItem('nireq-replay-consent-v1', 'rejected'); });
    await page.goto('/manage-login');
    await page.locator('input[type=email]').fill(email); await page.locator('input[type=password]').fill(password);
    await page.getByRole('button', { name: /Login/i }).click();
    await expect(page).not.toHaveURL(/manage-login/);
    await page.goto('/manage-promotions');
    await page.getByRole('button', { name: 'Create promotion', exact: true }).click();
    const editor = page.locator('#promotion-editor');
    await editor.getByLabel('Promotion name', { exact: true }).fill(name);
    await editor.getByRole('checkbox', { name: /^Discount/ }).check();
    await editor.getByLabel('Amount (THB)', { exact: true }).fill('10');
    await editor.getByRole('button', { name: 'Save promotion', exact: true }).click();
    await expect(editor).toBeHidden();
    const saved = await service.from('artist_promotions').select('id,v1_config').eq('artist_id', userId).single().throwOnError();
    const promotionId = saved.data!.id;
    expect((await service.from('promotion_assignments').select('id').eq('promotion_id', promotionId)).data).toEqual([]);
    must(await service.from('promotion_assignments').insert([
      { promotion_id: promotionId, artist_id: userId, event_id: eventA, event_phase: 'live', starts_at: start, ends_at: end, is_paused: true, combination_policy: 'exclusive' },
      { promotion_id: promotionId, artist_id: userId, event_id: eventB, event_phase: 'postorder', starts_at: start, ends_at: end, is_paused: false, combination_policy: 'combine' },
      { promotion_id: promotionId, artist_id: userId, campaign_id: campaign, starts_at: start, ends_at: end, is_paused: false, combination_policy: 'exclusive' },
    ]));
    must(await service.from('artist_promotions').insert({ id: competitor, artist_id: userId, name: 'Competing offer', target_type: 'all', rule_type: 'discount', promotion_type: 'quantity_discount', buy_quantity: 3, reward_value: 5, lifecycle_status: 'ready' }));
    must(await service.from('promotion_assignments').insert({ promotion_id: competitor, artist_id: userId, event_id: eventA, event_phase: 'live', is_paused: false, combination_policy: 'exclusive' }));
    must(await service.from('orders').insert({ id: order, event_id: eventA, status: 'confirmed', total_price: 90, subtotal_price: 100, discount_total: 10, pricing_breakdown: [{ id: promotionId, name, discount_amount: 10 }] }));
    const assignmentFields = 'id,event_id,event_phase,campaign_id,starts_at,ends_at,is_paused,combination_policy';
    const before = (await service.from('promotion_assignments').select(assignmentFields).eq('promotion_id', promotionId).order('id').throwOnError()).data!;
    const orderBefore = (await service.from('orders').select('*').eq('id', order).single().throwOnError()).data;
    const others = before.filter(item => item.event_id !== eventA);
    await page.goto(`/manage-events/${eventA}/promotion`);
    await expect(page.getByRole('button', { name: 'Create promotion', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Manage store promotions', exact: true })).toHaveAttribute('href', '/manage-promotions');
    const row = page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await row.getByRole('button', { name: 'Select promotion', exact: true }).click();
    const selection = row.getByRole('form', { name: `Assign ${name}` });
    await selection.getByRole('checkbox', { name: 'Live event', exact: true }).check();
    const accessibility = await new AxeBuilder({ page }).include('.promotion-workspace').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(accessibility.violations).toEqual([]);
    page.once('dialog', dialog => dialog.dismiss());
    await selection.getByRole('button', { name: 'Save event selection', exact: true }).click();
    await expect(selection.getByRole('alert')).toContainText('Not saved');
    expect((await service.from('promotion_assignments').select(assignmentFields).eq('promotion_id', promotionId).order('id')).data).toEqual(before);
    page.once('dialog', dialog => dialog.accept());
    await selection.getByRole('button', { name: 'Save event selection', exact: true }).click();
    await expect(selection).toBeHidden();
    await expect(row.getByRole('button', { name: 'Usage settings', exact: true })).toBeFocused();
    await page.screenshot({ path: `output/playwright/event-promotion-selection-${test.info().project.name}.png`, fullPage: true });
    const after = (await service.from('promotion_assignments').select(assignmentFields).eq('promotion_id', promotionId).order('id').throwOnError()).data!;
    expect(after.filter(item => item.event_id !== eventA)).toEqual(others);
    expect(after.find(item => item.event_id === eventA)).toEqual({ ...before.find(item => item.event_id === eventA)!, is_paused: false });
    expect((await service.from('artist_promotions').select('v1_config').eq('id', promotionId).single()).data?.v1_config).toEqual(saved.data!.v1_config);
    await row.getByRole('button', { name: 'Usage settings', exact: true }).click();
    await selection.getByRole('checkbox', { name: 'Live event', exact: true }).uncheck();
    await page.route('**/rest/v1/rpc/save_event_promotion_selection', route => route.fulfill({ status: 503, json: { message: 'test_unavailable' } }));
    await selection.getByRole('button', { name: 'Save event selection', exact: true }).click();
    await expect(selection.getByRole('alert')).toContainText('Could not confirm');
    expect((await service.from('promotion_assignments').select(assignmentFields).eq('promotion_id', promotionId).order('id')).data).toEqual(after);
    await page.unroute('**/rest/v1/rpc/save_event_promotion_selection');
    await selection.getByRole('button', { name: 'Save event selection', exact: true }).click();
    await expect(selection).toBeHidden();
    expect((await service.from('promotion_assignments').select(assignmentFields).eq('promotion_id', promotionId).order('id')).data).toEqual(before);
    expect((await service.from('orders').select('*').eq('id', order).single()).data).toEqual(orderBefore);
    await row.getByRole('button', { name: 'Select promotion', exact: true }).click();
    must(await service.from('artist_promotions').update({ name: 'Changed elsewhere' }).eq('id', promotionId));
    await selection.getByRole('checkbox', { name: 'Live event', exact: true }).check();
    await selection.getByRole('button', { name: 'Save event selection', exact: true }).click();
    await expect(selection.getByRole('alert')).toContainText('The promotion changed');
    expect((await service.from('promotion_assignments').select(assignmentFields).eq('promotion_id', promotionId).order('id')).data).toEqual(before);
    for (const width of [390, 1280]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  } finally {
    must(await service.from('orders').delete().eq('id', order));
    must(await service.from('artist_promotions').delete().eq('artist_id', userId));
    must(await service.from('online_campaigns').delete().eq('id', campaign));
    must(await service.from('events').delete().in('id', [eventA, eventB]));
    must(await service.from('products').delete().eq('id', product));
    must(await service.from('artists').delete().eq('id', userId));
    must(await service.auth.admin.deleteUser(userId));
  }
});
