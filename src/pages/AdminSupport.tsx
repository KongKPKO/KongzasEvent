import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Search, ShieldCheck } from 'lucide-react';
import { LanguageToggle, useI18n } from '../i18n';
import { supabase } from '../supabaseClient';
import { openSupport, searchSupport, type SupportDetail, type SupportSearch } from '../lib/adminSupport';
import { formatPrice } from '../utils/currency';

export default function AdminSupport() {
  const { language, dateLocale } = useI18n();
  const th = language === 'th';
  const tr = (thai: string, english: string) => th ? thai : english;
  const [access, setAccess] = useState<'loading' | 'allowed' | 'denied' | 'error'>('loading');
  const [kind, setKind] = useState<'stores' | 'orders'>('stores');
  const [query, setQuery] = useState('');
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState<{id: string; name: string} | null>(null);
  const [results, setResults] = useState<SupportSearch | null>(null);
  const [detail, setDetail] = useState<SupportDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'request' | 'missing' | null>(null);
  const sequence = useRef(0);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const request = sequence.current;
      const { data, error: failure } = await supabase.rpc('is_platform_admin');
      if (alive && request === sequence.current) setAccess(failure ? 'error' : data ? 'allowed' : 'denied');
    };
    void check();
    const { data: auth } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' || event === 'USER_UPDATED' || event === 'SIGNED_IN') {
        sequence.current++; setDetail(null); setResults(null); setReason(''); setScope(null);
        setAccess('denied'); setBusy(false);
      }
    });
    return () => { alive = false; sequence.current++; auth.subscription.unsubscribe(); };
  }, []);
  const clear = () => { sequence.current++; setDetail(null); setResults(null); setError(null); setBusy(false); };
  const run = async (task: () => Promise<SupportSearch | SupportDetail | null>, isSearch: boolean) => {
    const id = ++sequence.current;
    setDetail(null); setError(null); setBusy(true);
    if (isSearch) setResults(null);
    try {
      const data = await task();
      if (id !== sequence.current) return;
      if (!data) setError('missing');
      else if ('results' in data) setResults(data);
      else setDetail(data);
    } catch (failure) {
      if (id !== sequence.current) return;
      const message = (failure as {message?: string}).message || '';
      if (/forbidden|permission denied|JWT|token.*expired/i.test(message)) {
        setAccess('denied'); setResults(null); setScope(null); setReason('');
      } else setError('request');
    } finally { if (id === sequence.current) setBusy(false); }
  };
  const missing = tr('ไม่ได้บันทึก', 'Not recorded');
  const date = (value?: string | null) => value && !Number.isNaN(Date.parse(value))
    ? new Intl.DateTimeFormat(dateLocale, {dateStyle:'medium', timeStyle:'short'}).format(new Date(value)) : missing;
  const money = (value: number | null, currency: string | null) => value == null || !currency ? missing : formatPrice(value,currency);
  const status = (value?: string | null) => {
    if (!value) return missing;
    const labels: Record<string, [string,string]> = {
      awaiting_payment:['รอชำระเงิน','Awaiting payment'], payment_submitted:['รอตรวจหลักฐาน','Evidence submitted'],
      payment_confirmed:['ยืนยันเงินแล้ว','Payment confirmed'], payment_rejected:['ปฏิเสธหลักฐาน','Evidence rejected'],
      payment_expired:['หมดเวลาชำระ','Payment expired'], payment_cancelled:['ยกเลิกการชำระ','Payment cancelled'],
      payment_submitted_late:['แจ้งโอนล่าช้า','Late payment reported'], refund_pending:['รอคืนเงิน','Refund pending'], refunded:['คืนเงินแล้ว','Refunded'],
      awaiting_shipment:['รอจัดส่ง','Awaiting shipment'], shipped:['จัดส่งแล้ว','Shipped'], awaiting_pickup:['รอรับสินค้า','Awaiting pickup'],
      picked_up:['รับสินค้าแล้ว','Picked up'], cancelled:['ยกเลิก','Cancelled'], expired:['หมดอายุ','Expired'], not_required:['ไม่ต้องดำเนินการ','Not required'],
      pending:['รอดำเนินการ','Pending'], completed:['เสร็จสิ้น','Completed'], paid:['ชำระแล้ว','Paid'], confirmed:['ยืนยันแล้ว','Confirmed'],
      draft:['ฉบับร่าง','Draft'], published:['เผยแพร่','Published'], archived:['เก็บแล้ว','Archived'],
      shipping:['จัดส่ง','Shipping'], pickup:['รับเอง','Pickup'], preorder:['พรีออเดอร์','Pre-order'], post_event:['หลังงาน','Post-order'],
      online_sale:['ขายออนไลน์','Online sale'], pos_walkin:['ขายหน้าร้าน','POS walk-in'], live_queue:['คิววันงาน','Live queue'],
    };
    return labels[value.toLowerCase()]?.[th ? 0 : 1] || value;
  };
  const field = (label: string, value: string | null | undefined) => <div className="min-w-0"><dt className="text-xs font-bold text-gray-500">{label}</dt><dd className="mt-1 break-words font-semibold text-gray-900">{value || missing}</dd></div>;
  const button = 'min-h-11 rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold disabled:opacity-40 focus-visible:outline-pink-600';
  const input = 'min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 focus-visible:outline-pink-600';
  return <div className="min-h-screen bg-gray-50 px-4 py-6 text-gray-900"><div className="mx-auto max-w-6xl space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wider text-pink-600">Platform Admin</p><h1 className="mt-1 text-2xl font-black">{tr('ช่วยเหลือร้าน','Store support')}</h1></div><nav className="flex flex-wrap items-center gap-2"><Link className={button} to="/admin/applications">{tr('ใบสมัคร','Applications')}</Link><Link className={button} to="/manage-login">{tr('กลับ','Back')}</Link><LanguageToggle /></nav></header>
    <p className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><ShieldCheck size={20} className="shrink-0" />{tr('อ่านอย่างเดียว — การค้นหาและเปิดรายละเอียดจะถูกบันทึก ไม่แก้เงินหรือสต็อก','Read-only — searches and detail access are logged. Money and stock are not changed.')}</p>
    {access === 'loading' ? <p role="status">{tr('กำลังตรวจสิทธิ์…','Checking access…')}</p> : access !== 'allowed' ? <section className="rounded-2xl border bg-white p-6"><h2 className="font-bold">{access === 'error' ? tr('ตรวจสิทธิ์ไม่สำเร็จ','Could not check access') : tr('เฉพาะ Platform Admin','Platform Admin access required')}</h2><p className="mt-2">{tr('กรุณาเข้าสู่ระบบด้วยบัญชี Admin หรือโหลดหน้าใหม่เพื่อลองอีกครั้ง','Sign in with an Admin account or reload to try again.')}</p><Link className="mt-4 inline-block text-pink-700 underline" to="/manage-login?redirect=/admin/support">{tr('เข้าสู่ระบบ','Sign in')}</Link></section> : <>
      <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <form onSubmit={(event) => {event.preventDefault(); void run(() => searchSupport(kind,query,scope?.id),true);}} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[160px_1fr_auto]"><label className="text-sm font-bold">{tr('ค้นหา','Search for')}<select className={input} value={kind} onChange={(event) => {clear(); setKind(event.target.value as typeof kind); setQuery(''); setScope(null);}}><option value="stores">{tr('ร้านค้า','Stores')}</option><option value="orders">{tr('ออเดอร์','Orders')}</option></select></label><label className="text-sm font-bold">{kind === 'stores' ? tr('ชื่อร้าน / URL ร้าน / อีเมลร้าน','Store name / slug / email') : tr('เลขออเดอร์เต็ม / รหัสรับสินค้า / UUID','Exact order code / pickup code / UUID')}<input className={input} required minLength={2} maxLength={100} value={query} onChange={(event) => {clear(); setQuery(event.target.value);}} /></label><button className={`${button} flex items-center justify-center gap-2 self-end bg-pink-600 text-white`} disabled={busy || query.trim().length<2}><Search size={16}/>{tr('ค้นหา','Search')}</button></div>
          {scope && <p className="text-sm">{tr('เฉพาะร้าน','Store filter')}: {scope.name} <button type="button" className="ml-2 min-h-11 text-pink-700 underline" onClick={() => {clear(); setScope(null);}}>{tr('ล้าง','Clear')}</button></p>}
        </form>
        <label className="mt-4 block text-sm font-bold">{tr('เหตุผลที่เปิดรายละเอียด (5–500 ตัวอักษร)','Reason for detail access (5–500 characters)')}<input className={`${input} mt-1`} value={reason} maxLength={500} onChange={(event) => {sequence.current++; setBusy(false); setDetail(null); setReason(event.target.value);}} placeholder={tr('เช่น ร้านแจ้งว่าออเดอร์ค้างรอตรวจเงิน','Example: merchant reported an order stuck in payment review')} /></label>
        <p className="mt-2 text-xs text-gray-500">{tr('ไม่ต้องใส่ข้อมูลส่วนตัวลูกค้าในเหตุผล ผลค้นหาไม่เกิน 25 รายการ','Do not include customer personal data in the reason. Up to 25 search results.')}</p>
      </section>
      {busy && <p role="status" className="flex gap-2"><Loader2 className="animate-spin" size={18}/>{tr('กำลังโหลด…','Loading…')}</p>}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error === 'missing' ? tr('ไม่พบข้อมูลนี้แล้ว กรุณาค้นหาใหม่','Record not found. Search again.') : tr('โหลดไม่สำเร็จ กรุณากดค้นหาหรือเปิดรายละเอียดอีกครั้ง','Could not load. Search or open the detail again.')}</p>}
      {!results && !busy && !error && <p className="text-gray-500">{tr('เริ่มจากค้นหาร้านหรือเลขออเดอร์ที่แจ้งปัญหา','Start with the store or order code reported to support.')}</p>}
      {results && <section aria-label={tr('ผลค้นหา','Search results')} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <h2 className="border-b px-4 py-3 font-bold">{tr('ผลค้นหา','Search results')} ({results.results.length})</h2>
        {results.limited && <p className="bg-amber-50 p-3 text-sm">{tr('แสดงสูงสุด 25 รายการ กรุณาระบุคำค้นให้เจาะจงขึ้น','Showing at most 25 results. Refine your search.')}</p>}
        {!results.results.length && <p className="p-4">{tr('ไม่พบรายการที่ตรงกัน','No matching records')}</p>}
        <ul className="divide-y">{results.results.map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="min-w-0 flex-1 break-words"><h3 className="font-bold">{row.name || row.code || row.id}</h3><p className="text-sm text-gray-500">{row.slug ? `/${row.slug}` : `${row.store_name} · ${row.channel_name}`}</p>{row.status && <p className="text-sm">{status(row.status)} · {date(row.created_at)}</p>}</div><button type="button" className={button} disabled={busy || reason.trim().length<5} onClick={() => void run(() => openSupport(kind === 'stores' ? 'store' : 'order',row.id,reason,scope?.id),false)}>{tr('ดูรายละเอียด','View details')}</button></li>)}</ul>
      </section>}
      {detail && <section aria-label={tr('รายละเอียด','Details')} className="space-y-5 rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
        {detail.kind === 'store' ? <><h2 className="text-xl font-black">{detail.name}</h2><dl className="grid gap-3 sm:grid-cols-3">{field('URL',`/${detail.slug}`)}{field(tr('เผยแพร่','Public'),detail.is_public ? tr('ใช่','Yes') : tr('ไม่','No'))}{field(tr('ตรวจสอบแล้ว','Verified'),detail.is_verified ? tr('ใช่','Yes') : tr('ไม่','No'))}</dl><button className={button} onClick={() => {setScope({id:detail.id,name:detail.name}); setKind('orders'); setQuery(''); clear();}}>{tr('ค้นหาออเดอร์ของร้านนี้','Search this store’s orders')}</button>
          {(['events','campaigns'] as const).map(key => <div key={key}><h3 className="font-bold">{key === 'events' ? tr('อีเวนต์ล่าสุด (สูงสุด 25)','Recent Events (up to 25)') : tr('แคมเปญล่าสุด (สูงสุด 25)','Recent Campaigns (up to 25)')}</h3><ul className="mt-2 divide-y">{detail[key].map(channel => <li key={channel.id} className="py-3"><p className="font-semibold">{channel.name} · {status(channel.status)}</p><p className="text-sm text-gray-500">{date(channel.starts_at)} — {date(channel.ends_at)}</p></li>)}</ul>{!detail[key].length && <p className="text-gray-500">{tr('ไม่มีรายการ','No records')}</p>}</div>)}</> : <>
          <h2 className="break-all text-xl font-black">{detail.code || detail.id}</h2><p>{detail.store_name} · {detail.channel_name} · {status(detail.order_type)}</p>
          <dl className="grid gap-4 sm:grid-cols-3">{field(tr('สถานะออเดอร์','Order status'),status(detail.status))}{field(tr('สร้างเมื่อ','Created'),date(detail.created_at))}{field(tr('ลูกค้า','Customer'),detail.customer_name)}{field(tr('อีเมล (ปกปิด)','Email (masked)'),detail.customer_email_masked)}{field(tr('โทรศัพท์ (ปกปิด)','Phone (masked)'),detail.customer_phone_masked)}{field(tr('สถานะชำระเงิน','Payment status'),status(detail.payment_status))}{field(tr('ส่งหลักฐานเมื่อ','Evidence submitted'),date(detail.submitted_at))}</dl>
          {['online_sale','preorder','post_event'].includes(detail.order_type) && <div className="rounded-xl bg-amber-50 p-4"><dl className="grid gap-3 sm:grid-cols-2">{field(tr('กำหนด hold ที่บันทึกไว้','Recorded hold deadline'),date(detail.stock_hold_expires_at))}{field(tr('กำหนดผ่อนผันอัปโหลด','Upload grace deadline'),date(detail.upload_grace_expires_at))}</dl>{detail.payment_status === 'awaiting_payment' && detail.stock_hold_expires_at && Date.parse(detail.stock_hold_expires_at)<Date.now() && <p role="status" className="mt-3 text-sm font-bold">{tr('เลยกำหนดแล้ว แต่สถานะยังรอชำระ — ไม่ใช่หลักฐานว่าคืนสต็อกแล้ว','Deadline elapsed, still awaiting payment — this does not prove stock was released.')}</p>}</div>}
          <div><h3 className="font-bold">{tr('สินค้าและของแถมในออเดอร์','Order purchases and gifts')}</h3><ul className="mt-2 divide-y">{detail.items.map(item => <li key={item.id} className="flex flex-wrap justify-between gap-2 py-3"><span className="min-w-0 break-words">{item.name || missing} × {item.quantity} <small className="block text-gray-500">{item.line_type === 'promotion_reward' ? tr('ของแถม','Free gift') : tr('สินค้า','Purchase')} · {item.sku || missing}</small></span><span>{money(item.price_per_unit,item.currency || detail.currency)} / {tr('ชิ้น','unit')}</span></li>)}</ul></div>
          <dl className="grid gap-4 rounded-xl bg-gray-50 p-4 sm:grid-cols-4">{field(tr('ยอดสินค้า','Subtotal'),money(detail.subtotal_price,detail.currency))}{field(tr('ส่วนลด','Discount'),money(detail.discount_total,detail.currency))}{field(tr('ค่าส่ง','Shipping fee'),money(detail.shipping_fee,detail.currency))}{field(tr('ยอดรวมที่บันทึกไว้','Saved total'),money(detail.total_price,detail.currency))}</dl>
          <dl className="grid gap-4 sm:grid-cols-3">{field(tr('การรับสินค้า','Fulfillment'),status(detail.fulfillment_method))}{field(tr('สถานะรับสินค้า','Fulfillment status'),status(detail.fulfillment_status))}{field(tr('ขนส่ง','Carrier'),detail.shipping_carrier)}{field(tr('เลขติดตาม','Tracking number'),detail.tracking_number)}{field(tr('ส่งเมื่อ','Shipped'),date(detail.shipped_at))}{field(tr('รับสินค้าเมื่อ','Picked up'),date(detail.picked_up_at))}{field(tr('จุดรับสินค้า','Pickup point'),detail.pickup_name)}{field(tr('เริ่มรับสินค้า','Pickup starts'),date(detail.pickup_starts_at))}{field(tr('สิ้นสุดรับสินค้า','Pickup ends'),date(detail.pickup_ends_at))}</dl>
        </>}
      </section>}
    </>}
  </div></div>;
}
