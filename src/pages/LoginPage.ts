import { type Locator, type Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class LoginPage extends BasePage {
    readonly emailInput: Locator;
    readonly passwordInput: Locator;
    readonly loginButton: Locator;
    readonly errorAlert: Locator;

    constructor(page: Page) {
        super(page);
        this.emailInput = page.locator('input[type="email"]');
        this.passwordInput = page.locator('input[type="password"]');
        this.loginButton = page.locator('button[type="submit"]');
        this.errorAlert = page.locator('.bg-red-50');
    }

    async goto() {
        await super.goto('/login');
    }

    async login(email: string, pass: string) {
        await this.emailInput.fill(email);
        await this.passwordInput.fill(pass);
        await this.loginButton.click();
    }

    async expectError(message: string) {
        await expect(this.errorAlert).toBeVisible();
        await expect(this.errorAlert).toContainText(message);
    }
}
