export type PromotionTargetType = 'category' | 'tag' | 'category_tag' | 'product';
export type PromotionRuleType = 'discount' | 'free_items';
export type PromotionStatus = 'active' | 'inactive';
export type PromotionEventScope = 'all' | 'selected';

export interface PromotionRule {
  id: string;
  artist_id?: string;
  name?: string | null;
  target_type: PromotionTargetType;
  rule_type: PromotionRuleType;
  match_category?: string | null;
  match_tag?: string | null;
  match_product_id?: string | null;
  match_product_ids?: string[] | null;
  buy_quantity: number;
  reward_value?: number | null;
  reward_quantity?: number | null;
  priority?: number;
  status?: PromotionStatus;
  event_scope?: PromotionEventScope;
  event_ids?: string[] | null;
  excluded_event_ids?: string[] | null;
  starts_at?: string | null;
  ends_at?: string | null;
}

export interface PromotionProductLike {
  id: string;
  name: string;
  price: number;
  category?: string | null;
  tags?: string[];
}

export interface PromotionCartItemLike<TProduct extends PromotionProductLike = PromotionProductLike> {
  product: TProduct;
  quantity: number;
}

export interface AppliedPromotion {
  ruleId: string;
  label: string;
  discountAmount: number;
  bundleCount: number;
  message: string;
}

export interface PromotionProgressInsight {
  id: string;
  label: string;
  status: 'ready' | 'progress';
  message: string;
}

export interface ProductPromotionBreakdown {
  productId: string;
  ruleId: string;
  label: string;
  discountAmount: number;
  affectedQuantity: number;
  freeQuantity: number;
  message: string;
}

export interface PricingResult {
  subtotal: number;
  discountTotal: number;
  total: number;
  appliedPromotions: AppliedPromotion[];
  insights: PromotionProgressInsight[];
  lineBreakdowns: Record<string, ProductPromotionBreakdown[]>;
}

const normalize = (value?: string | null) => (value || '').trim().toLowerCase();

const targetPriority: Record<PromotionTargetType, number> = {
  product: 4,
  category_tag: 3,
  tag: 2,
  category: 1,
};

const buildAutoName = (rule: PromotionRule, productsById?: Map<string, PromotionProductLike>) => {
  const targetLabel = (() => {
    if (rule.target_type === 'product') {
      const ids = (rule.match_product_ids && rule.match_product_ids.length > 0)
        ? rule.match_product_ids
        : rule.match_product_id ? [rule.match_product_id] : [];
      if (ids.length <= 1) {
        return productsById?.get(ids[0] || '')?.name || 'Selected product';
      }
      return `${ids.length} selected products`;
    }
    if (rule.target_type === 'category_tag') {
      return `${rule.match_category || 'Category'} + ${rule.match_tag || 'Tag'}`;
    }
    if (rule.target_type === 'tag') return `Tag: ${rule.match_tag || '-'}`;
    return `Category: ${rule.match_category || '-'}`;
  })();

  if (rule.rule_type === 'discount') {
    return `${targetLabel} buy ${rule.buy_quantity} save ${rule.reward_value || 0}`;
  }

  return `${targetLabel} buy ${rule.buy_quantity} get ${rule.reward_quantity || 0}`;
};

export const getPromotionLabel = (rule: PromotionRule, productsById?: Map<string, PromotionProductLike>) =>
  (rule.name || '').trim() || buildAutoName(rule, productsById);

export const matchesPromotionRule = (product: PromotionProductLike, rule: PromotionRule) => {
  if ((rule.status || 'active') !== 'active') return false;

  const productCategory = normalize(product.category);
  const productTags = new Set((product.tags || []).map(normalize).filter(Boolean));

  if (rule.target_type === 'product') {
    const ids = new Set((rule.match_product_ids && rule.match_product_ids.length > 0)
      ? rule.match_product_ids
      : rule.match_product_id ? [rule.match_product_id] : []);
    return ids.has(product.id);
  }

  if (rule.target_type === 'category') {
    return productCategory === normalize(rule.match_category);
  }

  if (rule.target_type === 'tag') {
    return productTags.has(normalize(rule.match_tag));
  }

  return productCategory === normalize(rule.match_category) && productTags.has(normalize(rule.match_tag));
};

