import type { ActivityReward } from '../types/activityReward';

export type ActivityRewardSnapshot = ActivityReward & {
  promotionName: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Order pricing snapshots are a database/API boundary. Read only complete,
 * positive activity rewards so malformed historic rows cannot break a receipt.
 */
export const getActivityRewards = (pricingBreakdown: unknown): ActivityRewardSnapshot[] => {
  if (!Array.isArray(pricingBreakdown)) return [];

  return pricingBreakdown.flatMap((entry) => {
    if (!isRecord(entry) || !isRecord(entry.activity_reward)) return [];
    const reward = entry.activity_reward;
    const name = typeof reward.name === 'string' ? reward.name.trim() : '';
    if (typeof reward.instructions !== 'string') return [];
    const instructions = reward.instructions.trim();
    const quantity = reward.quantity;
    if (!name || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) return [];

    const rawPromotionName = typeof entry.promotion_name === 'string'
      ? entry.promotion_name
      : typeof entry.name === 'string'
        ? entry.name
        : '';
    const promotionName = rawPromotionName.trim() || null;
    return [{ name, instructions, quantity, promotionName }];
  });
};

export type ActivityRewardState = 'earned' | 'provisional' | 'inactive';

export const activityRewardStateForOrder = (
  orderStatus?: string | null,
  paymentStatus?: string | null,
): ActivityRewardState => {
  const order = String(orderStatus || '').toLowerCase();
  const payment = String(paymentStatus || '').toLowerCase();
  if (order === 'cancelled' || ['payment_rejected', 'payment_expired', 'payment_cancelled', 'refunded'].includes(payment)) {
    return 'inactive';
  }
  if (order === 'completed' || ['payment_confirmed', 'refund_pending'].includes(payment)) return 'earned';
  return 'provisional';
};
