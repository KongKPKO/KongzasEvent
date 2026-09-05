import { expect, test } from '@playwright/test';
import { summarizePromotionQuote } from '../utils/promotionPricing';
import type { PromotionQuote } from '../types/promotion';

const baseQuote: PromotionQuote = {
  subtotal: 1200,
  discount_total: 100,
  merchandise_total: 1100,
  shipping_fee: 0,
  total: 1100,
  pricing_hash: 'quote-v1',
  applied_promotions: [
    {
      id: 'promotion-1',
      assignment_id: 'assignment-1',
      revision: 2,
      name: 'ทุก 3 ชิ้น ลด ฿50',
      rule_text: 'ทุก 3 ชิ้นที่ร่วมรายการ ลด ฿50',
      bundle_count: 2,
      discount_amount: 100,
      reached_tier_ids: [],
      rewards: [],
    },
  ],
  reward_lines: [],
  required_choices: [],
};

test('summarizes repeating promotion groups from an authoritative quote', () => {
  const summary = summarizePromotionQuote(baseQuote);

  expect(summary).toEqual([
    expect.objectContaining({
      id: 'promotion-1',
      detail: expect.stringContaining('2'),
      discountAmount: 100,
    }),
  ]);
});

test('summarizes zero-price reward lines without adding merchandise value', () => {
  const summary = summarizePromotionQuote({
    ...baseQuote,
    discount_total: 0,
    merchandise_total: 1200,
    total: 1200,
    applied_promotions: [
      {
        ...baseQuote.applied_promotions[0],
        name: 'ทุก 3 ชิ้น รับของแถม 1 ชิ้น',
        discount_amount: 0,
        rewards: [{ product_id: 'gift-1', name: 'Postcard', sku: 'GFT-POST-001', quantity: 2 }],
      },
    ],
    reward_lines: [
      {
        product_id: 'gift-1',
        name: 'Postcard',
        sku: 'GFT-POST-001',
        quantity: 2,
        promotion_id: 'promotion-1',
        assignment_id: 'assignment-1',
        tier_id: null,
        is_unlimited: false,
      },
    ],
  });

  expect(summary[0]).toEqual(expect.objectContaining({ rewardQuantity: 2, discountAmount: 0 }));
});
