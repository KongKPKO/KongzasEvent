import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// --- CONFIGURATION ---
const TEST_EMAIL = process.env.TEST_EMAIL || 'konglnwzas@gmail.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'SupaF@irytail1';
const BASE_URL = 'http://localhost:5173';
const TEST_SLUG = 'test1'; 

// Supabase Config
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJFUzI1NiIsImtpZCI6ImI4MTI2OWYxLTIxZDgtNGYyZS1iNzE5LWMyMjQwYTg0MGQ5MCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjIwODQ2Mzc2ODN9.USpdkBGt_bp9ywixWVdIwdiW4rk7xuNljYkjwBki4rx5_4sM4fbots6paIFQDiuU40eEC2slYEvUqLi4LFyPwg'; 
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

test.describe('Regression Features: Queue Control & Notifications', () => {

    const setupTestEvent = async () => {
        let userId = '';

        const { data: signUpData } = await supabase.auth.signUp({
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
        });

        if (signUpData.user) {
            userId = signUpData.user.id;
        } else {
            // 2. ถ้า Sign Up ไม่ได้ (เพราะมี User แล้ว) ให้ Sign In แทนเพื่อเอา ID
            const { data: signInData } = await supabase.auth.signInWithPassword({
                email: TEST_EMAIL,
                password: TEST_PASSWORD,
            });
            
            if (signInData.user) {
                userId = signInData.user.id;
            }
        }

        if (!userId) throw new Error("Critical: Failed to find or create test user via SignUp/SignIn");

        // 2. FORCE Artist Setup
        await supabase.from('artists').upsert({
            id: userId,
            email: TEST_EMAIL,
            slug: TEST_SLUG, 
            display_name: 'Regression Artist',
            status: 'approved',
            updated_at: new Date().toISOString()
        });

        // 3. จัดการ Event (เริ่มเที่ยงคืน Timezone Safe)
        const today = new Date().toISOString().split('T')[0]; 
        
        await supabase.from('events').delete().eq('artist_id', userId);

        const { data: newEvent } = await supabase.from('events').insert({
            artist_id: userId,
            event_name: 'E2E Automated Test Event',
            start_date: today + ' 00:00:00', // ✅ เริ่มเที่ยงคืน
            end_date: today + ' 23:59:59',
            status: 'Confirmed',
            is_booth_open: true,
            location: 'Automated Test Lab'
        }).select().single();
        
        return newEvent?.id;
    };

    test.beforeEach(async ({ page }) => {
        // 0. Setup Data
        await setupTestEvent();

        // 1. Login
        await page.goto(`${BASE_URL}/manage-login`);
        await page.fill('input[type="email"]', TEST_EMAIL);
        await page.fill('input[type="password"]', TEST_PASSWORD);
        await page.getByRole('button', { name: 'Login to Dashboard' }).click();
        await expect(page).toHaveURL(/\/manage-events/, { timeout: 15000 });
        
        // 2. Go to Queue Dashboard
        await page.goto(`${BASE_URL}/manage-queues`);
        await expect(page.getByText('Queue Control')).toBeVisible({ timeout: 10000 });
    });

    // --- Scenario 1: Pause Queue Functionality ---
    test('Scenario 1: Pause Queue changes Customer UI', async ({ page, browser }) => {
        const toggleButton = page.locator('button.relative.inline-flex.h-5.w-9').first();
        
        const isClosed = await toggleButton.evaluate((el) => el.classList.contains('bg-red-500'));
        if (isClosed) {
            await toggleButton.click();
            await expect(toggleButton).toHaveClass(/bg-green-500/);
            await page.waitForTimeout(500);
        }

        const pauseRequest = page.waitForResponse(resp => 
            resp.url().includes('/rest/v1/artists') && 
            (resp.request().method() === 'PATCH' || resp.request().method() === 'POST') &&
            resp.status() >= 200 && resp.status() < 300
        );
        
        await toggleButton.click();
        await pauseRequest; 

        await expect(toggleButton).toHaveClass(/bg-red-500/); 
        await expect(page.getByText('QUEUE PAUSED')).toBeVisible();

        const customerContext = await browser.newContext();
        const customerPage = await customerContext.newPage();
        await customerPage.goto(`${BASE_URL}/${TEST_SLUG}/queue`);

        try {
            await expect(customerPage.getByText('Queuing is closed')).toBeVisible({ timeout: 3000 });
        } catch {
            await customerPage.reload();
            await expect(customerPage.getByText('Queuing is closed')).toBeVisible();
        }
        
        await expect(customerPage.getByRole('button', { name: 'Get Ticket' })).not.toBeVisible();

        await page.bringToFront();
        await toggleButton.click();
        await expect(toggleButton).toHaveClass(/bg-green-500/);

        await customerContext.close();
    });

    // --- Scenario 2: Notification Priority (Fixed Flow) ---
    test('Scenario 2: Calling Notification overrides Broadcast', async ({ page, browser }) => {
        
        const toggleButton = page.locator('button.relative.inline-flex.h-5.w-9').first();
        const isClosed = await toggleButton.evaluate((el) => el.classList.contains('bg-red-500'));
        if (isClosed) {
            await toggleButton.click();
            await expect(toggleButton).toHaveClass(/bg-green-500/);
            await page.waitForTimeout(500);
        }

        const breakBtn = page.locator('button[title="พักเบรค"]');
        const clearBtn = page.getByTitle('Clear Message');
        if (await clearBtn.isVisible()) {
            const clearRequest = page.waitForResponse(resp => 
                resp.url().includes('/rest/v1/artists') && resp.status() < 300
            );
            await clearBtn.click();
            await clearRequest;
            await expect(breakBtn).not.toHaveClass(/ring-pink-500/); 
            await page.waitForTimeout(1000); 
        }

        // ✅ STEP 1: Customer Gets Ticket FIRST
        const customerContext = await browser.newContext();
        const customerPage = await customerContext.newPage();
        
        await customerPage.goto(`${BASE_URL}/${TEST_SLUG}/queue`);
        await customerPage.waitForLoadState('networkidle');

        const getTicketBtn = customerPage.getByRole('button', { name: 'Get Ticket' });
        
        if (!(await getTicketBtn.isVisible({ timeout: 5000 }))) {
             console.log('⚠️ Get Ticket Button not found. Reloading...');
             await customerPage.reload();
             await customerPage.waitForLoadState('networkidle');
             await expect(getTicketBtn).toBeVisible({ timeout: 10000 });
        }

        const createTicketRequest = customerPage.waitForResponse(resp => 
            resp.url().includes('/rest/v1/queues') && 
            resp.request().method() === 'POST' &&
            resp.status() === 201 
        );

        await getTicketBtn.click();
        await createTicketRequest;

        const ticketNumberLocator = customerPage.getByText(/#\d+/).first();
        await expect(ticketNumberLocator).toBeVisible();

        // ✅ STEP 2: Admin Sets "Break Time"
        await page.bringToFront();
        const broadcastRequest = page.waitForResponse(resp => 
            resp.url().includes('/rest/v1/artists') && 
            (resp.request().method() === 'PATCH' || resp.request().method() === 'POST') &&
            resp.status() >= 200 && resp.status() < 300
        );

        await breakBtn.click();
        await broadcastRequest;
        await expect(breakBtn).toHaveClass(/ring-pink-500/);

        // ✅ STEP 3: Verify Broadcast
        await customerPage.bringToFront();
        try {
            await expect(customerPage.getByText('Break time')).toBeVisible({ timeout: 5000 });
        } catch {
            await customerPage.reload();
            await expect(customerPage.getByText('Break time')).toBeVisible();
        }

        // ✅ STEP 4: Admin Calls Customer
        await page.bringToFront();
        const callNextBtn = page.getByRole('button', { name: 'Call Next' });
        
        for (let i = 0; i < 5; i++) {
            const isCalled = await customerPage.getByText('Your Turn!').or(customerPage.getByText('ถึงคิวแล้ว!')).isVisible();
            if (isCalled) break;

            if (await callNextBtn.isDisabled()) {
                await page.reload(); 
                await expect(page.getByText('Queue Control')).toBeVisible();
                await page.waitForTimeout(500);
            }

            if (await callNextBtn.isDisabled()) continue;

            const callRequest = page.waitForResponse(resp => 
                resp.url().includes('/rest/v1/queues') && 
                (resp.request().method() === 'PATCH' || resp.request().method() === 'POST') &&
                resp.status() >= 200 && resp.status() < 300
            );

            await callNextBtn.click();
            await callRequest;
            await page.waitForTimeout(1000); 
        }
            
        // ✅ STEP 5: Verify Priority
        await customerPage.bringToFront();
        
        const callingMessage = customerPage.getByText('Your Turn!').or(customerPage.getByText('ถึงคิวแล้ว!'));
        if (!(await callingMessage.isVisible())) {
            await customerPage.reload();
        }
        await expect(callingMessage).toBeVisible({ timeout: 10000 });
        await expect(customerPage.getByText('Break time')).not.toBeVisible();

        // Cleanup
        await page.bringToFront();
        const finalClearBtn = page.getByTitle('Clear Message');
        if (await finalClearBtn.isVisible()) await finalClearBtn.click();
        
        await customerContext.close();
    });

});