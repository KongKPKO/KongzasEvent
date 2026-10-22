import { supabase } from '../supabaseClient';
import type { PromotionAssignment, PromotionDefinition, PromotionPreviewInput, PromotionPreviewResult, PromotionQuote, PromotionQuoteInput, SavePromotionDefinitionInput } from '../types/promotion';

const promotionErrorCodes = [
  'promotion_changed',
  'promotion_assignments_invalid',
  'promotion_not_found',
  'promotion_not_ready',
  'promotion_reward_not_in_channel',
  'promotion_gift_limit_below_committed',
  'promotion_reward_required',
  'promotion_discount_invalid',
  'promotion_product_invalid',
  'promotion_reward_product_invalid',
  'promotion_choice_required',
  'promotion_reward_unavailable',
  'promotion_rewards_exhausted',
  'promotion_conflict_unresolved',
  'promotion_context_required',
  'promotion_context_not_found',
  'promotion_context_closed',
  'promotion_event_phase_invalid',
  'promotion_items_invalid',
  'promotion_quantity_invalid',
  'promotion_duplicate_product',
  'sale_product_unavailable',
  'forbidden',
] as const;

export type PromotionErrorCode = (typeof promotionErrorCodes)[number] | 'promotion_request_failed';

export class PromotionError extends Error {
  constructor(public code: PromotionErrorCode) {
    super(code);
    this.name = 'PromotionError';
  }
}

export const toPromotionError = (error: unknown) => {
  const text = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message?: unknown }).message || '')
    : String(error || '');
  const code = promotionErrorCodes.find((candidate) => text.includes(candidate));
  return new PromotionError(code || 'promotion_request_failed');
};

export const requiresPromotionReview = (error: unknown) => [
  'promotion_changed', 'promotion_choice_required',
  'promotion_reward_unavailable', 'promotion_rewards_exhausted',
].includes(toPromotionError(error).code);

export const quotePromotions = async (input: PromotionQuoteInput): Promise<PromotionQuote> => {
  const { data, error } = input.orderId ? await supabase.rpc('quote_pos_order', {
    p_event_id: input.eventId, p_order_id: input.orderId, p_items: input.items,
    p_reward_choices: input.rewardChoices || [], p_promotion_choices: input.promotionChoices || [],
  }) : await supabase.rpc('quote_sale_promotions', {
    p_event_id: input.eventId || null,
    p_event_phase: input.eventPhase || null,
    p_campaign_id: input.campaignId || null,
    p_items: input.items,
    p_reward_choices: input.rewardChoices || [],
    p_promotion_choices: input.promotionChoices || [],
  });

  if (error) throw toPromotionError(error);
  return data as PromotionQuote;
};

export const getPromotionAssignmentConflicts = async (assignmentId: string) => {
  const { data, error } = await supabase.rpc('promotion_assignment_conflicts', {
    p_assignment_id: assignmentId,
  });

  if (error) throw toPromotionError(error);
  return data as {
    has_conflict: boolean;
    conflicts: Array<{
      assignment_id: string;
      promotion_id: string;
      promotion_name: string;
      overlapping_product_ids: string[];
      current_policy: 'combine' | 'exclusive';
      other_policy: 'combine' | 'exclusive';
    }>;
  };
};

