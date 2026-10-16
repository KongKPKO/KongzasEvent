import { useState } from 'react';
import { useI18n } from '../../i18n';
import { type InventoryOverview, startStockTracking, stopStockTracking, assignProductionStock } from '../../lib/inventory';

export function InventoryBreakdown({ value, onChanged }: { value: InventoryOverview; onChanged: (message?: string) => Promise<void> }) {
  const { language } = useI18n(); const th = language === 'th';
  const [opening, setOpening] = useState(false); const [quantity, setQuantity] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const openingFree = Math.max((Number(quantity) || 0) - value.opening_committed, 0);
  const openingEarmark = Math.min(openingFree, value.production_shortfall);
  const isAssign = value.tracking;
  const pendingKey = `nireq-${isAssign ? 'production-assign' : 'tracking'}-pending-${value.product_id}`;
  let hasPending = false; let storageUnavailable = false;
  try { hasPending = Boolean(localStorage.getItem(pendingKey)); } catch { storageUnavailable = true; }
  const start = async () => {
    const count = Number(quantity);
    if (quantity === '' || !Number.isSafeInteger(count) || count < (isAssign ? 1 : 0)) { setError(isAssign ? (th ? 'กรอกจำนวนเต็มมากกว่า 0' : 'Enter a positive whole number.') : (th ? 'กรอกจำนวนของจริงเป็นจำนวนเต็มตั้งแต่ 0' : 'Enter a physical count of zero or more.')); return; }
    const request = requestId || crypto.randomUUID(); setRequestId(request); setBusy(true); setError('');
    try {
      localStorage.setItem(pendingKey, JSON.stringify({ request, count }));
      const result = isAssign ? await assignProductionStock(value.product_id, count, request) : await startStockTracking(value.product_id, count, request);
      localStorage.removeItem(pendingKey); setOpening(false); setRequestId(null);
      await onChanged(result ? (th ? `กันสินค้าเพิ่ม ${result.allocated} แล้ว` : `Earmarked ${result.allocated} additional units`) : (th ? 'เริ่มนับสต็อกแล้ว' : 'Stock tracking started'));
    } catch (cause) {
      const message = cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : String(cause);
      const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
      if (/^(22|23|42501|P0001)/.test(code) && !message.includes('stock_request_conflict')) { localStorage.removeItem(pendingKey); setRequestId(null); }
      setError(message.includes('finish_open_live_orders_before_tracking') ? (th ? 'มีออเดอร์หน้าบูธเดิมที่ยังค้างอยู่ กรุณาจบหรือยกเลิกออเดอร์เหล่านั้นก่อนเริ่มนับสต็อก พรีออเดอร์ยังนำมานับต่อได้' : 'Finish or cancel in-flight untracked live orders before starting tracking. Existing preorders can carry over.') : message.includes('insufficient_catalog_available_stock') ? (th ? 'ของพร้อมขายไม่พอสำหรับจำนวนที่เลือก กรุณาโหลดข้อมูลใหม่' : 'Not enough ready stock for this quantity. Reload the inventory.') : message.includes('opening_stock_below_commitments') ? (th ? 'จำนวนของไม่พอครอบคลุมยอดที่จัดสรรหรือจองไว้ กรุณาตรวจช่องทางขายก่อน' : 'Opening stock does not cover existing allocations/holds. Review sales channels first.') : (th ? `ยืนยันผลไม่ได้ กรุณาลองรายการเดิมอีกครั้ง: ${message}` : `Could not confirm. Retry the same count: ${message}`));
    } finally { setBusy(false); }
  };
  const openAction = () => {
    setError('');
    try {
      const pending = localStorage.getItem(pendingKey);
      if (pending) {
        const parsed = JSON.parse(pending) as { request?: unknown; count?: unknown };
        if (typeof parsed.request !== 'string' || typeof parsed.count !== 'number' || !Number.isSafeInteger(parsed.count)) throw new Error('invalid_pending_inventory_action');
        setRequestId(parsed.request); setQuantity(String(parsed.count));
      } else { setRequestId(null); setQuantity(isAssign ? String(Math.min(value.available || 0, value.production_shortfall)) : ''); }
      setOpening(true);
    } catch { setError(th ? 'อ่านรายการที่ค้างอยู่ไม่ได้ กรุณาติดต่อผู้ดูแลก่อนทำรายการใหม่' : 'Could not read the pending action. Contact support before starting another.'); }
  };
  const stats: Array<[string, number | null]> = [
    [th ? 'ของที่มีอยู่' : 'Physical on hand', value.physical_on_hand],
    [th ? 'ยังไม่จัดสรร' : 'Unallocated', value.available],
    [th ? 'ในช่องทางขาย (รวมจอง)' : 'In channels (including holds)', value.allocated],
    [th ? 'ขายจากสต็อก รอส่งมอบออนไลน์' : 'Stock sales awaiting online fulfillment', value.awaiting_fulfillment_stock],
    [th ? 'กันให้ออเดอร์รับสั่งผลิต / เดิม' : 'Earmarked for production / existing orders', value.production_earmarked],
    [value.tracking ? (th ? 'ยังขาดของ' : 'Production shortfall') : (th ? 'ยอดยืนยันรอเตรียมของ' : 'Confirmed units to prepare'), value.production_shortfall],
    [th ? 'รับสั่งผลิต รอชำระ/ตรวจสลิป' : 'Production awaiting payment/review', value.production_unpaid],
    [th ? 'ขาย / ของแถมสะสม' : 'Lifetime sold / gifts', value.sold], [th ? 'ส่งมอบสะสม (รวมของแถม)' : 'Lifetime fulfilled (including gifts)', value.fulfilled],
  ];
  return <div className="space-y-2 text-xs" onClick={event => event.stopPropagation()}>
    <div className="flex rounded-lg border bg-white p-1" aria-label={th ? 'การนับสต็อก' : 'Stock tracking'}>
      <button type="button" aria-pressed={!value.tracking} disabled={!value.tracking || value.tracking_locked || busy} onClick={() => {
        setBusy(true); setError('');
        void stopStockTracking(value.product_id).then(() => onChanged()).catch(() => setError(th ? 'เปลี่ยนการนับไม่สำเร็จ กรุณาโหลดข้อมูลใหม่' : 'Could not change tracking. Reload the inventory.')).finally(() => setBusy(false));
      }} className={`min-h-11 flex-1 rounded-md px-2 font-bold ${!value.tracking ? 'bg-pink-50 text-pink-700' : 'text-gray-400'}`}>{th ? 'ไม่นับสต็อก' : 'Do not track'}</button>
      <button type="button" aria-pressed={value.tracking} onClick={() => openAction()} disabled={value.tracking || value.open_live_orders > 0} className={`min-h-11 flex-1 rounded-md px-2 font-bold ${value.tracking ? 'bg-pink-50 text-pink-700' : 'text-gray-600'}`}>{th ? 'นับสต็อก' : 'Track stock'}</button>
    </div>
    {!value.tracking && value.open_live_orders > 0 && <p className="text-amber-900">{th ? `มีออเดอร์หน้าบูธค้าง ${value.open_live_orders} รายการ จบหรือยกเลิกก่อนเริ่มนับสต็อก` : `${value.open_live_orders} live orders are in flight. Finish or cancel them before starting tracking.`}</p>}
    {!value.tracking && <p className="text-gray-500">{th ? 'ไม่ตรวจจำนวนของจริง ขายได้ไม่จำกัดด้วยสต็อก' : 'Physical quantities are not tracked; no stock limit.'}</p>}
    {value.tracking && <p className="text-gray-500">{th ? 'เติมของด้วย “รับสินค้าเข้า” เมื่อจัดสรรแล้วจะปิดการนับไม่ได้' : 'Use Receive stock for new units. Tracking stays enabled after allocation.'}</p>}
    {(value.production_ordered > 0 || value.production_shortfall > 0) && <p className="rounded-lg bg-amber-50 p-2 font-bold text-amber-900">{th ? `กันให้รับสั่งผลิต ${value.production_earmarked} · ${value.tracking ? 'ยังขาด' : 'ยอดรอเตรียม'} ${value.production_shortfall} · รอชำระ/ตรวจ ${value.production_unpaid}` : `Production earmarked ${value.production_earmarked} · shortfall ${value.production_shortfall} · payment/review ${value.production_unpaid}`}</p>}
    {value.tracking && ((value.production_shortfall > 0 && (value.available || 0) > 0) || hasPending) && <button type="button" disabled={busy} onClick={openAction} className="min-h-11 rounded-lg border border-pink-200 px-3 font-bold text-pink-700">{hasPending ? (th ? 'ตรวจผลการกันสินค้าที่ค้างอยู่' : 'Retry pending earmark') : (th ? 'กันของพร้อมขายให้ยอดรอเตรียม' : 'Earmark existing ready stock')}</button>}
    <details><summary className="min-h-11 cursor-pointer py-3 font-bold text-pink-700">{th ? 'ดูจำนวนของและยอดรับสั่งผลิต' : 'Stock and production breakdown'}</summary>
      <dl className="space-y-1">{stats.map(([label, count]) => <div key={label} className="flex justify-between gap-2"><dt className="text-gray-600">{label}</dt><dd className="font-black">{count ?? '—'}</dd></div>)}</dl>
      <p className="my-2 text-[11px] text-gray-500">{th ? 'ยอดขายและส่งมอบเป็นประวัติสะสม ไม่รวมบวกกับของที่มีอยู่' : 'Lifetime sales and fulfillment are history; do not add them to physical stock.'}</p>
      <ul className="space-y-2 border-t pt-2">{value.channels.map(channel => <li key={`${channel.kind}-${channel.id}`}><strong>{channel.name}</strong><p>{th ? `จัดสรรรวมจอง ${channel.allocated} · จอง ${channel.held} · ตัดสต็อกแล้ว ${channel.sold}` : `Allocated incl. holds ${channel.allocated} · held ${channel.held} · consumed ${channel.sold}`}</p></li>)}</ul>
      <p className="mt-2 font-semibold">{th ? `รับสั่งผลิต / ยอดเดิม ${value.production_ordered} · ส่งมอบแล้ว ${value.production_fulfilled} · ค้างส่งมอบ ${Math.max(value.production_ordered-value.production_fulfilled,0)}` : `Production ordered ${value.production_ordered} · fulfilled ${value.production_fulfilled} · outstanding ${Math.max(value.production_ordered-value.production_fulfilled,0)}`}</p>
      {(value.recent_events || []).length > 0 && <div className="mt-3 border-t pt-2"><strong>{th ? 'การจัดสรรและส่งมอบล่าสุด' : 'Recent allocation / fulfillment'}</strong><ol className="mt-2 space-y-2">{value.recent_events.map((event,index) => <li key={`${event.created_at}-${index}`}><time>{new Date(event.created_at).toLocaleString(th ? 'th-TH' : 'en-GB')}</time><p>{({ production_earmark: th ? 'กันของรับสั่งผลิต' : 'Production earmark', production_fulfilled: th ? 'ส่งมอบรับสั่งผลิต' : 'Production fulfilled', event_products_allocation: th ? 'จัดสรรอีเวนต์' : 'Event allocation', online_campaign_products_allocation: th ? 'จัดสรรออนไลน์' : 'Campaign allocation' } as Record<string,string>)[event.kind] || event.kind}: {event.quantity_before} → {event.quantity_after}</p></li>)}</ol></div>}
    </details>
    {opening && <section className="space-y-2 rounded-lg border border-pink-200 bg-pink-50 p-3" aria-label={isAssign ? (th ? 'กันของพร้อมขาย' : 'Earmark ready stock') : (th ? 'เริ่มนับสต็อก' : 'Opening physical count')}>
      <label className="block font-bold">{isAssign ? (th ? 'จำนวนสูงสุดที่จะกันจากของพร้อมขาย' : 'Maximum ready units to earmark') : (th ? 'จำนวนของจริงที่มีอยู่ตอนนี้' : 'Physical units present now')}<input type="number" min={isAssign ? 1 : 0} step="1" value={quantity} disabled={busy || requestId != null} onChange={event => setQuantity(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border px-2" /></label>
      {isAssign && requestId ? <p>{th ? 'ตรวจผลรายการเดิมด้วยรหัสเดิม ระบบจะไม่กันสินค้าซ้ำ' : 'Confirming the original request; units will not be earmarked twice.'}</p> : isAssign ? <p>{th ? `จะกันเพิ่มไม่เกิน ${Math.min(Number(quantity)||0,value.production_shortfall)} จากของพร้อมขาย ${value.available} เหลือ ${Math.max((value.available||0)-Math.min(Number(quantity)||0,value.production_shortfall),0)} ระบบตรวจยอดใหม่ก่อนบันทึก` : `Earmark up to ${Math.min(Number(quantity)||0,value.production_shortfall)} from ${value.available} ready units; remaining ${Math.max((value.available||0)-Math.min(Number(quantity)||0,value.production_shortfall),0)}. Rechecked at save.`}</p> : <>
      <p>{th ? `กันให้การจัดสรร/จองเดิม ${value.opening_committed} · จะกันให้ยอดยืนยันเดิม ${openingEarmark} · เหลือพร้อมจัดสรร ${openingFree-openingEarmark} · ยังขาด ${value.production_shortfall-openingEarmark}` : `Existing allocation/holds ${value.opening_committed} · Earmark ${openingEarmark} · available to allocate ${openingFree-openingEarmark} · shortfall ${value.production_shortfall-openingEarmark}`}</p>
      <p>{th ? 'ระบบจะหยุดขายไม่จำกัดจากคลังในช่องทางเดิม ยอดรับสั่งผลิตยังแยกตามที่ตั้งไว้ ตรวจและจัดสรรจำนวนขายต่อหลังยืนยัน' : 'Existing unlimited stock allocations become finite. Production policies stay independent. Review channel allocations after confirming.'}</p>
      </>}

      <button type="button" disabled={busy} onClick={() => void start()} className="min-h-11 rounded-lg bg-pink-600 px-3 font-bold text-white">{isAssign ? (th ? 'ยืนยันกันสินค้า' : 'Confirm earmark') : (th ? 'ยืนยันเริ่มนับสต็อก' : 'Confirm opening count')}</button>
      <button type="button" disabled={busy} onClick={() => setOpening(false)} className="min-h-11 px-3">{th ? 'ปิด' : 'Close'}</button>
    </section>}
    {storageUnavailable && <p role="alert" className="text-red-700">{th ? 'เบราว์เซอร์ไม่อนุญาตให้เก็บรหัสรายการ กรุณาเปิดการจัดเก็บข้อมูลก่อนปรับสต็อก' : 'Browser storage is unavailable. Enable it before adjusting inventory.'}</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
  </div>;
}
