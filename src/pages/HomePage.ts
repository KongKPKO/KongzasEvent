import { type Locator, type Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class HomePage extends BasePage {
    readonly heading: Locator;
    readonly commissionStatus: Locator;
    readonly scheduleContainer: Locator;
    readonly socialsContainer: Locator;

    constructor(page: Page) {
        super(page);
        this.heading = page.locator('h1', { hasText: 'Genshin Impact Artist' });
        this.commissionStatus = page.locator('text=Commissions Open');
        // Assuming components render specific identifiable content, or we target via class/structure
        // Based on Home.tsx, EventSchedule and Socials are rendered.
        // We will assert their presence generically or via specific text known to be in them (if available)
        // or just the container div structure if needed. 
        // For now, checking main containers.
        this.scheduleContainer = page.locator('.space-y-6').first(); 
        this.socialsContainer = page.locator('.flex.justify-center.gap-6'); // Typical social container class (guess) or we check children later
    }

    async goto() {
        await super.goto('/');
    }

    async expectLoaded() {
        await expect(this.heading).toBeVisible();
        await expect(this.commissionStatus).toBeVisible();
    }
}
