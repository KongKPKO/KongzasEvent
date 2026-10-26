import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useI18n } from '../i18n';
import { offlineRows, synchronizeOffline, type OfflineEntry, type OfflineSnapshot } from '../lib/offlineOperations';

interface RemoteConflict {
  id: string;
  payload: OfflineEntry['payload'];
  reason: string;
}

interface CompletedOrder {
  id: string;
  created_at: string;
  total_price: number;
}

export default function OfflineWorkspace() {
  const { language } = useI18n();
  const th = language === 'th';
  const [params] = useSearchParams();
  const [snapshots, setSnapshots] = useState<OfflineSnapshot[]>([]);
  const [eventId, setEventId] = useState(params.get('eventId') || '');
  const [rows, setRows] = useState<OfflineEntry[]>([]);
  const [remote, setRemote] = useState<RemoteConflict[]>([]);
  const [orders, setOrders] = useState<CompletedOrder[]>([]);
  const [resolution, setResolution] = useState<Record<string, { order: string; note: string }>>({});
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const reload = async () => {
    const [nextSnapshots, nextRows] = await Promise.all([
      offlineRows<OfflineSnapshot>('snapshots'),
      offlineRows<OfflineEntry>('operations'),
    ]);
    setSnapshots(nextSnapshots);
    setRows(nextRows);
    setEventId(current => current || nextSnapshots[0]?.event.id || '');
  };

  useEffect(() => {
    void reload().catch(() => setMessage('เปิดข้อมูลในเครื่องไม่ได้ / Local storage unavailable'));
  }, []);

  const snapshot = eventId ? snapshots.find(item => item.event.id === eventId) : snapshots[0];
  const entries = rows.filter(row => row.eventId === snapshot?.event.id);
  const pending = entries.filter(row => row.status === 'pending' || row.status === 'conflict');

  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage('');
    try {
      await action();
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ดำเนินการไม่สำเร็จ / Could not complete this action');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const loadRemote = async () => {
    const target = eventId || snapshot?.event.id;
    if (!target) throw new Error('ไม่พบอีเวนต์สำหรับตรวจรายการ / No event is available for reconciliation');
    const result = await supabase
      .from('offline_operations')
      .select('id,payload,reason')
      .eq('event_id', target)
      .eq('status', 'conflict')
      .order('created_at');
    if (result.error) throw new Error('โหลดรายการกลางไม่ได้ กรุณาเข้าสู่ระบบ / Sign in to load server records');
    setRemote((result.data || []) as RemoteConflict[]);

    const receipts = await supabase
      .from('orders')
      .select('id,created_at,total_price')
      .eq('event_id', target)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(100);
    if (receipts.error) throw new Error('โหลดประวัติขายไม่ได้ / Could not load sale history');
    setOrders(receipts.data || []);
  };

  const exportRecords = () => {
    const url = URL.createObjectURL(new Blob([
      JSON.stringify({ snapshot, operations: entries }, null, 2),
    ], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'paimon-pending-records.json';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const releaseDevice = async () => {
    if (!snapshot) return;
    const result = await supabase.rpc('release_offline_device', {
      p_event_id: snapshot.event.id,
      p_device_id: snapshot.device_id,
    });
    if (result.error) {
      throw new Error('ยังยกเลิกเครื่องเดิมไม่ได้ ตรวจรายการค้างและการเชื่อมต่อ / Cannot release the old device; check pending records and connection');
    }
    localStorage.removeItem('nireq-offline-authorized');
  };

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <Link to="/manage" className="text-pink-700 underline">
        {th ? 'กลับหน้าจัดการ' : 'Back to management'}
      </Link>
      <h1 className="text-2xl font-bold">{th ? 'กู้คืนรายการออฟไลน์เดิม' : 'Recover existing offline records'}</h1>
      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
        {th
          ? 'ยังไม่เปิดให้เตรียมเครื่องหรือบันทึกการขายและคิวออฟไลน์ใหม่ หน้านี้มีไว้ส่งออก ซิงก์ และตรวจรายการเดิมที่บันทึกไว้แล้วเท่านั้น'
          : 'Preparing a device and recording new offline sales or queue changes are unavailable for now. This page only exports, synchronizes, and reconciles records that were already saved.'}
      </p>

      {snapshots.length > 0 && (
        <select
          aria-label={th ? 'อีเวนต์ที่มีรายการเดิม' : 'Event with existing records'}
          value={snapshot?.event.id || ''}
          onChange={event => setEventId(event.target.value)}
          className="min-h-11 rounded border p-2"
        >
          {snapshots.map(item => (
            <option key={item.event.id} value={item.event.id}>{item.event.event_name}</option>
          ))}
        </select>
      )}

      {snapshot ? (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="text-xl font-bold">{snapshot.event.event_name}</h2>
          <p>
            {th ? 'ข้อมูลวันที่ ' : 'Prepared for '}{snapshot.service_date} · {pending.length}{' '}
            {th ? 'รายการรอส่งหรือตรวจ' : 'pending or needing review'}
          </p>
          {!snapshot.storagePersistent && (
            <p className="text-sm text-amber-800">
              {th
                ? 'เบราว์เซอร์ไม่รับรองว่าจะเก็บข้อมูลไว้ถาวร ควรดาวน์โหลดสำเนารายการค้าง'
                : 'The browser has not granted persistent storage. Download a backup of pending records.'}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              disabled={busy || pending.length === 0}
              onClick={() => void run(() => synchronizeOffline(snapshot))}
              className="min-h-11 rounded-xl bg-pink-600 px-4 text-white disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {th ? 'ส่งรายการเดิมเมื่อเชื่อมต่อแล้ว' : 'Synchronize existing records'}
            </button>
            <button onClick={exportRecords} className="min-h-11 rounded-xl border px-4">
              {th ? 'ดาวน์โหลดสำเนารายการ' : 'Download records backup'}
            </button>
            <button
              disabled={busy || pending.length > 0}
              className="min-h-11 rounded-xl border px-4 disabled:cursor-not-allowed disabled:text-gray-400"
              onClick={() => void run(releaseDevice)}
            >
              {th ? 'ยกเลิกเครื่องออฟไลน์เดิม' : 'Release the old offline device'}
            </button>
          </div>
          <div>
            <h2 className="font-bold">{th ? 'รายการเดิมที่ยังไม่จบ' : 'Existing outstanding records'}</h2>
            {pending.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600">{th ? 'ไม่มีรายการค้างในเครื่องนี้' : 'There are no outstanding records on this device.'}</p>
            ) : pending.map(row => (
              <div key={row.id} className="my-2 rounded-xl border p-3">
                {row.sequence} · {row.payload.kind === 'sale'
                  ? `${row.payload.collected_total} ${row.payload.currency || ''} (${row.payload.method})`
                  : `#${row.payload.queue_number} ${row.payload.status}`} · {row.status === 'conflict'
                    ? (th ? 'ต้องตรวจข้อมูลกับร้าน ยอดเงินจริงยังอยู่ครบ' : 'Needs review; the actual receipt is preserved')
                    : (th ? 'รอส่ง' : 'Pending')}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p className="rounded-xl border p-4 text-sm text-gray-700">
          {th ? 'ไม่พบรายการออฟไลน์เดิมในเบราว์เซอร์นี้' : 'No existing offline records were found in this browser.'}
        </p>
      )}

      {(snapshot || eventId) && (
        <section className="space-y-3 border-t pt-4">
          <h2 className="font-bold">{th ? 'ตรวจรายการเดิมที่ขัดแย้งกับระบบกลาง' : 'Reconcile existing server conflicts'}</h2>
          <button disabled={busy} className="min-h-11 rounded-xl border px-4" onClick={() => void run(loadRemote)}>
            {th ? 'โหลดรายการที่ต้องตรวจ' : 'Load conflicts'}
          </button>
          {remote.map((row, index) => (
            <div key={row.id} className="space-y-2 rounded-xl border p-3">
              <h3 className="font-semibold">
                {th ? 'รายการ ' : 'Record '}{index + 1} · {row.payload.kind === 'sale'
                  ? `${row.payload.collected_total} ${row.payload.currency || ''}`
                  : `#${row.payload.queue_number}`}
              </h3>
              <p className="text-sm">
                {th
                  ? 'เจ้าของหรือผู้จัดการ: แก้รายการขายหรือคิวให้ตรงก่อน แล้วบันทึกผล ห้ามเรียกเก็บเงินลูกค้าซ้ำ'
                  : 'Owner or manager: reconcile the sale or queue first, then record the result. Do not charge the buyer again.'}
              </p>
              {row.payload.kind === 'sale' && (
                <>
                  <ul>
                    {row.payload.items.map(item => (
                      <li key={item.product_id}>{item.name || (th ? 'สินค้า' : 'Item')} × {item.quantity}</li>
                    ))}
                  </ul>
                  <select
                    aria-label={th ? 'รายการขายที่ตรงกัน' : 'Matching completed sale'}
                    className="min-h-11 max-w-full rounded border p-2"
                    value={resolution[row.id]?.order || ''}
                    onChange={event => setResolution(current => ({
                      ...current,
                      [row.id]: { note: current[row.id]?.note || '', order: event.target.value },
                    }))}
                  >
                    <option value="">{th ? 'เลือกรายการขายที่บันทึกไว้แล้ว' : 'Choose an existing completed sale'}</option>
                    {orders.map(order => (
                      <option key={order.id} value={order.id}>{new Date(order.created_at).toLocaleString()} · {order.total_price}</option>
                    ))}
                  </select>
                </>
              )}
              <label className="block">
                {th ? 'ผลการตรวจ' : 'Reconciliation note'}
                <textarea
                  maxLength={1000}
                  value={resolution[row.id]?.note || ''}
                  onChange={event => setResolution(current => ({
                    ...current,
                    [row.id]: { order: current[row.id]?.order || '', note: event.target.value },
                  }))}
                  className="block min-h-20 w-full rounded border p-2"
                />
              </label>
              <button
                disabled={busy}
                className="min-h-11 rounded-xl border px-4"
                onClick={() => void run(async () => {
                  const result = await supabase.rpc('resolve_offline_operation', {
                    p_id: row.id,
                    p_order_id: resolution[row.id]?.order || null,
                    p_note: resolution[row.id]?.note || '',
                  });
                  if (result.error) {
                    throw new Error('ยังปิดรายการไม่ได้ ต้องมีสิทธิ์และข้อมูลตรงกับยอดเงินจริงและสินค้า / Cannot resolve: permission, actual amount and items must match');
                  }
                  await loadRemote();
                  if (snapshot) await synchronizeOffline(snapshot);
                })}
              >
                {th ? 'บันทึกว่าตรวจตรงกันแล้ว' : 'Confirm reconciliation'}
              </button>
            </div>
          ))}
        </section>
      )}
      {message && <p role="status" className="rounded-xl bg-amber-50 p-3">{message}</p>}
    </main>
  );
}
