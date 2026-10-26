import { useI18n } from '../../i18n';
import { formatPrice } from '../../utils/currency';

export default function OrderPromotionDetails({ pricingBreakdown, currency }: { pricingBreakdown: unknown; currency: string }) {
  const { language } = useI18n();
  const th = language === 'th';
  const entries = Array.isArray(pricingBreakdown) ? pricingBreakdown.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && !Array.isArray(entry)) : [];
  if (!entries.length) return null;
  return <section className="my-3 rounded-xl border border-gray-200 bg-white p-4" aria-label={th ? 'โปรโมชั่นที่ใช้ในออเดอร์' : 'Promotions used in this order'}>
    <h3 className="font-bold">{th ? 'โปรโมชั่นที่ใช้ในออเดอร์' : 'Promotions used in this order'}</h3>
    <ul className="mt-2 space-y-3">{entries.map((entry, index) => {
      const name = typeof entry.name === 'string' ? entry.name : typeof entry.promotion_name === 'string' ? entry.promotion_name : typeof entry.label === 'string' ? entry.label : (th ? 'โปรโมชั่นเดิม' : 'Saved promotion');
      const amount = entry.discount_amount ?? entry.discountAmount;
      const discount = typeof amount === 'number' && Number.isFinite(amount) ? amount : null;
      return <li key={index} className="flex flex-wrap items-start justify-between gap-2 text-sm"><div className="min-w-0"><strong className="break-words">{name}</strong>{typeof entry.rule_text === 'string' && <p className="mt-1 break-words text-xs text-gray-600">{entry.rule_text}</p>}</div>{discount !== null && <span>{th ? 'ส่วนลด' : 'Discount'} {formatPrice(discount, currency)}</span>}</li>;
    })}</ul>
  </section>;
}
