import { test, expect } from '@playwright/test';
import { QueuePage } from '../pages/QueuePage';

test.describe('Queue System Flow', () => {

    test('User gets ticket, Admin calls next, User sees Ready', async ({ browser }) => {
        test.setTimeout(60000);
        // --- 1. Admin Context: Reset Queue ---
        // Creating specific context for Admin to simulate separate device/session
        const adminContext = await browser.newContext();
        const adminPage = await adminContext.newPage();

        // Bypass Auth for Admin
        await adminPage.addInitScript(() => {
            localStorage.setItem('test_auth', 'true');
        });

        await adminPage.goto('/admin');

        // Handle Confirm Dialog for Reset
        adminPage.on('dialog', async dialog => {
            console.log(`Dialog message: ${dialog.message()}`);
            await dialog.accept();
        });

        // Verify Admin loaded
        await expect(adminPage.locator('h2', { hasText: 'Admin Dashboard' })).toBeVisible();

        // Reset Queue if needed
        const resetBtn = adminPage.locator('button', { hasText: 'Reset Queue' });
        await expect(resetBtn).toBeVisible();
        await resetBtn.click();
        console.log("Admin reset the queue.");

        // Wait for queue to be empty
        await expect(adminPage.locator('dt:has-text("Total in Queue") + dd')).toHaveText('0', { timeout: 10000 });


        // --- 2. User Context: Customer Flow using POM ---
        const userContext = await browser.newContext();
        const userPage = await userContext.newPage();
        
        // Instantiate the Page Object
        const queuePage = new QueuePage(userPage);

        // Navigate to Queue Page (using default for existing compatibility)
        await queuePage.goto('default');

        // User gets a ticket
        await queuePage.getTicket();

        // Verify Ticket # appears and Status is 'Please Wait'
        await queuePage.expectTicketVisible();
        await queuePage.expectStatus('Please Wait');


        // --- 3. Admin Context: Manage Queue ---
        // Verify Admin sees the waiting ticket
        const waitingCount = adminPage.locator('dt:has-text("Waiting") + dd');
        await expect(waitingCount).not.toHaveText('0', { timeout: 15000 });
        console.log("Admin sees waiting ticket.");

        // Admin calls next
        const callNextBtn = adminPage.locator('button', { hasText: 'Call Next Ticket' });
        await expect(callNextBtn).toBeEnabled({ timeout: 10000 });
        await callNextBtn.click();
        console.log("Admin called next.");

        // Verify Admin sees "Waiting for Arrival" and "Confirm Arrival" button
        await expect(adminPage.locator('h4', { hasText: 'Waiting for Arrival' })).not.toContainText('(0)', { timeout: 15000 });
        const confirmBtn = adminPage.locator('button', { hasText: 'Confirm Arrival' }).first();
        await expect(confirmBtn).toBeVisible();


        // --- 4. User Context: Verify 'Ready' ---
        await queuePage.expectStatus('Ready');


        // --- 5. Admin Context: Confirm Arrival -> Serving ---
        await confirmBtn.click();
        console.log("Admin confirmed arrival.");


        // --- 6. User Context: Verify 'Serving' ---
        await queuePage.expectStatus('Serving');


        // --- 7. Admin Context: Mark Complete ---
        const markCompleteBtn = adminPage.locator('button', { hasText: 'Mark Complete' });
        await expect(markCompleteBtn).toBeVisible({ timeout: 10000 });
        await markCompleteBtn.click();
        console.log("Admin marked complete.");


        // --- 8. User Context: Verify 'Complete' ---
        await queuePage.expectStatus('Complete');


        // --- Cleanup ---
        await userContext.close();
        await adminContext.close();
    });

});
