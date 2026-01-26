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
        // 1. หา User หรือ สร้างใหม่ถ้าไม่มี (Robust Auth)
        const { data: { users } } = await supabase.auth.admin.listUsers();
        let user = users?.find(u => u.email === TEST_EMAIL);
        
        if (!user) {
             const { data: newUser } = await supabase.auth.admin.createUser({
                 email: TEST_EMAIL,
                 password: TEST_PASSWORD,
                 email_confirm: true
             });
             user = newUser.user ?? undefined;
        }

        if (!user) throw new Error("Critical: Failed to find or create test user");

        // 2. FORCE Artist Setup (บังคับให้มี Slug เป็น 'test1' ชัวร์ๆ)
        await supabase.from('artists').upsert({
            id: user.id,
            email: TEST_EMAIL,
            slug: TEST_SLUG, 
            display_name: 'Regression Artist',
            status: 'approved',
            updated_at: new Date().toISOString()
        });

        // 3. จัดการ Event (Timezone Safe)
        const today = new Date().toISOString().split('T')[0]; 
        
        // ลบ Event เก่าทิ้งก่อน กันตีกัน
        await supabase.from('events').delete().eq('artist_id', user.id);

        // สร้าง Event ใหม่ เริ่มเที่ยงคืน (00:00:00) เพื่อให้ครอบคลุมทุก Timezone (UTC/Local)
        const { data: newEvent } = await supabase.from('events').insert({
            artist_id: user.id,
            event_name: 'E2E Automated Test Event',
            start_date: today + ' 00:00:00', // ✅ สำคัญมาก: เริ่มเที่ยงคืน
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
        
        // Ensure queue is OPEN initially
        const isClosed = await toggleButton.evaluate((el) => el.classList.contains('bg-red-500'));
        if (isClosed) {
            await toggleButton.click();
            await expect(toggleButton).toHaveClass(/bg-green-500/);
            await page.waitForTimeout(500);
        }

        // Toggle OFF (Pause)
        const pauseRequest = page.waitForResponse(resp => 
            resp.url().includes('/rest/v1/artists') && 
            (resp.request().method() === 'PATCH' || resp.request().method() === 'POST') &&
            resp.status() >= 200 && resp.status() < 300
        );
        
        await toggleButton.click();
        await pauseRequest; 

        await expect(toggleButton).toHaveClass(/bg-red-500/); 
        await expect(page.getByText('QUEUE PAUSED')).toBeVisible();

        // Check Customer View
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

        // Reset to OPEN
        await page.bringToFront();
        await toggleButton.click();
        await expect(toggleButton).toHaveClass(/bg-green-500/);

        await customerContext.close();
    });

    // --- Scenario 2: Notification Priority (Fixed Flow) ---
    test('Scenario 2: Calling Notification overrides Broadcast', async ({ page, browser }) => {
        
        // STEP 0: Force Open Queue (Admin Side)
        const toggleButton = page.locator('button.relative.inline-flex.h-5.w-9').first();
        const isClosed = await toggleButton.evaluate((el) => el.classList.contains('bg-red-500'));
        if (isClosed) {
            await toggleButton.click();
            await expect(toggleButton).toHaveClass(/bg-green-500/);
            await page.waitForTimeout(500);
        }

        // STEP 0.5: Reset Broadcast (Clear old messages)
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

        // ✅ STEP 1: Customer Gets Ticket FIRST (While Shop is Open)
        const customerContext = await browser.newContext();
        const customerPage = await customerContext.newPage();
        
        // ไปที่หน้า Queue
        await customerPage.goto(`${BASE_URL}/${TEST_SLUG}/queue`);

        // รอ Network Idle (มั่นใจว่าโหลดข้อมูลเสร็จ)
        await customerPage.waitForLoadState('networkidle');

        const getTicketBtn = customerPage.getByRole('button', { name: 'Get Ticket' });
        
        // Robust Check: ถ้าไม่เจอปุ่ม ให้ Reload 1 ที
        if (!(await getTicketBtn.isVisible({ timeout: 5000 }))) {
             console.log('⚠️ Get Ticket Button not found immediately. Reloading...');
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

        // ✅ STEP 2: Admin Sets "Break Time" (After Ticket is Taken)
        await page.bringToFront();
        const broadcastRequest = page.waitForResponse(resp => 
            resp.url().includes('/rest/v1/artists') && 
            (resp.request().method() === 'PATCH' || resp.request().method() === 'POST') &&
            resp.status() >= 200 && resp.status() < 300
        );

        await breakBtn.click();
        await broadcastRequest;
        await expect(breakBtn).toHaveClass(/ring-pink-500/);

        // ✅ STEP 3: Verify Broadcast is Visible (Customer sees Pink Banner)
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
        
        // Smart Loop to ensure call happens
        for (let i = 0; i < 5; i++) {
            // เช็คว่าลูกค้าโดนเรียกหรือยัง (รองรับทั้งไทยและอังกฤษ)
            const isCalled = await customerPage.getByText('Your Turn!').or(customerPage.getByText('ถึงคิวแล้ว!')).isVisible();
            if (isCalled) break;

            if (await callNextBtn.isDisabled()) {
                await page.reload(); // รีเฟรชหน้า Admin เผื่อ State ค้าง
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
            
        // ✅ STEP 5: Verify Priority (Yellow Calling Banner > Pink Break Banner)
        await customerPage.bringToFront();
        
        const callingMessage = customerPage.getByText('Your Turn!').or(customerPage.getByText('ถึงคิวแล้ว!'));
        
        if (!(await callingMessage.isVisible())) {
            await customerPage.reload();
        }
        
        await expect(callingMessage).toBeVisible({ timeout: 10000 });
        
        // สำคัญ: ป้าย Break time ต้องหายไป (เพราะโดน Calling บัง)
        await expect(customerPage.getByText('Break time')).not.toBeVisible();

        // Cleanup
        await page.bringToFront();
        const finalClearBtn = page.getByTitle('Clear Message');
        if (await finalClearBtn.isVisible()) await finalClearBtn.click();
        
        await customerContext.close();
    });

});