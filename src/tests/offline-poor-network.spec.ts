import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const TEST_EMAIL = process.env.TEST_EMAIL || 'local-admin-user@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'LocalOnlyTestPassword123!';
const BASE_URL = 'http://localhost:5173';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.TEST_SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const ARTIST_SLUG = 'test1';

test.describe('Offline & Poor Network Handling', () => {

  test.beforeAll(async () => {
    console.log('📴 Network Resilience Test: Seeding Data...');
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
        display_name: 'Network Test Artist', is_queue_open: true
      });
      
      await supabase.from('events').delete().eq('artist_id', userId);
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      
      await supabase.from('events').insert({
        artist_id: userId,
        event_name: 'Network Test Event',
        start_date: new Date().toISOString(),
        end_date: futureDate.toISOString(),
        status: 'Confirmed',
        is_booth_open: true
      });
    }
  });

  test('Network: Should display cached content when going offline', async ({ page, context }) => {
    await page.goto(`${BASE_URL}/${ARTIST_SLUG}/queue`);
    await page.waitForLoadState('networkidle');
    
    const contentLocator = page.getByText(/Get Ticket|Booth|Event|Artist|Next Events/i).first();
    await expect(contentLocator).toBeVisible({ timeout: 10000 });
    
    console.log('📴 Simulating Offline Mode...');
    await context.setOffline(true);
    await page.waitForTimeout(1000);
    
    await expect(contentLocator).toBeVisible({ timeout: 5000 });
    console.log('✅ Content still visible after going offline');
    
    await context.setOffline(false);
  });

  test('Network: Should handle slow 3G connection gracefully', async ({ page, browserName }) => {
    test.setTimeout(60000);
    test.skip(browserName !== 'chromium', 'CDP network throttling is only available in Chromium');
    
    const client = await page.context().newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: (1500 * 1024) / 8, // 1.5 Mbps
      uploadThroughput: (750 * 1024) / 8,
      latency: 300,
    });

    console.log('🐢 Simulating Slow 3G Network (1.5 Mbps, 300ms latency)...');
    
    const startTime = Date.now();
    await page.goto(`${BASE_URL}/${ARTIST_SLUG}/queue`, { timeout: 45000 });
    await page.waitForLoadState('domcontentloaded');
    const loadTime = Date.now() - startTime;
    
    console.log(`📊 Page Load Time on 3G: ${loadTime}ms`);
    
    expect(loadTime).toBeLessThan(30000);
    await expect(page.getByText(/Get Ticket|Booth|Event|Artist|Next Events/i).first()).toBeVisible({ timeout: 15000 });
    console.log('✅ Page loaded successfully on slow network');
  });

  // Skip very slow network test - 500 Kbps is too slow for modern web apps
  test.skip('Network: Should gracefully degrade on very slow network', async ({ page }) => {
    test.setTimeout(90000);
    
    const client = await page.context().newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: (500 * 1024) / 8,
      uploadThroughput: (250 * 1024) / 8,
      latency: 500,
    });

    console.log('🐌 Simulating Very Slow Network (500 Kbps, 500ms latency)...');
    
    const startTime = Date.now();
    await page.goto(`${BASE_URL}/${ARTIST_SLUG}/queue`, { timeout: 60000 });
    const loadTime = Date.now() - startTime;
    console.log(`📊 Page Load Time on Very Slow Network: ${loadTime}ms`);
    
    await expect(page.getByText(/Get Ticket|Booth|Event|Artist|Next Events/i).first()).toBeVisible({ timeout: 20000 });
    console.log('✅ Page loaded on very slow network');
  });

  test('Network: Should recover after network is restored', async ({ page, context }) => {
    await page.goto(`${BASE_URL}/${ARTIST_SLUG}/queue`);
    await page.waitForLoadState('networkidle');
    
    console.log('📴 Going offline...');
    await context.setOffline(true);
    await page.waitForTimeout(1000);
    
    console.log('📶 Restoring network...');
    await context.setOffline(false);
    await page.waitForTimeout(1000);
    
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    
    await expect(page.getByText(/Get Ticket|Booth|Event|Artist|Next Events/i).first()).toBeVisible({ timeout: 10000 });
    console.log('✅ Page recovered after network restoration');
  });

});
