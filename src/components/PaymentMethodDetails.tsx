import { useState } from 'react';
import { useI18n } from '../i18n';
import { getMenuImageUrl } from '../utils/imageUtils';

interface PaymentInstructions {
  id: string;
  display_name?: string | null;
  method_type: string;
  promptpay_id?: string | null;
  bank_name?: string | null;
  account_number?: string | null;
  account_name?: string | null;
  qr_image_url?: string | null;
  instructions?: string | null;
}

export default function PaymentMethodDetails({ method }: { method: PaymentInstructions }) {
  const { language } = useI18n();
  const [failedQr, setFailedQr] = useState<string | null>(null);
  const th = language === 'th';
  const name = method.display_name || (th ? 'ช่องทางชำระเงิน' : 'Payment method');
  return <div data-testid="payment-method-card" className="order-method rounded-xl border border-gray-100 bg-gray-50 p-3">
    <div className="font-black text-gray-900">{name}</div>
    {method.promptpay_id && <div className="mt-1 font-bold">{th ? 'พร้อมเพย์' : 'PromptPay'}: {method.promptpay_id}</div>}
    {method.bank_name && <div className="mt-1 font-bold">{th ? 'ธนาคาร' : 'Bank'}: {method.bank_name}</div>}
    {method.account_number && <div className="mt-1 font-bold">{th ? 'เลขที่บัญชี' : 'Account number'}: {method.account_number}</div>}
    {method.account_name && <div className="mt-1 text-sm">{th ? 'ชื่อบัญชี' : 'Account holder'}: {method.account_name}</div>}
    {method.qr_image_url && (failedQr === method.qr_image_url
      ? <p role="status" className="mt-2 text-sm text-amber-800">{th ? 'โหลด QR ไม่สำเร็จ กรุณารีเฟรชหน้า หรือติดต่อร้านค้า' : 'QR could not load. Refresh the page or contact the shop.'}</p>
      : <img src={getMenuImageUrl(method.qr_image_url)} alt={`${name} QR`} loading="lazy" className="order-payment-qr" onError={() => setFailedQr(method.qr_image_url || null)} />)}
    {method.instructions && <p className="mt-1 whitespace-pre-line text-sm text-gray-600">{method.instructions}</p>}
  </div>;
}
