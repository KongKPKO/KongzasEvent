import { supabase } from '../supabaseClient';

export interface InventoryOverview {
  product_id: string;
  tracking: boolean;
  tracking_locked: boolean;
  open_live_orders: number;
  recorded_total: number | null;
  physical_on_hand: number | null;
  available: number | null;
  opening_committed: number;
  awaiting_fulfillment_stock: number;
  allocated: number;
  held: number;
  production_earmarked: number;
  production_shortfall: number;
  production_ordered: number;
  production_fulfilled: number;
  production_unpaid: number;
  sold: number;
  fulfilled: number;
  recent_events: Array<{ kind: string; quantity_before: number; quantity_after: number; created_at: string }>;
  channels: Array<{ id: string; name: string; kind: 'event' | 'campaign'; allocated: number; held: number; sold: number }>;
}
export async function fetchInventoryOverview(artistId: string) {
  const { data, error } = await supabase.rpc('inventory_overview', { p_artist_id: artistId });
  if (error) throw error;
  return (data || []) as InventoryOverview[];
}
export async function startStockTracking(productId: string, quantity: number, requestId: string) {
  const { error } = await supabase.rpc('start_stock_tracking', { p_product_id: productId, p_quantity: quantity, p_request_id: requestId });
  if (error) throw error;
}

export async function stopStockTracking(productId: string) {
  const { error } = await supabase.rpc('stop_stock_tracking', { p_product_id: productId });
  if (error) throw error;
}

export async function assignProductionStock(productId: string, quantity: number, requestId: string) {
  const { data, error } = await supabase.rpc('assign_production_stock', { p_product_id: productId, p_quantity: quantity, p_request_id: requestId });
  if (error) throw error;
  if (!data || !Number.isSafeInteger(data.allocated) || data.allocated < 0) throw new Error('stock_assignment_missing_result');
  return data as { allocated: number; available: number };
}
