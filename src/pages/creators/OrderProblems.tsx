import { useCallback, useEffect, useRef, useState } from 'react';
import AdminHeader from '../../components/AdminHeader';
import OrderProblemForm from '../../components/OrderProblemForm';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n';
import type { ActorContext } from '../../types/access';

interface Problem {
  id: string; order_id: string; category: string; description: string; contact: string;
  image_paths: string[]; status: 'open' | 'resolved'; resolution: string | null;
  created_at: string; notification_status: string; source: string;
  orders: { pickup_code: string | null } | null;
}
export default function OrderProblems({ actorContext }: { actorContext: ActorContext }) {
  const { language } = useI18n(), th = language === 'th';
  const [reports, setReports] = useState<Problem[]>([]);
  const [status, setStatus] = useState('open');
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const previewDialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => { if (preview) previewDialog.current?.showModal(); }, [preview]);
  const [orderCode, setOrderCode] = useState('');
  const [orderId, setOrderId] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    const result = await supabase.from('order_problem_reports').select('id,order_id,category,description,contact,image_paths,status,resolution,created_at,notification_status,source,orders(pickup_code)')
      .eq('artist_id', actorContext.artist_id).eq('status', status).order('created_at', { ascending: false }).limit(limit).returns<Problem[]>();
    if (result.error) setError(th ? 'โหลดรายการไม่ได้ กรุณาลองใหม่' : 'Could not load reports. Please retry.');
    else { setReports(result.data || []); setError(''); }
    setLoading(false);
  }, [actorContext.artist_id, status, limit, th]);
  useEffect(() => { void load(); }, [load]);
  const resolve = async (report: Problem) => {
    if (busy) return;
    setBusy(report.id);
    const result = await supabase.rpc('resolve_order_problem', { p_id: report.id, p_resolution: notes[report.id] || '', p_reopen: report.status === 'resolved' });
    if (result.error) setError(th ? 'บันทึกไม่ได้ กรุณาระบุผลการจัดการและลองใหม่' : 'Could not save. Enter a resolution and retry.');
    else await load();
    setBusy(null);
  };
  const openImage = async (path: string) => {
    const result = await supabase.storage.from('PaymentEvidence').createSignedUrl(path, 300);
    if (result.error) setError(th ? 'เปิดรูปไม่ได้ กรุณาลองใหม่' : 'Could not open the image. Retry.');
    else setPreview(result.data.signedUrl);
  };
  return <div className="min-h-screen bg-pink-50/30">
    <AdminHeader activePage="problems" actorRole={actorContext.role} userEmail={actorContext.member_email} />
    <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-gray-900">{th ? 'ปัญหาออเดอร์' : 'Order problems'}</h1>
      <p className="text-sm text-gray-600">{th ? 'ติดต่อผู้ซื้อภายนอกระบบ แล้วบันทึกผลที่ตกลงกัน รายการที่ยังไม่จบจะพักการลบข้อมูลที่เกี่ยวข้อง' : 'Contact the buyer outside NireQ, then record the agreed solution. Open reports pause deletion of related data.'}</p>
      <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-semibold">{th ? 'บันทึกปัญหาที่รับจากช่องทางอื่น' : 'Record a problem received elsewhere'}</summary>
        <form className="my-3 flex flex-wrap gap-2" onSubmit={async e => {
          e.preventDefault(); setOrderId(null);
          const result = await supabase.rpc('find_order_for_problem', { p_artist_id: actorContext.artist_id, p_code: orderCode });
          if (result.error) setError(th ? 'ไม่พบออเดอร์ในร้านนี้' : 'Order not found in this shop.'); else { setOrderId(result.data); setError(''); }
        }}><input required aria-label={th ? 'รหัสออเดอร์' : 'Order code'} placeholder={th ? 'รหัสออเดอร์' : 'Order code'} value={orderCode} onChange={e => setOrderCode(e.target.value)} className="min-h-11 rounded-lg border p-2" /><button className="min-h-11 rounded-lg border px-4">{th ? 'ค้นหาออเดอร์' : 'Find order'}</button></form>
        {orderId && <OrderProblemForm key={orderId} orderId={orderId} onSaved={() => void load()} />}
      </details>
      <div className="flex gap-3"><select aria-label={th ? 'สถานะปัญหา' : 'Report status'} value={status} onChange={e => { setStatus(e.target.value); setLimit(50); }} className="min-h-11 rounded-lg border bg-white p-2"><option value="open">{th ? 'รอจัดการ' : 'Open'}</option><option value="resolved">{th ? 'จัดการแล้ว' : 'Resolved'}</option></select><button onClick={() => void load()} className="min-h-11 rounded-lg border bg-white px-4">{th ? 'รีเฟรช' : 'Refresh'}</button></div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      {loading ? <p role="status">{th ? 'กำลังโหลด…' : 'Loading…'}</p> : reports.length === 0 ? <p className="rounded-xl border bg-white p-6">{th ? 'ไม่มีปัญหาออเดอร์ในสถานะนี้' : 'No order problems with this status.'}</p> : reports.map(report => <article key={report.id} className="space-y-3 rounded-xl border bg-white p-4">
        <div className="flex flex-wrap justify-between gap-2"><h2 className="font-bold">{report.orders?.pickup_code || (th ? 'ออเดอร์หน้าบูธ' : 'Booth order')} · {({ payment: th ? 'การชำระเงิน' : 'Payment', delivery: th ? 'รับ/จัดส่ง' : 'Delivery', item: th ? 'สินค้า' : 'Items', other: th ? 'อื่น ๆ' : 'Other' } as Record<string,string>)[report.category]}</h2><time className="text-xs text-gray-500">{new Date(report.created_at).toLocaleString(th ? 'th-TH' : 'en-GB')}</time></div>
        <p className="whitespace-pre-wrap text-sm">{report.description}</p><p className="break-words text-sm font-semibold">{th ? 'ติดต่อกลับ: ' : 'Contact: '}{report.contact}</p>
        <p className="text-xs text-gray-500">{report.notification_status === 'sent' ? (th ? 'ส่งอีเมลแจ้งร้านแล้ว' : 'Shop notification sent') : (th ? 'อีเมลยังส่งไม่สำเร็จ — รายการบันทึกแล้ว' : 'Email not delivered yet — report is saved')}</p>
        <div className="flex flex-wrap gap-2">{report.image_paths.map((path, i) => <button key={path} onClick={() => void openImage(path)} className="min-h-11 rounded-lg border px-3">{th ? 'ดูรูป ' : 'View image '}{i + 1}</button>)}</div>
        {report.status === 'open' ? <label className="block text-sm font-semibold">{th ? 'ผลการจัดการที่ตกลงกับผู้ซื้อ' : 'Agreed resolution'}<textarea minLength={3} maxLength={2000} value={notes[report.id] || ''} onChange={e => setNotes(current => ({ ...current, [report.id]: e.target.value }))} className="mt-1 min-h-20 w-full rounded-lg border p-2" /></label> : <p className="whitespace-pre-wrap text-sm text-emerald-800">{report.resolution}</p>}
        <button disabled={Boolean(busy) || (report.status === 'open' && (notes[report.id] || '').trim().length < 3)} onClick={() => void resolve(report)} className="min-h-11 rounded-xl bg-pink-600 px-4 font-bold text-white disabled:opacity-50">{report.status === 'open' ? (th ? 'บันทึกว่าจัดการแล้ว' : 'Mark resolved') : (th ? 'เปิดปัญหาอีกครั้ง' : 'Reopen report')}</button>
      </article>)}
      {reports.length === limit && <button onClick={() => setLimit(value => value + 50)} className="min-h-11 rounded-lg border px-4">{th ? 'ดูเพิ่มเติม' : 'Load more'}</button>}
      {preview && <dialog ref={previewDialog} onClose={() => setPreview(null)} aria-label={th ? 'รูปปัญหาออเดอร์' : 'Order problem image'} className="max-h-[95dvh] max-w-[95vw] rounded-xl bg-white p-4 backdrop:bg-black/80"><button autoFocus onClick={() => setPreview(null)} className="mb-3 min-h-11 rounded-lg border px-4">{th ? 'ปิดรูป' : 'Close image'}</button><img src={preview} alt={th ? 'รูปประกอบปัญหา' : 'Problem attachment'} className="max-h-[80dvh] max-w-full object-contain" /></dialog>}
    </main>
  </div>;
}
