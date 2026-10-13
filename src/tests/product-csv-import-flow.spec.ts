import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Papa from 'papaparse';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';
import { LoginPage } from './e2e/pages/LoginPage';

const runId = randomUUID();
const suffix = runId.slice(0, 8);
const email = `product-csv-${runId}@example.test`;
const password = 'LocalOnlyProductCsvPassword123!';
const slug = `product-csv-${suffix}`;
const invalidValidFamily = `Atomic valid family ${suffix}`;
const invalidFamily = `Atomic invalid family ${suffix}`;
const legacyFamily = `Legacy variant family ${suffix}`;
const concurrentFamily = `Concurrent import family ${suffix}`;

let service: SupabaseClient;
let artistId = '';

const must = (result: { error: { message: string } | null }) => {
  if (result.error) throw new Error(result.error.message);
};

const csvFile = (name: string, contents: string) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(contents, 'utf8'),
});

test.beforeAll(async () => {
  const backend = new URL(resolveSupabaseTestEnv().url);
  if (!['127.0.0.1', 'localhost'].includes(backend.hostname)) {
    throw new Error('CSV import fixtures require disposable local Supabase');
  }
  const fixture = await ensureOwnerArtistFixture({
    email,
    password,
    slug,
    displayName: 'Product CSV import fixture',
  });
  service = fixture.service;
  artistId = fixture.userId;
});

test.afterAll(async () => {
  if (!service || !artistId) return;
  must(await service.from('products').delete().eq('artist_id', artistId));
  must(await service.from('product_parents').delete().eq('artist_id', artistId));
  must(await service.from('artists').delete().eq('id', artistId));
  must(await service.auth.admin.deleteUser(artistId));
});

