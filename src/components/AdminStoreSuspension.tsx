import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useI18n } from '../i18n';

export default function AdminStoreSuspension({ artistId, onForbidden }: { artistId: string; onForbidden: () => void }) {
  const { language } = useI18n();
  const tr = (th: string, en: string) => language === 'th' ? th : en;
  const [state, setState] = useState<boolean | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setState(null);
    void supabase.rpc('get_store_suspension', { p_artist_id: artistId }).then(({ data, error }) => {
      if (!alive) return;
      setFailed(!!error || typeof data !== 'boolean');
      if (!error && typeof data === 'boolean') setState(data);
    });
    return () => { alive = false; };
  }, [artistId, revision]);
  const submit = async () => {
    if (state === null || busy || reason.trim().length < 5) return;
    if (!window.confirm(tr(
      state ? 'คืนสิทธิ์รับออเดอร์และคิวใหม่ให้ร้านนี้?' : 'ระงับออเดอร์และคิวใหม่? ออเดอร์เดิม เงิน และสต็อกจะไม่ถูกแก้ไข',
      state ? 'Resume new orders and queue tickets for this store?' : 'Suspend new orders and queue tickets? Existing orders, money and stock will not change.'
    ))) return;
    setBusy(true); setMessage('');
    try {
      const { data, error } = await supabase.rpc('set_store_suspension', {
        p_artist_id: artistId, p_suspended: !state, p_expected: state, p_reason: reason.trim(),
      });
      if (error) throw error;
      if (typeof data !== 'boolean') throw new Error('invalid_response');
      setState(data); setReason('');
      setMessage(tr('บันทึกสถานะและประวัติแล้ว', 'Status and audit saved.'));
    } catch (error) {
      const text = (error as { message?: string }).message || '';
      if (/forbidden|permission denied|JWT/i.test(text)) { onForbidden(); return; }
      setState(null); setFailed(true);
      setMessage(tr('บันทึกไม่สำเร็จหรือสถานะเปลี่ยนแล้ว กรุณาโหลดสถานะใหม่ก่อนลองอีกครั้ง', 'Save failed or state changed. Reload the status before retrying.'));
    } finally { setBusy(false); }
  };
  return <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4" aria-label={tr('สิทธิ์รับออเดอร์และคิว', 'Store business access')}>
    <h3 className="font-bold">{tr('สิทธิ์รับออเดอร์และคิว', 'Store business access')}</h3>
    <p>{state === null ? tr('ยังไม่ยืนยันสถานะ', 'Status not confirmed') : state ? tr('ระงับการรับออเดอร์และคิวใหม่', 'New orders and queue tickets suspended') : tr('รับออเดอร์และคิวใหม่ได้ตามการตั้งค่าร้าน', 'New orders and queue tickets follow store settings')}</p>
    <p className="text-sm">{tr('ไม่เปลี่ยนออเดอร์เดิม การชำระเงิน สต็อก หรือการตั้งค่าช่องทางขาย การเปลี่ยนสถานะนี้มีบันทึกผู้ดำเนินการและเหตุผล', 'Existing orders, payments, stock and channel settings are unchanged. Status changes record the administrator and reason.')}</p>
    {failed && <button type="button" className="min-h-11 underline" disabled={busy} onClick={() => { setFailed(false); setRevision(v => v + 1); }}>{tr('โหลดสถานะใหม่', 'Reload status')}</button>}
    <label className="block text-sm font-bold">{tr('เหตุผลที่เปลี่ยนสถานะร้าน (5–500 ตัวอักษร)', 'Reason for store status change (5–500 characters)')}<textarea className="mt-1 block w-full rounded-xl border border-gray-300 p-3" maxLength={500} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></label>
    <button type="button" disabled={state === null || busy || reason.trim().length < 5} className="min-h-11 rounded-xl border border-amber-700 bg-white px-4 py-2 font-bold text-amber-950 disabled:opacity-40" onClick={() => void submit()}>{busy ? tr('กำลังบันทึก…', 'Saving…') : state ? tr('คืนสิทธิ์รับออเดอร์และคิว', 'Resume new orders and queues') : tr('ระงับออเดอร์และคิวใหม่', 'Suspend new orders and queues')}</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
