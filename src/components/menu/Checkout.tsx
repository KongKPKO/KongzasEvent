import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X, ShoppingBag } from 'lucide-react';
import { useI18n } from '../../i18n';
import { formatPrice } from '../../utils/currency';
import { ShopImage } from './StorefrontHeader';

export function CheckoutDialog({ open, title, busy = false, onClose, children }: {
  open: boolean; title: string; busy?: boolean; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { language } = useI18n();
  useEffect(() => {
    const element = dialog.current;
    if (open && !element?.open) element?.showModal();
    if (!open && element?.open) element.close();
    return () => { if (element?.open) element.close(); };
  }, [open]);
  return <dialog ref={dialog} className="checkout-dialog" aria-labelledby={titleId} aria-busy={busy} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="checkout-header">
      <div><p>NireQ · {language === 'th' ? 'ตรวจรายการก่อนยืนยัน' : 'Review before confirming'}</p><h2 id={titleId}>{title}</h2></div>
      <button type="button" autoFocus disabled={busy} onClick={onClose} aria-label={language === 'th' ? 'ปิด' : 'Close'}><X size={22} /></button>
    </header>
    {children}
  </dialog>;
}

export function CheckoutItems({ items, currency }: {
  items: Array<{ id: string; name: string; image?: string | null; quantity: number; price: number }>; currency?: string;
}) {
  const { language } = useI18n();
  return <section className="checkout-items" aria-label={language === 'th' ? 'รายการสินค้า' : 'Order items'}>
    <h3><ShoppingBag size={18} aria-hidden="true" />{language === 'th' ? 'รายการสินค้า' : 'Your items'}</h3>
    <ul>{items.map(item => <li key={item.id}>
      <ShopImage src={item.image} name={item.name} />
      <div><strong>{item.name}</strong><span>{item.quantity} × {formatPrice(item.price, currency)}</span></div>
      <b>{formatPrice(item.price * item.quantity, currency)}</b>
    </li>)}</ul>
  </section>;
}
