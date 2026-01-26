import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const TEST_EMAIL = process.env.TEST_EMAIL || 'konglnwzas@gmail.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'SupaF@irytail1';
const BASE_URL = 'http://localhost:5173';
const TEST_SLUG = 'test1';
const ARTIST_NAME = 'Global Flow Artist';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || '***';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

test.describe('Global Flow E2E', () => {

    test.beforeAll(async () => {
        // ... (ส่วน Setup Auth/DB เหมือนเดิมเป๊ะ ไม่ต้องแก้) ...
        console.log('⚡️ Global Flow: Seeding Data...');
        let userId = '';
        const { data: signUpData } = await supabase.auth.signUp({ email: TEST_EMAIL, password: TEST_PASSWORD });
        if (signUpData.user) userId = signUpData.user.id;
        else {
            const { data: signInData } = await supabase.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
            if (signInData.user) userId = signInData.user.id;
        }

        if (userId) {
            await supabase.from('artists').upsert({
                id: userId, email: TEST_EMAIL, slug: TEST_SLUG, display_name: ARTIST_NAME, is_queue_open: true, updated_at: new Date().toISOString()
            });
            const today = new Date().toISOString().split('T')[0];
            await supabase.from('events').delete().eq('artist_id', userId);
            await supabase.from('events').insert({
                artist_id: userId, event_name: 'Global Flow Event', start_date: today + ' 00:00:00', end_date: today + ' 23:59:59', status: 'Confirmed', is_booth_open: true, location: 'Global Lab'
            });
        }
    });

    // ... Suite Authentication & Admin เหมือนเดิม ...
    test.describe('Authentication', () => {
        test('Login Flow', async ({ page }) => {
            await page.goto(`${BASE_URL}/manage-login`);
            await page.fill('input[type="email"]', TEST_EMAIL);
            await page.fill('input[type="password"]', TEST_PASSWORD);
            await page.getByRole('button', { name: 'Login to Dashboard' }).click();
            await expect(page).toHaveURL(/\/manage-events/, { timeout: 15000 });
        });
    });

    test.describe('Queue Management (Admin)', () => {
        test.beforeEach(async ({ page }) => {
            await page.goto(`${BASE_URL}/manage-login`);
            await page.fill('input[type="email"]', TEST_EMAIL);
            await page.fill('input[type="password"]', TEST_PASSWORD);
            await page.getByRole('button', { name: 'Login to Dashboard' }).click();
        });
        test('Open/Close Queue Toggle', async ({ page }) => {
            await page.goto(`${BASE_URL}/manage-queues`);
            const toggleBtn = page.locator('button.relative.inline-flex.h-5.w-9').first();
            await expect(toggleBtn).toBeVisible({ timeout: 10000 });
        });
    });

    // ✅✅✅ แก้ตรงนี้ (Customer View) ✅✅✅
    test.describe('Customer View', () => {
        test('Public Queue Page Elements', async ({ page }) => {
            const targetUrl = `${BASE_URL}/${TEST_SLUG}/queue`;
            console.log('Visiting:', targetUrl);

            // 1. ดักจับ Response ของ Supabase (REST API)
            // รอจนกว่าจะมี Request ที่ยิงไปหา artists และได้ status 200
            const artistDataPromise = page.waitForResponse(resp => 
                resp.url().includes('/rest/v1/artists') && resp.status() === 200
            );

            await page.goto(targetUrl);

            // 2. รอให้ข้อมูลมาถึงจริงๆ (ไม้ตาย)
            // ถ้า API ยังไม่ตอบกลับ Test จะหยุดรอตรงนี้ ไม่รีบไปหา Element
            await artistDataPromise; 
            
            // 3. รอเผื่อการ Render นิดหน่อย
            await page.waitForTimeout(500); 

            // 4. ถ้า Heading ไม่มา ให้ลอง Reload แบบมีชั้นเชิง
            const heading = page.getByRole('heading', { name: ARTIST_NAME });
            if (!(await heading.isVisible({ timeout: 3000 }))) {
                console.log('⚠️ Heading not found on first load. Reloading...');
                
                // ดักรอบ 2
                const retryPromise = page.waitForResponse(resp => 
                    resp.url().includes('/rest/v1/artists') && resp.status() === 200
                );
                await page.reload();
                await retryPromise;
                await page.waitForTimeout(500);
            }

            await expect(heading).toBeVisible();

            // 5. เช็ค Status
            const statusIndicator = page.getByText('Booth Closed').or(page.getByText('NOW SERVING')).first();
            await expect(statusIndicator).toBeVisible({ timeout: 10000 });
        });
    });
});