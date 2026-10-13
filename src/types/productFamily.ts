export type ProductKind = 'single' | 'photo' | 'bundle' | 'preorder' | 'service';

export interface BundleItem {
  name: string;
  quantity: number;
}

export interface ProductParent {
  id: string;
  artist_id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  tags?: string[] | null;
  image_url?: string | null;
  currency: string;
  base_price: number;
  product_kind: ProductKind;
  gallery_images?: string[] | null;
  bundle_items?: BundleItem[] | null;
  preorder_closes_at?: string | null;
  preorder_eta?: string | null;
  service_duration_minutes?: number | null;
  service_slots?: number | null;
  service_kind?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface FamilyVariant {
  id?: string;
  parent_product_id?: string;
  variant_name?: string | null;
  sku?: string | null;
  price_override?: number | null;
  stock_total?: number | null;
  is_unlimited?: boolean;
  image_url?: string | null;
  status?: 'enable' | 'disable' | 'soldout';
  variant_sort_order?: number;
  updated_at?: string;
}
