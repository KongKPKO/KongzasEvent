import { Page, expect } from '@playwright/test';

export class AdminEventsPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto('/manage-events');
  }

  async createEvent(eventName: string) {
    await this.page.getByRole('button', { name: 'Add Event' }).click();
    
    // Fill Modal
    await this.page.fill('input[name="event_name"]', eventName);
    
    // Set dates (Today + Tomorrow for safety)
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Format for datetime-local: YYYY-MM-DDTHH:MM
    const format = (d: Date) => d.toISOString().slice(0, 16);
    
    await this.page.fill('input[name="start_date"]', format(now));
    await this.page.fill('input[name="end_date"]', format(tomorrow));
    
    await this.page.getByRole('button', { name: 'Save Event' }).click();
    
    // Check if created
    await expect(this.page.getByText(eventName)).toBeVisible();
  }
}
