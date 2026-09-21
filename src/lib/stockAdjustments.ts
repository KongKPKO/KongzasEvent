import { supabase } from '../supabaseClient';

export interface ProductStockSummary {
  product_id: string;
  on_hand: number;
  allocated: number;
  available: number;
}

export interface EventStockSummary {
  event_product_id: string;
  event_stock_total: number;
  event_reserved: number;
  event_sold: number;
  event_available: number;
  catalog_available: number;
}

const single = <T>(rows: T[] | null, error: unknown) => {
  if (error) throw error;
  if (!rows?.[0]) throw new Error('stock_adjustment_missing_result');
  return rows[0];
};

export const fetchProductStockSummaries = async (artistId: string) => {
  const { data, error } = await supabase.rpc('list_product_stock_summaries', { p_artist_id: artistId });
  if (error) throw error;
  return (data || []) as ProductStockSummary[];
};

export type CatalogStockKind = 'receive' | 'increase' | 'decrease';
export interface CatalogStockDraft {
  requestId: string;
  quantity: number;
  kind: CatalogStockKind;
  reason: string;
}
export interface CatalogStockMovement {
  id: string;
  actor_id: string | null;
  created_at: string;
  quantity_before: number | null;
  quantity_after: number | null;
  kind: string;
  reason: string;
}
const draftKey = (productId: string) => `nireq-stock-pending-${productId}`;
export const readCatalogStockDraft = (productId: string): CatalogStockDraft | null => {
  const raw = localStorage.getItem(draftKey(productId));
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !('requestId' in value) || typeof value.requestId !== 'string' ||
      !('quantity' in value) || typeof value.quantity !== 'number' || !Number.isSafeInteger(value.quantity) || value.quantity <= 0 ||
      !('kind' in value) || (value.kind !== 'receive' && value.kind !== 'increase' && value.kind !== 'decrease') ||
      !('reason' in value) || typeof value.reason !== 'string') throw new Error('Invalid pending stock adjustment. Contact support before making another adjustment.');
  return { requestId: value.requestId, quantity: value.quantity, kind: value.kind, reason: value.reason };
};
export const adjustCatalogStock = async (productId: string, quantity: number, kind: CatalogStockKind, reason: string) => {
  const pending = readCatalogStockDraft(productId);
  if (pending && (pending.quantity !== quantity || pending.kind !== kind || pending.reason !== reason)) {
    throw new Error('A stock adjustment is awaiting confirmation. Reopen this product’s stock dialog and retry it first.');
  }
  const draft: CatalogStockDraft = pending || { requestId: crypto.randomUUID(), quantity, kind, reason };
  localStorage.setItem(draftKey(productId), JSON.stringify(draft));
  const { data, error } = await supabase.rpc('adjust_catalog_stock', {
    p_product_id: productId, p_quantity: quantity, p_kind: kind, p_reason: reason, p_request_id: draft.requestId,
  });
  if (error) {
    // PostgreSQL validation/permission failures roll back; transport failures may have committed.
    if (/^(22|23|42501|P0001)/.test(error.code || '')) localStorage.removeItem(draftKey(productId));
    throw error;
  }
  const result = single<ProductStockSummary>(data as ProductStockSummary[] | null, error);
  localStorage.removeItem(draftKey(productId));
  return result;
};
export const fetchCatalogStockHistory = async (productId: string) => {
  const { data, error } = await supabase.from('catalog_stock_movements')
    .select('id, actor_id, created_at, quantity_before, quantity_after, kind, reason')
    .eq('product_id', productId).order('created_at', { ascending: false }).limit(30);
  if (error) throw error;
  return (data || []) as CatalogStockMovement[];
};

export const addEventStock = async (eventProductId: string, quantity: number) => {
  const { data, error } = await supabase.rpc('add_event_stock', {
    p_event_product_id: eventProductId,
    p_quantity: quantity,
  });
  return single<EventStockSummary>(data as EventStockSummary[] | null, error);
};

export const removeEventStock = async (eventProductId: string, quantity: number) => {
  const { data, error } = await supabase.rpc('remove_event_stock', {
    p_event_product_id: eventProductId,
    p_quantity: quantity,
  });
  return single<EventStockSummary>(data as EventStockSummary[] | null, error);
};

export const getStockAdjustmentErrorMessage = (error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message || '')
        : String(error || '');
  if (message.includes('insufficient_catalog_available_stock')) {
    return 'Not enough central stock available. Add stock to the catalog first, then add it to this event.';
  }
  if (message.includes('event_stock_below_reserved_or_sold')) return 'You can only remove stock that is not reserved or sold.';
  if (message.includes('stock_removal_reason_required')) return 'Choose a reason before removing stock.';
  if (message.includes('invalid_stock_quantity')) return 'Enter a whole number greater than zero.';
  if (message.includes('unlimited')) return 'Unlimited products do not use finite stock adjustments.';
  return message || 'Stock adjustment failed.';
};
