import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// --- CONFIGURATION ---
const TEST_EMAIL = process.env.TEST_EMAIL || 'konglnwzas@gmail.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'SupaF@irytail1';
const BASE_URL = 'http://localhost:5173';

// Setup Supabase Client
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || '***'; // ใส่ Mock หรือค่าจริงใน .env
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SUPABASE_API_PATTERN = '**/rest/v1/**'; 

test.describe('Resilience & Chaos Testing', () => {

  // ✅ SETUP: สร้าง User + Artist + Event (Force "Booth Closed")
  test.beforeAll(async () => {
      console.log('⚡️ Resilience Test: Seeding Data...');
      
      // 1. Auth & User Setup (ใช้ท่า SignUp/SignIn เพื่อเลี่ยง Admin Permission)
      let userId = '';
      const { data: signUpData } = await supabase.auth.signUp({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
      });
      if (signUpData.user) userId = signUpData.user.id;
      else {
          const { data: signInData } = await supabase.auth.signInWithPassword({
              email: TEST_EMAIL,
              password: TEST_PASSWORD,
          });
          if (signInData.user) userId = signInData.user.id;
      }

      if (userId) {
          // 2. Artist Setup (บังคับ Slug และเปิดคิวไว้)
          await supabase.from('artists').upsert({
              id: userId,
              email: TEST_EMAIL,
              slug: 'test1',
              display_name: 'Resilience Test Artist',
              is_queue_open: true,
              updated_at: new Date().toISOString()
          });

          // 3. Event Setup (Timezone Safe & Force CLOSE)
          // เราตั้ง is_booth_open: false เพื่อให้ Customer View เจอคำว่า "Booth Closed" แน่นอน
          const today = new Date().toISOString().split('T')[0];
          await supabase.from('events').delete().eq('artist_id', userId);

          await supabase.from('events').insert({
              artist_id: userId,
              event_name: 'Resilience Chaos Event',
              start_date: today + ' 00:00:00', // เริ่มเที่ยงคืน
              end_date: today + ' 23:59:59',
              status: 'Confirmed',
              is_booth_open: false, // ❌ ปิดบูธ (เพื่อให้เทส Offline ง่ายขึ้น)
              location: 'Resilience Lab'
          });
          console.log('✅ Data seeded successfully for Resilience Test (Booth Closed)');
      }
  });

  // Login ก่อนเริ่ม Test
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
    await expect(page.getByText('Queue Control')).toBeVisible({ timeout: 15000 });

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
    const customerUrl = `${BASE_URL}/test1/queue`; 
    await page.goto(customerUrl);

    // คาดหวัง "Booth Closed" เพราะเรา Seed ไว้แบบนั้น
    const statusText = page.getByText('Booth Closed').or(page.getByText('NOW SERVING')).first();
    await expect(statusText).toBeVisible({ timeout: 15000 });

    console.log('Simulating Offline Mode for Customer...');
    await context.setOffline(true);
    await page.waitForTimeout(2000);

    // เช็คว่า UI ยังอยู่ ไม่ขาว
    await expect(statusText).toBeVisible();
    
    await context.setOffline(false);
    await page.reload();
    await expect(statusText).toBeVisible();
  });
});