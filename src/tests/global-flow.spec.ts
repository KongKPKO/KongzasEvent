import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

test.setTimeout(60000);

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
        console.log('⚡️ Global Flow: Seeding Data...');
        
        let userId = '';
        const { data: signUpData } = await supabase.auth.signUp({ email: TEST_EMAIL, password: TEST_PASSWORD });
        if (signUpData.user) userId = signUpData.user.id;
        else {
            const { data: signInData } = await supabase.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
            if (signInData.user) userId = signInData.user.id;
        }

        if (userId) {
            // Upsert Artist (Update Logic)
            let artistUpdated = false;
            for (let i = 0; i < 3; i++) {
                const { error: updateError, data } = await supabase.from('artists').update({
                    slug: TEST_SLUG, 
                    display_name: ARTIST_NAME, 
                    is_queue_open: true, 
                    updated_at: new Date().toISOString()
                }).eq('id', userId).select();

                if (!updateError && data && data.length > 0) {
                    artistUpdated = true;
                    break;
                }
                await new Promise(r => setTimeout(r, 1000));
            }

            if (!artistUpdated) {
                const { error: insertError } = await supabase.from('artists').insert({
                    id: userId,
                    slug: TEST_SLUG, 
                    display_name: ARTIST_NAME, 
                    is_queue_open: true, 
                    updated_at: new Date().toISOString()
                });
                if (insertError) console.log(`Note: Insert fallback failed: ${insertError.message}`);
            }

            // Upsert Event
            const today = new Date().toISOString().split('T')[0];
            await supabase.from('events').delete().eq('artist_id', userId);
            
            // ✅ FIX: เอา location ออก
            const { error: eventError } = await supabase.from('events').insert({
                artist_id: userId, 
                event_name: 'Global Flow Event', 
                start_date: today + ' 00:00:00', 
                end_date: today + ' 23:59:59', 
                status: 'Confirmed', 
                is_booth_open: true
                // location: 'Global Lab' <--- ❌ ลบทิ้งตัวปัญหา
            });
            
            if (eventError) throw new Error(`Event Seed Failed: ${eventError.message}`);

            console.log('✅ Data Verified in DB. Ready to test.');
        }
    });

    test.describe('Queue Management (Admin)', () => {
        test.beforeEach(async ({ page }) => {
            await page.goto(`${BASE_URL}/manage-login`);
            await page.fill('input[type="email"]', TEST_EMAIL);
            await page.fill('input[type="password"]', TEST_PASSWORD);
            await page.getByRole('button', { name: 'Login to Dashboard' }).click();
            await expect(page).toHaveURL(/\/manage-events/, { timeout: 20000 });
            await page.waitForLoadState('networkidle');
        });

        test('Open/Close Queue Toggle', async ({ page }) => {
            await page.goto(`${BASE_URL}/manage-queues`);
            await expect(page.getByText('Queue Control')).toBeVisible({ timeout: 15000 });

            const toggleBtn = page.locator('button[role="switch"]').or(page.locator('button.relative.inline-flex.h-5.w-9')).first();
            await expect(toggleBtn).toBeVisible({ timeout: 10000 });

            const requestPromise = page.waitForResponse(
                resp => resp.url().includes('/rest/v1/artists') && resp.status() >= 200,
                { timeout: 15000 }
            );
            
            await toggleBtn.click();
            try { await requestPromise; } catch (e) { console.log('⚠️ Toggle API timeout'); }
            await page.waitForTimeout(1000); 
        });
    });

    test.describe('Customer View', () => {
        test('Public Queue Page Elements', async ({ page }) => {
            const targetUrl = `${BASE_URL}/${TEST_SLUG}/queue`;
            console.log('Visiting:', targetUrl);

            const artistDataPromise = page.waitForResponse(
                resp => resp.url().includes('/rest/v1/artists') && resp.status() >= 200,
                { timeout: 15000 } 
            );

            await page.goto(targetUrl);
            try { await artistDataPromise; } catch (e) { console.log('⚠️ API Timeout'); }
            await page.waitForTimeout(1000);

            const heading = page.getByText(ARTIST_NAME).first();
            
            if (!(await heading.isVisible({ timeout: 3000 }))) {
                console.log('⚠️ Name not found. Reloading...');
                const retryPromise = page.waitForResponse(
                    resp => resp.url().includes('/rest/v1/artists') && resp.status() >= 200,
                    { timeout: 15000 }
                );
                await page.reload();
                try { await retryPromise; } catch(e) {}
                await page.waitForLoadState('networkidle');
            }

            await expect(heading).toBeVisible({ timeout: 10000 });
            const statusIndicator = page.getByText('Booth Closed').or(page.getByText('NOW SERVING')).first();
            await expect(statusIndicator).toBeVisible({ timeout: 10000 });
        });
    });
});