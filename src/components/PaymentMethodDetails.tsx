import { useState } from 'react';
import { useI18n } from '../i18n';
import { getPaymentBankAccounts, type PaymentBankAccount } from '../utils/paymentBanks';
import { getMenuImageUrl } from '../utils/imageUtils';

interface PaymentInstructions {
  bank_accounts?: PaymentBankAccount[] | null;
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
  const accounts = getPaymentBankAccounts(method);
  const name = method.display_name || (th ? 'ช่องทางชำระเงิน' : 'Payment method');
  return <div data-testid="payment-method-card" className="order-method rounded-xl border border-gray-100 bg-gray-50 p-3">
    <div className="font-black text-gray-900">{name}</div>
    {method.promptpay_id && <div className="mt-1 font-bold">{th ? 'พร้อมเพย์' : 'PromptPay'}: {method.promptpay_id}</div>}
    {accounts.map((account, index) => <div key={index} data-testid="payment-bank-account" className="mt-3 rounded-lg border border-gray-100 bg-white p-3">
      {accounts.length > 1 && <div className="mb-1 text-xs font-bold text-gray-500">{th ? 'บัญชีธนาคาร' : 'Bank account'} {index + 1}</div>}
      {account.bank_name && <div className="font-bold">{th ? 'ธนาคาร' : 'Bank'}: {account.bank_name}</div>}
      {account.account_number && <div className="mt-1 break-all font-bold">{th ? 'เลขที่บัญชี' : 'Account number'}: {account.account_number}</div>}
      {account.account_name && <div className="mt-1 text-sm">{th ? 'ชื่อบัญชี' : 'Account holder'}: {account.account_name}</div>}
    </div>)}
    {method.qr_image_url && (failedQr === method.qr_image_url
      ? <p role="status" className="mt-2 text-sm text-amber-800">{th ? 'โหลด QR ไม่สำเร็จ กรุณารีเฟรชหน้า หรือติดต่อร้านค้า' : 'QR could not load. Refresh the page or contact the shop.'}</p>
      : <img src={getMenuImageUrl(method.qr_image_url)} alt={`${name} QR`} loading="lazy" className="order-payment-qr" onError={() => setFailedQr(method.qr_image_url || null)} />)}
    {method.instructions && <p className="mt-1 whitespace-pre-line text-sm text-gray-600">{method.instructions}</p>}
  </div>;
}
