// CustomerPage.ts
import { Page, expect } from '@playwright/test';

export class CustomerPage {
  constructor(private page: Page) {}

  async goto(artistSlug: string) {
    console.log(`[Customer] Navigating to /${artistSlug}`);
    
    try {
      // Navigate with less strict load state
      await this.page.goto(`/${artistSlug}`, {
        waitUntil: 'domcontentloaded', // แทน 'networkidle'
        timeout: 30000
      });
      
      console.log(`[Customer] Page loaded at ${this.page.url()}`);
      
      // Wait for key UI elements instead
      await Promise.race([
        this.page.waitForSelector('text=/queue|get ticket|booth/i', { timeout: 10000 }),
        this.page.waitForTimeout(5000) // Fallback timeout
      ]);
      
      console.log('[Customer] Page ready ✓');
      
    } catch (error) {
      console.error(`[Customer] Failed to load /${artistSlug}:`, error);
      await this.page.screenshot({ path: 'debug-customer-goto-failed.png' });
      throw error;
    }
  }

  async getTicket() {
    console.log('[Customer] Attempting to get ticket...');
    
    // Wait for realtime data to load
    await this.page.waitForTimeout(3000);
    
    // Debug screenshot
    await this.page.screenshot({ path: 'debug-before-get-ticket.png', fullPage: true });
    
    // Check for error messages
    const errorMessages = [
      { locator: this.page.getByText(/queuing is closed/i), msg: 'Queue is closed' },
      { locator: this.page.getByText(/booth closed/i), msg: 'Booth is closed' },
      { locator: this.page.getByText(/event.*cancelled/i), msg: 'Event cancelled' },
      { locator: this.page.getByText(/no.*event/i), msg: 'No active event' }
    ];
    
    for (const { locator, msg } of errorMessages) {
      if (await locator.isVisible().catch(() => false)) {
        console.error(`[Customer] ${msg}`);
        throw new Error(`Cannot get ticket: ${msg}`);
      }
    }
    
    // Find the Get Ticket button with multiple variations
    const buttonSelectors = [
      this.page.getByRole('button', { name: /get ticket/i }),
      this.page.getByRole('button', { name: /join queue/i }),
      this.page.getByRole('button', { name: /join the queue/i }),
      this.page.locator('button:has-text("Get Ticket")'),
    ];
    
    let ticketButton = null;
    for (const selector of buttonSelectors) {
      if (await selector.isVisible().catch(() => false)) {
        ticketButton = selector;
        break;
      }
    }
    
    if (!ticketButton) {
      console.error('[Customer] Get Ticket button not found');
      const bodyText = await this.page.locator('body').textContent();
      console.log('[Customer] Page content:', bodyText?.substring(0, 500));
      throw new Error('Get Ticket button not found on page');
    }
    
    // Wait for button to be enabled
    await ticketButton.waitFor({ state: 'visible', timeout: 10000 });
    
    const isDisabled = await ticketButton.isDisabled();
    if (isDisabled) {
      const buttonText = await ticketButton.textContent();
      console.error(`[Customer] Button is disabled. Shows: "${buttonText}"`);
      throw new Error(`Get Ticket button is disabled (shows: "${buttonText}")`);
    }
    
    // Click and wait for response
    console.log('[Customer] Clicking Get Ticket button...');
    await ticketButton.click();
    
    // Wait for ticket number to appear
    try {
      await this.page.waitForSelector('.text-7xl', { timeout: 15000 });
      const ticketNumber = await this.page.locator('.text-7xl').textContent();
      console.log(`[Customer] Ticket received: ${ticketNumber} ✓`);
    } catch (error) {
      await this.page.screenshot({ path: 'debug-after-click-ticket.png' });
      console.error('[Customer] Ticket number did not appear');
      throw error;
    }
  }

  async verifyStatus(status: string) {
    console.log(`[Customer] Verifying status: "${status}"`);
    
    // Map of status to possible text variations
    const statusPatterns: Record<string, RegExp> = {
      'Waiting': /waiting|you are in the queue/i,
      "It's Your Turn": /it's your turn|calling|proceed to.*booth/i,
      "Being Served": /being served|active/i,
      "Completed": /completed|thank you|order.*complete/i,
      "Cancelled": /cancelled|missed/i,
      "Expired": /expired/i
    };
    
    const pattern = statusPatterns[status] || new RegExp(status, 'i');
    const locator = this.page.getByText(pattern);
    
    try {
      await expect(locator).toBeVisible({ timeout: 15000 });
      console.log(`[Customer] Status verified: "${status}" ✓`);
    } catch (error) {
      await this.page.screenshot({ path: `debug-status-${status}-not-found.png` });
      const bodyText = await this.page.locator('body').textContent();
      console.error(`[Customer] Status "${status}" not found. Page shows:`, bodyText?.substring(0, 500));
      throw error;
    }
  }
}