import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, Minus, Plus, ShoppingCart, Store } from 'lucide-react';
import { useI18n } from '../../i18n';
import { createCampaignOrder, getPublicOnlineCampaign, notifyOnlineCampaignOrder } from '../../lib/onlineCampaigns';
import type { CampaignFulfillmentMethod, PublicOnlineCampaign } from '../../types/onlineCampaign';
import { formatPrice } from '../../utils/currency';
import { getMenuImageUrl } from '../../utils/imageUtils';

function CampaignProductImage({ name, imageUrl }: { name: string; imageUrl?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!imageUrl || failed) {
    return <div data-testid="campaign-product-image-fallback" className="grid aspect-square place-items-center bg-gray-100 text-gray-400"><Store /></div>;
  }
  return <img src={getMenuImageUrl(imageUrl, 520)} alt={name} onError={() => setFailed(true)} className="aspect-square w-full object-cover" />;
}

export default function OnlineCampaignStorefront() {
  const { slug, campaignSlug } = useParams<{ slug: string; campaignSlug: string }>();
  const navigate = useNavigate();
  const { t, dateLocale } = useI18n();
  const [campaign, setCampaign] = useState<PublicOnlineCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [fulfillment, setFulfillment] = useState<CampaignFulfillmentMethod>('shipping');
  const [pickupPointId, setPickupPointId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!slug || !campaignSlug) return;
    void getPublicOnlineCampaign(slug, campaignSlug)
      .then((row) => {
        setCampaign(row);
        if (row) {
          const method: CampaignFulfillmentMethod = row.shipping_enabled ? 'shipping' : 'pickup';
          setFulfillment(method);
          setPickupPointId(row.pickup_points[0]?.id || '');
        }
      })
      .catch((loadError) => {
        console.error(loadError);
        setCampaign(null);
      })
      .finally(() => setLoading(false));
  }, [campaignSlug, slug]);

  const cartItems = useMemo(() => {
    if (!campaign) return [];
    return campaign.products
      .filter((product) => (cart[product.product_id] || 0) > 0)
      .map((product) => ({ product, quantity: cart[product.product_id] }));
  }, [campaign, cart]);

  const subtotal = cartItems.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);
  const estimatedShipping = fulfillment === 'shipping' ? Number(campaign?.flat_shipping_fee || 0) : 0;
  const total = subtotal + estimatedShipping;

  const changeQuantity = (productId: string, delta: number, max: number | null) => {
    setCart((current) => {
      const next = Math.max(0, (current[productId] || 0) + delta);
      return { ...current, [productId]: max === null ? next : Math.min(next, max) };
    });
  };

  const checkout = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!campaign || !slug || cartItems.length === 0) return;
    setSubmitting(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await createCampaignOrder({
        campaignId: campaign.id,
        items: cartItems.map((item) => ({ product_id: item.product.product_id, quantity: item.quantity })),
        fulfillmentMethod: fulfillment,
        pickupPointId: fulfillment === 'pickup' ? pickupPointId : null,
        customerName: String(form.get('customer_name') || ''),
        customerEmail: String(form.get('customer_email') || ''),
        customerPhone: String(form.get('customer_phone') || ''),
        shippingAddress: fulfillment === 'shipping' ? String(form.get('shipping_address') || '') : '',
        customerNote: String(form.get('customer_note') || ''),
        clientRequestId: crypto.randomUUID(),
      });
      if (!result) throw new Error('campaign_request_failed');
      void notifyOnlineCampaignOrder({ orderId: result.order_id, orderCode: result.order_code, event: 'created' }).catch(() => undefined);
      navigate('/' + slug + '/order/' + result.order_code);
    } catch (checkoutError) {
      console.error(checkoutError);
      setError(t('campaignCheckoutFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="grid min-h-screen place-items-center text-pink-600"><Loader2 className="animate-spin" /></div>;
  if (!campaign) return <div className="grid min-h-screen place-items-center bg-gray-50 px-4 text-center font-bold text-gray-500">{t('campaignUnavailable')}</div>;

  const saleOpen = campaign.state === 'open';

  return (
    <main className="min-h-screen bg-pink-50/30 pb-28 text-slate-800">
      <header className="border-b border-pink-100 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-pink-100 text-pink-700"><Store size={22} /></span>
          <div className="min-w-0">
            <div className="text-xs font-black uppercase tracking-wide text-pink-600">{campaign.artist_name}</div>
            <h1 className="truncate text-xl font-black text-gray-950">{campaign.name}</h1>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-5">
        <section className="rounded-2xl border border-pink-100 bg-white p-5">
          <p className="whitespace-pre-line text-sm font-medium leading-6 text-gray-700">{campaign.description}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
            <span className="rounded-full bg-pink-50 px-3 py-1.5 text-pink-700">{t(('campaignState_' + campaign.state) as Parameters<typeof t>[0])}</span>
            <span className="rounded-full bg-gray-100 px-3 py-1.5 text-gray-600">
              {new Date(campaign.opens_at).toLocaleString(dateLocale)} – {new Date(campaign.closes_at).toLocaleString(dateLocale)}
            </span>
          </div>
          {!saleOpen && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">{t('campaignReadOnlyNotice')}</div>}
        </section>

        <section className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaign.products.map((product) => {
            const available = product.available_quantity ?? null;
            const soldOut = available !== null && available <= 0;
            const quantity = cart[product.product_id] || 0;
            return (
              <article key={product.product_id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <CampaignProductImage name={product.name} imageUrl={product.image_url} />
                <div className="p-4">
                  <div className="font-black text-gray-950">{product.name}</div>
                  {product.variant_name && <div className="text-xs font-bold text-gray-500">{product.variant_name}</div>}
                  <div className="mt-2 text-lg font-black text-pink-700">{formatPrice(product.price, campaign.currency)}</div>
                  <div className="mt-1 text-xs font-semibold text-gray-500">
                    {product.is_unlimited ? t('campaignUnlimited') : t('campaignRemaining', { count: Math.max(available || 0, 0) })}
                  </div>
                  {saleOpen && !soldOut && (
                    <div className="mt-3 flex items-center justify-between rounded-xl bg-gray-50 p-1">
                      <button type="button" onClick={() => changeQuantity(product.product_id, -1, available)} aria-label={t('campaignDecrease')} className="grid h-11 w-11 place-items-center rounded-lg bg-white text-gray-700"><Minus size={16} /></button>
                      <span className="font-black">{quantity}</span>
                      <button type="button" onClick={() => changeQuantity(product.product_id, 1, available)} aria-label={t('campaignIncrease')} className="grid h-11 w-11 place-items-center rounded-lg bg-pink-600 text-white"><Plus size={16} /></button>
                    </div>
                  )}
                  {soldOut && <div className="mt-3 rounded-xl bg-gray-100 px-3 py-2 text-center text-sm font-black text-gray-500">{t('campaignSoldOut')}</div>}
                </div>
              </article>
            );
          })}
        </section>
      </div>

      {saleOpen && cartItems.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-pink-100 bg-white p-3 shadow-2xl">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div><div className="text-xs font-bold text-gray-500">{t('campaignCartItems', { count: cartItems.reduce((sum, item) => sum + item.quantity, 0) })}</div><div className="text-lg font-black text-gray-950">{formatPrice(subtotal, campaign.currency)}</div></div>
            <button onClick={() => setCheckoutOpen(true)} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-pink-600 px-5 text-sm font-black text-white"><ShoppingCart size={18} />{t('campaignCheckout')}</button>
          </div>
        </div>
      )}

      {checkoutOpen && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-black/40 p-4">
          <form onSubmit={checkout} className="mx-auto max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-black">{t('campaignCheckout')}</h2><button type="button" onClick={() => setCheckoutOpen(false)} className="min-h-11 px-3 text-sm font-black text-gray-500">{t('campaignClose')}</button></div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {campaign.shipping_enabled && <button type="button" onClick={() => setFulfillment('shipping')} className={'min-h-11 rounded-xl border text-sm font-black ' + (fulfillment === 'shipping' ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-200')}>{t('campaignShipping')}</button>}
              {campaign.pickup_enabled && <button type="button" onClick={() => setFulfillment('pickup')} className={'min-h-11 rounded-xl border text-sm font-black ' + (fulfillment === 'pickup' ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-200')}>{t('campaignPickup')}</button>}
            </div>
            <div className="mt-4 space-y-3">
              <input name="customer_name" required placeholder={t('campaignCustomerName')} className="min-h-11 w-full rounded-xl border border-gray-200 px-3" />
              <input name="customer_email" required type="email" placeholder={t('campaignCustomerEmail')} className="min-h-11 w-full rounded-xl border border-gray-200 px-3" />
              <input name="customer_phone" required placeholder={t('campaignCustomerPhone')} className="min-h-11 w-full rounded-xl border border-gray-200 px-3" />
              {fulfillment === 'shipping' ? (
                <textarea name="shipping_address" required placeholder={t('campaignShippingAddress')} className="min-h-24 w-full rounded-xl border border-gray-200 p-3" />
              ) : (
                <select required value={pickupPointId} onChange={(event) => setPickupPointId(event.target.value)} className="min-h-11 w-full rounded-xl border border-gray-200 px-3">
                  {campaign.pickup_points.map((point) => <option key={point.id} value={point.id}>{point.name} · {new Date(point.starts_at).toLocaleString(dateLocale)}</option>)}
                </select>
              )}
              <textarea name="customer_note" placeholder={t('campaignCustomerNote')} className="min-h-20 w-full rounded-xl border border-gray-200 p-3" />
            </div>
            <div className="mt-4 space-y-1 rounded-xl bg-gray-50 p-3 text-sm">
              <div className="flex justify-between"><span>{t('campaignSubtotal')}</span><strong>{formatPrice(subtotal, campaign.currency)}</strong></div>
              <div className="flex justify-between"><span>{t('campaignShippingFee')}</span><strong>{formatPrice(estimatedShipping, campaign.currency)}</strong></div>
              <div className="flex justify-between border-t border-gray-200 pt-2 text-base"><span className="font-black">{t('campaignTotal')}</span><strong>{formatPrice(total, campaign.currency)}</strong></div>
            </div>
            {error && <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error}</div>}
            <button disabled={submitting} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-pink-600 text-sm font-black text-white disabled:opacity-50">
              {submitting && <Loader2 className="animate-spin" size={16} />}{submitting ? t('campaignCreatingOrder') : t('campaignConfirmOrder')}
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
