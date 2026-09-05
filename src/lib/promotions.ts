import { supabase } from '../supabaseClient';
import type { PromotionQuote, PromotionQuoteInput } from '../types/promotion';

const promotionErrorCodes = [
  'promotion_changed',
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

export const quotePromotions = async (input: PromotionQuoteInput): Promise<PromotionQuote> => {
  const { data, error } = await supabase.rpc('quote_sale_promotions', {
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
