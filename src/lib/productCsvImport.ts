import type { ProductFamilySaveInput } from '../components/products/ProductFamilyEditor';
import type { ProductKind } from '../types/productFamily';
import { CURRENCIES } from '../utils/currency';

export type ProductCsvIssue = { row: number; field: string; code: 'required' | 'number' | 'integer' | 'boolean' | 'choice' | 'json' | 'date' | 'shared' | 'duplicate' | 'limit' };
export type ProductCsvResult = { families: ProductFamilySaveInput[]; issues: ProductCsvIssue[] };
const kinds: ProductKind[] = ['single', 'photo', 'bundle', 'preorder', 'service'];
const cell = (row: Record<string, string>, ...keys: string[]) => keys.map((key) => String(row[key] ?? '').trim()).find(Boolean) || '';
const number = (value: string) => Number(value.replace(/,/g, ''));
const bool = (value: string): boolean | null => ['true', '1', 'yes', 'y'].includes(value.toLowerCase()) ? true : ['false', '0', 'no', 'n'].includes(value.toLowerCase()) ? false : null;

/** Validate the whole file before any write; product_key only groups rows in this file. */
export function parseProductCsv(rows: Record<string, string>[], artistId: string): ProductCsvResult {
  const issues: ProductCsvIssue[] = [];
  const grouped = new Map<string, { family: ProductFamilySaveInput; signature: string; rows: number[]; legacyPrices: number[]; explicitBase: boolean; explicitOverrides: boolean[] }>();
  const skus = new Set<string>();
  const issue = (row: number, field: string, code: ProductCsvIssue['code']) => issues.push({ row, field, code });
  if (rows.length > 2000) return { families: [], issues: [{ row: 0, field: 'rows', code: 'limit' }] };
  rows.forEach((row, index) => {
    const line = index + 2;
    const before = issues.length;
    const legacyGroup = cell(row, 'product_line', 'variant_group_name', 'variant_group', 'folder', 'folder_name');
    const productKey = cell(row, 'product_key');
    const rowName = cell(row, 'name', 'product_name', 'item_name', 'product', 'item');
    const name = productKey ? rowName : legacyGroup || rowName;
    const groupKey = productKey ? `key:${productKey.toLowerCase()}` : legacyGroup ? `legacy:${legacyGroup.toLowerCase()}` : `row:${index}`;
    const baseRaw = cell(row, 'base_price');
    const priceRaw = cell(row, 'price', 'unit_price');
    const base = number(baseRaw || priceRaw);
    if (!name) issue(line, 'name', 'required');
    if (!baseRaw && !priceRaw) issue(line, 'base_price / price', 'required');
    else if (!Number.isFinite(base) || base < 0) issue(line, 'base_price / price', 'number');
    const productKind = cell(row, 'product_kind') || 'single';
    if (!kinds.includes(productKind as ProductKind)) issue(line, 'product_kind', 'choice');
    const currency = (cell(row, 'currency') || 'THB').toUpperCase();
    if (!(currency in CURRENCIES)) issue(line, 'currency', 'choice');
    const status = cell(row, 'status').toLowerCase() || 'enable';
    if (!['enable', 'disable', 'soldout'].includes(status)) issue(line, 'status', 'choice');
    const stockRaw = cell(row, 'stock', 'stock_total', 'stocktotal', 'qty', 'quantity');
    const unlimitedRaw = cell(row, 'is_unlimited', 'unlimited', 'isunlimited');
    const unlimited = unlimitedRaw ? bool(unlimitedRaw) : !stockRaw;
    if (unlimited === null) issue(line, 'is_unlimited', 'boolean');
    const stock = stockRaw ? number(stockRaw) : null;
    if (stock !== null && (!Number.isSafeInteger(stock) || stock < 0 || stock > 2147483647)) issue(line, 'stock', 'integer');
    if (unlimited === false && stock === null) issue(line, 'stock', 'required');
    const sortRaw = cell(row, 'variant_sort_order', 'variant_sort', 'sort_order');
    const sort = sortRaw ? number(sortRaw) : index;
    if (!Number.isSafeInteger(sort) || sort < 0 || sort > 2147483647) issue(line, 'variant_sort_order', 'integer');
    const overrideRaw = cell(row, 'price_override');
    const override = overrideRaw ? number(overrideRaw) : priceRaw ? number(priceRaw) : null;
    if (override !== null && (!Number.isFinite(override) || override < 0)) issue(line, 'price_override / price', 'number');
    const sku = cell(row, 'sku').toUpperCase();
    if (sku && skus.has(sku)) issue(line, 'sku', 'duplicate');
    if (sku) skus.add(sku);
    const parseArray = (field: string): unknown[] => {
      const raw = cell(row, field);
      if (!raw) return [];
      try { const value: unknown = JSON.parse(raw); if (Array.isArray(value)) return value; } catch { /* Report malformed CSV cell below. */ }
      issue(line, field, 'json'); return [];
    };
    const gallery = parseArray('gallery_images');
    if (gallery.length > 50 || gallery.some((value) => typeof value !== 'string' || !value.trim())) issue(line, 'gallery_images', 'json');
    const bundles = parseArray('bundle_items');
    if (bundles.length > 100 || bundles.some((value) => !value || typeof value !== 'object' || !('name' in value) || typeof value.name !== 'string' || !value.name.trim() || !('quantity' in value) || !Number.isSafeInteger(value.quantity) || Number(value.quantity) <= 0)) issue(line, 'bundle_items', 'json');
    const close = cell(row, 'preorder_closes_at');
    if (close && (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(close) || !Number.isFinite(Date.parse(close)))) issue(line, 'preorder_closes_at', 'date');
    const durationRaw = cell(row, 'service_duration_minutes');
    const slotsRaw = cell(row, 'service_slots');
    const duration = durationRaw ? number(durationRaw) : null;
    const slots = slotsRaw ? number(slotsRaw) : null;
    if (duration !== null && (!Number.isSafeInteger(duration) || duration < 1 || duration > 2147483647)) issue(line, 'service_duration_minutes', 'integer');
    if (slots !== null && (!Number.isSafeInteger(slots) || slots < 0 || slots > 2147483647)) issue(line, 'service_slots', 'integer');
    if (productKind !== 'photo' && gallery.length) issue(line, 'gallery_images / product_kind', 'choice');
    if (productKind !== 'bundle' && bundles.length) issue(line, 'bundle_items / product_kind', 'choice');
    if (productKind !== 'preorder' && (close || cell(row, 'preorder_eta'))) issue(line, 'preorder_closes_at / product_kind', 'choice');
    if (productKind !== 'service' && (durationRaw || slotsRaw || cell(row, 'service_kind'))) issue(line, 'service_kind / product_kind', 'choice');
    if (issues.length !== before) return;
    const parent: ProductFamilySaveInput['parent'] = {
      artist_id: artistId, name, base_price: base, currency,
      category: cell(row, 'category', 'product_category', 'type') || 'Other',
      tags: Array.from(new Set(cell(row, 'tags', 'tag', 'product_tag', 'product_tags').split(/[|,;]/).map((tag) => tag.trim()).filter(Boolean))).sort(),
      description: cell(row, 'description', 'details', 'note'), image_url: cell(row, 'cover_image') || (!productKey && !legacyGroup ? cell(row, 'image_url') : '') || null,
      product_kind: productKind as ProductKind, gallery_images: gallery as string[], bundle_items: bundles as Array<{ name: string; quantity: number }>,
      preorder_closes_at: close ? new Date(close).toISOString() : null, preorder_eta: cell(row, 'preorder_eta') || null,
      service_kind: cell(row, 'service_kind') || null, service_duration_minutes: duration, service_slots: slots,
    };
    // Legacy child prices can differ; explicit shared base_price must agree.
    const signature = JSON.stringify({ ...parent, base_price: baseRaw ? base : null });
    let group = grouped.get(groupKey);
    if (group && group.signature !== signature) { issue(line, 'shared product fields', 'shared'); return; }
    if (!group) { group = { family: { parent, variants: [] }, signature, rows: [], legacyPrices: [], explicitBase: Boolean(baseRaw), explicitOverrides: [] }; grouped.set(groupKey, group); }
    const variantName = cell(row, 'variant_name', 'variant', 'option', 'option_name') || 'Default';
    if (group.family.variants.some((variant) => variant.name.toLowerCase() === variantName.toLowerCase())) issue(line, 'variant_name', 'duplicate');
    group.family.variants.push({ name: variantName, sku: sku || null, price_override: override, stock_total: unlimited ? null : stock, is_unlimited: Boolean(unlimited), image_url: cell(row, 'image_url') || null, status: status as 'enable' | 'disable' | 'soldout', variant_sort_order: sort });
    group.explicitOverrides.push(Boolean(overrideRaw));
    group.rows.push(line);
    if (priceRaw) group.legacyPrices.push(number(priceRaw));
  });
  if (grouped.size > 200) issue(0, 'products', 'limit');
  const familyKeys = new Set<string>();
  for (const group of grouped.values()) {
    const key = `${group.family.parent.name.toLowerCase()}|${group.family.parent.category?.toLowerCase()}|${group.family.parent.currency}`;
    if (familyKeys.has(key)) issue(group.rows[0], 'product_key / name', 'duplicate');
    familyKeys.add(key);
    if (group.family.variants.length > 200) issue(group.rows[0], 'variants', 'limit');
    if (!group.explicitBase && group.legacyPrices.length) group.family.parent.base_price = Math.min(...group.legacyPrices);
    group.family.variants.forEach((variant, index) => {
      if (!group.explicitOverrides[index] && variant.price_override === group.family.parent.base_price) variant.price_override = null;
    });
    group.family.variants.sort((a, b) => a.variant_sort_order - b.variant_sort_order);
  }
  return { families: issues.length ? [] : Array.from(grouped.values()).map((group) => group.family), issues };
}

