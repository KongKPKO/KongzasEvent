import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { Button } from '../ui';
import { BarChart3, CalendarClock, Copy, Edit2, Gift, Layers3, Loader, Plus, Search, Sparkles, Tag, TicketPercent, Trash2, X } from 'lucide-react';
import type { PromotionRule, PromotionRuleType, PromotionTargetType } from '../../utils/promotionPricing';
import { getPromotionLabel, matchesPromotionRule } from '../../utils/promotionPricing';
import { formatPrice } from '../../utils/currency';

interface ProductLite {
  id: string;
  name: string;
  price?: number;
  currency?: string;
  category?: string;
  tags?: string[];
  variant_group_name?: string | null;
  variant_name?: string | null;
}

interface EventLite {
  id: string;
  event_name: string;
  start_date: string;
  end_date: string;
  status: string;
}

interface PromotionAnalytics {
  rule_id: string;
  order_count: number;
  bundle_count: number;
  discount_total: number;
  last_used_at: string | null;
}

interface PromotionManagerProps {
  artistId: string;
  products: ProductLite[];
  eventOptions: EventLite[];
  categorySuggestions: string[];
  tagSuggestions: string[];
  lockedEventId?: string;
  lockedEventName?: string;
}

type PromotionFormTargetType = PromotionTargetType | 'product_line';

const targetTypeOptions: Array<{ value: PromotionFormTargetType; label: string }> = [
  { value: 'category', label: 'Category' },
  { value: 'product_line', label: 'Product line' },
  { value: 'tag', label: 'Tag' },
  { value: 'category_tag', label: 'Category + Tag' },
  { value: 'product', label: 'Specific product' },
];

const ruleTypeOptions: Array<{ value: PromotionRuleType; label: string }> = [
  { value: 'discount', label: 'Buy X, discount Y' },
  { value: 'free_items', label: 'Buy X, get Y free' },
];

const promotionSelectColumns = 'id, artist_id, name, target_type, rule_type, match_category, match_tag, match_product_id, match_product_ids, buy_quantity, reward_value, reward_quantity, priority, status, event_scope, event_ids, excluded_event_ids, starts_at, ends_at, created_at';
const fallbackPromotionSelectColumns = 'id, artist_id, name, target_type, rule_type, match_category, match_tag, match_product_id, match_product_ids, buy_quantity, reward_value, reward_quantity, priority, status, event_scope, event_ids, starts_at, ends_at, created_at';

