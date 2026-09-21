import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { getReplayConsent, REPLAY_CONSENT_EVENT, setReplayConsent, type ReplayConsent } from '../lib/observability';

export default function ReplayConsentControl() {
  const { language } = useI18n();
  const th = language === 'th';
  const [consent, setConsent] = useState(getReplayConsent);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const update = () => setConsent(getReplayConsent());
    window.addEventListener(REPLAY_CONSENT_EVENT, update);
    return () => window.removeEventListener(REPLAY_CONSENT_EVENT, update);
  }, []);

  const choose = (value: ReplayConsent) => {
    try {
      setReplayConsent(value);
      setOpen(false);
      setError(false);
    } catch {
      setError(true);
    }
  };

  if (consent && !open) return (
    <button type="button" onClick={() => setOpen(true)} className="mx-3 my-2 min-h-11 rounded-lg border border-pink-200 bg-white px-3 text-xs text-pink-800 shadow-sm">
      {th ? 'ความเป็นส่วนตัว' : 'Privacy preferences'}
    </button>
  );
  return (
    <section aria-label={th ? 'ความเป็นส่วนตัว' : 'Privacy preferences'} className="mx-auto my-3 max-w-xl rounded-xl border border-pink-200 bg-white p-4 text-gray-900 shadow-lg" data-private>
      <h2 className="font-bold">{th ? 'ช่วยปรับปรุง NireQ ด้วยบันทึกการใช้งาน?' : 'Help improve NireQ with session replay?'}</h2>
      <p className="mt-2 text-sm">{th ? 'หากยินยอม เราจะใช้ LogRocket บันทึกการใช้งานโดยปกปิดข้อความและรูป คุณปฏิเสธได้และยังใช้บริการได้ตามปกติ' : 'With your permission, LogRocket records usage with text and images hidden. You can decline and use all core features.'}</p>
      {consent === 'accepted' && <p className="mt-2 text-sm">{th ? 'การถอนความยินยอมจะโหลดหน้านี้ใหม่เพื่อหยุดบันทึก กรุณาบันทึกงานก่อน' : 'Withdrawing consent reloads this page to stop recording. Save your work first.'}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{th ? 'บันทึกตัวเลือกไม่ได้ กรุณาอนุญาตพื้นที่จัดเก็บของเว็บไซต์แล้วลองใหม่' : 'Could not save your choice. Enable site storage and try again.'}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => choose('rejected')} className="min-h-11 rounded-lg border border-pink-300 px-4 font-semibold text-pink-800">{th ? (consent === 'accepted' ? 'ถอนความยินยอมและโหลดใหม่' : 'ไม่ยินยอม') : (consent === 'accepted' ? 'Withdraw and reload' : 'Decline')}</button>
        <button type="button" onClick={() => choose('accepted')} className="min-h-11 rounded-lg border border-pink-300 px-4 font-semibold text-pink-800">{th ? 'ยินยอม' : 'Allow'}</button>
        {consent && <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-3 underline">{th ? 'ปิด' : 'Close'}</button>}
        <a href="/cookies" className="inline-flex min-h-11 items-center px-3 underline">{th ? 'อ่านรายละเอียด' : 'Learn more'}</a>
      </div>
    </section>
  );
}
