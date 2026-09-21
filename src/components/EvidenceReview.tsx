import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import { useI18n } from '../i18n';
import { formatPrice } from '../utils/currency';
import EvidenceDownload from './EvidenceDownload';

export default function EvidenceReview({ title, closeLabel, code, customer, amount, currency, url, items, onClose, children }: {
  title: string; closeLabel: string; code: string; customer: string; amount: number; currency: string;
  url: string; items: Array<{ name: string; quantity: number }>; onClose: () => void; children?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [zoomed, setZoomed] = useState(false);
  const [failed, setFailed] = useState(false);
  const { language } = useI18n();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => { node?.close(); };
  }, []);
  return <dialog ref={dialog} className="evidence-review" aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><h2>{title}</h2><p>{code} · {customer}</p></div><button autoFocus onClick={onClose} aria-label={closeLabel}><X size={22} /></button></header>
    <div className="evidence-review-layout">
      <div className="evidence-review-image">
        <button className="evidence-zoom" type="button" aria-pressed={zoomed} onClick={() => setZoomed(!zoomed)}>{zoomed ? <ZoomOut size={18} /> : <ZoomIn size={18} />}{language === 'th' ? (zoomed ? 'ย่อรูป' : 'ขยายสลิป') : (zoomed ? 'Fit image' : 'Zoom evidence')}</button>
        <div className="evidence-image-scroll">{failed ? <p role="alert">{language === 'th' ? 'โหลดรูปไม่สำเร็จ ปิดแล้วเปิดสลิปอีกครั้ง หรือดาวน์โหลดไฟล์ด้านล่าง' : 'Could not load the image. Reopen the preview or download the file below.'}</p> : <img className={zoomed ? 'is-zoomed' : ''} src={url} alt={`${title} ${code}`} onError={() => setFailed(true)} />}</div>
      </div>
      <aside><p className="text-sm text-gray-600">{language === 'th' ? 'ยอดที่ต้องได้รับ' : 'Amount expected'}</p><strong className="evidence-review-total">{formatPrice(amount, currency)}</strong>
        <ul>{items.map((item, index) => <li key={index}><span>{item.name}</span><b>× {item.quantity}</b></li>)}</ul>
        <p className="evidence-review-hint">{language === 'th' ? 'เทียบยอด ผู้รับ และวันเวลาบนสลิปกับรายการเงินเข้าก่อนยืนยัน' : 'Check the amount, recipient and transfer time against money received before confirming.'}</p>
        <EvidenceDownload url={url} orderCode={code} />
        <div className="evidence-review-actions">{children}</div>
      </aside>
    </div>
  </dialog>;
}
