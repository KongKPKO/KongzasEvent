import { Page, expect } from '@playwright/test';

export class AdminPOSPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto('/manage-orders');
  }

  async selectQueue(queueNumber: string) {
    await this.page.getByRole('button', { name: `#${queueNumber}` }).click();
  }

  async addToCart(productName: string) {
    await this.page.getByText(productName).first().click();
  }

  async chargeAndPay(method: 'CASH' | 'TRANSFER') {
    // Click Charge
    await this.page.getByRole('button', { name: /Charge/ }).click();
    
    // Click Payment Method
    await this.page.getByRole('button', { name: method }).click();
  }

  async verifyOrderCompleted() {
    // Alert check is tricky in Playwright without listener, but the cart clearing is a good proxy
    await expect(this.page.getByText('Your cart is empty')).toBeVisible();
  }
}
