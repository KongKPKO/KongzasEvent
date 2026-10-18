import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, FlaskConical, Gift, Loader2, Search, Sparkles, Trash2 } from 'lucide-react';
import { previewPromotionDefinition, PromotionSaveConflict, savePromotionDefinition, toPromotionError } from '../../lib/promotions';
import { promotionLocalDateTime } from '../../lib/promotionDateTime';
import type {
  PromotionCombinationPolicy,
  PromotionDefinition,
  PromotionEventPhase,
  PromotionPreviewResult,
  PromotionTargetType,
  PromotionV1Config,
  SavePromotionDefinitionInput,
} from '../../types/promotion';

export interface PromotionEditorProduct {
  id: string;
  name: string;
  price?: number;
  currency?: string;
  category?: string;
  tags?: string[];
  sku?: string | null;
  status?: 'enable' | 'disable' | 'soldout';
  variant_group_name?: string | null;
  variant_name?: string | null;
}

interface EventLite {
  id: string;
  event_name: string;
}

interface PromotionV1EditorProps {
  artistId: string;
  products: PromotionEditorProduct[];
  events: EventLite[];
  campaigns: Array<{ id: string; name: string }>;
  existing: PromotionDefinition | null;
  lockedEventId?: string;
  lockedEventName?: string;
  categorySuggestions: string[];
  tagSuggestions: string[];
  th: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

type ConditionKind = PromotionV1Config['condition']['kind'];
type V1FormTarget = PromotionTargetType | 'product_line';
type ItemDraft = { product_id: string; quantity: string };
type CartItem = { product_id: string; quantity: number };
const phaseOptions: PromotionEventPhase[] = ['preorder', 'live', 'postorder'];
const inputClass = 'promotion-input';
const labelClass = 'promotion-label';

const productLabel = (product: PromotionEditorProduct) => [
  product.variant_group_name || product.name,
  product.variant_name,
  product.sku ? `SKU ${product.sku}` : null,
].filter(Boolean).join(' · ');

const money = (value: number) => new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);

export function promotionV1RuleText(config: PromotionV1Config, products: PromotionEditorProduct[], th: boolean) {
  const name = (id: string) => productLabel(products.find((product) => product.id === id) || { id, name: th ? 'สินค้าที่ไม่อยู่ในคลัง' : 'Product no longer in catalog' });
  const condition = config.condition.kind === 'quantity'
    ? (th ? `ซื้อครบ ${config.condition.quantity} ชิ้น` : `Buy ${config.condition.quantity} items`)
    : config.condition.kind === 'spend'
      ? (th ? `ซื้อครบ ฿${money(config.condition.amount)}` : `Spend ฿${money(config.condition.amount)}`)
      : config.condition.kind === 'product'
        ? (th ? `ซื้อ ${name(config.condition.items[0]?.product_id || '')} ×${config.condition.items[0]?.quantity || 0}` : `Buy ${name(config.condition.items[0]?.product_id || '')} ×${config.condition.items[0]?.quantity || 0}`)
        : `${th ? 'ซื้อครบชุด' : 'Complete the set'} ${config.condition.items.map((item) => `${name(item.product_id)} ×${item.quantity}`).join(' + ')}`;
  const rewards = [
    config.discount ? config.discount.kind === 'fixed'
      ? (th ? `ลด ฿${money(config.discount.value)}` : `save ฿${money(config.discount.value)}`)
      : (th ? `ลด ${money(config.discount.value)}%` : `save ${money(config.discount.value)}%`) : '',
    config.gift ? `${th ? 'รับ' : 'get'} ${name(config.gift.product_id)} ×${config.gift.quantity}${config.gift.limit === null ? '' : ` (${th ? 'จำกัด' : 'limit'} ${config.gift.limit})`}` : '',
  ].filter(Boolean).join(th ? ' พร้อม ' : ' and ');
  return `${condition} ${th ? 'รับ' : '—'} ${rewards}`;
}

function ExactSkuPicker({ products, onPick, th, disabledIds = [], gift = false }: { products: PromotionEditorProduct[]; onPick: (id: string) => void; th: boolean; disabledIds?: string[]; gift?: boolean }) {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLocaleLowerCase();
  const matches = products.filter((product) => !disabledIds.includes(product.id) && `${product.name} ${product.variant_group_name || ''} ${product.variant_name || ''} ${product.sku || ''}`.toLocaleLowerCase().includes(normalized)).slice(0, 20);
  return <div className="promotion-sku-picker">
    <label><span className={labelClass}>{gift ? (th ? 'ค้นหา SKU ของแถม' : 'Find gift SKU') : (th ? 'ค้นหาสินค้า / SKU' : 'Find product / SKU')}</span><span className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} /><input className={`${inputClass} pl-9`} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={th ? 'ชื่อสินค้า ชื่อตัวเลือก หรือ SKU' : 'Name, variant, or SKU'} /></span></label>
    {query.trim() && <div className="promotion-sku-results">{matches.map((product) => {
      const unavailable = gift && product.status !== undefined && product.status !== 'enable';
      return <button key={product.id} type="button" disabled={unavailable} onClick={() => { onPick(product.id); setQuery(''); }}><span>{productLabel(product)}</span>{unavailable && <small>{th ? 'ปิดขายหรือขายหมด' : 'Disabled or sold out'}</small>}</button>;
    })}{!matches.length && <p>{th ? 'ไม่พบ SKU ที่ตรงกัน' : 'No matching SKU'}</p>}</div>}
  </div>;
}

