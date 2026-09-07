import { useState } from 'react';
import { useI18n } from '../../i18n';
import type { PromotionChoice, PromotionRequiredChoice } from '../../types/promotion';

export default function PromotionChoicePicker({ choice, onConfirm }: {
  choice: PromotionRequiredChoice;
  onConfirm: (selection: PromotionChoice) => void;
}) {
  const { language } = useI18n();
  const th = language === 'th';
  const [counts, setCounts] = useState<Record<string, number>>({});
  const earned = choice.earned_quantity || 1;
  const target = choice.available_quantity ?? earned;
  const partial = target < earned;
  const options = choice.options.map((option) => {
    const id = option.product_id || option.id;
    const limit = Math.min(target, option.available ?? target);
    return { ...option, id, limit, quantity: Math.min(counts[id] || 0, limit) };
  });
  const total = options.reduce((sum, option) => sum + option.quantity, 0);
  const base = { promotion_id: choice.promotion_id, tier_id: choice.tier_id };

  if (choice.kind !== 'reward') return <div className="rounded-xl border border-pink-200 bg-pink-50 p-3">
    <strong>{th ? 'เลือกโปรโมชั่นที่ต้องการใช้' : 'Choose a promotion'}</strong>
    <div className="mt-2 grid gap-2">{options.map((option) => <button key={option.id} type="button"
      onClick={() => onConfirm({ ...base, selected_promotion_id: option.id })}
      className="min-h-11 rounded-xl border border-pink-200 bg-white px-3 text-left text-sm font-bold">
      {option.name}{option.benefit_text ? ` · ${option.benefit_text}` : ''}
    </button>)}</div>
  </div>;

  return <div className="rounded-xl border border-pink-200 bg-pink-50 p-3">
    <strong>{th ? `เลือกของแถม ${target} ชิ้น` : `Choose ${target} free gift${target === 1 ? '' : 's'}`}</strong>
    {partial && <p role="alert" className="mt-2 text-sm font-bold text-amber-900">
      {th ? `ของแถมเหลือไม่ครบสิทธิ์: ได้สิทธิ์ ${earned} ชิ้น เหลือให้รับ ${target} ชิ้น` : `Not enough gifts: entitled to ${earned}, only ${target} available.`}
    </p>}
    <div className="mt-2 space-y-2">{options.map((option) => <div key={option.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-2">
      <span className="min-w-0 flex-1 text-sm font-bold">{option.name}<span className="block text-xs font-normal text-gray-500">
        {option.available == null ? (th ? 'ไม่จำกัดสต็อก' : 'Unlimited stock') : (th ? `เหลือ ${option.available} ชิ้น` : `${option.available} remaining`)}
      </span></span>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={`${th ? 'ลด' : 'Decrease'} ${option.name}`} disabled={option.quantity === 0}
          onClick={() => setCounts({ ...counts, [option.id]: option.quantity - 1 })}
          className="h-11 w-11 rounded-lg border border-pink-200 disabled:opacity-40">−</button>
        <output aria-label={option.name} className="min-w-5 text-center font-bold">{option.quantity}</output>
        <button type="button" aria-label={`${th ? 'เพิ่ม' : 'Increase'} ${option.name}`} disabled={total >= target || option.quantity >= option.limit}
          onClick={() => setCounts({ ...counts, [option.id]: option.quantity + 1 })}
          className="h-11 w-11 rounded-lg border border-pink-200 disabled:opacity-40">+</button>
      </div>
    </div>)}</div>
    <p aria-live="polite" className="mt-2 text-sm">{th ? `เลือกแล้ว ${total}/${target} ชิ้น` : `Selected ${total}/${target}`}</p>
    <button type="button" disabled={target < 1 || total !== target} onClick={() => onConfirm({
      ...base,
      product_ids: options.flatMap((option) => Array<string>(option.quantity).fill(option.id)),
      ...(partial ? { accepted_quantity: target, accepted_earned_quantity: earned } : {}),
    })} className="mt-2 min-h-11 w-full rounded-xl bg-pink-600 px-3 text-sm font-bold text-white disabled:opacity-40">
      {partial ? (th ? `ยืนยันรับของแถม ${target} จาก ${earned} ชิ้น` : `Accept ${target} of ${earned} gifts`) : (th ? 'ยืนยันของแถมที่เลือก' : 'Confirm selected gifts')}
    </button>
  </div>;
}
