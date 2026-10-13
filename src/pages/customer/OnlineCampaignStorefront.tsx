import { useEffect, useMemo, useState } from 'react';
import StoreSuspensionNotice from '../../components/StoreSuspensionNotice';
import PromotionChoicePicker from '../../components/promotions/PromotionChoicePicker';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, Loader2, Minus, Plus, ShoppingCart, Store, X } from 'lucide-react';
import { uiText, useI18n, LanguageToggle } from '../../i18n';
import { createCampaignOrder, getPublicOnlineCampaign, notifyOnlineCampaignOrder, OnlineCampaignError } from '../../lib/onlineCampaigns';
import { requiresPromotionReview, quotePromotions } from '../../lib/promotions';
import type { CampaignFulfillmentMethod, CampaignProduct, PublicOnlineCampaign } from '../../types/onlineCampaign';
import type { PresentableProduct } from '../../types/productPresentation';
import type { PromotionChoice, PromotionQuote } from '../../types/promotion';
import { formatPrice } from '../../utils/currency';
import { getMenuImageUrl } from '../../utils/imageUtils';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { ProductGallery, ProductMedia, ProductPresentationSummary } from '../../components/menu/ProductPresentation';
import { buildProductPresentationEntries, getProductPresentationKind, getProductPriceRange, inheritProductPresentation, isProductPreorderClosed } from '../../utils/productPresentation';

type CampaignDisplayProduct = CampaignProduct & PresentableProduct;

const asDisplayProduct = (product: CampaignProduct): CampaignDisplayProduct => ({
  ...product,
  id: product.product_id,
  image_url: product.image_url || null,
});

