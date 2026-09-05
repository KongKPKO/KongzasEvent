import { expect, test, type Page } from '@playwright/test';
import { ensureOwnerArtistFixture } from '../helpers/adminFixture';

const EMAIL = 'catalog-workspace-e2e@nireq.local';
const PASSWORD = 'LocalOnlyCatalogWorkspace123!';
const SLUG = 'catalog-workspace-e2e';
const LONG_PRODUCT_NAME = 'Cheki HSR Yaoguang Normal Convention Exclusive Signed Edition';

let fixture: Awaited<ReturnType<typeof ensureOwnerArtistFixture>>;
let productId = '';
let reservedProductId = '';
let soldProductId = '';
let unlimitedProductId = '';
let inactiveProductId = '';

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
      name: LONG_PRODUCT_NAME,
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

    const reservedProduct = await fixture.service.from('products').insert({
      artist_id: fixture.userId,
      name: 'Reserved stock product',
      category: 'Other',
      price: 120,
      currency: 'THB',
      stock_total: 7,
      stock_reserved: 2,
      stock_sold: 0,
      is_unlimited: false,
      status: 'enable',
    }).select('id').single();
    if (reservedProduct.error) throw reservedProduct.error;
    reservedProductId = reservedProduct.data.id;

    const soldProduct = await fixture.service.from('products').insert({
      artist_id: fixture.userId,
      name: 'Sold stock product',
      category: 'Other',
      price: 130,
      currency: 'THB',
      stock_total: 7,
      stock_reserved: 0,
      stock_sold: 2,
      is_unlimited: false,
      status: 'enable',
    }).select('id').single();
    if (soldProduct.error) throw soldProduct.error;
    soldProductId = soldProduct.data.id;

    const unlimitedProduct = await fixture.service.from('products').insert({
      artist_id: fixture.userId,
      name: 'Unlimited stock product',
      category: 'Other',
      price: 150,
      currency: 'THB',
      stock_total: null,
      stock_reserved: 0,
      stock_sold: 0,
      is_unlimited: true,
      status: 'enable',
    }).select('id').single();
    if (unlimitedProduct.error) throw unlimitedProduct.error;
    unlimitedProductId = unlimitedProduct.data.id;

    const inactiveProduct = await fixture.service.from('products').insert({
      artist_id: fixture.userId,
      name: 'Inactive image-less product',
      category: 'Other',
      price: 160,
      currency: 'THB',
      stock_total: 4,
      stock_reserved: 0,
      stock_sold: 0,
      is_unlimited: false,
      status: 'disable',
    }).select('id').single();
    if (inactiveProduct.error) throw inactiveProduct.error;
    inactiveProductId = inactiveProduct.data.id;

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
    const productCard = page.getByTestId(`catalog-card-${productId}`);
    await expect(productCard).toBeVisible();
    for (const action of await productCard.getByRole('button').all()) {
      const actionBox = await action.boundingBox();
      expect(actionBox).not.toBeNull();
      expect(actionBox?.height || 0).toBeGreaterThanOrEqual(44);
    }

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
    await expect(page.getByTestId(`catalog-row-${productId}`)).toContainText(LONG_PRODUCT_NAME);
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

  test('shows explicit focused-table stock columns and complete product data', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium');
    await login(page);
    await page.goto('/manage-products');
    await page.getByRole('button', { name: /^Table$|^ตาราง$/ }).click();

    const row = page.getByTestId(`catalog-row-${productId}`);
    const fullName = row.getByText(LONG_PRODUCT_NAME, { exact: true });
    await expect(fullName).toBeVisible();
    const nameIsUnclipped = await fullName.evaluate((element) => element.scrollHeight <= element.clientHeight);
    expect(nameIsUnclipped).toBe(true);
    await expect(row).toContainText(/CHE-YAOG-N-[0-9]{3,}/);
    await expect(row).toContainText('Cheki');
    await expect(row).toContainText('12');
    await expect(page.getByRole('columnheader', { name: /Total stock|สต็อกทั้งหมด/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Ready to allocate|พร้อมจัดสรร/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /In sales channels|อยู่ในช่องทางขาย/ })).toBeVisible();
    await expect(row.getByRole('button', { name: /Choose sales channel|เลือกช่องทางขาย/ })).toBeVisible();
    await expect(row.getByRole('button', { name: /Adjust stock|ปรับสต็อก/ })).toBeVisible();

    const tableBox = await page.getByRole('table').boundingBox();
    expect(tableBox).not.toBeNull();
    for (const button of await row.getByRole('button').all()) {
      const buttonBox = await button.boundingBox();
      expect(buttonBox).not.toBeNull();
      expect((buttonBox?.x || 0) + (buttonBox?.width || 0)).toBeLessThanOrEqual((tableBox?.x || 0) + (tableBox?.width || 0) + 1);
    }

    await expect(page.getByTestId(`catalog-row-${reservedProductId}`)).toContainText(/Reserved 2|ถูกจอง 2/);
    const soldRow = page.getByTestId(`catalog-row-${soldProductId}`);
    const soldCells = soldRow.getByRole('cell');
    await expect(soldCells.nth(3)).toHaveText('7');
    await expect(soldCells.nth(4)).toHaveText('5');
    await expect(soldCells.nth(5)).toHaveText('0');
    await expect(soldRow).not.toContainText(/Reserved|ถูกจอง/);
    await expect(page.getByTestId(`catalog-row-${unlimitedProductId}`)).toContainText(/Unlimited|ไม่จำกัด/);
    await testInfo.attach('focused-catalog-table', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png',
    });
  });

  test('chooses increase or decrease inside the existing stock dialog', async ({ page }) => {
    await login(page);
    await page.goto('/manage-products');
    await page.getByRole('button', { name: /^Table$|^ตาราง$/ }).click();
    const surface = (page.viewportSize()?.width || 1280) < 768
      ? page.getByTestId(`catalog-list-${productId}`)
      : page.getByTestId(`catalog-row-${productId}`);

    const chooseSalesChannel = surface.getByRole('button', { name: /Choose sales channel|เลือกช่องทางขาย/ });
    const adjustStock = surface.getByRole('button', { name: /Adjust stock|ปรับสต็อก/ });
    for (const action of [chooseSalesChannel, adjustStock]) {
      const actionBox = await action.boundingBox();
      expect(actionBox).not.toBeNull();
      expect(actionBox?.height || 0).toBeGreaterThanOrEqual(44);
    }

    await adjustStock.click();
    const dialog = page.getByRole('dialog', { name: /Adjust stock|ปรับสต็อก/ });
    await expect(dialog).toBeVisible();
    const increase = dialog.getByRole('button', { name: /Increase|เพิ่ม/ });
    const decrease = dialog.getByRole('button', { name: /Decrease|ลด/ });
    await expect(increase).toHaveAttribute('aria-pressed', 'true');
    for (const chooser of [increase, decrease]) {
      const chooserBox = await chooser.boundingBox();
      expect(chooserBox).not.toBeNull();
      expect(chooserBox?.height || 0).toBeGreaterThanOrEqual(44);
    }
    await decrease.click();
    await expect(dialog.getByText(/Reason|เหตุผล/)).toBeVisible();
  });

  test('secondary actions use one keyboard-safe menu', async ({ page }) => {
    await login(page);
    await page.goto('/manage-products');
    await page.getByRole('button', { name: /^Table$|^ตาราง$/ }).click();
    const surface = (page.viewportSize()?.width || 1280) < 768
      ? page.getByTestId(`catalog-list-${productId}`)
      : page.getByTestId(`catalog-row-${productId}`);
    const trigger = surface.getByRole('button', { name: /More actions|การทำงานเพิ่มเติม/ });

    await trigger.focus();
    await trigger.press('Enter');
    const menu = page.getByRole('menu');
    const addOption = menu.getByRole('menuitem', { name: /Add product option|เพิ่มตัวเลือกสินค้า/ });
    const edit = menu.getByRole('menuitem', { name: /Edit product|แก้ไขสินค้า/ });
    const remove = menu.getByRole('menuitem', { name: /Delete product|ลบสินค้า/ });
    await expect(addOption).toBeFocused();
    for (const item of [addOption, edit, remove]) {
      const itemBox = await item.boundingBox();
      expect(itemBox).not.toBeNull();
      expect(itemBox?.height || 0).toBeGreaterThanOrEqual(44);
    }
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(triggerBox?.width || 0).toBeGreaterThanOrEqual(44);
    expect(triggerBox?.height || 0).toBeGreaterThanOrEqual(44);

    await page.keyboard.press('ArrowDown');
    await expect(edit).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(remove).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(addOption).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(remove).toBeFocused();
    await page.keyboard.press('Home');
    await expect(addOption).toBeFocused();
    await page.keyboard.press('End');
    await expect(remove).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.getByRole('heading', { name: /Product catalog|คลังสินค้า/ }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('translates the focused Catalog controls and stock dialog into Thai', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium');
    await login(page);
    await page.goto('/manage-products');
    await page.getByRole('button', { name: 'Switch language' }).click();

    const inactiveCard = page.getByTestId(`catalog-card-${inactiveProductId}`);
    await expect(inactiveCard.getByText('ไม่มีรูป', { exact: true })).toBeVisible();
    await expect(inactiveCard.getByText('ปิดใช้งาน', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'ตาราง', exact: true }).click();
    const row = page.getByTestId(`catalog-row-${productId}`);
    await row.getByRole('button', { name: 'ปรับสต็อก' }).click();
    const dialog = page.getByRole('dialog', { name: 'ปรับสต็อก' });
    await expect(dialog.getByText('จำนวน', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'ลด', exact: true }).click();
    await expect(dialog.getByText('เหตุผล', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('option', { name: 'เลือกเหตุผล' })).toBeAttached();
    await expect(dialog).toContainText('สต็อกทั้งหมด: 12');
    await expect(dialog).toContainText('อยู่ในช่องทางขาย: 0');
    await expect(dialog).toContainText('พร้อมจัดสรร: 12');
    await expect(dialog).toContainText('หลังลด: 12');
    await expect(dialog.getByRole('button', { name: 'ยกเลิก' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'ลดสต็อก' })).toBeVisible();
  });
});
