import type { BundleItem, ProductKind } from './productFamily';

export type ProductPresentationKind = ProductKind;
export type ProductBundleItem = BundleItem;

export interface ProductPresentationFields {
  product_kind?: ProductPresentationKind | null;
  gallery_images?: string[] | null;
  bundle_items?: ProductBundleItem[] | null;
  preorder_closes_at?: string | null;
  preorder_eta?: string | null;
  service_duration_minutes?: number | null;
  service_slots?: number | null;
  service_kind?: string | null;
}

export interface ProductVariantFields {
  parent_product_id?: string | null;
  variant_name?: string | null;
  variant_sort_order?: number | null;
  variant_group_name?: string | null;
  sku?: string | null;
}

export interface PresentableProduct extends ProductPresentationFields, ProductVariantFields {
  id: string;
  name: string;
  price: number;
  image_url?: string | null;
  description?: string | null;
  category?: string | null;
}
