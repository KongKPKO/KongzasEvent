import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useI18n } from '../i18n';

type History = {
  can_resend: boolean;
  created_at: string | null; submitted_at: string | null; confirmed_at: string | null;
  rejected_at: string | null; shipped_at: string | null; picked_up_at: string | null;
  deliveries: Array<{notification_event: string; status: string; attempts: number; created_at: string; claimed_at: string; delivered_at: string | null}>;
  resends: Array<{id: string; actor_id: string; status: string; created_at: string; finished_at: string | null}>;
};

export default function AdminOrderHistory({orderId,reason,onForbidden}: {orderId:string;reason:string;onForbidden:()=>void}) {
  const {language,dateLocale} = useI18n();
  const tr = (th:string,en:string) => language==='th'?th:en;
  const [history,setHistory] = useState<History | null>(null);
  const [sendReason,setSendReason] = useState('');
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState('');
  const active = useRef(true);
  const sending = useRef(false);
  const attempt = useRef<{id:string;reason:string} | null>(null);
  useEffect(()=>{active.current=true; return ()=>{active.current=false;};},[]);
  const date = (v:string | null) => v ? new Intl.DateTimeFormat(dateLocale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(v)) : tr('ไม่ได้บันทึก','Not recorded');
  const label = (status:string) => ({accepted:tr('ผู้ให้บริการรับคำขอส่งแล้ว','Provider accepted'),delivered:tr('ระบบบันทึกว่าส่งสำเร็จ','Recorded as sent'),failed:tr('ส่งไม่สำเร็จ','Failed'),sending:tr('กำลังส่ง / ยังไม่ยืนยันผล','Sending / unconfirmed'),unknown:tr('ยังยืนยันผลไม่ได้ อาจส่งถึงแล้ว','Unknown — may have been sent')}[status] || status);
  const eventLabel = (event:string) => ({created:tr('รับออเดอร์','Order received'),submitted:tr('รับหลักฐานชำระเงิน','Evidence received'),confirmed:tr('ยืนยันเงิน','Payment confirmed'),rejected:tr('ปฏิเสธหลักฐาน','Evidence rejected'),ready_for_pickup:tr('พร้อมรับสินค้า','Ready for pickup'),shipped:tr('จัดส่งแล้ว','Shipped'),payment_rejected:tr('ปฏิเสธหลักฐาน','Evidence rejected'),refund_required:tr('ต้องคืนเงิน','Refund required')}[event] || event);
  async function load() {
    const {data,error} = await supabase.rpc('admin_support_history',{p_order_id:orderId,p_reason:reason});
    if (!active.current) return;
    if (error) {
      setHistory(null);
      if (/forbidden|permission denied|JWT/i.test(error.message)) onForbidden();
      throw new Error('history_failed');
    }
    setHistory(data as History | null);
  }
  async function openHistory() {
    setBusy(true); setNotice('');
    try {await load();} catch {if(active.current)setNotice(tr('โหลดประวัติไม่สำเร็จ ลองอีกครั้ง','Could not load history. Try again.'));}
    finally {if(active.current)setBusy(false);}
  }
  async function resend() {
    if (sending.current || sendReason.trim().length<5) return;
    if (!attempt.current && !window.confirm(tr('ส่งลิงก์สถานะไปยังอีเมลเดิมของลูกค้าอีกครั้ง? ลูกค้าอาจได้รับอีเมลซ้ำ แม้ครั้งก่อนส่งสำเร็จแล้ว','Resend the status link to the saved customer email? The customer may receive a duplicate even if the previous send succeeded.'))) return;
    sending.current=true; setBusy(true); setNotice('');
    attempt.current ||= {id:crypto.randomUUID(),reason:sendReason.trim()};
    try {
      const {data,error} = await supabase.functions.invoke('admin-resend-order-link',{body:{order_id:orderId,request_id:attempt.current.id,reason:attempt.current.reason}});
      if (!active.current) return;
      if (error) {
        const response = (error as {context?:Response}).context;
        const body = await response?.json().catch(()=>null);
        if (!active.current) return;
        if (response?.status===403 || response?.status===401) {onForbidden();return;}
        if (body?.error==='cooldown') {attempt.current=null;setNotice(tr('เพิ่งส่งคำขอไป กรุณารออย่างน้อย 1 นาทีต่อออเดอร์','Please wait at least one minute between sends for this order.'));}
        else setNotice(tr('ยังยืนยันผลไม่ได้ กดตรวจคำขอเดิมได้โดยไม่ส่งซ้ำ','Outcome unknown. Check the same request without sending again.'));
      } else {
        attempt.current=null;
        setNotice(label(data.status));
      }
      await load();
    } catch {if(active.current)setNotice(tr('ตรวจผลไม่สำเร็จ กรุณาลองตรวจอีกครั้ง','Could not check the result. Try again.'));}
    finally {sending.current=false;if(active.current)setBusy(false);}
  }
  const button='min-h-11 rounded-xl border border-pink-200 px-4 py-2 text-sm font-bold text-pink-700 disabled:opacity-40';
  return <section aria-label={tr('ประวัติและอีเมล','History and email')} className="space-y-3 border-t pt-5">
    <button className={button} disabled={busy} onClick={()=>void openHistory()}>{tr('ดู / รีเฟรชประวัติและอีเมล','View / refresh history and email')}</button>
    {notice && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{notice}</p>}
    {history && <>
      <h3 className="font-bold">{tr('เวลาที่ระบบบันทึกไว้','Recorded milestones')}</h3>
      <p className="text-xs text-gray-500">{tr('ไม่ใช่ประวัติการเปลี่ยนแปลงทั้งหมด ข้อมูลที่ไม่ได้บันทึกจะไม่ถูกสร้างย้อนหลัง','Not a complete change history. Missing events are not reconstructed.')}</p>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">{([
        ['created_at',tr('สร้างออเดอร์','Order created')],['submitted_at',tr('ส่งหลักฐาน','Evidence submitted')],['confirmed_at',tr('ยืนยันเงิน','Payment confirmed')],['rejected_at',tr('ปฏิเสธหลักฐาน','Evidence rejected')],['shipped_at',tr('จัดส่ง','Shipped')],['picked_up_at',tr('รับสินค้า','Picked up')],
      ] as const).map(([key,title])=><div key={key}><dt className="text-gray-500">{title}</dt><dd>{date(history[key])}</dd></div>)}</dl>
      <h3 className="font-bold">{tr('การส่งอีเมล (ล่าสุดอย่างละ 25 รายการ)','Email delivery (latest 25 per list)')}</h3>
      <p className="text-xs text-gray-500">{tr('ส่งสำเร็จไม่ได้ยืนยันว่าเข้ากล่องจดหมายหรือถูกอ่านแล้ว','A successful send does not prove inbox delivery or that it was read.')}</p>
      <ul className="divide-y text-sm">{history.deliveries.map((d,i)=><li key={i} className="py-2">{eventLabel(d.notification_event)} · {label(d.status)} · {d.attempts} {tr('ครั้ง','attempts')}<p>{date(d.delivered_at || d.claimed_at)}</p></li>)}</ul>
      <ul className="divide-y text-sm">{history.resends.map(d=><li key={d.id} className="break-words py-2">{tr('Admin ส่งลิงก์ซ้ำ','Admin link resend')} · {label(d.status)}<p>{date(d.created_at)}</p><p className="text-xs text-gray-500">Admin ID: {d.actor_id}</p></li>)}</ul>
      {!history.deliveries.length && !history.resends.length && <p>{tr('ไม่มีประวัติอีเมลที่บันทึกไว้','No recorded email history')}</p>}
      {history.can_resend ? <div className="space-y-2 rounded-xl bg-gray-50 p-4">
        <label className="block text-sm font-bold">{tr('เหตุผลที่ส่งอีเมลซ้ำ','Reason for resending email')}<textarea className="mt-1 min-h-20 w-full rounded-xl border border-gray-300 bg-white p-3" minLength={5} maxLength={500} disabled={busy || !!attempt.current} value={sendReason} onChange={e=>setSendReason(e.target.value)} /></label>
        <p className="text-xs text-gray-500">{tr('5–500 ตัวอักษร · ส่งไปอีเมลเดิมเท่านั้น · เว้นอย่างน้อย 1 นาที · ไม่เปลี่ยนเงินหรือสต็อก','5–500 characters · Saved email only · One-minute interval · No money or stock changes')}</p>
        <button className={button} disabled={busy || sendReason.trim().length<5} onClick={()=>void resend()}>{attempt.current ? tr('ตรวจคำขอเดิม','Check same request') : tr('ส่งลิงก์สถานะออเดอร์อีกครั้ง','Resend order status link')}</button>
      </div> : <p>{tr('ออเดอร์นี้ไม่รองรับการส่งลิงก์ หรือไม่มีอีเมลลูกค้า','This order does not support email links or has no saved email.')}</p>}
    </>}
  </section>;
}
