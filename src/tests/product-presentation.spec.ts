import { expect, test } from '@playwright/test';
import {
  buildProductPresentationEntries,
  getBundleItemCount,
  getProductImages,
  inheritProductPresentation,
} from '../utils/productPresentation';
import type { PresentableProduct } from '../types/productPresentation';

const product = (overrides: Partial<PresentableProduct>): PresentableProduct => ({
  id: 'base',
  name: 'Base product',
  price: 100,
  image_url: null,
  ...overrides,
});

test('groups variants under parent_product_id before the legacy product line', () => {
  const parent = product({ id: 'parent', name: 'Traveler stand', product_kind: 'photo', gallery_images: ['one.jpg', 'two.jpg'] });
  const aether = product({ id: 'aether', name: 'Aether', parent_product_id: 'parent', variant_group_name: 'Legacy line', variant_name: 'Aether', variant_sort_order: 2 });
  const lumine = product({ id: 'lumine', name: 'Lumine', parent_product_id: 'parent', variant_group_name: 'Different legacy line', variant_name: 'Lumine', variant_sort_order: 1 });

  const entries = buildProductPresentationEntries([parent, aether, lumine]);

  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ type: 'group', key: 'parent:parent', label: 'Traveler stand' });
  if (entries[0].type !== 'group') throw new Error('Expected variant group');
  expect(entries[0].products.map((item) => item.id)).toEqual(['lumine', 'aether']);
});

test('keeps legacy variant groups working when no parent record exists', () => {
  const entries = buildProductPresentationEntries([
    product({ id: 'red', variant_group_name: 'Keychain', variant_name: 'Red' }),
    product({ id: 'blue', variant_group_name: 'keychain', variant_name: 'Blue' }),
    product({ id: 'solo', name: 'Solo item' }),
  ]);

  expect(entries.map((entry) => entry.type)).toEqual(['group', 'product']);
  expect(entries[0]).toMatchObject({ type: 'group', label: 'Keychain' });
});

test('renders a one-variant family as a normal product card', () => {
  const entries = buildProductPresentationEntries([
    product({ id: 'default', parent_product_id: 'family-id', name: 'Solo item', variant_name: 'Default' }),
  ]);

  expect(entries).toEqual([expect.objectContaining({ type: 'product', key: 'product:default' })]);
});

test('inherits presentation metadata from a parent while preserving variant inventory identity', () => {
  const parent = product({ id: 'parent', name: 'Cheki session', product_kind: 'service', service_kind: '2-shot', service_duration_minutes: 10, image_url: 'parent.jpg' });
  const child = product({ id: 'late', name: 'Late slot', parent_product_id: 'parent', variant_name: '16:00', price: 350 });

  const inherited = inheritProductPresentation(child, parent);

  expect(inherited).toMatchObject({ id: 'late', name: 'Cheki session', variant_name: '16:00', price: 350, service_kind: '2-shot', service_duration_minutes: 10, image_url: 'parent.jpg' });
});

test('deduplicates gallery images and totals bundle quantities', () => {
  expect(getProductImages(product({ image_url: 'cover.jpg', gallery_images: ['cover.jpg', 'detail.jpg', 'detail.jpg'] }))).toEqual(['cover.jpg', 'detail.jpg']);
  expect(getBundleItemCount([{ name: 'Postcard', quantity: 3 }, { name: 'Badge', quantity: 1 }])).toBe(4);
});

test('does not merge distinct persisted parents through a shared legacy label', () => {
  const entries = buildProductPresentationEntries([
    product({ id: 'red', parent_product_id: 'family-a', variant_group_name: 'Keychain' }),
    product({ id: 'blue', parent_product_id: 'family-b', variant_group_name: 'Keychain' }),
  ]);
  expect(entries).toHaveLength(2);
  expect(entries.every((entry) => entry.type === 'product')).toBe(true);
});
