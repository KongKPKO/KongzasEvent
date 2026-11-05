import type { PromotionQuote } from '../../types/promotion';
import { formatPrice } from '../../utils/currency';
import { promotionGiftLabel } from './PromotionQuoteNotices';

/** Show the server-calculated benefits without exposing internal product codes. */
export default function CustomerPromotionBenefits({ quote, language, currency }: { quote: PromotionQuote | null; language: string; currency?: string }) {
  if (!quote || (!quote.applied_promotions.length && !quote.reward_lines.length)) return null;
  return <section className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm" aria-label={(language === 'th' ? 'โปรโมชั่นที่ได้รับ' : 'Applied promotions')}>
    <h3 className="mb-2 font-black text-emerald-900">{(language === 'th' ? 'โปรโมชั่นที่ได้รับ' : 'Applied promotions')}</h3>
    <div className="space-y-2">
      {quote.applied_promotions.map(promotion => <div key={promotion.id} className="flex items-start justify-between gap-3 rounded-lg border border-emerald-100 bg-white px-3 py-2 text-emerald-900">
        <strong className="min-w-0 break-words">{promotion.name}</strong>
        {promotion.discount_amount > 0 && <strong className="shrink-0 text-emerald-700">−{formatPrice(promotion.discount_amount, currency)}</strong>}
      </div>)}
      {quote.reward_lines.map(reward => <div key={`${reward.promotion_id}-${reward.tier_id || ''}-${reward.product_id}`} className="break-words rounded-lg border border-emerald-100 bg-white px-3 py-2 font-bold text-emerald-800">{promotionGiftLabel(quote, reward, language, false)}</div>)}
    </div>
  </section>;
}
