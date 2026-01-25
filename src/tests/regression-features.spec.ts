import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// --- CONFIGURATION ---
const TEST_EMAIL = process.env.TEST_EMAIL || 'konglnwzas@gmail.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'SupaF@irytail1';
const BASE_URL = 'http://localhost:5173';
const TEST_SLUG = 'test1'; 

// Supabase Config for Test Setup
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJFUzI1NiIsImtpZCI6ImI4MTI2OWYxLTIxZDgtNGYyZS1iNzE5LWMyMjQwYTg0MGQ5MCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjIwODQ2Mzc2ODN9.USpdkBGt_bp9ywixWVdIwdiW4rk7xuNljYkjwBki4rx5_4sM4fbots6paIFQDiuU40eEC2slYEvUqLi4LFyPwg'; 
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

test.describe('Regression Features: Queue Control & Notifications', () => {

    const setupTestEvent = async () => {
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const user = users?.find(u => u.email === TEST_EMAIL);
        
        if (!user) {
            return;
        }

        const today = new Date().toISOString().split('T')[0]; 
        const { data: existingEvents } = await supabase
            .from('events')
            .select('*')
            .eq('artist_id', user.id)
            .eq('status', 'Confirmed')
            .lte('start_date', today + ' 23:59:59')
            .gte('end_date', today + ' 00:00:00');

        if (existingEvents && existingEvents.length > 0) {
            await supabase.from('events').update({ is_booth_open: true }).eq('id', existingEvents[0].id);
            return existingEvents[0].id;
        }

        const { data: newEvent } = await supabase.from('events').insert({
            artist_id: user.id,
            event_name: 'E2E Automated Test Event',
            start_date: today + ' 09:00:00',
            end_date: today + ' 18:00:00',
            status: 'Confirmed',
            is_booth_open: true,
            location: 'Automated Test Lab'
        }).select().single();
        
        return newEvent?.id;
    };

    test.beforeEach(async ({ page }) => {
        // 0. Setup Data (Inject Event)
        await setupTestEvent();

        // 1. Login
        await page.goto(`${BASE_URL}/manage-login`);
        await page.fill('input[type="email"]', TEST_EMAIL);
        await page.fill('input[type="password"]', TEST_PASSWORD);
        await page.getByRole('button', { name: 'Login to Dashboard' }).click();
        await expect(page).toHaveURL(/\/manage-events/);
        
        // 2. Go to Queue Dashboard
        await page.goto(`${BASE_URL}/manage-queues`);
        await expect(page.getByText('Queue Control')).toBeVisible();
        await page.waitForTimeout(1000); 
    });

    // --- Scenario 1: Pause Queue Functionality ---
    test('Scenario 1: Pause Queue changes Customer UI', async ({ page, browser }) => {
        
        const toggleButton = page.locator('button.relative.inline-flex.h-5.w-9').first();
        const isClosed = await toggleButton.evaluate((el) => el.classList.contains('bg-red-500'));
        
        if (isClosed) {
            await toggleButton.click();
            await expect(toggleButton).toHaveClass(/bg-green-500/);
            await expect(page.getByText('RECEIVING QUEUE')).toBeVisible();
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
            await expect(customerPage.getByText('Queuing is closed')).toBeVisible({ timeout: 2000 });
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

    // --- Scenario 2: Notification Priority ---
    test('Scenario 2: Calling Notification overrides Broadcast', async ({ page, browser }) => {
        
        // STEP 0: Force Open Queue
        const toggleButton = page.locator('button.relative.inline-flex.h-5.w-9').first();
        const isClosed = await toggleButton.evaluate((el) => el.classList.contains('bg-red-500'));
        
        if (isClosed) {
            await toggleButton.click();
            await expect(toggleButton).toHaveClass(/bg-green-500/);
            await page.waitForTimeout(500);
        }

        // STEP 0.5: Reset Broadcast (Strict Sync)
        const breakBtn = page.locator('button[title="พักเบรค"]');
        const clearBtn = page.getByTitle('Clear Message');
        
        if (await clearBtn.isVisible()) {
            
            // ดักรอ Request Clear
            const clearRequest = page.waitForResponse(resp => 
                resp.url().includes('/rest/v1/artists') && resp.status() < 300
            );
            await clearBtn.click();
            await clearRequest;
            
            // CRITICAL FIX: รอให้ปุ่มพักเบรค "หายแดง" ก่อน (Confirm UI Inactive)
            // เพื่อไม่ให้ Realtime ของเก่ามาตีกับคำสั่งใหม่
            await expect(breakBtn).not.toHaveClass(/ring-pink-500/); 
            await page.waitForTimeout(1000); // พักหายใจให้ Socket นิ่ง
        }

        // 1. Action: กดปุ่ม Broadcast "พักเบรค"
        
        const broadcastRequest = page.waitForResponse(resp => 
            resp.url().includes('/rest/v1/artists') && 
            (resp.request().method() === 'PATCH' || resp.request().method() === 'POST') &&
            resp.status() >= 200 && resp.status() < 300
        );

        await breakBtn.click();
        await broadcastRequest;

        await expect(breakBtn).toHaveClass(/ring-pink-500/);

        // 2. Open Customer View
        const customerContext = await browser.newContext();
        const customerPage = await customerContext.newPage();
        await customerPage.goto(`${BASE_URL}/${TEST_SLUG}/queue`);

        try {
            await expect(customerPage.getByText('Break time')).toBeVisible({ timeout: 3000 });
        } catch (e) {
            await customerPage.reload();
            await expect(customerPage.getByText('Break time')).toBeVisible();
        }

        // 3. Customer getting a ticket (STRICT MODE)
        const getTicketBtn = customerPage.getByRole('button', { name: 'Get Ticket' });
        
        if (!(await getTicketBtn.isVisible())) {
             await customerPage.reload();
             await expect(getTicketBtn).toBeVisible();
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

        // 4. Call Next Customer (SMART LOOP)
        await page.bringToFront();
        const callNextBtn = page.getByRole('button', { name: 'Call Next' });
        
        for (let i = 0; i < 5; i++) {
            const isCalled = await customerPage.getByText('ถึงคิวแล้ว!').isVisible();
            if (isCalled) {
                break;
            }

            if (await callNextBtn.isDisabled()) {
                await page.reload();
                await expect(page.getByText('Queue Control')).toBeVisible();
                await page.waitForTimeout(500);
            }

            // ถ้ายัง Disabled อีก แปลว่าคิวอาจจะหมด หรือเรียกไปแล้วแต่ลูกค้าไม่เห็น
            if (await callNextBtn.isDisabled()) {
                 
                 // เช็คหน้าลูกค้าอีกที (Reload เพื่อความชัวร์)
                 if (!(await customerPage.getByText('ถึงคิวแล้ว!').isVisible())) {
                     await customerPage.reload();
                     await page.waitForTimeout(1000);
                 }
                 
                 continue; // ข้ามไปรอบถัดไป
            }

            const callRequest = page.waitForResponse(resp => 
                resp.url().includes('/rest/v1/queues') && 
                (resp.request().method() === 'PATCH' || resp.request().method() === 'POST') &&
                resp.status() >= 200 && resp.status() < 300
            );

            await callNextBtn.click();
            await callRequest;
            await page.waitForTimeout(1000); 
        }
            
        // 5. Verify Priority (Final Check)
        await customerPage.bringToFront();
        if (!(await customerPage.getByText('ถึงคิวแล้ว!').isVisible())) {
            await customerPage.reload();
        }
        
        await expect(customerPage.getByText('ถึงคิวแล้ว!')).toBeVisible({ timeout: 10000 });
        await expect(customerPage.getByText('Break time')).not.toBeVisible();

        // Cleanup
        await page.bringToFront();
        const finalClearBtn = page.getByTitle('Clear Message');
        if (await finalClearBtn.isVisible()) await finalClearBtn.click();
        
        await customerContext.close();
    });

});