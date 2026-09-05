export type PromotionType =
  | 'quantity_discount'
  | 'quantity_gift'
  | 'spend_tier_gift'
  | 'legacy_free_eligible_items';

export type PromotionTargetType = 'all' | 'product' | 'category' | 'tag' | 'category_tag';
export type PromotionLifecycleStatus = 'draft' | 'ready' | 'archived';
export type PromotionRewardSelectionMode = 'fixed' | 'customer_choice';
export type PromotionTierGrantMode = 'highest_only' | 'cumulative';
export type PromotionCombinationPolicy = 'combine' | 'exclusive';
export type PromotionEventPhase = 'preorder' | 'live' | 'postorder';

export interface PromotionAssignment {
  id: string;
  promotion_id: string;
  artist_id: string;
  event_id: string | null;
  event_phase: PromotionEventPhase | null;
  campaign_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_paused: boolean;
  combination_policy: PromotionCombinationPolicy;
}

export interface PromotionTier {
  id: string;
  promotion_id: string;
  threshold_amount: number;
  reward_quantity: number;
  reward_selection_mode: PromotionRewardSelectionMode;
  sort_order: number;
}

export interface PromotionRewardProduct {
  id: string;
  promotion_id: string;
  promotion_tier_id: string | null;
  product_id: string;
  sort_order: number;
}

export interface PromotionChoice {
  promotion_id: string;
  selected_promotion_id?: string;
  product_ids?: string[];
}

export interface AppliedPromotionQuote {
  id: string;
  assignment_id: string;
  revision: number;
  name: string;
  rule_text: string;
  bundle_count: number;
  discount_amount: number;
  reached_tier_ids: string[];
  rewards: Array<{
    product_id: string;
    name: string;
    sku: string | null;
    quantity: number;
  }>;
}

export interface PromotionRewardLine {
  product_id: string;
  name: string;
  sku: string | null;
  quantity: number;
  promotion_id: string;
  assignment_id: string;
  tier_id: string | null;
  is_unlimited: boolean;
}

export interface PromotionRequiredChoice {
  kind: 'reward' | 'exclusive_promotion';
  promotion_id: string;
  earned_quantity?: number;
  options: Array<{
    id: string;
    name: string;
    sku?: string | null;
    available?: number | null;
    benefit_text?: string;
  }>;
}

export interface PromotionQuote {
  subtotal: number;
  discount_total: number;
  merchandise_total: number;
  shipping_fee: number;
  total: number;
  pricing_hash: string;
  applied_promotions: AppliedPromotionQuote[];
  reward_lines: PromotionRewardLine[];
  required_choices: PromotionRequiredChoice[];
}

export interface PromotionQuoteInput {
  eventId?: string | null;
  eventPhase?: PromotionEventPhase | null;
  campaignId?: string | null;
  items: Array<{ product_id: string; quantity: number }>;
  rewardChoices?: PromotionChoice[];
  promotionChoices?: PromotionChoice[];
}

export interface PromotionSummary {
  id: string;
  name: string;
  detail: string;
  discountAmount: number;
  rewardQuantity: number;
}
