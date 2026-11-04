import { supabase } from '../supabaseClient';

export async function getOrderSequences(ids: string[]): Promise<Record<string, number>> {
  if (!ids.length) return {};
  const results = await Promise.all(Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) =>
    supabase.rpc('get_order_sequences', { p_order_ids: ids.slice(index * 100, index * 100 + 100) })));
  const failure = results.find(result => result.error);
  if (failure?.error) throw failure.error;
  return Object.fromEntries(results.flatMap(result => result.data || []).filter(row => row.order_sequence != null).map(row => [row.order_id, Number(row.order_sequence)]));
}
