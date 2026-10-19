import { CheckCircle, Clock3, TicketCheck, X, XCircle } from 'lucide-react';
import type { Language } from '../../i18n';
import { getActivityRewards, type ActivityRewardState } from '../../utils/activityRewards';

type Props = {
  pricingBreakdown: unknown;
  state: ActivityRewardState;
  language: Language;
  className?: string;
  orderReference?: string | null;
  onDismiss?: () => void;
};

export default function ActivityRewardsCard({
  pricingBreakdown,
  state,
  language,
  className = '',
  orderReference,
  onDismiss,
}: Props) {
  const rewards = getActivityRewards(pricingBreakdown);
  if (rewards.length === 0) return null;

  const th = language === 'th';
  const content = state === 'earned'
    ? {
        icon: <CheckCircle size={20} aria-hidden="true" />,
        title: th ? 'สิทธิ์กิจกรรมที่ได้รับ' : 'Activity rewards earned',
        detail: rewards.some(reward => reward.instructions)
          ? (th ? 'ทำตามคำแนะนำด้านล่างและให้พนักงานบันทึกการใช้สิทธิ์' : 'Follow the instructions below. Staff record redemption manually.')
          : (th ? 'ติดต่อร้านเพื่อใช้สิทธิ์ ร้านเป็นผู้บันทึกการใช้สิทธิ์' : 'Contact the shop to use your reward. Staff record redemption manually.'),
        tone: 'border-violet-200 bg-violet-50 text-violet-950',
      }
    : state === 'provisional'
      ? {
          icon: <Clock3 size={20} aria-hidden="true" />,
          title: th ? 'สิทธิ์กิจกรรมหลังยืนยันการชำระเงิน' : 'Activity rewards after payment confirmation',
          detail: th ? 'รายการนี้เป็นสิทธิ์ที่รอยืนยัน และจะใช้ได้เมื่อร้านยืนยันการชำระเงินแล้ว' : 'These rewards are provisional and become active after the shop confirms payment.',
          tone: 'border-amber-200 bg-amber-50 text-amber-950',
        }
      : {
          icon: <XCircle size={20} aria-hidden="true" />,
          title: th ? 'สิทธิ์กิจกรรมไม่ได้ใช้งานแล้ว' : 'Activity rewards are no longer active',
          detail: th
            ? 'แสดงข้อมูลสิทธิ์เดิมเพื่ออ้างอิงเท่านั้น รายการนี้ไม่มีสิทธิ์ที่ใช้งานอยู่ หากเคยมอบสิทธิ์ไปแล้ว ร้านต้องตรวจและจัดการเอง'
            : 'The original saved details are shown for reference. This order has no active activity rewards. Staff must manually review any reward already handed out.',
          tone: 'border-gray-200 bg-gray-50 text-gray-700',
        };

  return (
    <section
      data-testid="activity-rewards"
      aria-label={content.title}
      className={`rounded-2xl border p-4 ${content.tone} ${className}`.trim()}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">{content.icon}</div>
        <div className="min-w-0 flex-1">
          <h2 className="font-black">{content.title}</h2>
          {orderReference && <p className="mt-0.5 break-all text-xs font-bold opacity-70">{th ? 'ออเดอร์' : 'Order'} #{orderReference}</p>}
          <p className="mt-1 text-sm font-medium leading-relaxed opacity-80">{content.detail}</p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={th ? 'ปิดรายละเอียดสิทธิ์กิจกรรม' : 'Dismiss activity reward details'}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-current/20 bg-white/70"
          >
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="mt-3 space-y-2">
        {rewards.map((reward, index) => (
          <div key={`${reward.promotionName || ''}-${reward.name}-${index}`} className="rounded-xl border border-current/10 bg-white/80 p-3">
            {reward.promotionName && <p className="text-xs font-bold opacity-60">{reward.promotionName}</p>}
            <div className="mt-0.5 flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                <TicketCheck size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
                <strong className="break-words text-sm">{reward.name}</strong>
              </div>
              <span className="shrink-0 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-black text-violet-800">× {reward.quantity}</span>
            </div>
            {reward.instructions && <p className="mt-2 break-words whitespace-pre-line text-sm font-medium leading-relaxed">{reward.instructions}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