test('localizes the family editor and imports current and legacy CSV atomically', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => window.localStorage.setItem('nireq-language', 'th'));
  const login = new LoginPage(page);
  await login.goto();
  await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบครีเอเตอร์ / ผู้จัดการ', exact: true })).toBeVisible();
  await expect(page.getByLabel('อีเมล', { exact: true })).toBeVisible();
  await expect(page.getByLabel('รหัสผ่าน', { exact: true })).toBeVisible();
  await login.login(email, password);
  await expect(page).toHaveURL(/manage-events/);

  await page.goto('/manage-products');
  await page.getByRole('button', { name: 'เพิ่มสินค้า', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'เพิ่มสินค้า', exact: true });
  await expect(editor).toBeVisible();
  await expect(editor.getByText('ข้อมูลหลักของสินค้า', { exact: true })).toBeVisible();
  await expect(editor.getByLabel('ชื่อสินค้า *', { exact: true })).toBeVisible();
  await expect(editor.getByLabel('ราคาหลัก *', { exact: true })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'เพิ่มสินค้า', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'เพิ่มสินค้า', exact: true }).click();
  await expect(editor.getByRole('alert')).toHaveText('กรอกชื่อสินค้าและราคาหลักที่ถูกต้อง');

  const productType = editor.getByLabel('ประเภทสินค้า', { exact: true });
  await productType.selectOption('photo');
  await expect(editor.getByRole('heading', { name: 'แกลเลอรีรูปภาพ', exact: true })).toBeVisible();
  await productType.selectOption('bundle');
  await expect(editor.getByRole('heading', { name: 'ของที่รวมในชุด', exact: true })).toBeVisible();
  await productType.selectOption('preorder');
  await expect(editor.getByRole('heading', { name: 'กำหนดเวลาพรีออเดอร์', exact: true })).toBeVisible();
  await productType.selectOption('service');
  await expect(editor.getByRole('heading', { name: 'ตั้งค่าบริการ', exact: true })).toBeVisible();
  await expect(editor.getByLabel('ระยะเวลา (นาที)', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'ปิดหน้าต่างสินค้า', exact: true }).click();
  await expect(editor).toBeHidden();

  await page.goto('/manage-products?tab=import');
  await expect(page.getByRole('heading', { name: 'นำเข้า CSV', exact: true })).toBeVisible();
  await expect(page.getByText(/หนึ่งแถวต่อรายการสต็อก.*product_key/)).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'ดาวน์โหลดไฟล์ตัวอย่าง', exact: true }).click(),
  ]);
  const samplePath = await download.path();
  expect(samplePath).not.toBeNull();
  const sampleCsv = await readFile(samplePath!, 'utf8');
  const sample = Papa.parse<Record<string, string>>(sampleCsv, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.replace(/^\uFEFF/, '').trim(),
  });
  expect(sample.errors).toEqual([]);
  expect(sample.data).toHaveLength(7);
  expect(sample.meta.fields).toEqual(expect.arrayContaining([
    'product_key',
    'base_price',
    'product_kind',
    'gallery_images',
    'bundle_items',
    'preorder_closes_at',
    'preorder_eta',
    'service_kind',
    'service_duration_minutes',
    'service_slots',
    'variant_name',
    'price_override',
    'variant_sort_order',
  ]));

  const upload = page.locator('input[type="file"][accept=".csv"]');
  const uploadCsv = async (file: ReturnType<typeof csvFile>) => {
    await expect(page.getByRole('button', { name: 'อัปโหลด CSV', exact: true })).toBeEnabled();
    await upload.setInputFiles(file);
  };
  await uploadCsv(csvFile(download.suggestedFilename(), sampleCsv));
  const result = page.getByTestId('csv-import-result');
  await expect(result).toHaveAttribute('role', 'status');
  await expect(result).toContainText('นำเข้า 6 สินค้า / 7 รายการสต็อก');

  const parents = await service
    .from('product_parents')
    .select('*')
    .eq('artist_id', artistId);
  must(parents);
  expect(parents.data).toHaveLength(6);
  const byName = new Map((parents.data || []).map((parent) => [parent.name, parent]));
  const traveler = byName.get('Traveler Acrylic Stand');
  const photo = byName.get('Cosplay Photo Set');
  const bundle = byName.get('Fan Meeting Bundle');
  const preorder = byName.get('December Acrylic Preorder');
  const serviceParent = byName.get('Cheki Session');
  expect(traveler).toBeTruthy();
  expect(photo).toMatchObject({ product_kind: 'photo' });
  expect(photo?.gallery_images).toHaveLength(5);
  expect(bundle).toMatchObject({
    product_kind: 'bundle',
    bundle_items: [
      { name: 'Postcard', quantity: 3 },
      { name: 'Badge', quantity: 1 },
    ],
  });
  expect(preorder).toMatchObject({
    product_kind: 'preorder',
    preorder_eta: 'Ships in December 2027',
  });
  expect(preorder?.preorder_closes_at).toContain('2027-12-01T16:59:00');
  expect(serviceParent).toMatchObject({
    product_kind: 'service',
    service_kind: 'cheki',
    service_duration_minutes: 10,
    service_slots: 12,
  });

  const importedVariants = await service
    .from('products')
    .select('id,parent_product_id,variant_name,sku,price,price_override,stock_total,is_unlimited')
    .eq('artist_id', artistId)
    .order('sku');
  must(importedVariants);
  expect(importedVariants.data).toHaveLength(7);
  const travelerVariants = (importedVariants.data || [])
    .filter((variant) => variant.parent_product_id === traveler?.id)
    .sort((left, right) => String(left.variant_name).localeCompare(String(right.variant_name)));
  expect(travelerVariants).toMatchObject([
    { variant_name: 'Aether', sku: 'TRV-AETHER-001', price: 120, price_override: null, stock_total: 10, is_unlimited: false },
    { variant_name: 'Lumine', sku: 'TRV-LUMINE-002', price: 130, price_override: 130, stock_total: 8, is_unlimited: false },
  ]);
  expect(importedVariants.data?.find((variant) => variant.sku === 'BONUS-FREE-001')).toMatchObject({
    price: 0,
    price_override: 0,
    is_unlimited: true,
  });

  const inventoryBeforeRepeat = (importedVariants.data || []).map((variant) => ({
    id: variant.id,
    price: variant.price,
    price_override: variant.price_override,
    stock_total: variant.stock_total,
    is_unlimited: variant.is_unlimited,
  }));
  await uploadCsv(csvFile(download.suggestedFilename(), sampleCsv));
  await expect(result).toContainText('นำเข้า 0 สินค้า / 0 รายการสต็อก');
  await expect(result.locator('li')).toHaveCount(7);
  await expect(result).toContainText('ข้ามสินค้าที่มีอยู่แล้ว: Traveler Acrylic Stand');
  await expect(result).toContainText('ข้อมูลและสต็อกเดิมไม่เปลี่ยน');
  const inventoryAfterRepeat = await service
    .from('products')
    .select('id,price,price_override,stock_total,is_unlimited')
    .eq('artist_id', artistId)
    .order('sku');
  must(inventoryAfterRepeat);
  expect(inventoryAfterRepeat.data).toEqual(inventoryBeforeRepeat);

  const invalidCsv = [
    'product_key,name,base_price,product_kind,variant_name,sku,stock,is_unlimited',
    `valid-${suffix},${invalidValidFamily},100,single,Default,ATOMIC-VALID-${suffix},4,false`,
    `invalid-${suffix},${invalidFamily},-1,single,Default,ATOMIC-INVALID-${suffix},4,false`,
  ].join('\n');
  await uploadCsv(csvFile(`invalid-${suffix}.csv`, invalidCsv));
  const invalidResult = page.getByTestId('csv-import-result');
  await expect(invalidResult).toHaveAttribute('role', 'alert');
  await expect(invalidResult).toContainText('ตรวจรายละเอียดการนำเข้าต่อไปนี้ก่อนลองอีกครั้ง');
  await expect(invalidResult).toContainText('แถว 3: base_price / price');
  await expect(invalidResult).toContainText('ใช้ตัวเลขตั้งแต่ศูนย์ขึ้นไป');
  const atomicParents = await service
    .from('product_parents')
    .select('name')
    .eq('artist_id', artistId)
    .in('name', [invalidValidFamily, invalidFamily]);
  must(atomicParents);
  expect(atomicParents.data).toEqual([]);

  const legacyCsv = [
    'name,price,variant_group,variant_name,sku,stock,is_unlimited',
    `Legacy A,100,${legacyFamily},A,LEGACY-A-${suffix},3,false`,
    `Legacy B,130,${legacyFamily},B,LEGACY-B-${suffix},5,false`,
  ].join('\n');
  await uploadCsv(csvFile(`legacy-${suffix}.csv`, legacyCsv));
  await expect(result).toHaveAttribute('role', 'status');
  await expect(result).toContainText('นำเข้า 1 สินค้า / 2 รายการสต็อก');
  const legacyParent = await service
    .from('product_parents')
    .select('id,name,base_price')
    .eq('artist_id', artistId)
    .eq('name', legacyFamily)
    .single();
  must(legacyParent);
  expect(legacyParent.data).toMatchObject({ name: legacyFamily, base_price: 100 });
  const legacyVariants = await service
    .from('products')
    .select('variant_name,price,price_override,stock_total,is_unlimited')
    .eq('parent_product_id', legacyParent.data!.id)
    .order('variant_sort_order');
  must(legacyVariants);
  expect(legacyVariants.data).toMatchObject([
    { variant_name: 'A', price: 100, price_override: null, stock_total: 3, is_unlimited: false },
    { variant_name: 'B', price: 130, price_override: 130, stock_total: 5, is_unlimited: false },
  ]);

  const backend = resolveSupabaseTestEnv();
  const authenticated = createClient(backend.url, backend.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await authenticated.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  const concurrentPayload = [{
    parent: {
      artist_id: artistId,
      name: concurrentFamily,
      description: 'Two simultaneous imports must create this family once.',
      category: 'Concurrency',
      tags: ['csv'],
      image_url: null,
      currency: 'THB',
      base_price: 88,
      product_kind: 'single',
      gallery_images: [],
      bundle_items: [],
      preorder_closes_at: null,
      preorder_eta: null,
      service_kind: null,
      service_duration_minutes: null,
      service_slots: null,
    },
    variants: [{
      name: 'Default',
      sku: `CONCURRENT-${suffix}`,
      price_override: null,
      stock_total: 9,
      is_unlimited: false,
      image_url: null,
      status: 'enable',
      variant_sort_order: 0,
    }],
  }];
  const concurrentResults = await Promise.all([
    authenticated.rpc('import_product_families', { p_artist_id: artistId, p_families: concurrentPayload }),
    authenticated.rpc('import_product_families', { p_artist_id: artistId, p_families: concurrentPayload }),
  ]);
  concurrentResults.forEach((rpcResult) => {
    if (rpcResult.error) throw rpcResult.error;
  });
  expect(concurrentResults.map((rpcResult) => rpcResult.data.imported_products).sort()).toEqual([0, 1]);
  expect(concurrentResults.map((rpcResult) => rpcResult.data.imported_variants).sort()).toEqual([0, 1]);
  const concurrentParents = await service
    .from('product_parents')
    .select('id')
    .eq('artist_id', artistId)
    .eq('name', concurrentFamily);
  must(concurrentParents);
  expect(concurrentParents.data).toHaveLength(1);
  const concurrentVariants = await service
    .from('products')
    .select('stock_total,stock_reserved,stock_sold,is_unlimited')
    .eq('parent_product_id', concurrentParents.data![0].id);
  must(concurrentVariants);
  expect(concurrentVariants.data).toEqual([{
    stock_total: 9,
    stock_reserved: 0,
    stock_sold: 0,
    is_unlimited: false,
  }]);
});