export default function PromotionManager({
  artistId,
  products,
  eventOptions,
  categorySuggestions,
  tagSuggestions,
  lockedEventId,
  lockedEventName,
}: PromotionManagerProps) {
  const [promotions, setPromotions] = useState<PromotionRule[]>([]);
  const [analytics, setAnalytics] = useState<PromotionAnalytics[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingPromotionId, setEditingPromotionId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [targetType, setTargetType] = useState<PromotionFormTargetType>('category');
  const [ruleType, setRuleType] = useState<PromotionRuleType>('discount');
  const [eventScope, setEventScope] = useState<'all' | 'selected'>('all');
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [matchCategory, setMatchCategory] = useState('');
  const [matchTag, setMatchTag] = useState('');
  const [matchProductLine, setMatchProductLine] = useState('');
  const [matchProductIds, setMatchProductIds] = useState<string[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [buyQuantity, setBuyQuantity] = useState('3');
  const [rewardValue, setRewardValue] = useState('');
  const [rewardQuantity, setRewardQuantity] = useState('1');

  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, { ...product, price: Number(product.price || 0) }])),
    [products]
  );
  const productLineSuggestions = useMemo(
    () => Array.from(new Set(products.map((product) => product.variant_group_name?.trim()).filter(Boolean) as string[])).sort(),
    [products]
  );
  const productLineProductIds = useMemo(
    () => products
      .filter((product) => (product.variant_group_name || '').trim().toLowerCase() === matchProductLine.trim().toLowerCase())
      .map((product) => product.id),
    [matchProductLine, products]
  );
  const effectiveSelectedEventIds = useMemo(
    () => lockedEventId ? [lockedEventId] : selectedEventIds,
    [lockedEventId, selectedEventIds]
  );

  const analyticsByRuleId = useMemo(
    () => new Map(analytics.map((row) => [row.rule_id, row])),
    [analytics]
  );

  const formatDateTimeLocal = (iso?: string | null) => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 16);
  };

  const toIsoOrNull = (value: string) => value ? new Date(value).toISOString() : null;
  const effectiveEventName = lockedEventName || eventOptions.find((event) => event.id === lockedEventId)?.event_name || 'This event';

  const fetchPromotions = async () => {
    if (!artistId) return;
    setLoading(true);
    try {
      const buildQuery = (columns: string) => supabase
        .from('artist_promotions')
        .select(columns)
        .eq('artist_id', artistId)
        .order('status', { ascending: true })
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false });

      let { data, error } = await buildQuery(promotionSelectColumns);
      if (error && /excluded_event_ids/i.test(error.message || '')) {
        const fallback = await buildQuery(fallbackPromotionSelectColumns);
        data = fallback.data;
        error = fallback.error;
      }

      if (error) throw error;
      const scopedPromotions = ((data || []) as unknown as PromotionRule[]).filter((promotion) => {
        if (!lockedEventId) return true;
        if ((promotion.event_scope || 'all') === 'all') return true;
        return (promotion.event_ids || []).includes(lockedEventId);
      });
      setPromotions(scopedPromotions);
    } catch (error) {
      console.error('[PromotionManager] fetchPromotions failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAnalytics = async () => {
    if (!artistId) return;
    const { data, error } = await supabase.rpc('get_promotion_analytics', { p_artist_id: artistId });
    if (error) {
      console.error('[PromotionManager] fetchAnalytics failed:', error);
      setAnalytics([]);
      return;
    }
    setAnalytics((data || []) as PromotionAnalytics[]);
  };

  useEffect(() => {
    fetchPromotions();
    fetchAnalytics();
  }, [artistId, lockedEventId]);

  useEffect(() => {
    if (!lockedEventId) return;
    setEventScope('selected');
    setSelectedEventIds([lockedEventId]);
  }, [lockedEventId]);

  const resetForm = () => {
    setEditingPromotionId(null);
    setName('');
    setTargetType('category');
    setRuleType('discount');
    setEventScope(lockedEventId ? 'selected' : 'all');
    setSelectedEventIds(lockedEventId ? [lockedEventId] : []);
    setStartsAt('');
    setEndsAt('');
    setMatchCategory('');
    setMatchTag('');
    setMatchProductLine('');
    setMatchProductIds([]);
    setProductSearch('');
    setBuyQuantity('3');
    setRewardValue('');
    setRewardQuantity('1');
  };

  const loadPromotionIntoForm = (promotion: PromotionRule, mode: 'edit' | 'duplicate') => {
    setEditingPromotionId(mode === 'edit' ? promotion.id : null);
    setName(mode === 'duplicate' ? `${promotion.name || getPromotionLabel(promotion, productsById)} copy` : promotion.name || '');
    setTargetType(promotion.target_type);
    setRuleType(promotion.rule_type);
    setEventScope(lockedEventId ? 'selected' : promotion.event_scope || 'all');
    setSelectedEventIds(lockedEventId ? [lockedEventId] : promotion.event_scope === 'selected' ? (promotion.event_ids || []) : []);
    setStartsAt(formatDateTimeLocal(promotion.starts_at));
    setEndsAt(formatDateTimeLocal(promotion.ends_at));
    setMatchCategory(promotion.match_category || '');
    setMatchTag(promotion.match_tag || '');
    setMatchProductLine('');
    setMatchProductIds(
      promotion.match_product_ids && promotion.match_product_ids.length > 0
        ? promotion.match_product_ids
        : promotion.match_product_id ? [promotion.match_product_id] : []
    );
    setProductSearch('');
    setBuyQuantity(String(promotion.buy_quantity || 1));
    setRewardValue(promotion.rule_type === 'discount' ? String(promotion.reward_value || '') : '');
    setRewardQuantity(promotion.rule_type === 'free_items' ? String(promotion.reward_quantity || 1) : '1');
    if (mode === 'duplicate') {
      window.requestAnimationFrame(() => {
        document.getElementById('promotion-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!artistId) return;

    const buyQty = Number(buyQuantity);
    const discountValue = rewardValue === '' ? null : Number(rewardValue);
    const freeQty = Number(rewardQuantity);
    const startIso = toIsoOrNull(startsAt);
    const endIso = toIsoOrNull(endsAt);

    if (!Number.isInteger(buyQty) || buyQty <= 0) {
      alert('Buy quantity must be an integer greater than 0.');
      return;
    }

    if ((lockedEventId || eventScope === 'selected') && effectiveSelectedEventIds.length === 0) {
      alert('Please select at least one event, or switch the promotion to all events.');
      return;
    }

    if (startIso && endIso && new Date(startIso).getTime() >= new Date(endIso).getTime()) {
      alert('Active window start must be before the end time.');
      return;
    }

    if (targetType === 'product' && matchProductIds.length === 0) {
      alert('Please select at least one product for this promotion.');
      return;
    }
    if (targetType === 'product_line' && productLineProductIds.length === 0) {
      alert('Please select a product line with at least one product.');
      return;
    }
    if (targetType === 'category' && !matchCategory.trim()) {
      alert('Please enter a category.');
      return;
    }
    if (targetType === 'tag' && !matchTag.trim()) {
      alert('Please enter a tag.');
      return;
    }
    if (targetType === 'category_tag' && (!matchCategory.trim() || !matchTag.trim())) {
      alert('Please enter both category and tag.');
      return;
    }

    if (ruleType === 'discount' && (!discountValue || discountValue <= 0)) {
      alert('Discount value must be greater than 0.');
      return;
    }
    if (ruleType === 'free_items' && (!Number.isInteger(freeQty) || freeQty <= 0)) {
      alert('Free quantity must be an integer greater than 0.');
      return;
    }

    setSaving(true);
    try {
      const persistedTargetType: PromotionTargetType = targetType === 'product_line' ? 'product' : targetType;
      const persistedProductIds = targetType === 'product_line' ? productLineProductIds : matchProductIds;
      const payload = {
        artist_id: artistId,
        name: name.trim() || (targetType === 'product_line' ? matchProductLine.trim() : null),
        target_type: persistedTargetType,
        rule_type: ruleType,
        match_category: targetType === 'category' || targetType === 'category_tag' ? matchCategory.trim() : null,
        match_tag: targetType === 'tag' || targetType === 'category_tag' ? matchTag.trim() : null,
        match_product_id: null,
        match_product_ids: persistedTargetType === 'product' ? persistedProductIds : null,
        buy_quantity: buyQty,
        reward_value: ruleType === 'discount' ? discountValue : null,
        reward_quantity: ruleType === 'free_items' ? freeQty : null,
        priority: persistedTargetType === 'product' ? 10 : targetType === 'category_tag' ? 20 : targetType === 'tag' ? 30 : 40,
        status: 'active' as const,
        event_scope: lockedEventId ? 'selected' as const : eventScope,
        event_ids: lockedEventId ? [lockedEventId] : eventScope === 'selected' ? effectiveSelectedEventIds : null,
        starts_at: startIso,
        ends_at: endIso,
      };

      const { error } = editingPromotionId
        ? await supabase.from('artist_promotions').update(payload).eq('id', editingPromotionId)
        : await supabase.from('artist_promotions').insert(payload);
      if (error) throw error;

      resetForm();
      await fetchPromotions();
      await fetchAnalytics();
    } catch (error: any) {
      console.error('[PromotionManager] save failed:', error);
      alert(error.message || 'Failed to save promotion');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (promotion: PromotionRule) => {
    try {
      const nextStatus = (promotion.status || 'active') === 'active' ? 'inactive' : 'active';
      const { error } = await supabase
        .from('artist_promotions')
        .update({ status: nextStatus })
        .eq('id', promotion.id);
      if (error) throw error;
      await fetchPromotions();
      await fetchAnalytics();
    } catch (error: any) {
      console.error('[PromotionManager] toggle failed:', error);
      alert(error.message || 'Failed to update promotion status');
    }
  };

  const handleToggleEventExclusion = async (promotion: PromotionRule) => {
    if (!lockedEventId) return;
    try {
      const excludedEventIds = promotion.excluded_event_ids || [];
      const isExcluded = excludedEventIds.includes(lockedEventId);
      const nextExcludedEventIds = isExcluded
        ? excludedEventIds.filter((eventId) => eventId !== lockedEventId)
        : Array.from(new Set([...excludedEventIds, lockedEventId]));
      const { error } = await supabase
        .from('artist_promotions')
        .update({ excluded_event_ids: nextExcludedEventIds.length > 0 ? nextExcludedEventIds : null })
        .eq('id', promotion.id);
      if (error) throw error;
      await fetchPromotions();
      await fetchAnalytics();
    } catch (error: any) {
      console.error('[PromotionManager] event exclusion toggle failed:', error);
      alert(error.message || 'Failed to update this event promotion. If this is a fresh local DB, apply the latest promotion exclusion migration first.');
    }
  };

  const handleDelete = async (promotionId: string) => {
    if (!confirm('Delete this promotion?')) return;
    try {
      const { error } = await supabase.from('artist_promotions').delete().eq('id', promotionId);
      if (error) throw error;
      await fetchPromotions();
      await fetchAnalytics();
    } catch (error: any) {
      console.error('[PromotionManager] delete failed:', error);
      alert(error.message || 'Failed to delete promotion');
    }
  };

  const toggleProductSelection = (productId: string) => {
    setMatchProductIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId]
    );
  };

  const toggleEventSelection = (eventId: string) => {
    setSelectedEventIds((prev) =>
      prev.includes(eventId)
        ? prev.filter((id) => id !== eventId)
        : [...prev, eventId]
    );
  };

  const draftPromotion = useMemo<PromotionRule | null>(() => {
    const buyQty = Number(buyQuantity);
    const discountValue = rewardValue === '' ? null : Number(rewardValue);
    const freeQty = Number(rewardQuantity);
    if (!Number.isInteger(buyQty) || buyQty <= 0) return null;
    if (ruleType === 'discount' && (!discountValue || discountValue <= 0)) return null;
    if (ruleType === 'free_items' && (!Number.isInteger(freeQty) || freeQty <= 0)) return null;
    const previewTargetType: PromotionTargetType = targetType === 'product_line' ? 'product' : targetType;
    const previewProductIds = targetType === 'product_line' ? productLineProductIds : matchProductIds;

    return {
      id: editingPromotionId || 'draft',
      artist_id: artistId,
      name: name || null,
      target_type: previewTargetType,
      rule_type: ruleType,
      match_category: targetType === 'category' || targetType === 'category_tag' ? matchCategory : null,
      match_tag: targetType === 'tag' || targetType === 'category_tag' ? matchTag : null,
      match_product_id: null,
      match_product_ids: previewTargetType === 'product' ? previewProductIds : null,
      buy_quantity: buyQty,
      reward_value: ruleType === 'discount' ? discountValue : null,
      reward_quantity: ruleType === 'free_items' ? freeQty : null,
      status: 'active',
      event_scope: lockedEventId ? 'selected' : eventScope,
      event_ids: lockedEventId ? [lockedEventId] : eventScope === 'selected' ? effectiveSelectedEventIds : null,
      starts_at: toIsoOrNull(startsAt),
      ends_at: toIsoOrNull(endsAt),
    };
  }, [artistId, buyQuantity, editingPromotionId, endsAt, eventScope, lockedEventId, matchCategory, matchProductIds, matchProductLine, matchTag, name, productLineProductIds, rewardQuantity, rewardValue, ruleType, effectiveSelectedEventIds, startsAt, targetType]);

  const previewProducts = useMemo(() => {
    if (!draftPromotion) return [];
    return products.filter((product) =>
      matchesPromotionRule({ ...product, price: Number(product.price || 0) }, draftPromotion)
    );
  }, [draftPromotion, products]);

  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) return products;
    return products.filter((product) =>
      product.name.toLowerCase().includes(query) ||
      (product.category || '').toLowerCase().includes(query) ||
      (product.variant_group_name || '').toLowerCase().includes(query) ||
      (product.variant_name || '').toLowerCase().includes(query) ||
      (product.tags || []).some((tag) => tag.toLowerCase().includes(query))
    );
  }, [productSearch, products]);

  const isPromotionStoppedForThisEvent = (promotion: PromotionRule) =>
    Boolean(lockedEventId && (promotion.excluded_event_ids || []).includes(lockedEventId));
  const isPromotionActiveHere = (promotion: PromotionRule) =>
    (promotion.status || 'active') === 'active' && !isPromotionStoppedForThisEvent(promotion);
  const inheritedPromotionCount = lockedEventId
    ? promotions.filter((promotion) => (promotion.event_scope || 'all') === 'all').length
    : 0;
  const activePromotionCount = promotions.filter(isPromotionActiveHere).length;
  const selectedScopeLabel = lockedEventId
    ? effectiveEventName
    : eventScope === 'selected'
      ? `${effectiveSelectedEventIds.length} selected event${effectiveSelectedEventIds.length === 1 ? '' : 's'}`
      : 'All events';
  const isFreeItemRule = ruleType === 'free_items';
  const rewardFieldLabel = isFreeItemRule ? 'Get free Y' : 'Discount Y';
  const rewardFieldValue = isFreeItemRule ? rewardQuantity : rewardValue;
  const draftWindowLabel = startsAt || endsAt
    ? `${startsAt ? `Starts ${new Date(toIsoOrNull(startsAt) || '').toLocaleString()}` : 'Starts now'} · ${endsAt ? `Ends ${new Date(toIsoOrNull(endsAt) || '').toLocaleString()}` : 'No end date'}`
    : 'Always active';
  const totalDiscount = analytics.reduce((sum, row) => sum + Number(row.discount_total || 0), 0);
  const fieldClass = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-gray-800 shadow-sm shadow-gray-100/50 focus:border-pink-300 focus:outline-none focus:ring-2 focus:ring-pink-100 disabled:bg-gray-100 disabled:text-gray-400';
  const labelClass = 'mb-1.5 block text-[11px] font-black uppercase tracking-wide text-gray-400';

  return (
    <section className="mb-6 space-y-5">
      <div className="overflow-hidden rounded-2xl border border-pink-100 bg-white shadow-sm">
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-pink-50 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-pink-700">
              <TicketPercent size={14} />
              Promotions
            </div>
            <h2 className="mt-3 text-2xl font-black leading-tight text-gray-950">
              {lockedEventId ? 'Event promotion setup' : 'Promotion workspace'}
            </h2>
            <p className="mt-1 text-sm font-semibold text-gray-500">
              {lockedEventId ? effectiveEventName : 'Campaign rules for customer menu and POS.'}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-gray-50 p-3 ring-1 ring-gray-100">
              <div className="text-xl font-black text-gray-950">{promotions.length}</div>
              <div className="text-[10px] font-black uppercase tracking-wide text-gray-400">{lockedEventId ? 'Shown' : 'Rules'}</div>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-100">
              <div className="text-xl font-black text-emerald-700">{activePromotionCount}</div>
              <div className="text-[10px] font-black uppercase tracking-wide text-emerald-600">{lockedEventId ? 'Applied' : 'Active'}</div>
            </div>
            <div className="rounded-xl bg-pink-50 p-3 ring-1 ring-pink-100">
              <div className="truncate text-xl font-black text-pink-700">{lockedEventId ? inheritedPromotionCount : formatPrice(totalDiscount, products[0]?.currency)}</div>
              <div className="text-[10px] font-black uppercase tracking-wide text-pink-600">{lockedEventId ? 'Inherited' : 'Saved'}</div>
            </div>
          </div>
        </div>
      </div>

      <div className={editingPromotionId ? 'fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-gray-950/55 p-4 backdrop-blur-sm' : ''}>
        <div className={editingPromotionId ? 'my-6 w-full max-w-5xl rounded-2xl bg-white p-4 shadow-2xl' : 'rounded-2xl border border-gray-100 bg-white p-4 shadow-sm'}>
          {editingPromotionId && (
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-lg font-black text-gray-900">Edit Promotion</h3>
                <p className="mt-1 text-xs font-semibold text-gray-500">Update this saved rule.</p>
              </div>
              <button
                type="button"
                onClick={resetForm}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50"
                aria-label="Close edit promotion"
              >
                <X size={18} />
              </button>
            </div>
          )}

          <form id="promotion-form" onSubmit={handleSave} className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[1.05fr_1fr]">
              <div className="space-y-4">
                <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-pink-50 text-pink-600 ring-1 ring-pink-100">
                      <Gift size={18} />
                    </span>
                    <div>
                      <h3 className="text-sm font-black text-gray-900">Offer</h3>
                      <p className="text-xs font-semibold text-gray-500">Buy condition and reward.</p>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="md:col-span-2">
                      <span className={labelClass}>Promotion Name</span>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Optional display name"
                        className={fieldClass}
                      />
                    </label>
                    <label>
                      <span className={labelClass}>Rule Type</span>
                      <select
                        value={ruleType}
                        onChange={(e) => {
                          const nextRuleType = e.target.value as PromotionRuleType;
                          setRuleType(nextRuleType);
                          if (nextRuleType === 'discount') {
                            setRewardQuantity('1');
                          } else {
                            setRewardValue('');
                          }
                        }}
                        className={fieldClass}
                      >
                        {ruleTypeOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className={labelClass}>Buy X</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={buyQuantity}
                        onChange={(e) => setBuyQuantity(e.target.value)}
                        className={fieldClass}
                      />
                    </label>
                    <label key={ruleType} className="md:col-span-2">
                      <span className={labelClass}>{rewardFieldLabel}</span>
                      <input
                        type="number"
                        min="1"
                        step={isFreeItemRule ? '1' : '0.01'}
                        value={rewardFieldValue}
                        onChange={(e) => {
                          if (isFreeItemRule) {
                            setRewardQuantity(e.target.value);
                          } else {
                            setRewardValue(e.target.value);
                          }
                        }}
                        className={fieldClass}
                      />
                      {!isFreeItemRule && (
                        <p className="mt-1 text-[11px] font-semibold text-gray-400">
                          Uses the checkout currency for the selected event or product.
                        </p>
                      )}
                    </label>
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-100 bg-white p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-gray-100 text-gray-700">
                      <Layers3 size={18} />
                    </span>
                    <div>
                      <h3 className="text-sm font-black text-gray-900">Scope</h3>
                      <p className="text-xs font-semibold text-gray-500">{selectedScopeLabel}</p>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <label>
                      <span className={labelClass}>Event Scope</span>
                      {lockedEventId ? (
                        <div className={`${fieldClass} text-pink-700`}>{effectiveEventName}</div>
                      ) : (
                        <select
                          value={eventScope}
                          onChange={(e) => {
                            const nextScope = e.target.value as 'all' | 'selected';
                            setEventScope(nextScope);
                            if (nextScope === 'all') setSelectedEventIds([]);
                          }}
                          className={fieldClass}
                        >
                          <option value="all">All events</option>
                          <option value="selected">Selected events only</option>
                        </select>
                      )}
                    </label>
                    <label>
                      <span className={labelClass}>Product Scope</span>
                      <select
                        value={targetType}
                        onChange={(e) => {
                          const nextTargetType = e.target.value as PromotionFormTargetType;
                          setTargetType(nextTargetType);
                          if (nextTargetType !== 'product_line') setMatchProductLine('');
                          if (nextTargetType !== 'product') setMatchProductIds([]);
                        }}
                        className={fieldClass}
                      >
                        {targetTypeOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>

                    {!lockedEventId && eventScope === 'selected' && (
                      <div className="md:col-span-2">
                        <span className={labelClass}>Events</span>
                        <div className="grid max-h-36 gap-2 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50 p-2 md:grid-cols-2">
                          {eventOptions.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-400">
                              No confirmed events yet.
                            </div>
                          ) : eventOptions.map((event) => {
                            const checked = selectedEventIds.includes(event.id);
                            return (
                              <label key={event.id} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-xs font-black ${checked ? 'bg-pink-50 text-pink-700 ring-1 ring-pink-100' : 'bg-white text-gray-600 ring-1 ring-gray-100'}`}>
                                <input type="checkbox" checked={checked} onChange={() => toggleEventSelection(event.id)} />
                                <span className="truncate">{event.event_name}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {(targetType === 'category' || targetType === 'category_tag') && (
                      <label>
                        <span className={labelClass}>Category</span>
                        <input
                          list="promotion-category-suggestions"
                          type="text"
                          value={matchCategory}
                          onChange={(e) => setMatchCategory(e.target.value)}
                          className={fieldClass}
                          placeholder="Photocard"
                        />
                        <datalist id="promotion-category-suggestions">
                          {categorySuggestions.map((category) => <option key={category} value={category} />)}
                        </datalist>
                      </label>
                    )}

                    {targetType === 'product_line' && (
                      <label className="md:col-span-2">
                        <span className={labelClass}>Product line</span>
                        <input
                          list="promotion-product-line-suggestions"
                          type="text"
                          value={matchProductLine}
                          onChange={(e) => setMatchProductLine(e.target.value)}
                          className={fieldClass}
                          placeholder="Sticker Bualoi"
                        />
                        <datalist id="promotion-product-line-suggestions">
                          {productLineSuggestions.map((line) => <option key={line} value={line} />)}
                        </datalist>
                        <p className="mt-1 text-[11px] font-semibold text-gray-400">
                          Matches products sharing the same product line, then saves them as selected products.
                        </p>
                      </label>
                    )}

                    {(targetType === 'tag' || targetType === 'category_tag') && (
                      <label>
                        <span className={labelClass}>Tag</span>
                        <input
                          list="promotion-tag-suggestions"
                          type="text"
                          value={matchTag}
                          onChange={(e) => setMatchTag(e.target.value)}
                          className={fieldClass}
                          placeholder="Genshin Impact"
                        />
                        <datalist id="promotion-tag-suggestions">
                          {tagSuggestions.map((tag) => <option key={tag} value={tag} />)}
                        </datalist>
                      </label>
                    )}

                    {targetType === 'product' && (
                      <div className="md:col-span-2">
                        <span className={labelClass}>Products</span>
                        <div className="relative mb-2">
                          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                          <input
                            type="search"
                            value={productSearch}
                            onChange={(e) => setProductSearch(e.target.value)}
                            placeholder="Search products..."
                            className={`${fieldClass} pl-9`}
                          />
                        </div>
                        <div className="max-h-44 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50 p-2">
                          {filteredProducts.map((product) => {
                            const checked = matchProductIds.includes(product.id);
                            return (
                              <label key={product.id} className={`mb-1 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm last:mb-0 ${checked ? 'bg-pink-50 text-pink-700 ring-1 ring-pink-100' : 'bg-white text-gray-700 ring-1 ring-gray-100'}`}>
                                <input type="checkbox" checked={checked} onChange={() => toggleProductSelection(product.id)} />
                                <span className="min-w-0 flex-1 truncate font-bold">
                                  {product.name}
                                  {product.variant_group_name && (
                                    <span className="ml-1 text-xs text-gray-400">· {product.variant_group_name}</span>
                                  )}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                        <p className="mt-1 text-xs font-bold text-gray-400">{matchProductIds.length} product(s) selected</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-gray-100 bg-white p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-700 ring-1 ring-blue-100">
                      <CalendarClock size={18} />
                    </span>
                    <div>
                      <h3 className="text-sm font-black text-gray-900">Schedule</h3>
                      <p className="text-xs font-semibold text-gray-500">{draftWindowLabel}</p>
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                    <label>
                      <span className={labelClass}>Starts At</span>
                      <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={fieldClass} />
                    </label>
                    <label>
                      <span className={labelClass}>Ends At</span>
                      <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={fieldClass} />
                    </label>
                  </div>
                </div>

                <div className="rounded-2xl border border-pink-100 bg-pink-50/50 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-wide text-pink-600">Preview</div>
                      <div className="mt-1 text-3xl font-black text-gray-950">{previewProducts.length}</div>
                      <div className="text-xs font-bold text-gray-500">eligible product{previewProducts.length === 1 ? '' : 's'}</div>
                    </div>
                    <Sparkles className="text-pink-500" size={24} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {previewProducts.slice(0, 8).map((product) => (
                      <span key={product.id} className="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-gray-700 ring-1 ring-pink-100">
                        {product.name}
                      </span>
                    ))}
                    {previewProducts.length > 8 && (
                      <span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-gray-400 ring-1 ring-pink-100">
                        +{previewProducts.length - 8} more
                      </span>
                    )}
                    {previewProducts.length === 0 && (
                      <span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-gray-400 ring-1 ring-pink-100">
                        No products matched
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  {editingPromotionId && (
                    <Button
                      type="button"
                      onClick={resetForm}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-xs font-black text-gray-700 transition-all hover:bg-gray-50 active:scale-95"
                    >
                      <X size={14} />
                      Close
                    </Button>
                  )}
                  <Button
                    type="submit"
                    disabled={saving}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-pink-600 px-5 text-xs font-black text-white shadow-md shadow-pink-100 transition-all hover:bg-pink-700 active:scale-95 disabled:bg-pink-300"
                  >
                    {saving ? <Loader className="animate-spin" size={14} /> : editingPromotionId ? <Edit2 size={14} /> : <Plus size={14} />}
                    {saving ? 'Saving...' : editingPromotionId ? 'Save Promotion' : 'Add Promotion'}
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gray-100 text-gray-700">
              <Tag size={16} />
            </span>
            <div>
              <h3 className="text-sm font-black text-gray-900">Promotion Rules</h3>
              <p className="text-xs font-semibold text-gray-500">{promotions.length} saved rule{promotions.length === 1 ? '' : 's'}</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-sm font-semibold text-gray-400">Loading promotions...</div>
        ) : promotions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm font-semibold text-gray-400">No promotions yet.</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {promotions.map((promotion) => {
              const rowAnalytics = analyticsByRuleId.get(promotion.id);
              const isGloballyActive = (promotion.status || 'active') === 'active';
              const isInheritedRule = Boolean(lockedEventId && (promotion.event_scope || 'all') === 'all');
              const isStoppedHere = isPromotionStoppedForThisEvent(promotion);
              const isActive = isPromotionActiveHere(promotion);
              const eventNames = lockedEventId
                ? effectiveEventName
                : promotion.event_scope === 'selected'
                ? (promotion.event_ids || [])
                    .map((eventId) => eventOptions.find((event) => event.id === eventId)?.event_name)
                    .filter(Boolean)
                    .join(', ')
                : 'All events';
              const windowLabel = promotion.starts_at || promotion.ends_at
                ? `${promotion.starts_at ? new Date(promotion.starts_at).toLocaleDateString() : 'Now'} - ${promotion.ends_at ? new Date(promotion.ends_at).toLocaleDateString() : 'No end'}`
                : 'Always active';
              const ruleLabel = promotion.rule_type === 'discount'
                ? `Buy ${promotion.buy_quantity}, save ${promotion.reward_value}`
                : `Buy ${promotion.buy_quantity}, get ${promotion.reward_quantity} free`;
              const statusLabel = isStoppedHere
                ? 'Stopped here'
                : isActive
                  ? isInheritedRule ? 'Applied' : 'Active'
                  : isInheritedRule && !isGloballyActive ? 'Paused globally' : 'Inactive';

              return (
                <article key={promotion.id} className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${isActive ? 'border-emerald-100' : 'border-gray-100 opacity-80'}`}>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                            {statusLabel}
                          </span>
                          {lockedEventId && (
                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${isInheritedRule ? 'bg-blue-50 text-blue-700' : 'bg-pink-50 text-pink-700'}`}>
                              {isInheritedRule ? 'Global rule' : 'Event rule'}
                            </span>
                          )}
                          {isInheritedRule && isStoppedHere && (
                            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-700">
                              Override
                            </span>
                          )}
                          <span className="rounded-full bg-pink-50 px-2.5 py-1 text-[11px] font-black text-pink-700">
                            {promotion.target_type}
                          </span>
                        </div>
                        <h4 className="mt-3 line-clamp-2 text-base font-black leading-tight text-gray-950">
                          {getPromotionLabel(promotion, productsById)}
                        </h4>
                        <p className="mt-1 text-sm font-black text-pink-700">{ruleLabel}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => loadPromotionIntoForm(promotion, 'edit')}
                          disabled={isInheritedRule}
                          className="grid h-9 w-9 place-items-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={isInheritedRule ? 'Edit this global promotion in the Promotion workspace' : `Edit promotion ${promotion.id}`}
                          title={isInheritedRule ? 'Edit global rules in the Promotion workspace' : 'Edit promotion'}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => loadPromotionIntoForm(promotion, 'duplicate')}
                          className="grid h-9 w-9 place-items-center rounded-lg border border-pink-100 text-pink-500 hover:bg-pink-50"
                          aria-label={`Duplicate promotion ${promotion.id}`}
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(promotion.id)}
                          disabled={isInheritedRule}
                          className="grid h-9 w-9 place-items-center rounded-lg border border-red-100 text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={isInheritedRule ? 'Delete this global promotion in the Promotion workspace' : `Delete promotion ${promotion.id}`}
                          title={isInheritedRule ? 'Delete global rules in the Promotion workspace' : 'Delete promotion'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2 text-xs font-semibold text-gray-500 sm:grid-cols-2">
                      <div className="rounded-xl bg-gray-50 p-3">
                        <div className="text-[10px] font-black uppercase tracking-wide text-gray-400">Event</div>
                        <div className="mt-1 line-clamp-2 font-black text-gray-800">{eventNames || 'Selected events'}</div>
                      </div>
                      <div className="rounded-xl bg-gray-50 p-3">
                        <div className="text-[10px] font-black uppercase tracking-wide text-gray-400">Window</div>
                        <div className="mt-1 font-black text-gray-800">{windowLabel}</div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 border-t border-gray-100 bg-gray-50">
                    <div className="p-3">
                      <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-gray-400">
                        <BarChart3 size={12} />
                        Orders
                      </div>
                      <div className="mt-1 text-sm font-black text-gray-900">{rowAnalytics?.order_count || 0}</div>
                    </div>
                    <div className="border-x border-gray-100 p-3">
                      <div className="text-[10px] font-black uppercase tracking-wide text-gray-400">Uses</div>
                      <div className="mt-1 text-sm font-black text-gray-900">{rowAnalytics?.bundle_count || 0}</div>
                    </div>
                    <div className="p-3">
                      <div className="text-[10px] font-black uppercase tracking-wide text-gray-400">Discount</div>
                      <div className="mt-1 truncate text-sm font-black text-emerald-700">{formatPrice(Number(rowAnalytics?.discount_total || 0), products[0]?.currency)}</div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => isInheritedRule ? handleToggleEventExclusion(promotion) : handleToggleStatus(promotion)}
                    className={`w-full border-t px-4 py-2 text-xs font-black ${isInheritedRule
                      ? isStoppedHere
                        ? 'border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100'
                        : 'border-amber-100 bg-amber-50 text-amber-700 hover:bg-amber-100'
                      : isActive
                        ? 'border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'border-gray-100 bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {isInheritedRule
                      ? isStoppedHere ? 'Use in this event' : 'Stop in this event'
                      : isActive ? 'Pause promotion' : 'Activate promotion'}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
