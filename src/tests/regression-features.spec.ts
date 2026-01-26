import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const TEST_EMAIL = process.env.TEST_EMAIL || 'konglnwzas@gmail.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'SupaF@irytail1';
const BASE_URL = 'http://localhost:5173';
const TEST_SLUG = 'test1'; 

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || '***'; 
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

test.describe('Regression Features: Queue Control & Notifications', () => {

    const setupTestEvent = async () => {
        // 1. Auth Setup
        let userId = '';
        const { data: signUpData } = await supabase.auth.signUp({
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
        });

        if (signUpData.user) {
            userId = signUpData.user.id;
        } else {
            const { data: signInData } = await supabase.auth.signInWithPassword({
                email: TEST_EMAIL,
                password: TEST_PASSWORD,
            });
            if (signInData.user) userId = signInData.user.id;
        }

        if (!userId) throw new Error("Critical: Failed to find or create test user via SignUp/SignIn");

        // ✅ FIX 1: ตัด status ออก และใช้ upsert แบบระวัง
        // (เอา email ออกด้วย เพราะปกติ Supabase จะ sync email เอง การยัดซ้ำอาจติด RLS)
        const { error: artistError } = await supabase.from('artists').upsert({
            id: userId,
            slug: TEST_SLUG, 
            display_name: 'Regression Artist',
            // status: 'approved', <--- ❌ ลบตัวปัญหาทิ้ง!
            is_queue_open: true,
            updated_at: new Date().toISOString()
        }, { onConflict: 'id' }); // ย้ำว่าถ้า ID ชนกันให้ Update

        if (artistError) throw new Error(`Artist Upsert Failed: ${artistError.message}`);

        // 3. Event Setup
        const today = new Date().toISOString().split('T')[0]; 
        await supabase.from('events').delete().eq('artist_id', userId);

        const { data: newEvent, error: insertError } = await supabase.from('events').insert({
            artist_id: userId,
            event_name: 'E2E Regression Event',
            start_date: today + ' 00:00:00',
            end_date: today + ' 23:59:59',
            status: 'Confirmed',
            is_booth_open: true,
            location: 'Regression Lab'
        }).select().single();

        if (insertError || !newEvent) {
            throw new Error(`Event Insert Failed: ${insertError?.message || 'Unknown error'}`);
        }
        
        await supabase.from('queues').delete().eq('event_id', newEvent.id);
        return newEvent.id;
    };

    test.beforeEach(async ({ page }) => {
        await setupTestEvent();
        await page.goto(`${BASE_URL}/manage-login`);
        await page.fill('input[type="email"]', TEST_EMAIL);
        await page.fill('input[type="password"]', TEST_PASSWORD);
        await page.getByRole('button', { name: 'Login to Dashboard' }).click();
        await expect(page).toHaveURL(/\/manage-events/, { timeout: 15000 });
        await page.goto(`${BASE_URL}/manage-queues`);
        await expect(page.getByText('Queue Control')).toBeVisible({ timeout: 10000 });
    });

    test('Scenario 1: Pause Queue changes Customer UI', async ({ page, browser }) => {
        const toggleButton = page.locator('button.relative.inline-flex.h-5.w-9').first();
        await expect(toggleButton).toHaveClass(/bg-green-500/, { timeout: 10000 });
        const pauseRequest = page.waitForResponse(resp => resp.url().includes('/rest/v1/artists') && resp.status() >= 200);
        await toggleButton.click();
        await pauseRequest; 
        await expect(toggleButton).toHaveClass(/bg-red-500/); 
        await expect(page.getByText('QUEUE PAUSED')).toBeVisible();

        const customerContext = await browser.newContext();
        const customerPage = await customerContext.newPage();
        await customerPage.goto(`${BASE_URL}/${TEST_SLUG}/queue`);

        try {
            await expect(customerPage.getByText(/Closed|Paused|Queuing is closed/i)).toBeVisible({ timeout: 5000 });
        } catch {
            console.log('Reloading customer page...');
            await customerPage.reload();
            await customerPage.waitForLoadState('networkidle');
            await expect(customerPage.getByText(/Closed|Paused|Queuing is closed/i)).toBeVisible({ timeout: 10000 });
        }
        await expect(customerPage.getByRole('button', { name: 'Get Ticket' })).not.toBeVisible();
        await customerContext.close();
    });

    test('Scenario 2: Calling Notification overrides Broadcast', async ({ page, browser }) => {
        const toggleButton = page.locator('button.relative.inline-flex.h-5.w-9').first();
        await expect(toggleButton).toHaveClass(/bg-green-500/, { timeout: 10000 });

        const customerContext = await browser.newContext();
        const customerPage = await customerContext.newPage();
        await customerPage.goto(`${BASE_URL}/${TEST_SLUG}/queue`);
        await customerPage.waitForLoadState('networkidle');

        const getTicketBtn = customerPage.getByRole('button', { name: 'Get Ticket' });
        if (!(await getTicketBtn.isVisible({ timeout: 5000 }))) {
             await customerPage.reload();
             await expect(getTicketBtn).toBeVisible({ timeout: 10000 });
        }

        await getTicketBtn.click();
        await expect(customerPage.getByText(/#\d+/).first()).toBeVisible({ timeout: 10000 });

        await page.bringToFront();
        const breakBtn = page.locator('button[title="พักเบรค"]');
        const broadcastRequest = page.waitForResponse(resp => resp.url().includes('/rest/v1/artists') && resp.status() >= 200);
        await breakBtn.click();
        await broadcastRequest;
        await expect(breakBtn).toHaveClass(/ring-pink-500/);

        await customerPage.bringToFront();
        try {
            await expect(customerPage.getByText('Break time')).toBeVisible({ timeout: 5000 });
        } catch {
            await customerPage.reload();
            await expect(customerPage.getByText('Break time')).toBeVisible();
        }

        await page.bringToFront();
        const callNextBtn = page.getByRole('button', { name: 'Call Next' });
        const callRequest = page.waitForResponse(resp => resp.url().includes('/rest/v1/queues') && resp.status() >= 200);
        await callNextBtn.click();
        await callRequest;
            
        await customerPage.bringToFront();
        const callingMessage = customerPage.getByText(/Your Turn|ถึงคิวแล้ว/i);
        if (!(await callingMessage.isVisible({ timeout: 5000 }))) {
             await customerPage.reload();
        }
        await expect(callingMessage).toBeVisible({ timeout: 10000 });
        await expect(customerPage.getByText('Break time')).not.toBeVisible();
        await customerContext.close();
    });
});