export const getPromotionBadgesForProduct = (
  product: PromotionProductLike,
  rules: PromotionRule[],
  productsById?: Map<string, PromotionProductLike>
) =>
  rules
    .filter((rule) => (rule.status || 'active') === 'active' && matchesPromotionRule(product, rule))
    .sort((a, b) => (targetPriority[b.target_type] - targetPriority[a.target_type]) || ((a.priority || 100) - (b.priority || 100)))
    .map((rule) => ({
      id: rule.id,
      label: getPromotionLabel(rule, productsById),
      shortLabel:
        rule.rule_type === 'discount'
          ? `${rule.buy_quantity} save ${rule.reward_value || 0}`
          : `${rule.buy_quantity}+${rule.reward_quantity || 0}`,
    }));

type WorkingEntry<TProduct extends PromotionProductLike> = {
  item: PromotionCartItemLike<TProduct>;
  remainingQty: number;
};

type QuantityAllocation<TProduct extends PromotionProductLike> = {
  entry: WorkingEntry<TProduct>;
  quantity: number;
  amount: number;
};

const takeCheapestAllocations = <TProduct extends PromotionProductLike>(entries: WorkingEntry<TProduct>[], qty: number) => {
  let remaining = qty;
  const allocations: QuantityAllocation<TProduct>[] = [];

  const cheapest = [...entries]
    .filter((entry) => entry.remainingQty > 0)
    .sort((a, b) => a.item.product.price - b.item.product.price);

  for (const entry of cheapest) {
    if (remaining <= 0) break;
    const units = Math.min(entry.remainingQty, remaining);
    allocations.push({
      entry,
      quantity: units,
      amount: units * entry.item.product.price,
    });
    remaining -= units;
  }

  return allocations;
};

const consumeEntries = <TProduct extends PromotionProductLike>(entries: WorkingEntry<TProduct>[], qty: number) => {
  let remaining = qty;
  const allocations: QuantityAllocation<TProduct>[] = [];
  const byHighestPrice = [...entries]
    .filter((entry) => entry.remainingQty > 0)
    .sort((a, b) => b.item.product.price - a.item.product.price);

  for (const entry of byHighestPrice) {
    if (remaining <= 0) break;
    const consumed = Math.min(entry.remainingQty, remaining);
    entry.remainingQty -= consumed;
    remaining -= consumed;
    allocations.push({
      entry,
      quantity: consumed,
      amount: consumed * entry.item.product.price,
    });
  }

  return allocations;
};

