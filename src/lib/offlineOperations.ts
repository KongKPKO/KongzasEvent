import type { PromotionChoice } from '../types/promotion';
import { supabase } from '../supabaseClient';

export interface OfflineProduct { id: string; name: string; price: number; currency: string; stock_total: number | null; stock_reserved: number; stock_sold: number; is_unlimited: boolean }
export interface OfflineQueue { id: string; queue_number: number; status: string; last_updated_at: string }
export interface OfflineSnapshot {
  event: { id: string; artist_id: string; event_name: string }; device_id: string; actor_id: string;
  storagePersistent?: boolean; prepared_at: string; service_date: string; products: OfflineProduct[]; queues: OfflineQueue[];
}
export type OfflinePayload = {
  kind: 'sale'; order_id?: string | null; reward_choices?: PromotionChoice[]; promotion_choices?: PromotionChoice[]; expected_pricing_hash?: string | null; accept_exhausted_rewards?: boolean; items: Array<{ product_id: string; quantity: number; notes: string; name?: string; unit_price?: number; currency?: string }>;
  currency?: string; collected_total: number; method: 'cash' | 'transfer'; service_date: string; queue_number: number | null; recorded_at: string;
} | { kind: 'queue'; observed_queue?: boolean; queue_number: number; expected_status: string; status: string; service_date: string; recorded_at: string };
export interface OfflineEntry { paymentAttemptStorageKey?: string; snapshotPreparedAt: string; sequence: number; id: string; eventId: string; deviceId: string; payload: OfflinePayload; status: 'pending' | 'applied' | 'conflict' | 'resolved'; reason?: string }
const database = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('nireq-offline-v1', 1);
  request.onupgradeneeded = () => { request.result.createObjectStore('snapshots', { keyPath: 'event.id' }); request.result.createObjectStore('operations', { keyPath: 'id' }); };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error('Could not open local storage / เปิดพื้นที่เก็บในเครื่องไม่ได้'));
});
export async function offlineRows<T>(store: 'snapshots' | 'operations'): Promise<T[]> {
  const db = await database();
  try { return await new Promise<T[]>((resolve, reject) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
  finally { db.close(); }
}
export async function saveOffline(store: 'snapshots' | 'operations', value: OfflineSnapshot | OfflineEntry) {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Local save aborted')); }); }
  finally { db.close(); }
}
export function offlineDeviceId() {
  let id = localStorage.getItem('nireq-offline-device');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('nireq-offline-device', id); }
  return id;
}
export async function prepareOffline(eventId: string, takeover = false) {
  const outstanding = (await offlineRows<OfflineEntry>('operations')).some(row => row.eventId === eventId && (row.status === 'pending' || row.status === 'conflict'));
  if (outstanding) throw new Error('Review pending records before replacing the snapshot / จัดการรายการค้างก่อนเตรียมข้อมูลใหม่');
  const result = await supabase.rpc('prepare_offline_device', { p_event_id: eventId, p_device_id: offlineDeviceId(), p_takeover: takeover });
  if (result.error) throw new Error(result.error.message === 'another_primary_device' ? 'Another device is already primary / งานนี้มีเครื่องหลักอยู่แล้ว' : 'Connect and sign in with permission to prepare / เชื่อมต่อและเข้าสู่ระบบด้วยสิทธิ์ที่ใช้งานได้');
  const snapshot: OfflineSnapshot = result.data;
  snapshot.storagePersistent = await navigator.storage?.persist?.().catch(() => false) || false;
  await saveOffline('snapshots', snapshot);
  localStorage.setItem('nireq-offline-authorized', snapshot.actor_id);
  return snapshot;
}
export async function synchronizeOffline(snapshot: OfflineSnapshot) {
  const rows = (await offlineRows<OfflineEntry>('operations')).filter(row => row.eventId === snapshot.event.id);
  await supabase.rpc('offline_device_heartbeat', { p_event_id: snapshot.event.id, p_device_id: snapshot.device_id, p_pending: rows.some(row => (row.status === 'pending' || row.status === 'conflict')) });
  // ponytail: sequential booth outbox; batch only if real event throughput needs it.
  for (const row of rows.filter(row => row.status === 'pending' || row.status === 'conflict').sort((a,b) => a.sequence - b.sequence)) {
    const result = await supabase.rpc('apply_offline_operation', { p_id: row.id, p_event_id: row.eventId, p_device_id: row.deviceId, p_payload: row.payload });
    if (result.error) throw new Error('Not synchronized. Keep these records and sign in again when connected. / ยังส่งไม่สำเร็จ เก็บรายการไว้และเข้าสู่ระบบเมื่อเชื่อมต่อได้');
    if (!result.data || result.data.id !== row.id || !['applied','conflict','resolved'].includes(result.data.status)) throw new Error('Invalid synchronization response; records retained');
    await saveOffline('operations', { ...row, status: result.data.status, reason: result.data.reason });
    if (row.paymentAttemptStorageKey && result.data.status !== 'conflict' && localStorage.getItem(row.paymentAttemptStorageKey) === row.id) localStorage.removeItem(row.paymentAttemptStorageKey);

  }
}

export async function enqueueOffline(snapshot: OfflineSnapshot, payload: OfflinePayload, id: string = crypto.randomUUID()) {
  let saved: OfflineEntry | undefined;
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('operations', 'readwrite'), store = tx.objectStore('operations');
    const request = store.getAll();
    request.onsuccess = () => {
      const rows: OfflineEntry[] = request.result;
      saved = rows.find(row => row.id === id);
      if (saved && (saved.eventId !== snapshot.event.id || JSON.stringify({ ...saved.payload, recorded_at: '' }) !== JSON.stringify({ ...payload, recorded_at: '' }))) { tx.abort(); return; }
      if (!saved) { saved = { id, snapshotPreparedAt:snapshot.prepared_at, sequence: rows.reduce((max,row) => Math.max(max,row.sequence),0) + 1, eventId: snapshot.event.id, deviceId: snapshot.device_id, payload, status: 'pending' }; store.add(saved); }
    };
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Local save aborted'));
  }); } finally { db.close(); }
  if (!saved) throw new Error('Local save failed');
  return saved;
}

export async function recordPreparedPayment(id: string, eventId: string, payload: OfflinePayload, paymentAttemptStorageKey: string) {
  if (!offlineAuthorization()) return null;
  const snapshot = (await offlineRows<OfflineSnapshot>('snapshots')).find(item => item.event.id === eventId);
  if (!snapshot || offlineAuthorization() !== snapshot.actor_id) return null;
  const row = await enqueueOffline(snapshot, payload, id);
  const saved = { ...row, paymentAttemptStorageKey };
  await saveOffline('operations', saved);
  return saved;
}

export function offlineAuthorization() {
  try { return localStorage.getItem('nireq-offline-authorized'); }
  catch { return null; }
}
