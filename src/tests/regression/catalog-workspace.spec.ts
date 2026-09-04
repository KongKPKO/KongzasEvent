import { expect, test, type Page } from '@playwright/test';
import { ensureOwnerArtistFixture } from '../helpers/adminFixture';

const EMAIL = 'catalog-workspace-e2e@nireq.local';
const PASSWORD = 'LocalOnlyCatalogWorkspace123!';
const SLUG = 'catalog-workspace-e2e';

let fixture: Awaited<ReturnType<typeof ensureOwnerArtistFixture>>;
let productId = '';

async function login(page: Page) {
  await page.goto('/manage-login');
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: /Login to Dashboard|Sign in|Login/i }).click();
  await expect(page).not.toHaveURL(/manage-login/, { timeout: 20_000 });
}

test.describe('catalog workspace', () => {
  test.beforeAll(async () => {
    fixture = await ensureOwnerArtistFixture({
      email: EMAIL,
      password: PASSWORD,
      slug: SLUG,
      displayName: 'Catalog Workspace E2E',
    });
    await fixture.service.from('products').delete().eq('artist_id', fixture.userId);

    const product = await fixture.service.from('products').insert({
      artist_id: fixture.userId,
      name: 'Cheki HSR Yaoguang Normal',
      category: 'Cheki',
      variant_name: 'Normal',
      tags: ['HSR'],
      price: 350,
      currency: 'THB',
      stock_total: 12,
      stock_reserved: 0,
      stock_sold: 0,
      is_unlimited: false,
      status: 'enable',
    }).select('id').single();
    if (product.error) throw product.error;
    productId = product.data.id;

    const manualSkuProduct = await fixture.service.from('products').insert({
      artist_id: fixture.userId,
      name: 'Manual SKU fixture',
      category: 'Other',
      sku: 'CAT-DUP-001',
      price: 100,
      currency: 'THB',
      stock_total: 1,
      stock_reserved: 0,
      stock_sold: 0,
      is_unlimited: false,
      status: 'enable',
    });
    if (manualSkuProduct.error) throw manualSkuProduct.error;
  });

  test.afterAll(async () => {
    if (fixture) await fixture.service.from('products').delete().eq('artist_id', fixture.userId);
  });

  test('uses product cards by default and preserves filters when switching to table', async ({ page }) => {
    await login(page);
    await page.goto('/manage-products');

    await expect(page.getByRole('heading', { name: /Product catalog|คลังสินค้า/ })).toBeVisible();
    const cards = page.getByRole('button', { name: /Product cards|การ์ดสินค้า/ });
    const table = page.getByRole('button', { name: /^Table$|^ตาราง$/ });
    await expect(cards).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(`catalog-card-${productId}`)).toBeVisible();

    await page.getByRole('button', { name: /^Import CSV$|^นำเข้า CSV$/ }).click();
    await expect(page.getByRole('heading', { name: 'Import CSV' })).toBeVisible();
    await page.getByRole('button', { name: /^Back to catalog$|^กลับไปคลังสินค้า$/ }).click();
    await expect(page.getByRole('heading', { name: /Product catalog|คลังสินค้า/ })).toBeVisible();
    await expect(cards).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(`catalog-card-${productId}`)).toBeVisible();

    const search = page.getByPlaceholder(/Search products|ค้นหาสินค้า/);
    await search.fill('Yaoguang');
    await table.click();

    await expect(search).toHaveValue('Yaoguang');
    await expect(table).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(`catalog-row-${productId}`)).toContainText('Cheki HSR Yaoguang Normal');
  });

  test('keeps a duplicate manual SKU in the form and shows a friendly error', async ({ page }) => {
    await login(page);
    await page.goto('/manage-products');
    await page.getByRole('button', { name: /^Add product$|^เพิ่มสินค้า$/ }).click();
    await page.getByLabel(/Product name|ชื่อสินค้า/).fill('Different product name');
    await page.getByLabel(/Price & currency|ราคาและสกุลเงิน/).fill('100');
    await page.getByText(/Advanced details|ข้อมูลเพิ่มเติม/).click();
    await page.locator('#add-product-sku').fill('cat-dup-001');
    await page.getByRole('button', { name: /^Add product$|^เพิ่มสินค้า$/ }).last().click();

    await expect(page.getByText(/SKU already exists|SKU นี้มีสินค้าใช้อยู่แล้ว/)).toBeVisible();
    await expect(page.locator('#add-product-sku')).toHaveValue('CAT-DUP-001');
  });
});
