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

  // ✅ SETUP: สร้าง User + Artist + Event ให้ครบก่อนเริ่ม
  test.beforeAll(async () => {
      console.log('⚡️ Resilience Test: Seeding Data...');
      
      // 1.1 สร้าง User (Auth)
      const { data: authData } = await supabase.auth.signUp({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
      });
      const userId = authData.user?.id;

      if (userId) {
          // 1.2 สร้าง Artist Profile (Database)
          const { error: artistError } = await supabase.from('artists').upsert({
              id: userId,
              email: TEST_EMAIL,
              slug: 'test1', // slug ต้องตรงกับที่ Customer View เรียกใช้
              display_name: 'Resilience Test Artist',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
          }, { onConflict: 'id' });

          if (artistError) console.error('❌ Failed to seed artist:', artistError.message);

          // 1.3 สร้าง Event (เพื่อให้หน้า Customer มีข้อมูลแสดง)
          // เช็คก่อนว่ามี Event หรือยัง ถ้าไม่มีค่อยสร้าง
          const { data: events } = await supabase.from('events').select('id').eq('artist_id', userId);
          
          if (!events || events.length === 0) {
              await supabase.from('events').insert({
                  artist_id: userId,
                  event_name: 'Resilience Chaos Event',
                  start_date: new Date().toISOString(),
                  end_date: new Date(Date.now() + 86400000).toISOString(), // จบพรุ่งนี้
                  is_booth_open: false, // ตั้งเป็นปิด เพื่อให้เจอคำว่า "Booth Closed"
                  status: 'Confirmed'
              });
              console.log('✅ Event seeded successfully.');
          } else {
              // ถ้ามีอยู่แล้ว ให้ Force Update เป็นปิดบูธ เพื่อให้ตรงกับ Test Case
              await supabase.from('events').update({ is_booth_open: false }).eq('artist_id', userId);
              console.log('ℹ️ Event exists, forced status to Booth Closed.');
          }
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
    // ใช้ slug 'test1' ที่เรา seed ไว้
    const customerUrl = `${BASE_URL}/test1/queue`; 
    await page.goto(customerUrl);

    // เพิ่ม Timeout 15000 (15วิ) ตามคำแนะนำของ Github Actions เพื่อความชัวร์
    const statusText = page.getByText('Booth Closed').or(page.getByText('NOW SERVING')).first();
    
    // รอให้โหลดเสร็จจริงๆ
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