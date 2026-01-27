// AdminProductsPage.ts
import { Page } from '@playwright/test';

export class AdminProductsPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/manage-products');
    await this.page.waitForLoadState('networkidle');
  }

  async addProduct(name: string, price: string) {
    console.log(`[Products] Adding: ${name} (${price} THB)`);
    
    try {
      // Wait for page to load
      await this.page.waitForLoadState('networkidle');
      await this.page.waitForTimeout(1000);
      
      // Check if product already exists
      const exists = await this.page.getByText(name).first().isVisible().catch(() => false);
      if (exists) {
        console.log(`[Products] "${name}" already exists ✓`);
        return;
      }
      
      // Find the "Add New Item" form section
      const formSection = this.page.locator('form').filter({ 
        has: this.page.getByText('Add New Item') 
      }).or(this.page.locator('form').first());
      
      // Fill Product Name (by placeholder)
      const nameInput = formSection.getByPlaceholder(/iced latte|product name/i);
      await nameInput.waitFor({ timeout: 10000 });
      await nameInput.fill(name);
      console.log('[Products] Filled product name');
      
      // Fill Price (by placeholder or type)
      const priceInput = formSection.locator('input[type="number"]').first();
      await priceInput.fill(price);
      console.log('[Products] Filled price');
      
      // Upload Image (required field)
      const fileInput = formSection.locator('input[type="file"]').first();
      
      // Create a dummy image file for testing
      const buffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
      
      await fileInput.setInputFiles({
        name: 'test-product.png',
        mimeType: 'image/png',
        buffer: buffer,
      });
      console.log('[Products] Uploaded test image');
      
      // Optional: Fill category and description if needed
      // (Skip for now to match minimal test requirements)
      
      // Submit form - Find "Add Product" button
      const submitButton = formSection.getByRole('button', { name: /add product/i });
      
      // Wait for API response
      const [response] = await Promise.all([
        this.page.waitForResponse(
          resp => resp.url().includes('products') && resp.request().method() === 'POST',
          { timeout: 10000 }
        ).catch(() => null),
        submitButton.click()
      ]);
      
      if (response) {
        console.log(`[Products] API Response: ${response.status()}`);
      }
      
      // Wait for UI update
      await this.page.waitForLoadState('networkidle');
      await this.page.waitForTimeout(2000);
      
      // Verify product appears in the list
      const productCard = this.page.locator('.grid').getByText(name).first();
      await productCard.waitFor({ state: 'visible', timeout: 10000 });
      console.log(`[Products] "${name}" added successfully ✓`);
      
    } catch (error) {
      // Debug on error
      await this.page.screenshot({ 
        path: `debug-add-product-error-${Date.now()}.png`,
        fullPage: true 
      });
      
      // Log form state
      const formHtml = await this.page.locator('form').first().innerHTML();
      console.error('[Products] Form HTML:', formHtml.substring(0, 500));
      
      throw error;
    }
  }
}