import { type Locator, type Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class MenuPage extends BasePage {
    readonly heading: Locator;
    readonly menuItems: Locator;
    readonly totalContainer: Locator;

    constructor(page: Page) {
        super(page);
        this.heading = page.locator('h1', { hasText: 'Genshin Impact Menu' });
        // The items have "Add to Cart" or price displayed.
        this.menuItems = page.locator('button', { hasText: 'Add to Cart' });
        this.totalContainer = page.locator('text=Total Price');
    }

    async goto() {
        await super.goto('/menu');
    }

    async expectLoaded() {
        await expect(this.heading).toBeVisible();
        await expect(this.totalContainer).toBeVisible();
        // There should be at least one item
        await expect(this.menuItems.first()).toBeVisible();
    }
}
