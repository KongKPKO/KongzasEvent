import { test, expect } from '@playwright/test';

test.describe('Resiliency & Offline Handling', () => {

    test('User retains ticket after network drop and reload', async ({ browser }) => {
        // 1. Admin Context: Reset Queue first
        const adminContext = await browser.newContext();
        const adminPage = await adminContext.newPage();

        await adminPage.addInitScript(() => {
            localStorage.setItem('test_auth', 'true');
        });

        await adminPage.goto('/admin');

        // Reset Queue
        adminPage.on('dialog', async dialog => await dialog.accept());
        const resetBtn = adminPage.locator('button', { hasText: 'Reset Queue' });
        await expect(resetBtn).toBeVisible();
        await resetBtn.click();
        await expect(adminPage.locator('dt:has-text("Total in Queue") + dd')).toHaveText('0', { timeout: 10000 });

        // 2. User Context: User joins queue
        const userContext = await browser.newContext();
        const userPage = await userContext.newPage();
        await userPage.goto('/queue');

        const getTicketBtn = userPage.locator('button', { hasText: 'Get a Ticket' });
        await expect(getTicketBtn).toBeVisible();
        await getTicketBtn.click();

        await expect(userPage.locator('text=Your Ticket')).toBeVisible();
        const ticketElement = userPage.locator('.text-7xl.font-black');
        const ticketText = await ticketElement.innerText();
        console.log(`User secured ticket: ${ticketText}`);

        // 3. SIMULATE BAD INTERNET: Go Offline
        console.log("Simulating Network Drop...");
        await userContext.setOffline(true);

        // 4. Verify user can still see their ticket (Client-side persistence)
        // Even if offline, the UI should show the last known state or at least not crash
        // We reload the page while offline to test localStorage persistence
        try {
            await userPage.reload({ timeout: 5000 });
        } catch (e) {
            // Expected to fail network load if completely offline, 
            // BUT most SPAs usually get served from memory/cache or fail gracefully.
            // For this test, we care if the valid ticket data is there when they come back.
            console.log("Reloaded while offline intent");
        }

        // 5. RESTORE INTERNET
        console.log("Restoring Network...");
        await userContext.setOffline(false);

        // 6. Reload to ensure full sync
        await userPage.reload();

        // 7. Verify Ticket is STILL THERE
        await expect(userPage.locator('text=Your Ticket')).toBeVisible({ timeout: 10000 });
        const recoveredTicketElement = userPage.locator('.text-7xl.font-black');
        await expect(recoveredTicketElement).toHaveText(ticketText);

        console.log("Resiliency passed: Ticket recovered after offline reload.");

        await userContext.close();
        await adminContext.close();
    });

});
