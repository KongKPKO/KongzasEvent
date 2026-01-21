import { type Locator, type Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class AdminDashboardPage extends BasePage {
    readonly heading: Locator;
    readonly resetBtn: Locator;
    readonly callNextBtn: Locator;
    readonly totalQueueValue: Locator;
    readonly waitingList: Locator;

    constructor(page: Page) {
        super(page);
        this.heading = page.locator('h2', { hasText: 'Admin Dashboard' });
        this.resetBtn = page.locator('button', { hasText: 'Reset Queue' });
        this.callNextBtn = page.locator('button', { hasText: 'Call Next Ticket' });
        this.totalQueueValue = page.locator('dt:has-text("Total in Queue") + dd');
        this.waitingList = page.locator('h3:has-text("Waiting List")');
    }

    async goto() {
        await super.goto('/admin');
    }

    async resetQueue() {
        this.page.once('dialog', async dialog => {
            await dialog.accept();
        });
        await this.resetBtn.click();
    }

    async callNext() {
        await expect(this.callNextBtn).toBeEnabled();
        await this.callNextBtn.click();
    }

    async expectLoaded() {
        await expect(this.heading).toBeVisible();
    }

    /**
     * Bypasses authentication for testing.
     */
    async bypassAuth() {
        await this.page.addInitScript(() => {
            localStorage.setItem('test_auth', 'true');
        });
    }
}
