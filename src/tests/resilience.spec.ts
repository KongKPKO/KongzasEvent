import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// --- CONFIGURATION ---
const TEST_EMAIL = process.env.TEST_EMAIL || 'konglnwzas@gmail.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'SupaF@irytail1';
const BASE_URL = 'http://localhost:5173';

// Setup Supabase Client
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJFUzI1NiIsImtpZCI6ImI4MTI2OWYxLTIxZDgtNGYyZS1iNzE5LWMyMjQwYTg0MGQ5MCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjIwODQ2Mzc2ODN9.USpdkBGt_bp9ywixWVdIwdiW4rk7xuNljYkjwBki4rx5_4sM4fbots6paIFQDiuU40eEC2slYEvUqLi4LFyPwg';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SUPABASE_API_PATTERN = '**/rest/v1/**'; 

test.describe('Resilience & Chaos Testing', () => {

  // ✅ 1. เพิ่มส่วนนี้: สร้าง User และ Profile ก่อนเริ่ม Test (สำคัญมากสำหรับ CI)
  test.beforeAll(async () => {
      console.log('⚡️ Resilience Test: Seeding User & Artist Data...');
      
      // 1.1 สร้าง User ใน Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
      });

      if (authError) console.log('Auth Note:', authError.message);

      const userId = authData.user?.id;

      // 1.2 สร้าง Artist Profile ใน Database
      if (userId) {
          const { error: dbError } = await supabase.from('artists').upsert({
              id: userId,
              email: TEST_EMAIL,
              slug: 'test1', // ใช้ slug test1 ให้ตรงกับ test case ข้างล่าง
              display_name: 'Resilience Test Artist',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
          }, { onConflict: 'id' });

          if (dbError) console.error('❌ Failed to seed artist table:', dbError.message);
          else console.log('✅ Artist Profile seeded successfully.');
      }
  });

  // 🛠️ Setup: Login ก่อนเริ่ม Test
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/manage-login`);
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.getByRole('button', { name: 'Login to Dashboard' }).click();
    await expect(page).toHaveURL(/\/manage-events/, { timeout: 15000 });
  });

  // 🔴 Scenario 1: เน็ตหลุดกลางอากาศ (Offline Mode)
  test('Should handle Network Offline gracefully', async ({ page, context }) => {
    await page.goto(`${BASE_URL}/manage-queues`);
    await expect(page.getByText('Queue Control')).toBeVisible({ timeout: 10000 });

    await context.setOffline(true);

    const actionButton = page.getByRole('button', { name: 'Call Next' }).first();
    if (await actionButton.isVisible()) {
        await actionButton.click({ force: true }).catch(() => {});
    }

    await expect(page.getByText('Queue Control')).toBeVisible();
    await context.setOffline(false);
  });

  // 💥 Scenario 2: Server พัง (จำลอง API Error 500)
  test('Should handle API Failure (500 Error)', async ({ page }) => {
    await page.goto(`${BASE_URL}/manage-queues`);

    await page.route(SUPABASE_API_PATTERN, async route => {
        if (['POST', 'PATCH', 'PUT'].includes(route.request().method())) {
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ message: "Internal Server Error (Simulated)" })
            });
        } else {
            await route.continue();
        }
    });

    const statusLabel = page.getByText('Status:', { exact: false });
    if (await statusLabel.isVisible()) {
        await statusLabel.locator('..').click().catch(() => {});
    }

    await expect(page.getByText('Queue Control')).toBeVisible();
  });

  // 📱 Scenario 3: Customer Side
  test('Customer View: Should keep displaying status when Offline', async ({ page, context }) => {
    // ต้องใช้ slug 'test1' ที่เรา seed ไว้ข้างบน
    const customerUrl = `${BASE_URL}/test1/queue`; 
    await page.goto(customerUrl);

    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10000 });
    const statusText = page.getByText('Booth Closed').or(page.getByText('NOW SERVING')).first();
    await expect(statusText).toBeVisible();

    console.log('Simulating Offline Mode for Customer...');
    await context.setOffline(true);
    await page.waitForTimeout(2000);

    await expect(statusText).toBeVisible();
    await context.setOffline(false);
    await page.reload();
    await expect(statusText).toBeVisible();
  });
});