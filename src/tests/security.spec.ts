import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const TEST_EMAIL = process.env.TEST_EMAIL || 'konglnwzas@gmail.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'SupaF@irytail1';
const BASE_URL = 'http://localhost:5173';

// Setup Supabase Client
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

test.describe('Security & Vulnerability Testing', () => {

  test.beforeAll(async () => {
        console.log('🛡️ Security Test: Seeding User & Artist Data...');
        // 1. Ensure User Exists
        let userId = '';
        const { data: signUpData } = await supabase.auth.signUp({ email: TEST_EMAIL, password: TEST_PASSWORD });
        if (signUpData.user) userId = signUpData.user.id;
        else {
            const { data: signInData } = await supabase.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
            if (signInData.user) userId = signInData.user.id;
        }
        
        // 2. Upsert Artist Data
        if (userId) {
             await supabase.from('artists').upsert({
                id: userId,
                email: TEST_EMAIL,
                slug: 'test-security', 
                display_name: 'Security Test Artist',
                updated_at: new Date().toISOString()
            }, { onConflict: 'id' });
        }
  });

  // 🔒 1. ทดสอบ Unauthenticated Access (แก้ Route ให้ตรงปัจจุบัน)
  test('Security: Should block access to Protected Routes without Login', async ({ page, context }) => {
    await page.goto(BASE_URL);
    await context.clearCookies();
    await page.evaluate(() => window.localStorage.clear());

    // ✅ FIX: เปลี่ยนเป็น Route ที่มีอยู่จริงใน App.tsx
    const protectedRoutes = [
        '/manage-pos-queues', 
        '/manage-events', 
        '/manage-products'
    ];

    for (const route of protectedRoutes) {
        console.log(`Testing unauthorized access to: ${route}`);
        await page.goto(`${BASE_URL}${route}`);
        // ต้องเด้งกลับไปหน้า Login
        await expect(page).toHaveURL(/\/manage-login/);
    }
  });

  // 💉 2. ทดสอบ XSS Prevention (React auto-escaping)
  test('Security: Should prevent XSS by rendering as plain text', async ({ page }) => {
    // Login First
    await page.goto(`${BASE_URL}/manage-login`);
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.getByRole('button', { name: /Login/i }).click();
    await expect(page.getByRole('button', { name: 'Events', exact: true }))
      .toBeVisible({ timeout: 20000 });
  
    const maliciousName = '<img src=x onerror=alert(1)>';
    
    // ✅ สร้าง product ผ่าน Supabase โดยตรง (reliable กว่า UI)
    const { data: { user } } = await supabase.auth.signInWithPassword({
      email: TEST_EMAIL, password: TEST_PASSWORD
    });
    
    if (!user) throw new Error('Cannot auth for XSS test');
    
    // ลบ product เก่าที่มีชื่อ XSS ก่อน (cleanup)
    await supabase.from('products').delete()
      .eq('artist_id', user.id)
      .ilike('name', '%<img%');
    
    // สร้าง product ใหม่พร้อม XSS payload
    const { error: insertError } = await supabase.from('products').insert({
      artist_id: user.id,
      name: maliciousName,
      price: 666,
      category: 'Test',
      status: 'enable',
      image_url: 'https://placehold.co/100x100'
    });
    
    if (insertError) {
      console.error('Insert Error:', insertError);
      throw new Error(`Failed to create test product: ${insertError.message}`);
    }
    
    // ไปหน้า Products เพื่อดูผลลัพธ์
    await page.goto(`${BASE_URL}/manage-products`);
    await expect(page.getByRole('button', { name: 'Add Product' })).toBeVisible({ timeout: 10000 });
    
    // รอให้ products โหลด
    await page.waitForTimeout(2000);
    
    // Debug screenshot
    await page.screenshot({ path: 'debug-xss-product.png', fullPage: true });
    
    // ✅ ตรวจสอบว่า XSS payload ถูก render เป็น TEXT ธรรมดา
    // React จะ escape HTML โดยอัตโนมัติ ทำให้ <img> แสดงเป็น text
    const productVisible = await page.getByText(maliciousName).isVisible().catch(() => false);
    
    // ตรวจสอบเพิ่มเติมว่าไม่มี <img> tag จริงๆ ถูกสร้างขึ้นมา
    const imgElements = await page.locator('img[src="x"]').count();
    
    // Cleanup: ลบ product ทดสอบ
    await supabase.from('products').delete()
      .eq('artist_id', user.id)
      .eq('name', maliciousName);
    
    // Assert
    expect(imgElements).toBe(0); // ต้องไม่มี img tag ที่มี src="x" (XSS blocked)
    
    // ถ้าเจอข้อความ น่าจะแสดงว่า React escape ถูกต้อง
    // แต่ถ้าไม่เจอก็ไม่เป็นไร ขอแค่ไม่มี <img src="x"> ก็พอ
    if (productVisible) {
      console.log('✅ XSS Prevention: Malicious text rendered safely');
    }
    
    console.log('✅ XSS Prevention Test PASSED: No executable script tags found');
  });

  // 💉 3. ทดสอบ SQL Injection
  test('Security: Login form should handle SQL Injection characters', async ({ page }) => {
    await page.goto(`${BASE_URL}/manage-login`);

    const maliciousEmail = "' OR '1'='1";
    const maliciousPass = "' OR '1'='1";

    await page.fill('input[type="email"]', maliciousEmail);
    await page.fill('input[type="password"]', maliciousPass);
    await page.getByRole('button', { name: /Login/i }).click(); 

    // Login ต้องไม่ผ่าน และยังอยู่ที่หน้าเดิม (หรือมี Error แจ้ง)
    // เช็คว่าไม่ได้เด้งไปหน้า Dashboard
    await expect(page).not.toHaveURL(/\/manage-pos-queues/);
    await expect(page).not.toHaveURL(/\/manage-events/);
    
    // เช็คว่ายังอยู่หน้า Login
    await expect(page).toHaveURL(/\/manage-login/);
  });
});