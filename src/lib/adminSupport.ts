import { supabase } from '../supabaseClient';

export interface SupportResult {
  id: string; name?: string; slug?: string; is_public?: boolean; is_verified?: boolean;
  code?: string | null; store_id?: string; store_name?: string; channel_name?: string;
  status?: string; created_at?: string;
}
export interface SupportSearch { results: SupportResult[]; limited: boolean }
export interface SupportChannel { id: string; name: string; status: string; starts_at: string; ends_at: string }
export interface SupportStore {
  kind: 'store'; id: string; name: string; slug: string; is_public: boolean;
  is_verified: boolean; published_at: string | null; events: SupportChannel[]; campaigns: SupportChannel[];
}
export interface SupportOrder {
  kind: 'order'; id: string; code: string | null; store_id: string; store_name: string;
  channel_name: string; channel_type: string; order_type: string; created_at: string; status: string;
  customer_name: string | null; customer_email_masked: string | null; customer_phone_masked: string | null;
  currency: string | null; subtotal_price: number | null; discount_total: number | null;
  shipping_fee: number | null; total_price: number | null;
  payment_status: string | null; submitted_at: string | null; stock_hold_expires_at: string | null;
  upload_grace_expires_at: string | null; fulfillment_method: string | null; fulfillment_status: string | null;
  tracking_number: string | null; shipping_carrier: string | null; shipped_at: string | null; picked_up_at: string | null;
  pickup_name: string | null; pickup_starts_at: string | null; pickup_ends_at: string | null;
  items: Array<{id: string; name: string | null; sku: string | null; quantity: number;
    price_per_unit: number | null; currency: string | null; line_type: string}>;
}
export type SupportDetail = SupportStore | SupportOrder;
export async function searchSupport(kind: 'stores' | 'orders', query: string, storeId?: string) {
  const { data, error } = await supabase.rpc('admin_support', { p_action: `search_${kind}`, p_query: query, p_store_id: storeId || null });
  if (error) throw error;
  return data as SupportSearch;
}
export async function openSupport(kind: 'store' | 'order', id: string, reason: string, storeId?: string) {
  const { data, error } = await supabase.rpc('admin_support', { p_action: kind, p_target: id, p_reason: reason, p_store_id: storeId || null });
  if (error) throw error;
  return data as SupportDetail | null;
}
