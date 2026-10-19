export interface ActivityReward {
  name: string;
  instructions: string;
  quantity: number;
}

export interface PromotionPricingBreakdown {
  id?: string;
  name?: string;
  promotion_name?: string;
  discount_amount?: number;
  activity_reward?: ActivityReward | null;
}
