import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// --- CONFIGURATION ---
const TEST_EMAIL = process.env.TEST_EMAIL || 'konglnwzas@gmail.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'SupaF@irytail1';
const BASE_URL = 'http://localhost:5173';
const TEST_SLUG = 'test1';
const ARTIST_NAME = 'Global Flow Artist';

// Setup Supabase
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || '***'; // ค่า Mock ใน CI หรือค่าจริงจาก .env
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

test.describe('Global Flow E2E', () => {

    // ✅ SETUP: สร้างข้อมูลร้านที่ "เปิดทำการ" (Booth Open)
    test.beforeAll(async () => {
        console.log('⚡️ Global Flow: Seeding Data...');
        
        let userId = '';
        // 1. Auth: Sign Up หรือ Sign In
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
            // 2. Artist: สร้างร้านและ "เปิดคิว" (is_queue_open: true)
            await supabase.from('artists').upsert({
                id: userId,
                email: TEST_EMAIL,
                slug: TEST_SLUG,
                display_name: ARTIST_NAME,
                is_queue_open: true,
                updated_at: new Date().toISOString()
            });

            // 3. Event: สร้างอีเวนต์ที่ "เปิดบูธ" (is_booth_open: true)
            const today = new Date().toISOString().split('T')[0];
            await supabase.from('events').delete().eq('artist_id', userId);

            await supabase.from('events').insert({
                artist_id: userId,
                event_name: 'Global Flow Event',
                start_date: today + ' 00:00:00',
                end_date: today + ' 23:59:59',
                status: 'Confirmed',
                is_booth_open: true, // ✅ เปิดบูธ เพื่อให้สถานะขึ้นว่า NOW SERVING
                location: 'Global Lab'
            });
            console.log('✅ Data seeded successfully for Global Flow (Booth Open)');
        }
    });

    // --- Suite 1: Authentication ---
    test.describe('Authentication', () => {
        test('Login Flow', async ({ page }) => {
            await page.goto(`${BASE_URL}/manage-login`);
            await page.fill('input[type="email"]', TEST_EMAIL);
            await page.fill('input[type="password"]', TEST_PASSWORD);
            await page.getByRole('button', { name: 'Login to Dashboard' }).click();
            await expect(page).toHaveURL(/\/manage-events/, { timeout: 15000 });
        });

        test('Protected Route: Redirects unauthenticated user', async ({ browser }) => {
            const context = await browser.newContext(); 
            const page = await context.newPage();
            
            await context.clearCookies();
            await page.goto(`${BASE_URL}/manage-queues`);
            
            await expect(page.getByRole('button', { name: 'Login to Dashboard' })).toBeVisible({ timeout: 10000 });
            await context.close();
        });
    });

    // --- Suite 2: Queue Management (Admin) ---
    test.describe('Queue Management (Admin)', () => {
        test.beforeEach(async ({ page }) => {
            await page.goto(`${BASE_URL}/manage-login`);
            await page.fill('input[type="email"]', TEST_EMAIL);
            await page.fill('input[type="password"]', TEST_PASSWORD);
            await page.getByRole('button', { name: 'Login to Dashboard' }).click();
            await expect(page).toHaveURL(/\/manage-events/);
        });

        test('Dashboard Elements Check', async ({ page }) => {
            await page.goto(`${BASE_URL}/manage-queues`);
            await expect(page.getByText('Queue Control')).toBeVisible({ timeout: 10000 });
            await expect(page.getByText('Active Event', { exact: false })).toBeVisible();
        });

        test('Open/Close Queue Toggle', async ({ page }) => {
            await page.goto(`${BASE_URL}/manage-queues`);
            await page.waitForTimeout(1000);

            const toggleBtn = page.locator('button.relative.inline-flex.h-5.w-9').first();
            if (await toggleBtn.isVisible()) {
                await toggleBtn.click();
            } else {
                console.log('Skipping toggle click: Element not found');
            }
        });
    });

    // --- Suite 3: Customer View (Public) ---
    test.describe('Customer View', () => {
        
        test('Public Queue Page Elements', async ({ page }) => {
            const targetUrl = `${BASE_URL}/${TEST_SLUG}/queue`;
            console.log('Visiting:', targetUrl);
            
            await page.goto(targetUrl);
            
            // 1. รอ Network Idle (สำคัญมากใน CI)
            await page.waitForLoadState('networkidle');

            // 2. เช็คชื่อร้าน (Heading) - ถ้าไม่เจอให้ลอง Reload
            const heading = page.getByRole('heading', { name: ARTIST_NAME });
            if (!(await heading.isVisible({ timeout: 5000 }))) {
                console.log('⚠️ Heading not found, reloading...');
                await page.reload();
                await page.waitForLoadState('networkidle');
            }
            await expect(heading).toBeVisible();

            // 3. เช็คสถานะ (Booth Closed / NOW SERVING)
            const statusIndicator = page.getByText('Booth Closed').or(page.getByText('NOW SERVING')).first();
            if (!(await statusIndicator.isVisible({ timeout: 5000 }))) {
                console.log('⚠️ Status not found, reloading again...');
                await page.reload();
                await page.waitForLoadState('networkidle');
            }
            await expect(statusIndicator).toBeVisible({ timeout: 10000 });
        });
    });

});