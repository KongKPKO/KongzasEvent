import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useI18n } from '../i18n';
import { enqueueOffline, offlineAuthorization, offlineRows, prepareOffline, synchronizeOffline, type OfflineEntry, type OfflineSnapshot } from '../lib/offlineOperations';

export default function OfflineWorkspace() {
  const { language } = useI18n(), th = language === 'th';
  const [params] = useSearchParams();
  const [snapshots, setSnapshots] = useState<OfflineSnapshot[]>([]);
  const [eventId, setEventId] = useState(params.get('eventId') || '');
  const [rows, setRows] = useState<OfflineEntry[]>([]);
  const [remote, setRemote] = useState<Array<{id:string;payload:OfflineEntry['payload'];reason:string}>>([]);
  const [orders, setOrders] = useState<Array<{id:string;created_at:string;total_price:number}>>([]);
  const [resolution, setResolution] = useState<Record<string,{order:string;note:string}>>({});
  const [cart, setCart] = useState<Record<string,number>>({});
  const [total, setTotal] = useState('');
  const [queue, setQueue] = useState('');
  const [exclusive, setExclusive] = useState(false);
  useEffect(() => {
    let release: (() => void) | undefined; let ended = false; const controller = new AbortController();
    void navigator.locks.request('nireq-offline-workspace', { signal: controller.signal }, async lock => {
      if (!lock || ended) return;
      setExclusive(true); await new Promise<void>(resolve => { release = resolve; });
    }).catch(() => { if (!ended) setMessage('เปิดพื้นที่ทำงานเฉพาะเครื่องไม่ได้ / Could not lock the workspace'); });
    return () => { ended = true; controller.abort(); release?.(); };
  }, []);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const reload = async () => { setSnapshots(await offlineRows<OfflineSnapshot>('snapshots')); setRows(await offlineRows<OfflineEntry>('operations')); };
  useEffect(() => { void reload().catch(() => setMessage('เปิดข้อมูลในเครื่องไม่ได้ / Local storage unavailable')); }, []);
  const snapshot = eventId ? snapshots.find(item => item.event.id === eventId) : snapshots[0];
  const entries = rows.filter(row => row.eventId === snapshot?.event.id);
  const permitted = Boolean(exclusive && snapshot && offlineAuthorization() === snapshot.actor_id && Date.now() - Date.parse(snapshot.prepared_at) < 24*60*60*1000);
  const pending = entries.filter(row => (row.status === 'pending' || row.status === 'conflict'));
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setMessage('');
    try { await action(); await reload(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ / Could not save'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const saveSale = async (method: 'cash' | 'transfer') => {
    if (!snapshot || !permitted) throw new Error('เตรียมเครื่องขณะออนไลน์ก่อน / Prepare this device online first');
    const items = Object.entries(cart).filter(([,quantity]) => quantity>0).map(([product_id,quantity]) => { const product=snapshot.products.find(item => item.id===product_id)!; return { product_id,quantity,notes: '',name:product.name,unit_price:product.price,currency:product.currency }; });
    if (items.some(item => !Number.isInteger(item.quantity) || item.quantity>999) || (queue && (!Number.isInteger(Number(queue)) || Number(queue)<1))) throw new Error('จำนวนหรือหมายเลขคิวไม่ถูกต้อง / Invalid quantity or queue number');
    if (!items.length || !total.trim() || !Number.isFinite(Number(total)) || Number(total)<0) throw new Error('ตรวจสินค้าและยอดเงินจริง / Check items and actual amount');
    if (new Set(items.map(item => item.currency)).size !== 1) throw new Error('แยกบันทึกแต่ละสกุลเงิน / Record each currency separately');
    await enqueueOffline(snapshot, { kind: 'sale', items, currency:items[0].currency, collected_total: Number(total), method, queue_number: queue ? Number(queue) : null, service_date: snapshot.service_date, recorded_at: new Date().toISOString() });
    setCart({}); setTotal(''); setQueue(''); setMessage(th ? 'เก็บรายการในเครื่องแล้ว ยังไม่ได้ยืนยันกับระบบกลาง' : 'Saved on this device; not confirmed by the server yet.');
  };
  const queues = snapshot?.queues.map(ticket => {
    const changes = entries.filter(row => row.payload.queue_number === ticket.queue_number && row.payload.service_date === snapshot?.service_date && row.snapshotPreparedAt === snapshot.prepared_at).sort((a,b) => a.sequence-b.sequence);
    const last = changes[changes.length-1]?.payload;
    return { ...ticket, status: last?.kind === 'queue' ? last.status : last?.kind === 'sale' ? 'complete' : ticket.status };
  }) || [];
  useEffect(() => {
    if (!snapshot) return;
    const heartbeat = () => { void supabase.rpc('offline_device_heartbeat', { p_event_id: snapshot.event.id, p_device_id: snapshot.device_id, p_pending: pending.length>0 }); };
    heartbeat(); const timer = window.setInterval(heartbeat,20000);
    return () => window.clearInterval(timer);
  }, [snapshot, pending.length]);
  const loadRemote = async () => {
    const target=eventId || snapshot?.event.id;
    if (!target) return;
    const result=await supabase.from('offline_operations').select('id,payload,reason').eq('event_id',target).eq('status','conflict').order('created_at');
    if(result.error) throw new Error('โหลดรายการกลางไม่ได้ กรุณาเข้าสู่ระบบ / Sign in to load server records');
    setRemote(result.data || []);
    const receipts=await supabase.from('orders').select('id,created_at,total_price').eq('event_id',target).eq('status','completed').order('created_at',{ascending:false}).limit(100);
    if(receipts.error) throw new Error('โหลดประวัติขายไม่ได้ / Could not load sale history');
    setOrders(receipts.data || []);
  };
  const exportRecords = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ snapshot, operations: entries }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href=url; link.download='nireq-pending-records.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
  };
  return <main className="mx-auto max-w-5xl space-y-4 p-4">
    <Link to="/manage" className="text-pink-700 underline">{th ? 'กลับหน้าจัดการ' : 'Back to management'}</Link>
    <h1 className="text-2xl font-bold">{th ? 'ขายและคิวเมื่อเน็ตขาด' : 'Sales and queues during disconnection'}</h1>
    <p className="rounded-xl bg-amber-50 p-3 text-sm">{th ? 'เก็บรายการไว้บนเครื่องหลัก ข้อมูลสต็อกอาจล่าช้า การโอนไม่ได้ตรวจผ่านธนาคาร อย่าล้างข้อมูลเว็บหรือถอนแอปก่อนส่งรายการครบ' : 'Records stay on the primary device. Stock may be stale; bank transfers are not verified. Do not clear site data or uninstall before all records are synchronized.'}</p>
    {snapshots.length>0 && <select aria-label={th ? 'งานที่เตรียมไว้' : 'Prepared event'} value={eventId || snapshot?.event.id || ''} onChange={e => setEventId(e.target.value)} className="min-h-11 rounded border p-2">{snapshots.map(item => <option key={item.event.id} value={item.event.id}>{item.event.event_name}</option>)}</select>}
    <button disabled={busy || !eventId} onClick={() => void run(async () => { await prepareOffline(eventId); })} className="min-h-11 rounded-xl border px-4">{th ? 'เตรียมเครื่องนี้ขณะออนไลน์' : 'Prepare this device while online'}</button>
    {message.includes('Another device') && <button disabled={busy} className="min-h-11 rounded-xl border px-4" onClick={() => { if (window.confirm(th ? 'เจ้าของร้านเท่านั้น: แจ้งให้เครื่องเดิมหยุดทำงานก่อน รายการที่ยังอยู่เครื่องเดิมจะต้องตรวจแยกเมื่อส่งกลับ ยืนยันเปลี่ยนเครื่องหลักหรือไม่?' : 'Owner only: tell the old device to stop first. Its unsent records will require review when synchronized. Replace the primary device?')) void run(async () => { await prepareOffline(eventId,true); }); }}>{th ? 'เจ้าของเปลี่ยนเครื่องหลัก' : 'Owner: replace primary device'}</button>}
    {snapshot && <>
      {!permitted && <p role="status" className="text-amber-800">{th ? 'ต้องเตรียมเครื่องภายใน 24 ชั่วโมง และเปิดพื้นที่ทำงานนี้เพียงแท็บเดียว จึงบันทึกออฟไลน์ได้ รายการเดิมยังอยู่' : 'Recording requires preparation within 24 hours and one workspace tab. Existing records are preserved.'}</p>}
      {!snapshot.storagePersistent && <p className="text-sm text-amber-800">{th ? 'เบราว์เซอร์ไม่รับรองว่าจะเก็บข้อมูลไว้ถาวร ควรดาวน์โหลดสำเนารายการค้าง' : 'The browser has not granted persistent storage. Download a backup of pending records.'}</p>}
      <h2 className="text-xl font-bold">{snapshot.event.event_name}</h2>
      <p>{th ? 'ข้อมูลวันที่ ' : 'Prepared for '}{snapshot.service_date} · {pending.length} {th ? 'รายการรอตรวจ/ส่ง' : 'pending or needing review'}</p>
      <div className="flex flex-wrap gap-3"><button disabled={busy} onClick={() => void run(() => synchronizeOffline(snapshot))} className="min-h-11 rounded-xl bg-pink-600 px-4 text-white">{th ? 'ส่งรายการเมื่อเชื่อมต่อแล้ว' : 'Synchronize when connected'}</button><button onClick={exportRecords} className="min-h-11 rounded-xl border px-4">{th ? 'ดาวน์โหลดสำเนารายการ' : 'Download records backup'}</button><button disabled={busy || pending.length>0 || !permitted} className="min-h-11 rounded-xl border px-4" onClick={() => void run(async () => { const result=await supabase.rpc('release_offline_device',{p_event_id:snapshot.event.id,p_device_id:snapshot.device_id}); if(result.error) throw new Error('ยังส่งมอบเครื่องไม่ได้ ตรวจรายการค้างและการเชื่อมต่อ / Cannot release this device; check pending records and connection'); localStorage.removeItem('nireq-offline-authorized'); })}>{th ? 'เลิกใช้เครื่องนี้เป็นเครื่องหลัก' : 'Release this primary device'}</button></div>
      <section className="space-y-3 rounded-xl border p-4"><h2 className="font-bold">{th ? 'บันทึกเงินที่รับแล้ว' : 'Record money received'}</h2>
        <p className="text-sm">{th ? 'ตรวจยอดและโปรโมชั่นกับลูกค้าก่อนรับเงิน กรอกยอดที่รับจริง ระบบจะตรวจความตรงกันหลังเชื่อมต่อ' : 'Check prices and promotions with the buyer before collecting money. Enter the actual amount; the server checks it after reconnection.'}</p>
        {snapshot.products.map(product => <label key={product.id} className="flex items-center justify-between gap-3 border-b py-2">{product.name} · {product.price} {product.currency} · {product.is_unlimited ? (th ? 'ไม่จำกัด' : 'Unlimited') : `${th ? 'ยอดล่าสุด' : 'Last known stock'} ${Math.max(0,(product.stock_total || 0)-product.stock_reserved-product.stock_sold)}`}<input type="number" min="0" max="999" step="1" aria-label={product.name} value={cart[product.id] || 0} onChange={e => setCart(current => ({ ...current,[product.id]: Number(e.target.value) }))} className="min-h-11 w-20 rounded border p-2" /></label>)}
        <label className="block">{th ? 'ยอดรับจริง' : 'Actual amount collected'}<input type="number" min="0" step="0.01" value={total} onChange={e => setTotal(e.target.value)} className="ml-3 min-h-11 rounded border p-2" /></label>
        <label className="block">{th ? 'หมายเลขคิว ถ้ามี' : 'Queue number, if any'}<input type="number" min="1" step="1" value={queue} onChange={e => setQueue(e.target.value)} className="ml-3 min-h-11 rounded border p-2" /></label>
        <div className="flex gap-3">{(['cash','transfer'] as const).map(method => <button key={method} disabled={busy || !permitted} onClick={() => void run(() => saveSale(method))} className="min-h-11 rounded-xl border px-4">{method==='cash' ? (th ? 'รับเงินสดแล้ว' : 'Cash received') : (th ? 'ร้านตรวจรับเงินโอนแล้ว' : 'Transfer checked by staff')}</button>)}</div>
      </section>
      <section className="space-y-3"><h2 className="font-bold">{th ? 'คิวที่เครื่องรู้จัก' : 'Queues on this device'}</h2>
        {queues.map(ticket => <div key={ticket.id} className="flex flex-wrap items-center gap-3 rounded-xl border p-3"><span>#{ticket.queue_number} · {ticket.status}</span>{['calling','serving','complete','missed','waiting'].map(status => <button key={status} disabled={busy || !permitted || !({calling:['waiting','queued'],serving:['calling'],complete:['serving'],missed:['waiting','queued','calling'],waiting:['missed','expired','calling']} as Record<string,string[]>)[status].includes(ticket.status)} className="min-h-11 rounded-lg border px-3" onClick={() => void run(async () => { await enqueueOffline(snapshot,{ kind:'queue',queue_number:ticket.queue_number,expected_status:ticket.status,status,service_date:snapshot.service_date,recorded_at:new Date().toISOString() }); })}>{({calling:th?'เรียก':'Call',serving:th?'กำลังบริการ':'Serve',complete:th?'เสร็จแล้ว':'Complete',missed:th?'ไม่มา':'Missed',waiting:th?'กลับไปรอ':'Return to waiting'} as Record<string,string>)[status]}</button>)}</div>)}
      </section>
      <section className="space-y-2 rounded-xl border p-4"><h2 className="font-bold">{th ? 'บริการคิวที่ยังไม่อยู่ในเครื่องแล้ว' : 'Served a queue missing from this device'}</h2><p className="text-sm">{th ? 'ใช้หมายเลขจากหน้าลูกค้าเท่านั้น ไม่สร้างหมายเลขใหม่ ระบบจะเทียบคิวของวันงานนี้หลังเชื่อมต่อ' : 'Use the number on the customer screen. Do not issue a new number. The server matches this event day after reconnection.'}</p><input aria-label={th ? 'คิวที่ยังไม่อยู่ในเครื่อง' : 'Missing queue number'} type="number" min="1" step="1" value={queue} onChange={e => setQueue(e.target.value)} className="min-h-11 rounded border p-2" /><button disabled={busy || !permitted || !queue} className="min-h-11 rounded-lg border px-3" onClick={() => void run(async () => { if (!Number.isInteger(Number(queue)) || Number(queue)<1) throw new Error('Invalid queue number'); await enqueueOffline(snapshot,{kind:'queue',observed_queue:true,queue_number:Number(queue),expected_status:'waiting',status:'complete',service_date:snapshot.service_date,recorded_at:new Date().toISOString()}); setQueue(''); })}>{th ? 'บันทึกว่าบริการแล้ว' : 'Record as served'}</button></section>
      <section><h2 className="font-bold">{th ? 'รายการที่ยังไม่จบ' : 'Outstanding records'}</h2>{pending.map(row => <div key={row.id} className="my-2 rounded-xl border p-3">{row.sequence} · {row.payload.kind==='sale' ? `${row.payload.collected_total} ${row.payload.currency || ''} (${row.payload.method})` : `#${row.payload.queue_number} ${row.payload.status}`} · {row.status==='conflict' ? (th ? 'ต้องตรวจข้อมูลกับร้าน ยอดเงินจริงยังอยู่ครบ' : 'Needs review; the actual receipt is preserved') : (th ? 'รอส่ง' : 'Pending')}</div>)}</section>
    </>}
    <section className="space-y-3 border-t pt-4"><h2 className="font-bold">{th ? 'ตรวจรายการขัดแย้งกับระบบกลาง' : 'Reconcile server conflicts'}</h2><button disabled={busy} className="min-h-11 rounded-xl border px-4" onClick={() => void run(loadRemote)}>{th ? 'โหลดรายการที่ต้องตรวจ' : 'Load conflicts'}</button>
      {remote.map((row,index) => <div key={row.id} className="space-y-2 rounded-xl border p-3"><h3 className="font-semibold">{th ? 'รายการ ' : 'Record '}{index+1} · {row.payload.kind==='sale' ? `${row.payload.collected_total} ${row.payload.currency || ''}` : `#${row.payload.queue_number}`}</h3><p className="text-sm">{th ? 'เจ้าของหรือผู้จัดการ: แก้รายการขายหรือคิวให้ตรงก่อน แล้วบันทึกผล ห้ามเรียกเก็บเงินลูกค้าซ้ำ' : 'Owner or manager: reconcile the sale or queue first, then record the result. Do not charge the buyer again.'}</p>
        {row.payload.kind==='sale' && <><ul>{row.payload.items.map(item => <li key={item.product_id}>{item.name || (th ? 'สินค้า' : 'Item')} × {item.quantity}</li>)}</ul><select aria-label={th ? 'รายการขายที่ตรงกัน' : 'Matching completed sale'} className="min-h-11 max-w-full rounded border p-2" value={resolution[row.id]?.order || ''} onChange={e => setResolution(current=>({...current,[row.id]:{note:current[row.id]?.note || '',order:e.target.value}}))}><option value="">{th ? 'เลือกรายการขายที่บันทึกไว้แล้ว' : 'Choose an existing completed sale'}</option>{orders.map(order=><option key={order.id} value={order.id}>{new Date(order.created_at).toLocaleString()} · {order.total_price}</option>)}</select></>}
        <label className="block">{th ? 'ผลการตรวจ' : 'Reconciliation note'}<textarea maxLength={1000} value={resolution[row.id]?.note || ''} onChange={e=>setResolution(current=>({...current,[row.id]:{order:current[row.id]?.order || '',note:e.target.value}}))} className="block min-h-20 w-full rounded border p-2" /></label><button disabled={busy} className="min-h-11 rounded-xl border px-4" onClick={() => void run(async () => {const result=await supabase.rpc('resolve_offline_operation',{p_id:row.id,p_order_id:resolution[row.id]?.order || null,p_note:resolution[row.id]?.note || ''});if(result.error) throw new Error('ยังปิดรายการไม่ได้ ต้องมีสิทธิ์และข้อมูลตรงกับยอดเงินจริงและสินค้า / Cannot resolve: permission, actual amount and items must match'); await loadRemote(); if(snapshot) await synchronizeOffline(snapshot);})}>{th ? 'บันทึกว่าตรวจตรงกันแล้ว' : 'Confirm reconciliation'}</button></div>)}
    </section>
    {message && <p role="status" className="rounded-xl bg-amber-50 p-3">{message}</p>}
  </main>;
}