export default function OnlineCampaignStorefront() {
  const { slug, campaignSlug } = useParams<{ slug: string; campaignSlug: string }>();
  const navigate = useNavigate();
  const { t, dateLocale, language } = useI18n();
  const [campaign, setCampaign] = useState<PublicOnlineCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [fulfillment, setFulfillment] = useState<CampaignFulfillmentMethod>('shipping');
  const [pickupPointId, setPickupPointId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [quote, setQuote] = useState<PromotionQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [rewardChoices, setRewardChoices] = useState<PromotionChoice[]>([]);
  const [promotionChoices, setPromotionChoices] = useState<PromotionChoice[]>([]);
  const [acceptExhaustedRewards, setAcceptExhaustedRewards] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<CampaignDisplayProduct | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const dialogRef = useDialogFocus<HTMLDivElement>(Boolean(selectedProduct), () => setSelectedProduct(null));

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
  const merchandiseTotal = quote?.merchandise_total ?? subtotal;
  const total = merchandiseTotal + estimatedShipping;
  const exhaustedRewards = quote?.required_choices.filter((choice) => choice.exhausted) || [];
  const unresolvedChoices = quote?.required_choices.filter((choice) => !choice.exhausted) || [];
  const productEntries = useMemo(
    () => buildProductPresentationEntries((campaign?.products || []).map(asDisplayProduct)),
    [campaign]
  );

  useEffect(() => {
    if (!campaign || cartItems.length === 0) {
      setQuote(null);
      return;
    }
    let active = true;
    setQuoteLoading(true);
    const timer = window.setTimeout(() => {
      void quotePromotions({
        campaignId: campaign.id,
        items: cartItems.map((item) => ({ product_id: item.product.product_id, quantity: item.quantity })),
        rewardChoices,
        promotionChoices,
      }).then((nextQuote) => {
        if (active) setQuote(nextQuote);
      }).catch((quoteError) => {
        console.error(quoteError);
        if (active) setError(uiText(language, 'Could not calculate promotions. Please try again.'));
      }).finally(() => {
        if (active) setQuoteLoading(false);
      });
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [campaign, cartItems, language, promotionChoices, rewardChoices]);

  const changeQuantity = (productId: string, delta: number, max: number | null) => {
    setAcceptExhaustedRewards(false);
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
        rewardChoices,
        promotionChoices,
        expectedPricingHash: quote?.pricing_hash,
        acceptExhaustedRewards,
      });
      if (!result) throw new Error('campaign_request_failed');
      void notifyOnlineCampaignOrder({ orderId: result.order_id, orderCode: result.order_code, event: 'created' }).catch(() => undefined);
      navigate('/' + slug + '/order/' + result.order_code);
    } catch (checkoutError) {
      console.error(checkoutError);
      if (checkoutError instanceof OnlineCampaignError && checkoutError.code === 'campaign_product_order_limit_exceeded') {
        setError(t('campaignProductOrderLimitExceeded'));
      } else if (checkoutError instanceof OnlineCampaignError && checkoutError.code === 'store_suspended') {
        setError(uiText(language, 'This store is not accepting new orders. Existing orders remain accessible.'));
      } else if (requiresPromotionReview(checkoutError)) {
        setRewardChoices([]);
        setAcceptExhaustedRewards(false);
        setError(uiText(language, 'A promotion or stock level changed. Please review the new total.'));
      } else {
        setError(t('campaignCheckoutFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="grid min-h-screen place-items-center text-pink-600"><Loader2 className="animate-spin" /></div>;
  if (!campaign) return <div className="grid min-h-screen place-items-center bg-gray-50 px-4 text-center font-bold text-gray-500">{t('campaignUnavailable')}</div>;

  const saleOpen = campaign.state === 'open';
  const renderCampaignProduct = (product: CampaignDisplayProduct, index: number) => {
    const available = product.available_quantity ?? null;
    const soldOut = isProductPreorderClosed(product) || (available !== null && available <= 0);
    const soldOutLabel = isProductPreorderClosed(product) ? uiText(language, 'Pre-order closed') : t('campaignSoldOut');
    const quantity = cart[product.product_id] || 0;
    const orderLimit = product.max_quantity_per_order ?? null;
    const quantityLimit = orderLimit === null
      ? available
      : available === null
        ? orderLimit
        : Math.min(available, orderLimit);
    const limitReached = quantityLimit !== null && quantity >= quantityLimit;
    const kind = getProductPresentationKind(product);
    const showStock = kind !== 'preorder' && kind !== 'service';

    return (
      <article key={product.product_id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <button type="button" onClick={() => setSelectedProduct(product)} className="block w-full text-left focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-pink-200">
          <div className="relative aspect-square overflow-hidden bg-pink-50">
            <ProductMedia product={product} getImageUrl={getMenuImageUrl} eager={index === 0} />
            {soldOut && <div className="absolute inset-0 grid place-items-center bg-gray-950/50"><span className="rotate-[-8deg] border-2 border-white px-3 py-1 text-xs font-black text-white">{soldOutLabel}</span></div>}
          </div>
          <div className="p-4 pb-2">
            <div className="font-black text-gray-950">{product.variant_name || product.name}</div>
            {product.variant_name && <div className="text-xs font-bold text-gray-500">{product.name}</div>}
            <div className="mt-2 text-lg font-black text-pink-700">{formatPrice(product.price, campaign.currency)}</div>
            <div className="mt-2"><ProductPresentationSummary product={product} language={language} compact /></div>
            {showStock && <div className="mt-1 text-xs font-semibold text-gray-500">
              {product.is_unlimited ? t('campaignUnlimited') : t('campaignRemaining', { count: Math.max(available || 0, 0) })}
            </div>}
            {orderLimit !== null && <div className="mt-1 text-xs font-bold text-pink-700">{t('campaignProductOrderLimit', { count: orderLimit })}</div>}
          </div>
        </button>
        <div className="px-4 pb-4">
          {saleOpen && !soldOut && (
            <div className="mt-1 flex items-center justify-between rounded-xl bg-gray-50 p-1">
              <button type="button" onClick={() => changeQuantity(product.product_id, -1, quantityLimit)} aria-label={t('campaignDecrease')} className="grid h-11 w-11 place-items-center rounded-lg bg-white text-gray-700"><Minus size={16} /></button>
              <span className="font-black">{quantity}</span>
              <button type="button" disabled={limitReached} onClick={() => changeQuantity(product.product_id, 1, quantityLimit)} aria-label={t('campaignIncrease')} className="grid h-11 w-11 place-items-center rounded-lg bg-pink-600 text-white disabled:bg-gray-200 disabled:text-gray-400"><Plus size={16} /></button>
            </div>
          )}
          {soldOut && <div className="mt-1 rounded-xl bg-gray-100 px-3 py-2 text-center text-sm font-black text-gray-500">{soldOutLabel}</div>}
        </div>
      </article>
    );
  };

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
      <LanguageToggle className="ml-auto shrink-0" /></header>

      <div className="mx-auto max-w-5xl px-4 py-5">
        <StoreSuspensionNotice artistId={campaign.artist_id} />
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
          {productEntries.map((entry, index) => {
            if (entry.type === 'product') return renderCampaignProduct(entry.product, index);
            const variants = entry.products.map((product) => inheritProductPresentation(product, entry.parent));
            const representative = entry.parent || variants[0];
            const prices = getProductPriceRange(variants);
            const expanded = Boolean(expandedGroups[entry.key]);
            return (
              <article key={entry.key} className="overflow-hidden rounded-2xl border border-pink-100 bg-white shadow-sm sm:col-span-2 lg:col-span-3">
                <button type="button" onClick={() => setExpandedGroups((current) => ({ ...current, [entry.key]: !expanded }))} aria-expanded={expanded} className="flex min-h-32 w-full text-left focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-pink-200">
                  <div className="relative w-32 shrink-0 overflow-hidden bg-pink-50 sm:w-40"><ProductMedia product={representative} getImageUrl={getMenuImageUrl} /></div>
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <h2 className="truncate font-black text-gray-950">{entry.label}</h2>
                      <p className="mt-1 text-xs font-bold text-pink-700">{variants.length} {uiText(language, variants.length === 1 ? 'variant' : 'variants')}</p>
                      <div className="mt-2 text-lg font-black text-pink-700">{prices.min === prices.max ? formatPrice(prices.min, campaign.currency) : `${formatPrice(prices.min, campaign.currency)}–${formatPrice(prices.max, campaign.currency)}`}</div>
                      <div className="mt-2"><ProductPresentationSummary product={representative} language={language} compact /></div>
                    </div>
                    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full bg-pink-50 text-pink-700 transition-transform ${expanded ? 'rotate-180' : ''}`}><ChevronDown size={20} /></span>
                  </div>
                </button>
                {expanded && <div className="grid gap-4 border-t border-pink-100 bg-pink-50/30 p-4 sm:grid-cols-2 lg:grid-cols-3">{variants.map((product, variantIndex) => renderCampaignProduct(product, variantIndex))}</div>}
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

      {selectedProduct && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-gray-950/55 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={selectedProduct.name} ref={dialogRef} onClick={() => setSelectedProduct(null)}>
          <div className="relative grid max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-[2rem] bg-white shadow-2xl sm:grid-cols-2 sm:rounded-[2rem]" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => setSelectedProduct(null)} aria-label={t('campaignClose')} className="absolute right-3 top-3 z-10 grid h-11 w-11 place-items-center rounded-full bg-white/95 text-gray-600 shadow-sm"><X size={20} /></button>
            <div className="min-h-[320px] overflow-hidden bg-pink-50 sm:border-r sm:border-pink-100">
              <ProductGallery product={selectedProduct} getImageUrl={getMenuImageUrl} />
            </div>
            <div className="p-5 pt-16 sm:p-7 sm:pt-16">
              <div className="flex flex-wrap gap-2">
                {selectedProduct.category && <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-black text-gray-600">{selectedProduct.category}</span>}
                {selectedProduct.variant_name && <span className="rounded-full bg-pink-50 px-3 py-1 text-xs font-black text-pink-700">{selectedProduct.variant_name}</span>}
              </div>
              <h2 className="mt-3 text-2xl font-black leading-tight text-gray-950">{selectedProduct.name}</h2>
              <div className="mt-2 text-3xl font-black text-pink-700">{formatPrice(selectedProduct.price, campaign.currency)}</div>
              <div className="mt-5 rounded-2xl border border-gray-100 bg-gray-50 p-4"><ProductPresentationSummary product={selectedProduct} language={language} /></div>
              {selectedProduct.description && <p className="mt-5 whitespace-pre-line text-sm font-semibold leading-6 text-gray-600">{selectedProduct.description}</p>}
              {saleOpen && !isProductPreorderClosed(selectedProduct) && (selectedProduct.available_quantity === null || selectedProduct.available_quantity === undefined || selectedProduct.available_quantity > 0) && (() => {
                const quantity = cart[selectedProduct.product_id] || 0;
                const available = selectedProduct.available_quantity ?? null;
                const orderLimit = selectedProduct.max_quantity_per_order ?? null;
                const maximum = orderLimit === null ? available : available === null ? orderLimit : Math.min(available, orderLimit);
                return (
                  <div className="mt-6 flex items-center justify-between rounded-2xl bg-pink-50 p-1.5">
                    <button type="button" onClick={() => changeQuantity(selectedProduct.product_id, -1, maximum)} aria-label={t('campaignDecrease')} className="grid h-12 w-12 place-items-center rounded-xl bg-white text-pink-700 shadow-sm"><Minus size={18} /></button>
                    <span className="font-black text-gray-950">{quantity}</span>
                    <button type="button" onClick={() => changeQuantity(selectedProduct.product_id, 1, maximum)} disabled={maximum !== null && quantity >= maximum} aria-label={t('campaignIncrease')} className="grid h-12 w-12 place-items-center rounded-xl bg-pink-600 text-white disabled:bg-gray-200 disabled:text-gray-400"><Plus size={18} /></button>
                  </div>
                );
              })()}
            </div>
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
            {quote?.applied_promotions.length ? (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <div className="font-black text-emerald-900">{uiText(language, 'Applied promotions')}</div>
                {quote.applied_promotions.map((promotion) => (
                  <div key={promotion.id} className="mt-1 flex justify-between gap-3 text-emerald-800">
                    <span>{promotion.name}</span>
                    {promotion.discount_amount > 0 && <strong>-{formatPrice(promotion.discount_amount, campaign.currency)}</strong>}
                  </div>
                ))}
                {quote.reward_lines.map((reward) => <div key={`${reward.promotion_id}-${reward.tier_id || ''}-${reward.product_id}`} className="mt-1 text-emerald-800">{uiText(language, 'Free gift')}: {reward.name} × {reward.quantity}</div>)}
              </div>
            ) : null}
            {unresolvedChoices.map((choice) => <div className="mt-3" key={`${choice.kind}-${choice.promotion_id}-${choice.tier_id || ''}`}>
              <PromotionChoicePicker choice={choice} onConfirm={(selection) => {
                setAcceptExhaustedRewards(false);
                const setChoices = choice.kind === 'reward' ? setRewardChoices : setPromotionChoices;
                setChoices((current) => [...current.filter((item) => item.promotion_id !== choice.promotion_id || (item.tier_id || null) !== (choice.tier_id || null)), selection]);
              }} />
            </div>)}
            {exhaustedRewards.length > 0 && (
              <label className="mt-4 flex cursor-pointer gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                <input type="checkbox" checked={acceptExhaustedRewards} onChange={(event) => setAcceptExhaustedRewards(event.target.checked)} className="mt-1 h-4 w-4" />
                <span><strong className="block">{uiText(language, 'All gifts for this promotion are out of stock.')}</strong>{uiText(language, 'Review the new total without this promotion, then confirm to continue.')}</span>
              </label>
            )}
            <div className="mt-4 space-y-1 rounded-xl bg-gray-50 p-3 text-sm">
              <div className="flex justify-between"><span>{t('campaignSubtotal')}</span><strong>{formatPrice(subtotal, campaign.currency)}</strong></div>
              {(quote?.discount_total || 0) > 0 && <div className="flex justify-between text-emerald-700"><span>{uiText(language, 'Discount')}</span><strong>-{formatPrice(quote?.discount_total || 0, campaign.currency)}</strong></div>}
              <div className="flex justify-between"><span>{t('campaignShippingFee')}</span><strong>{formatPrice(estimatedShipping, campaign.currency)}</strong></div>
              <div className="flex justify-between border-t border-gray-200 pt-2 text-base"><span className="font-black">{t('campaignTotal')}</span><strong>{formatPrice(total, campaign.currency)}</strong></div>
            </div>
            {error && <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error}</div>}
            <button disabled={submitting || quoteLoading || !quote || unresolvedChoices.length > 0 || (exhaustedRewards.length > 0 && !acceptExhaustedRewards)} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-pink-600 text-sm font-black text-white disabled:opacity-50">
              {submitting && <Loader2 className="animate-spin" size={16} />}{submitting ? t('campaignCreatingOrder') : t('campaignConfirmOrder')}
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
