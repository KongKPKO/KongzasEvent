import { expect, test } from '@playwright/test';
import Papa from 'papaparse';
import { readFileSync } from 'node:fs';
import { formatProductCsvIssue, parseProductCsv } from '../lib/productCsvImport';
const artist = '11111111-1111-4111-8111-111111111111';
const row = (values: Record<string, string> = {}) => ({ product_key: 'traveler', name: 'Traveler stand', base_price: '120', variant_name: 'Aether', stock: '10', is_unlimited: 'false', ...values });

test('CSV groups children and preserves blank inheritance, explicit equal-price override and zero', () => {
  const result = parseProductCsv([row(), row({variant_name: 'Lumine', price_override:'120'}), row({variant_name:'Paimon',price_override:'0'})], artist);
  expect(result.issues).toEqual([]);
  expect(result.families).toHaveLength(1);
  expect(result.families[0].variants.map((v) => v.price_override)).toEqual([null,120,0]);
});
test('legacy variant aliases normalize one parent while preserving different child prices', () => {
  const result = parseProductCsv([{name:'Keychain Red',price:'60',variant_group:'Keychain',option_name:'Red'}, {name:'Keychain Blue',price:'50',variant_group:'Keychain',option_name:'Blue'}],artist);
  expect(result.issues).toEqual([]);
  expect(result.families[0].parent.name).toBe('Keychain');
  expect(result.families[0].parent.base_price).toBe(50);
  expect(result.families[0].variants.map((v) => v.price_override)).toEqual([60,null]);
});
test('invalid rows and inconsistent shared fields reject the whole file', () => {
  for (const invalid of [row({stock:'-1'}),row({base_price:'120oops'}),row({currency:'???'}),row({status:'nonsense'}),row({is_unlimited:'maybe'}),row({gallery_images:'oops'}),row({product_kind:'preorder',preorder_closes_at:'2026-12-12T12:00'})]) {
    const result = parseProductCsv([row({product_key:'first'}),{...invalid,product_key:'second'}],artist);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.families).toEqual([]);
    expect(result.issues[0].row).toBe(3);
  }
  const conflict = parseProductCsv([row(),row({variant_name:'Lumine',base_price:'130'})],artist);
  expect(conflict.issues[0].code).toBe('shared');
  expect(conflict.families).toEqual([]);
});
test('duplicate variant names, SKUs and family identity fail before writing', () => {
  expect(parseProductCsv([row(),row({variant_name:'aether'})],artist).issues[0].code).toBe('duplicate');
  expect(parseProductCsv([row({sku:'A'}),row({variant_name:'Lumine',sku:'a'})],artist).issues[0].code).toBe('duplicate');
  expect(parseProductCsv([row(),row({product_key:'another',variant_name:'Lumine'})],artist).issues[0].code).toBe('duplicate');
});
test('sample CSV imports metadata for every current product type', () => {
  const parsed = Papa.parse<Record<string,string>>(readFileSync('public/samples/catalog-import-sample.csv','utf8'),{header:true,skipEmptyLines:'greedy'});
  expect(parsed.errors).toEqual([]);
  const result = parseProductCsv(parsed.data,artist);
  expect(result.issues).toEqual([]);
  expect(result.families).toHaveLength(3);
  expect(result.families.reduce((sum,f) => sum+f.variants.length,0)).toBe(4);
  expect(result.families.find((f) => f.parent.product_kind==='photo')?.parent.gallery_images).toHaveLength(5);
});
test('CSV validation explains fields and rows in Thai', () => {
  expect(parseProductCsv(Array.from({length:2001}, () => row()), artist).issues[0].code).toBe('limit');
  expect(formatProductCsvIssue({row:3,field:'stock',code:'integer'},'th')).toBe('แถว 3: stock — ใช้จำนวนเต็มที่ถูกต้อง');
});

test('CSV keeps separate item galleries and validates the whole file before saving', () => {
  const result = parseProductCsv([
    row({ product_kind: 'photo', variant_gallery_images: '["a.jpg","b.jpg"]' }),
    row({ product_kind: 'photo', variant_name: 'Lumine', variant_gallery_images: '["c.jpg"]' }),
  ], artist);
  expect(result.issues).toEqual([]);
  expect(result.families[0].variants.map(item => item.variant_gallery_images)).toEqual([['a.jpg', 'b.jpg'], ['c.jpg']]);
  expect(parseProductCsv([row({ product_kind: 'photo', variant_gallery_images: '[123]' })], artist).families).toEqual([]);
});

test('CSV directs bundles and retired formats away from ordinary imports', () => {
  for (const kind of ['bundle','preorder','service']) expect(parseProductCsv([row({product_kind:kind})],artist).issues.length).toBeGreaterThan(0);
});
