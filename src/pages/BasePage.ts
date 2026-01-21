import { type Page } from '@playwright/test';

/**
 * BasePage provides common methods and properties for all page objects.
 * @abstract
 */
export abstract class BasePage {
    /**
     * The Playwright Page object.
     * @readonly
     */
    readonly page: Page;

    /**
     * @param {Page} page - The Playwright Page instance.
     */
    constructor(page: Page) {
        this.page = page;
    }

    /**
     * Navigates to a specific URL path.
     * @param {string} path - The URL path to navigate to.
     * @returns {Promise<void>}
     */
    async goto(path: string): Promise<void> {
        await this.page.goto(path);
    }

    /**
     * Waits for the URL to contain the specified text.
     * @param {string} urlPart - The part of the URL to wait for.
     * @returns {Promise<void>}
     */
    async waitForUrl(urlPart: string): Promise<void> {
        await this.page.waitForURL(new RegExp(urlPart));
    }
}
