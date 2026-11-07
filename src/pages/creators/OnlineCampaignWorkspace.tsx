import { OrderProductionStock, useProductionOrderStock } from '../../components/products/OrderProductionStock';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
import { getOrderSequences } from '../../lib/orderSequences';
import { SupplyPolicyEditor } from '../../components/products/SupplyPolicyEditor';
import './sales-readiness.css';
import CampaignSalesReport from '../../components/reports/CampaignSalesReport';
import './online-campaign-products.css';
import { ProductMedia } from '../../components/menu/ProductPresentation';
import EvidenceReview from '../../components/EvidenceReview';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ExternalLink, Eye, LayoutGrid, List, Loader2, PackageCheck, Plus, Save, Search, Settings, ShoppingBag, X } from 'lucide-react';
import AdminHeader from '../../components/AdminHeader';
import PaymentBankAccountsEditor from '../../components/PaymentBankAccountsEditor';
import { ConfirmDialog, Toast } from '../../components/ui/Feedback';
import { uiText, useI18n } from '../../i18n';
import { uploadImage } from '../../lib/imageUploads';
import {
  getCampaignWorkspace,
  markCampaignOrderRefunded,
  markCampaignOrderPickedUp,
  markCampaignOrderShipped,
  notifyOnlineCampaignOrder,
  publishCampaign,
  runCampaignOrderAction,
  saveCampaignProducts,
} from '../../lib/onlineCampaigns';
import { downloadPaymentEvidencePreview } from '../../lib/preorders';
import { fetchProductStockSummaries, type ProductStockSummary } from '../../lib/stockAdjustments';
import { supabase } from '../../supabaseClient';
import type { ActorContext } from '../../types/access';
import type { CampaignOrder, CampaignWorkspace, CampaignPickupPoint, CampaignPaymentMethod } from '../../types/onlineCampaign';
import { fetchActorContext } from '../../utils/access';
import { formatPrice } from '../../utils/currency';
import { getBrowserTimeZone } from '../../utils/timezone';
import { getMenuImageUrl } from '../../utils/imageUtils';
import {
  createEmptyBankAccount,
  getPaymentBankAccounts,
  normalizePaymentBankAccounts,
  type PaymentBankAccount,
} from '../../utils/paymentBanks';
import CampaignPromotionPicker from '../../components/promotions/CampaignPromotionPicker';
import ActivityRewardsCard from '../../components/promotions/ActivityRewardsCard';
import { activityRewardStateForOrder } from '../../utils/activityRewards';

type Tab = 'overview' | 'products' | 'promotions' | 'orders' | 'sales' | 'settings';
type ProductMembership = 'all' | 'included' | 'not_added';
type ProductEdit = { stock: string; price: string; limit: string; gift: boolean; expected: { stock_total: number | null; price_override: number | null; max_quantity_per_order: number | null; is_unlimited: boolean; is_sellable: boolean } };
type CampaignSettingsDraft = {
  campaignId: string;
  name: string;
  flatShippingFee: string;
  shippingEnabled: boolean;
  pickupEnabled: boolean;
};

const PRODUCT_PAGE_SIZE = 20;

const normalizeSetting = (value: FormDataEntryValue | string | null | undefined) =>
  String(value || '').trim().toLocaleLowerCase();

const maskPaymentId = (value?: string | null) => {
  const clean = String(value || '').trim();
  return clean ? `•••• ${clean.slice(-4)}` : '—';
};

const normalizePaymentNumber = (value?: string | null) =>
  normalizeSetting(value).replace(/[\s-]+/g, '');

const localDateTime = (value: string) => {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
  return local.endsWith(':00') ? local.slice(0, 16) : local;
};

const paymentDetailsKey = (method: {
  promptpay_id?: string | null;
  bank_accounts?: PaymentBankAccount[] | null;
  bank_name?: string | null;
  account_name?: string | null;
  account_number?: string | null;
  qr_image_url?: string | null;
}) => [
  normalizePaymentNumber(method.promptpay_id),
  getPaymentBankAccounts(method)
    .map((account) => [normalizeSetting(account.bank_name), normalizeSetting(account.account_name), normalizePaymentNumber(account.account_number)].join('|'))
    .sort()
    .join('~'),
  normalizeSetting(method.qr_image_url),
].join('|');

