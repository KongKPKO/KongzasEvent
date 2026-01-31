// CustomerPage.ts
import { Page, expect } from '@playwright/test';

export class CustomerPage {
  constructor(private page: Page) {}

  async goto(artistSlug: string) {
    console.log(`[Customer] Navigating to /${artistSlug}/queue`);
    
    try {
      // Navigate with less strict load state
      await this.page.goto(`/${artistSlug}/queue`, {
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
      console.error(`[Customer] Failed to load /${artistSlug}/queue:`, error);
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
      
      // Check for common blocking states
      if (await this.page.getByText('Loading...').isVisible()) {
          throw new Error('Get Ticket failed: Page is stuck Loading...');
      }
      if (await this.page.getByText(/Booth Closed|Queue is currently closed/i).isVisible()) {
          const msg = await this.page.getByText(/Booth Closed|Queue is currently closed/i).innerText();
          throw new Error(`Get Ticket failed: Queue is invalid (${msg})`);
      }

      // Dump content for debug
      const bodyText = await this.page.locator('body').textContent();
      console.log('[Customer] Page content:', bodyText?.substring(0, 500));
      await this.page.screenshot({ path: 'debug-customer-no-ticket-btn.png' });
      
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
     
     const statusPatterns: Record<string, RegExp> = {
       'Waiting': /waiting|you are in the queue/i,
       // ✅ เพิ่ม 'now serving' เข้าไปด้วย เผื่อ UI ข้ามสถานะ
       "It's Your Turn": /it's your turn|calling|proceed to.*booth|please proceed|now serving/i, 
       "Being Served": /being served|active/i,
       "Completed": /completed|thank you|order.*complete/i,
       "Cancelled": /cancelled|missed/i,
       "Expired": /expired/i
     };
     
     const pattern = statusPatterns[status] || new RegExp(status, 'i');
     // ใช้ .first() กันเหนียว เผื่อเจอหลายตัว
     const locator = this.page.getByText(pattern).first();
     
     try {
       // 1. ลองรอดูก่อน 5 วินาที (เผื่อ Realtime มาทัน)
       await expect(locator).toBeVisible({ timeout: 5000 });
       console.log(`[Customer] Status verified (Realtime): "${status}" ✓`);

     } catch (error) {
       // 2. ถ้าไม่มาใน 5 วิ ให้กด Reload หน้า 1 ที (Force Update)
       console.log(`[Customer] Status "${status}" not found via Realtime. Reloading page...`);
       
       await this.page.reload();
       await this.page.waitForLoadState('domcontentloaded');
       
       // 3. รออีกรอบ (คราวนี้ต้องมาแน่ เพราะโหลดใหม่แล้ว)
       await expect(locator).toBeVisible({ timeout: 15000 });
       console.log(`[Customer] Status verified (After Reload): "${status}" ✓`);
     }
   }
}