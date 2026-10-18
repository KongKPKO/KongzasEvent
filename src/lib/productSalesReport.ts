import { supabase } from '../supabaseClient';
import { getProductImages } from '../utils/productPresentation';

export type ProductSalesSort = 'name' | 'quantity' | 'gross' | 'discount' | 'net';
export type ProductSalesDirection = 'asc' | 'desc';

export interface ProductSalesVariant {
  product_id: string;
  images?: string[];
  name: string;
  variant_name: string;
  sku: string;
  quantity: number;
  gross: number;
  discount: number;
  refund: null;
  net: number;
}

export interface ProductSalesRow {
  family_id: string;
  name: string;
  category: string;
  image_url: string | null;
  images?: string[];
  currency: string;
  quantity: number;
  gross: number;
  discount: number;
  refund: null;
  net: number;
  has_variants: boolean;
  variants: ProductSalesVariant[];
}

export interface ProductSalesReportResult {
  rows: ProductSalesRow[];
  total_count: number;
  page: number;
  page_size: number;
  categories: string[];
  timezone: string;
  refund_allocation_available: false;
}

const numberValue = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function normalizeProductSalesReport(value: unknown): ProductSalesReportResult {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rows = Array.isArray(source.rows) ? source.rows : [];
  return {
    rows: rows.map((entry) => {
      const row = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
      const variants = Array.isArray(row.variants) ? row.variants : [];
      return {
        family_id: String(row.family_id || ''),
        name: String(row.name || ''),
        category: String(row.category || 'Other'),
        image_url: row.image_url ? String(row.image_url) : null,
        currency: String(row.currency || 'THB'),
        quantity: numberValue(row.quantity),
        gross: numberValue(row.gross),
        discount: numberValue(row.discount),
        refund: null,
        net: numberValue(row.net),
        has_variants: Boolean(row.has_variants),
        variants: variants.map((entryValue) => {
          const variant = entryValue && typeof entryValue === 'object' ? entryValue as Record<string, unknown> : {};
          return {
            product_id: String(variant.product_id || ''),
            name: String(variant.name || ''),
            variant_name: String(variant.variant_name || ''),
            sku: String(variant.sku || ''),
            quantity: numberValue(variant.quantity),
            gross: numberValue(variant.gross),
            discount: numberValue(variant.discount),
            refund: null,
            net: numberValue(variant.net),
          };
        }),
      };
    }),
    total_count: numberValue(source.total_count),
    page: Math.max(1, numberValue(source.page) || 1),
    page_size: Math.max(1, numberValue(source.page_size) || 20),
    categories: Array.isArray(source.categories) ? source.categories.map(String) : [],
    timezone: String(source.timezone || 'Asia/Bangkok'),
    refund_allocation_available: false,
  };
}

// Fetch only media for this report page; CSV export needs no catalog images.
export async function loadProductSalesImages(rows: ProductSalesRow[]): Promise<ProductSalesRow[]> {
  const ids = [...new Set(rows.flatMap(row => row.variants.map(variant => variant.product_id)).filter(Boolean))];
  const media = new Map<string, string[]>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await supabase.from('products')
      .select('id, name, price, image_url, product_kind, gallery_images, variant_gallery_images')
      .in('id', ids.slice(offset, offset + 100));
    if (error) throw error;
    for (const product of data || []) media.set(product.id, getProductImages(product));
  }
  return rows.map(row => {
    const variants = row.variants.map(variant => ({ ...variant, images: media.get(variant.product_id) || [] }));
    const images = [...new Set(variants.flatMap(variant => variant.images))];
    return { ...row, variants, images: images.length || variants.some(variant => media.has(variant.product_id)) ? images : row.image_url ? [row.image_url] : [] };
  });
}

const csvCell = (value: string | number) => {
  const text = typeof value === 'string' && /^[=+@\-\t\r]/.test(value) ? "'" + value : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

export function buildProductSalesCsv(rows: ProductSalesRow[], language: 'th' | 'en'): string {
  const th = language === 'th';
  const headers = th
    ? ['สินค้า', 'ตัวเลือก', 'SKU', 'หมวดหมู่', 'จำนวนขาย', 'ยอดขายรวม', 'ส่วนลดที่จัดสรร', 'ยอดคืนเงิน', 'ยอดขายสุทธิ', 'สกุลเงิน']
    : ['Product', 'Variant', 'SKU', 'Category', 'Units sold', 'Gross sales', 'Allocated discount', 'Refund', 'Net sales', 'Currency'];
  const body = rows.flatMap((row) => row.variants.map((variant) => [
    row.name,
    row.has_variants && variant.variant_name !== 'Default' ? variant.variant_name : '',
    variant.sku,
    row.category,
    variant.quantity,
    variant.gross,
    variant.discount,
    '',
    variant.net,
    row.currency,
  ]));
  return buildUtf8Csv([headers, ...body]);
}

export function buildUtf8Csv(rows: Array<Array<string | number>>): string {
  return `\uFEFF${rows.map(line => line.map(csvCell).join(',')).join('\r\n')}`;
}

export function downloadUtf8Csv(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
