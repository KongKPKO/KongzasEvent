import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { Button } from '../ui';
import { Loader, Plus, Tag, TicketPercent, Trash2 } from 'lucide-react';
import type { PromotionRule, PromotionRuleType, PromotionTargetType } from '../../utils/promotionPricing';
import { getPromotionLabel } from '../../utils/promotionPricing';

interface ProductLite {
  id: string;
  name: string;
  category?: string;
  tags?: string[];
}

interface PromotionManagerProps {
  artistId: string;
  products: ProductLite[];
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
  categorySuggestions,
  tagSuggestions,
}: PromotionManagerProps) {
  const [promotions, setPromotions] = useState<PromotionRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [targetType, setTargetType] = useState<PromotionTargetType>('category');
  const [ruleType, setRuleType] = useState<PromotionRuleType>('discount');
  const [matchCategory, setMatchCategory] = useState('');
  const [matchTag, setMatchTag] = useState('');
  const [matchProductIds, setMatchProductIds] = useState<string[]>([]);
  const [buyQuantity, setBuyQuantity] = useState('3');
  const [rewardValue, setRewardValue] = useState('');
  const [rewardQuantity, setRewardQuantity] = useState('1');

  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, { ...product, price: 0 }])),
    [products]
  );

  const fetchPromotions = async () => {
    if (!artistId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('artist_promotions')
        .select('id, artist_id, name, target_type, rule_type, match_category, match_tag, match_product_id, match_product_ids, buy_quantity, reward_value, reward_quantity, priority, status, created_at')
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

  useEffect(() => {
    fetchPromotions();
  }, [artistId]);

  const resetForm = () => {
    setName('');
    setTargetType('category');
    setRuleType('discount');
    setMatchCategory('');
    setMatchTag('');
    setMatchProductIds([]);
    setBuyQuantity('3');
    setRewardValue('');
    setRewardQuantity('1');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!artistId) return;

    const buyQty = Number(buyQuantity);
    const discountValue = rewardValue === '' ? null : Number(rewardValue);
    const freeQty = Number(rewardQuantity);

    if (!Number.isInteger(buyQty) || buyQty <= 0) {
      alert('Buy quantity must be an integer greater than 0.');
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
      };

      const { error } = await supabase.from('artist_promotions').insert(payload);
      if (error) throw error;

      resetForm();
      await fetchPromotions();
    } catch (error: any) {
      console.error('[PromotionManager] create failed:', error);
      alert(error.message || 'Failed to create promotion');
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

      <form onSubmit={handleCreate} className="space-y-4">
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
              <div className="max-h-40 overflow-y-auto rounded border border-gray-200 bg-white">
                {products.map((product) => {
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

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={saving}
            className="bg-pink-500 hover:bg-pink-600 text-white py-2 px-6 rounded shadow-md shadow-pink-200 disabled:bg-pink-300 transition-all active:scale-95 text-xs font-bold h-9 flex items-center gap-2"
          >
            {saving ? <Loader className="animate-spin" size={14} /> : <Plus size={14} />}
            {saving ? 'Saving...' : 'Add Promotion'}
          </Button>
        </div>
      </form>

      <div className="mt-6">
        <div className="flex items-center gap-2 mb-3">
          <Tag size={15} className="text-gray-400" />
          <h3 className="text-sm font-bold text-gray-700">Active Rules ({promotions.length})</h3>
        </div>

        {loading ? (
          <div className="text-sm text-gray-400">Loading promotions...</div>
        ) : promotions.length === 0 ? (
          <div className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg px-4 py-5">No promotions yet.</div>
        ) : (
          <div className="space-y-2">
            {promotions.map((promotion) => (
              <div key={promotion.id} className="flex flex-col md:flex-row md:items-center justify-between gap-3 border border-gray-100 rounded-xl px-4 py-3">
                <div>
                  <div className="text-sm font-bold text-gray-800">{getPromotionLabel(promotion, productsById)}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    Scope: <span className="font-semibold">{promotion.target_type}</span>
                    {' '}| Rule: <span className="font-semibold">{promotion.rule_type === 'discount' ? `Buy ${promotion.buy_quantity}, save ${promotion.reward_value}` : `Buy ${promotion.buy_quantity}, get ${promotion.reward_quantity} free`}</span>
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
                    onClick={() => handleDelete(promotion.id)}
                    className="p-2 rounded-lg border border-red-100 text-red-500 hover:bg-red-50"
                    aria-label={`Delete promotion ${promotion.id}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
