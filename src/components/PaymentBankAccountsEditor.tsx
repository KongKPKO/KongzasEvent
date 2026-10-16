import { Plus, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { createEmptyBankAccount, type PaymentBankAccount } from '../utils/paymentBanks';

export default function PaymentBankAccountsEditor({ accounts, onChange, disabled = false }: {
  accounts: PaymentBankAccount[];
  onChange: (accounts: PaymentBankAccount[]) => void;
  disabled?: boolean;
}) {
  const { language } = useI18n();
  const th = language === 'th';
  const fields = [
    { key: 'bank_name', label: th ? 'ธนาคาร' : 'Bank name', placeholder: th ? 'เช่น กสิกรไทย ไทยพาณิชย์' : 'KBank, SCB, etc.' },
    { key: 'account_name', label: th ? 'ชื่อบัญชี' : 'Account name', placeholder: th ? 'ชื่อเจ้าของบัญชี' : 'Account holder' },
    { key: 'account_number', label: th ? 'เลขบัญชี' : 'Account number', placeholder: '000-0-00000-0' },
  ] as const;
  return <div className="grid gap-3">
    {accounts.map((account, index) => <fieldset key={index} disabled={disabled} aria-label={`${th ? 'บัญชีธนาคาร' : 'Bank account'} ${index + 1}`} className="min-w-0 rounded-xl border border-pink-100 p-3">
      <legend className="px-1 text-xs font-bold text-gray-600">{th ? 'บัญชีธนาคาร' : 'Bank account'} {index + 1}</legend>
      <div className="mb-2 flex justify-end"><button type="button" aria-label={`${th ? 'ลบบัญชีธนาคาร' : 'Remove bank account'} ${index + 1}`} onClick={() => onChange(accounts.filter((_, position) => position !== index))} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-bold text-gray-600 hover:bg-gray-50"><X size={15} aria-hidden="true" />{th ? 'นำออก' : 'Remove'}</button></div>
      <div className="grid gap-3 md:grid-cols-3">{fields.map(field => <label key={field.key} className="grid min-w-0 gap-2 text-sm font-bold text-gray-700">
        {field.label}
        <input value={account[field.key]} inputMode={field.key === 'account_number' ? 'numeric' : undefined} placeholder={field.placeholder} onChange={event => onChange(accounts.map((item, position) => position === index ? { ...item, [field.key]: event.target.value } : item))} className="min-h-12 min-w-0 rounded-xl border border-pink-100 bg-white px-3 text-sm font-semibold outline-none focus:border-pink-300" />
      </label>)}</div>
    </fieldset>)}
    <button type="button" disabled={disabled} onClick={() => onChange([...accounts, createEmptyBankAccount()])} className="inline-flex min-h-11 items-center justify-center gap-2 justify-self-start rounded-xl border border-pink-200 bg-white px-4 text-sm font-bold text-pink-700 disabled:opacity-50"><Plus size={16} aria-hidden="true" />{th ? 'เพิ่มบัญชีธนาคาร' : 'Add bank account'}</button>
  </div>;
}
