import { test, expect } from '@playwright/test';

const TEST_EMAIL = process.env.TEST_EMAIL || 'konglnwzas@gmail.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'SupaF@irytail1';
const BASE_URL = 'http://localhost:5173';

// URL ของ Supabase Local (ที่ React ยิงไปหา)
// ใช้ * ดักหน้าหลังเผื่อ path ยาวๆ
const SUPABASE_API_PATTERN = '**/rest/v1/**'; 

test.describe('Resilience & Chaos Testing', () => {

  // 🛠️ Setup: ต้อง Login ก่อนทุกครั้งที่จะเทส
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/manage-login`);
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.getByRole('button', { name: 'Login to Dashboard' }).click();
    await expect(page).toHaveURL(/\/manage-events/);
  });

  // 🔴 Scenario 1: เน็ตหลุดกลางอากาศ (Offline Mode)
  test('Should handle Network Offline gracefully', async ({ page, context }) => {
    await page.goto(`${BASE_URL}/manage-queues`);
    
    // ✅ แก้ไข: เพิ่มบรรทัดนี้! รอให้โหลด Dashboard เสร็จก่อน (จนเห็นคำว่า Queue Control)
    await expect(page.getByText('Queue Control')).toBeVisible({ timeout: 10000 });

    // 1. พอโหลดเสร็จแล้ว ค่อยจำลองว่าเน็ตหลุด
    await context.setOffline(true);

    // 2. พยายามกดปุ่มทำงาน (เช่น Call Next)
    const actionButton = page.getByRole('button', { name: 'Call Next' }).first();
    
    if (await actionButton.isVisible()) {
        // ลองกดปุ่มตอนเน็ตหลุด
        await actionButton.click({ force: true });
    }

    // 3. สิ่งที่คาดหวัง:
    // - แอปต้องไม่พัง (หน้าจอต้องไม่ขาว และยังเห็นเมนูเดิม)
    await expect(page.getByText('Queue Control')).toBeVisible();
    
    // 4. ต่อเน็ตกลับ (คืนสภาพเดิมให้ Test อื่น)
    await context.setOffline(false);
  });

  // 💥 Scenario 2: Server พัง (จำลอง API Error 500)
  test('Should handle API Failure (500 Error)', async ({ page }) => {
    await page.goto(`${BASE_URL}/manage-queues`);

    // 1. เตรียมดักเส้นทาง API ของ Supabase
    // ถ้ามีการยิง Request ไปหา Supabase ให้ตอบกลับว่า "พัง (500)" ทันที
    await page.route(SUPABASE_API_PATTERN, async route => {
        // เฉพาะ method PATCH หรือ POST (การแก้ไขข้อมูล)
        if (['POST', 'PATCH', 'PUT'].includes(route.request().method())) {
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ message: "Internal Server Error (Simulated)" })
            });
        } else {
            await route.continue(); // ถ้าแค่ดึงข้อมูล (GET) ให้ผ่านไปได้ปกติ
        }
    });

    // 2. พยายามแก้ไขข้อมูล (เช่น กด Toggle เปิด/ปิดร้าน)
    // หาปุ่ม Switch หรือ Status
    const statusLabel = page.getByText('Status:', { exact: false });
    if (await statusLabel.isVisible()) {
        await statusLabel.locator('..').click(); // คลิก
    }

    // 3. สิ่งที่คาดหวัง:
    // - หน้าเว็บต้องไม่ขาว (Crash)
    // - ปุ่ม Toggle ควรเด้งกลับ หรือมีข้อความแจ้งเตือนสีแดง
    
    // เช็คว่าหน้าเว็บยังอยู่ดี
    await expect(page.getByText('Queue Control')).toBeVisible();
    
    // เช็คว่ามีข้อความ Error เด้งมาไหม (ลองแก้คำตาม UI จริงของคุณ)
    // await expect(page.getByText('Error')).toBeVisible(); 
  });

  // 📱 Scenario 3: Customer Side - เน็ตหลุดขณะรอคิว
  test('Customer View: Should keep displaying status when Offline', async ({ page, context }) => {
    // 1. เข้าหน้าจอลูกค้า (ใช้ Slug 'test1' ที่เราเตรียมไว้)
    const customerUrl = `${BASE_URL}/test1/queue`;
    await page.goto(customerUrl);

    // 2. รอให้โหลดข้อมูลเสร็จก่อน (เห็นสถานะร้าน หรือชื่อร้าน)
    // ตรงนี้สำคัญ: ต้องรอให้เห็น UI ก่อนตัดเน็ต
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10000 });
    const statusText = page.getByText('Booth Closed').or(page.getByText('NOW SERVING')).first();
    await expect(statusText).toBeVisible();

    // 3. ✂️ จำลองเน็ตหลุด (Customer เดินเข้าจุดอับสัญญาณ)
    console.log('Simulating Offline Mode for Customer...');
    await context.setOffline(true);

    // 4. รอสักพัก (เพื่อดูว่า UI จะพังไหม)
    await page.waitForTimeout(2000);

    // 5. สิ่งที่คาดหวัง:
    // - หน้าเว็บ "ห้ามขาว" (Crash)
    // - ข้อมูลล่าสุดที่เคยโหลดมา "ต้องยังอยู่" (Stale Data is better than No Data)
    await expect(statusText).toBeVisible();
    
    // (Optional) ถ้าแอปคุณดีจริง ควรมีแถบแจ้งเตือนเล็กๆ ว่า "No Internet Connection"
    // await expect(page.getByText('No Internet')).toBeVisible();

    // 6. 🌐 ต่อเน็ตกลับ (Customer เดินออกมาหาคลื่น)
    await context.setOffline(false);
    
    // 7. ลอง Reload อีกทีเพื่อให้มั่นใจว่ากลับมาทำงานได้
    await page.reload();
    await expect(statusText).toBeVisible();
  });
});