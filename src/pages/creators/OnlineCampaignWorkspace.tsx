import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ExternalLink, Eye, ImageOff, Loader2, PackageCheck, Plus, Save, Search, Settings, ShoppingBag, X } from 'lucide-react';
import AdminHeader from '../../components/AdminHeader';
import { ConfirmDialog, Toast } from '../../components/ui/Feedback';
import { useI18n } from '../../i18n';
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
import { createPaymentEvidenceSignedUrl } from '../../lib/preorders';
import { fetchProductStockSummaries, type ProductStockSummary } from '../../lib/stockAdjustments';
import { supabase } from '../../supabaseClient';
import type { ActorContext } from '../../types/access';
import type { CampaignOrder, CampaignWorkspace } from '../../types/onlineCampaign';
import { fetchActorContext } from '../../utils/access';
import { formatPrice } from '../../utils/currency';
import { getMenuImageUrl } from '../../utils/imageUtils';

type Tab = 'overview' | 'products' | 'orders' | 'settings';
type ProductMembership = 'all' | 'included' | 'not_added';
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

export default function OnlineCampaignWorkspace() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { t, dateLocale } = useI18n();
  const [actor, setActor] = useState<ActorContext | null>(null);
  const [artistSlug, setArtistSlug] = useState('');
  const [workspace, setWorkspace] = useState<CampaignWorkspace | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [orderFilter, setOrderFilter] = useState('needs_action');
  const [search, setSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [productCategory, setProductCategory] = useState('all');
  const [productMembership, setProductMembership] = useState<ProductMembership>('all');
  const [productSort, setProductSort] = useState<'name_asc' | 'name_desc'>('name_asc');
  const [productPage, setProductPage] = useState(1);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [evidencePreview, setEvidencePreview] = useState<{ order: CampaignOrder; url: string } | null>(null);
  const [evidenceLoadingId, setEvidenceLoadingId] = useState<string | null>(null);
  const [stockSummaries, setStockSummaries] = useState<Record<string, ProductStockSummary>>({});
  const [toast, setToast] = useState<{ tone?: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string } | null>(null);
  const [addingPickup, setAddingPickup] = useState(false);
  const [addingPayment, setAddingPayment] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ kind: 'pickup' | 'payment'; id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<CampaignSettingsDraft | null>(null);
  const evidenceCloseRef = useRef<HTMLButtonElement | null>(null);
  const canManage = actor?.role === 'owner' || actor?.role === 'manager';

  const load = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    try {
      const [context, data] = await Promise.all([fetchActorContext(), getCampaignWorkspace(campaignId)]);
      const [summaries, { data: artist }] = await Promise.all([
        context?.role === 'owner' || context?.role === 'manager'
          ? fetchProductStockSummaries(data.campaign.artist_id)
          : Promise.resolve([]),
        supabase.from('artists').select('slug').eq('id', data.campaign.artist_id).maybeSingle(),
      ]);
      setActor(context);
      setArtistSlug(artist?.slug || '');
      setWorkspace(data);
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

  useEffect(() => {
    if (!evidencePreview) return;
    evidenceCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEvidencePreview(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [evidencePreview]);

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
        || (orderFilter === 'payment' && ['payment_submitted', 'payment_submitted_late', 'refund_pending'].includes(order.payment_status))
        || (orderFilter === 'shipping' && order.fulfillment_status === 'awaiting_shipment')
        || (orderFilter === 'pickup' && order.fulfillment_status === 'awaiting_pickup')
        || (orderFilter === 'cancelled' && (order.status === 'cancelled' || ['payment_expired', 'payment_cancelled', 'payment_rejected', 'refunded'].includes(order.payment_status)))
        || order.payment_status === orderFilter
        || order.fulfillment_status === orderFilter
        || order.status === orderFilter;
      if (!matchesFilter) return false;
      if (!query) return true;
      return [order.order_code, order.customer_name, order.customer_email, order.customer_phone]
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

  const updateAllocation = async (productId: string, stockTotal: number | null, priceOverride: number | null) => {
    if (!campaignId || !workspace) return;
    const current = workspace.products.find((item) => item.product_id === productId);
    if (!current) return;
    setSaving(true);
    try {
      await saveCampaignProducts(campaignId, [{
        product_id: productId,
        is_enabled: true,
        is_unlimited: current.is_unlimited,
        stock_total: current.is_unlimited ? null : stockTotal,
        price_override: priceOverride,
      }]);
      await load();
    } catch (error) {
      console.error(error);
      setFeedback(error instanceof Error && error.message === 'campaign_stock_exceeds_catalog_stock' ? t('campaignStockExceeded') : t('campaignSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const updateOrderLimit = async (productId: string, maxQuantityPerOrder: number | null) => {
    if (!campaignId) return;
    setSaving(true);
    setFeedback('');
    const { error } = await supabase
      .from('online_campaign_products')
      .update({ max_quantity_per_order: maxQuantityPerOrder })
      .eq('campaign_id', campaignId)
      .eq('product_id', productId);
    if (error) {
      console.error(error);
      setFeedback(t('campaignSaveFailed'));
    } else {
      await load();
      setFeedback(t('campaignSaved'));
    }
    setSaving(false);
  };

  const handleOrderLimitBlur = (
    event: React.FocusEvent<HTMLInputElement>,
    productId: string,
    currentLimit: number | null,
  ) => {
    const rawValue = event.currentTarget.value.trim();
    const nextLimit = rawValue === '' ? null : Number(rawValue);
    if (nextLimit !== null && (!Number.isInteger(nextLimit) || nextLimit <= 0)) {
      event.currentTarget.value = currentLimit === null ? '' : String(currentLimit);
      setFeedback(t('campaignInvalidOrderLimit'));
      return;
    }
    if (nextLimit !== currentLimit) void updateOrderLimit(productId, nextLimit);
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
    if (!workspace) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get('name') || '').trim();
    const address = String(form.get('address') || '').trim();
    const startsAt = new Date(String(form.get('starts_at'))).toISOString();
    const endsAt = new Date(String(form.get('ends_at'))).toISOString();
    const duplicate = workspace.pickup_points.some((point) =>
      normalizeSetting(point.name) === normalizeSetting(name)
      && normalizeSetting(point.address) === normalizeSetting(address)
      && new Date(point.starts_at).getTime() === new Date(startsAt).getTime()
      && new Date(point.ends_at).getTime() === new Date(endsAt).getTime()
    );
    if (duplicate) {
      setToast({ tone: 'warning', title: t('campaignDuplicateSetting') });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('campaign_pickup_points').insert({
      campaign_id: workspace.campaign.id,
      artist_id: workspace.campaign.artist_id,
      name,
      address,
      starts_at: startsAt,
      ends_at: endsAt,
      instructions: String(form.get('instructions') || '').trim(),
    });
    if (error) setToast({ tone: 'error', title: t('campaignSaveFailed') });
    else {
      formElement.reset();
      setAddingPickup(false);
      await load();
      setToast({ tone: 'success', title: t('campaignPickupAdded'), detail: name });
    }
    setSaving(false);
  };

  const addPaymentMethod = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!workspace) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const displayName = String(form.get('display_name') || 'PromptPay').trim() || 'PromptPay';
    const promptPayId = String(form.get('promptpay_id') || '').trim();
    const duplicate = workspace.payment_methods.some((method) =>
      normalizeSetting(method.display_name || 'PromptPay') === normalizeSetting(displayName)
      && normalizeSetting(method.promptpay_id) === normalizeSetting(promptPayId)
    );
    if (duplicate) {
      setToast({ tone: 'warning', title: t('campaignDuplicateSetting') });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('campaign_payment_methods').insert({
      campaign_id: workspace.campaign.id,
      artist_id: workspace.campaign.artist_id,
      method_type: 'promptpay',
      display_name: displayName,
      promptpay_id: promptPayId,
      instructions: String(form.get('instructions') || '').trim(),
    });
    if (error) setToast({ tone: 'error', title: t('campaignSaveFailed') });
    else {
      formElement.reset();
      setAddingPayment(false);
      await load();
      setToast({ tone: 'success', title: t('campaignPaymentAdded'), detail: displayName });
    }
    setSaving(false);
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
    try {
      let notificationEvent: 'ready_for_pickup' | 'shipped' | 'payment_rejected' | 'refund_required' | null = null;
      if (action === 'ship') {
        const carrier = window.prompt(t('campaignCarrierPrompt')) || '';
        const tracking = window.prompt(t('campaignTrackingPrompt')) || '';
        if (!tracking) return;
        await markCampaignOrderShipped(order.id, carrier, tracking);
        notificationEvent = 'shipped';
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
        if ((action === 'confirm_online_payment' || action === 'accept_late_online_payment') && order.fulfillment_method === 'pickup') notificationEvent = 'ready_for_pickup';
        if (action === 'reject_online_payment') notificationEvent = 'payment_rejected';
        if (action === 'mark_online_refund_required') notificationEvent = 'refund_required';
      }
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
    }
  };

  const openEvidence = async (order: CampaignOrder) => {
    if (!order.slip_url) return;
    const path = order.slip_url;
    setEvidenceLoadingId(order.id);
    try {
      const url = signedUrls[path] || await createPaymentEvidenceSignedUrl(path);
      if (!signedUrls[path]) setSignedUrls((current) => ({ ...current, [path]: url }));
      setEvidencePreview({ order, url });
    } catch (error) {
      console.error(error);
      setFeedback(t('campaignEvidenceOpenFailed'));
    } finally {
      setEvidenceLoadingId(null);
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
  const settingsValid = Boolean(settingsDraft?.name.trim())
    && Number.isFinite(Number(settingsDraft?.flatShippingFee))
    && Number(settingsDraft?.flatShippingFee) >= 0
    && Boolean(settingsDraft?.shippingEnabled || settingsDraft?.pickupEnabled);
  const saveCampaignSettings = () => settingsDraft && updateCampaign({
    name: settingsDraft.name.trim(),
    flat_shipping_fee: Number(settingsDraft.flatShippingFee),
    shipping_enabled: settingsDraft.shippingEnabled,
    pickup_enabled: settingsDraft.pickupEnabled,
  });
  const storefrontUrl = '/' + artistSlug + '/campaign/' + campaign.slug;
  const actionCount = workspace.orders.filter((order) =>
    ['awaiting_shipment', 'awaiting_pickup'].includes(order.fulfillment_status)
    || (canManage && ['payment_submitted', 'payment_submitted_late', 'refund_pending'].includes(order.payment_status))
  ).length;

  return (
    <div className="min-h-screen bg-gray-50 text-slate-800">
      <Toast message={toast} onClose={() => setToast(null)} />
      {evidencePreview && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-gray-950/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={t('campaignEvidencePreview')}
          onClick={(event) => { if (event.target === event.currentTarget) setEvidencePreview(null); }}
        >
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-black text-gray-950">{t('campaignEvidencePreview')}</div>
                <div className="truncate text-xs font-bold text-gray-500">{evidencePreview.order.order_code} · {evidencePreview.order.customer_name}</div>
                <div className="mt-1 text-base font-black text-gray-950">{t('campaignExpectedAmount')}: {formatPrice(evidencePreview.order.total_price, evidencePreview.order.currency)}</div>
              </div>
              <button ref={evidenceCloseRef} type="button" onClick={() => setEvidencePreview(null)} aria-label={t('campaignCloseEvidence')} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50"><X size={18} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-gray-100 p-4">
              <img src={evidencePreview.url} alt={`${t('campaignEvidencePreview')} ${evidencePreview.order.order_code}`} className="mx-auto max-h-[72vh] max-w-full rounded-xl bg-white object-contain shadow-sm" />
            </div>
          </div>
        </div>
      )}
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
          {((canManage ? ['overview', 'products', 'orders', 'settings'] : ['overview', 'orders']) as Tab[]).map((item) => (
            <button key={item} onClick={() => setTab(item)} className={'min-h-11 flex-1 rounded-xl px-4 text-sm font-black ' + (tab === item ? 'bg-pink-600 text-white' : 'text-gray-600 hover:bg-gray-50')}>
              {t(('campaignTab_' + item) as Parameters<typeof t>[0])}
              {item === 'orders' && actionCount > 0 && <span className="ml-1 rounded-full bg-white/20 px-1.5">{actionCount}</span>}
            </button>
          ))}
        </nav>

        {feedback && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">{feedback}</div>}

        {tab === 'overview' && (
          <div className="grid gap-4 md:grid-cols-3">
            <section className="rounded-2xl border border-gray-200 bg-white p-5">
              <ShoppingBag className="text-pink-600" />
              <div className="mt-3 text-2xl font-black">{workspace.products.filter((item) => item.is_enabled).length}</div>
              <div className="text-sm font-bold text-gray-500">{t('campaignProducts')}</div>
            </section>
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <PackageCheck className="text-amber-700" />
              <div className="mt-3 text-2xl font-black text-amber-950">{actionCount}</div>
              <div className="text-sm font-bold text-amber-700">{t('campaignNeedsAction')}</div>
            </section>
            <section className="rounded-2xl border border-gray-200 bg-white p-5">
              <div className="text-xs font-black uppercase text-gray-500">{t('campaignRevenue')}</div>
              <div className="mt-3 text-2xl font-black">{formatPrice(workspace.orders.filter((order) => order.payment_status === 'payment_confirmed').reduce((sum, order) => sum + Number(order.total_price), 0), campaign.currency)}</div>
            </section>
          </div>
        )}

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
              <div className="mt-2 text-xs font-bold text-gray-500">{t('campaignProductResults', { count: filteredCampaignCatalog.length })}</div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1160px] border-collapse text-left">
                  <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-3">{t('campaignProduct')}</th>
                      <th className="px-3 py-3">{t('catalogCategory')}</th>
                      <th className="px-3 py-3 text-center">{t('campaignOnHandStock')}</th>
                      <th className="px-3 py-3 text-center">{t('campaignAvailableStock')}</th>
                      <th className="px-3 py-3 text-center">{t('campaignCurrentStock')}</th>
                      <th className="px-3 py-3">{t('campaignPriceOverride')}</th>
                      <th className="px-3 py-3">{t('campaignMaxPerOrder')}</th>
                      <th className="px-3 py-3 text-right">{t('campaignAction')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pagedCampaignCatalog.map((product) => {
                      const productId = product.product_id || product.id || '';
                      const allocated = workspace.products.find((item) => item.product_id === productId);
                      const summary = getStockSummary(product);
                      const isIncluded = allocatedIds.has(productId);
                      const campaignStock = Number(allocated?.stock_total || 0);
                      const maxCampaignStock = campaignStock + summary.available;
                      const committedElsewhere = Math.max(summary.on_hand - summary.available - campaignStock, 0);
                      return (
                        <tr key={productId} className={isIncluded ? 'bg-pink-50/50' : 'hover:bg-gray-50/70'}>
                          <td className="px-3 py-2">
                            <div className="flex min-w-[250px] items-center gap-3">
                              <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-gray-100 text-gray-300">
                                {product.image_url ? <img src={getMenuImageUrl(product.image_url, 160)} alt="" loading="lazy" className="h-full w-full object-cover" /> : <ImageOff size={19} />}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <div className="truncate text-sm font-black text-gray-950">{product.name}</div>
                                  {isIncluded && <span className="shrink-0 rounded-full bg-pink-100 px-2 py-0.5 text-[9px] font-black text-pink-700">{t('campaignIncluded')}</span>}
                                </div>
                                <div className="mt-0.5 font-mono text-[10px] font-bold text-gray-400">{product.sku || '—'}</div>
                                {!product.is_unlimited && committedElsewhere > 0 && <div className="mt-0.5 text-[10px] font-bold text-slate-500">{t('campaignStockElsewhere', { count: committedElsewhere })}</div>}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs font-bold text-gray-600">{product.category || '—'}</td>
                          {product.is_unlimited ? (
                            <td colSpan={3} className="px-3 py-2 text-center text-xs font-black text-gray-600">{t('catalogUnlimited')}</td>
                          ) : (
                            <>
                              <td className="px-3 py-2 text-center text-sm font-black text-gray-900">{summary.on_hand}</td>
                              <td className="px-3 py-2 text-center text-sm font-black text-emerald-700">{summary.available}</td>
                              <td className="px-3 py-2 text-center">
                                {allocated && isIncluded ? (
                                  <input key={`stock-${allocated.stock_total}`} aria-label={`${t('campaignAllocatedStock')} ${product.name}`} type="number" min={Number(allocated.stock_reserved || 0) + Number(allocated.stock_sold || 0)} max={maxCampaignStock} defaultValue={campaignStock} onBlur={(event) => void updateAllocation(productId, Number(event.target.value), allocated.price_override ?? null)} className="h-11 w-24 rounded-xl border border-gray-200 px-3 text-center text-sm font-black" />
                                ) : <span className="text-sm font-black text-pink-700">0</span>}
                              </td>
                            </>
                          )}
                          <td className="px-3 py-2">
                            {allocated && isIncluded ? (
                              <input key={`price-${allocated.price_override}`} aria-label={`${t('campaignPriceOverride')} ${product.name}`} type="number" min="0" placeholder={String(product.price)} defaultValue={allocated.price_override ?? ''} onBlur={(event) => void updateAllocation(productId, allocated.stock_total ?? null, event.target.value === '' ? null : Number(event.target.value))} className="h-11 w-28 rounded-xl border border-gray-200 px-3 text-sm font-bold" />
                            ) : <span className="text-sm font-black text-pink-700">{formatPrice(product.price, campaign.currency)}</span>}
                          </td>
                          <td className="px-3 py-2">
                            {allocated && isIncluded ? (
                              <input
                                key={`limit-${allocated.max_quantity_per_order ?? 'unlimited'}`}
                                aria-label={`${t('campaignMaxPerOrder')} ${product.name}`}
                                type="number"
                                min="1"
                                step="1"
                                placeholder={t('campaignMaxPerOrderPlaceholder')}
                                defaultValue={allocated.max_quantity_per_order ?? ''}
                                onBlur={(event) => handleOrderLimitBlur(event, productId, allocated.max_quantity_per_order ?? null)}
                                className="h-11 w-28 rounded-xl border border-gray-200 px-3 text-sm font-bold"
                              />
                            ) : <span className="text-xs font-bold text-gray-400">—</span>}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {isIncluded ? (
                              <button type="button" disabled={saving} onClick={() => void toggleProduct(productId, false)} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-gray-200 px-3 text-xs font-black text-gray-600 hover:border-red-200 hover:text-red-700 disabled:opacity-50"><X size={14} />{t('campaignRemoveProduct')}</button>
                            ) : (
                              <div>
                                <button type="button" disabled={saving} onClick={() => void toggleProduct(productId, true)} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-pink-200 px-3 text-xs font-black text-pink-700 hover:bg-pink-50 disabled:opacity-50"><Plus size={14} />{t('campaignAddProduct')}</button>
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
          <section>
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              <select value={orderFilter} onChange={(event) => setOrderFilter(event.target.value)} className="min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold">
                <option value="needs_action">{t('campaignNeedsAction')}</option>
                <option value="payment">{t('campaignPaymentIssues')}</option>
                <option value="shipping">{t('campaignAwaitingShipment')}</option>
                <option value="pickup">{t('campaignAwaitingPickup')}</option>
                <option value="awaiting_payment">{t('campaignOrderAwaitingPayment')}</option>
                <option value="completed">{t('campaignCompleted')}</option>
                <option value="cancelled">{t('campaignCancelledExpiredRefunded')}</option>
                <option value="all">{t('campaignAllOrders')}</option>
              </select>
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('campaignSearchOrders')} className="min-h-11 rounded-xl border border-gray-200 bg-white px-3" />
            </div>
            <div className="space-y-3">
              {filteredOrders.length === 0 && <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-6 text-center text-sm font-bold text-gray-400">{t('campaignNoOrders')}</div>}
              {filteredOrders.map((order) => (
                <article key={order.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-sm font-black">{order.order_code}</div>
                      <div className="text-sm font-bold text-gray-700">{order.customer_name} · {order.fulfillment_method}</div>
                      <div className="text-xs font-semibold text-gray-500">{order.items.map((item) => item.name + ' ×' + item.quantity).join(', ')}</div>
                    </div>
                    <div className="text-right"><div className="font-black">{formatPrice(order.total_price, order.currency)}</div><div className="text-xs font-bold text-gray-500">{order.payment_status} · {order.fulfillment_status}</div></div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {canManage && order.slip_url && <button disabled={evidenceLoadingId === order.id} onClick={() => void openEvidence(order)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 px-4 text-xs font-black text-gray-700 disabled:opacity-50">{evidenceLoadingId === order.id ? <Loader2 className="animate-spin" size={15} /> : <Eye size={15} />}{t('campaignViewEvidence')}</button>}
                    {canManage && order.payment_status === 'payment_submitted' && <><button onClick={() => void actOnOrder(order, 'confirm_online_payment')} className="min-h-11 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white">{t('campaignConfirmPayment')}</button><button onClick={() => void actOnOrder(order, 'reject_online_payment')} className="min-h-11 rounded-xl border border-red-200 px-4 text-xs font-black text-red-700">{t('campaignRejectPayment')}</button></>}
                    {canManage && order.payment_status === 'payment_submitted_late' && <><button onClick={() => void actOnOrder(order, 'accept_late_online_payment')} className="min-h-11 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white">{t('campaignAcceptLate')}</button><button onClick={() => void actOnOrder(order, 'mark_online_refund_required')} className="min-h-11 rounded-xl border border-amber-300 px-4 text-xs font-black text-amber-800">{t('campaignRefundRequired')}</button></>}
                    {canManage && order.payment_status === 'refund_pending' && <button onClick={() => void actOnOrder(order, 'refunded')} className="min-h-11 rounded-xl bg-blue-600 px-4 text-xs font-black text-white">{t('campaignMarkRefunded')}</button>}
                    {order.fulfillment_status === 'awaiting_shipment' && <button onClick={() => void actOnOrder(order, 'ship')} className="min-h-11 rounded-xl bg-blue-600 px-4 text-xs font-black text-white">{t('campaignMarkShipped')}</button>}
                    {order.fulfillment_status === 'awaiting_pickup' && <button onClick={() => void actOnOrder(order, 'pickup')} className="min-h-11 rounded-xl bg-blue-600 px-4 text-xs font-black text-white">{t('campaignMarkPickedUp')}</button>}
                  </div>
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
                  <label><span className="text-xs font-black">{t('campaignShippingFee')}</span><input aria-label={t('campaignShippingFee')} type="number" min="0" value={settingsDraft.flatShippingFee} onChange={(event) => setSettingsDraft((current) => current && ({ ...current, flatShippingFee: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3" /></label>
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
                {!addingPickup && <button type="button" onClick={() => setAddingPickup(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-pink-600 px-4 text-sm font-black text-white"><Plus size={16} />{t('campaignAddPickupPoint')}</button>}
              </div>
              <div className="mt-3 space-y-2">
                {workspace.pickup_points.map((point) => (
                  <article key={point.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <div className="min-w-0">
                      <h3 className="font-black text-gray-950">{point.name}</h3>
                      <p className="text-sm font-semibold text-gray-600">{point.address}</p>
                      <p className="mt-1 text-xs font-semibold text-gray-500">{new Date(point.starts_at).toLocaleString(dateLocale)} – {new Date(point.ends_at).toLocaleString(dateLocale)}</p>
                      {point.instructions && <p className="mt-1 text-xs font-medium text-gray-500">{point.instructions}</p>}
                    </div>
                    <button type="button" aria-label={t('campaignRemovePickupPoint', { name: point.name })} onClick={() => setRemoveTarget({ kind: 'pickup', id: point.id, name: point.name })} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-red-200 px-3 text-xs font-black text-red-700"><X size={15} />{t('campaignRemove')}</button>
                  </article>
                ))}
              </div>
              {addingPickup && (
                <form onSubmit={addPickupPoint} className="mt-4 rounded-xl border border-pink-100 bg-pink-50/40 p-3">
                  <h3 className="font-black">{t('campaignAddPickupPoint')}</h3>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <input name="name" required placeholder={t('campaignPickupName')} className="min-h-11 rounded-xl border border-gray-200 px-3" />
                    <input name="address" required placeholder={t('campaignPickupAddress')} className="min-h-11 rounded-xl border border-gray-200 px-3" />
                    <input name="starts_at" required type="datetime-local" className="min-h-11 rounded-xl border border-gray-200 px-3" />
                    <input name="ends_at" required type="datetime-local" className="min-h-11 rounded-xl border border-gray-200 px-3" />
                    <input name="instructions" placeholder={t('campaignPickupInstructions')} className="min-h-11 rounded-xl border border-gray-200 px-3 md:col-span-2" />
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button disabled={saving} className="min-h-11 rounded-xl bg-pink-600 px-4 text-sm font-black text-white disabled:opacity-50">{t('campaignSavePickupPoint')}</button>
                    <button type="button" onClick={() => setAddingPickup(false)} className="min-h-11 rounded-xl border border-gray-200 bg-white px-4 text-sm font-black text-gray-600">{t('commonCancel')}</button>
                  </div>
                </form>
              )}
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-black">{t('campaignPaymentMethods')} <span className="text-pink-700">({workspace.payment_methods.length})</span></h2>
                {!addingPayment && <button type="button" onClick={() => setAddingPayment(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-pink-600 px-4 text-sm font-black text-white"><Plus size={16} />{t('campaignAddPaymentMethod')}</button>}
              </div>
              <div className="mt-3 space-y-2">
                {workspace.payment_methods.map((method) => (
                  <article key={method.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <div className="min-w-0">
                      <h3 className="font-black text-gray-950">{method.display_name || 'PromptPay'}</h3>
                      <p className="text-sm font-semibold text-gray-600">{maskPaymentId(method.promptpay_id || method.account_number)}</p>
                      {method.instructions && <p className="mt-1 text-xs font-medium text-gray-500">{method.instructions}</p>}
                    </div>
                    <button type="button" aria-label={t('campaignRemovePaymentMethod', { name: method.display_name || 'PromptPay' })} onClick={() => setRemoveTarget({ kind: 'payment', id: method.id, name: method.display_name || 'PromptPay' })} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-red-200 px-3 text-xs font-black text-red-700"><X size={15} />{t('campaignRemove')}</button>
                  </article>
                ))}
              </div>
              {addingPayment && (
                <form onSubmit={addPaymentMethod} className="mt-4 rounded-xl border border-pink-100 bg-pink-50/40 p-3">
                  <h3 className="font-black">{t('campaignAddPaymentMethod')}</h3>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <input name="display_name" placeholder="PromptPay" className="min-h-11 rounded-xl border border-gray-200 px-3" />
                    <input name="promptpay_id" required placeholder={t('campaignPromptPayId')} className="min-h-11 rounded-xl border border-gray-200 px-3" />
                    <input name="instructions" placeholder={t('campaignPaymentInstructions')} className="min-h-11 rounded-xl border border-gray-200 px-3 md:col-span-2" />
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button disabled={saving} className="min-h-11 rounded-xl bg-pink-600 px-4 text-sm font-black text-white disabled:opacity-50">{t('campaignSavePaymentMethod')}</button>
                    <button type="button" onClick={() => setAddingPayment(false)} className="min-h-11 rounded-xl border border-gray-200 bg-white px-4 text-sm font-black text-gray-600">{t('commonCancel')}</button>
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
