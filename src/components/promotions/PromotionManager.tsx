import { useEffect, useMemo, useState } from 'react';
import { Archive, Edit2, Gift, Loader2, Plus, Search, Sparkles, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { listMyOnlineCampaigns } from '../../lib/onlineCampaigns';
import { archivePromotionDefinition, getPromotionAssignmentConflicts, listPromotionDefinitions, savePromotionDefinition } from '../../lib/promotions';
import type { PromotionCombinationPolicy, PromotionDefinition, PromotionEventPhase, PromotionRewardSelectionMode, PromotionTierGrantMode, PromotionType, SavePromotionDefinitionInput } from '../../types/promotion';

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

interface PromotionManagerProps {
  artistId: string;
  products: ProductLite[];
  eventOptions: EventLite[];
  categorySuggestions: string[];
  tagSuggestions: string[];
  lockedEventId?: string;
  lockedEventName?: string;
}

type FormTarget = SavePromotionDefinitionInput['target_type'] | 'product_line';
type FormPromotionType = Exclude<PromotionType, 'legacy_free_eligible_items'>;
type TierDraft = { key: string; threshold: string; quantity: string; selectionMode: PromotionRewardSelectionMode; rewardProductIds: string[] };

const fieldClass = 'mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-800';
const labelClass = 'text-xs font-black text-gray-700';
const phaseOptions: PromotionEventPhase[] = ['preorder', 'live', 'postorder'];
const newTier = (): TierDraft => ({ key: crypto.randomUUID(), threshold: '500', quantity: '1', selectionMode: 'fixed', rewardProductIds: [] });

function ProductPicker({ products, selected, onChange, label }: { products: ProductLite[]; selected: string[]; onChange: (ids: string[]) => void; label: string }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? products.filter((product) => `${product.name} ${product.category || ''} ${(product.tags || []).join(' ')}`.toLowerCase().includes(normalized)) : products;
  }, [products, query]);
  return <div>
    <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={label} className={`${fieldClass} pl-9`} /></div>
    <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50 p-2">
      {filtered.map((product) => {
        const checked = selected.includes(product.id);
        return <label key={product.id} className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold ${checked ? 'bg-pink-50 text-pink-700' : 'bg-white text-gray-700'}`}><input type="checkbox" checked={checked} onChange={() => onChange(checked ? selected.filter((id) => id !== product.id) : [...selected, product.id])} /><span className="min-w-0 flex-1 truncate">{product.name}</span></label>;
      })}
    </div>
    <div className="mt-1 text-xs font-bold text-gray-400">{selected.length} selected</div>
  </div>;
}

function SearchableDatalist({ id, label, value, suggestions, onChange, placeholder, helper }: { id: string; label: string; value: string; suggestions: string[]; onChange: (value: string) => void; placeholder: string; helper: string }) {
  return <label>
    <span className={labelClass}>{label}</span>
    <input list={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={fieldClass} />
    <datalist id={id}>{suggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}</datalist>
    <span className="mt-1 block text-xs font-semibold text-gray-500">{helper}</span>
  </label>;
}

export default function PromotionManager({ artistId, products, eventOptions, categorySuggestions, tagSuggestions, lockedEventId, lockedEventName }: PromotionManagerProps) {
  const { language } = useI18n();
  const th = language === 'th';
  const [definitions, setDefinitions] = useState<PromotionDefinition[]>([]);
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const [name, setName] = useState('');
  const [promotionType, setPromotionType] = useState<FormPromotionType>('quantity_discount');
  const [targetType, setTargetType] = useState<FormTarget>('all');
  const [category, setCategory] = useState('');
  const [tag, setTag] = useState('');
  const [productLine, setProductLine] = useState('');
  const [targetProductIds, setTargetProductIds] = useState<string[]>([]);
  const [buyQuantity, setBuyQuantity] = useState('3');
  const [rewardValue, setRewardValue] = useState('50');
  const [rewardQuantity, setRewardQuantity] = useState('1');
  const [rewardSelectionMode, setRewardSelectionMode] = useState<PromotionRewardSelectionMode>('fixed');
  const [rewardProductIds, setRewardProductIds] = useState<string[]>([]);
  const [tierGrantMode, setTierGrantMode] = useState<PromotionTierGrantMode>('highest_only');
  const [tiers, setTiers] = useState<TierDraft[]>([newTier()]);
  const [assignmentKeys, setAssignmentKeys] = useState<string[]>([]);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [combinationPolicy, setCombinationPolicy] = useState<PromotionCombinationPolicy>('exclusive');

  const productLines = useMemo(() => Array.from(new Set(products.map((product) => product.variant_group_name).filter(Boolean) as string[])).sort(), [products]);
  const lineProductIds = useMemo(() => products.filter((product) => product.variant_group_name === productLine).map((product) => product.id), [productLine, products]);
  const effectiveTargetIds = targetType === 'product_line' ? lineProductIds : targetProductIds;

  const refresh = async () => {
    setLoading(true);
    try {
      const [nextDefinitions, nextCampaigns] = await Promise.all([listPromotionDefinitions(artistId), listMyOnlineCampaigns()]);
      setDefinitions(nextDefinitions);
      setCampaigns(nextCampaigns.filter((campaign) => campaign.artist_id === artistId).map((campaign) => ({ id: campaign.id, name: campaign.name })));
    } catch (error) {
      console.error(error);
      setMessage(th ? 'โหลดโปรโมชั่นไม่สำเร็จ' : 'Could not load promotions.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, [artistId]);

  const reset = () => {
    setEditingId(null); setName(''); setPromotionType('quantity_discount'); setTargetType('all'); setCategory(''); setTag(''); setProductLine(''); setTargetProductIds([]); setBuyQuantity('3'); setRewardValue('50'); setRewardQuantity('1'); setRewardSelectionMode('fixed'); setRewardProductIds([]); setTierGrantMode('highest_only'); setTiers([newTier()]); setAssignmentKeys([]); setStartsAt(''); setEndsAt(''); setCombinationPolicy('exclusive'); setMessage('');
  };

  const edit = (definition: PromotionDefinition) => {
    if (definition.promotion_type === 'legacy_free_eligible_items') return;
    setEditingId(definition.id); setName(definition.name || ''); setPromotionType(definition.promotion_type); setTargetType(definition.target_type); setCategory(definition.match_category || ''); setTag(definition.match_tag || ''); setTargetProductIds(definition.match_product_ids || []); setBuyQuantity(String(definition.buy_quantity || 3)); setRewardValue(String(definition.reward_value || 50)); setRewardQuantity(String(definition.reward_quantity || 1)); setRewardSelectionMode(definition.reward_selection_mode || 'fixed'); setRewardProductIds(definition.reward_product_ids); setTierGrantMode(definition.tier_grant_mode || 'highest_only');
    setTiers(definition.tiers.length ? definition.tiers.map((tier) => ({ key: tier.id, threshold: String(tier.threshold_amount), quantity: String(tier.reward_quantity), selectionMode: tier.reward_selection_mode, rewardProductIds: tier.reward_product_ids })) : [newTier()]);
    setAssignmentKeys(definition.assignments.filter((assignment) => !assignment.is_paused).map((assignment) => assignment.campaign_id ? `campaign:${assignment.campaign_id}` : `event:${assignment.event_id}:${assignment.event_phase}`));
    const first = definition.assignments[0];
    setStartsAt(first?.starts_at ? new Date(first.starts_at).toISOString().slice(0, 16) : ''); setEndsAt(first?.ends_at ? new Date(first.ends_at).toISOString().slice(0, 16) : ''); setCombinationPolicy(first?.combination_policy || 'exclusive'); setMessage('');
    document.getElementById('promotion-editor')?.scrollIntoView({ behavior: 'smooth' });
  };

  const toggleAssignment = (key: string) => setAssignmentKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  const toIso = (value: string) => value ? new Date(value).toISOString() : null;
  const buildPayload = (paused: boolean, id = editingId): SavePromotionDefinitionInput => ({
    id, artist_id: artistId, name: name.trim(), promotion_type: promotionType,
    target_type: targetType === 'product_line' ? 'product' : targetType,
    match_category: targetType === 'category' || targetType === 'category_tag' ? category.trim() : null,
    match_tag: targetType === 'tag' || targetType === 'category_tag' ? tag.trim() : null,
    match_product_ids: targetType === 'product' || targetType === 'product_line' ? effectiveTargetIds : [],
    buy_quantity: promotionType === 'spend_tier_gift' ? null : Number(buyQuantity), reward_value: promotionType === 'quantity_discount' ? Number(rewardValue) : null, reward_quantity: promotionType === 'quantity_gift' ? Number(rewardQuantity) : null, reward_selection_mode: promotionType === 'quantity_gift' ? rewardSelectionMode : null, tier_grant_mode: promotionType === 'spend_tier_gift' ? tierGrantMode : null,
    reward_product_ids: promotionType === 'quantity_gift' ? rewardProductIds : [],
    tiers: promotionType === 'spend_tier_gift' ? tiers.map((tier, index) => ({ threshold_amount: Number(tier.threshold), reward_quantity: Number(tier.quantity), reward_selection_mode: tier.selectionMode, sort_order: index, reward_product_ids: tier.rewardProductIds })) : [],
    assignments: assignmentKeys.map((key) => { const [kind, assignmentId, phase] = key.split(':'); return { event_id: kind === 'event' ? assignmentId : null, event_phase: kind === 'event' ? phase as PromotionEventPhase : null, campaign_id: kind === 'campaign' ? assignmentId : null, starts_at: toIso(startsAt), ends_at: toIso(endsAt), is_paused: paused, combination_policy: combinationPolicy }; }),
  });

  const validate = () => {
    if (!name.trim()) return th ? 'กรอกชื่อโปรโมชั่น' : 'Enter a promotion name.';
    if (!assignmentKeys.length) return th ? 'เลือกช่องทางขายอย่างน้อย 1 ช่องทาง' : 'Choose at least one sales channel.';
    if (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt)) return th ? 'เวลาเริ่มต้องมาก่อนเวลาสิ้นสุด' : 'Start time must be before end time.';
    if ((targetType === 'product' || targetType === 'product_line') && !effectiveTargetIds.length) return th ? 'เลือกสินค้าอย่างน้อย 1 รายการ' : 'Choose at least one product.';
    if ((targetType === 'category' || targetType === 'category_tag') && !category.trim()) return th ? 'เลือกหมวดหมู่' : 'Choose a category.';
    if ((targetType === 'tag' || targetType === 'category_tag') && !tag.trim()) return th ? 'เลือกแท็ก' : 'Choose a tag.';
    if (promotionType !== 'spend_tier_gift' && (!Number.isInteger(Number(buyQuantity)) || Number(buyQuantity) < 1)) return th ? 'จำนวนสินค้าต้องเป็นเลขจำนวนเต็มมากกว่า 0' : 'Buy quantity must be a positive integer.';
    if (promotionType === 'quantity_discount' && Number(rewardValue) <= 0) return th ? 'ส่วนลดต้องมากกว่า 0' : 'Discount must be greater than 0.';
    if (promotionType === 'quantity_gift' && (!rewardProductIds.length || Number(rewardQuantity) < 1)) return th ? 'เลือกของแถมและจำนวนให้ครบ' : 'Choose reward products and quantity.';
    if (promotionType === 'quantity_gift' && rewardSelectionMode === 'fixed' && rewardProductIds.length !== 1) return th ? 'ของแถมแบบกำหนดตายตัวเลือกได้ 1 รายการ' : 'A fixed reward needs exactly one product.';
    if (promotionType === 'spend_tier_gift' && tiers.some((tier) => Number(tier.threshold) <= 0 || Number(tier.quantity) < 1 || !tier.rewardProductIds.length || (tier.selectionMode === 'fixed' && tier.rewardProductIds.length !== 1))) return th ? 'กรอกเงื่อนไขและของแถมของทุกระดับให้ครบ' : 'Complete every tier and its rewards.';
    return '';
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validate(); if (validationError) { setMessage(validationError); return; }
    setSaving(true); setMessage('');
    try {
      const id = await savePromotionDefinition(buildPayload(true));
      const saved = (await listPromotionDefinitions(artistId)).find((definition) => definition.id === id);
      const results = await Promise.all((saved?.assignments || []).filter((assignment) => assignmentKeys.includes(assignment.campaign_id ? `campaign:${assignment.campaign_id}` : `event:${assignment.event_id}:${assignment.event_phase}`)).map((assignment) => getPromotionAssignmentConflicts(assignment.id)));
      const names = Array.from(new Set(results.flatMap((result) => result.conflicts.map((conflict) => conflict.promotion_name))));
      if (names.length && !window.confirm(th ? `โปรนี้ชนกับ ${names.join(', ')}\nใช้กติกาที่เลือกไว้และเปิดใช้เลยหรือไม่?` : `This overlaps ${names.join(', ')}. Activate using the selected combination rule?`)) {
        setEditingId(id); setMessage(th ? 'บันทึกแล้ว แต่ยังพักการใช้งานอยู่' : 'Saved, but assignments remain paused.'); await refresh(); return;
      }
      await savePromotionDefinition(buildPayload(false, id)); reset(); setMessage(th ? 'บันทึกและเปิดใช้โปรโมชั่นแล้ว' : 'Promotion saved and activated.'); await refresh();
    } catch (error) { console.error(error); setMessage(th ? 'บันทึกโปรโมชั่นไม่สำเร็จ กรุณาตรวจข้อมูลอีกครั้ง' : 'Could not save promotion. Check the form and try again.'); }
    finally { setSaving(false); }
  };

  const archive = async (id: string) => { if (!window.confirm(th ? 'เก็บโปรโมชั่นนี้เข้าคลังใช่ไหม? ออเดอร์เดิมจะไม่เปลี่ยน' : 'Archive this promotion? Existing orders will not change.')) return; await archivePromotionDefinition(id); await refresh(); };

  const rulePreview = promotionType === 'quantity_discount' ? (th ? `ทุก ${buyQuantity || 0} ชิ้น ลด ฿${rewardValue || 0} (ใช้ซ้ำทุกชุด)` : `Every ${buyQuantity || 0} items, save ฿${rewardValue || 0} (repeats)`) : promotionType === 'quantity_gift' ? (th ? `ทุก ${buyQuantity || 0} ชิ้น รับฟรี ${rewardQuantity || 0} ชิ้น` : `Every ${buyQuantity || 0} items, get ${rewardQuantity || 0} free`) : (th ? `${tierGrantMode === 'highest_only' ? 'รับเฉพาะระดับสูงสุด' : 'รับของแถมทุกระดับที่ถึง'} โดยคิดจากยอดหลังหักส่วนลด` : `${tierGrantMode === 'highest_only' ? 'Highest tier only' : 'Every reached tier'}, based on merchandise after discounts`);

  return <section className="space-y-5">
    <form id="promotion-editor" onSubmit={save} className="rounded-2xl border border-pink-100 bg-pink-50/30 p-4">
      <div className="flex items-start justify-between gap-3"><div><h3 className="flex items-center gap-2 font-black text-gray-950"><Sparkles size={18} className="text-pink-600" />{editingId ? (th ? 'แก้ไขโปรโมชั่น' : 'Edit promotion') : (th ? 'สร้างโปรโมชั่น' : 'Create promotion')}</h3><p className="mt-1 text-xs font-semibold text-gray-500">{th ? 'โปรกลางของร้าน เลือกใช้แยกตามช่องทางและช่วงเวลาได้' : 'A reusable store promotion assigned to sales channels and schedules.'}</p></div>{editingId && <button type="button" onClick={reset} aria-label="Close editor" className="grid h-10 w-10 place-items-center rounded-xl bg-white text-gray-500"><X size={17} /></button>}</div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-4 rounded-2xl bg-white p-4 ring-1 ring-gray-100"><h4 className="font-black text-gray-900">1. {th ? 'เงื่อนไขโปร' : 'Offer'}</h4><label><span className={labelClass}>{th ? 'ชื่อโปรโมชั่น' : 'Promotion name'}</span><input value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} placeholder={th ? 'เช่น ทุก 3 ชิ้น ลด 50 บาท' : 'e.g. Every 3 items save ฿50'} /></label><label><span className={labelClass}>{th ? 'รูปแบบโปรโมชั่น' : 'Promotion type'}</span><select value={promotionType} onChange={(event) => setPromotionType(event.target.value as FormPromotionType)} className={fieldClass}><option value="quantity_discount">{th ? 'ซื้อครบ X ชิ้น ลด Y บาท' : 'Buy X, save Y'}</option><option value="quantity_gift">{th ? 'ซื้อครบ X ชิ้น รับฟรี Y ชิ้น' : 'Buy X, get Y free'}</option><option value="spend_tier_gift">{th ? 'ของแถมตามยอดซื้อแบบระดับ' : 'Spend-tier gifts'}</option></select></label>{promotionType !== 'spend_tier_gift' && <div className="grid grid-cols-2 gap-3"><label><span className={labelClass}>{th ? 'ซื้อครบ (ชิ้น)' : 'Buy quantity'}</span><input type="number" min="1" step="1" value={buyQuantity} onChange={(event) => setBuyQuantity(event.target.value)} className={fieldClass} /></label>{promotionType === 'quantity_discount' ? <label><span className={labelClass}>{th ? 'ลด (บาท)' : 'Discount (THB)'}</span><input type="number" min="0.01" step="0.01" value={rewardValue} onChange={(event) => setRewardValue(event.target.value)} className={fieldClass} /></label> : <label><span className={labelClass}>{th ? 'รับฟรี (ชิ้น)' : 'Free quantity'}</span><input type="number" min="1" step="1" value={rewardQuantity} onChange={(event) => setRewardQuantity(event.target.value)} className={fieldClass} /></label>}</div>}{promotionType === 'spend_tier_gift' && <label><span className={labelClass}>{th ? 'เมื่อถึงหลายระดับ' : 'When multiple tiers are reached'}</span><select value={tierGrantMode} onChange={(event) => setTierGrantMode(event.target.value as PromotionTierGrantMode)} className={fieldClass}><option value="highest_only">{th ? 'รับเฉพาะของระดับสูงสุด' : 'Highest tier only'}</option><option value="cumulative">{th ? 'รับของแถมทุกระดับที่ถึง' : 'Every reached tier'}</option></select></label>}<div className="rounded-xl bg-pink-50 p-3 text-sm font-black text-pink-800">{rulePreview}</div></div>
        <div className="space-y-4 rounded-2xl bg-white p-4 ring-1 ring-gray-100"><h4 className="font-black text-gray-900">2. {th ? 'สินค้าที่ร่วมรายการ' : 'Eligible products'}</h4><label><span className={labelClass}>{th ? 'ใช้กับ' : 'Applies to'}</span><select value={targetType} onChange={(event) => setTargetType(event.target.value as FormTarget)} className={fieldClass}><option value="all">{th ? 'สินค้าทั้งหมด' : 'All products'}</option><option value="product">{th ? 'สินค้าที่ระบุ' : 'Specific products'}</option><option value="product_line">{th ? 'ไลน์สินค้า (เลือกทุกตัวเลือก)' : 'Product line (all variants)'}</option><option value="category">{th ? 'หมวดหมู่' : 'Category'}</option><option value="tag">{th ? 'แท็ก' : 'Tag'}</option><option value="category_tag">{th ? 'หมวดหมู่ + แท็ก' : 'Category + tag'}</option></select></label>{(targetType === 'category' || targetType === 'category_tag') && <SearchableDatalist id="promotion-categories" label={th ? 'หมวดหมู่' : 'Category'} value={category} onChange={setCategory} suggestions={categorySuggestions} placeholder={th ? 'เลือกหรือพิมพ์ค้นหาหมวดหมู่' : 'Choose or search categories'} helper={th ? 'เลือกได้ 1 หมวดหมู่จากแคตตาล็อก' : 'Choose one category from your catalog.'} />}{(targetType === 'tag' || targetType === 'category_tag') && <SearchableDatalist id="promotion-tags" label={th ? 'แท็ก' : 'Tag'} value={tag} onChange={setTag} suggestions={tagSuggestions} placeholder={th ? 'เลือกหรือพิมพ์ค้นหาแท็ก' : 'Choose or search tags'} helper={th ? 'เลือกได้ 1 แท็กจากแคตตาล็อก' : 'Choose one tag from your catalog.'} />}{targetType === 'product_line' && <label><span className={labelClass}>{th ? 'ไลน์สินค้า' : 'Product line'}</span><select value={productLine} onChange={(event) => setProductLine(event.target.value)} className={fieldClass}><option value="">{th ? 'เลือกไลน์สินค้า' : 'Choose a product line'}</option>{productLines.map((value) => <option key={value} value={value}>{value}</option>)}</select><span className="mt-1 block text-xs font-bold text-gray-400">{lineProductIds.length} {th ? 'รายการจะร่วมโปร' : 'products will be included'}</span></label>}{targetType === 'product' && <ProductPicker products={products} selected={targetProductIds} onChange={setTargetProductIds} label={th ? 'ค้นหาสินค้า' : 'Search products'} />}</div>
        {(promotionType === 'quantity_gift' || promotionType === 'spend_tier_gift') && <div className="space-y-4 rounded-2xl bg-white p-4 ring-1 ring-gray-100 lg:col-span-2"><h4 className="flex items-center gap-2 font-black text-gray-900"><Gift size={17} className="text-pink-600" />3. {th ? 'ของแถม' : 'Rewards'}</h4><p className="text-xs font-semibold text-amber-700">{th ? 'ของแถมต้องถูกเพิ่มเข้าแต่ละช่องทางขายและมีสต็อก ระบบจึงจะจองและตัดสต็อกให้ได้' : 'Reward products must also exist with stock in each assigned sales channel.'}</p>{promotionType === 'quantity_gift' ? <><label><span className={labelClass}>{th ? 'ลูกค้าเลือกของแถมหรือไม่' : 'Reward selection'}</span><select value={rewardSelectionMode} onChange={(event) => setRewardSelectionMode(event.target.value as PromotionRewardSelectionMode)} className={fieldClass}><option value="fixed">{th ? 'ร้านกำหนดของแถม 1 รายการ' : 'One fixed reward'}</option><option value="customer_choice">{th ? 'ลูกค้าเลือกจากรายการที่กำหนด' : 'Customer chooses'}</option></select></label><ProductPicker products={products} selected={rewardProductIds} onChange={setRewardProductIds} label={th ? 'ค้นหาของแถม' : 'Search rewards'} /></> : <div className="space-y-3">{tiers.map((tier, index) => <div key={tier.key} className="rounded-xl border border-gray-200 p-3"><div className="grid gap-3 md:grid-cols-3"><label><span className={labelClass}>{th ? 'ยอดถึง (บาท)' : 'Spend (THB)'}</span><input type="number" min="0.01" step="0.01" value={tier.threshold} onChange={(event) => setTiers((current) => current.map((item) => item.key === tier.key ? { ...item, threshold: event.target.value } : item))} className={fieldClass} /></label><label><span className={labelClass}>{th ? 'รับฟรี (ชิ้น)' : 'Free quantity'}</span><input type="number" min="1" step="1" value={tier.quantity} onChange={(event) => setTiers((current) => current.map((item) => item.key === tier.key ? { ...item, quantity: event.target.value } : item))} className={fieldClass} /></label><label><span className={labelClass}>{th ? 'การเลือกของแถม' : 'Selection'}</span><select value={tier.selectionMode} onChange={(event) => setTiers((current) => current.map((item) => item.key === tier.key ? { ...item, selectionMode: event.target.value as PromotionRewardSelectionMode } : item))} className={fieldClass}><option value="fixed">{th ? 'ร้านกำหนด 1 รายการ' : 'One fixed reward'}</option><option value="customer_choice">{th ? 'ลูกค้าเลือก' : 'Customer chooses'}</option></select></label></div><div className="mt-2"><ProductPicker products={products} selected={tier.rewardProductIds} onChange={(ids) => setTiers((current) => current.map((item) => item.key === tier.key ? { ...item, rewardProductIds: ids } : item))} label={th ? `ค้นหาของแถมระดับ ${index + 1}` : `Search tier ${index + 1} rewards`} /></div>{tiers.length > 1 && <button type="button" onClick={() => setTiers((current) => current.filter((item) => item.key !== tier.key))} className="mt-2 text-xs font-black text-red-600">{th ? 'ลบระดับนี้' : 'Remove tier'}</button>}</div>)}<button type="button" onClick={() => setTiers((current) => [...current, newTier()])} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-pink-200 px-3 text-xs font-black text-pink-700"><Plus size={14} />{th ? 'เพิ่มระดับ' : 'Add tier'}</button></div>}</div>}
        <div className="space-y-4 rounded-2xl bg-white p-4 ring-1 ring-gray-100 lg:col-span-2"><h4 className="font-black text-gray-900">{promotionType === 'quantity_discount' ? '3' : '4'}. {th ? 'ช่องทางขายและช่วงเวลา' : 'Sales channels and schedule'}</h4><div className="grid gap-3 md:grid-cols-2"><label><span className={labelClass}>{th ? 'เริ่มใช้ (ไม่บังคับ)' : 'Starts (optional)'}</span><input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className={fieldClass} /></label><label><span className={labelClass}>{th ? 'สิ้นสุด (ไม่บังคับ)' : 'Ends (optional)'}</span><input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} className={fieldClass} /></label></div><label><span className={labelClass}>{th ? 'เมื่อชนกับโปรอื่นในสินค้าเดียวกัน' : 'When another promotion overlaps'}</span><select value={combinationPolicy} onChange={(event) => setCombinationPolicy(event.target.value as PromotionCombinationPolicy)} className={fieldClass}><option value="exclusive">{th ? 'ไม่ใช้ซ้ำ — เลือกส่วนลดที่คุ้มที่สุด หรือให้ลูกค้าเลือกของแถม' : 'Exclusive — best discount or customer choice'}</option><option value="combine">{th ? 'ใช้ร่วมกับโปรอื่นได้' : 'Combine with other promotions'}</option></select></label><div className="space-y-2">{eventOptions.filter((event) => !lockedEventId || event.id === lockedEventId).map((event) => <div key={event.id} className="rounded-xl border border-gray-100 p-3"><div className="font-black text-gray-800">{lockedEventId ? lockedEventName || event.event_name : event.event_name}</div><div className="mt-2 flex flex-wrap gap-3">{phaseOptions.map((phase) => { const key = `event:${event.id}:${phase}`; return <label key={phase} className="flex items-center gap-2 text-sm font-bold text-gray-600"><input type="checkbox" checked={assignmentKeys.includes(key)} onChange={() => toggleAssignment(key)} />{phase === 'preorder' ? (th ? 'พรีออเดอร์' : 'Pre-order') : phase === 'live' ? (th ? 'ขายวันงาน' : 'Live event') : (th ? 'หลังจบงาน' : 'Post-order')}</label>; })}</div></div>)}</div>{!lockedEventId && campaigns.length > 0 && <div><div className={labelClass}>{th ? 'แคมเปญขายออนไลน์' : 'Online campaigns'}</div><div className="mt-2 grid gap-2 md:grid-cols-2">{campaigns.map((campaign) => { const key = `campaign:${campaign.id}`; return <label key={campaign.id} className="flex items-center gap-2 rounded-xl border border-gray-100 p-3 text-sm font-bold text-gray-700"><input type="checkbox" checked={assignmentKeys.includes(key)} onChange={() => toggleAssignment(key)} />{campaign.name}</label>; })}</div></div>}</div>
      </div>
      {message && <div className="mt-4 rounded-xl bg-gray-100 px-3 py-2 text-sm font-bold text-gray-700">{message}</div>}
      <button disabled={saving} className="mt-4 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-pink-600 px-5 text-sm font-black text-white disabled:opacity-50">{saving ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}{saving ? (th ? 'กำลังตรวจและบันทึก…' : 'Checking and saving…') : editingId ? (th ? 'บันทึกการแก้ไข' : 'Save changes') : (th ? 'ตรวจและเปิดใช้โปรโมชั่น' : 'Check and activate')}</button>
    </form>
    <div className="rounded-2xl border border-gray-100 bg-white p-4"><h3 className="font-black text-gray-950">{th ? 'โปรโมชั่นของร้าน' : 'Store promotions'} <span className="text-pink-600">({definitions.length})</span></h3>{loading ? <div className="mt-4 flex items-center gap-2 text-sm font-bold text-gray-400"><Loader2 className="animate-spin" size={16} />{th ? 'กำลังโหลด…' : 'Loading…'}</div> : <div className="mt-4 grid gap-3 lg:grid-cols-2">{definitions.map((definition) => { const activeAssignments = definition.assignments.filter((assignment) => !assignment.is_paused).length; return <article key={definition.id} className="rounded-2xl border border-gray-200 p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap gap-1"><span className={`rounded-full px-2 py-1 text-[11px] font-black ${definition.lifecycle_status === 'archived' ? 'bg-gray-100 text-gray-500' : activeAssignments ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{definition.lifecycle_status === 'archived' ? (th ? 'เก็บแล้ว' : 'Archived') : activeAssignments ? (th ? 'กำลังใช้' : 'Active') : (th ? 'พักอยู่' : 'Paused')}</span><span className="rounded-full bg-pink-50 px-2 py-1 text-[11px] font-black text-pink-700">v{definition.revision}</span></div><h4 className="mt-2 font-black text-gray-950">{definition.name || 'Promotion'}</h4><p className="mt-1 text-xs font-semibold text-gray-500">{definition.promotion_type === 'quantity_discount' ? `${th ? 'ทุก' : 'Every'} ${definition.buy_quantity} ${th ? `ชิ้น ลด ฿${definition.reward_value}` : `items, save ฿${definition.reward_value}`}` : definition.promotion_type === 'quantity_gift' ? `${th ? 'ทุก' : 'Every'} ${definition.buy_quantity} ${th ? `ชิ้น รับฟรี ${definition.reward_quantity}` : `items, get ${definition.reward_quantity} free`}` : definition.promotion_type === 'spend_tier_gift' ? `${definition.tiers.length} ${th ? 'ระดับของแถม' : 'reward tier(s)'}` : (th ? 'โปรเดิม (สร้างก่อนอัปเกรด)' : 'Legacy promotion')}</p><p className="mt-2 text-xs font-bold text-gray-400">{activeAssignments} {th ? 'ช่องทางที่กำลังใช้' : 'active assignment(s)'}</p></div><div className="flex gap-1"><button type="button" disabled={definition.promotion_type === 'legacy_free_eligible_items'} onClick={() => edit(definition)} className="grid h-10 w-10 place-items-center rounded-xl border border-gray-200 text-gray-600 disabled:opacity-30" aria-label="Edit promotion"><Edit2 size={15} /></button>{definition.lifecycle_status !== 'archived' && <button type="button" onClick={() => void archive(definition.id)} className="grid h-10 w-10 place-items-center rounded-xl border border-gray-200 text-gray-600" aria-label="Archive promotion"><Archive size={15} /></button>}</div></div></article>; })}{definitions.length === 0 && <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm font-bold text-gray-400">{th ? 'ยังไม่มีโปรโมชั่น' : 'No promotions yet.'}</div>}</div>}</div>
  </section>;
}
