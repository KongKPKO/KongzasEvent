import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { Button } from '../ui';
import { BarChart3, Copy, Edit2, Loader, Plus, Tag, TicketPercent, Trash2, X } from 'lucide-react';
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
}

const targetTypeOptions: Array<{ value: PromotionTargetType; label: string }> = [
  { value: 'category', label: 'Category' },
  { value: 'tag', label: 'Tag' },
  { value: 'category_tag', label: 'Category + Tag' },
  { value: 'product', label: 'Specific product' },
];

const ruleTypeOptions: Array<{ value: PromotionRuleType; label: string }> = [
  { value: 'discount', label: 'Buy X, discount Y THB' },
  { value: 'free_items', label: 'Buy X, get Y free' },
];

export default function PromotionManager({
  artistId,
  products,
  eventOptions,
  categorySuggestions,
  tagSuggestions,
}: PromotionManagerProps) {
  const [promotions, setPromotions] = useState<PromotionRule[]>([]);
  const [analytics, setAnalytics] = useState<PromotionAnalytics[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingPromotionId, setEditingPromotionId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [targetType, setTargetType] = useState<PromotionTargetType>('category');
  const [ruleType, setRuleType] = useState<PromotionRuleType>('discount');
  const [eventScope, setEventScope] = useState<'all' | 'selected'>('all');
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [matchCategory, setMatchCategory] = useState('');
  const [matchTag, setMatchTag] = useState('');
  const [matchProductIds, setMatchProductIds] = useState<string[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [buyQuantity, setBuyQuantity] = useState('3');
  const [rewardValue, setRewardValue] = useState('');
  const [rewardQuantity, setRewardQuantity] = useState('1');

  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, { ...product, price: Number(product.price || 0) }])),
    [products]
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

  const fetchPromotions = async () => {
    if (!artistId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('artist_promotions')
        .select('id, artist_id, name, target_type, rule_type, match_category, match_tag, match_product_id, match_product_ids, buy_quantity, reward_value, reward_quantity, priority, status, event_scope, event_ids, starts_at, ends_at, created_at')
        .eq('artist_id', artistId)
        .order('status', { ascending: true })
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPromotions((data || []) as PromotionRule[]);
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
  }, [artistId]);

  const resetForm = () => {
    setEditingPromotionId(null);
    setName('');
    setTargetType('category');
    setRuleType('discount');
    setEventScope('all');
    setSelectedEventIds([]);
    setStartsAt('');
    setEndsAt('');
    setMatchCategory('');
    setMatchTag('');
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
    setEventScope(promotion.event_scope || 'all');
    setSelectedEventIds(promotion.event_scope === 'selected' ? (promotion.event_ids || []) : []);
    setStartsAt(formatDateTimeLocal(promotion.starts_at));
    setEndsAt(formatDateTimeLocal(promotion.ends_at));
    setMatchCategory(promotion.match_category || '');
    setMatchTag(promotion.match_tag || '');
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

    if (eventScope === 'selected' && selectedEventIds.length === 0) {
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
      const payload = {
        artist_id: artistId,
        name: name.trim() || null,
        target_type: targetType,
        rule_type: ruleType,
        match_category: targetType === 'category' || targetType === 'category_tag' ? matchCategory.trim() : null,
        match_tag: targetType === 'tag' || targetType === 'category_tag' ? matchTag.trim() : null,
        match_product_id: null,
        match_product_ids: targetType === 'product' ? matchProductIds : null,
        buy_quantity: buyQty,
        reward_value: ruleType === 'discount' ? discountValue : null,
        reward_quantity: ruleType === 'free_items' ? freeQty : null,
        priority: targetType === 'product' ? 10 : targetType === 'category_tag' ? 20 : targetType === 'tag' ? 30 : 40,
        status: 'active' as const,
        event_scope: eventScope,
        event_ids: eventScope === 'selected' ? selectedEventIds : null,
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

    return {
      id: editingPromotionId || 'draft',
      artist_id: artistId,
      name: name || null,
      target_type: targetType,
      rule_type: ruleType,
      match_category: targetType === 'category' || targetType === 'category_tag' ? matchCategory : null,
      match_tag: targetType === 'tag' || targetType === 'category_tag' ? matchTag : null,
      match_product_id: null,
      match_product_ids: targetType === 'product' ? matchProductIds : null,
      buy_quantity: buyQty,
      reward_value: ruleType === 'discount' ? discountValue : null,
      reward_quantity: ruleType === 'free_items' ? freeQty : null,
      status: 'active',
      event_scope: eventScope,
      event_ids: eventScope === 'selected' ? selectedEventIds : null,
      starts_at: toIsoOrNull(startsAt),
      ends_at: toIsoOrNull(endsAt),
    };
  }, [artistId, buyQuantity, editingPromotionId, endsAt, eventScope, matchCategory, matchProductIds, matchTag, name, rewardQuantity, rewardValue, ruleType, selectedEventIds, startsAt, targetType]);

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
      (product.tags || []).some((tag) => tag.toLowerCase().includes(query))
    );
  }, [productSearch, products]);

  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <TicketPercent className="text-pink-500" size={18} />
            Promotions
          </h2>
          <p className="text-xs text-gray-500 mt-1">Set pricing rules for POS. Product scope overrides broader rules on the same items.</p>
        </div>
      </div>

      <div className={editingPromotionId ? 'fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-gray-950/55 p-4 backdrop-blur-sm' : ''}>
        <div className={editingPromotionId ? 'my-6 w-full max-w-4xl rounded-2xl bg-white p-4 shadow-2xl' : ''}>
          {editingPromotionId && (
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-lg font-black text-gray-900">Edit Promotion</h3>
                <p className="mt-1 text-xs font-semibold text-gray-500">Update the selected promotion without changing the Add Promotion form.</p>
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Promotion Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Optional display name"
              className="w-full px-3 py-2 text-sm font-semibold text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Rule Type</label>
            <select
              value={ruleType}
              onChange={(e) => setRuleType(e.target.value as PromotionRuleType)}
              className="w-full px-3 py-2 text-sm font-semibold text-gray-700 rounded border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500"
            >
              {ruleTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-4 rounded-xl border border-pink-100 bg-pink-50/40 p-3">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Event Scope</label>
            <select
              value={eventScope}
              onChange={(e) => {
                const nextScope = e.target.value as 'all' | 'selected';
                setEventScope(nextScope);
                if (nextScope === 'all') setSelectedEventIds([]);
              }}
              className="w-full px-3 py-2 text-sm font-semibold text-gray-700 rounded border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500"
            >
              <option value="all">All events</option>
              <option value="selected">Selected events only</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">Use selected events for booth-specific campaigns.</p>
          </div>

          {eventScope === 'selected' && (
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Events</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                {eventOptions.length === 0 ? (
                  <div className="rounded border border-dashed border-pink-100 bg-white px-3 py-2 text-xs font-semibold text-gray-400">
                    No confirmed events yet.
                  </div>
                ) : eventOptions.map((event) => {
                  const checked = selectedEventIds.includes(event.id);
                  return (
                    <label key={event.id} className={`flex items-center gap-2 rounded border px-3 py-2 text-xs font-bold cursor-pointer ${checked ? 'border-pink-200 bg-white text-pink-700' : 'border-gray-100 bg-white text-gray-600'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleEventSelection(event.id)}
                      />
                      <span className="truncate">{event.event_name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Starts At</label>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full px-3 py-2 text-sm font-semibold text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Ends At</label>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full px-3 py-2 text-sm font-semibold text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Scope</label>
            <select
              value={targetType}
              onChange={(e) => setTargetType(e.target.value as PromotionTargetType)}
              className="w-full px-3 py-2 text-sm font-semibold text-gray-700 rounded border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500"
            >
              {targetTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          {(targetType === 'category' || targetType === 'category_tag') && (
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Category</label>
              <input
                list="promotion-category-suggestions"
                type="text"
                value={matchCategory}
                onChange={(e) => setMatchCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm font-semibold text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500"
                placeholder="Photocard"
              />
              <datalist id="promotion-category-suggestions">
                {categorySuggestions.map((category) => <option key={category} value={category} />)}
              </datalist>
            </div>
          )}

          {(targetType === 'tag' || targetType === 'category_tag') && (
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Tag</label>
              <input
                list="promotion-tag-suggestions"
                type="text"
                value={matchTag}
                onChange={(e) => setMatchTag(e.target.value)}
                className="w-full px-3 py-2 text-sm font-semibold text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500"
                placeholder="Genshin Impact"
              />
              <datalist id="promotion-tag-suggestions">
                {tagSuggestions.map((tag) => <option key={tag} value={tag} />)}
              </datalist>
            </div>
          )}

          {targetType === 'product' && (
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Product</label>
              <input
                type="search"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Search products..."
                className="mb-2 w-full px-3 py-2 text-sm font-semibold text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500"
              />
              <div className="max-h-40 overflow-y-auto rounded border border-gray-200 bg-white">
                {filteredProducts.map((product) => {
                  const checked = matchProductIds.includes(product.id);
                  return (
                    <label key={product.id} className="flex items-center gap-3 px-3 py-2 border-b border-gray-100 last:border-b-0 text-sm cursor-pointer hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleProductSelection(product.id)}
                      />
                      <span className="font-medium text-gray-700">{product.name}</span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-gray-400">{matchProductIds.length} product(s) selected</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Buy X</label>
            <input
              type="number"
              min="1"
              step="1"
              value={buyQuantity}
              onChange={(e) => setBuyQuantity(e.target.value)}
              className="w-full px-3 py-2 text-sm font-semibold text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500"
            />
          </div>

          {ruleType === 'discount' ? (
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Discount Y (THB)</label>
              <input
                type="number"
                min="1"
                step="0.01"
                value={rewardValue}
                onChange={(e) => setRewardValue(e.target.value)}
                className="w-full px-3 py-2 text-sm font-semibold text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Free Y</label>
              <input
                type="number"
                min="1"
                step="1"
                value={rewardQuantity}
                onChange={(e) => setRewardQuantity(e.target.value)}
                className="w-full px-3 py-2 text-sm font-semibold text-gray-700 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500"
              />
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-wider text-gray-500">Preview</div>
              <div className="mt-1 text-sm font-bold text-gray-800">
                {previewProducts.length} eligible product{previewProducts.length === 1 ? '' : 's'}
                {eventScope === 'selected' ? ` · ${selectedEventIds.length} event${selectedEventIds.length === 1 ? '' : 's'}` : ' · all events'}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {startsAt || endsAt
                  ? `${startsAt ? `Starts ${new Date(toIsoOrNull(startsAt) || '').toLocaleString()}` : 'Starts now'} · ${endsAt ? `Ends ${new Date(toIsoOrNull(endsAt) || '').toLocaleString()}` : 'No end date'}`
                  : 'No active window set'}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 md:justify-end">
              {previewProducts.slice(0, 5).map((product) => (
                <span key={product.id} className="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-gray-600 border border-gray-200">
                  {product.name}
                </span>
              ))}
              {previewProducts.length > 5 && (
                <span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-gray-400 border border-gray-200">
                  +{previewProducts.length - 5} more
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          {editingPromotionId && (
            <Button
              type="button"
              onClick={resetForm}
              className="bg-white hover:bg-gray-50 text-gray-600 border border-gray-200 py-2 px-4 rounded transition-all active:scale-95 text-xs font-bold h-9 flex items-center gap-2"
            >
              <X size={14} />
              Close
            </Button>
          )}
          <Button
            type="submit"
            disabled={saving}
            className="bg-pink-500 hover:bg-pink-600 text-white py-2 px-6 rounded shadow-md shadow-pink-200 disabled:bg-pink-300 transition-all active:scale-95 text-xs font-bold h-9 flex items-center gap-2"
          >
            {saving ? <Loader className="animate-spin" size={14} /> : editingPromotionId ? <Edit2 size={14} /> : <Plus size={14} />}
            {saving ? 'Saving...' : editingPromotionId ? 'Save Promotion Changes' : 'Add Promotion'}
          </Button>
        </div>
          </form>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center gap-2 mb-3">
          <Tag size={15} className="text-gray-400" />
          <h3 className="text-sm font-bold text-gray-700">Promotion Rules ({promotions.length})</h3>
        </div>

        {loading ? (
          <div className="text-sm text-gray-400">Loading promotions...</div>
        ) : promotions.length === 0 ? (
          <div className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg px-4 py-5">No promotions yet.</div>
        ) : (
          <div className="space-y-2">
            {promotions.map((promotion) => {
              const rowAnalytics = analyticsByRuleId.get(promotion.id);
              const eventNames = promotion.event_scope === 'selected'
                ? (promotion.event_ids || [])
                    .map((eventId) => eventOptions.find((event) => event.id === eventId)?.event_name)
                    .filter(Boolean)
                    .join(', ')
                : 'All events';
              const windowLabel = promotion.starts_at || promotion.ends_at
                ? `${promotion.starts_at ? new Date(promotion.starts_at).toLocaleDateString() : 'Now'} - ${promotion.ends_at ? new Date(promotion.ends_at).toLocaleDateString() : 'No end'}`
                : 'Always active';

              return (
                <div key={promotion.id} className="flex flex-col gap-3 border border-gray-100 rounded-xl px-4 py-3">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-gray-800">{getPromotionLabel(promotion, productsById)}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        Scope: <span className="font-semibold">{promotion.target_type}</span>
                        {' '}| Rule: <span className="font-semibold">{promotion.rule_type === 'discount' ? `Buy ${promotion.buy_quantity}, save ${promotion.reward_value}` : `Buy ${promotion.buy_quantity}, get ${promotion.reward_quantity} free`}</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Event: <span className="font-semibold">{eventNames || 'Selected events'}</span>
                        {' '}| Window: <span className="font-semibold">{windowLabel}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(promotion)}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold border ${promotion.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-gray-50 text-gray-500 border-gray-200'}`}
                      >
                        {promotion.status === 'active' ? 'Active' : 'Inactive'}
                      </button>
                      <button
                        type="button"
                        onClick={() => loadPromotionIntoForm(promotion, 'edit')}
                        className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
                        aria-label={`Edit promotion ${promotion.id}`}
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => loadPromotionIntoForm(promotion, 'duplicate')}
                        className="p-2 rounded-lg border border-pink-100 text-pink-500 hover:bg-pink-50"
                        aria-label={`Duplicate promotion ${promotion.id}`}
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(promotion.id)}
                        className="p-2 rounded-lg border border-red-100 text-red-500 hover:bg-red-50"
                        aria-label={`Delete promotion ${promotion.id}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2 rounded-lg bg-gray-50 px-3 py-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-gray-600">
                      <BarChart3 size={13} className="text-pink-500" />
                      Analytics
                    </div>
                    <div className="text-xs text-gray-500">
                      Orders: <span className="font-black text-gray-800">{rowAnalytics?.order_count || 0}</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      Uses: <span className="font-black text-gray-800">{rowAnalytics?.bundle_count || 0}</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      Discount: <span className="font-black text-emerald-700">{formatPrice(Number(rowAnalytics?.discount_total || 0), products[0]?.currency)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
