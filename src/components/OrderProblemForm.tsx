import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { uploadImage } from '../lib/imageUploads';
import { useI18n } from '../i18n';

export default function OrderProblemForm({ orderId, code, onSaved }: { orderId: string; code?: string; onSaved?: () => void }) {
  const { language } = useI18n();
  const th = language === 'th';
  const [category, setCategory] = useState('other');
  const [description, setDescription] = useState('');
  const [contact, setContact] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [feedback, setFeedback] = useState('');
  const key = `nireq-problem-draft:${orderId}`;
  const [pending, setPending] = useState(() => Boolean(sessionStorage.getItem(key)));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setFeedback('');
    try {
      const existing = sessionStorage.getItem(key);
      let payload;
      if (existing) {
        payload = JSON.parse(existing);
      } else {
        if (files.length > 5) throw new Error(th ? 'แนบรูปได้สูงสุด 5 รูป' : 'Attach up to 5 images.');
        const paths = [];
        for (const file of files) paths.push(await uploadImage(file, 'problem', { orderId, code }));
        payload = { p_id: crypto.randomUUID(), p_order_id: orderId, p_code: code || null, p_category: category,
          p_description: description.trim(), p_contact: contact.trim(), p_contact_confirmed: confirmed, p_image_paths: paths };
        sessionStorage.setItem(key, JSON.stringify(payload)); setPending(true);
      }
      const result = await supabase.rpc('submit_order_problem', payload);
      if (result.error) {
        if (result.error.code === 'P0001' || result.error.code?.startsWith('22') || result.error.code?.startsWith('23')) { sessionStorage.removeItem(key); setPending(false); }
        throw result.error;
      }
      sessionStorage.removeItem(key); setPending(false); setSaved(true); onSaved?.();
      // The durable report owns notification retries; a mail failure never discards it.
      const notification = await supabase.functions.invoke('operations-maintenance', { body: { reportId: result.data, code } });
      if (notification.error || notification.data?.failed > 0) setFeedback(th ? 'บันทึกแล้ว การแจ้งเตือนอีเมลรอส่งซ้ำ ร้านดูรายการได้ในระบบ' : 'Saved. Email notification is awaiting retry; the report is available to the shop.');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setFeedback(message || (th ? 'ยังส่งไม่สำเร็จ กรุณาลองอีกครั้ง ระบบจะไม่สร้างรายการซ้ำ' : 'Not sent yet. Retry safely without creating a duplicate report.'));
    } finally { setBusy(false); }
  };
  return <details className="rounded-2xl border border-pink-100 bg-white p-4" open={pending || saved || undefined}>
    <summary className="cursor-pointer font-bold text-pink-700">{th ? 'แจ้งปัญหาออเดอร์' : 'Report an order problem'}</summary>
    {saved ? <p role="status" className="mt-3 text-sm text-emerald-700">{th ? 'บันทึกปัญหาแล้ว ร้านจะติดต่อกลับตามช่องทางที่ให้ไว้' : 'Report saved. The shop will contact you using the details you provided.'}</p> :
      <form onSubmit={submit} className="mt-4 space-y-3">
        <p className="text-sm text-gray-600">{th ? 'ร้านจะติดต่อและตกลงวิธีแก้ปัญหากับคุณนอกระบบ ไม่มีแชทในหน้านี้' : 'The shop will contact you outside NireQ to agree on a solution. This page is not a chat.'}</p>
        {pending ? <p className="text-sm text-amber-800">{th ? 'มีรายการที่ยังไม่ทราบผล กดส่งซ้ำเพื่อตรวจและส่งรายการเดิม' : 'A previous submission is unconfirmed. Retry to check and submit the same report.'}</p> : <>
          <label className="block text-sm font-semibold">{th ? 'ประเภทปัญหา' : 'Problem type'}<select value={category} onChange={e => setCategory(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border p-2">
            <option value="payment">{th ? 'การชำระเงิน' : 'Payment'}</option><option value="delivery">{th ? 'การรับหรือจัดส่งสินค้า' : 'Pickup or delivery'}</option><option value="item">{th ? 'สินค้า' : 'Items'}</option><option value="other">{th ? 'อื่น ๆ' : 'Other'}</option>
          </select></label>
          <label className="block text-sm font-semibold">{th ? 'รายละเอียด' : 'Description'}<textarea required minLength={5} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} className="mt-1 min-h-24 w-full rounded-lg border p-2" /></label>
          <label className="block text-sm font-semibold">{th ? 'ช่องทางติดต่อกลับ เช่น อีเมลหรือบัญชีโซเชียล' : 'Contact details, such as email or social account'}<input required minLength={3} maxLength={300} value={contact} onChange={e => setContact(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border p-2" /></label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{th ? 'ตรวจแล้ว ช่องทางติดต่อถูกต้อง' : 'I checked that these contact details are correct.'}</label>
          <label className="block text-sm">{th ? 'รูปประกอบ ไม่เกิน 5 รูป (ไม่บังคับ)' : 'Up to 5 images (optional)'}<input type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif" multiple onChange={e => setFiles(Array.from(e.target.files || []))} className="mt-1 block w-full" /></label>
        </>}
        <button disabled={busy} className="min-h-11 rounded-xl bg-pink-600 px-4 font-bold text-white disabled:opacity-50">{busy ? (th ? 'กำลังส่ง…' : 'Sending…') : pending ? (th ? 'ส่งรายการเดิมอีกครั้ง' : 'Retry submission') : (th ? 'ส่งปัญหาให้ร้าน' : 'Send report to shop')}</button>
      </form>}
    {feedback && <p role="status" className="mt-3 text-sm text-amber-800">{feedback}</p>}
  </details>;
}