export default function OnlineCampaignWorkspace() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { t, dateLocale, language } = useI18n();
  const [actor, setActor] = useState<ActorContext | null>(null);
  const [artistSlug, setArtistSlug] = useState('');
  const [workspace, setWorkspace] = useState<CampaignWorkspace | null>(null);
  const [orderSequences, setOrderSequences] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const productionStock = useProductionOrderStock(undefined, campaignId, (workspace?.orders || []).map(order => [order.id, order.status, order.payment_status].join(':')).join('|'));
  const [orderFilter, setOrderFilter] = useState('needs_action');
  const [search, setSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [productEdits, setProductEdits] = useState<Record<string, ProductEdit>>({});
  const [promotionEditing, setPromotionEditing] = useState(false);
  useUnsavedChanges(Object.keys(productEdits).length > 0 || promotionEditing, language === 'th' ? 'มีการแก้ไขสินค้าที่ยังไม่ได้บันทึก ต้องการออกหรือไม่?' : 'You have unsaved product changes. Leave?');
  const [productCategory, setProductCategory] = useState('all');
  const [productMembership, setProductMembership] = useState<ProductMembership>('all');
  const [productSort, setProductSort] = useState<'name_asc' | 'name_desc'>('name_asc');
  const [productPage, setProductPage] = useState(1);
  const [productView, setProductView] = useState<'cards' | 'table'>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? 'cards' : 'table',
  );
  const evidenceRequest = useRef(0);
  const [evidencePreview, setEvidencePreview] = useState<{ order: CampaignOrder; url: string } | null>(null);
  const [evidenceLoadingId, setEvidenceLoadingId] = useState<string | null>(null);
  const [stockSummaries, setStockSummaries] = useState<Record<string, ProductStockSummary>>({});
  const [toast, setToast] = useState<{ tone?: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string } | null>(null);
  const [addingPickup, setAddingPickup] = useState(false);
  const [addingPayment, setAddingPayment] = useState(false);
  const [editingPickup, setEditingPickup] = useState<CampaignPickupPoint | null>(null);
  const [editingPayment, setEditingPayment] = useState<CampaignPaymentMethod | null>(null);
  const settingInFlight = useRef(false);
  const [paymentQrUrl, setPaymentQrUrl] = useState('');
  const [paymentQrUploading, setPaymentQrUploading] = useState(false);
  const [paymentBankAccounts, setPaymentBankAccounts] = useState<PaymentBankAccount[]>([createEmptyBankAccount()]);
  const [editingPaymentBanks, setEditingPaymentBanks] = useState<{ methodId: string; accounts: PaymentBankAccount[] } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ kind: 'pickup' | 'payment'; id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<CampaignSettingsDraft | null>(null);
  const [fulfillmentTarget, setFulfillmentTarget] = useState<{ order: CampaignOrder; action: 'ship' | 'pickup' } | null>(null);
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [fulfillmentError, setFulfillmentError] = useState('');
  const openFulfillment = (order: CampaignOrder, action: 'ship' | 'pickup') => {
    setCarrier(''); setTracking(''); setFulfillmentError('');
    setFulfillmentTarget({ order, action });
  };
  const [reviewTarget, setReviewTarget] = useState<{ order: CampaignOrder; action: string } | null>(null);
  const [orderBusy, setOrderBusy] = useState(false);
  const orderInFlight = useRef(false);
  const canManage = actor?.role === 'owner' || actor?.role === 'manager';

  const load = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    try {
      const context = await fetchActorContext();
      if (!context) throw new Error('Workspace access is required.');
      const data = await getCampaignWorkspace(campaignId, context.artist_id);
      const sequences = await getOrderSequences(data.orders.map(order => order.id));
      const [summaries, { data: artist }] = await Promise.all([
        context?.role === 'owner' || context?.role === 'manager'
          ? fetchProductStockSummaries(data.campaign.artist_id)
          : Promise.resolve([]),
        supabase.from('artists').select('slug').eq('id', data.campaign.artist_id).maybeSingle(),
      ]);
      setActor(context);
      setArtistSlug(artist?.slug || '');
      setWorkspace(data);
      setOrderSequences(sequences);
      setSettingsDraft((current) => current?.campaignId === data.campaign.id ? current : {
        campaignId: data.campaign.id,
        name: data.campaign.name,
        flatShippingFee: String(data.campaign.flat_shipping_fee),
        shippingEnabled: data.campaign.shipping_enabled,
        pickupEnabled: data.campaign.pickup_enabled,
      });
      setStockSummaries(Object.fromEntries(summaries.map((summary) => [summary.product_id, summary])));
    } catch (error) {
      console.error(error);
      setFeedback(t('campaignLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [campaignId, t]);

  useEffect(() => { void load(); }, [load]);


  const allocatedIds = useMemo(
    () => new Set((workspace?.products || []).filter((product) => product.is_enabled !== false).map((product) => product.product_id)),
    [workspace?.products],
  );

  const campaignCatalog = useMemo(
    () => [...(workspace?.catalog || [])],
    [workspace?.catalog],
  );

  const productCategories = useMemo(
    () => Array.from(new Set(campaignCatalog.map((product) => product.category).filter(Boolean) as string[])).sort(),
    [campaignCatalog],
  );

  const filteredCampaignCatalog = useMemo(() => {
    const query = productSearch.trim().toLocaleLowerCase();
    return campaignCatalog
      .filter((product) => !query || [product.name, product.sku].some((value) => String(value || '').toLocaleLowerCase().includes(query)))
      .filter((product) => productCategory === 'all' || product.category === productCategory)
      .filter((product) => {
        const included = allocatedIds.has(product.product_id || product.id || '');
        return productMembership === 'all' || (productMembership === 'included' ? included : !included);
      })
      .sort((left, right) => productSort === 'name_asc' ? left.name.localeCompare(right.name) : right.name.localeCompare(left.name));
  }, [allocatedIds, campaignCatalog, productCategory, productMembership, productSearch, productSort]);

  const productPageCount = Math.max(1, Math.ceil(filteredCampaignCatalog.length / PRODUCT_PAGE_SIZE));
  const visibleProductPage = Math.min(productPage, productPageCount);
  const pagedCampaignCatalog = filteredCampaignCatalog.slice(
    (visibleProductPage - 1) * PRODUCT_PAGE_SIZE,
    visibleProductPage * PRODUCT_PAGE_SIZE,
  );

  const getStockSummary = (product: CampaignWorkspace['catalog'][number]) => {
    const productId = product.product_id || product.id || '';
    return stockSummaries[productId] || {
      product_id: productId,
      on_hand: Number(product.stock_total || 0),
      allocated: 0,
      available: Math.max(Number(product.stock_total || 0) - Number(product.stock_reserved || 0) - Number(product.stock_sold || 0), 0),
    };
  };

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (workspace?.orders || []).filter((order) => {
      const needsAction = ['awaiting_shipment', 'awaiting_pickup'].includes(order.fulfillment_status)
        || (canManage && ['payment_submitted', 'payment_submitted_late', 'refund_pending'].includes(order.payment_status));
      const matchesFilter = orderFilter === 'all'
        || (orderFilter === 'needs_action' && needsAction)
        || (orderFilter === 'review' && order.payment_status === 'payment_submitted')
        || (orderFilter === 'payment' && ['payment_submitted_late', 'refund_pending'].includes(order.payment_status))
        || (orderFilter === 'shipping' && order.fulfillment_status === 'awaiting_shipment')
        || (orderFilter === 'pickup' && order.fulfillment_status === 'awaiting_pickup')
        || (orderFilter === 'cancelled' && (order.status === 'cancelled' || ['payment_expired', 'payment_cancelled', 'payment_rejected', 'refunded'].includes(order.payment_status)))
        || order.payment_status === orderFilter
        || order.fulfillment_status === orderFilter
        || order.status === orderFilter;
      if (!matchesFilter) return false;
      if (!query) return true;
      return [order.order_code, order.customer_name, order.customer_email, order.customer_phone, order.tracking_number, order.pickup_point?.name]
        .some((value) => String(value || '').toLowerCase().includes(query))
        || order.items.some((item) => [item.name, item.sku].some((value) => String(value || '').toLowerCase().includes(query)));
    });
  }, [canManage, orderFilter, search, workspace?.orders]);

  const toggleProduct = async (productId: string, checked: boolean) => {
    if (!campaignId || !workspace) return;
    const product = workspace.catalog.find((item) => item.product_id === productId || item.id === productId);
    if (!product) return;
    const current = workspace.products.find((item) => item.product_id === productId);
    const summary = getStockSummary(product);
    const used = Number(current?.stock_reserved || 0) + Number(current?.stock_sold || 0);
    const finiteStock = checked
      ? Math.max(used, Math.min(Number(current?.stock_total ?? summary.available), used + summary.available))
      : Number(current?.stock_total ?? 0);
    setSaving(true);
    setFeedback('');
    try {
      await saveCampaignProducts(campaignId, [{
        product_id: product.product_id || product.id || productId,
        is_enabled: checked,
        is_unlimited: current?.is_unlimited ?? product.is_unlimited,
        stock_total: (current?.is_unlimited ?? product.is_unlimited) ? null : finiteStock,
        price_override: current?.price_override ?? null,
      }]);
      await load();
    } catch (error) {
      console.error(error);
      setFeedback(error instanceof Error && error.message === 'campaign_stock_exceeds_catalog_stock' ? t('campaignStockExceeded') : t('campaignSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const editProduct = (productId: string, field: 'stock' | 'price' | 'limit' | 'gift', value: string | boolean) => {
    const current = workspace?.products.find(item => item.product_id === productId);
    if (!current) return;
    setProductEdits(previous => {
      const expected = previous[productId]?.expected || { stock_total: current.stock_total ?? null, price_override: current.price_override ?? null, max_quantity_per_order: current.max_quantity_per_order ?? null, is_unlimited: current.is_unlimited, is_sellable: current.is_sellable ?? true };
      const original = { stock: String(expected.stock_total ?? ''), price: String(expected.price_override ?? ''), limit: String(expected.max_quantity_per_order ?? ''), gift: !expected.is_sellable };
      const existing = previous[productId] || { ...original, expected };
      const next = { ...existing, [field]: value };
      const updated = { ...previous };
      if (next.stock === original.stock && next.price === original.price && next.limit === original.limit && next.gift === original.gift) delete updated[productId];
      else updated[productId] = next;
      return updated;
    });
  };

  const saveProductEdits = async () => {
    if (!campaignId || !workspace) return;
    const items = Object.entries(productEdits).map(([productId, edit]) => ({
      product_id: productId, is_enabled: true, is_unlimited: edit.expected.is_unlimited,
      stock_total: edit.expected.is_unlimited ? null : Number(edit.stock),
      price_override: edit.price.trim() === '' ? null : Number(edit.price),
      max_quantity_per_order: edit.limit.trim() === '' ? null : Number(edit.limit), is_sellable: !edit.gift, expected: edit.expected,
    }));
    if (Object.values(productEdits).some(edit => !edit.expected.is_unlimited && !edit.stock.trim()) || items.some(item => (!item.is_unlimited && (!Number.isSafeInteger(item.stock_total) || item.stock_total! < 0)) || (item.price_override !== null && (!Number.isFinite(item.price_override) || item.price_override < 0)) || (item.max_quantity_per_order !== null && (!Number.isSafeInteger(item.max_quantity_per_order) || item.max_quantity_per_order < 1)))) {
      setFeedback(language === 'th' ? 'กรุณาตรวจสอบจำนวนสต็อก ราคา และจำนวนสูงสุด' : 'Check stock, price, and order limit.'); return;
    }
    setSaving(true); setFeedback('');
    try {
      const { error } = await supabase.rpc('save_campaign_product_edits', { p_campaign_id: campaignId, p_items: items });
      if (error) throw error;
      setProductEdits({}); await load(); setFeedback(t('campaignSaved'));
    } catch (error) {
      console.error(error);
      setFeedback(language === 'th' ? 'บันทึกไม่สำเร็จ สต็อกหรือข้อมูลอาจเปลี่ยนแล้ว กรุณาตรวจสอบอีกครั้ง' : 'Save failed. Stock or settings may have changed; review and try again.');
    } finally { setSaving(false); }
  };

  const updateCampaign = async (patch: Record<string, unknown>) => {
    if (!campaignId) return;
    setSaving(true);
    setFeedback('');
    const { error } = await supabase.from('online_campaigns').update(patch).eq('id', campaignId);
    if (error) {
      console.error(error);
      setFeedback(t('campaignSaveFailed'));
    } else {
      await load();
      setFeedback(t('campaignSaved'));
    }
    setSaving(false);
  };

  const publish = async () => {
    if (!campaignId) return;
    setSaving(true);
    setFeedback('');
    try {
      await publishCampaign(campaignId);
      await load();
      setFeedback(t('campaignPublished'));
    } catch (error) {
      console.error(error);
      setFeedback(t('campaignPublishFailed'));
    } finally {
      setSaving(false);
    }
  };

  const addPickupPoint = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!workspace || settingInFlight.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get('name') || '').trim();
    const address = String(form.get('address') || '').trim();
    const startsInput = String(form.get('starts_at'));
    const endsInput = String(form.get('ends_at'));
    const startsAt = editingPickup && startsInput === localDateTime(editingPickup.starts_at) ? editingPickup.starts_at : new Date(startsInput).toISOString();
    const endsAt = editingPickup && endsInput === localDateTime(editingPickup.ends_at) ? editingPickup.ends_at : new Date(endsInput).toISOString();
    const duplicate = workspace.pickup_points.some((point) =>
      point.id !== editingPickup?.id && normalizeSetting(point.name) === normalizeSetting(name)
      && normalizeSetting(point.address) === normalizeSetting(address)
      && new Date(point.starts_at).getTime() === new Date(startsAt).getTime()
      && new Date(point.ends_at).getTime() === new Date(endsAt).getTime()
    );
    if (duplicate) {
      setToast({ tone: 'warning', title: t('campaignDuplicateSetting') });
      return;
    }
    settingInFlight.current = true;
    setSaving(true);
    try {
      const values = { name, address, starts_at: startsAt, ends_at: endsAt, instructions: String(form.get('instructions') || '').trim() };
      if (editingPickup) {
        if (!editingPickup.updated_at) throw new Error('Missing version');
        const { data, error } = await supabase.from('campaign_pickup_points').update(values).eq('id', editingPickup.id).eq('campaign_id', workspace.campaign.id).eq('updated_at', editingPickup.updated_at).select('id').maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('Pickup point changed or access was revoked');
      } else {
        const { error } = await supabase.from('campaign_pickup_points').insert({ campaign_id: workspace.campaign.id, artist_id: workspace.campaign.artist_id, ...values });
        if (error) throw error;
      }
      formElement.reset();
      setAddingPickup(false);
      setEditingPickup(null);
      await load();
      setToast({ tone: 'success', title: editingPickup ? t('campaignSaved') : t('campaignPickupAdded'), detail: name });
    } catch (error) {
      console.error(error);
      setToast({ tone: 'error', title: t('campaignSaveFailed'), detail: editingPickup ? (language === 'th' ? 'ข้อมูลอาจถูกเปลี่ยนหรือสิทธิ์ของคุณเปลี่ยนไป กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง' : 'The data or your access may have changed. Reload and try again.') : undefined });
    } finally {
      settingInFlight.current = false;
      setSaving(false);
    }
  };

  const addPaymentMethod = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!workspace || settingInFlight.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const promptPayId = String(form.get('promptpay_id') || '').trim();
    const bankAccounts = normalizePaymentBankAccounts(paymentBankAccounts);
    const firstBankAccount = bankAccounts[0];
    const qrImageUrl = paymentQrUrl.trim();
    const instructions = String(form.get('instructions') || '').trim();
    const hasPaymentDetails = Boolean(promptPayId || bankAccounts.length || qrImageUrl);
    if (!hasPaymentDetails && !instructions) {
      setToast({
        tone: 'warning',
        title: language === 'th' ? 'กรุณาเพิ่มข้อมูลการชำระเงินอย่างน้อยหนึ่งรายการ' : 'Add at least one payment detail.',
        detail: language === 'th' ? 'ใช้พร้อมเพย์ บัญชีธนาคาร รูป QR หรือคำแนะนำการชำระเงินได้' : 'Use PromptPay, a bank account, a QR image, or payment instructions.',
      });
      return;
    }
    const nextDetailsKey = paymentDetailsKey({
      promptpay_id: promptPayId,
      bank_accounts: bankAccounts,
      bank_name: firstBankAccount?.bank_name,
      account_name: firstBankAccount?.account_name,
      account_number: firstBankAccount?.account_number,
      qr_image_url: qrImageUrl,
    });
    const duplicate = workspace.payment_methods.some((method) =>
      method.id !== editingPayment?.id && (hasPaymentDetails
        ? paymentDetailsKey(method) === nextDetailsKey
        : !paymentDetailsKey(method).replace(/\|/g, '') && normalizeSetting(method.instructions) === normalizeSetting(instructions))
    );
    if (duplicate) {
      setToast({ tone: 'warning', title: t('campaignDuplicateSetting') });
      return;
    }
    settingInFlight.current = true;
    setSaving(true);
    try {
      const values = {
      method_type: promptPayId ? 'promptpay' : bankAccounts.length ? 'bank_transfer' : qrImageUrl ? 'qr_image' : 'other',
      promptpay_id: promptPayId || null,
      bank_accounts: bankAccounts,
      bank_name: firstBankAccount?.bank_name || null,
      account_name: firstBankAccount?.account_name || null,
      account_number: firstBankAccount?.account_number || null,
      qr_image_url: qrImageUrl || null,
      instructions: instructions || null,
      };
      if (editingPayment) {
        if (!editingPayment.updated_at) throw new Error('Missing version');
        const { data, error } = await supabase.from('campaign_payment_methods').update(values).eq('id', editingPayment.id).eq('campaign_id', workspace.campaign.id).eq('updated_at', editingPayment.updated_at).select('id').maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('Payment method changed or access was revoked');
      } else {
        const { error } = await supabase.from('campaign_payment_methods').insert({ campaign_id: workspace.campaign.id, artist_id: workspace.campaign.artist_id, display_name: null, ...values });
        if (error) throw error;
      }
      formElement.reset();
      setPaymentQrUrl('');
      setPaymentBankAccounts([createEmptyBankAccount()]);
      setAddingPayment(false);
      setEditingPayment(null);
      await load();
      setToast({ tone: 'success', title: editingPayment ? t('campaignSaved') : t('campaignPaymentAdded') });
    } catch (error) {
      console.error(error);
      setToast({ tone: 'error', title: t('campaignSaveFailed'), detail: editingPayment ? (language === 'th' ? 'ข้อมูลอาจถูกเปลี่ยนหรือสิทธิ์ของคุณเปลี่ยนไป กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง' : 'The data or your access may have changed. Reload and try again.') : undefined });
    } finally {
      settingInFlight.current = false;
      setSaving(false);
    }
  };

  const savePaymentBankAccounts = async () => {
    if (!workspace || !editingPaymentBanks) return;
    const method = workspace.payment_methods.find((item) => item.id === editingPaymentBanks.methodId);
    if (!method) return;
    const bankAccounts = normalizePaymentBankAccounts(editingPaymentBanks.accounts);
    const firstBankAccount = bankAccounts[0];
    if (!bankAccounts.length && !method.promptpay_id?.trim() && !method.qr_image_url?.trim() && !method.instructions?.trim()) {
      setToast({
        tone: 'warning',
        title: language === 'th' ? 'กรุณาเก็บข้อมูลการชำระเงินอย่างน้อยหนึ่งรายการ' : 'Keep at least one payment detail.',
      });
      return;
    }
    const candidateKey = paymentDetailsKey({
      ...method,
      bank_accounts: bankAccounts,
      bank_name: firstBankAccount?.bank_name || null,
      account_name: firstBankAccount?.account_name || null,
      account_number: firstBankAccount?.account_number || null,
    });
    const duplicate = workspace.payment_methods.some((item) => item.id !== method.id && paymentDetailsKey(item) === candidateKey);
    if (duplicate) {
      setToast({ tone: 'warning', title: t('campaignDuplicateSetting') });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('campaign_payment_methods')
        .update({
          bank_accounts: bankAccounts,
          bank_name: firstBankAccount?.bank_name || null,
          account_name: firstBankAccount?.account_name || null,
          account_number: firstBankAccount?.account_number || null,
        })
        .eq('id', method.id)
        .eq('campaign_id', workspace.campaign.id)
        .select('id')
        .single();
      if (error) throw error;
      setEditingPaymentBanks(null);
      await load();
      setToast({ tone: 'success', title: t('campaignSaved') });
    } catch (error) {
      console.error(error);
      setToast({ tone: 'error', title: t('campaignSaveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const uploadPaymentQr = async (file: File | null) => {
    if (!file || !workspace) return;
    setPaymentQrUploading(true);
    try {
      const path = await uploadImage(file, 'qr', { artistId: workspace.campaign.artist_id });
      const { data: { publicUrl } } = supabase.storage.from('Avatar').getPublicUrl(path);
      setPaymentQrUrl(publicUrl);
      setToast({
        tone: 'success',
        title: language === 'th' ? 'อัปโหลดรูป QR แล้ว' : 'QR image uploaded',
        detail: language === 'th' ? 'บันทึกช่องทางชำระเงินเพื่อให้ลูกค้าเห็นรูปนี้' : 'Save the payment method to show this image to customers.',
      });
    } catch (error) {
      setToast({
        tone: 'error',
        title: language === 'th' ? 'อัปโหลดรูป QR ไม่สำเร็จ' : 'QR upload failed',
        detail: error instanceof Error ? error.message : (language === 'th' ? 'อัปโหลดรูปไม่ได้' : 'Could not upload the image.'),
      });
    } finally {
      setPaymentQrUploading(false);
    }
  };

  const removeSetting = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    const table = removeTarget.kind === 'pickup' ? 'campaign_pickup_points' : 'campaign_payment_methods';
    const { error } = await supabase.from(table).delete().eq('id', removeTarget.id);
    if (error) {
      setToast({ tone: 'error', title: t('campaignRemoveSettingFailed') });
    } else {
      await load();
      setToast({ tone: 'success', title: t('campaignSettingRemoved'), detail: removeTarget.name });
    }
    setRemoving(false);
    setRemoveTarget(null);
  };

  const actOnOrder = async (order: CampaignOrder, action: string) => {
    if (orderInFlight.current) return;
    orderInFlight.current = true;
    setOrderBusy(true);
    try {
      let notificationEvent: 'confirmed' | 'payment_rejected' | null = null;
      if (action === 'ship') {
        if (!tracking.trim()) return;
        await markCampaignOrderShipped(order.id, carrier.trim(), tracking.trim());
      } else if (action === 'pickup') {
        await markCampaignOrderPickedUp(order.id);
      } else if (action === 'refunded') {
        const note = window.prompt(t('campaignRefundNotePrompt'))?.trim();
        if (!note) return;
        const reference = window.prompt(t('campaignRefundReferencePrompt'))?.trim() || '';
        await markCampaignOrderRefunded(order.id, note, reference);
      } else {
        const requiresNote = action === 'reject_online_payment' || action === 'mark_online_refund_required';
        const note = requiresNote ? window.prompt(t('campaignActionNotePrompt'))?.trim() || '' : '';
        if (requiresNote && !note) return;
        await runCampaignOrderAction(action as 'confirm_online_payment' | 'reject_online_payment' | 'accept_late_online_payment' | 'mark_online_refund_required', order.id, note);
        if (action === 'confirm_online_payment' || action === 'accept_late_online_payment') notificationEvent = 'confirmed';
        if (action === 'reject_online_payment') notificationEvent = 'payment_rejected';
      }
      setFulfillmentTarget(null);
      await load();
      if (notificationEvent) {
        const { error } = await notifyOnlineCampaignOrder({ orderId: order.id, event: notificationEvent });
        setToast(error
          ? { tone: 'warning', title: t('campaignOrderUpdated'), detail: t('campaignEmailFailed') }
          : { tone: 'success', title: t('campaignOrderUpdated'), detail: t('campaignCustomerEmailSent') });
      } else {
        setToast({ tone: 'success', title: t('campaignOrderUpdated') });
      }
    } catch (error) {
      console.error(error);
      setFeedback(t('campaignOrderActionFailed'));
      setFulfillmentError(error instanceof Error && error.message === 'production_stock_not_ready' ? (language === 'th' ? 'สินค้ารับสั่งผลิตยังไม่ครบ กรุณารับสินค้าเข้าก่อนส่งมอบ' : 'Receive the missing production stock before fulfillment.') : t('campaignOrderActionFailed'));
    } finally { orderInFlight.current = false; setOrderBusy(false); setReviewTarget(null); }
  };

  useEffect(() => {
    setEvidencePreview(null);
    return () => { evidenceRequest.current += 1; };
  }, [campaignId]);

  useEffect(() => {
    const url = evidencePreview?.url;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [evidencePreview?.url]);

  const openEvidence = async (order: CampaignOrder) => {
    if (!order.slip_url) return;
    const request = ++evidenceRequest.current;
    setEvidenceLoadingId(order.id);
    try {
      const blob = await downloadPaymentEvidencePreview(order.slip_url);
      if (request !== evidenceRequest.current) return;
      setEvidencePreview({ order, url: URL.createObjectURL(blob) });
    } catch (error) {
      if (request === evidenceRequest.current) {
        console.error(error);
        setFeedback(t('campaignEvidenceOpenFailed'));
      }
    } finally {
      if (request === evidenceRequest.current) setEvidenceLoadingId(null);
    }
  };
  if (loading) return <div className="grid min-h-screen place-items-center text-pink-600"><Loader2 className="animate-spin" /></div>;
  if (!workspace) return <div className="grid min-h-screen place-items-center text-gray-500">{t('campaignNotFound')}</div>;

  const campaign = workspace.campaign;
  const settingsDirty = Boolean(settingsDraft && (
    settingsDraft.name.trim() !== campaign.name
    || Number(settingsDraft.flatShippingFee) !== Number(campaign.flat_shipping_fee)
    || settingsDraft.shippingEnabled !== campaign.shipping_enabled
    || settingsDraft.pickupEnabled !== campaign.pickup_enabled
  ));
  const shippingFeeValid = Boolean(settingsDraft && /^(?:\d+\.?\d*|\.\d+)$/.test(settingsDraft.flatShippingFee.trim())
    && Number.isFinite(Number(settingsDraft.flatShippingFee))
    && Number(settingsDraft.flatShippingFee) >= 0);
  const settingsValid = Boolean(settingsDraft?.name.trim())
    && shippingFeeValid
    && Boolean(settingsDraft?.shippingEnabled || settingsDraft?.pickupEnabled);
  const saveCampaignSettings = () => settingsDraft && updateCampaign({
    name: settingsDraft.name.trim(),
    flat_shipping_fee: Number(settingsDraft.flatShippingFee),
    shipping_enabled: settingsDraft.shippingEnabled,
    pickup_enabled: settingsDraft.pickupEnabled,
  });
  const storefrontUrl = '/' + artistSlug + '/campaign/' + campaign.slug;
  const readinessChecks: Array<{ label: string; ready: boolean; tab: Tab }> = [
    { label: language === 'th' ? 'วันเปิด–ปิดขาย' : 'Sales dates', ready: new Date(campaign.closes_at) > new Date(campaign.opens_at), tab: 'settings' },
    { label: language === 'th' ? 'สินค้าเปิดใช้งาน' : 'Enabled products', ready: workspace.products.some(item => item.is_enabled), tab: 'products' },
    { label: language === 'th' ? 'สต็อกพร้อมขาย' : 'Stock available', ready: workspace.products.some(item => item.is_enabled && ((item.supply_mode === 'production' && item.production_limit == null) || item.is_unlimited || Number(item.available_quantity ?? Number(item.stock_total || 0) - Number(item.stock_reserved || 0) - Number(item.stock_sold || 0)) > 0)), tab: 'products' },
    { label: language === 'th' ? 'ช่องทางรับเงิน' : 'Payment method', ready: workspace.payment_methods.some(item => item.is_enabled), tab: 'settings' },
    { label: language === 'th' ? 'วิธีส่งมอบสินค้า' : 'Fulfillment method', ready: campaign.shipping_enabled || campaign.pickup_enabled, tab: 'settings' },
    ...(campaign.pickup_enabled ? [{ label: language === 'th' ? 'จุดรับสินค้า' : 'Pickup point', ready: workspace.pickup_points.some(item => item.is_enabled), tab: 'settings' as Tab }] : []),
  ];
  const actionCount = workspace.orders.filter((order) =>
    ['awaiting_shipment', 'awaiting_pickup'].includes(order.fulfillment_status)
    || (canManage && ['payment_submitted', 'payment_submitted_late', 'refund_pending'].includes(order.payment_status))
  ).length;

  return (
    <div className="min-h-screen bg-gray-50 text-slate-800">
      <Toast message={toast} onClose={() => setToast(null)} />
      {evidencePreview && <EvidenceReview title={t('campaignEvidencePreview')} closeLabel={t('campaignCloseEvidence')} code={evidencePreview.order.order_code} customer={evidencePreview.order.customer_name} amount={evidencePreview.order.total_price} currency={evidencePreview.order.currency} url={evidencePreview.url} items={evidencePreview.order.items} onClose={() => setEvidencePreview(null)}>
        {canManage && evidencePreview.order.payment_status === 'payment_submitted' && <>
          <button className="review-approve" onClick={() => { setReviewTarget({ order: evidencePreview.order, action: 'confirm_online_payment' }); setEvidencePreview(null); }}>{t('campaignConfirmPayment')}</button>
          <button className="review-reject" onClick={() => { setReviewTarget({ order: evidencePreview.order, action: 'reject_online_payment' }); setEvidencePreview(null); }}>{t('campaignRejectPayment')}</button>
        </>}
      </EvidenceReview>}
      <ConfirmDialog
        open={Boolean(fulfillmentTarget)}
        title={fulfillmentTarget?.action === 'ship' ? t('campaignMarkShipped') : t('campaignMarkPickedUp')}
        detail={fulfillmentTarget ? `${fulfillmentTarget.order.order_code} · ${fulfillmentTarget.order.customer_name}` : ''}
        loading={orderBusy}
        confirmDisabled={fulfillmentTarget?.action === 'ship' && !tracking.trim()}
        confirmLabel={language === 'th' ? 'ยืนยันรายการนี้' : 'Confirm this order'}
        onCancel={() => { if (!orderInFlight.current) setFulfillmentTarget(null); }}
        onConfirm={() => { if (fulfillmentTarget) void actOnOrder(fulfillmentTarget.order, fulfillmentTarget.action); }}
      >
        {fulfillmentTarget && <div className="mt-3 max-h-[55vh] space-y-3 overflow-y-auto text-sm">
          <ul className="rounded-xl bg-pink-50 p-3 text-gray-900">{fulfillmentTarget.order.items.map((item, index) => <li key={index} className="py-1">{item.name} {item.sku && <span className="text-gray-500">({item.sku})</span>} <strong>×{item.quantity}</strong>{item.components?.map(component => <div key={component.product_id} className="pl-4 text-xs text-gray-600">{component.name} ×{component.quantity}</div>)}</li>)}</ul>
          <p className="whitespace-pre-line break-words">{fulfillmentTarget.order.customer_phone}<br />{fulfillmentTarget.action === 'ship' ? fulfillmentTarget.order.shipping_address : fulfillmentTarget.order.pickup_point?.name}</p>
          {fulfillmentTarget.action === 'ship' ? <>
            <label className="block">{language === 'th' ? 'ขนส่ง (ไม่บังคับ)' : 'Carrier (optional)'}<input disabled={orderBusy} value={carrier} onChange={event => setCarrier(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border p-3" /></label>
            <label className="block">{language === 'th' ? 'เลขพัสดุ' : 'Tracking number'}<input required disabled={orderBusy} value={tracking} onChange={event => setTracking(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border p-3" /></label>
          </> : null}
          <p className="text-gray-600">{language === 'th' ? 'เทียบรหัสและสินค้าให้ตรงกับลูกค้าหรือพัสดุ บันทึกเมื่อส่งมอบแล้วเท่านั้น' : 'Match the code and items to the customer or parcel. Confirm only after handing over.'}</p>
          {fulfillmentError && <p role="alert" className="text-red-700">{fulfillmentError}</p>}
        </div>}
      </ConfirmDialog>
      <ConfirmDialog open={Boolean(reviewTarget)} title={reviewTarget?.action === 'reject_online_payment' ? t('campaignRejectPayment') : t('campaignConfirmPayment')} detail={reviewTarget ? `${reviewTarget.order.order_code} · ${formatPrice(reviewTarget.order.total_price, reviewTarget.order.currency)}\n${language === 'th' ? 'ตรวจสอบรายการเงินเข้าก่อนยืนยัน การปฏิเสธจะยกเลิกออเดอร์และคืนสต็อก หากได้รับเงินแล้วให้ติดต่อผู้ซื้อก่อน' : 'Check the received transfer before confirming. Rejection cancels the order and releases stock. Contact the buyer first if money was received.'}` : ''} loading={orderBusy} confirmLabel={reviewTarget?.action === 'reject_online_payment' ? t('campaignRejectPayment') : t('campaignConfirmPayment')} onCancel={() => setReviewTarget(null)} onConfirm={() => { if (reviewTarget) void actOnOrder(reviewTarget.order, reviewTarget.action); }} />
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title={t('campaignRemoveSetting')}
        detail={removeTarget ? t('campaignRemoveSettingDetail', { name: removeTarget.name }) : ''}
        confirmLabel={t('campaignConfirmRemove')}
        tone="danger"
        loading={removing}
        onConfirm={() => void removeSetting()}
        onCancel={() => setRemoveTarget(null)}
      />
      <AdminHeader activePage="online-sales" actorRole={actor?.role} userEmail={actor?.member_email} />
      <main className="mx-auto w-full max-w-[1180px] px-4 py-5 md:px-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link to="/manage-online-sales" className="text-xs font-black text-pink-700">← {t('campaignOnlineSales')}</Link>
            <h1 className="mt-1 text-xl font-black text-gray-950">{campaign.name}</h1>
            <p className="text-sm font-semibold text-gray-500">{new Date(campaign.opens_at).toLocaleString(dateLocale)} – {new Date(campaign.closes_at).toLocaleString(dateLocale)}</p>
          </div>
          {artistSlug && (
            <a href={storefrontUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-pink-200 bg-white px-4 text-sm font-black text-pink-700">
              <ExternalLink size={16} />{t('campaignViewStorefront')}
            </a>
          )}
        </div>

        <nav className="mb-5 flex gap-1 overflow-x-auto rounded-2xl border border-gray-200 bg-white p-1">
          {((canManage ? ['overview', 'products', 'promotions', 'orders', 'sales', 'settings'] : ['overview', 'orders']) as Tab[]).map((item) => (
            <button key={item} onClick={() => { if (((tab === 'products' && Object.keys(productEdits).length > 0) || (tab === 'promotions' && promotionEditing)) && item !== tab && !window.confirm(language === 'th' ? 'มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการออกหรือไม่?' : 'You have unsaved changes. Leave this page?')) return; if (item !== 'products') setProductEdits({}); setTab(item); }} className={'min-h-11 shrink-0 flex-1 whitespace-nowrap rounded-xl px-3 text-sm font-black ' + (tab === item ? 'bg-pink-600 text-white' : 'text-gray-600 hover:bg-gray-50')}>
              {item === 'sales' ? (language === 'th' ? 'ยอดขาย' : 'Sales') : item === 'promotions' ? (language === 'th' ? 'โปรโมชั่น' : 'Promotions') : t(('campaignTab_' + item) as Parameters<typeof t>[0])}
              {item === 'orders' && actionCount > 0 && <span className="ml-1 rounded-full bg-white/20 px-1.5">{actionCount}</span>}
            </button>
          ))}
        </nav>

        {feedback && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">{feedback}</div>}

        {tab === 'overview' && (
          <>
          <div className="grid grid-cols-3 gap-2" aria-label={language === 'th' ? 'สรุปแคมเปญ' : 'Campaign summary'}>
            <button type="button" disabled={!canManage} onClick={() => { setProductSearch(''); setProductCategory('all'); setProductMembership('included'); setProductPage(1); setTab('products'); }} className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-left text-blue-900"><ShoppingBag size={17} /><strong className="mt-1 block text-lg">{workspace.products.filter(item => item.is_enabled).length}</strong><span className="text-xs font-bold">{t('campaignProducts')} →</span></button>
            <button type="button" onClick={() => { setSearch(''); setOrderFilter('needs_action'); setTab('orders'); }} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-amber-900"><PackageCheck size={17} /><strong className="mt-1 block text-lg">{actionCount}</strong><span className="text-xs font-bold">{t('campaignNeedsAction')} →</span></button>
            <button type="button" onClick={() => { setSearch(''); setOrderFilter('payment_confirmed'); setTab('orders'); }} className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-left text-emerald-900"><span aria-hidden="true" className="text-sm font-black">฿</span><strong className="mt-1 block break-words text-lg">{formatPrice(workspace.orders.filter(order => order.payment_status === 'payment_confirmed').reduce((sum, order) => sum + Number(order.total_price), 0), campaign.currency)}</strong><span className="text-xs font-bold">{t('campaignRevenue')} →</span></button>
          </div>
          {canManage && <section className="sales-readiness" aria-label={language === 'th' ? 'ตรวจความพร้อมก่อนเปิดขาย' : 'Before sales open'}>
            <header><div><h2>{language === 'th' ? 'ตรวจความพร้อมก่อนเปิดขาย' : 'Before sales open'}</h2><p>{language === 'th' ? 'ตรวจจากข้อมูลที่บันทึกแล้ว รายการนี้ไม่ใช่สถานะเปิดขาย' : 'Based on saved settings. This checklist is not the publication status.'}</p></div><strong>{readinessChecks.filter(item => item.ready).length}/{readinessChecks.length}</strong></header>
            <ul>{[...readinessChecks].sort((a, b) => Number(a.ready) - Number(b.ready)).map(item => <li key={item.label}><span>{item.label}</span><b>{item.ready ? (language === 'th' ? 'พร้อม' : 'Ready') : (language === 'th' ? 'ตรวจสอบ' : 'Check')}</b><button onClick={() => setTab(item.tab)}>{language === 'th' ? 'ตั้งค่า' : 'Configure'}</button></li>)}</ul>
            <button onClick={() => setTab('settings')}>{language === 'th' ? 'ตรวจการตั้งค่าและเผยแพร่' : 'Review settings & publish'}</button>
          </section>}

          </>
        )}

        {tab === 'sales' && canManage && <CampaignSalesReport campaignId={campaign.id} name={campaign.name} timeZone={campaign.campaign_timezone || 'Asia/Bangkok'} catalog={workspace.catalog} />}

        {tab === 'promotions' && canManage && <CampaignPromotionPicker artistId={workspace.campaign.artist_id} campaignId={campaignId!} campaignName={campaign.name} onEditingChange={setPromotionEditing} products={workspace.catalog.map(product => ({ ...product, id: product.product_id || product.id || '', category: product.category || undefined }))} />}

        {tab === 'products' && (
          <section>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4">
              <div>
                <h2 className="text-lg font-black text-gray-950">{t('campaignCatalogTitle')}</h2>
                <p className="mt-1 max-w-2xl text-sm font-semibold leading-relaxed text-gray-500">{t('campaignCatalogBody')}</p>
              </div>
              <div className="rounded-full bg-pink-50 px-3 py-1.5 text-xs font-black text-pink-700">
                {allocatedIds.size} / {workspace.catalog.length} {t('campaignIncluded')}
              </div>
            </div>

            <div className="mb-3 rounded-2xl border border-gray-200 bg-white p-3">
              <div className="grid gap-2 lg:grid-cols-[minmax(240px,1fr)_180px_180px_160px_auto]">
                <label className="relative">
                  <span className="sr-only">{t('campaignProductSearch')}</span>
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={17} />
                  <input
                    type="search"
                    value={productSearch}
                    onChange={(event) => { setProductSearch(event.target.value); setProductPage(1); }}
                    placeholder={t('campaignProductSearch')}
                    className="min-h-11 w-full rounded-xl border border-gray-200 pl-10 pr-3 text-sm font-semibold"
                  />
                </label>
                <select
                  aria-label={t('campaignProductCategory')}
                  value={productCategory}
                  onChange={(event) => { setProductCategory(event.target.value); setProductPage(1); }}
                  className="min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold"
                >
                  <option value="all">{t('campaignAllCategories')}</option>
                  {productCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
                <select
                  aria-label={t('campaignProductMembership')}
                  value={productMembership}
                  onChange={(event) => { setProductMembership(event.target.value as ProductMembership); setProductPage(1); }}
                  className="min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold"
                >
                  <option value="all">{t('campaignAllMemberships')}</option>
                  <option value="included">{t('campaignIncluded')}</option>
                  <option value="not_added">{t('campaignNotAdded')}</option>
                </select>
                <select
                  aria-label={t('campaignProductSort')}
                  value={productSort}
                  onChange={(event) => { setProductSort(event.target.value as typeof productSort); setProductPage(1); }}
                  className="min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold"
                >
                  <option value="name_asc">{t('campaignNameAscending')}</option>
                  <option value="name_desc">{t('campaignNameDescending')}</option>
                </select>
                <button
                  type="button"
                  disabled={!productSearch && productCategory === 'all' && productMembership === 'all' && productSort === 'name_asc'}
                  onClick={() => { setProductSearch(''); setProductCategory('all'); setProductMembership('all'); setProductSort('name_asc'); setProductPage(1); }}
                  className="min-h-11 rounded-xl border border-pink-200 px-3 text-xs font-black text-pink-700 disabled:border-gray-100 disabled:text-gray-300"
                >
                  {t('campaignClearFilters')}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-bold text-gray-500">{t('campaignProductResults', { count: filteredCampaignCatalog.length })}</div>
                <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1" role="group" aria-label={language === 'th' ? 'รูปแบบการแสดงสินค้า' : 'Product view'}>
                  <button type="button" aria-pressed={productView === 'cards'} onClick={() => setProductView('cards')} className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-black ${productView === 'cards' ? 'bg-white text-blue-800 shadow-sm' : 'text-gray-500'}`}><LayoutGrid size={16} />{t('catalogProductCards')}</button>
                  <button type="button" aria-pressed={productView === 'table'} onClick={() => setProductView('table')} className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-black ${productView === 'table' ? 'bg-white text-blue-800 shadow-sm' : 'text-gray-500'}`}><List size={16} />{t('catalogTable')}</button>
                </div>
              </div>
            </div>

            <div className="mb-3 flex items-center gap-3"><button type="button" disabled={saving || Object.keys(productEdits).length === 0} onClick={() => void saveProductEdits()} className="min-h-11 rounded-xl bg-blue-700 px-4 font-bold text-white disabled:opacity-40">{language === 'th' ? 'บันทึกการแก้ไขสินค้า' : 'Save product changes'}</button>{Object.keys(productEdits).length > 0 && <span className="text-sm font-bold text-amber-700">{language === 'th' ? 'มีการแก้ไขที่ยังไม่ได้บันทึก' : 'Unsaved changes'}</span>}</div>
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className={productView === 'table' ? 'overflow-x-auto' : 'campaign-products-cards'}>
                <table className="w-full min-w-[1080px] table-fixed border-collapse text-left">
                  <colgroup>
                    <col className="w-[300px]" />
                    <col className="w-[80px]" />
                    <col className="w-[90px]" />
                    <col className="w-[90px]" />
                    <col className="w-[90px]" />
                    <col className="w-[110px]" />
                    <col className="w-[130px]" />
                    <col className="w-[190px]" />
                  </colgroup>
                  <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-3">{t('campaignProduct')}</th>
                      <th className="px-2 py-3">{t('catalogCategory')}</th>
                      <th className="px-2 py-3 text-center">{t('campaignOnHandStock')}</th>
                      <th className="px-2 py-3 text-center">{t('campaignAvailableStock')}</th>
                      <th className="px-2 py-3 text-center">{t('campaignCurrentStock')}</th>
                      <th className="px-2 py-3">{t('campaignPriceOverride')}</th>
                      <th className="px-2 py-3">{t('campaignMaxPerOrder')}</th>
                      <th className="px-2 py-3 text-right">{t('campaignAction')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pagedCampaignCatalog.map((product) => {
                      const productId = product.product_id || product.id || '';
                      const allocated = workspace.products.find((item) => item.product_id === productId);
                      const summary = getStockSummary(product);
                      const isIncluded = allocatedIds.has(productId);
                      const campaignStock = isIncluded ? Number(allocated?.stock_total || 0) : 0;
                      const maxCampaignStock = campaignStock + summary.available;
                      const committedElsewhere = Math.max(summary.on_hand - summary.available - campaignStock, 0);
                      const used = Number(allocated?.stock_sold || 0) + Number(allocated?.stock_reserved || 0);
                      const draftStockValue = productEdits[productId]?.stock;
                      const requestedStock = draftStockValue !== undefined && draftStockValue.trim() !== '' ? Number(draftStockValue) : campaignStock;
                      const shownStock = Number.isSafeInteger(requestedStock) && requestedStock >= used && requestedStock <= maxCampaignStock ? requestedStock : campaignStock;
                      const centralStock = Math.max(summary.available + campaignStock - shownStock, 0);
                      const remainingStock = Math.max(shownStock - used, 0);
                      const stockPool = Math.max(summary.on_hand, centralStock + remainingStock + used, 1);
                      return (
                        <tr key={productId} className={isIncluded ? 'bg-pink-50/50' : 'hover:bg-gray-50/70'}>
                          <td className="campaign-card-product px-3 py-2">
                            <div className="campaign-product-heading flex items-center gap-3">
                              <div className="campaign-product-image grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-gray-100 text-gray-300">
                                <ProductMedia product={{ ...product, id: productId }} getImageUrl={getMenuImageUrl} />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <div className="campaign-product-name text-sm font-black text-gray-950">{product.name}</div>
                                  {isIncluded && <span className="shrink-0 rounded-full bg-pink-100 px-2 py-0.5 text-[9px] font-black text-pink-700">{t('campaignIncluded')}</span>}
                                </div>
                                <div className="mt-0.5 font-mono text-[10px] font-bold text-gray-400">{product.sku || '—'}</div>
                                <span className="campaign-product-category mt-2 inline-block rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-600">{product.category || '—'}</span>
                                {product.gift_only && <span className="mt-1 inline-block rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700">{language === 'th' ? 'ของแถมเท่านั้น' : 'Gift only'}</span>}
                              </div>
                            </div>
                            {isIncluded && allocated && <label className="mt-3 flex items-start gap-2 rounded-xl bg-blue-50 p-3 text-xs font-bold text-blue-900"><input type="checkbox" checked={Boolean(product.gift_only) || (productEdits[productId]?.gift ?? !(allocated.is_sellable ?? true))} disabled={Boolean(product.gift_only)} onChange={event => editProduct(productId, 'gift', event.target.checked)} aria-label={`${language === 'th' ? 'ใช้เป็นของแถมเท่านั้นในแคมเปญนี้' : 'Gift only in this campaign'}: ${product.name}`} />{language === 'th' ? 'ใช้เป็นของแถมเท่านั้นในแคมเปญนี้' : 'Gift only in this campaign'}</label>}
                            {!isIncluded && !product.is_unlimited && product.product_kind !== 'bundle' && <div className="campaign-stock-summary mt-3 rounded-xl bg-slate-50 p-3 text-xs font-bold text-slate-600"><strong className="text-emerald-700">{summary.available}</strong> {language === 'th' ? 'สต็อกกลางพร้อมจัดสรร' : 'Central stock available to allocate'}</div>}
                            {allocated && isIncluded && product.product_kind !== 'bundle' && !product.is_unlimited && !allocated.is_unlimited && allocated.supply_mode !== 'production' && <div className="campaign-stock-summary mt-3 rounded-xl bg-slate-50 p-3 text-xs font-bold text-slate-600">
                              <div className="grid grid-cols-3 gap-2">
                                <div><strong className="block text-emerald-700">{centralStock}</strong>{language === 'th' ? 'สต็อกกลาง' : 'Central stock'}</div>
                                <div><strong className="block text-blue-700">{remainingStock}</strong>{language === 'th' ? 'เหลือขาย' : 'Available'}</div>
                                <div><strong className="block text-amber-700">{used}</strong>{language === 'th' ? 'ขายแล้ว / จองไว้' : 'Sold / held'}</div>
                              </div>
                              <div data-testid="campaign-stock-bar" className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-gray-200"><div className="bg-emerald-700" style={{ width: `${centralStock / stockPool * 100}%` }} /><div className="bg-blue-700" style={{ width: `${remainingStock / stockPool * 100}%` }} /><div className="bg-amber-700" style={{ width: `${used / stockPool * 100}%` }} /></div>
                            </div>}
                            {allocated && <fieldset className="mt-2" disabled={Object.keys(productEdits).length > 0}><SupplyPolicyEditor key={allocated.campaign_product_id || allocated.id} productId={productId} campaignId={campaignId} settings={allocated} onSaved={() => void load()} /></fieldset>}
                            {product.product_kind === 'bundle' && isIncluded && (() => {
                              const missing = (product.bundle_items || []).filter(item => item.product_id && !allocatedIds.has(item.product_id));
                              return missing.length ? <p role="status" className="mt-2 rounded-lg bg-red-50 p-2 text-xs font-bold text-red-700">{language === 'th' ? 'ยังไม่ได้เพิ่มสินค้าในชุดเข้าแคมเปญ:' : 'Add these bundle components to the campaign:'} {missing.map(item => item.name || workspace.catalog.find(candidate => (candidate.product_id || candidate.id) === item.product_id)?.name || item.product_id).join(', ')}</p> : null;
                            })()}
                            {!product.is_unlimited && committedElsewhere > 0 && <div className="mt-1 text-[10px] font-bold text-slate-500">{t('campaignStockElsewhere', { count: committedElsewhere })}</div>}
                          </td>
                          <td data-label={t('catalogCategory')} className="campaign-card-redundant px-2 py-2 text-xs font-bold text-gray-600">{product.category || '—'}</td>
                          {product.product_kind === 'bundle' ? (
                            <td colSpan={3} data-label={t('campaignCurrentStock')} className="campaign-card-wide px-2 py-2 text-center text-xs font-bold text-pink-800">{language === 'th' ? 'ใช้สต็อกส่วนประกอบในแคมเปญร่วมกับขายแยก' : 'Shares component stock in this campaign'}{allocated && <div>{allocated.available_quantity == null ? t('catalogUnlimited') : `${allocated.available_quantity} ${language === 'th' ? 'ชุดพร้อมขาย' : 'bundles available'}`}</div>}</td>
                          ) : product.is_unlimited ? (
                            <td colSpan={3} data-label={t('campaignCurrentStock')} className="campaign-card-wide px-2 py-2 text-center text-xs font-black text-gray-600">{t('catalogUnlimited')}</td>
                          ) : (
                            <>
                              <td data-label={t('campaignOnHandStock')} className="campaign-card-redundant px-2 py-2 text-center text-sm font-black text-gray-900">{summary.on_hand}</td>
                              <td data-label={t('campaignAvailableStock')} className="campaign-card-redundant px-2 py-2 text-center text-sm font-black text-emerald-700">{summary.available}</td>
                              <td data-label={t('campaignCurrentStock')} className="px-2 py-2 text-center">
                                {allocated && isIncluded ? (
                                  <div>
                                    <input key={`stock-${allocated.stock_total}`} aria-label={`${t('campaignAllocatedStock')} ${product.name}`} type="number" min={Number(allocated.stock_reserved || 0) + Number(allocated.stock_sold || 0)} max={maxCampaignStock} value={productEdits[productId]?.stock ?? String(campaignStock)} onChange={(event) => editProduct(productId, 'stock', event.target.value)} className="h-11 w-20 rounded-xl border border-gray-200 px-3 text-center text-sm font-black" />
                                    {allocated.supply_mode !== 'production' && !allocated.is_unlimited && (
                                      <div className="campaign-card-redundant mt-1 text-xs font-bold text-blue-700">{t('campaignStockRemaining')}: {allocated.available_quantity ?? Math.max(campaignStock - Number(allocated.stock_reserved || 0) - Number(allocated.stock_sold || 0), 0)}</div>
                                    )}
                                  </div>
                                ) : <span className="text-sm font-black text-pink-700">0</span>}
                              </td>
                            </>
                          )}
                          <td data-label={t('campaignPriceOverride')} className="px-2 py-2">
                            {allocated && isIncluded ? (
                              <input key={`price-${allocated.price_override}`} aria-label={`${t('campaignPriceOverride')} ${product.name}`} type="number" min="0" placeholder={String(product.price)} value={productEdits[productId]?.price ?? String(allocated.price_override ?? '')} onChange={(event) => editProduct(productId, 'price', event.target.value)} className="h-11 w-24 rounded-xl border border-gray-200 px-3 text-sm font-bold" />
                            ) : <span className="text-sm font-black text-pink-700">{formatPrice(product.price, campaign.currency)}</span>}
                          </td>
                          <td data-label={t('campaignMaxPerOrder')} className="px-2 py-2">
                            {allocated && isIncluded ? (
                              <input
                                key={`limit-${allocated.max_quantity_per_order ?? 'unlimited'}`}
                                aria-label={`${t('campaignMaxPerOrder')} ${product.name}`}
                                type="number"
                                min="1"
                                step="1"
                                placeholder={t('campaignMaxPerOrderPlaceholder')}
                                value={productEdits[productId]?.limit ?? String(allocated.max_quantity_per_order ?? '')}
                                onChange={(event) => editProduct(productId, 'limit', event.target.value)}
                                className="h-11 w-24 rounded-xl border border-gray-200 px-3 text-sm font-bold"
                              />
                            ) : <span className="text-xs font-bold text-gray-400">—</span>}
                          </td>
                          <td className="campaign-card-actions px-2 py-2 text-right">
                            {isIncluded ? (
                              <button type="button" disabled={saving || Object.keys(productEdits).length > 0} onClick={() => void toggleProduct(productId, false)} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-gray-200 px-3 text-xs font-black text-gray-600 hover:border-red-200 hover:text-red-700 disabled:opacity-50"><X size={14} />{t('campaignRemoveProduct')}</button>
                            ) : (
                              <div>
                                <button type="button" disabled={saving || Object.keys(productEdits).length > 0} onClick={() => void toggleProduct(productId, true)} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-pink-200 px-3 text-xs font-black text-pink-700 hover:bg-pink-50 disabled:opacity-50"><Plus size={14} />{t('campaignAddProduct')}</button>
                                {!product.is_unlimited && summary.available === 0 && <div className="mt-1 max-w-40 text-[9px] font-bold leading-tight text-amber-700">{t('campaignAddZeroStock')}</div>}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {filteredCampaignCatalog.length === 0 && <div className="p-8 text-center text-sm font-bold text-gray-400">{t('campaignNoProductsFound')}</div>}
              {productPageCount > 1 && (
                <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
                  <span className="text-xs font-bold text-gray-500">{t('campaignProductPage', { page: visibleProductPage, total: productPageCount })}</span>
                  <div className="flex gap-2">
                    <button type="button" aria-label={t('campaignPreviousPage')} disabled={visibleProductPage === 1} onClick={() => setProductPage((page) => Math.max(1, page - 1))} className="grid h-11 w-11 place-items-center rounded-xl border border-gray-200 text-gray-600 disabled:opacity-30"><ChevronLeft size={17} /></button>
                    <button type="button" aria-label={t('campaignNextPage')} disabled={visibleProductPage === productPageCount} onClick={() => setProductPage((page) => Math.min(productPageCount, page + 1))} className="grid h-11 w-11 place-items-center rounded-xl border border-gray-200 text-gray-600 disabled:opacity-30"><ChevronRight size={17} /></button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {tab === 'orders' && (
          <section className="merchant-orders">
            <div className="merchant-orders-heading"><h2>{t('campaignAllOrders')}</h2><span>{filteredOrders.length} / {workspace.orders.length}</span></div>
            <div className="merchant-order-filters">
              {canManage && <button aria-pressed={orderFilter === 'review'} onClick={() => setOrderFilter('review')}>{t('campaignReviewPayments')} <b>{workspace.orders.filter(order => order.payment_status === 'payment_submitted').length}</b></button>}
              {canManage && <button aria-pressed={orderFilter === 'payment'} onClick={() => setOrderFilter('payment')}>{t('campaignPaymentIssues')} <b>{workspace.orders.filter(order => ['payment_submitted_late', 'refund_pending'].includes(order.payment_status)).length}</b></button>}
              <button aria-pressed={orderFilter === 'shipping'} onClick={() => setOrderFilter('shipping')}>{t('campaignAwaitingShipment')} <b>{workspace.orders.filter(order => order.fulfillment_status === 'awaiting_shipment').length}</b></button>
              <button aria-pressed={orderFilter === 'pickup'} onClick={() => setOrderFilter('pickup')}>{t('campaignAwaitingPickup')} <b>{workspace.orders.filter(order => order.fulfillment_status === 'awaiting_pickup').length}</b></button>
            </div>
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              <select aria-label={t('campaignAllOrders')} value={orderFilter} onChange={(event) => setOrderFilter(event.target.value)} className="min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold">
                <option value="needs_action">{t('campaignNeedsAction')}</option>
                {canManage && <option value="review">{t('campaignReviewPayments')}</option>}
                <option value="payment">{t('campaignPaymentIssues')}</option>
                <option value="shipping">{t('campaignAwaitingShipment')}</option>
                <option value="pickup">{t('campaignAwaitingPickup')}</option>
                <option value="awaiting_payment">{t('campaignOrderAwaitingPayment')}</option>
                <option value="payment_confirmed">{language === 'th' ? 'ยืนยันการชำระเงินแล้ว' : 'Payment confirmed'}</option>
                <option value="completed">{t('campaignCompleted')}</option>
                <option value="cancelled">{t('campaignCancelledExpiredRefunded')}</option>
                <option value="all">{t('campaignAllOrders')}</option>
              </select>
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('campaignSearchOrders')} className="min-h-11 rounded-xl border border-gray-200 bg-white px-3" />
            </div>
            <div className="space-y-3">
              {filteredOrders.length === 0 && <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-6 text-center text-sm font-bold text-gray-400">{t('campaignNoOrders')}</div>}
              {filteredOrders.map((order) => (
                <article key={order.id} className="merchant-order-row">
                  <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-blue-50 px-3 py-2 font-black text-blue-900"><span>{orderSequences[order.id] != null ? `${language === 'th' ? 'ออเดอร์' : 'Order'} #${orderSequences[order.id]}` : (language === 'th' ? 'คำสั่งซื้อ' : 'Order')}</span><span>{formatPrice(order.total_price, order.currency)}</span></div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-sm font-black">{order.order_code}</div>
                      <div className="text-sm font-bold text-gray-700">{order.customer_name} · {t(order.fulfillment_method === 'shipping' ? 'campaignShipping' : 'campaignPickup')}</div>
                      <ul className="mt-1 space-y-1 text-xs font-semibold text-gray-500">{order.items.map((item, index) => <li key={index} className="break-words">{item.name} ×{item.quantity}</li>)}</ul>
                      <OrderProductionStock value={productionStock.rows[order.id]} error={productionStock.error} />
                    </div>
                    <div className="text-right"><div className="text-xs font-bold text-gray-500">{t(({ awaiting_payment: 'campaignOrderAwaitingPayment', payment_submitted: 'campaignOrderReview', payment_submitted_late: 'campaignOrderLateReview', payment_confirmed: 'campaignOrderConfirmed', payment_expired: 'campaignOrderExpired', payment_rejected: 'orderStatusRejectedTitle', payment_cancelled: 'orderStatusCancelledTitle', refund_pending: 'campaignOrderRefundPending', refunded: 'campaignOrderRefunded' } as const)[order.payment_status])}</div><div className="text-xs font-bold text-gray-500">{order.fulfillment_status !== 'not_required' && t(({ awaiting_shipment: 'campaignAwaitingShipment', shipped: 'orderStatusShippedTitle', awaiting_pickup: 'campaignAwaitingPickup', picked_up: 'orderStatusPickedUpTitle', cancelled: 'orderStatusCancelledTitle', expired: 'campaignOrderExpired' } as const)[order.fulfillment_status])}</div></div>
                  </div>
                  <ActivityRewardsCard
                    pricingBreakdown={order.pricing_breakdown}
                    state={activityRewardStateForOrder(order.status, order.payment_status)}
                    language={language}
                    orderReference={order.order_code}
                    className="mt-3"
                  />
                  {order.shipping_address && <p className="mt-2 whitespace-pre-line break-words text-sm text-gray-600">{order.shipping_address}</p>}
                  {order.pickup_point && <p className="mt-2 text-sm text-gray-600">{order.pickup_point.name}{order.pickup_point.address && <> · {order.pickup_point.address}</>}</p>}
                  {order.tracking_number && <p className="mt-2 break-words text-sm font-bold">{order.shipping_carrier} · {order.tracking_number}</p>}
                  <fieldset disabled={orderBusy} className="mt-3 flex flex-wrap gap-2">
                    {canManage && order.slip_url && <button disabled={evidenceLoadingId === order.id} onClick={() => void openEvidence(order)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 px-4 text-xs font-black text-gray-700 disabled:opacity-50">{evidenceLoadingId === order.id ? <Loader2 className="animate-spin" size={15} /> : <Eye size={15} />}{t('campaignViewEvidence')}</button>}
                    {canManage && order.payment_status === 'payment_submitted' && <><button onClick={() => setReviewTarget({ order, action: 'confirm_online_payment' })} className="min-h-11 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white">{t('campaignConfirmPayment')}</button><button onClick={() => setReviewTarget({ order, action: 'reject_online_payment' })} className="min-h-11 rounded-xl border border-red-200 px-4 text-xs font-black text-red-700">{t('campaignRejectPayment')}</button></>}
                    {canManage && order.payment_status === 'payment_submitted_late' && <><button onClick={() => void actOnOrder(order, 'accept_late_online_payment')} className="min-h-11 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white">{t('campaignAcceptLate')}</button><button onClick={() => void actOnOrder(order, 'mark_online_refund_required')} className="min-h-11 rounded-xl border border-amber-300 px-4 text-xs font-black text-amber-800">{t('campaignRefundRequired')}</button></>}
                    {canManage && order.payment_status === 'refund_pending' && <button onClick={() => void actOnOrder(order, 'refunded')} className="min-h-11 rounded-xl bg-blue-600 px-4 text-xs font-black text-white">{t('campaignMarkRefunded')}</button>}
                    {workspace.can_manage_shipping && order.fulfillment_status === 'awaiting_shipment' && <button onClick={() => openFulfillment(order, 'ship')} className="min-h-11 rounded-xl bg-blue-600 px-4 text-xs font-black text-white">{t('campaignMarkShipped')}</button>}
                    {order.fulfillment_status === 'awaiting_pickup' && <button onClick={() => openFulfillment(order, 'pickup')} className="min-h-11 rounded-xl bg-blue-600 px-4 text-xs font-black text-white">{t('campaignMarkPickedUp')}</button>}
                  </fieldset>
                </article>
              ))}
            </div>
          </section>
        )}

        {tab === 'settings' && (
          <div className="space-y-4">
            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2"><Settings size={18} /><h2 className="font-black">{t('campaignSettings')}</h2></div>
              {settingsDraft && <>
                <div className="grid gap-3 md:grid-cols-2">
                  <label><span className="text-xs font-black">{t('campaignName')}</span><input aria-label={t('campaignName')} value={settingsDraft.name} onChange={(event) => setSettingsDraft((current) => current && ({ ...current, name: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3" /></label>
                  <label><span className="text-xs font-black">{t('campaignShippingFee')}</span><input aria-label={t('campaignShippingFee')} type="text" inputMode="decimal" aria-invalid={!shippingFeeValid} aria-describedby={!shippingFeeValid ? 'campaign-shipping-fee-error' : undefined} value={settingsDraft.flatShippingFee} onChange={(event) => { const value = event.currentTarget.value; setSettingsDraft((current) => current && ({ ...current, flatShippingFee: value })); }} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3" />{!shippingFeeValid && <span id="campaign-shipping-fee-error" className="mt-1 block text-xs font-semibold text-red-700">{language === 'th' ? 'กรอกค่าส่งเป็นตัวเลขตั้งแต่ 0 ขึ้นไป เช่น 40 หรือ 40.50' : 'Enter a shipping fee of 0 or more, such as 40 or 40.50.'}</span>}</label>
                  <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={settingsDraft.shippingEnabled} onChange={(event) => setSettingsDraft((current) => current && ({ ...current, shippingEnabled: event.target.checked }))} />{t('campaignShipping')}</label>
                  <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={settingsDraft.pickupEnabled} onChange={(event) => setSettingsDraft((current) => current && ({ ...current, pickupEnabled: event.target.checked }))} />{t('campaignPickup')}</label>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => void saveCampaignSettings()} disabled={saving || !settingsDirty || !settingsValid} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-pink-600 px-4 text-sm font-black text-white disabled:opacity-40"><Save size={16} />{t('campaignSaveChanges')}</button>
                  {settingsDirty && <span className="text-xs font-bold text-amber-700">{t(settingsValid ? 'campaignUnsavedChanges' : 'campaignInvalidSettings')}</span>}
                </div>
              </>}
              {campaign.publication_status === 'draft' && <button onClick={() => void publish()} disabled={saving || settingsDirty} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-pink-600 px-4 text-sm font-black text-white disabled:opacity-40"><Save size={16} />{t('campaignPublish')}</button>}
              {campaign.publication_status === 'draft' && settingsDirty && <p className="mt-2 text-xs font-bold text-amber-700">{t('campaignSaveBeforePublish')}</p>}
              {campaign.publication_status === 'published' && <button onClick={() => window.confirm(t('campaignCancelConfirm')) && void updateCampaign({ publication_status: 'cancelled' })} disabled={saving} className="mt-4 min-h-11 rounded-xl border border-red-200 px-4 text-sm font-black text-red-700">{t('campaignCancel')}</button>}
              {campaign.publication_status !== 'archived' && <button onClick={() => window.confirm(t('campaignArchiveConfirm')) && void updateCampaign({ publication_status: 'archived' })} disabled={saving} className="ml-2 mt-4 min-h-11 rounded-xl border border-gray-200 px-4 text-sm font-black text-gray-600">{t('campaignArchive')}</button>}
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-black">{t('campaignPickupPoints')} <span className="text-pink-700">({workspace.pickup_points.length})</span></h2>
                {!addingPickup && !editingPickup && <button type="button" onClick={() => setAddingPickup(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-pink-600 px-4 text-sm font-black text-white"><Plus size={16} />{t('campaignAddPickupPoint')}</button>}
              </div>
              <div className="mt-3 space-y-2">
                {workspace.pickup_points.map((point) => (
                  <article key={point.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <div className="min-w-0">
                      <h3 className="font-black text-gray-950">{point.name}</h3>
                      {point.address && <p className="text-sm font-semibold text-gray-600">{point.address}</p>}
                      <p className="mt-1 text-xs font-semibold text-gray-500">{language === 'th' ? 'นัดรับสินค้า: ' : 'Pickup appointment: '}{new Date(point.starts_at).toLocaleString(dateLocale, { timeZoneName: 'short' })} – {new Date(point.ends_at).toLocaleString(dateLocale, { timeZoneName: 'short' })}</p>
                      {point.instructions && <p className="mt-1 text-xs font-medium text-gray-500">{point.instructions}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={saving || addingPickup || Boolean(editingPickup)} aria-label={`${language === 'th' ? 'แก้ไขจุดรับสินค้า' : 'Edit pickup point'} ${point.name}`} onClick={() => setEditingPickup(point)} className="min-h-11 rounded-xl border border-pink-200 bg-white px-3 text-xs font-black text-pink-700 disabled:opacity-50">{language === 'th' ? 'แก้ไข' : 'Edit'}</button>
                      <button type="button" disabled={saving || Boolean(editingPickup)} aria-label={t('campaignRemovePickupPoint', { name: point.name })} onClick={() => setRemoveTarget({ kind: 'pickup', id: point.id, name: point.name })} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-red-200 px-3 text-xs font-black text-red-700 disabled:opacity-50"><X size={15} />{t('campaignRemove')}</button>
                    </div>
                  </article>
                ))}
              </div>
              {(addingPickup || editingPickup) && (
                <form key={editingPickup?.id || 'new-pickup'} onSubmit={addPickupPoint} className="mt-4 rounded-xl border border-pink-100 bg-pink-50/40 p-3">
                  <h3 className="font-black">{editingPickup ? (language === 'th' ? 'แก้ไขจุดรับสินค้า' : 'Edit pickup point') : t('campaignAddPickupPoint')}</h3>
                  {editingPickup && <p className="mt-2 text-sm text-gray-600">{language === 'th' ? 'ออเดอร์ที่สั่งไปแล้วเก็บข้อมูลจุดรับเดิมไว้ กรุณาติดต่อลูกค้าหากนัดหมายเปลี่ยน' : 'Existing orders keep their original pickup details. Contact customers if the appointment changes.'}</p>}
                  <p className="mt-2 text-sm text-gray-600">{language === 'th' ? 'ช่วงเวลาที่ลูกค้าต้องไปรับสินค้า ลูกค้าเลือกจุดรับล่วงหน้าได้ ไม่ต้องรอถึงเวลานัดรับ' : 'When customers should collect their items. They can choose this point in advance without waiting for the appointment.'}</p>
                  <p className="mt-1 text-xs text-gray-500">{language === 'th' ? 'เวลาตามอุปกรณ์นี้' : 'Time zone on this device'}: {getBrowserTimeZone()}</p>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <input name="name" defaultValue={editingPickup?.name || ''} required placeholder={t('campaignPickupName')} className="min-h-11 rounded-xl border border-gray-200 px-3" />
                    <input name="address" defaultValue={editingPickup?.address || ''} aria-label={t('campaignPickupAddress')} placeholder={`${t('campaignPickupAddress')} (${language === 'th' ? 'ไม่บังคับ' : 'optional'})`} className="min-h-11 rounded-xl border border-gray-200 px-3" />
                    <label className="text-xs font-bold">{language === 'th' ? 'เริ่มนัดรับสินค้าวันที่ / เวลา' : 'Pickup appointment starts'}<input name="starts_at" defaultValue={editingPickup ? localDateTime(editingPickup.starts_at) : ''} step="1" required type="datetime-local" className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3" /></label>
                    <label className="text-xs font-bold">{language === 'th' ? 'รับสินค้าได้ถึงวันที่ / เวลา' : 'Pickup appointment ends'}<input name="ends_at" defaultValue={editingPickup ? localDateTime(editingPickup.ends_at) : ''} step="1" required type="datetime-local" className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3" /></label>
                    <input name="instructions" defaultValue={editingPickup?.instructions || ''} placeholder={t('campaignPickupInstructions')} className="min-h-11 rounded-xl border border-gray-200 px-3 md:col-span-2" />
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button disabled={saving} className="min-h-11 rounded-xl bg-pink-600 px-4 text-sm font-black text-white disabled:opacity-50">{t('campaignSavePickupPoint')}</button>
                    <button type="button" disabled={saving} onClick={() => { setAddingPickup(false); setEditingPickup(null); }} className="min-h-11 rounded-xl border border-gray-200 bg-white px-4 text-sm font-black text-gray-600">{t('commonCancel')}</button>
                  </div>
                </form>
              )}
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-black">{t('campaignPaymentMethods')} <span className="text-pink-700">({workspace.payment_methods.length})</span></h2>
                {!addingPayment && !editingPayment && !editingPaymentBanks && <button type="button" onClick={() => { setPaymentQrUrl(''); setPaymentBankAccounts([createEmptyBankAccount()]); setAddingPayment(true); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-pink-600 px-4 text-sm font-black text-white"><Plus size={16} />{t('campaignAddPaymentMethod')}</button>}
              </div>
              <div className="mt-3 space-y-2">
                {workspace.payment_methods.map((method, index) => {
                  const methodName = language === 'th' ? `ช่องทางชำระเงิน ${index + 1}` : `Payment method ${index + 1}`;
                  const bankAccounts = getPaymentBankAccounts(method);
                  const isEditingBanks = editingPaymentBanks?.methodId === method.id;
                  return (
                  <article data-testid="campaign-payment-method" key={method.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <div className="min-w-0">
                      <h3 className="font-black text-gray-950">{methodName}</h3>
                      {method.promptpay_id && <p className="text-sm font-semibold text-gray-600">{uiText(language, 'PromptPay')}: {maskPaymentId(method.promptpay_id)}</p>}
                      {bankAccounts.map((account, bankIndex) => (
                        <div key={`${account.bank_name}-${account.account_number}-${bankIndex}`} className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-2" aria-label={`${language === 'th' ? 'บัญชีธนาคาร' : 'Bank account'} ${bankIndex + 1}`}>
                          <p className="text-sm font-semibold text-gray-700">{[account.bank_name, account.account_number ? maskPaymentId(account.account_number) : null].filter(Boolean).join(' · ')}</p>
                          {account.account_name && <p className="text-xs font-semibold text-gray-500">{account.account_name}</p>}
                        </div>
                      ))}
                      {method.qr_image_url && <img src={method.qr_image_url} alt={`${methodName} QR`} className="mt-2 h-24 w-24 rounded-xl border border-gray-200 bg-white object-contain" />}
                      {method.instructions && <p className="mt-1 text-xs font-medium text-gray-500">{method.instructions}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!editingPaymentBanks && <button type="button" disabled={saving || addingPayment || Boolean(editingPayment)} aria-label={`${language === 'th' ? 'แก้ไข' : 'Edit'} ${methodName}`} onClick={() => { setEditingPayment(method); setPaymentQrUrl(method.qr_image_url || ''); setPaymentBankAccounts(bankAccounts.length ? bankAccounts : [createEmptyBankAccount()]); }} className="min-h-11 rounded-xl border border-pink-200 bg-white px-3 text-xs font-black text-pink-700 disabled:opacity-50">{language === 'th' ? 'แก้ไข' : 'Edit'}</button>}
                      {!editingPaymentBanks && !editingPayment && <button type="button" onClick={() => setEditingPaymentBanks({ methodId: method.id, accounts: [...bankAccounts, createEmptyBankAccount()] })} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-pink-200 bg-white px-3 text-xs font-black text-pink-700"><Plus size={15} />{language === 'th' ? 'เพิ่มบัญชีธนาคาร' : 'Add bank account'}</button>}
                      <button type="button" disabled={saving || Boolean(editingPayment)} aria-label={t('campaignRemovePaymentMethod', { name: methodName })} onClick={() => setRemoveTarget({ kind: 'payment', id: method.id, name: methodName })} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-red-200 px-3 text-xs font-black text-red-700 disabled:opacity-50"><X size={15} />{t('campaignRemove')}</button>
                    </div>
                    {isEditingBanks && (
                      <div className="w-full rounded-xl border border-pink-100 bg-pink-50/40 p-3">
                        <PaymentBankAccountsEditor accounts={editingPaymentBanks.accounts} onChange={(accounts) => setEditingPaymentBanks({ methodId: method.id, accounts })} disabled={saving} />
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" disabled={saving} onClick={() => void savePaymentBankAccounts()} className="min-h-11 rounded-xl bg-pink-600 px-4 text-sm font-black text-white disabled:opacity-50">{language === 'th' ? 'บันทึกบัญชีธนาคาร' : 'Save bank accounts'}</button>
                          <button type="button" disabled={saving} onClick={() => setEditingPaymentBanks(null)} className="min-h-11 rounded-xl border border-gray-200 bg-white px-4 text-sm font-black text-gray-600 disabled:opacity-50">{t('commonCancel')}</button>
                        </div>
                      </div>
                    )}
                  </article>
                  );
                })}
              </div>
              {(addingPayment || editingPayment) && (
                <form key={editingPayment?.id || 'new-payment'} data-testid="campaign-payment-form" onSubmit={addPaymentMethod} className="mt-4 rounded-xl border border-pink-100 bg-pink-50/40 p-3">
                  <h3 className="font-black">{editingPayment ? (language === 'th' ? 'แก้ไขช่องทางชำระเงิน' : 'Edit payment method') : t('campaignAddPaymentMethod')}</h3>
                  {editingPayment && <p className="mt-2 text-sm text-gray-600">{language === 'th' ? 'ข้อมูลใหม่อาจแสดงในออเดอร์ที่กำลังรอชำระเงิน กรุณาตรวจสอบก่อนบันทึก' : 'Updated details may be shown on orders awaiting payment. Check them before saving.'}</p>}
                  <p className="mt-1 text-sm font-medium text-gray-600">{language === 'th' ? 'หนึ่งช่องทางคือผู้รับเงินหนึ่งคน ใส่พร้อมเพย์ รูป QR และบัญชีธนาคารหลายบัญชีของผู้รับคนนี้ได้ หากเป็นผู้รับคนอื่นให้สร้างช่องทางชำระเงินใหม่' : 'One payment method is one recipient. Add this recipient’s PromptPay, QR image, and bank accounts here. Create another payment method for another recipient.'}</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="grid gap-1 text-xs font-bold text-gray-700 md:col-span-2">
                      {t('campaignPromptPayId')}
                      <input data-testid="payment-promptpay-id" name="promptpay_id" defaultValue={editingPayment?.promptpay_id || ''} placeholder={t('campaignPromptPayId')} inputMode="numeric" className="min-h-11 rounded-xl border border-gray-200 px-3 text-sm font-semibold" />
                    </label>
                    <div className="md:col-span-2"><PaymentBankAccountsEditor accounts={paymentBankAccounts} onChange={setPaymentBankAccounts} disabled={saving || paymentQrUploading} /></div>
                    <div className="grid gap-2 md:col-span-2">
                      <span className="text-xs font-bold text-gray-700">{language === 'th' ? 'รูป QR ชำระเงิน' : 'Payment QR image'}</span>
                      {paymentQrUrl ? (
                        <div className="flex flex-wrap items-center gap-3">
                          <img src={paymentQrUrl} alt={language === 'th' ? 'ตัวอย่าง QR ชำระเงิน' : 'Payment QR preview'} className="h-28 w-28 rounded-xl border border-gray-200 bg-white object-contain" />
                          <div className="flex flex-wrap gap-2">
                            <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-pink-200 bg-white px-4 text-sm font-black text-pink-700">
                              {paymentQrUploading ? (language === 'th' ? 'กำลังอัปโหลด…' : 'Uploading…') : (language === 'th' ? 'เปลี่ยนรูป' : 'Replace image')}
                              <input data-testid="payment-qr-input" type="file" accept="image/*,.heic,.heif" className="sr-only" disabled={paymentQrUploading || saving} onChange={(event) => { void uploadPaymentQr(event.target.files?.[0] || null); event.target.value = ''; }} />
                            </label>
                            <button type="button" disabled={paymentQrUploading || saving} onClick={() => setPaymentQrUrl('')} className="min-h-11 rounded-xl border border-gray-200 bg-white px-4 text-sm font-bold text-gray-600 disabled:opacity-50">{t('campaignRemove')}</button>
                          </div>
                        </div>
                      ) : (
                        <label className="flex min-h-14 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-pink-200 bg-white px-3 text-sm font-bold text-pink-700">
                          {paymentQrUploading ? (language === 'th' ? 'กำลังอัปโหลด…' : 'Uploading…') : (language === 'th' ? 'อัปโหลดรูป QR พร้อมเพย์ / โอนเงิน' : 'Upload PromptPay / transfer QR image')}
                          <input data-testid="payment-qr-input" type="file" accept="image/*,.heic,.heif" className="sr-only" disabled={paymentQrUploading || saving} onChange={(event) => { void uploadPaymentQr(event.target.files?.[0] || null); event.target.value = ''; }} />
                        </label>
                      )}
                    </div>
                    <label className="grid gap-1 text-xs font-bold text-gray-700 md:col-span-2">
                      {t('campaignPaymentInstructions')}
                      <textarea data-testid="payment-instructions" name="instructions" defaultValue={editingPayment?.instructions || ''} rows={3} placeholder={language === 'th' ? 'เช่น โอนยอดให้ตรง อัปโหลดสลิป แล้วรอร้านยืนยัน' : 'Example: Transfer the exact amount, upload the slip, then wait for confirmation.'} className="rounded-xl border border-gray-200 px-3 py-3 text-sm font-semibold" />
                    </label>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button disabled={saving || paymentQrUploading} className="min-h-11 rounded-xl bg-pink-600 px-4 text-sm font-black text-white disabled:opacity-50">{t('campaignSavePaymentMethod')}</button>
                    <button type="button" disabled={paymentQrUploading || saving} onClick={() => { setPaymentQrUrl(''); setPaymentBankAccounts([createEmptyBankAccount()]); setAddingPayment(false); setEditingPayment(null); }} className="min-h-11 rounded-xl border border-gray-200 bg-white px-4 text-sm font-black text-gray-600 disabled:opacity-50">{t('commonCancel')}</button>
                  </div>
                </form>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
