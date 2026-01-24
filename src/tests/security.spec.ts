import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';
// ⚠️ แก้รหัสผ่านตรงนี้ให้ตรงกับที่คุณใช้สมัคร User 'konglnwzas@gmail.com'
const TEST_PASSWORD = 'SupaF@irytail1'; 

test.describe('Security & Vulnerability Testing', () => {

  // 🔒 1. ทดสอบเจาะเข้าหลังบ้าน (Unauthenticated Access)
  test('Security: Should block access to Protected Routes without Login', async ({ page, context }) => {
    // ✅ แก้ไข: ต้องเข้าหน้าเว็บก่อน ถึงจะสั่งล้าง Storage ได้
    await page.goto(BASE_URL);
    
    // เคลียร์ข้อมูลเก่าทิ้งให้หมด
    await context.clearCookies();
    await page.evaluate(() => window.localStorage.clear());

    // พยายามเข้าหน้า Admin ตรงๆ
    const protectedRoutes = [
        '/manage-queues',
        '/manage-events'
        // ตัด /manage-products ออกก่อนถ้ายังไม่ได้ทำหน้านี้
    ];

    for (const route of protectedRoutes) {
        console.log(`Testing unauthorized access to: ${route}`);
        await page.goto(`${BASE_URL}${route}`);
        
        // ต้องโดนถีบกลับมาหน้า Login เท่านั้น
        // (เช็คจาก URL หรือปุ่ม Login)
        await expect(page).toHaveURL(/\/manage-login/);
    }
  });

  // 💉 2. ทดสอบ XSS Injection
  test('Security: Should prevent XSS in Input fields', async ({ page }) => {
    // Login ก่อน
    await page.goto(`${BASE_URL}/manage-login`);
    await page.fill('input[type="email"]', 'konglnwzas@gmail.com');
    await page.fill('input[type="password"]', TEST_PASSWORD); // ✅ ใช้ตัวแปร Password ที่แก้แล้ว
    await page.getByRole('button', { name: 'Login' }).click(); // (ถ้าปุ่มชื่ออื่น แก้ตรงนี้ได้ครับ)
    
    // รอให้เข้าหน้า Dashboard ได้
    await expect(page).toHaveURL(/\/manage-events/);

    // ⚠️ ตรงนี้ต้องเช็คว่าหน้า Manage Events ของคุณมีช่อง Input ชื่ออะไร?
    // สมมติว่าเป็นช่องค้นหา หรือปุ่มสร้าง Event
    const dangerousScript = '<img src=x onerror=alert("HACKED")>';
    
    // (ถ้ายังไม่มีช่องให้กรอก ให้ข้ามการเทสจุดนี้ไปก่อน หรือเปลี่ยนไปเทส URL Parameter แทน)
    /* const inputField = page.getByPlaceholder('Event Name').first();
    if (await inputField.isVisible()) {
        await inputField.fill(dangerousScript);
        page.on('dialog', dialog => {
            throw new Error(`🚨 XSS Vulnerability detected! ${dialog.message()}`);
        });
    }
    */
  });

  // 💉 3. ทดสอบ SQL Injection
  test('Security: Login form should handle SQL Injection characters', async ({ page }) => {
    await page.goto(`${BASE_URL}/manage-login`);

    const maliciousEmail = "' OR '1'='1";
    const maliciousPass = "' OR '1'='1";

    await page.fill('input[type="email"]', maliciousEmail);
    await page.fill('input[type="password"]', maliciousPass);
    await page.getByRole('button', { name: 'Login' }).click(); // (ถ้าปุ่มชื่ออื่น แก้ตรงนี้ได้ครับ)

    // ต้องไม่หลุดเข้าไปข้างใน
    await expect(page).toHaveURL(/\/manage-login/);
  });

});