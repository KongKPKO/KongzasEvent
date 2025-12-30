import { test, expect } from '@playwright/test';

test.describe('Stress Testing', () => {

    // CAUTION: This runs multiple tabs simultaneously.
    // It tests if the backend handles concurrent joins without duplicating IDs.
    test('Handle 20 concurrent users joining rapidly', async ({ browser }) => {
        test.setTimeout(120000); // 2 minutes for high load simulation
        // 1. Admin Reset
        const adminContext = await browser.newContext();
        const adminPage = await adminContext.newPage();
        await adminPage.addInitScript(() => localStorage.setItem('test_auth', 'true'));
        await adminPage.goto('/admin');
        adminPage.on('dialog', async dialog => await dialog.accept());
        await adminPage.locator('button', { hasText: 'Reset Queue' }).click();
        await expect(adminPage.locator('dt:has-text("Total in Queue") + dd')).toHaveText('0', { timeout: 10000 });

        const CONCURRENT_USERS = 20;
        console.log(`Starting Stress Test with ${CONCURRENT_USERS} users...`);

        // 2. Spawn 20 User Contexts
        const userContexts = [];
        const userPages = [];

        for (let i = 0; i < CONCURRENT_USERS; i++) {
            const context = await browser.newContext();
            const page = await context.newPage();
            userContexts.push(context);
            userPages.push(page);
        }

        // 3. Navigate all to /queue (in parallel)
        await Promise.all(userPages.map(page => page.goto('/queue')));

        // 4. Click "Get Ticket" on all pages (Simulating a "Drop")
        // We map the clicks to an array of promises to fire them as close to simultaneously as possible
        console.log("BOOM! All users clicking 'Get Ticket' now...");

        const clickPromises = userPages.map(async (page, index) => {
            try {
                const btn = page.locator('button', { hasText: 'Get a Ticket' });
                await expect(btn).toBeVisible({ timeout: 60000 });
                await btn.click();
                // Wait for ticket to appear
                await expect(page.locator('text=Your Ticket')).toBeVisible({ timeout: 60000 });

                // Grab ticket ID
                const ticketText = await page.locator('.text-7xl.font-black').innerText();
                return ticketText;
            } catch (e) {
                console.error(`User ${index} failed:`, e);
                return null;
            }
        });

        const results = await Promise.all(clickPromises);

        // 5. Analysis
        const successfulTickets = results.filter(t => t !== null);
        console.log(`Successfully issued ${successfulTickets.length} / ${CONCURRENT_USERS} tickets.`);

        // Check for Duplicates
        const uniqueTickets = new Set(successfulTickets);
        if (uniqueTickets.size !== successfulTickets.length) {
            console.error("DUPLICATE TICKETS DETECTED!");
            console.error("Issued:", successfulTickets);
        }

        expect(uniqueTickets.size).toBe(successfulTickets.length);
        expect(successfulTickets.length).toBeGreaterThan(0);

        // Cleanup
        for (const ctx of userContexts) {
            await ctx.close();
        }
        await adminContext.close();
    });

});
