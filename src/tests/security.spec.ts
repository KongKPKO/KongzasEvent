import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

const TEST_USER_Y_EMAIL = process.env.TEST_USER_Y_EMAIL || 'local-user-y@example.com';
const TEST_USER_Y_PASS = process.env.TEST_USER_Y_PASS || 'LocalOnlyUserYPassword123!';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';

// Setup Supabase Client
const { url: SUPABASE_URL, anonKey: SUPABASE_KEY } = resolveSupabaseTestEnv();
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

test.describe('Security & Vulnerability Testing', () => {
  // Increase timeout to 2 minutes for slow seeding/auth
  test.setTimeout(120000);

  test.beforeAll(async () => {
    await ensureOwnerArtistFixture({
      email: TEST_USER_Y_EMAIL,
      password: TEST_USER_Y_PASS,
      slug: 'test-security',
      displayName: 'Security Test Artist',
    });
  });


  // 🔒 1. ทดสอบ Unauthenticated Access (แก้ Route ให้ตรงปัจจุบัน)
  test('Security: Should block access to Protected Routes without Login', async ({ page, context }) => {
    // Force clear session
    await page.goto(BASE_URL);
    await page.evaluate(() => localStorage.clear());
    await context.clearCookies();
    await page.reload();

    const protectedRoutes = [
        '/manage-pos-queues', 
        '/manage-events', 
        '/manage-products'
    ];

    for (const route of protectedRoutes) {
        console.log(`Testing unauthorized access to: ${route}`);
        await page.goto(`${BASE_URL}${route}`);
        
        // Check for redirection to login
        // Use waitForURL to be more robust
        await expect(page).toHaveURL(/\/manage-login/);
    }
  });

  // 💉 2. ทดสอบ XSS Prevention (React auto-escaping)
  test('Security: Should prevent XSS by rendering as plain text', async ({ page }) => {
    // Login First - Ensure fresh state
    await page.goto(`${BASE_URL}/manage-login`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.fill('input[type="email"]', TEST_USER_Y_EMAIL);
    await page.fill('input[type="password"]', TEST_USER_Y_PASS);
    await page.getByRole('button', { name: /Login/i }).click();
    
    // Wait for workspace dashboard. The desktop topbar exposes an Events button,
    // while mobile keeps it inside a menu, so the page heading is the stable check.
    await expect(page.getByRole('heading', { name: /Manage profile and events/i }))
      .toBeVisible({ timeout: 20000 });
  
    const maliciousName = '<img src=x onerror=alert(1)>';
    
    // ✅ สร้าง product ผ่าน Supabase โดยตรง (reliable กว่า UI)
    const { data: { user } } = await supabase.auth.signInWithPassword({
      email: TEST_USER_Y_EMAIL, password: TEST_USER_Y_PASS
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
    const productVisible = await page.getByText(maliciousName).isVisible().catch(() => false);
    const imgElements = await page.locator('img[src="x"]').count();
    
    // Cleanup: ลบ product ทดสอบ
    await supabase.from('products').delete()
      .eq('artist_id', user.id)
      .eq('name', maliciousName);
    
    // Assert
    expect(imgElements).toBe(0); 
    
    if (productVisible) {
      console.log('✅ XSS Prevention: Malicious text rendered safely');
    }
    console.log('✅ XSS Prevention Test PASSED: No executable script tags found');
  });

  // 💉 3. ทดสอบ SQL Injection
  test('Security: Login form should handle SQL Injection characters', async ({ page }) => {
    // Ensure fresh login page
    await page.goto(`${BASE_URL}/manage-login`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    const maliciousEmail = "' OR '1'='1";
    const maliciousPass = "' OR '1'='1";

    await page.fill('input[type="email"]', maliciousEmail);
    await page.fill('input[type="password"]', maliciousPass);
    await page.getByRole('button', { name: /Login/i }).click(); 

    // Login ต้องไม่ผ่าน และยังอยู่ที่หน้าเดิม (หรือมี Error แจ้ง)
    await expect(page).not.toHaveURL(/\/manage-pos-queues/);
    await expect(page).not.toHaveURL(/\/manage-events/);
    await expect(page).toHaveURL(/\/manage-login/);
  });
});
