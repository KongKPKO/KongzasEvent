import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const TEST_EMAIL = process.env.TEST_EMAIL || 'konglnwzas@gmail.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'SupaF@irytail1';
const BASE_URL = 'http://localhost:5173'; // หรือ URL ที่ใช้รันจริง
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.TEST_SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_KEY || ''; 

// Setup Supabase Client for Seeding
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const SUPABASE_API_PATTERN = '**/rest/v1/**'; 

test.describe('Resilience & Chaos Testing', () => {

  test.beforeAll(async () => {
      console.log('⚡️ Resilience Test: Seeding Data...');
      let userId = '';
      
      // 1. Get User ID (Sign Up or Sign In)
      const { data: signUpData } = await supabase.auth.signUp({ email: TEST_EMAIL, password: TEST_PASSWORD });
      if (signUpData.user) userId = signUpData.user.id;
      else {
          const { data: signInData } = await supabase.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
          if (signInData.user) userId = signInData.user.id;
      }

      if (userId) {
          // 2. Upsert Artist (Update first to avoid conflict)
          const { error: updateError, data } = await supabase.from('artists').update({
              slug: 'test1', 
              display_name: 'Resilience Test Artist', 
              is_queue_open: true, 
              updated_at: new Date().toISOString()
          }).eq('id', userId).select();

          if (updateError || !data || data.length === 0) {
              // If update failed (row doesn't exist), Insert
              await supabase.from('artists').insert({
                  id: userId, email: TEST_EMAIL, slug: 'test1', display_name: 'Resilience Test Artist', is_queue_open: true, updated_at: new Date().toISOString()
              });
          }

          // 3. Reset & Create Event
          const today = new Date().toISOString().split('T')[0];
          await supabase.from('events').delete().eq('artist_id', userId);
          
          const futureDate = new Date();
          futureDate.setDate(futureDate.getDate() + 1);

          await supabase.from('events').insert({
              artist_id: userId, 
              event_name: 'Resilience Chaos Event', 
              start_date: today + ' 00:00:00', 
              end_date: futureDate.toISOString(), 
              status: 'Confirmed', 
              is_booth_open: true // ✅ เปิดร้านไว้ เพื่อให้หน้า Admin เห็น UI ครบ
          });
      }
  });

test.beforeEach(async ({ page }) => {
    // Login Admin
    await page.goto(`${BASE_URL}/manage-login`);
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.getByRole('button', { name: /Login/i }).click();
    
    // ✅ FIX: รอจนกว่าจะเจอ Element ของหน้า Dashboard จริงๆ (ไม่ใช่แค่ URL)
    // เช่น รอเมนู "Events" หรือ "POS"
    await expect(page.getByText('Events', { exact: false }).first()).toBeVisible({ timeout: 20000 });
    
    // หรือถ้าระบบ Redirect ไปหน้า Events อัตโนมัติ เช็ค URL
    await expect(page).toHaveURL(/.*manage-/, { timeout: 20000 });
  });

  test('Should handle Network Offline gracefully', async ({ page, context }) => {
     // ✅ FIX: ไปหน้าใหม่ Unified POS
     await page.goto(`${BASE_URL}/manage-pos-queues`);
     
     // ✅ FIX: เช็ค element ที่มีจริงในหน้าใหม่ (Tab "Walk-in")
     const indicator = page.getByText('Walk-in').first();
     await expect(indicator).toBeVisible({ timeout: 15000 });
     
     // Simulate Offline
     await context.setOffline(true);
     await expect(indicator).toBeVisible(); // UI ต้องไม่หาย
     
     // Restore Online
     await context.setOffline(false);
  });

  test('Should handle API Failure (500 Error)', async ({ page }) => {
    await page.goto(`${BASE_URL}/manage-pos-queues`);
    
    // Intercept API calls to simulate 500 Error
    await page.route(SUPABASE_API_PATTERN, async route => {
        if (['POST', 'PATCH', 'PUT'].includes(route.request().method())) {
            await route.fulfill({ status: 500, body: JSON.stringify({ message: "Simulated Server Error" }) });
        } else {
            await route.continue();
        }
    });

    // ✅ FIX: เช็คว่า UI หลักยังอยู่ (Walk-in Tab) ไม่จอขาว
    await expect(page.getByText('Walk-in').first()).toBeVisible({ timeout: 10000 });
  });

  test('Customer View: Should keep displaying status when Offline', async ({ page, context }) => {
    const customerUrl = `${BASE_URL}/test1/queue`; 
    
    // Wait for initial data
    const dataPromise = page.waitForResponse(
        resp => resp.url().includes('/rest/v1/artists') && resp.status() >= 200,
        { timeout: 30000 }
    ).catch(() => console.log('⚠️ API wait timeout but continuing...'));

    await page.goto(customerUrl);
    await dataPromise;
    await page.waitForTimeout(2000); // Wait for React to render

    // Selector: หา Text สถานะอะไรก็ได้ที่บ่งบอกว่าหน้าโหลดติด
    // (Get Ticket, Open, Closed, Paused, Queue Closed, etc.)
    const statusText = page.getByText(/Get Ticket|Queue Open|Booth Closed|Booth Open|NOW SERVING|Queuing is closed|Closed|Paused|Tickets|Resilience Test Artist|Next Events/i).first();

    // Retry Logic if slow
    if (!(await statusText.isVisible({ timeout: 5000 }))) {
        console.log('⚠️ Status not found. Reloading...');
        await page.reload();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);
    }
    
    await expect(statusText).toBeVisible({ timeout: 10000 });

    console.log('Simulating Offline Mode for Customer...');
    await context.setOffline(true);
    await page.waitForTimeout(1000); 

    // UI ควรยังแสดงผลเหมือนเดิม (ไม่ Crash)
    await expect(statusText).toBeVisible({ timeout: 5000 });
    
    await context.setOffline(false);
  });
});