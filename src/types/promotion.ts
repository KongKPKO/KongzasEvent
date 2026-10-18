export type PromotionType =
  | 'quantity_discount'
  | 'quantity_gift'
  | 'spend_tier_gift'
  | 'condition_reward'
  | 'legacy_free_eligible_items';

export type PromotionTargetType = 'all' | 'product' | 'category' | 'tag' | 'category_tag';
export type PromotionLifecycleStatus = 'draft' | 'ready' | 'archived';
export type PromotionRewardSelectionMode = 'fixed' | 'customer_choice';
export type PromotionTierGrantMode = 'highest_only' | 'cumulative';
export type PromotionCombinationPolicy = 'combine' | 'exclusive';
export type PromotionEventPhase = 'preorder' | 'live' | 'postorder';

export type PromotionV1Condition =
  | { kind: 'quantity'; quantity: number }
  | { kind: 'spend'; amount: number }
  | { kind: 'product'; items: Array<{ product_id: string; quantity: number }> }
  | { kind: 'recipe'; items: Array<{ product_id: string; quantity: number }> };

export interface PromotionV1Config {
  version: 1;
  condition: PromotionV1Condition;
  discount: { kind: 'fixed' | 'percentage'; value: number } | null;
  gift: { product_id: string; quantity: number; limit: number | null } | null;
}

export interface PromotionGiftUsage {
  redeemed_quantity: number;
  held_quantity: number;
  remaining_quantity: number | null;
}

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

export interface PromotionDefinition {
  id: string;
  artist_id: string;
  name: string | null;
  promotion_type: PromotionType;
  target_type: PromotionTargetType;
  match_category: string | null;
  match_tag: string | null;
  match_product_ids: string[] | null;
  buy_quantity: number | null;
  reward_value: number | null;
  reward_quantity: number | null;
  reward_selection_mode: PromotionRewardSelectionMode | null;
  tier_grant_mode: PromotionTierGrantMode | null;
  lifecycle_status: PromotionLifecycleStatus;
  revision: number;
  assignments: PromotionAssignment[];
  tiers: Array<PromotionTier & { reward_product_ids: string[] }>;
  reward_product_ids: string[];
  v1_config: PromotionV1Config | null;
  gift_usage: PromotionGiftUsage | null;
}

export interface SavePromotionDefinitionInput {
  expected_revision?: number;
  confirmation_token?: string;
  id?: string | null;
  artist_id: string;
  name: string;
  promotion_type: Exclude<PromotionType, 'legacy_free_eligible_items'>;
  target_type: PromotionTargetType;
  match_category?: string | null;
  match_tag?: string | null;
  match_product_ids?: string[];
  buy_quantity?: number | null;
  reward_value?: number | null;
  reward_quantity?: number | null;
  reward_selection_mode?: PromotionRewardSelectionMode | null;
  tier_grant_mode?: PromotionTierGrantMode | null;
  assignments: Array<Omit<PromotionAssignment, 'id' | 'promotion_id' | 'artist_id'>>;
  tiers?: Array<{
    threshold_amount: number;
    reward_quantity: number;
    reward_selection_mode: PromotionRewardSelectionMode;
    sort_order: number;
    reward_product_ids: string[];
  }>;
  reward_product_ids?: string[];
  v1_config?: PromotionV1Config | null;
}

export interface PromotionChoice {
  accepted_quantity?: number;
  accepted_earned_quantity?: number;
  promotion_id: string;
  tier_id?: string | null;
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
  available_quantity?: number;
  partial?: boolean;
  kind: 'reward' | 'exclusive_promotion';
  promotion_id: string;
  tier_id?: string | null;
  earned_quantity?: number;
  exhausted?: boolean;
  options: Array<{
    id: string;
    product_id?: string;
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
  normalized_items?: Array<{ product_id: string; quantity: number }>;
  auto_sets?: Array<{
    bundle_product_id: string;
    bundle_name: string;
    quantity: number;
    unit_savings: number;
    total_savings: number;
    components: Array<{ product_id: string; quantity: number }>;
  }>;
  diagnostics?: PromotionDiagnostic[];
}

export interface PromotionQuoteInput {
  orderId?: string | null;
  eventId?: string | null;
  eventPhase?: PromotionEventPhase | null;
  campaignId?: string | null;
  items: Array<{ product_id: string; quantity: number }>;
  rewardChoices?: PromotionChoice[];
  promotionChoices?: PromotionChoice[];
}

export interface PromotionDiagnostic {
  promotion_id: string;
  code: string;
  earned_quantity: number;
  available_quantity?: number;
  remaining_quantity?: number | null;
  missing_quantity?: number;
  missing_amount?: number;
  missing_items?: Array<{ product_id: string; quantity: number }>;
}

export interface PromotionPreviewResult extends PromotionQuote {
  diagnostics: PromotionDiagnostic[];
}

export interface PromotionPreviewInput {
  definition: SavePromotionDefinitionInput;
  eventId?: string | null;
  eventPhase?: PromotionEventPhase | null;
  campaignId?: string | null;
  items: Array<{ product_id: string; quantity: number }>;
}

export interface PromotionSummary {
  id: string;
  name: string;
  detail: string;
  discountAmount: number;
  rewardQuantity: number;
}