export const calculatePromotionPricing = <TProduct extends PromotionProductLike>(
  cart: PromotionCartItemLike<TProduct>[],
  rules: PromotionRule[]
): PricingResult => {
  const subtotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const activeRules = rules
    .filter((rule) => (rule.status || 'active') === 'active')
    .sort((a, b) => {
      const priorityDiff = targetPriority[b.target_type] - targetPriority[a.target_type];
      if (priorityDiff !== 0) return priorityDiff;
      return (a.priority || 100) - (b.priority || 100);
    });

  const workingEntries: WorkingEntry<TProduct>[] = cart.map((item) => ({
    item,
    remainingQty: item.quantity,
  }));

  const productsById = new Map(cart.map((item) => [item.product.id, item.product]));
  const appliedPromotions: AppliedPromotion[] = [];
  const lineBreakdowns: Record<string, ProductPromotionBreakdown[]> = {};

  const pushLineBreakdown = (productId: string, breakdown: ProductPromotionBreakdown) => {
    if (!lineBreakdowns[productId]) {
      lineBreakdowns[productId] = [];
    }
    lineBreakdowns[productId].push(breakdown);
  };

  for (const rule of activeRules) {
    const eligibleEntries = workingEntries.filter((entry) => entry.remainingQty > 0 && matchesPromotionRule(entry.item.product, rule));
    const eligibleQty = eligibleEntries.reduce((sum, entry) => sum + entry.remainingQty, 0);

    if (rule.rule_type === 'discount') {
      const bundleSize = Math.max(1, rule.buy_quantity);
      const bundleCount = Math.floor(eligibleQty / bundleSize);
      const requestedDiscountAmount = bundleCount * Number(rule.reward_value || 0);
      if (bundleCount <= 0 || requestedDiscountAmount <= 0) continue;

      const consumedAllocations = consumeEntries(eligibleEntries, bundleCount * bundleSize);
      const consumedTotalAmount = consumedAllocations.reduce((sum, allocation) => sum + allocation.amount, 0);
      const discountAmount = Math.min(requestedDiscountAmount, consumedTotalAmount);
      if (discountAmount <= 0) continue;
      const label = getPromotionLabel(rule, productsById);

      consumedAllocations.forEach((allocation, index) => {
        const proportionalDiscount = consumedTotalAmount <= 0
          ? 0
          : index === consumedAllocations.length - 1
            ? discountAmount - consumedAllocations.slice(0, -1).reduce((sum, prev) => sum + ((prev.amount / consumedTotalAmount) * discountAmount), 0)
            : (allocation.amount / consumedTotalAmount) * discountAmount;

        pushLineBreakdown(allocation.entry.item.product.id, {
          productId: allocation.entry.item.product.id,
          ruleId: rule.id,
          label,
          discountAmount: proportionalDiscount,
          affectedQuantity: allocation.quantity,
          freeQuantity: 0,
          message: `Bundle applied on ${allocation.quantity} item${allocation.quantity > 1 ? 's' : ''}` ,
        });
      });

      appliedPromotions.push({
        ruleId: rule.id,
        label,
        discountAmount,
        bundleCount,
        message: `${bundleCount} bundle${bundleCount > 1 ? 's' : ''} applied`,
      });
      continue;
    }

    const groupSize = Math.max(1, rule.buy_quantity + Number(rule.reward_quantity || 0));
    const bundleCount = Math.floor(eligibleQty / groupSize);
    const freeQty = bundleCount * Number(rule.reward_quantity || 0);
    if (bundleCount <= 0 || freeQty <= 0) continue;

    const freeAllocations = takeCheapestAllocations(eligibleEntries, freeQty);
    const discountAmount = freeAllocations.reduce((sum, allocation) => sum + allocation.amount, 0);
    if (discountAmount <= 0) continue;

    consumeEntries(eligibleEntries, bundleCount * groupSize);
    const label = getPromotionLabel(rule, productsById);

    freeAllocations.forEach((allocation) => {
      pushLineBreakdown(allocation.entry.item.product.id, {
        productId: allocation.entry.item.product.id,
        ruleId: rule.id,
        label,
        discountAmount: allocation.amount,
        affectedQuantity: allocation.quantity,
        freeQuantity: allocation.quantity,
        message: `${allocation.quantity} free item${allocation.quantity > 1 ? 's' : ''} applied`,
      });
    });

    appliedPromotions.push({
      ruleId: rule.id,
      label,
      discountAmount,
      bundleCount,
      message: `${freeQty} free item${freeQty > 1 ? 's' : ''} applied`,
    });
  }

  const discountTotal = appliedPromotions.reduce((sum, applied) => sum + applied.discountAmount, 0);

  const insights: PromotionProgressInsight[] = activeRules.flatMap((rule) => {
    const eligibleQty = cart
      .filter((item) => matchesPromotionRule(item.product, rule))
      .reduce((sum, item) => sum + item.quantity, 0);

    if (eligibleQty <= 0) {
      return [];
    }

    const threshold = rule.rule_type === 'discount'
      ? Math.max(1, rule.buy_quantity)
      : Math.max(1, rule.buy_quantity + Number(rule.reward_quantity || 0));

    const remainder = eligibleQty % threshold;
    const bundles = Math.floor(eligibleQty / threshold);
    const needed = remainder === 0 ? 0 : threshold - remainder;

    return [{
      id: rule.id,
      label: getPromotionLabel(rule, productsById),
      status: bundles > 0 && needed === 0 ? 'ready' : 'progress',
      message:
        bundles > 0 && needed === 0
          ? `Bundle ready. ${bundles} promotion set${bundles > 1 ? 's' : ''} in cart.`
          : `Add ${needed || threshold} more item${(needed || threshold) > 1 ? 's' : ''} to trigger this promotion.`,
    }];
  });

  return {
    subtotal,
    discountTotal,
    total: Math.max(0, subtotal - discountTotal),
    appliedPromotions,
    insights,
    lineBreakdowns,
  };
};
