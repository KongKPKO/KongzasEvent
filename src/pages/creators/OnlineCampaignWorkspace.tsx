import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ExternalLink, Eye, Loader2, PackageCheck, Save, Settings, ShoppingBag } from 'lucide-react';
import AdminHeader from '../../components/AdminHeader';
import { useI18n } from '../../i18n';
import {
  getCampaignWorkspace,
  markCampaignOrderRefunded,
  markCampaignOrderPickedUp,
  markCampaignOrderShipped,
  publishCampaign,
  runCampaignOrderAction,
  saveCampaignProducts,
} from '../../lib/onlineCampaigns';
import { createPaymentEvidenceSignedUrl } from '../../lib/preorders';
import { supabase } from '../../supabaseClient';
import type { ActorContext } from '../../types/access';
import type { CampaignOrder, CampaignWorkspace } from '../../types/onlineCampaign';
import { fetchActorContext } from '../../utils/access';
import { formatPrice } from '../../utils/currency';

type Tab = 'overview' | 'products' | 'orders' | 'settings';

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
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const canManage = actor?.role === 'owner' || actor?.role === 'manager';

  const load = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    try {
      const [context, data] = await Promise.all([fetchActorContext(), getCampaignWorkspace(campaignId)]);
      const { data: artist } = await supabase.from('artists').select('slug').eq('id', data.campaign.artist_id).maybeSingle();
      setActor(context);
      setArtistSlug(artist?.slug || '');
      setWorkspace(data);
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
    setSaving(true);
    setFeedback('');
    try {
      await saveCampaignProducts(campaignId, [{
        product_id: product.product_id || product.id || productId,
        is_enabled: checked,
        is_unlimited: current?.is_unlimited ?? product.is_unlimited,
        stock_total: current?.is_unlimited ? null : Number(current?.stock_total ?? product.stock_total ?? 0),
        price_override: current?.price_override ?? null,
      }]);
      await load();
    } catch (error) {
      console.error(error);
      setFeedback(t('campaignSaveFailed'));
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
      setFeedback(t('campaignSaveFailed'));
    } finally {
      setSaving(false);
    }
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
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.from('campaign_pickup_points').insert({
      campaign_id: workspace.campaign.id,
      artist_id: workspace.campaign.artist_id,
      name: String(form.get('name') || ''),
      address: String(form.get('address') || ''),
      starts_at: new Date(String(form.get('starts_at'))).toISOString(),
      ends_at: new Date(String(form.get('ends_at'))).toISOString(),
      instructions: String(form.get('instructions') || ''),
    });
    if (error) setFeedback(t('campaignSaveFailed'));
    else {
      event.currentTarget.reset();
      await load();
    }
  };

  const addPaymentMethod = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!workspace) return;
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.from('campaign_payment_methods').insert({
      campaign_id: workspace.campaign.id,
      artist_id: workspace.campaign.artist_id,
      method_type: 'promptpay',
      display_name: String(form.get('display_name') || 'PromptPay'),
      promptpay_id: String(form.get('promptpay_id') || ''),
      instructions: String(form.get('instructions') || ''),
    });
    if (error) setFeedback(t('campaignSaveFailed'));
    else {
      event.currentTarget.reset();
      await load();
    }
  };

  const actOnOrder = async (order: CampaignOrder, action: string) => {
    try {
      if (action === 'ship') {
        const carrier = window.prompt(t('campaignCarrierPrompt')) || '';
        const tracking = window.prompt(t('campaignTrackingPrompt')) || '';
        if (!tracking) return;
        await markCampaignOrderShipped(order.id, carrier, tracking);
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
      }
      await load();
    } catch (error) {
      console.error(error);
      setFeedback(t('campaignOrderActionFailed'));
    }
  };

  const openEvidence = async (path: string) => {
    try {
      const url = signedUrls[path] || await createPaymentEvidenceSignedUrl(path);
      if (!signedUrls[path]) setSignedUrls((current) => ({ ...current, [path]: url }));
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error(error);
      setFeedback(t('campaignEvidenceOpenFailed'));
    }
  };

  if (loading) return <div className="grid min-h-screen place-items-center text-pink-600"><Loader2 className="animate-spin" /></div>;
  if (!workspace) return <div className="grid min-h-screen place-items-center text-gray-500">{t('campaignNotFound')}</div>;

  const campaign = workspace.campaign;
  const storefrontUrl = '/' + artistSlug + '/campaign/' + campaign.slug;
  const actionCount = workspace.orders.filter((order) =>
    ['awaiting_shipment', 'awaiting_pickup'].includes(order.fulfillment_status)
    || (canManage && ['payment_submitted', 'payment_submitted_late', 'refund_pending'].includes(order.payment_status))
  ).length;

  return (
    <div className="min-h-screen bg-gray-50 text-slate-800">
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
          <section className="space-y-3">
            {workspace.catalog.map((product) => {
              const allocated = workspace.products.find((item) => item.product_id === (product.product_id || product.id));
              const productId = product.product_id || product.id || '';
              return (
                <div key={productId} className="rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex min-h-11 flex-1 items-center gap-3">
                      <input type="checkbox" checked={allocatedIds.has(productId)} disabled={saving} onChange={(event) => void toggleProduct(productId, event.target.checked)} />
                      <span><span className="block font-black text-gray-950">{product.name}</span><span className="text-xs font-semibold text-gray-500">{product.sku || '—'} · {formatPrice(product.price, campaign.currency)}</span></span>
                    </label>
                    {allocated && (
                      <>
                        {!allocated.is_unlimited && (
                          <input aria-label={t('campaignAllocatedStock')} type="number" min={Number(allocated.stock_reserved || 0) + Number(allocated.stock_sold || 0)} defaultValue={allocated.stock_total || 0} onBlur={(event) => void updateAllocation(productId, Number(event.target.value), allocated.price_override ?? null)} className="h-11 w-28 rounded-xl border border-gray-200 px-3" />
                        )}
                        <input aria-label={t('campaignPriceOverride')} type="number" min="0" placeholder={t('campaignPriceOverride')} defaultValue={allocated.price_override ?? ''} onBlur={(event) => void updateAllocation(productId, allocated.stock_total ?? null, event.target.value === '' ? null : Number(event.target.value))} className="h-11 w-32 rounded-xl border border-gray-200 px-3" />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
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
                    {canManage && order.slip_url && <button onClick={() => void openEvidence(order.slip_url as string)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 px-4 text-xs font-black text-gray-700"><Eye size={15} />{t('campaignViewEvidence')}</button>}
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
              <div className="grid gap-3 md:grid-cols-2">
                <label><span className="text-xs font-black">{t('campaignName')}</span><input defaultValue={campaign.name} onBlur={(event) => void updateCampaign({ name: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3" /></label>
                <label><span className="text-xs font-black">{t('campaignShippingFee')}</span><input type="number" min="0" defaultValue={campaign.flat_shipping_fee} onBlur={(event) => void updateCampaign({ flat_shipping_fee: Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3" /></label>
                <label className="flex min-h-11 items-center gap-2"><input type="checkbox" defaultChecked={campaign.shipping_enabled} onChange={(event) => void updateCampaign({ shipping_enabled: event.target.checked })} />{t('campaignShipping')}</label>
                <label className="flex min-h-11 items-center gap-2"><input type="checkbox" defaultChecked={campaign.pickup_enabled} onChange={(event) => void updateCampaign({ pickup_enabled: event.target.checked })} />{t('campaignPickup')}</label>
              </div>
              {campaign.publication_status === 'draft' && <button onClick={() => void publish()} disabled={saving} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-pink-600 px-4 text-sm font-black text-white"><Save size={16} />{t('campaignPublish')}</button>}
              {campaign.publication_status === 'published' && <button onClick={() => window.confirm(t('campaignCancelConfirm')) && void updateCampaign({ publication_status: 'cancelled' })} disabled={saving} className="mt-4 min-h-11 rounded-xl border border-red-200 px-4 text-sm font-black text-red-700">{t('campaignCancel')}</button>}
              {campaign.publication_status !== 'archived' && <button onClick={() => window.confirm(t('campaignArchiveConfirm')) && void updateCampaign({ publication_status: 'archived' })} disabled={saving} className="ml-2 mt-4 min-h-11 rounded-xl border border-gray-200 px-4 text-sm font-black text-gray-600">{t('campaignArchive')}</button>}
            </section>

            <form onSubmit={addPickupPoint} className="rounded-2xl border border-gray-200 bg-white p-4">
              <h2 className="font-black">{t('campaignPickupPoints')}</h2>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <input name="name" required placeholder={t('campaignPickupName')} className="min-h-11 rounded-xl border border-gray-200 px-3" />
                <input name="address" required placeholder={t('campaignPickupAddress')} className="min-h-11 rounded-xl border border-gray-200 px-3" />
                <input name="starts_at" required type="datetime-local" className="min-h-11 rounded-xl border border-gray-200 px-3" />
                <input name="ends_at" required type="datetime-local" className="min-h-11 rounded-xl border border-gray-200 px-3" />
                <input name="instructions" placeholder={t('campaignPickupInstructions')} className="min-h-11 rounded-xl border border-gray-200 px-3 md:col-span-2" />
              </div>
              <button className="mt-3 min-h-11 rounded-xl border border-pink-200 px-4 text-sm font-black text-pink-700">{t('campaignAddPickupPoint')}</button>
            </form>

            <form onSubmit={addPaymentMethod} className="rounded-2xl border border-gray-200 bg-white p-4">
              <h2 className="font-black">{t('campaignPaymentMethods')}</h2>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <input name="display_name" placeholder="PromptPay" className="min-h-11 rounded-xl border border-gray-200 px-3" />
                <input name="promptpay_id" required placeholder={t('campaignPromptPayId')} className="min-h-11 rounded-xl border border-gray-200 px-3" />
                <input name="instructions" placeholder={t('campaignPaymentInstructions')} className="min-h-11 rounded-xl border border-gray-200 px-3 md:col-span-2" />
              </div>
              <button className="mt-3 min-h-11 rounded-xl border border-pink-200 px-4 text-sm font-black text-pink-700">{t('campaignAddPaymentMethod')}</button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
