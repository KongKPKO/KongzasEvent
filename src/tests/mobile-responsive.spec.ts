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
    
    // Auth
    const { data: signUpData } = await supabase.auth.signUp({ email: TEST_EMAIL, password: TEST_PASSWORD });
    if (signUpData.user) userId = signUpData.user.id;
    else {
      const { data: signInData } = await supabase.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
      if (signInData.user) userId = signInData.user.id;
    }

    if (userId) {
      // Create Artist
      await supabase.from('artists').upsert({
        id: userId, email: TEST_EMAIL, slug: ARTIST_SLUG, 
        display_name: 'Mobile Test Artist', is_queue_open: true
      });
      
      // Cleanup & Create Event
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

      // Cleanup & Create Products for Grid Test
      await supabase.from('products').delete().eq('artist_id', userId);
      const products = Array.from({ length: 6 }).map((_, i) => ({
        artist_id: userId,
        name: `Mobile Item ${i + 1}`,
        price: 100 + (i * 10),
        status: 'enable',
        image_url: null
      }));
      await supabase.from('products').insert(products);
    }
  });

  // ... Existing Tests ...

  test('Mobile: Customer Queue Page should be responsive on iPhone 12', async ({ browser }) => {
    const context = await browser.newContext({
      ...devices['iPhone 12'],
    });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/${ARTIST_SLUG}/queue`);
    await page.waitForLoadState('domcontentloaded');
    
    const viewport = page.viewportSize();
    expect(viewport?.width).toBe(390);
    
    await expect(page.getByText(/Get Ticket|Booth|Event|Artist/i).first()).toBeVisible({ timeout: 5000 });
    
    await context.close();
  });

  test('Mobile: Admin POS Page should show Cart on Top and Product Grid at Bottom', async ({ browser }) => {
    test.slow(); // Allow more time for this test
    const context = await browser.newContext({
        ...devices['iPhone 12'], // Width 390px
    });
    const page = await context.newPage();

    // Login
    await page.goto(`${BASE_URL}/manage-login`);
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.getByRole('button', { name: /Login/i }).click();
    
    // On mobile, "Logout" text might be hidden or inside menu. 
    // Check for Menu button or simply that we are redirected.
    await expect(page).not.toHaveURL(/.*login/);
    // Be flexible about where it redirects (likely manage-events or manage-products)
    // We will explicitly go to POS next anyway
    
    // Go to POS
    await page.goto(`${BASE_URL}/manage-pos-queues`);
    await page.waitForLoadState('networkidle');

    // On Mobile, default tab is 'Queue Control'. We need to switch to 'POS / Order'.
    // The tab switcher is visible on mobile.
    await page.getByRole('button', { name: 'POS / Order' }).click({ force: true });

    // 1. Verify Layout Order (Cart Top, Products Bottom)
    // We can check this by bounding boxes. Cart should be above Product Grid.
    
    const cartSection = page.locator('[aria-label="Shopping cart"]').first();
    const productGrid = page.locator('[aria-label="Product grid"]').first();

    await expect(cartSection).toBeVisible();
    await expect(productGrid).toBeVisible();

    const cartBox = await cartSection.boundingBox();
    const gridBox = await productGrid.boundingBox();

    if (cartBox && gridBox) {
        console.log(`Mobile Layout: Cart Y=${cartBox.y}, Product Grid Y=${gridBox.y}`);
        expect(cartBox.y).toBeLessThan(gridBox.y);
    }

    // 2. Verify Product Grid Columns (Should be 4 cols on mobile)
    // We can check expected CSS class or visual layout
    const gridContainer = page.locator('[aria-label="Product grid"] .grid').first();
    await expect(gridContainer).toHaveClass(/grid-cols-4/);

    await context.close();
  });

});
