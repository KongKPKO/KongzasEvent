import type { PromotionQuote, PromotionRewardLine } from '../../types/promotion';
import { formatPrice } from '../../utils/currency';

export const promotionGiftLabel = (quote: PromotionQuote | null, reward: PromotionRewardLine, language: string) => [
  `${language === 'th' ? 'ของแถม' : 'Free gift'}: ${reward.name} × ${reward.quantity}`,
  reward.sku ? `${language === 'th' ? 'รหัสสินค้า' : 'Product code'} ${reward.sku}` : '',
  quote?.applied_promotions.find(item => item.id === reward.promotion_id)?.name || '',
].filter(Boolean).join(' · ');

/** Display server decisions; never recalculate prices or gift availability here. */
export default function PromotionQuoteNotices({ quote, language, currency }: {
  quote: PromotionQuote | null;
  language: string;
  currency?: string;
}) {
  const giftNotices = quote?.diagnostics?.filter(item => item.code === 'gift_limit_reached' || item.code === 'gift_stock_insufficient') || [];
  const sets = quote?.auto_sets || [];
  if (!giftNotices.length && !sets.length) return null;
  return <div className="my-3 space-y-2 text-xs" aria-live="polite">
    {sets.map(set => <div key={set.bundle_product_id} className="rounded-xl border border-pink-200 bg-pink-50 p-3 text-pink-900">
      <strong>{language === 'th' ? 'รวมเป็นชุดอัตโนมัติ' : 'Automatically grouped as a set'}: {set.bundle_name} × {set.quantity}</strong>
      <p className="mt-1">{language === 'th' ? 'ใช้ราคาชุด ประหยัด' : 'Set price saves'} {formatPrice(set.total_savings, currency)} · {language === 'th' ? 'ออเดอร์จะบันทึกเป็นสินค้าชุดนี้' : 'Your order records this bundle.'}</p>
    </div>)}
    {giftNotices.map(item => {
      const promotion = quote?.applied_promotions.find(applied => applied.id === item.promotion_id);
      return <div key={item.promotion_id} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950">
        {promotion && <strong className="block">{promotion.name}</strong>}
        <p>{item.code === 'gift_limit_reached'
          ? (language === 'th' ? 'ของแถมครบจำนวนสิทธิ์ที่กำหนดแล้ว' : 'The gift redemption limit has been reached.')
          : (language === 'th' ? 'สต็อกของแถมไม่เพียงพอ' : 'There is insufficient gift stock.')}
          {(item.available_quantity || 0) > 0 && <> · {language === 'th' ? 'ได้รับของแถม' : 'Gifts included'} {item.available_quantity}/{item.earned_quantity}</>}
        </p>
        <p className="mt-1">{(promotion?.discount_amount || 0) > 0
          ? (language === 'th' ? 'ยังได้รับส่วนลดของโปรโมชั่นนี้ และสั่งซื้อต่อได้' : 'The promotion discount still applies. You can continue ordering.')
          : (language === 'th' ? 'สั่งซื้อต่อได้ตามยอดที่แสดง' : 'You can continue at the displayed total.')}</p>
      </div>;
    })}
  </div>;
}