export function formatProductCsvIssue(issue: ProductCsvIssue, language: 'en' | 'th'): string {
  const reasons = {
    en: { required: 'Required value is missing', number: 'Use a number greater than or equal to zero', integer: 'Use a valid whole number', boolean: 'Use true/false, 1/0 or yes/no', choice: 'Unsupported value or product type', json: 'Use the documented JSON array format', date: 'Use an ISO date/time including timezone', shared: 'Shared fields disagree within this product', duplicate: 'Duplicate value within this file', limit: 'File exceeds the import limit (200 products, 200 variants/product, 2,000 rows)' },
    th: { required: 'ขาดข้อมูลที่จำเป็น', number: 'ใช้ตัวเลขตั้งแต่ศูนย์ขึ้นไป', integer: 'ใช้จำนวนเต็มที่ถูกต้อง', boolean: 'ใช้ true/false, 1/0 หรือ yes/no', choice: 'ค่าหรือประเภทสินค้าไม่รองรับ', json: 'ใช้ JSON array ตามรูปแบบในไฟล์ตัวอย่าง', date: 'ใช้วันเวลา ISO พร้อมเขตเวลา', shared: 'ข้อมูลหลักของสินค้าเดียวกันไม่ตรงกัน', duplicate: 'มีค่าซ้ำในไฟล์นี้', limit: 'เกินขีดจำกัด 200 สินค้า, 200 ตัวเลือกต่อสินค้า หรือ 2,000 แถว' },
  };
  return `${issue.row ? `${language === 'th' ? 'แถว' : 'Row'} ${issue.row}: ` : ''}${issue.field} — ${reasons[language][issue.code]}`;
}
