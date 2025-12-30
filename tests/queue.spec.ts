import { test, expect } from '@playwright/test';

test.describe('Queue System Flow', () => {

    test('User gets ticket, Admin calls next, User sees Ready', async ({ browser }) => {
        // 1. Admin Context: Admin resets the queue to ensure a clean state
        const adminContext = await browser.newContext();
        const adminPage = await adminContext.newPage();

        // Bypass Auth
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

        // Check if queue is already empty, otherwise reset
        const resetBtn = adminPage.locator('button', { hasText: 'Reset Queue' });
        await expect(resetBtn).toBeVisible();
        await resetBtn.click();
        console.log("Admin reset the queue.");

        // Wait for queue to be empty
        await expect(adminPage.locator('dt:has-text("Total in Queue") + dd')).toHaveText('0', { timeout: 10000 });

        // 2. User Context: Customer opens the Queue Page
        const userContext = await browser.newContext();
        const userPage = await userContext.newPage();
        await userPage.goto('/queue');

        // 3. User Gets Ticket
        const getTicketBtn = userPage.locator('button', { hasText: 'Get a Ticket' });
        await expect(getTicketBtn).toBeVisible();
        await getTicketBtn.click();

        // Verify Ticket # appears (Status starts as "Please Wait")
        await expect(userPage.locator('text=Your Ticket')).toBeVisible({ timeout: 10000 });
        await expect(userPage.locator('text=Please Wait')).toBeVisible({ timeout: 10000 });

        // 4. Admin Context: Reuse existing admin page
        // Verify Admin sees the same ticket in "Next Ticket" or Waiting list
        // Check "Waiting List" count
        const waitingCount = adminPage.locator('dt:has-text("Waiting") + dd');
        await expect(waitingCount).not.toHaveText('0', { timeout: 15000 });
        console.log("Admin sees waiting ticket.");

        // 5. Admin calls next
        const callNextBtn = adminPage.locator('button', { hasText: 'Call Next Ticket' });
        // It might be disabled initially if data hasn't synced, wait for it
        await expect(callNextBtn).toBeEnabled({ timeout: 10000 });
        await callNextBtn.click();
        console.log("Admin called next.");

        // 4. Verify Admin sees "Waiting for Arrival" and "Confirm Arrival" button
        // Wait for the header to show at least 1 ticket
        await expect(adminPage.locator('h4', { hasText: 'Waiting for Arrival' })).not.toContainText('(0)', { timeout: 15000 });

        // Now check for the button
        const confirmBtn = adminPage.locator('button', { hasText: 'Confirm Arrival' }).first();
        await expect(confirmBtn).toBeVisible();

        // 5. User Context: Verify status changed to "It's your turn!" (Ready)
        await expect(userPage.locator("text=It's your turn!")).toBeVisible({ timeout: 10000 });
        await expect(userPage.locator('text=READY')).toBeVisible();

        // 6. Admin Confirms Arrival -> Serving
        await confirmBtn.click();
        console.log("Admin confirmed arrival.");

        // 7. User Context: Verify status changed to "You are being served" (Serving)
        await expect(userPage.locator('text=You are being served')).toBeVisible({ timeout: 10000 });
        // await expect(userPage.locator('text=SERVING')).toBeVisible({ timeout: 10000 });

        // 8. Admin Marks Complete -> Complete
        const markCompleteBtn = adminPage.locator('button', { hasText: 'Mark Complete' });
        await expect(markCompleteBtn).toBeVisible({ timeout: 10000 });
        await markCompleteBtn.click();
        console.log("Admin marked complete.");

        // 9. User Context: Verify status changed to "Thank you" (Complete)
        await expect(userPage.locator('text=Thank you for your support')).toBeVisible({ timeout: 10000 });
        // await expect(userPage.locator('text=COMPLETE')).toBeVisible({ timeout: 10000 });

        // Cleanup
        await userContext.close();
        await adminContext.close();
    });

});