export default function PromotionV1Editor({ artistId, products, events, campaigns, existing, lockedEventId, lockedEventName, categorySuggestions, tagSuggestions, th, onClose, onSaved }: PromotionV1EditorProps) {
  const saved = existing?.v1_config;
  const firstAssignment = existing?.assignments[0];
  const initialCondition = saved?.condition;
  const [name, setName] = useState(existing?.name || '');
  const [conditionKind, setConditionKind] = useState<ConditionKind>(initialCondition?.kind || 'quantity');
  const [conditionValue, setConditionValue] = useState(String(initialCondition?.kind === 'spend' ? initialCondition.amount : initialCondition?.kind === 'quantity' ? initialCondition.quantity : 3));
  const [conditionItems, setConditionItems] = useState<ItemDraft[]>(initialCondition?.kind === 'product' || initialCondition?.kind === 'recipe' ? initialCondition.items.map((item) => ({ product_id: item.product_id, quantity: String(item.quantity) })) : []);
  const [targetType, setTargetType] = useState<V1FormTarget>(existing?.target_type || 'all');
  const [productLine, setProductLine] = useState('');
  const [category, setCategory] = useState(existing?.match_category || '');
  const [tag, setTag] = useState(existing?.match_tag || '');
  const [targetProductIds, setTargetProductIds] = useState<string[]>(existing?.match_product_ids || []);
  const [discountEnabled, setDiscountEnabled] = useState(Boolean(saved?.discount));
  const [discountKind, setDiscountKind] = useState<'fixed' | 'percentage'>(saved?.discount?.kind || 'fixed');
  const [discountValue, setDiscountValue] = useState(String(saved?.discount?.value || 50));
  const [giftEnabled, setGiftEnabled] = useState(Boolean(saved?.gift));
  const [giftProductId, setGiftProductId] = useState(saved?.gift?.product_id || '');
  const [giftQuantity, setGiftQuantity] = useState(String(saved?.gift?.quantity || 1));
  const [giftLimit, setGiftLimit] = useState(saved?.gift?.limit === null || saved?.gift?.limit === undefined ? '' : String(saved.gift.limit));
  const [assignmentKeys, setAssignmentKeys] = useState(existing?.assignments.filter((assignment) => !assignment.is_paused).map((assignment) => assignment.campaign_id ? `campaign:${assignment.campaign_id}` : `event:${assignment.event_id}:${assignment.event_phase}`) || []);
  const [startsAt, setStartsAt] = useState(promotionLocalDateTime(firstAssignment?.starts_at));
  const [endsAt, setEndsAt] = useState(promotionLocalDateTime(firstAssignment?.ends_at));
  const [combinationPolicy, setCombinationPolicy] = useState<PromotionCombinationPolicy>(firstAssignment?.combination_policy || 'exclusive');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [previewChannel, setPreviewChannel] = useState(assignmentKeys[0] || '');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [preview, setPreview] = useState<PromotionPreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const productLines = useMemo(() => Array.from(new Set(products.map((product) => product.variant_group_name).filter(Boolean) as string[])).sort(), [products]);
  const lineProductIds = useMemo(() => products.filter((product) => product.variant_group_name === productLine).map((product) => product.id), [productLine, products]);

  const exactItems = conditionItems.map((item) => ({ product_id: item.product_id, quantity: Number(item.quantity) }));
  const config: PromotionV1Config = {
    version: 1,
    condition: conditionKind === 'quantity' ? { kind: 'quantity', quantity: Number(conditionValue) }
      : conditionKind === 'spend' ? { kind: 'spend', amount: Number(conditionValue) }
        : conditionKind === 'product' ? { kind: 'product', items: exactItems }
          : { kind: 'recipe', items: exactItems },
    discount: discountEnabled ? { kind: discountKind, value: Number(discountValue) } : null,
    gift: giftEnabled ? { product_id: giftProductId, quantity: Number(giftQuantity), limit: giftLimit.trim() ? Number(giftLimit) : null } : null,
  };

  const toIso = (value: string) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
  const buildPayload = (): SavePromotionDefinitionInput => ({
    expected_revision: existing?.revision,
    id: existing?.id || null,
    artist_id: artistId,
    name: name.trim(),
    promotion_type: 'condition_reward',
    target_type: conditionKind === 'product' || conditionKind === 'recipe' || targetType === 'product_line' ? 'product' : targetType,
    match_category: conditionKind !== 'product' && conditionKind !== 'recipe' && (targetType === 'category' || targetType === 'category_tag') ? category.trim() : null,
    match_tag: conditionKind !== 'product' && conditionKind !== 'recipe' && (targetType === 'tag' || targetType === 'category_tag') ? tag.trim() : null,
    match_product_ids: conditionKind === 'product' || conditionKind === 'recipe' ? exactItems.map((item) => item.product_id) : targetType === 'product_line' ? lineProductIds : targetType === 'product' ? targetProductIds : [],
    buy_quantity: null,
    reward_value: null,
    reward_quantity: null,
    reward_selection_mode: null,
    tier_grant_mode: null,
    reward_product_ids: [],
    tiers: [],
    v1_config: config,
    assignments: assignmentKeys.map((key) => {
      const [kind, id, phase] = key.split(':');
      const previous = existing?.assignments.find((assignment) => kind === 'campaign' ? assignment.campaign_id === id : assignment.event_id === id && assignment.event_phase === phase);
      return {
        event_id: kind === 'event' ? id : null,
        event_phase: kind === 'event' ? phase as PromotionEventPhase : null,
        campaign_id: kind === 'campaign' ? id : null,
        starts_at: previous && startsAt === promotionLocalDateTime(firstAssignment?.starts_at) ? previous.starts_at : toIso(startsAt),
        ends_at: previous && endsAt === promotionLocalDateTime(firstAssignment?.ends_at) ? previous.ends_at : toIso(endsAt),
        is_paused: false,
        combination_policy: previous && combinationPolicy === (firstAssignment?.combination_policy || 'exclusive') ? previous.combination_policy : combinationPolicy,
      };
    }),
  });

  const previewRequest = useRef(0);
  useEffect(() => {
    previewRequest.current += 1;
    setPreview(null);
    setPreviewing(false);
    return () => { previewRequest.current += 1; };
  }, [name, conditionKind, conditionValue, conditionItems, targetType, productLine, category, tag, targetProductIds, discountEnabled, discountKind, discountValue, giftEnabled, giftProductId, giftQuantity, giftLimit, startsAt, endsAt, assignmentKeys, combinationPolicy, cart, previewChannel]);

  const failureMessage = (error: unknown, previewFailure = false) => {
    const code = toPromotionError(error).code;
    if (code === 'promotion_reward_not_in_channel') return th ? 'เพิ่ม SKU ของแถมเข้าทุกอีเวนต์หรือร้านออนไลน์ที่เลือก และเปิดใช้งานก่อน' : 'Add and enable the gift SKU in every selected event or online campaign first.';
    if (code === 'promotion_gift_limit_below_committed') return th ? 'จำนวนของแถมสูงสุดต้องไม่น้อยกว่ายอดที่ใช้หรือจองสิทธิ์ไว้แล้ว' : 'The gift limit cannot be below rights already used or held.';
    if (code === 'promotion_changed') return th ? 'ข้อมูลโปรโมชันเปลี่ยนแล้ว กรุณาเปิดรายการล่าสุดก่อนแก้ไขอีกครั้ง' : 'The promotion changed. Reload it before editing again.';
    if (code === 'sale_product_unavailable') return th ? 'สินค้าในตะกร้าทดลองยังไม่เปิดขายในช่องทางนี้ หรือมีสต็อกไม่เพียงพอ' : 'A test-cart item is unavailable or has insufficient stock in this channel.';
    return previewFailure ? (th ? 'ทดลองโปรโมชันไม่สำเร็จ กรุณาตรวจช่องทางและสินค้า' : 'Could not preview. Check the channel and cart.') : (th ? 'บันทึกโปรโมชันไม่สำเร็จ กรุณาตรวจข้อมูลอีกครั้ง' : 'Could not save promotion. Check the form and try again.');
  };

  const validate = () => {
    if (!name.trim()) return th ? 'กรอกชื่อโปรโมชัน' : 'Enter a promotion name.';
    if (!assignmentKeys.length) return th ? 'เลือกช่องทางขายอย่างน้อย 1 ช่องทาง' : 'Choose at least one sales channel.';
    if ([startsAt, endsAt].some((value) => value && !Number.isFinite(new Date(value).getTime()))) return th ? 'วันเวลาไม่ถูกต้อง' : 'Enter a valid date.';
    if (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt)) return th ? 'เวลาเริ่มต้องมาก่อนเวลาสิ้นสุด' : 'Start time must be before end time.';
    if (conditionKind === 'quantity' && (!Number.isInteger(Number(conditionValue)) || Number(conditionValue) < 1)) return th ? 'จำนวนสินค้าต้องเป็นเลขจำนวนเต็มมากกว่า 0' : 'Quantity must be a positive integer.';
    if (conditionKind === 'spend' && (!Number.isFinite(Number(conditionValue)) || Number(conditionValue) <= 0)) return th ? 'ยอดซื้อต้องมากกว่า 0' : 'Spend amount must be greater than 0.';
    if ((conditionKind === 'product' || conditionKind === 'recipe') && (!exactItems.length || exactItems.some((item) => !item.product_id || !Number.isInteger(item.quantity) || item.quantity < 1))) return th ? 'เลือกสินค้าและจำนวนในเงื่อนไขให้ครบ' : 'Complete every condition item and quantity.';
    if (conditionKind === 'product' && exactItems.length !== 1) return th ? 'เงื่อนไขสินค้าที่กำหนดเลือกได้ 1 SKU' : 'Specific product condition needs one SKU.';
    if (new Set(exactItems.map((item) => item.product_id)).size !== exactItems.length) return th ? 'สินค้าในเงื่อนไขต้องไม่ซ้ำกัน' : 'Condition SKUs must be unique.';
    if (conditionKind !== 'product' && conditionKind !== 'recipe' && targetType === 'product' && !targetProductIds.length) return th ? 'เลือกสินค้าที่ร่วมรายการ' : 'Choose eligible products.';
    if (conditionKind !== 'product' && conditionKind !== 'recipe' && targetType === 'product_line' && !lineProductIds.length) return th ? 'เลือกไลน์สินค้า' : 'Choose a product line.';
    if (conditionKind !== 'product' && conditionKind !== 'recipe' && (targetType === 'category' || targetType === 'category_tag') && !category.trim()) return th ? 'เลือกหมวดหมู่' : 'Choose a category.';
    if (conditionKind !== 'product' && conditionKind !== 'recipe' && (targetType === 'tag' || targetType === 'category_tag') && !tag.trim()) return th ? 'เลือกแท็ก' : 'Choose a tag.';
    if (!discountEnabled && !giftEnabled) return th ? 'เลือกสิทธิประโยชน์อย่างน้อย 1 อย่าง' : 'Choose at least one benefit.';
    if (discountEnabled && (!Number.isFinite(Number(discountValue)) || Number(discountValue) <= 0 || (discountKind === 'percentage' && Number(discountValue) > 100))) return th ? 'กรอกส่วนลดให้ถูกต้อง (เปอร์เซ็นต์ไม่เกิน 100)' : 'Enter a valid discount (percentage up to 100).';
    if (giftEnabled && (!giftProductId || !Number.isInteger(Number(giftQuantity)) || Number(giftQuantity) < 1)) return th ? 'เลือก SKU ของแถมและจำนวนให้ครบ' : 'Choose a gift SKU and quantity.';
    if (giftEnabled && giftLimit && (!Number.isInteger(Number(giftLimit)) || Number(giftLimit) < 1)) return th ? 'จำนวนสิทธิ์ต้องเป็นเลขจำนวนเต็มมากกว่า 0' : 'Gift limit must be a positive integer.';
    return '';
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const error = validate();
    if (error) { setMessage(error); return; }
    setSaving(true); setMessage('');
    const payload = buildPayload();
    try {
      try { await savePromotionDefinition(payload); }
      catch (saveError) {
        if (!(saveError instanceof PromotionSaveConflict)) throw saveError;
        if (!window.confirm(th ? `โปรนี้ชนกับ ${Array.from(new Set(saveError.promotionNames)).join(', ')}\nใช้กติกาที่เลือกไว้และเปิดใช้เลยหรือไม่?` : `This overlaps ${Array.from(new Set(saveError.promotionNames)).join(', ')}. Activate with the selected combination rule?`)) {
          setMessage(th ? 'ยังไม่ได้บันทึก โปรเดิมยังทำงานตามเดิม' : 'Not saved. The existing promotion is unchanged.');
          return;
        }
        await savePromotionDefinition({ ...payload, confirmation_token: saveError.token });
      }
      await onSaved();
    } catch (saveError) {
      console.error(saveError);
      setMessage(failureMessage(saveError));
    } finally { setSaving(false); }
  };

  const runPreview = async () => {
    const error = validate();
    if (error) { setMessage(error); return; }
    if (!previewChannel) { setMessage(th ? 'เลือกช่องทางสำหรับทดลอง' : 'Choose a preview channel.'); return; }
    if (!cart.length) { setMessage(th ? 'เพิ่มสินค้าในตะกร้าทดลอง' : 'Add an item to the test cart.'); return; }
    const [kind, id, phase] = previewChannel.split(':');
    const request = ++previewRequest.current;
    setPreviewing(true); setMessage(''); setPreview(null);
    try {
      const result = await previewPromotionDefinition({
        definition: buildPayload(),
        eventId: kind === 'event' ? id : null,
        eventPhase: kind === 'event' ? phase as PromotionEventPhase : null,
        campaignId: kind === 'campaign' ? id : null,
        items: cart,
      });
      if (request === previewRequest.current) setPreview(result);
    } catch (previewError) {
      console.error(previewError);
      if (request === previewRequest.current) setMessage(failureMessage(previewError, true));
    } finally { if (request === previewRequest.current) setPreviewing(false); }
  };

  const toggleAssignment = (key: string) => {
    const next = assignmentKeys.includes(key) ? assignmentKeys.filter((item) => item !== key) : [...assignmentKeys, key];
    setAssignmentKeys(next);
    setPreviewChannel((selected) => next.includes(selected) ? selected : next[0] || '');
  };
  const addConditionItem = (productId: string) => setConditionItems((current) => current.some((item) => item.product_id === productId) ? current : [...current, { product_id: productId, quantity: '1' }]);
  const addCartItem = (productId: string) => setCart((current) => current.some((item) => item.product_id === productId) ? current.map((item) => item.product_id === productId ? { ...item, quantity: item.quantity + 1 } : item) : [...current, { product_id: productId, quantity: 1 }]);
  const assignmentName = (key: string) => {
    const [kind, id, phase] = key.split(':');
    if (kind === 'campaign') return campaigns.find((campaign) => campaign.id === id)?.name || (th ? 'แคมเปญออนไลน์' : 'Online campaign');
    const event = events.find((item) => item.id === id)?.event_name || (th ? 'อีเวนต์' : 'Event');
    const phaseName = phase === 'preorder' ? (th ? 'ก่อนงาน' : 'Pre-order') : phase === 'live' ? (th ? 'วันงาน' : 'Live') : (th ? 'หลังงาน' : 'Post-order');
    return `${event} · ${phaseName}`;
  };
  const targetProductName = (id: string) => productLabel(products.find((product) => product.id === id) || { id, name: id });
  const diagnosticText = (diagnostic: PromotionPreviewResult['diagnostics'][number]) => {
    if (diagnostic.code === 'applied') return th ? `เข้าเงื่อนไข${diagnostic.earned_quantity ? ` · ของแถม ${diagnostic.earned_quantity} ชิ้น` : ''}${diagnostic.remaining_quantity === null || diagnostic.remaining_quantity === undefined ? '' : ` · โควตาคงเหลือ ${diagnostic.remaining_quantity}`}` : `Eligible · ${diagnostic.earned_quantity} earned${diagnostic.remaining_quantity === null || diagnostic.remaining_quantity === undefined ? '' : ` · ${diagnostic.remaining_quantity} quota remaining`}`;
    if (diagnostic.code === 'inactive') return th ? 'โปรโมชั่นยังไม่อยู่ในช่วงใช้งาน' : 'The promotion is outside its active schedule.';
    if (diagnostic.code === 'gift_limit_reached') return th ? `เงื่อนไขผ่าน แต่โควตาของแถมไม่พอ (ให้ได้ ${diagnostic.available_quantity || 0} ชิ้น) ${discountEnabled ? 'ส่วนลดยังใช้ได้' : 'ยังสั่งซื้อได้'}` : `Condition met, but gift quota is insufficient (${diagnostic.available_quantity || 0} available). ${discountEnabled ? 'The discount still applies.' : 'Ordering remains available.'}`;
    if (diagnostic.code === 'gift_stock_insufficient') return th ? `เงื่อนไขผ่าน แต่สต็อกของแถมไม่พอ (ให้ได้ ${diagnostic.available_quantity || 0} ชิ้น) ${discountEnabled ? 'ส่วนลดยังใช้ได้' : 'ยังสั่งซื้อได้'}` : `Condition met, but gift stock is insufficient (${diagnostic.available_quantity || 0} available). ${discountEnabled ? 'The discount still applies.' : 'Ordering remains available.'}`;
    if (diagnostic.code === 'condition_not_met') {
      const missingItems = (diagnostic.missing_items || []).filter((item) => item.quantity > 0).map((item) => `${targetProductName(item.product_id)} ${th ? 'ขาด' : 'missing'} ${item.quantity}`).join(', ');
      if (missingItems) return missingItems;
      if ((diagnostic.missing_amount || 0) > 0) return th ? `ยอดซื้อยังขาด ฿${money(diagnostic.missing_amount || 0)}` : `Spend ฿${money(diagnostic.missing_amount || 0)} more.`;
      if ((diagnostic.missing_quantity || 0) > 0) return th ? `จำนวนสินค้ายังขาด ${diagnostic.missing_quantity} ชิ้น` : `${diagnostic.missing_quantity} more items required.`;
      return th ? 'สินค้าในตะกร้ายังไม่เข้าเงื่อนไข' : 'The test cart does not meet the condition.';
    }
    return diagnostic.code;
  };

  return <section className="promotion-workspace" aria-label={th ? 'แก้ไขโปรโมชัน V1' : 'Promotion V1 editor'}>
    <form id="promotion-editor" onSubmit={submit} onChange={() => { if (message) setMessage(''); }}>
      <div className="promotion-toolbar"><div><button type="button" className="promotion-button" disabled={saving} onClick={onClose}><ArrowLeft size={16} />{th ? 'กลับรายการ' : 'Back to promotions'}</button><h3 className="mt-4">{existing ? (th ? 'แก้ไขโปรโมชัน' : 'Edit promotion') : (th ? 'สร้างโปรโมชัน' : 'Create promotion')}</h3></div><p className="promotion-help">{th ? 'ทดลองได้ก่อนบันทึก โดยไม่สร้างออเดอร์หรือตัดสต็อก' : 'Preview before saving without creating an order or changing stock.'}</p></div>
      <div className="promotion-editor-layout">
        <fieldset disabled={saving} className="promotion-fields">
          <div className="promotion-section"><h4><span className="promotion-step">1</span>{th ? 'ข้อมูลโปรโมชัน' : 'Promotion details'}</h4><label><span className={labelClass}>{th ? 'ชื่อโปรโมชัน' : 'Promotion name'}</span><input ref={nameRef} autoFocus required value={name} onChange={(event) => setName(event.target.value)} className={inputClass} placeholder={th ? 'เช่น ซื้อครบชุด รับส่วนลดพร้อมของแถม' : 'e.g. Complete a set for a discount and gift'} /></label></div>

          <div className="promotion-section"><h4><span className="promotion-step">2</span>{th ? 'เงื่อนไขการซื้อ' : 'Purchase condition'}</h4><fieldset className="promotion-types"><legend className={labelClass}>{th ? 'เมื่อลูกค้า…' : 'When the customer…'}</legend>{([
            ['quantity', th ? 'ซื้อครบจำนวน' : 'Buys a quantity'], ['spend', th ? 'ซื้อครบยอด' : 'Reaches a spend'], ['product', th ? 'ซื้อ SKU ที่กำหนด' : 'Buys a specific SKU'], ['recipe', th ? 'ซื้อสินค้าครบชุด' : 'Completes a recipe'],
          ] as const).map(([kind, label]) => <label className="promotion-type" key={kind}><input type="radio" name="v1-condition" checked={conditionKind === kind} onChange={() => { setConditionKind(kind); if ((kind === 'product' || kind === 'recipe') && !conditionItems.length) setConditionItems([]); }} /><strong>{label}</strong></label>)}</fieldset>
            {(conditionKind === 'quantity' || conditionKind === 'spend') && <label><span className={labelClass}>{conditionKind === 'quantity' ? (th ? 'จำนวน (ชิ้น)' : 'Quantity') : (th ? 'ยอดซื้อ (บาท)' : 'Spend (THB)')}</span><input type="number" min={conditionKind === 'quantity' ? 1 : 0.01} step={conditionKind === 'quantity' ? 1 : 0.01} value={conditionValue} onChange={(event) => setConditionValue(event.target.value)} className={inputClass} /><span className="promotion-help">{conditionKind === 'spend' ? (th ? 'คิดจากยอดสินค้าที่ร่วมรายการหลังส่วนลดอื่น และรับสิทธิ์นี้ครั้งเดียวต่อออเดอร์' : 'Uses eligible merchandise after other discounts and earns once per order.') : (th ? 'รับสิทธิ์ซ้ำตามจำนวนชุดที่ครบ' : 'Repeats for every complete group.')}</span></label>}
            {(conditionKind === 'product' || conditionKind === 'recipe') && <div><ExactSkuPicker products={products} onPick={addConditionItem} disabledIds={conditionItems.map((item) => item.product_id)} th={th} /><div className="promotion-item-list">{conditionItems.map((item) => <div key={item.product_id}><span>{targetProductName(item.product_id)}</span><label><span className="sr-only">{th ? 'จำนวน' : 'Quantity'} {targetProductName(item.product_id)}</span><input aria-label={`${th ? 'จำนวน' : 'Quantity'} ${targetProductName(item.product_id)}`} type="number" min="1" step="1" value={item.quantity} onChange={(event) => setConditionItems((current) => current.map((candidate) => candidate.product_id === item.product_id ? { ...candidate, quantity: event.target.value } : candidate))} className={inputClass} /></label><button type="button" aria-label={`${th ? 'ลบ' : 'Remove'} ${targetProductName(item.product_id)}`} onClick={() => setConditionItems((current) => current.filter((candidate) => candidate.product_id !== item.product_id))}><Trash2 size={16} /></button></div>)}</div><p className="promotion-help">{conditionKind === 'product' ? (th ? 'เลือก 1 SKU และจำนวนขั้นต่ำ' : 'Choose one exact SKU and minimum quantity.') : (th ? 'ทุก SKU ต้องครบตามจำนวน รับสิทธิ์ซ้ำได้ทุกชุดที่ครบ' : 'Every exact SKU is required; complete recipes repeat.')}</p></div>}
            {conditionKind !== 'product' && conditionKind !== 'recipe' && <div className="promotion-subsection"><label><span className={labelClass}>{th ? 'สินค้าที่นำมาคิดเงื่อนไข' : 'Eligible products'}</span><select className={inputClass} value={targetType} onChange={(event) => setTargetType(event.target.value as V1FormTarget)}><option value="all">{th ? 'สินค้าทั้งหมด' : 'All products'}</option><option value="product">{th ? 'SKU ที่ระบุ' : 'Specific SKUs'}</option><option value="product_line">{th ? 'ไลน์สินค้า (ทุกตัวเลือก)' : 'Product line (all variants)'}</option><option value="category">{th ? 'หมวดหมู่' : 'Category'}</option><option value="tag">{th ? 'แท็ก' : 'Tag'}</option><option value="category_tag">{th ? 'หมวดหมู่ + แท็ก' : 'Category + tag'}</option></select></label>{targetType === 'product' && <><ExactSkuPicker products={products} th={th} disabledIds={targetProductIds} onPick={(id) => setTargetProductIds((current) => [...current, id])} /><div className="promotion-chip-list">{targetProductIds.map((id) => <button type="button" key={id} onClick={() => setTargetProductIds((current) => current.filter((candidate) => candidate !== id))}>{targetProductName(id)} ×</button>)}</div></>}{targetType === 'product_line' && <label><span className={labelClass}>{th ? 'ไลน์สินค้า' : 'Product line'}</span><select className={inputClass} value={productLine} onChange={(event) => setProductLine(event.target.value)}><option value="">{th ? 'เลือกไลน์สินค้า' : 'Choose a product line'}</option>{productLines.map((value) => <option key={value} value={value}>{value}</option>)}</select><span className="promotion-help">{lineProductIds.length} {th ? 'SKU จะร่วมรายการ' : 'SKUs included'}</span></label>}{(targetType === 'category' || targetType === 'category_tag') && <label><span className={labelClass}>{th ? 'หมวดหมู่' : 'Category'}</span><input list="v1-categories" value={category} onChange={(event) => setCategory(event.target.value)} className={inputClass} /><datalist id="v1-categories">{categorySuggestions.map((value) => <option key={value} value={value} />)}</datalist></label>}{(targetType === 'tag' || targetType === 'category_tag') && <label><span className={labelClass}>{th ? 'แท็ก' : 'Tag'}</span><input list="v1-tags" value={tag} onChange={(event) => setTag(event.target.value)} className={inputClass} /><datalist id="v1-tags">{tagSuggestions.map((value) => <option key={value} value={value} />)}</datalist></label>}</div>}
          </div>

          <div className="promotion-section"><h4><span className="promotion-step">3</span>{th ? 'สิทธิประโยชน์' : 'Benefits'}</h4><label className="promotion-reward-toggle"><input type="checkbox" checked={discountEnabled} onChange={(event) => setDiscountEnabled(event.target.checked)} /><span><strong>{th ? 'ส่วนลด' : 'Discount'}</strong><small>{th ? 'เลือกได้ 1 แบบ' : 'One discount type'}</small></span></label>{discountEnabled && <><div className="grid gap-3 md:grid-cols-2"><label><span className={labelClass}>{th ? 'รูปแบบส่วนลด' : 'Discount type'}</span><select className={inputClass} value={discountKind} onChange={(event) => setDiscountKind(event.target.value as 'fixed' | 'percentage')}><option value="fixed">{th ? 'ลดเป็นบาท' : 'Fixed amount'}</option><option value="percentage">{th ? 'ลดเป็นเปอร์เซ็นต์' : 'Percentage'}</option></select></label><label><span className={labelClass}>{discountKind === 'fixed' ? (th ? 'จำนวนเงิน (บาท)' : 'Amount (THB)') : (th ? 'เปอร์เซ็นต์' : 'Percent')}</span><input type="number" min="0.01" max={discountKind === 'percentage' ? 100 : undefined} step="0.01" value={discountValue} onChange={(event) => setDiscountValue(event.target.value)} className={inputClass} /></label></div>{discountKind === 'percentage' && <p className="promotion-help">{th ? 'คิดเปอร์เซ็นต์จากสินค้าที่ครบแต่ละกลุ่ม และปัดผลรวมเป็น 2 ตำแหน่ง' : 'Percentage applies to each complete group and the total is rounded to 2 decimals.'}</p>}</>}
            <label className="promotion-reward-toggle"><input type="checkbox" checked={giftEnabled} onChange={(event) => setGiftEnabled(event.target.checked)} /><span><strong>{th ? 'ของแถมจาก SKU เดิม' : 'Gift from an existing SKU'}</strong><small>{th ? 'ใช้สต็อกจริงของสินค้า' : 'Uses the product’s real stock'}</small></span></label>{giftEnabled && <><ExactSkuPicker products={products} th={th} gift onPick={setGiftProductId} />{giftProductId && <div className="promotion-selected-gift"><Gift size={17} /><span>{targetProductName(giftProductId)}</span><button type="button" onClick={() => setGiftProductId('')}>{th ? 'เปลี่ยน' : 'Change'}</button></div>}<div className="grid gap-3 md:grid-cols-2"><label><span className={labelClass}>{th ? 'ของแถมต่อสิทธิ์ (ชิ้น)' : 'Gift quantity per reward'}</span><input type="number" min="1" step="1" value={giftQuantity} onChange={(event) => setGiftQuantity(event.target.value)} className={inputClass} /></label><label><span className={labelClass}>{th ? 'จำกัดจำนวนสิทธิ์ทั้งหมด' : 'Total gift limit'}</span><input type="number" min="1" step="1" value={giftLimit} onChange={(event) => setGiftLimit(event.target.value)} placeholder={th ? 'ไม่จำกัด' : 'Unlimited'} className={inputClass} /></label></div><p className="promotion-help">{th ? 'เพิ่ม SKU ของแถมเข้าทุกช่องทางที่เลือกและเปิดใช้งานก่อนบันทึก โควตานับจำนวนของแถมเป็นชิ้นรวมทุกช่องทาง ระบบตรวจสต็อกอีกครั้งตอนสั่งซื้อ' : 'Add and enable the gift SKU in every selected channel before saving. The limit counts gift units across all channels; stock is rechecked at checkout.'}</p></>}
          </div>

          <div className="promotion-section"><h4><span className="promotion-step">4</span>{th ? 'ช่วงเวลา ช่องทาง และจำนวนสิทธิ์' : 'Schedule, channels, and limits'}</h4><div className="grid gap-3 md:grid-cols-2"><label><span className={labelClass}>{th ? 'เริ่มใช้ (ไม่บังคับ)' : 'Starts (optional)'}</span><input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className={inputClass} /></label><label><span className={labelClass}>{th ? 'สิ้นสุด (ไม่บังคับ)' : 'Ends (optional)'}</span><input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} className={inputClass} /></label></div><label><span className={labelClass}>{th ? 'เมื่อชนกับโปรอื่น' : 'When another promotion overlaps'}</span><select className={inputClass} value={combinationPolicy} onChange={(event) => setCombinationPolicy(event.target.value as PromotionCombinationPolicy)}><option value="exclusive">{th ? 'ไม่ใช้ร่วมกัน' : 'Do not combine'}</option><option value="combine">{th ? 'ใช้ร่วมกับโปรอื่นได้' : 'Combine with other promotions'}</option></select></label>
            <div className="space-y-2">{events.filter((event) => !lockedEventId || event.id === lockedEventId).map((event) => <div key={event.id} className="rounded-xl border border-gray-100 p-3"><strong>{lockedEventId ? lockedEventName || event.event_name : event.event_name}</strong><div className="mt-2 flex flex-wrap gap-3">{phaseOptions.map((phase) => { const key = `event:${event.id}:${phase}`; return <label className="promotion-channel" key={key}><input type="checkbox" checked={assignmentKeys.includes(key)} onChange={() => toggleAssignment(key)} />{phase === 'preorder' ? (th ? 'ก่อนงาน · พรีออเดอร์' : 'Pre-order') : phase === 'live' ? (th ? 'ขายวันงาน' : 'Live event') : (th ? 'หลังจบงาน' : 'Post-order')}</label>; })}</div></div>)}</div>{!lockedEventId && campaigns.length > 0 && <div><span className={labelClass}>{th ? 'แคมเปญขายออนไลน์' : 'Online campaigns'}</span><div className="mt-2 grid gap-2 md:grid-cols-2">{campaigns.map((campaign) => { const key = `campaign:${campaign.id}`; return <label className="promotion-channel rounded-xl border border-gray-100 p-3" key={key}><input type="checkbox" checked={assignmentKeys.includes(key)} onChange={() => toggleAssignment(key)} />{campaign.name}</label>; })}</div></div>}
          </div>

          <div className="promotion-section promotion-preview"><h4><FlaskConical size={18} />{th ? 'ทดลองโปรโมชัน' : 'Test promotion'}</h4><p className="promotion-help">{th ? 'ทดลองก่อนบันทึก โดยไม่สร้างออเดอร์ ไม่เปลี่ยนสต็อก และไม่ใช้โควตาของแถม' : 'Try the offer before saving, without creating orders, changing stock, or using gift quota.'}</p><label><span className={labelClass}>{th ? 'ทดลองในช่องทาง' : 'Preview channel'}</span><select className={inputClass} value={previewChannel} onChange={(event) => setPreviewChannel(event.target.value)}><option value="">{th ? 'เลือกช่องทาง' : 'Choose a channel'}</option>{assignmentKeys.map((key) => <option key={key} value={key}>{assignmentName(key)}</option>)}</select></label><ExactSkuPicker products={products} onPick={addCartItem} th={th} disabledIds={[]} /><div className="promotion-item-list">{cart.map((item) => <div key={item.product_id}><span>{targetProductName(item.product_id)}</span><input aria-label={`${th ? 'จำนวนทดลอง' : 'Test quantity'} ${targetProductName(item.product_id)}`} className={inputClass} type="number" min="1" step="1" value={item.quantity} onChange={(event) => setCart((current) => current.map((candidate) => candidate.product_id === item.product_id ? { ...candidate, quantity: Math.max(1, Number(event.target.value)) } : candidate))} /><button type="button" onClick={() => setCart((current) => current.filter((candidate) => candidate.product_id !== item.product_id))} aria-label={`${th ? 'ลบ' : 'Remove'} ${targetProductName(item.product_id)}`}><Trash2 size={16} /></button></div>)}</div><button type="button" className="promotion-button" disabled={previewing} onClick={() => void runPreview()}>{previewing ? <Loader2 className="animate-spin" size={16} /> : <FlaskConical size={16} />}{th ? 'คำนวณผลทดลอง' : 'Run preview'}</button>{preview && <div className="promotion-preview-result"><dl><div><dt>{th ? 'ยอดก่อนส่วนลด' : 'Subtotal'}</dt><dd>฿{money(preview.subtotal)}</dd></div><div><dt>{th ? 'ส่วนลดรวม' : 'Discount'}</dt><dd>−฿{money(preview.discount_total)}</dd></div><div><dt>{th ? 'ยอดสุทธิ' : 'Total'}</dt><dd>฿{money(preview.total)}</dd></div></dl>{preview.applied_promotions.map((item) => <p key={item.id}><Check size={15} />{item.name}: −฿{money(item.discount_amount)}{item.rewards.length ? ` · ${item.rewards.map((reward) => `${reward.name} ×${reward.quantity}`).join(', ')}` : ''}</p>)}{preview.required_choices.map(choice => <p key={`${choice.kind}-${choice.promotion_id}`} className="promotion-diagnostic">{th ? 'ยังต้องเลือกสิทธิ์ก่อนสรุปยอดจริง: ' : 'Choose an offer or gift before the final total: '}{choice.options.map(option => option.name).join(' / ')}</p>)}{preview.diagnostics.map((diagnostic, index) => <p key={`${diagnostic.promotion_id}-${diagnostic.code}-${index}`} className="promotion-diagnostic">{diagnosticText(diagnostic)}</p>)}</div>}</div>
        </fieldset>

        <aside className="promotion-summary" aria-label={th ? 'สรุปก่อนบันทึก' : 'Review before saving'}><h4><Sparkles size={18} />{th ? 'สรุปก่อนบันทึก' : 'Review before saving'}</h4><p className="promotion-summary-name">{name.trim() || (th ? 'โปรโมชันใหม่' : 'New promotion')}</p><p className="promotion-saved-rule">{promotionV1RuleText(config, products, th)}</p><dl><dt>{th ? 'สิทธิประโยชน์' : 'Benefits'}</dt><dd>{discountEnabled ? (discountKind === 'fixed' ? `${th ? 'ลด' : 'Save'} ฿${discountValue || '—'}` : `${th ? 'ลด' : 'Save'} ${discountValue || '—'}%`) : ''}{discountEnabled && giftEnabled ? ' + ' : ''}{giftEnabled ? `${th ? 'ของแถม' : 'Gift'} ${giftProductId ? targetProductName(giftProductId) : '—'} ×${giftQuantity || '—'}` : ''}</dd><dt>{th ? 'ช่องทางขาย' : 'Sales channels'}</dt><dd>{assignmentKeys.length ? assignmentKeys.map((key) => <p key={key}>{assignmentName(key)}</p>) : (th ? 'ยังไม่ได้เลือก' : 'None selected')}</dd>{giftEnabled && <><dt>{th ? 'โควตาของแถม' : 'Gift quota'}</dt><dd>{giftLimit || (th ? 'ไม่จำกัด' : 'Unlimited')}</dd></>}</dl>{message && <p role="alert" className="promotion-notice">{message}</p>}<button className="promotion-button promotion-primary promotion-submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" size={17} /> : <Check size={17} />}{saving ? (th ? 'กำลังตรวจและบันทึก…' : 'Checking and saving…') : existing ? (th ? 'บันทึกการแก้ไข' : 'Save changes') : (th ? 'บันทึกและเปิดใช้' : 'Save and activate')}</button><p className="promotion-help">{th ? 'ต้องเลือกส่วนลดหรือของแถมอย่างน้อย 1 อย่าง' : 'At least one discount or gift is required.'}</p></aside>
      </div>
    </form>
  </section>;
}
