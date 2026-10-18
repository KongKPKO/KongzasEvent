import { useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

export interface QueueTicket {
  id: string;
  artist_id: string;
  event_id?: string;
  queue_service_date?: string | null;
  queue_number: number;
  status: 'waiting' | 'queued' | 'calling' | 'serving' | 'complete' | 'missed' | 'expired';
  last_updated_at: string;
  arrived_at?: string | null;
  called_at?: string;
  created_at?: string;
  served_at?: string;
  completed_at?: string;
}
export type QueueAction = 'arrive' | 'recall' | 'serving' | 'missed' | 'waiting';

export function useQueueOperations(eventId: string | undefined, onUpdated: (id: string, updates: Partial<QueueTicket>) => void) {
  const busy = useRef(false);
  const currentEvent = useRef(eventId);
  currentEvent.current = eventId;
  const batchRequest = useRef<{ eventId: string; count: number; id: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(operation: () => Promise<T>): Promise<T | null> => {
    if (busy.current) return null;
    busy.current = true; setPending(true); setError(null);
    try { return await operation(); }
    catch (cause) { console.error('[Queue operations]', cause); setError('คิวเปลี่ยนแล้วหรือเชื่อมต่อไม่ได้ กรุณาตรวจคิวและลองอีกครั้ง / Queue changed or connection unavailable. Review and retry. For an uncertain batch result, retry the same batch size.'); return null; }
    finally { busy.current = false; setPending(false); }
  };
  const callBatch = (count: number) => run(async () => {
    if (!eventId) throw new Error('event_required');
    if (batchRequest.current?.eventId !== eventId) batchRequest.current = null;
    if (batchRequest.current && batchRequest.current.count !== count) throw new Error('retry_pending_batch_first');
    const request = batchRequest.current || { eventId, count, id: crypto.randomUUID() };
    batchRequest.current = request;
    const { data, error: failure } = await supabase.rpc('call_queue_batch', { p_event_id: eventId, p_count: count, p_request_id: request.id });
    if (failure) {
      if (/^[A-Z0-9]{5}$/.test(failure.code || '')) batchRequest.current = null;
      throw failure;
    }
    batchRequest.current = null;
    for (const ticket of (data || []) as QueueTicket[]) if (currentEvent.current === request.eventId) onUpdated(ticket.id, ticket);
    return data as QueueTicket[];
  });
  const action = (ticket: QueueTicket, name: QueueAction) => run(async () => {
    const { data, error: failure } = await supabase.rpc('update_queue_operation', { p_queue_id: ticket.id, p_action: name, p_expected_updated_at: ticket.last_updated_at });
    if (failure) throw failure;
    const updated = (Array.isArray(data) ? data[0] : data) as QueueTicket;
    if (!updated?.id) throw new Error('queue_response_invalid');
    if (currentEvent.current === ticket.event_id) onUpdated(updated.id, updated);
    return updated;
  });
  const retryBatchCount = batchRequest.current && batchRequest.current.eventId === eventId ? batchRequest.current.count : null;
  return { action, callBatch, pending, error, retryBatchCount };
}
