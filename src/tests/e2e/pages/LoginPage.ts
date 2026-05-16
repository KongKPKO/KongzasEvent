import { Page } from '@playwright/test';

export class LoginPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto('/manage-login');
  }

  get creatorModeButton() {
    return this.page.getByRole('tab', { name: 'Creator / Manager' });
  }

  get staffModeButton() {
    return this.page.getByRole('tab', { name: 'Staff' });
  }

  get forgotPasswordButton() {
    return this.page.getByRole('button', { name: 'Forgot password?' });
  }

  get staffMagicLinkButton() {
    return this.page.getByRole('button', { name: /Send staff magic link/i });
  }

  async login(email: string, pass: string) {
    await this.page.fill('input[type="email"]', email);
    await this.page.fill('input[type="password"]', pass);
    await this.page.click('button[type="submit"]'); // Adjust selector if needed
  }

  async switchToStaffMode() {
    await this.staffModeButton.click();
  }

  async switchToCreatorMode() {
    await this.creatorModeButton.click();
  }
}
