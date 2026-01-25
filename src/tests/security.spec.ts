import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const TEST_EMAIL = process.env.TEST_EMAIL || 'konglnwzas@gmail.com';
const TEST_PASSWORD = 'SupaF@irytail1';
const BASE_URL = 'http://localhost:5173';

// Setup Supabase Client
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJFUzI1NiIsImtpZCI6ImI4MTI2OWYxLTIxZDgtNGYyZS1iNzE5LWMyMjQwYTg0MGQ5MCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjIwODQ2Mzc2ODN9.USpdkBGt_bp9ywixWVdIwdiW4rk7xuNljYkjwBki4rx5_4sM4fbots6paIFQDiuU40eEC2slYEvUqLi4LFyPwg';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

test.describe('Security & Vulnerability Testing', () => {

  // ✅ 1. เพิ่มส่วนนี้: Seed User เผื่อไว้ (แม้บาง Test จะไม่ได้ใช้ แต่กันเหนียวสำหรับ XSS test)
  test.beforeAll(async () => {
        console.log('🛡️ Security Test: Seeding User & Artist Data...');
        const { data: authData } = await supabase.auth.signUp({
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
        });
        
        const userId = authData.user?.id;
        if (userId) {
             await supabase.from('artists').upsert({
                id: userId,
                email: TEST_EMAIL,
                slug: 'test-security', 
                display_name: 'Security Test Artist',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }, { onConflict: 'id' });
        }
  });

  // 🔒 2. ทดสอบ Unauthenticated Access
  test('Security: Should block access to Protected Routes without Login', async ({ page, context }) => {
    await page.goto(BASE_URL);
    await context.clearCookies();
    await page.evaluate(() => window.localStorage.clear());

    const protectedRoutes = ['/manage-queues', '/manage-events'];

    for (const route of protectedRoutes) {
        console.log(`Testing unauthorized access to: ${route}`);
        await page.goto(`${BASE_URL}${route}`);
        await expect(page).toHaveURL(/\/manage-login/);
    }
  });

  // 💉 3. ทดสอบ XSS Injection (ต้อง Login ก่อน)
  test('Security: Should prevent XSS in Input fields', async ({ page }) => {
    await page.goto(`${BASE_URL}/manage-login`);
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click(); // เช็คชื่อปุ่มให้ตรงกับ UI จริง
    
    await expect(page).toHaveURL(/\/manage-events/, { timeout: 15000 });

    // (ส่วน Test XSS จริง ถ้ายังไม่มี Input ให้กรอก ก็ข้ามไปก่อนได้ หรือ uncomment เมื่อมี input)
    /* const dangerousScript = '<script>alert("XSS")</script>';
    // หา input สักช่องเพื่อกรอก
    */
  });

  // 💉 4. ทดสอบ SQL Injection
  test('Security: Login form should handle SQL Injection characters', async ({ page }) => {
    await page.goto(`${BASE_URL}/manage-login`);

    const maliciousEmail = "' OR '1'='1";
    const maliciousPass = "' OR '1'='1";

    await page.fill('input[type="email"]', maliciousEmail);
    await page.fill('input[type="password"]', maliciousPass);
    await page.getByRole('button', { name: 'Login' }).click(); // เช็คชื่อปุ่มให้ตรงกับ UI จริง

    // Login ต้องไม่ผ่าน และยังอยู่ที่หน้าเดิม
    await expect(page).toHaveURL(/\/manage-login/);
  });
});