export const listPromotionDefinitions = async (artistId: string): Promise<PromotionDefinition[]> => {
  // Read revisions first: a concurrent save may make this snapshot stale, but
  // cannot pair a new revision with older assignments and bypass the save guard.
  const definitionsResult = await supabase.from('artist_promotions').select('id,artist_id,name,promotion_type,target_type,match_category,match_tag,match_product_ids,buy_quantity,reward_value,reward_quantity,reward_selection_mode,tier_grant_mode,lifecycle_status,revision,v1_config').eq('artist_id', artistId).order('created_at', { ascending: false });
  if (definitionsResult.error) throw toPromotionError(definitionsResult.error);
  const [assignmentsResult, tiersResult, rewardsResult, giftUsageResult] = await Promise.all([
    supabase.from('promotion_assignments').select('*').eq('artist_id', artistId),
    supabase.from('promotion_tiers').select('*'),
    supabase.from('promotion_reward_products').select('*'),
    supabase.rpc('promotion_gift_usage', { p_artist_id: artistId }),
  ]);
  const error = definitionsResult.error || assignmentsResult.error || tiersResult.error || rewardsResult.error || giftUsageResult.error;
  if (error) throw toPromotionError(error);

  const assignments = assignmentsResult.data || [];
  const tiers = tiersResult.data || [];
  const rewards = rewardsResult.data || [];
  const giftUsage = (giftUsageResult.data || []) as Array<{ promotion_id: string; redeemed_quantity: number; held_quantity: number; remaining_quantity: number | null }>;
  return (definitionsResult.data || []).map((definition) => ({
    ...definition,
    buy_quantity: definition.buy_quantity === null ? null : Number(definition.buy_quantity),
    reward_value: definition.reward_value === null ? null : Number(definition.reward_value),
    reward_quantity: definition.reward_quantity === null ? null : Number(definition.reward_quantity),
    revision: Number(definition.revision),
    assignments: assignments.filter((assignment) => assignment.promotion_id === definition.id),
    tiers: tiers.filter((tier) => tier.promotion_id === definition.id).map((tier) => ({
      ...tier,
      threshold_amount: Number(tier.threshold_amount),
      reward_product_ids: rewards.filter((reward) => reward.promotion_tier_id === tier.id).map((reward) => reward.product_id),
    })),
    reward_product_ids: rewards.filter((reward) => reward.promotion_id === definition.id && !reward.promotion_tier_id).map((reward) => reward.product_id),
    v1_config: definition.v1_config,
    gift_usage: giftUsage.find((usage) => usage.promotion_id === definition.id) || null,
  })) as PromotionDefinition[];
};

export const previewPromotionDefinition = async (input: PromotionPreviewInput): Promise<PromotionPreviewResult> => {
  const { data, error } = await supabase.rpc('preview_promotion_definition', {
    p_definition: input.definition,
    p_event_id: input.eventId || null,
    p_event_phase: input.eventPhase || null,
    p_campaign_id: input.campaignId || null,
    p_items: input.items,
  });
  if (error) throw toPromotionError(error);
  return data as PromotionPreviewResult;
};

export const savePromotionDefinition = async (definition: SavePromotionDefinitionInput) => {
  const { data, error } = await supabase.rpc('save_promotion_definition', { p_definition: definition });
  if (error?.message.includes('promotion_conflict_confirmation_required')) {
    const detail = JSON.parse(error.details);
    throw new PromotionSaveConflict(detail.confirmation_token, detail.conflicts.map((conflict: { promotion_name: string }) => conflict.promotion_name));
  }
  if (error) throw toPromotionError(error);
  return data as string;
};

export class PromotionSaveConflict extends Error {
  constructor(public token: string, public promotionNames: string[]) {
    super('promotion_conflict_confirmation_required');
  }
}

export const archivePromotionDefinition = async (promotionId: string) => {
  const { data, error } = await supabase.rpc('archive_promotion_definition', { p_promotion_id: promotionId });
  if (error) throw toPromotionError(error);
  return Boolean(data);
};


export interface SaveEventPromotionSelectionInput {
  eventId: string;
  promotionId: string;
  expectedRevision: number;
  assignments: Array<Pick<PromotionAssignment, 'event_phase' | 'starts_at' | 'ends_at' | 'combination_policy'>>;
  confirmationToken?: string;
}

export const saveEventPromotionSelection = async (input: SaveEventPromotionSelectionInput) => {
  const { data, error } = await supabase.rpc('save_event_promotion_selection', {
    p_event_id: input.eventId, p_promotion_id: input.promotionId,
    p_expected_revision: input.expectedRevision, p_assignments: input.assignments,
    p_confirmation_token: input.confirmationToken || null,
  });
  if (error?.message.includes('promotion_conflict_confirmation_required')) {
    const detail = JSON.parse(error.details);
    throw new PromotionSaveConflict(detail.confirmation_token, detail.conflicts.map((conflict: { promotion_name: string }) => conflict.promotion_name));
  }
  if (error) throw toPromotionError(error);
  return data as string;
};
