import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Edit2, Gift, Loader2, Plus, Search, Sparkles, ArrowLeft, Check, CalendarDays } from 'lucide-react';
import './promotion-workspace.css';
import { useI18n } from '../../i18n';
import { listMyOnlineCampaigns } from '../../lib/onlineCampaigns';
import { archivePromotionDefinition, listPromotionDefinitions, PromotionSaveConflict, savePromotionDefinition } from '../../lib/promotions';
import { promotionLocalDateTime } from '../../lib/promotionDateTime';
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

const fieldClass = 'promotion-input';
const labelClass = 'promotion-label';
const phaseOptions: PromotionEventPhase[] = ['preorder', 'live', 'postorder'];
const newTier = (): TierDraft => ({ key: crypto.randomUUID(), threshold: '500', quantity: '1', selectionMode: 'fixed', rewardProductIds: [] });

function ProductPicker({ products, selected, onChange, label }: { products: ProductLite[]; selected: string[]; onChange: (ids: string[]) => void; label: string }) {
  const { language } = useI18n();
  const th = language === 'th';
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? products.filter((product) => `${product.name} ${product.category || ''} ${(product.tags || []).join(' ')}`.toLowerCase().includes(normalized)) : products;
  }, [products, query]);
  return <div>
    <label className="block"><span className={labelClass}>{label}</span><span className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={label} className={`${fieldClass} pl-9`} /></span></label>
    <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50 p-2">
      {filtered.map((product) => {
        const checked = selected.includes(product.id);
        return <label key={product.id} className={`flex cursor-pointer items-center gap-2 rounded-lg min-h-11 px-3 py-2 text-sm font-bold ${checked ? 'bg-pink-50 text-pink-700' : 'bg-white text-gray-700'}`}><input type="checkbox" checked={checked} onChange={() => onChange(checked ? selected.filter((id) => id !== product.id) : [...selected, product.id])} /><span className="min-w-0 flex-1 truncate">{product.name}</span></label>;
      })}
    </div>
    {!filtered.length && <p className="promotion-help">{th ? (products.length ? 'ไม่พบสินค้า ลองค้นหาด้วยชื่ออื่น' : 'ยังไม่มีสินค้า เพิ่มสินค้าในคลังร้านก่อน') : (products.length ? 'No matching products. Try another name.' : 'Add products to your store catalog first.')}</p>}
    <p className="promotion-help">{th ? `เลือกแล้ว ${selected.length} รายการ` : `${selected.length} selected`}</p>
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
  const [editorOpen, setEditorOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLHeadingElement>(null);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
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
    if (!artistId) return;
    setLoading(true); setLoadError(false);
    try {
      const [nextDefinitions, nextCampaigns] = await Promise.all([listPromotionDefinitions(artistId), listMyOnlineCampaigns()]);
      setDefinitions(nextDefinitions);
      setCampaigns(nextCampaigns.filter((campaign) => campaign.artist_id === artistId).map((campaign) => ({ id: campaign.id, name: campaign.name })));
    } catch (error) {
      console.error(error);
      setLoadError(true);
    } finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, [artistId]);
  useEffect(() => {
    if (editorOpen) nameRef.current?.focus();
  }, [editorOpen, editingId]);
  const closeEditor = () => { setEditorOpen(false); setMessage(''); requestAnimationFrame(() => listRef.current?.focus()); };


  const reset = () => {
    setEditingId(null); setName(''); setPromotionType('quantity_discount'); setTargetType('all'); setCategory(''); setTag(''); setProductLine(''); setTargetProductIds([]); setBuyQuantity('3'); setRewardValue('50'); setRewardQuantity('1'); setRewardSelectionMode('fixed'); setRewardProductIds([]); setTierGrantMode('highest_only'); setTiers([newTier()]); setAssignmentKeys([]); setStartsAt(''); setEndsAt(''); setCombinationPolicy('exclusive'); setMessage('');
  };

  const edit = (definition: PromotionDefinition) => {
    if (definition.promotion_type === 'legacy_free_eligible_items') return;
    setEditorOpen(true);
    setEditingId(definition.id); setName(definition.name || ''); setPromotionType(definition.promotion_type); setTargetType(definition.target_type); setCategory(definition.match_category || ''); setTag(definition.match_tag || ''); setTargetProductIds(definition.match_product_ids || []); setBuyQuantity(String(definition.buy_quantity || 3)); setRewardValue(String(definition.reward_value || 50)); setRewardQuantity(String(definition.reward_quantity || 1)); setRewardSelectionMode(definition.reward_selection_mode || 'fixed'); setRewardProductIds(definition.reward_product_ids); setTierGrantMode(definition.tier_grant_mode || 'highest_only');
    setTiers(definition.tiers.length ? definition.tiers.map((tier) => ({ key: tier.id, threshold: String(tier.threshold_amount), quantity: String(tier.reward_quantity), selectionMode: tier.reward_selection_mode, rewardProductIds: tier.reward_product_ids })) : [newTier()]);
    setAssignmentKeys(definition.assignments.filter((assignment) => !assignment.is_paused).map((assignment) => assignment.campaign_id ? `campaign:${assignment.campaign_id}` : `event:${assignment.event_id}:${assignment.event_phase}`));
    const first = definition.assignments[0];
    setStartsAt(promotionLocalDateTime(first?.starts_at)); setEndsAt(promotionLocalDateTime(first?.ends_at)); setCombinationPolicy(first?.combination_policy || 'exclusive'); setMessage('');

  };

  const toggleAssignment = (key: string) => setAssignmentKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  const toIso = (value: string) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
  const buildPayload = (paused: boolean, id = editingId): SavePromotionDefinitionInput => ({
    expected_revision: definitions.find((definition) => definition.id === id)?.revision,
    id, artist_id: artistId, name: name.trim(), promotion_type: promotionType,
    target_type: targetType === 'product_line' ? 'product' : targetType,
    match_category: targetType === 'category' || targetType === 'category_tag' ? category.trim() : null,
    match_tag: targetType === 'tag' || targetType === 'category_tag' ? tag.trim() : null,
    match_product_ids: targetType === 'product' || targetType === 'product_line' ? effectiveTargetIds : [],
    buy_quantity: promotionType === 'spend_tier_gift' ? null : Number(buyQuantity), reward_value: promotionType === 'quantity_discount' ? Number(rewardValue) : null, reward_quantity: promotionType === 'quantity_gift' ? Number(rewardQuantity) : null, reward_selection_mode: promotionType === 'quantity_gift' ? rewardSelectionMode : null, tier_grant_mode: promotionType === 'spend_tier_gift' ? tierGrantMode : null,
    reward_product_ids: promotionType === 'quantity_gift' ? rewardProductIds : [],
    tiers: promotionType === 'spend_tier_gift' ? tiers.map((tier, index) => ({ threshold_amount: Number(tier.threshold), reward_quantity: Number(tier.quantity), reward_selection_mode: tier.selectionMode, sort_order: index, reward_product_ids: tier.rewardProductIds })) : [],
    assignments: assignmentKeys.map((key) => {
      const [kind, assignmentId, phase] = key.split(':');
      const previous = definitions.find((definition) => definition.id === id)?.assignments;
      const original = previous?.find((assignment) => kind === 'campaign' ? assignment.campaign_id === assignmentId : assignment.event_id === assignmentId && assignment.event_phase === phase);
      return {
        event_id: kind === 'event' ? assignmentId : null, event_phase: kind === 'event' ? phase as PromotionEventPhase : null, campaign_id: kind === 'campaign' ? assignmentId : null,
        starts_at: original && startsAt === promotionLocalDateTime(previous?.[0]?.starts_at) ? original.starts_at : toIso(startsAt),
        ends_at: original && endsAt === promotionLocalDateTime(previous?.[0]?.ends_at) ? original.ends_at : toIso(endsAt),
        is_paused: paused, combination_policy: combinationPolicy,
      };
    }),
  });

  const validate = () => {
    if (!name.trim()) return th ? 'กรอกชื่อโปรโมชัน' : 'Enter a promotion name.';
    if (!assignmentKeys.length) return th ? 'เลือกช่องทางขายอย่างน้อย 1 ช่องทาง' : 'Choose at least one sales channel.';
    if ([startsAt, endsAt].some((value) => value && !Number.isFinite(new Date(value).getTime()))) return th ? 'วันเวลาไม่ถูกต้อง กรุณาระบุใหม่' : 'Invalid date. Please enter it again.';
    if (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt)) return th ? 'เวลาเริ่มต้องมาก่อนเวลาสิ้นสุด' : 'Start time must be before end time.';
    if ((targetType === 'product' || targetType === 'product_line') && !effectiveTargetIds.length) return th ? 'เลือกสินค้าอย่างน้อย 1 รายการ' : 'Choose at least one product.';
    if ((targetType === 'category' || targetType === 'category_tag') && !category.trim()) return th ? 'เลือกหมวดหมู่' : 'Choose a category.';
    if ((targetType === 'tag' || targetType === 'category_tag') && !tag.trim()) return th ? 'เลือกแท็ก' : 'Choose a tag.';
    if (promotionType !== 'spend_tier_gift' && (!Number.isInteger(Number(buyQuantity)) || Number(buyQuantity) < 1)) return th ? 'จำนวนสินค้าต้องเป็นเลขจำนวนเต็มมากกว่า 0' : 'Buy quantity must be a positive integer.';
    if (promotionType === 'quantity_discount' && (!Number.isFinite(Number(rewardValue)) || Number(rewardValue) <= 0)) return th ? 'ส่วนลดต้องมากกว่า 0' : 'Discount must be greater than 0.';
    if (promotionType === 'quantity_gift' && (!rewardProductIds.length || !Number.isInteger(Number(rewardQuantity)) || Number(rewardQuantity) < 1)) return th ? 'เลือกของแถมและจำนวนให้ครบ' : 'Choose reward products and quantity.';
    if (promotionType === 'quantity_gift' && rewardSelectionMode === 'fixed' && rewardProductIds.length !== 1) return th ? 'ของแถมแบบกำหนดตายตัวเลือกได้ 1 รายการ' : 'A fixed reward needs exactly one product.';
    if (promotionType === 'spend_tier_gift' && tiers.some((tier) => !Number.isFinite(Number(tier.threshold)) || Number(tier.threshold) <= 0 || !Number.isInteger(Number(tier.quantity)) || Number(tier.quantity) < 1 || !tier.rewardProductIds.length || (tier.selectionMode === 'fixed' && tier.rewardProductIds.length !== 1))) return th ? 'กรอกเงื่อนไขและของแถมของทุกระดับให้ครบ' : 'Complete every tier and its rewards.';
    if (promotionType === 'spend_tier_gift' && new Set(tiers.map((tier) => Number(tier.threshold))).size !== tiers.length) return th ? 'ยอดซื้อของแต่ละระดับต้องไม่ซ้ำกัน' : 'Each tier needs a different spending threshold.';
    return '';
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const validationError = validate(); if (validationError) { setMessage(validationError); return; }
    setSaving(true); setMessage('');
    try {
      const payload = buildPayload(false);
      try {
        await savePromotionDefinition(payload);
      } catch (error) {
        if (!(error instanceof PromotionSaveConflict)) throw error;
        const names = Array.from(new Set(error.promotionNames));
        if (!window.confirm(th ? `โปรนี้ชนกับ ${names.join(', ')}\nใช้กติกาที่เลือกไว้และเปิดใช้เลยหรือไม่?` : `This overlaps ${names.join(', ')}. Activate using the selected combination rule?`)) {
          setMessage(th ? 'ยังไม่ได้บันทึก โปรเดิมยังทำงานตามเดิม' : 'Not saved. The existing promotion is unchanged.'); return;
        }
        await savePromotionDefinition({ ...payload, confirmation_token: error.token });
      }
      reset(); setEditorOpen(false); setMessage(th ? 'บันทึกโปรโมชันแล้ว จะใช้ตามช่องทางและช่วงเวลาที่กำหนด' : 'Promotion saved. It will apply in the assigned channels and schedule.'); await refresh(); requestAnimationFrame(() => listRef.current?.focus());
    } catch (error) { console.error(error); setMessage(th ? 'บันทึกโปรโมชันไม่สำเร็จ กรุณาตรวจข้อมูลอีกครั้ง' : 'Could not save promotion. Check the form and try again.'); }
    finally { setSaving(false); }
  };

  const archive = async (id: string) => {
    if (archivingId || !window.confirm(th ? 'เก็บโปรโมชันนี้เข้าคลังและหยุดใช้กับออเดอร์ใหม่? ออเดอร์เดิมจะไม่เปลี่ยน' : 'Archive this promotion and stop applying it to new orders? Existing orders will not change.')) return;
    setArchivingId(id); setMessage('');
    try { await archivePromotionDefinition(id); await refresh(); setMessage(th ? 'เก็บโปรโมชันเข้าคลังแล้ว' : 'Promotion archived.'); }
    catch { setMessage(th ? 'ยืนยันผลการเก็บเข้าคลังไม่ได้ กรุณาโหลดหน้าใหม่เพื่อตรวจสถานะ' : 'Could not confirm archival. Reload to check the current status.'); }
    finally { setArchivingId(null); }
  };

  const rulePreview = promotionType === 'quantity_discount' ? (th ? `ทุก ${buyQuantity || 0} ชิ้น ลด ฿${rewardValue || 0} (ใช้ซ้ำทุกชุด)` : `Every ${buyQuantity || 0} items, save ฿${rewardValue || 0} (repeats)`) : promotionType === 'quantity_gift' ? (th ? `ทุก ${buyQuantity || 0} ชิ้น รับฟรี ${rewardQuantity || 0} ชิ้น` : `Every ${buyQuantity || 0} items, get ${rewardQuantity || 0} free`) : (th ? `${tierGrantMode === 'highest_only' ? 'รับเฉพาะระดับสูงสุด' : 'รับของแถมทุกระดับที่ถึง'} โดยคิดจากยอดหลังหักส่วนลด` : `${tierGrantMode === 'highest_only' ? 'Highest tier only' : 'Every reached tier'}, based on merchandise after discounts`);

  const phaseName = (phase: string | null) => phase === 'preorder' ? (th ? 'ก่อนงาน · พรีออเดอร์' : 'Pre-order') : phase === 'live' ? (th ? 'ขายวันงาน' : 'Live event') : (th ? 'หลังจบงาน' : 'Post-order');
  const channelName = (key: string) => {
    const [kind, id, phase] = key.split(':');
    return kind === 'campaign' ? campaigns.find((item) => item.id === id)?.name || (th ? 'แคมเปญออนไลน์' : 'Online campaign') : `${eventOptions.find((item) => item.id === id)?.event_name || (th ? 'อีเวนต์' : 'Event')} · ${phaseName(phase)}`;
  };
  const productNames = (ids: string[]) => ids.map((id) => products.find((product) => product.id === id)?.name || (th ? 'สินค้าไม่อยู่ในคลังปัจจุบัน' : 'Product no longer in catalog')).join(', ');
  const targetSummary = targetType === 'all' ? (th ? 'สินค้าทั้งหมดในช่องทางที่เลือก' : 'All products in the selected channels') : targetType === 'product' || targetType === 'product_line' ? productNames(effectiveTargetIds) || (th ? 'ยังไม่ได้เลือกสินค้า' : 'No products selected') : [targetType !== 'tag' && `${th ? 'หมวดหมู่' : 'Category'}: ${category || '—'}`, targetType !== 'category' && `${th ? 'แท็ก' : 'Tag'}: ${tag || '—'}`].filter(Boolean).join(' + ');
  const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString(th ? 'th-TH' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const scheduleLabel = (start: string | null, end: string | null) => `${start ? `${th ? 'เริ่ม' : 'From'} ${dateLabel(start)}` : (th ? 'ไม่กำหนดวันเริ่ม' : 'No start limit')} · ${end ? `${th ? 'ถึง' : 'until'} ${dateLabel(end)}` : (th ? 'ไม่กำหนดวันสิ้นสุด' : 'No end limit')}`;
  const assignmentStatus = (assignment: PromotionDefinition['assignments'][number]) => assignment.is_paused ? (th ? 'พักใช้งาน' : 'Paused') : assignment.ends_at && new Date(assignment.ends_at).getTime() <= Date.now() ? (th ? 'สิ้นสุดแล้ว' : 'Ended') : assignment.starts_at && new Date(assignment.starts_at).getTime() > Date.now() ? (th ? 'รอเริ่ม' : 'Scheduled') : (th ? 'ใช้ได้เมื่อช่องทางเปิดขาย' : 'Applies when the channel is open');
  const previewAssignments = editorOpen ? buildPayload(false).assignments : [];
  const editingArchived = definitions.find((definition) => definition.id === editingId)?.lifecycle_status === 'archived';
  const visibleDefinitions = definitions.filter((definition) => (showArchived || definition.lifecycle_status !== 'archived') && (definition.name || '').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  return <section className="promotion-workspace" aria-label={th ? 'จัดการโปรโมชัน' : 'Promotion workspace'}>
    {!editorOpen && <>
      <div className="promotion-toolbar">
        <div><h3 ref={listRef} tabIndex={-1}>{th ? 'โปรโมชันของร้าน' : 'Store promotions'}</h3><p className="promotion-help">{th ? 'ใช้ให้อัตโนมัติเมื่อซื้อครบเงื่อนไข ไม่ต้องกรอกโค้ด' : 'Offers apply automatically when eligible. No code needed.'}</p></div>
        <button type="button" className="promotion-button promotion-primary" disabled={loading || loadError} onClick={() => { reset(); setEditorOpen(true); }}><Plus size={17} />{th ? 'สร้างโปรโมชัน' : 'Create promotion'}</button>
      </div>
      {lockedEventId && <p className="promotion-context">{th ? `กำลังจัดการจากงาน ${lockedEventName || ''} · โปรของร้านนำไปใช้ได้หลายช่องทาง การแก้เงื่อนไขมีผลกับทุกช่องทางที่ใช้โปรนี้` : `Managing from ${lockedEventName || 'this event'}. Store offers can be shared; editing their terms affects every assigned channel.`}</p>}
      {message && <p role="status" className="promotion-notice">{message}</p>}
      {loading ? <p role="status" className="promotion-empty"><Loader2 className="animate-spin" size={20} />{th ? 'กำลังโหลดโปรโมชัน…' : 'Loading promotions…'}</p> : loadError ? <div role="alert" className="promotion-empty"><p>{th ? 'โหลดโปรโมชันไม่สำเร็จ กรุณาลองใหม่' : 'Could not load promotions. Please retry.'}</p><button type="button" className="promotion-button" onClick={() => void refresh()}>{th ? 'ลองใหม่' : 'Retry'}</button></div> : <>
        {!!definitions.length && <div className="promotion-toolbar"><label className="promotion-search"><span className={labelClass}>{th ? 'ค้นหาโปรโมชัน' : 'Search promotions'}</span><input className={fieldClass} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={th ? 'ชื่อโปรโมชัน' : 'Promotion name'} /></label><label className="promotion-channel"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />{th ? 'แสดงที่เก็บเข้าคลัง' : 'Include archived'}</label></div>}
        <div className="promotion-list">{visibleDefinitions.map((definition) => <article key={definition.id} className="promotion-saved">
          <div className="promotion-toolbar"><div><p className="promotion-help">{definition.lifecycle_status === 'archived' ? (th ? 'เก็บเข้าคลังแล้ว' : 'Archived') : definition.lifecycle_status === 'draft' ? (th ? 'ฉบับร่าง' : 'Draft') : (th ? 'ตั้งค่าแล้ว' : 'Configured')}</p><h4>{definition.name || (th ? 'โปรโมชัน' : 'Promotion')}</h4></div><div className="promotion-actions">
            <button type="button" className="promotion-button" disabled={!!archivingId || definition.promotion_type === 'legacy_free_eligible_items'} aria-label={th ? 'แก้ไขโปรโมชัน' : 'Edit promotion'} onClick={() => edit(definition)}><Edit2 size={16} />{th ? 'แก้ไข' : 'Edit'}</button>
            {definition.lifecycle_status !== 'archived' && <button type="button" className="promotion-button" disabled={!!archivingId} aria-label={th ? 'เก็บโปรโมชันเข้าคลัง' : 'Archive promotion'} onClick={() => void archive(definition.id)}>{archivingId === definition.id ? <Loader2 size={16} className="animate-spin" /> : <Archive size={16} />}{th ? 'เก็บเข้าคลัง' : 'Archive'}</button>}
          </div></div>
          <p className="promotion-saved-rule">{definition.promotion_type === 'quantity_discount' ? (th ? `ทุก ${definition.buy_quantity} ชิ้น ลด ฿${definition.reward_value}` : `Every ${definition.buy_quantity} items, save ฿${definition.reward_value}`) : definition.promotion_type === 'quantity_gift' ? (th ? `ทุก ${definition.buy_quantity} ชิ้น รับของแถม ${definition.reward_quantity} ชิ้น` : `Every ${definition.buy_quantity} items, get ${definition.reward_quantity} gifts`) : definition.promotion_type === 'spend_tier_gift' ? definition.tiers.map((tier) => th ? `ครบ ฿${tier.threshold_amount} รับ ${tier.reward_quantity} ชิ้น` : `Spend ฿${tier.threshold_amount}, get ${tier.reward_quantity} gifts`).join(' · ') : (th ? 'โปรโมชันรูปแบบเก่า แก้ไขไม่ได้ กรุณาสร้างโปรใหม่แทน' : 'Legacy offer. Create a new promotion to change its terms.')}</p>
          {definition.lifecycle_status === 'ready' && <p className="promotion-help">{Array.from(new Set(definition.assignments.map(assignmentStatus))).join(' · ')}</p>}
          <details className="promotion-details"><summary>{th ? 'เงื่อนไขและช่วงใช้งาน' : 'Terms and schedule'} ({definition.assignments.length})</summary>
            <p className="promotion-help">{definition.target_type === 'all' ? (th ? 'สินค้าทั้งหมดในช่องทางที่เลือก' : 'All products in assigned channels') : definition.target_type === 'product' ? productNames(definition.match_product_ids || []) : [definition.match_category && `${th ? 'หมวดหมู่' : 'Category'}: ${definition.match_category}`, definition.match_tag && `${th ? 'แท็ก' : 'Tag'}: ${definition.match_tag}`].filter(Boolean).join(' + ')}</p>
            {definition.promotion_type === 'quantity_gift' && <p className="promotion-help">{definition.reward_selection_mode === 'fixed' ? (th ? 'ของแถมที่ร้านกำหนด: ' : 'Fixed gift: ') : (th ? 'ลูกค้าเลือกของแถมจาก: ' : 'Customer chooses from: ')}{productNames(definition.reward_product_ids)}</p>}
            {definition.promotion_type === 'spend_tier_gift' && <><p className="promotion-help">{definition.tier_grant_mode === 'highest_only' ? (th ? 'รับเฉพาะระดับสูงสุด' : 'Highest tier only') : (th ? 'รับทุกระดับที่ถึง' : 'Every reached tier')}{th ? ' · คิดยอดหลังส่วนลด ไม่รวมค่าส่งและของแถม' : ' · After discounts, excluding shipping and gifts'}</p>{definition.tiers.map((tier) => <p className="promotion-help" key={tier.id}>฿{tier.threshold_amount} → {productNames(tier.reward_product_ids)} · {tier.reward_quantity} {th ? 'ชิ้น' : 'items'} · {tier.reward_selection_mode === 'fixed' ? (th ? 'ร้านกำหนด' : 'Fixed') : (th ? 'ลูกค้าเลือก' : 'Customer chooses')}</p>)}</>}
            {!definition.assignments.length && <p className="promotion-help">{th ? 'ยังไม่ได้เลือกช่องทางขาย' : 'No sales channels assigned'}</p>}
            {definition.assignments.map((assignment) => <div key={assignment.id} className="promotion-assignment"><strong>{channelName(assignment.campaign_id ? `campaign:${assignment.campaign_id}` : `event:${assignment.event_id}:${assignment.event_phase}`)}</strong><span>{definition.lifecycle_status === 'archived' ? (th ? 'หยุดใช้แล้ว' : 'No longer applies') : assignmentStatus(assignment)}</span><p>{scheduleLabel(assignment.starts_at, assignment.ends_at)}</p><p>{assignment.combination_policy === 'combine' ? (th ? 'ใช้ร่วมกับโปรอื่นได้' : 'Combines with other offers') : (th ? 'ไม่ใช้ร่วมกับโปรอื่น' : 'Does not combine')}</p></div>)}
            <p className="promotion-help">{Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
          </details>
        </article>)}</div>
        {!visibleDefinitions.length && <div className="promotion-empty"><Gift size={28} /><h4>{definitions.length ? (th ? 'ไม่พบโปรโมชันที่ตรงกับตัวกรอง' : 'No matching promotions') : (th ? 'เริ่มจากข้อเสนอที่ลูกค้าเข้าใจง่าย' : 'Start with an offer customers understand')}</h4><p>{definitions.length ? (th ? 'ลองเปลี่ยนคำค้น หรือแสดงโปรที่เก็บเข้าคลัง' : 'Try another search or include archived offers.') : (th ? 'เช่น ซื้อทุก 3 ชิ้น ลด 50 บาท หรือซื้อครบรับของแถม เปิดขายโดยไม่มีโปรโมชันก็ได้' : 'For example, buy 3 and save ฿50, or earn a gift. Promotions are optional.')}</p></div>}
      </>}
    </>}
    {editorOpen && <form id="promotion-editor" onSubmit={save} onChange={() => { if (message) setMessage(''); }}>
      <div className="promotion-toolbar"><div><button type="button" className="promotion-button" disabled={saving} onClick={closeEditor}><ArrowLeft size={16} />{th ? 'กลับรายการ' : 'Back to promotions'}</button><h3 className="mt-4">{editingId ? (th ? 'แก้ไขโปรโมชัน' : 'Edit promotion') : (th ? 'สร้างโปรโมชัน' : 'Create promotion')}</h3></div><p className="promotion-help">{th ? 'ยังไม่มีผลจนกว่าจะบันทึก' : 'Changes apply only after saving'}</p></div>
      {editingId && <p className="promotion-context">{th ? 'การแก้เงื่อนไขจะมีผลกับทุกช่องทางที่แสดงในสรุป หากแก้เวลา จะใช้เวลาใหม่กับทุกช่องทางที่เลือก' : 'Term changes affect every channel in the summary. Changing a date applies that date to all selected channels.'}</p>}
      <div className="promotion-editor-layout">
      <fieldset disabled={saving} className="promotion-fields">
        <div className="promotion-section"><h4 className="font-black text-gray-900">{th ? 'เงื่อนไขและสิทธิ์ที่ได้รับ' : 'Offer and benefits'}</h4><label><span className={labelClass}>{th ? 'ชื่อโปรโมชัน' : 'Promotion name'}</span><input ref={nameRef} required autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} placeholder={th ? 'เช่น ทุก 3 ชิ้น ลด 50 บาท' : 'e.g. Every 3 items save ฿50'} /></label><fieldset className="promotion-types"><legend className={labelClass}>{th ? 'ลูกค้าจะได้รับอะไร' : 'What does the customer receive?'}</legend>{([
            ['quantity_discount', th ? 'ส่วนลด' : 'Discount', th ? 'ซื้อครบจำนวน ลดเป็นบาท' : 'Save money for every bundle'],
            ['quantity_gift', th ? 'ซื้อครบรับของแถม' : 'Buy & get a gift', th ? 'ซื้อครบจำนวน รับของแถม' : 'Earn gifts for every bundle'],
            ['spend_tier_gift', th ? 'ของแถมตามยอดซื้อ' : 'Spend & get a gift', th ? 'กำหนดยอดซื้อและของแถมแต่ละระดับ' : 'Set spending thresholds and gifts'],
          ] as const).map(([value, title, detail]) => <label key={value} className="promotion-type"><input type="radio" name="promotion-type" value={value} checked={promotionType === value} onChange={() => setPromotionType(value)} /><span><strong>{title}</strong><small>{detail}</small></span></label>)}</fieldset>{promotionType !== 'spend_tier_gift' && <div className="grid grid-cols-2 gap-3"><label><span className={labelClass}>{th ? 'ซื้อครบ (ชิ้น)' : 'Buy quantity'}</span><input type="number" required min="1" step="1" value={buyQuantity} onChange={(event) => setBuyQuantity(event.target.value)} className={fieldClass} /></label>{promotionType === 'quantity_discount' ? <label><span className={labelClass}>{th ? 'ลด (บาท)' : 'Discount (THB)'}</span><input type="number" required min="0.01" step="0.01" value={rewardValue} onChange={(event) => setRewardValue(event.target.value)} className={fieldClass} /></label> : <label><span className={labelClass}>{th ? 'รับฟรี (ชิ้น)' : 'Free quantity'}</span><input type="number" required min="1" step="1" value={rewardQuantity} onChange={(event) => setRewardQuantity(event.target.value)} className={fieldClass} /></label>}</div>}{promotionType === 'spend_tier_gift' && <label><span className={labelClass}>{th ? 'เมื่อถึงหลายระดับ' : 'When multiple tiers are reached'}</span><select value={tierGrantMode} onChange={(event) => setTierGrantMode(event.target.value as PromotionTierGrantMode)} className={fieldClass}><option value="highest_only">{th ? 'รับเฉพาะของระดับสูงสุด' : 'Highest tier only'}</option><option value="cumulative">{th ? 'รับของแถมทุกระดับที่ถึง' : 'Every reached tier'}</option></select></label>}<div className="promotion-example">{rulePreview}<p className="promotion-help">{promotionType === 'spend_tier_gift' ? (th ? 'คิดเฉพาะยอดสินค้าที่ร่วมรายการหลังหักส่วนลด ไม่รวมค่าส่งและของแถม' : 'Eligible merchandise after discounts only. Shipping and gifts do not count.') : (th ? 'นับเฉพาะสินค้าที่ร่วมรายการ รับสิทธิ์ซ้ำได้ทุกชุดในออเดอร์เดียวกัน' : 'Only eligible products count. Each complete bundle earns the benefit again.')}</p></div></div>
        <div className="promotion-section"><h4 className="font-black text-gray-900">{th ? 'สินค้าที่ร่วมรายการ' : 'Eligible products'}</h4><label><span className={labelClass}>{th ? 'ใช้กับ' : 'Applies to'}</span><select value={targetType} onChange={(event) => setTargetType(event.target.value as FormTarget)} className={fieldClass}><option value="all">{th ? 'สินค้าทั้งหมด' : 'All products'}</option><option value="product">{th ? 'สินค้าที่ระบุ' : 'Specific products'}</option><option value="product_line">{th ? 'ไลน์สินค้า (เลือกทุกตัวเลือก)' : 'Product line (all variants)'}</option><option value="category">{th ? 'หมวดหมู่' : 'Category'}</option><option value="tag">{th ? 'แท็ก' : 'Tag'}</option><option value="category_tag">{th ? 'หมวดหมู่ + แท็ก' : 'Category + tag'}</option></select></label>{(targetType === 'category' || targetType === 'category_tag') && <SearchableDatalist id="promotion-categories" label={th ? 'หมวดหมู่' : 'Category'} value={category} onChange={setCategory} suggestions={categorySuggestions} placeholder={th ? 'เลือกหรือพิมพ์ค้นหาหมวดหมู่' : 'Choose or search categories'} helper={th ? 'เลือกได้ 1 หมวดหมู่จากแคตตาล็อก' : 'Choose one category from your catalog.'} />}{(targetType === 'tag' || targetType === 'category_tag') && <SearchableDatalist id="promotion-tags" label={th ? 'แท็ก' : 'Tag'} value={tag} onChange={setTag} suggestions={tagSuggestions} placeholder={th ? 'เลือกหรือพิมพ์ค้นหาแท็ก' : 'Choose or search tags'} helper={th ? 'เลือกได้ 1 แท็กจากแคตตาล็อก' : 'Choose one tag from your catalog.'} />}{targetType === 'product_line' && <label><span className={labelClass}>{th ? 'ไลน์สินค้า' : 'Product line'}</span><select value={productLine} onChange={(event) => setProductLine(event.target.value)} className={fieldClass}><option value="">{th ? 'เลือกไลน์สินค้า' : 'Choose a product line'}</option>{productLines.map((value) => <option key={value} value={value}>{value}</option>)}</select><span className="promotion-help">{lineProductIds.length} {th ? 'รายการจะร่วมโปร' : 'products will be included'}</span></label>}{targetType === 'product' && <ProductPicker products={products} selected={targetProductIds} onChange={setTargetProductIds} label={th ? 'ค้นหาสินค้า' : 'Search products'} />}</div>
        {(promotionType === 'quantity_gift' || promotionType === 'spend_tier_gift') && <div className="promotion-section"><h4 className="flex items-center gap-2 font-black text-gray-900"><Gift size={17} className="text-pink-600" />{th ? 'ของแถม' : 'Rewards'}</h4><p className="text-xs font-semibold text-amber-700">{th ? 'ของแถมต้องถูกเพิ่มเข้าแต่ละช่องทางขายและมีสต็อก ระบบจึงจะจองและตัดสต็อกให้ได้' : 'Reward products must also exist with stock in each assigned sales channel.'}</p>{promotionType === 'quantity_gift' ? <><label><span className={labelClass}>{th ? 'ลูกค้าเลือกของแถมหรือไม่' : 'Reward selection'}</span><select value={rewardSelectionMode} onChange={(event) => setRewardSelectionMode(event.target.value as PromotionRewardSelectionMode)} className={fieldClass}><option value="fixed">{th ? 'ร้านกำหนดของแถม 1 รายการ' : 'One fixed reward'}</option><option value="customer_choice">{th ? 'ลูกค้าเลือกจากรายการที่กำหนด' : 'Customer chooses'}</option></select></label><ProductPicker products={products} selected={rewardProductIds} onChange={setRewardProductIds} label={th ? 'ค้นหาของแถม' : 'Search rewards'} /></> : <div className="space-y-3">{tiers.map((tier, index) => <div key={tier.key} className="rounded-xl border border-gray-200 p-3"><h5 className="mb-3 font-bold">{th ? `ระดับ ${index + 1}` : `Tier ${index + 1}`}</h5><div className="grid gap-3 md:grid-cols-3"><label><span className={labelClass}>{th ? 'ยอดถึง (บาท)' : 'Spend (THB)'}</span><input type="number" required min="0.01" step="0.01" value={tier.threshold} onChange={(event) => setTiers((current) => current.map((item) => item.key === tier.key ? { ...item, threshold: event.target.value } : item))} className={fieldClass} /></label><label><span className={labelClass}>{th ? 'รับฟรี (ชิ้น)' : 'Free quantity'}</span><input type="number" required min="1" step="1" value={tier.quantity} onChange={(event) => setTiers((current) => current.map((item) => item.key === tier.key ? { ...item, quantity: event.target.value } : item))} className={fieldClass} /></label><label><span className={labelClass}>{th ? 'การเลือกของแถม' : 'Selection'}</span><select value={tier.selectionMode} onChange={(event) => setTiers((current) => current.map((item) => item.key === tier.key ? { ...item, selectionMode: event.target.value as PromotionRewardSelectionMode } : item))} className={fieldClass}><option value="fixed">{th ? 'ร้านกำหนด 1 รายการ' : 'One fixed reward'}</option><option value="customer_choice">{th ? 'ลูกค้าเลือก' : 'Customer chooses'}</option></select></label></div><div className="mt-2"><ProductPicker products={products} selected={tier.rewardProductIds} onChange={(ids) => setTiers((current) => current.map((item) => item.key === tier.key ? { ...item, rewardProductIds: ids } : item))} label={th ? `ค้นหาของแถมระดับ ${index + 1}` : `Search tier ${index + 1} rewards`} /></div>{tiers.length > 1 && <button type="button" onClick={() => setTiers((current) => current.filter((item) => item.key !== tier.key))} className="promotion-button mt-2">{th ? 'ลบระดับนี้' : 'Remove tier'}</button>}</div>)}<button type="button" onClick={() => setTiers((current) => [...current, newTier()])} className="promotion-button"><Plus size={14} />{th ? 'เพิ่มระดับ' : 'Add tier'}</button></div>}</div>}
        <div className="promotion-section"><h4 className="font-black text-gray-900">{th ? 'ใช้ที่ไหน และเมื่อไหร่' : 'Where and when'}</h4><div className="grid gap-3 md:grid-cols-2"><label><span className={labelClass}>{th ? 'เริ่มใช้ (ไม่บังคับ)' : 'Starts (optional)'}</span><input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className={fieldClass} /></label><label><span className={labelClass}>{th ? 'สิ้นสุด (ไม่บังคับ)' : 'Ends (optional)'}</span><input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} className={fieldClass} /></label></div><p className="text-xs text-gray-500">{th ? 'เวลาที่กรอกอ้างอิงเขตเวลาของอุปกรณ์ หากไม่ระบุจะไม่จำกัดด้วยวันเวลาของโปร แต่ยังต้องอยู่ในช่วงขายที่เลือก' : 'Times use your device timezone. Blank dates add no promotion time limit; the selected sales phase must still be open.'} ({Intl.DateTimeFormat().resolvedOptions().timeZone})</p><label><span className={labelClass}>{th ? 'เมื่อชนกับโปรอื่นในสินค้าเดียวกัน' : 'When another promotion overlaps'}</span><select value={combinationPolicy} onChange={(event) => setCombinationPolicy(event.target.value as PromotionCombinationPolicy)} className={fieldClass}><option value="exclusive">{th ? 'ไม่ใช้ร่วมกัน' : 'Do not combine'}</option><option value="combine">{th ? 'ใช้ร่วมกับโปรอื่นได้' : 'Combine with other promotions'}</option></select><span className="promotion-help">{combinationPolicy === 'exclusive' ? (th ? 'เลือกส่วนลดที่คุ้มที่สุด หรือให้ลูกค้าเลือกโปรของแถม หากพบโปรซ้อนระบบจะให้ยืนยันก่อนบันทึก' : 'Use the best discount, or let the customer choose a gift offer. Overlaps require confirmation before saving.') : (th ? 'ลูกค้าอาจได้รับสิทธิ์จากหลายโปรในสินค้าชุดเดียวกัน ระบบจะตรวจโปรซ้อนก่อนบันทึก' : 'Customers may receive several benefits on the same items. Overlaps are checked before saving.')}</span></label>{!eventOptions.length && !campaigns.length && <p className="promotion-context">{th ? 'ยังไม่มีช่องทางขาย สร้างอีเวนต์หรือแคมเปญก่อน จึงจะเปิดใช้โปรโมชันได้' : 'Create an event or campaign before activating a promotion.'} <a href="/manage-events" target="_blank" rel="noopener noreferrer">{th ? 'ไปจัดการช่องทางขาย ↗' : 'Manage sales channels ↗'}</a></p>}<div className="space-y-2">{eventOptions.filter((event) => !lockedEventId || event.id === lockedEventId).map((event) => <div key={event.id} className="rounded-xl border border-gray-100 p-3"><div className="font-black text-gray-800">{lockedEventId ? lockedEventName || event.event_name : event.event_name}</div><div className="mt-2 flex flex-wrap gap-3">{phaseOptions.map((phase) => { const key = `event:${event.id}:${phase}`; return <label key={phase} className="promotion-channel"><input type="checkbox" checked={assignmentKeys.includes(key)} onChange={() => toggleAssignment(key)} />{phase === 'preorder' ? (th ? 'ก่อนงาน · พรีออเดอร์' : 'Pre-order') : phase === 'live' ? (th ? 'ขายวันงาน' : 'Live event') : (th ? 'หลังจบงาน' : 'Post-order')}</label>; })}</div></div>)}</div>{!lockedEventId && campaigns.length > 0 && <div><div className={labelClass}>{th ? 'แคมเปญขายออนไลน์' : 'Online campaigns'}</div><div className="mt-2 grid gap-2 md:grid-cols-2">{campaigns.map((campaign) => { const key = `campaign:${campaign.id}`; return <label key={campaign.id} className="flex items-center gap-2 rounded-xl border border-gray-100 p-3 text-sm font-bold text-gray-700"><input type="checkbox" checked={assignmentKeys.includes(key)} onChange={() => toggleAssignment(key)} />{campaign.name}</label>; })}</div></div>}</div>
      </fieldset>

        <aside className="promotion-summary" aria-label={th ? 'สรุปก่อนบันทึก' : 'Review before saving'}>
          <h4><Sparkles size={18} />{th ? 'สรุปก่อนบันทึก' : 'Review before saving'}</h4>
          <p className="promotion-summary-name">{name.trim() || (th ? 'โปรโมชันใหม่' : 'New promotion')}</p><p className="promotion-saved-rule">{rulePreview}</p>
          <dl><dt>{th ? 'สินค้าที่ร่วมรายการ' : 'Eligible products'}</dt><dd>{targetSummary}</dd>
            {promotionType === 'quantity_gift' && <><dt>{th ? 'ของแถม' : 'Gifts'}</dt><dd>{productNames(rewardProductIds) || (th ? 'ยังไม่ได้เลือกของแถม' : 'No gifts selected')}<p>{rewardSelectionMode === 'fixed' ? (th ? 'ร้านกำหนด 1 รายการ' : 'One fixed product') : (th ? 'ลูกค้าเลือกและคละของแถมได้ตามสิทธิ์และสต็อก' : 'Customer may mix gifts within entitlement and stock')}</p></dd></>}
            {promotionType === 'spend_tier_gift' && <><dt>{th ? 'ระดับของแถม' : 'Gift tiers'}</dt><dd>{tiers.map((tier) => <p key={tier.key}>฿{tier.threshold || '—'} → {tier.quantity || '—'} {th ? 'ชิ้น' : 'items'} · {productNames(tier.rewardProductIds) || (th ? 'ยังไม่เลือกของแถม' : 'Select gifts')} · {tier.selectionMode === 'fixed' ? (th ? 'ร้านกำหนด' : 'Fixed') : (th ? 'ลูกค้าเลือก' : 'Customer chooses')}</p>)}</dd></>}
            <dt>{th ? 'ช่องทางขาย' : 'Sales channels'}</dt><dd>{assignmentKeys.length ? assignmentKeys.map((key, index) => <p key={key}>{channelName(key)}<small className="promotion-help">{scheduleLabel(previewAssignments[index].starts_at, previewAssignments[index].ends_at)}</small></p>) : (th ? 'ยังไม่ได้เลือกช่องทางขาย' : 'No channel selected')}</dd>
            <dt><CalendarDays size={15} />{th ? 'ช่วงใช้งาน' : 'Schedule'}</dt><dd>{Intl.DateTimeFormat().resolvedOptions().timeZone}<p className="promotion-help">{th ? 'ใช้เฉพาะช่วงที่ช่องทางนั้นเปิดขาย' : 'Only while the assigned channel is open'}</p></dd>
            <dt>{th ? 'ใช้ร่วมกับโปรอื่น' : 'Combining offers'}</dt><dd>{combinationPolicy === 'combine' ? (th ? 'ใช้ร่วมกันได้' : 'Allowed') : (th ? 'ไม่ใช้ร่วมกัน — ส่วนลดที่คุ้มที่สุด หรือให้ลูกค้าเลือกโปรของแถม' : 'Best discount or customer gift-offer choice')}</dd></dl>
          {promotionType !== 'quantity_discount' && <p className="promotion-context">{th ? 'ก่อนเปิดใช้ อย่าลืมจัดสรรสต็อกของแถมให้ทุกช่องทางที่เลือก ระบบตรวจสต็อกอีกครั้งตอนสั่งซื้อ' : 'Allocate gift stock to each selected channel. Availability is rechecked at checkout.'}</p>}
          {lockedEventId && <a className="promotion-button" href={`/manage-events/${lockedEventId}/preorder`} target="_blank" rel="noopener noreferrer">{th ? 'ดูช่วงขายของงาน' : 'Review sales windows'} ↗</a>}
          {message && <p role="alert" className="promotion-notice">{message}</p>}
          <button disabled={saving || loading || loadError} className="promotion-button promotion-primary promotion-submit">{saving ? <Loader2 className="animate-spin" size={17} /> : <Check size={17} />}{saving ? (th ? 'กำลังตรวจและบันทึก…' : 'Checking and saving…') : editingArchived ? (th ? 'บันทึกและเปิดใช้อีกครั้ง' : 'Save and reactivate') : editingId ? (th ? 'บันทึกการแก้ไข' : 'Save changes') : (th ? 'บันทึกและเปิดใช้' : 'Save and activate')}</button>
          <p className="promotion-help">{th ? 'ตรวจโปรซ้อนก่อนบันทึก ออเดอร์เดิมคงราคาเดิม' : 'Overlaps are checked before saving. Existing orders keep their prices.'}</p>
        </aside>
      </div>
    </form>}
  </section>;
}
