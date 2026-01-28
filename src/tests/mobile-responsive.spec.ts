import { test, expect, devices } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const TEST_EMAIL = process.env.TEST_EMAIL || 'konglnwzas@gmail.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'SupaF@irytail1';
const BASE_URL = 'http://localhost:5173';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const ARTIST_SLUG = 'test1';

test.describe('Mobile Responsive Testing', () => {

  test.beforeAll(async () => {
    console.log('📱 Mobile Responsive Test: Seeding Data...');
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
        display_name: 'Mobile Test Artist', is_queue_open: true
      });
      
      await supabase.from('events').delete().eq('artist_id', userId);
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      
      await supabase.from('events').insert({
        artist_id: userId,
        event_name: 'Mobile Test Event',
        start_date: new Date().toISOString(),
        end_date: futureDate.toISOString(),
        status: 'Confirmed',
        is_booth_open: true
      });
    }
  });

  test('Mobile: Customer Queue Page should be responsive on iPhone 12', async ({ browser }) => {
    const context = await browser.newContext({
      ...devices['iPhone 12'],
    });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/${ARTIST_SLUG}/queue`);
    await page.waitForLoadState('domcontentloaded');
    
    await page.screenshot({ path: 'screenshots/mobile-iphone12-queue.png', fullPage: true });
    
    const viewport = page.viewportSize();
    console.log(`📱 iPhone 12 Viewport: ${viewport?.width}x${viewport?.height}`);
    expect(viewport?.width).toBe(390);
    
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewport!.width + 10);
    
    await expect(page.getByText(/Get Ticket|Booth|Event|Artist/i).first()).toBeVisible({ timeout: 5000 });
    
    await context.close();
  });

  test('Mobile: Customer Queue Page should be responsive on Samsung Galaxy S21', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 360, height: 800 },
      userAgent: 'Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36',
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/${ARTIST_SLUG}/queue`);
    await page.waitForLoadState('domcontentloaded');
    
    await page.screenshot({ path: 'screenshots/mobile-galaxy-s21-queue.png', fullPage: true });
    
    const viewport = page.viewportSize();
    console.log(`📱 Galaxy S21 Viewport: ${viewport?.width}x${viewport?.height}`);
    expect(viewport?.width).toBe(360);
    
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewport!.width + 10);
    
    await expect(page.getByText(/Get Ticket|Booth|Event|Artist/i).first()).toBeVisible({ timeout: 5000 });
    
    await context.close();
  });

  test('Mobile: Admin POS Page should be responsive on iPad', async ({ browser }) => {
    const context = await browser.newContext({
      ...devices['iPad Mini'],
    });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/manage-login`);
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.getByRole('button', { name: /Login/i }).click();
    
    await expect(page.getByText('Logout', { exact: false }).first()).toBeVisible({ timeout: 20000 });
    
    await page.goto(`${BASE_URL}/manage-pos-queues`);
    await page.waitForLoadState('networkidle');
    
    await page.screenshot({ path: 'screenshots/tablet-ipad-pos.png', fullPage: true });
    
    const viewport = page.viewportSize();
    console.log(`📱 iPad Mini Viewport: ${viewport?.width}x${viewport?.height}`);
    
    await expect(page.getByText('Walk-in').first()).toBeVisible({ timeout: 10000 });
    
    await context.close();
  });

  test('Mobile: Get Ticket button should be touch-friendly (min 44px)', async ({ browser }) => {
    const context = await browser.newContext({
      ...devices['iPhone 12'],
    });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/${ARTIST_SLUG}/queue`);
    await page.waitForLoadState('domcontentloaded');
    
    const button = page.getByRole('button', { name: /Get Ticket/i }).first();
    
    if (await button.isVisible({ timeout: 5000 }).catch(() => false)) {
      const box = await button.boundingBox();
      if (box) {
        console.log(`📱 Get Ticket Button Size: ${box.width}x${box.height}`);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
    } else {
      console.log('⚠️ Get Ticket button not visible (booth might be closed)');
    }
    
    await context.close();
  });

});
