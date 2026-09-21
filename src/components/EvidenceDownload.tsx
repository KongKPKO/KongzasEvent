import { useState } from 'react';
import { useI18n } from '../i18n';

export default function EvidenceDownload({ url, orderCode }: { url: string; orderCode: string }) {
  const { language } = useI18n();
  const th = language === 'th';
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const download = async () => {
    if (busy) return;
    setBusy(true); setFailed(false);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('download_failed');
      const blob = await response.blob();
      const extension = ({ 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' } as Record<string, string>)[blob.type];
      if (!extension) throw new Error('unsupported_evidence');
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl; link.download = `payment-${orderCode.replace(/[^a-z0-9-]/gi, '')}.${extension}`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch { setFailed(true); }
    finally { setBusy(false); }
  };
  return <div className="border-t border-gray-100 px-4 py-3">
    <button type="button" disabled={busy} onClick={() => void download()} className="min-h-11 rounded-xl border border-gray-200 px-4 text-sm font-bold disabled:opacity-50">
      {busy ? (th ? 'กำลังดาวน์โหลด…' : 'Downloading…') : (th ? 'ดาวน์โหลดสลิป' : 'Download payment evidence')}
    </button>
    {failed && <p role="alert" className="mt-2 text-sm text-red-700">{th ? 'ดาวน์โหลดไม่สำเร็จ กรุณาปิดแล้วเปิดหลักฐานใหม่เพื่อลองอีกครั้ง' : 'Download failed. Close and reopen the evidence to retry.'}</p>}
  </div>;
}
