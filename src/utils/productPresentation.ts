import type { PresentableProduct, ProductBundleItem } from '../types/productPresentation';

export type ProductPresentationEntry<T extends PresentableProduct> =
  | { type: 'product'; key: string; product: T }
  | { type: 'group'; key: string; label: string; parent: T | null; products: T[] };

const normalizedLegacyGroup = (product: PresentableProduct) => product.variant_group_name?.trim().toLocaleLowerCase() || '';

export function getProductImages(product: PresentableProduct): string[] {
  const values = [product.image_url || '', ...(product.gallery_images || [])];
  return values.map((value) => value.trim()).filter((value, index, all) => Boolean(value) && all.indexOf(value) === index);
}

export function getBundleItemCount(items: ProductBundleItem[] | null | undefined): number {
  return (items || []).reduce((total, item) => total + Math.max(0, Number(item.quantity) || 0), 0);
}

export function getProductPresentationKind(product: PresentableProduct) {
  if (product.product_kind) return product.product_kind;
  if ((product.gallery_images || []).length > 0) return 'photo' as const;
  return 'single' as const;
}

export function buildProductPresentationEntries<T extends PresentableProduct>(products: T[]): ProductPresentationEntry<T>[] {
  const parents = new Map(products.map((product) => [product.id, product]));
  const childParentIds = new Set(products.map((product) => product.parent_product_id).filter(Boolean) as string[]);
  const parentCounts = new Map<string, number>();
  products.forEach((product) => {
    const parentId = product.parent_product_id?.trim();
    if (parentId) parentCounts.set(parentId, (parentCounts.get(parentId) || 0) + 1);
  });
  const entries: ProductPresentationEntry<T>[] = [];
  const entryByKey = new Map<string, Extract<ProductPresentationEntry<T>, { type: 'group' }>>();

  products.forEach((product) => {
    if (childParentIds.has(product.id)) return;

    const parentId = product.parent_product_id?.trim();
    const parent = parentId ? parents.get(parentId) || null : null;
    const legacyGroup = normalizedLegacyGroup(product);
    const shouldGroupByParent = Boolean(parentId && ((parentCounts.get(parentId) || 0) > 1 || parent));
    const groupKey = shouldGroupByParent ? `parent:${parentId}` : !parentId && legacyGroup ? `legacy:${legacyGroup}` : '';

    if (!groupKey) {
      entries.push({ type: 'product', key: `product:${product.id}`, product });
      return;
    }

    let group = entryByKey.get(groupKey);
    if (!group) {
      group = {
        type: 'group',
        key: groupKey,
        label: parent?.name || product.variant_group_name?.trim() || product.name,
        parent,
        products: [],
      };
      entryByKey.set(groupKey, group);
      entries.push(group);
    }
    group.products.push(product);
  });

  entries.forEach((entry) => {
    if (entry.type !== 'group') return;
    entry.products.sort((a, b) => {
      const order = (a.variant_sort_order || 0) - (b.variant_sort_order || 0);
      return order || (a.variant_name || a.name).localeCompare(b.variant_name || b.name);
    });
  });

  return entries;
}

export function getProductPriceRange(products: PresentableProduct[]): { min: number; max: number } {
  const prices = products.map((product) => Number(product.price)).filter(Number.isFinite);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

export function inheritProductPresentation<T extends PresentableProduct>(product: T, parent: T | null): T {
  if (!parent) return product;
  return {
    ...product,
    name: parent.name || product.name,
    description: product.description || parent.description,
    category: product.category || parent.category,
    product_kind: product.product_kind || parent.product_kind,
    gallery_images: product.gallery_images?.length ? product.gallery_images : parent.gallery_images,
    bundle_items: product.bundle_items?.length ? product.bundle_items : parent.bundle_items,
    preorder_closes_at: product.preorder_closes_at || parent.preorder_closes_at,
    preorder_eta: product.preorder_eta || parent.preorder_eta,
    service_duration_minutes: product.service_duration_minutes ?? parent.service_duration_minutes,
    service_slots: product.service_slots ?? parent.service_slots,
    service_kind: product.service_kind || parent.service_kind,
    image_url: product.image_url || parent.image_url,
  } as T;
}

export const isProductPreorderClosed = (product: PresentableProduct, now = Date.now()) =>
  getProductPresentationKind(product) === 'preorder' && Boolean(product.preorder_closes_at)
  && new Date(product.preorder_closes_at || '').getTime() <= now;
