import { test, expect } from '@playwright/test';
import { AdminDashboardPage } from '../pages/AdminDashboardPage';

test.describe('Admin Dashboard', () => {
    test.beforeEach(async ({ page }) => {
        // Bypass login
        const adminPage = new AdminDashboardPage(page);
        await adminPage.bypassAuth();
    });

    test('loads dashboard and sees queue stats', async ({ page }) => {
        const adminPage = new AdminDashboardPage(page);
        await adminPage.goto();
        await adminPage.expectLoaded();
        
        // Check stats presence
        await expect(adminPage.totalQueueValue).toBeVisible();
        await expect(adminPage.waitingList).toBeVisible();
        await expect(adminPage.resetBtn).toBeVisible();
    });

    test('can reset queue', async ({ page }) => {
        const adminPage = new AdminDashboardPage(page);
        await adminPage.goto();
        await adminPage.resetQueue();
        
        // Expect clean state
        await expect(adminPage.totalQueueValue).toHaveText('0');
    });
});
