import { type Locator, type Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * QueuePage represents the queue view for a specific artist/store.
 * Only handles User interactions (not Admin).
 */
export class QueuePage extends BasePage {
    readonly getTicketBtn: Locator;
    readonly ticketNumber: Locator;
    readonly readyStatus: Locator;
    readonly servingStatus: Locator;
    readonly completeStatus: Locator;
    readonly pleaseWaitStatus: Locator;

    /**
     * @param {Page} page - The Playwright Page instance.
     */
    constructor(page: Page) {
        super(page);
        this.getTicketBtn = page.locator('button', { hasText: 'Get a Ticket' });
        this.ticketNumber = page.locator('text=Your Ticket');
        // General locators for status text
        this.pleaseWaitStatus = page.locator('text=Please Wait');
        this.readyStatus = page.locator("text=It's your turn!"); 
        this.servingStatus = page.locator('text=You are being served');
        this.completeStatus = page.locator('text=Thank you for your support');
    }

    /**
     * Navigates to the queue page for a specific artist.
     * @param {string} artistId - The unique ID of the artist/store.
     * @returns {Promise<void>}
     */
    async goto(artistId: string = 'queue'): Promise<void> {
        // If artistId is 'queue', it maps to the default route used in the original test '/queue'
        // For multi-tenancy it would be `/${artistId}/queue`. 
        // Based on the user request, they want dynamic URL support: /${artistId}/queue.
        // However, the original test used '/queue'. Assuming the app supports routing, 
        // we will use the requested pattern but default to something that works or matches the request.
        // The request asked strictly: "The goto() method should accept an artistId: string to construct the dynamic URL"
        // But the original test used just `/queue`. 
        // If I change it to `/${artistId}/queue` and existing app doesn't have that route, it fails.
        // I will implement as requested but default to '/queue' if artistId is strictly 'default' or similar?
        // Actually, the request said: "construct the dynamic URL (e.g., /${artistId}/queue)".
        // I'll assume for the 'default' case (original test) we might need to pass an effective root or handle it.
        // Let's implement the dynamic one, but for the refactor of existing test, we might need to ensure consistency.
        // If the current app only has `/queue`, then `artistId` parameter might break it if we force the path.
        // Let's assume the existing path `/queue` is what we want for now for the loopback.
        
        // CORRECTION: The user asked for "support multi-tenancy... goto() method should accept an artistId".
        // I will implement strictly as requested.
        
        if (artistId === 'default' || artistId === 'queue') {
             await super.goto('/queue');
        } else {
             await super.goto(`/${artistId}/queue`);
        }
    }

    /**
     * Clicks the 'Get a Ticket' button.
     * @returns {Promise<void>}
     */
    async getTicket(): Promise<void> {
        await expect(this.getTicketBtn).toBeVisible();
        await this.getTicketBtn.click();
    }

    /**
     * Verifies the ticket number is visible.
     * @returns {Promise<void>}
     */
    async expectTicketVisible(): Promise<void> {
        await expect(this.ticketNumber).toBeVisible({ timeout: 10000 });
    }

    /**
     * Verifies the current status matches the expected state.
     * @param {'Please Wait' | 'Ready' | 'Serving' | 'Complete'} status - The expected status.
     * @returns {Promise<void>}
     */
    async expectStatus(status: 'Please Wait' | 'Ready' | 'Serving' | 'Complete'): Promise<void> {
        switch (status) {
            case 'Please Wait':
                await expect(this.pleaseWaitStatus).toBeVisible({ timeout: 10000 });
                break;
            case 'Ready':
                await expect(this.readyStatus).toBeVisible({ timeout: 10000 });
                await expect(this.page.locator('text=READY')).toBeVisible(); 
                break;
            case 'Serving':
                await expect(this.servingStatus).toBeVisible({ timeout: 10000 });
                break;
            case 'Complete':
                await expect(this.completeStatus).toBeVisible({ timeout: 10000 });
                break;
        }
    }
}
