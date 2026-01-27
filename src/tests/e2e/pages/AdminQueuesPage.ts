import { Page, expect } from '@playwright/test';

export class AdminQueuesPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/manage-queues');
    await this.page.waitForLoadState('networkidle');
  }

  async ensureQueueOpen() {
    console.log('[Admin] Ensuring queue is open...');
    
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(2000);
    
    // Check current status
    const boothStatusText = await this.page.textContent('body');
    console.log('[Admin] Page content preview:', boothStatusText?.substring(0, 200));
    
    // Find "BOOTH CLOSED" or "QUEUE PAUSED" buttons
    const boothClosedButton = this.page.getByRole('button', { name: /booth closed/i });
    const queuePausedButton = this.page.getByRole('button', { name: /queue paused/i });
    
    try {
      // 1. Open Booth if closed
      if (await boothClosedButton.isVisible().catch(() => false)) {
        console.log('[Admin] Booth is closed, opening...');
        await boothClosedButton.click();
        await this.page.waitForTimeout(1000);
        
        // Wait for "BOOTH OPEN" to appear
        const boothOpenButton = this.page.getByRole('button', { name: /booth open/i });
        await boothOpenButton.waitFor({ state: 'visible', timeout: 5000 });
        console.log('[Admin] Booth opened ✓');
      }
      
      // 2. Unpause Queue if paused
      if (await queuePausedButton.isVisible().catch(() => false)) {
        console.log('[Admin] Queue is paused, unpausing...');
        await queuePausedButton.click();
        await this.page.waitForTimeout(1000);
        
        // Wait for "QUEUE OPEN" to appear
        const queueOpenButton = this.page.getByRole('button', { name: /queue open/i });
        await queueOpenButton.waitFor({ state: 'visible', timeout: 5000 });
        console.log('[Admin] Queue opened ✓');
      }
      
      console.log('[Admin] Queue is ready ✓');
      
    } catch (error) {
      await this.page.screenshot({ path: 'debug-queue-status-error.png' });
      console.error('[Admin] Error ensuring queue open:', error);
      throw error;
    }
  }

  async verifyTicketInWaiting(queueNum: string) {
    console.log(`[Admin] Verifying ticket #${queueNum} is in waiting list`);
    
    // Reload to get fresh data
    await this.page.reload();
    await this.page.waitForLoadState('networkidle');
    
    // Look for the ticket number in waiting section
    const ticketElement = this.page.locator('.waiting-section, [data-status="waiting"]').getByText(`#${queueNum}`);
    await expect(ticketElement).toBeVisible({ timeout: 10000 });
    console.log(`[Admin] Ticket #${queueNum} found in waiting list ✓`);
  }

  async callNext() {
    console.log('[Admin] Calling next ticket...');
    const callButton = this.page.getByRole('button', { name: /call next/i });
    await callButton.click();
    await this.page.waitForTimeout(1000);
    console.log('[Admin] Called next ticket ✓');
  }

  async verifyTicketCalling(queueNum: string) {
    console.log(`[Admin] Verifying ticket #${queueNum} is being called`);
    const ticketElement = this.page.locator('[data-status="calling"]').getByText(`#${queueNum}`);
    await expect(ticketElement).toBeVisible({ timeout: 10000 });
    console.log(`[Admin] Ticket #${queueNum} is calling ✓`);
  }

  async confirmArrival() {
    console.log('[Admin] Confirming arrival...');
    const confirmButton = this.page.getByRole('button', { name: /confirm arrival|arrived/i });
    await confirmButton.click();
    await this.page.waitForTimeout(1000);
    console.log('[Admin] Arrival confirmed ✓');
  }
}