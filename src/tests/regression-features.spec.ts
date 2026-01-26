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

    // 🛠️ Helper Function: สร้างข้อมูลใหม่ทุกครั้งก่อนเริ่ม Test แต่ละข้อ
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

        // 2. FORCE Artist Setup (Reset Status)
        await supabase.from('artists').upsert({
            id: userId,
            email: TEST_EMAIL,
            slug: TEST_SLUG, 
            display_name: 'Regression Artist',
            status: 'approved',
            is_queue_open: true, // ✅ บังคับเปิดคิวเสมอ
            updated_at: new Date().toISOString()
        });

        // 3. Event Setup (Reset Event)
        const today = new Date().toISOString().split('T')[0]; 
        await supabase.from('events').delete().eq('artist_id', userId);

        const { data: newEvent } = await supabase.from('events').insert({
            artist_id: userId,
            event_name: 'E2E Regression Event',
            start_date: today + ' 00:00:00',
            end_date: today + ' 23:59:59',
            status: 'Confirmed',
            is_booth_open: true,
            location: 'Regression Lab'
        }).select().single();
        
        // 4. Clear Old Queues (ล้างคิวเก่าทิ้งให้หมด)
        await supabase.from('queues').delete().eq('event_id', newEvent.id);

        return newEvent?.id;
    };

    test.beforeEach(async ({ page }) => {
        await setupTestEvent();
        
        // Login & Go to Dashboard
        await page.goto(`${BASE_URL}/manage-login`);
        await page.fill('input[type="email"]', TEST_EMAIL);
        await page.fill('input[type="password"]', TEST_PASSWORD);
        await page.getByRole('button', { name: 'Login to Dashboard' }).click();
        await expect(page).toHaveURL(/\/manage-events/, { timeout: 15000 });
        
        // Go to Queue Control Page
        await page.goto(`${BASE_URL}/manage-queues`);
        await expect(page.getByText('Queue Control')).toBeVisible({ timeout: 10000 });
    });

    // --- Scenario 1: Pause Queue ---
    test('Scenario 1: Pause Queue changes Customer UI', async ({ page, browser }) => {
        const toggleButton = page.locator('button.relative.inline-flex.h-5.w-9').first();
        
        // Ensure toggle reflects DB state (Green)
        await expect(toggleButton).toHaveClass(/bg-green-500/, { timeout: 10000 });

        // Action: Click Pause
        const pauseRequest = page.waitForResponse(resp => 
            resp.url().includes('/rest/v1/artists') && resp.status() >= 200
        );
        await toggleButton.click();
        await pauseRequest; 
        
        await expect(toggleButton).toHaveClass(/bg-red-500/); 
        await expect(page.getByText('QUEUE PAUSED')).toBeVisible();

        // Customer Check
        const customerContext = await browser.newContext();
        const customerPage = await customerContext.newPage();
        await customerPage.goto(`${BASE_URL}/${TEST_SLUG}/queue`);

        // Force Reload Strategy for CI Visibility
        try {
            await expect(customerPage.getByText(/Closed|Paused|Queuing is closed/i)).toBeVisible({ timeout: 5000 });
        } catch {
            console.log('⚠️ Status not updated. Reloading customer page...');
            await customerPage.reload();
            await customerPage.waitForLoadState('networkidle');
            await expect(customerPage.getByText(/Closed|Paused|Queuing is closed/i)).toBeVisible({ timeout: 10000 });
        }
        
        // Button should be gone
        await expect(customerPage.getByRole('button', { name: 'Get Ticket' })).not.toBeVisible();

        await customerContext.close();
    });

    // --- Scenario 2: Calling Override ---
    test('Scenario 2: Calling Notification overrides Broadcast', async ({ page, browser }) => {
        
        // 1. Ensure Queue is OPEN (Double check)
        const toggleButton = page.locator('button.relative.inline-flex.h-5.w-9').first();
        await expect(toggleButton).toHaveClass(/bg-green-500/, { timeout: 10000 });

        // 2. Customer: Get Ticket
        const customerContext = await browser.newContext();
        const customerPage = await customerContext.newPage();
        await customerPage.goto(`${BASE_URL}/${TEST_SLUG}/queue`);
        await customerPage.waitForLoadState('networkidle');

        const getTicketBtn = customerPage.getByRole('button', { name: 'Get Ticket' });
        
        // Retry if button missing
        if (!(await getTicketBtn.isVisible({ timeout: 5000 }))) {
             console.log('⚠️ Get Ticket Button not found. Reloading...');
             await customerPage.reload();
             await expect(getTicketBtn).toBeVisible({ timeout: 10000 });
        }

        await getTicketBtn.click();
        await expect(customerPage.getByText(/#\d+/).first()).toBeVisible({ timeout: 10000 });

        // 3. Admin: Broadcast "Break"
        await page.bringToFront();
        const breakBtn = page.locator('button[title="พักเบรค"]');
        
        const broadcastRequest = page.waitForResponse(resp => resp.url().includes('/rest/v1/artists') && resp.status() >= 200);
        await breakBtn.click();
        await broadcastRequest;
        
        await expect(breakBtn).toHaveClass(/ring-pink-500/);

        // Verify Customer sees Break
        await customerPage.bringToFront();
        try {
            await expect(customerPage.getByText('Break time')).toBeVisible({ timeout: 5000 });
        } catch {
            await customerPage.reload();
            await expect(customerPage.getByText('Break time')).toBeVisible();
        }

        // 4. Admin: Call Next (Override Break)
        await page.bringToFront();
        const callNextBtn = page.getByRole('button', { name: 'Call Next' });
        
        const callRequest = page.waitForResponse(resp => resp.url().includes('/rest/v1/queues') && resp.status() >= 200);
        await callNextBtn.click();
        await callRequest;
            
        // 5. Verify Priority (Calling > Break)
        await customerPage.bringToFront();
        
        const callingMessage = customerPage.getByText(/Your Turn|ถึงคิวแล้ว/i);
        
        // Retry Check
        if (!(await callingMessage.isVisible({ timeout: 5000 }))) {
             console.log('⚠️ Calling status not appearing. Reloading...');
             await customerPage.reload();
        }
        
        await expect(callingMessage).toBeVisible({ timeout: 10000 });
        await expect(customerPage.getByText('Break time')).not.toBeVisible();

        await customerContext.close();
    });
});