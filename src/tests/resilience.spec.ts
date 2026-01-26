import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const TEST_EMAIL = process.env.TEST_EMAIL || 'konglnwzas@gmail.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'SupaF@irytail1';
const BASE_URL = 'http://localhost:5173';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || '***'; 
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const SUPABASE_API_PATTERN = '**/rest/v1/**'; 

test.describe('Resilience & Chaos Testing', () => {

  test.beforeAll(async () => {
      // ... (ส่วน Setup Data เหมือนเดิมเป๊ะ ไม่ต้องแก้) ...
      console.log('⚡️ Resilience Test: Seeding Data...');
      let userId = '';
      const { data: signUpData } = await supabase.auth.signUp({ email: TEST_EMAIL, password: TEST_PASSWORD });
      if (signUpData.user) userId = signUpData.user.id;
      else {
          const { data: signInData } = await supabase.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
          if (signInData.user) userId = signInData.user.id;
      }

      if (userId) {
          await supabase.from('artists').upsert({
              id: userId, email: TEST_EMAIL, slug: 'test1', display_name: 'Resilience Test Artist', is_queue_open: true, updated_at: new Date().toISOString()
          });
          const today = new Date().toISOString().split('T')[0];
          await supabase.from('events').delete().eq('artist_id', userId);
          await supabase.from('events').insert({
              artist_id: userId, event_name: 'Resilience Chaos Event', start_date: today + ' 00:00:00', end_date: today + ' 23:59:59', status: 'Confirmed', is_booth_open: false, location: 'Resilience Lab'
          });
      }
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/manage-login`);
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.getByRole('button', { name: 'Login to Dashboard' }).click();
    await expect(page).toHaveURL(/\/manage-events/, { timeout: 15000 });
  });

  // Scenario 1 & 2 เหมือนเดิม (ข้ามไป) ...
  test('Should handle Network Offline gracefully', async ({ page, context }) => {
     await page.goto(`${BASE_URL}/manage-queues`);
     await expect(page.getByText('Queue Control')).toBeVisible({ timeout: 15000 });
     await context.setOffline(true);
     await expect(page.getByText('Queue Control')).toBeVisible();
     await context.setOffline(false);
  });

  test('Should handle API Failure (500 Error)', async ({ page }) => {
    await page.goto(`${BASE_URL}/manage-queues`);
    await page.route(SUPABASE_API_PATTERN, async route => {
        if (['POST', 'PATCH', 'PUT'].includes(route.request().method())) await route.fulfill({ status: 500, body: JSON.stringify({ message: "Error" }) });
        else await route.continue();
    });
    await expect(page.getByText('Queue Control')).toBeVisible();
  });

  // ✅✅✅ แก้ตรงนี้ (Customer View) ✅✅✅
  test('Customer View: Should keep displaying status when Offline', async ({ page, context }) => {
    const customerUrl = `${BASE_URL}/test1/queue`; 
    
    // 1. ดักรอข้อมูล Supabase
    const dataPromise = page.waitForResponse(resp => 
        resp.url().includes('/rest/v1/artists') && resp.status() === 200
    );

    await page.goto(customerUrl);
    
    // 2. รอให้ข้อมูลมาจริงๆ
    await dataPromise;
    await page.waitForTimeout(500);

    const statusText = page.getByText('Booth Closed').or(page.getByText('NOW SERVING')).first();

    // 3. Retry Logic ถ้ายังไม่มา
    if (!(await statusText.isVisible({ timeout: 3000 }))) {
        console.log('⚠️ Status not found. Reloading...');
        const retryPromise = page.waitForResponse(resp => resp.url().includes('/rest/v1/artists') && resp.status() === 200);
        await page.reload();
        await retryPromise;
    }
    
    await expect(statusText).toBeVisible({ timeout: 10000 });

    console.log('Simulating Offline Mode for Customer...');
    await context.setOffline(true);
    await page.waitForTimeout(1000); 

    // เช็คว่า UI ยังอยู่ (Offline Tolerance)
    await expect(statusText).toBeVisible({ timeout: 5000 });
    
    await context.setOffline(false);
  });
});