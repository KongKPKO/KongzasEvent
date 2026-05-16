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

export const addCatalogStock = async (productId: string, quantity: number, reason?: string) => {
  const { data, error } = await supabase.rpc('add_catalog_stock', {
    p_product_id: productId,
    p_quantity: quantity,
    p_reason: reason || null,
  });
  return single<ProductStockSummary>(data as ProductStockSummary[] | null, error);
};

export const removeCatalogStock = async (productId: string, quantity: number, reason: string) => {
  const { data, error } = await supabase.rpc('remove_catalog_stock', {
    p_product_id: productId,
    p_quantity: quantity,
    p_reason: reason,
  });
  return single<ProductStockSummary>(data as ProductStockSummary[] | null, error);
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
  const message = error instanceof Error ? error.message : String(error || '');
  if (message.includes('insufficient_catalog_available_stock')) return 'Catalog stock is not sufficient for this change.';
  if (message.includes('event_stock_below_reserved_or_sold')) return 'You can only remove stock that is not reserved or sold.';
  if (message.includes('stock_removal_reason_required')) return 'Choose a reason before removing stock.';
  if (message.includes('invalid_stock_quantity')) return 'Enter a whole number greater than zero.';
  if (message.includes('unlimited')) return 'Unlimited products do not use finite stock adjustments.';
  return message || 'Stock adjustment failed.';
};
