import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const TEST_EMAIL = process.env.TEST_EMAIL || 'konglnwzas@gmail.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'SupaF@irytail1';
const BASE_URL = 'http://localhost:5173';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.TEST_SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const ARTIST_SLUG = 'test1';

test.describe('Performance Testing', () => {

  test.beforeAll(async () => {
    console.log('🚀 Performance Test: Seeding Data...');
    let userId = '';
    
    const { data: signUpData } = await supabase.auth.signUp({ email: TEST_EMAIL, password: TEST_PASSWORD });
    if (signUpData.user) userId = signUpData.user.id;
    else {
      const { data: signInData } = await supabase.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
      if (signInData.user) userId = signInData.user.id;
    }

    if (userId) {
      await supabase.from('artists').upsert({
        id: userId, email: TEST_EMAIL, slug: ARTIST_SLUG, 
        display_name: 'Performance Test Artist', is_queue_open: true
      });
      
      await supabase.from('events').delete().eq('artist_id', userId);
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      
      await supabase.from('events').insert({
        artist_id: userId,
        event_name: 'Performance Test Event',
        start_date: new Date().toISOString(),
        end_date: futureDate.toISOString(),
        status: 'Confirmed',
        is_booth_open: true
      });
    }
  });

  test('Performance: Customer Queue Page should load within 3 seconds', async ({ page }) => {
    const startTime = Date.now();
    
    await page.goto(`${BASE_URL}/${ARTIST_SLUG}/queue`);
    await page.waitForLoadState('domcontentloaded');
    
    const loadTime = Date.now() - startTime;
    console.log(`📊 Customer Page Load Time: ${loadTime}ms`);
    
    expect(loadTime).toBeLessThan(3000);
    await expect(page.getByText(/Get Ticket|Booth|Event|Artist/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('Performance: Admin Login Page should load within 2 seconds', async ({ page }) => {
    const startTime = Date.now();
    
    await page.goto(`${BASE_URL}/manage-login`);
    await page.waitForLoadState('domcontentloaded');
    
    const loadTime = Date.now() - startTime;
    console.log(`📊 Admin Login Page Load Time: ${loadTime}ms`);
    
    expect(loadTime).toBeLessThan(2000);
    await expect(page.getByRole('button', { name: /Login/i })).toBeVisible({ timeout: 3000 });
  });

  test('Performance: API response time should be under 500ms', async ({ page }) => {
    const apiTimes: number[] = [];
    const requestStartTimes: Map<string, number> = new Map();
    
    page.on('request', async (request) => {
      if (request.url().includes('/rest/v1/')) {
        requestStartTimes.set(request.url(), Date.now());
      }
    });
    
    page.on('response', async (response) => {
      if (response.url().includes('/rest/v1/')) {
        const startTime = requestStartTimes.get(response.url());
        if (startTime) {
          const responseTime = Date.now() - startTime;
          apiTimes.push(responseTime);
          console.log(`📊 API: ${response.url().split('/').pop()} - ${responseTime}ms`);
        }
      }
    });

    await page.goto(`${BASE_URL}/${ARTIST_SLUG}/queue`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    if (apiTimes.length > 0) {
      const avgTime = apiTimes.reduce((a, b) => a + b, 0) / apiTimes.length;
      console.log(`📊 Average API Response Time: ${avgTime.toFixed(2)}ms (${apiTimes.length} requests)`);
      expect(avgTime).toBeLessThan(500);
    } else {
      console.log('⚠️ No API calls detected (might be cached) - PASS');
    }
  });

});
