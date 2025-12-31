import { test, expect } from '@playwright/test';

test.describe('Queue Expiration & Recovery', () => {

    test('Expired ticket can be confirmed and restored', async ({ browser }) => {
        // 1. Admin Context
        const adminContext = await browser.newContext();
        const adminPage = await adminContext.newPage();
        
        // Mock Auth
        await adminPage.addInitScript(() => {
            localStorage.setItem('test_auth', 'true');
        });
        
        await adminPage.goto('/admin');

        // Reset Queue
        adminPage.on('dialog', async dialog => await dialog.accept());
        await adminPage.locator('button', { hasText: 'Reset Queue' }).click();
        await expect(adminPage.locator('dt:has-text("Total in Queue") + dd')).toHaveText('0');

        // 2. User Context
        const userContext = await browser.newContext();
        const userPage = await userContext.newPage();
        await userPage.goto('/queue');
        
        const getTicketBtn = userPage.locator('button', { hasText: 'Get a Ticket' });
        await expect(getTicketBtn).toBeVisible();
        await getTicketBtn.click();
        
        // Wait for ticket and status
        await expect(userPage.locator('text=Your Ticket')).toBeVisible({ timeout: 15000 });
        await expect(userPage.locator('text=Please Wait')).toBeVisible({ timeout: 15000 });

        // 3. Admin calls next
        const callNextBtn = adminPage.locator('button', { hasText: 'Call Next Ticket' });
        // Wait for connection/sync
        await expect(callNextBtn).toBeEnabled({ timeout: 15000 });
        await callNextBtn.click();
        
        // User is Ready
        await expect(userPage.locator("text=It's your turn!")).toBeVisible({ timeout: 15000 });

        // 4. Force Expiry
        console.log("Forcing expiration...");
        await adminPage.evaluate(async () => {
            // @ts-ignore
            if (window.queueService && window.queueService._forceExpire) {
                // @ts-ignore
                await window.queueService._forceExpire(1);
            }
        });

        // 5. Verify Expiry UI
        // Admin should see it in "Missed" list
        const missedHeader = adminPage.locator('h3', { hasText: 'Missed' });
        await expect(missedHeader).toContainText('(1)');
        
        // User should see "Ticket Expired"
        await expect(userPage.locator('text=Ticket Expired')).toBeVisible({ timeout: 15000 });

        // 6. Confirm Arrival (Restore)
        const confirmBtn = adminPage.locator('button', { hasText: 'Confirm Arrival' }).first();
        await expect(confirmBtn).toBeVisible();
        await confirmBtn.click();

        // 7. Verify Restoration
        // Ticket moves to "Being Served"
        // User sees "You are being served"
        await expect(userPage.locator('text=You are being served')).toBeVisible();
        
        // Admin: Missed count goes back to 0 (or list empty)
        await expect(adminPage.locator('h3', { hasText: 'Missed' })).toContainText('(0)');

        // Cleanup
        await adminContext.close();
        await userContext.close();
    });
});
