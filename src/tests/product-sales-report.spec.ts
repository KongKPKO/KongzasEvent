import { expect, test } from '@playwright/test';
import { buildProductSalesCsv, normalizeProductSalesReport, type ProductSalesRow } from '../lib/productSalesReport';

const rows: ProductSalesRow[] = [{
  family_id: 'family-a',
  name: 'พวงกุญแจ, "คู่"',
  category: 'ของสะสม',
  image_url: null,
  currency: 'THB',
  quantity: 3,
  gross: 500,
  discount: 50,
  refund: null,
  net: 450,
  has_variants: true,
  variants: [
    { product_id: 'a', name: 'พวงกุญแจ — แดง', variant_name: 'แดง', sku: 'KEY-RED', quantity: 2, gross: 300, discount: 30, refund: null, net: 270 },
    { product_id: 'b', name: 'พวงกุญแจ — น้ำเงิน', variant_name: 'น้ำเงิน', sku: 'KEY-BLUE', quantity: 1, gross: 200, discount: 20, refund: null, net: 180 },
  ],
}];

test('product sales CSV uses UTF-8 BOM, Thai headings and one row per variant', () => {
  const csv = buildProductSalesCsv(rows, 'th');
  expect(csv.charCodeAt(0)).toBe(0xFEFF);
  const lines = csv.split('\r\n');
  expect(lines).toHaveLength(3);
  expect(lines[0]).toBe('\uFEFF"สินค้า","ตัวเลือก","รหัสสินค้า","หมวดหมู่","จำนวนขาย","ยอดขายก่อนส่วนลด","สกุลเงิน"');
  expect(lines[1]).toBe('"พวงกุญแจ, ""คู่""","แดง","KEY-RED","ของสะสม","2","300","THB"');
  expect(csv).not.toContain('ส่วนลดที่จัดสรร');
  expect(csv).not.toContain('ยอดคืนเงิน');
  expect(csv).not.toContain('ยอดขายสุทธิ');
});

test('report normalization converts database numerics without inventing refunds', () => {
  const report = normalizeProductSalesReport({
    rows: [{ ...rows[0], quantity: '3', gross: '500.00', discount: '50.00', net: '450.00', refund: '500', variants: [{ ...rows[0].variants[0], quantity: '2', gross: '300.00', discount: '30.00', net: '270.00', refund: '300' }] }],
    total_count: '1', page: '1', page_size: '20', categories: ['ของสะสม'], timezone: 'Asia/Bangkok', refund_allocation_available: false,
  });
  expect(report.rows[0]).toMatchObject({ quantity: 3, gross: 500, discount: 50, refund: null, net: 450 });
  expect(report.rows[0].variants[0]).toMatchObject({ quantity: 2, refund: null });
  expect(report.categories).toEqual(['ของสะสม']);
});


test('product CSV quotes spreadsheet formula-like merchant text safely', () => {
  const csv = buildProductSalesCsv([{ ...rows[0], name: '=1+1' }], 'en');
  expect(csv).toContain('"\'=1+1"');
});
