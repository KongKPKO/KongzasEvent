import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, CheckCircle, Clock, Copy, Loader2, PackageCheck, Truck, Upload, XCircle } from 'lucide-react';
import { useI18n } from '../../i18n';
import {
  beginCampaignPaymentUpload,
  getPublicCampaignOrder,
  submitCampaignPaymentEvidence,
  uploadCampaignPaymentEvidence,
} from '../../lib/onlineCampaigns';
import type { CampaignOrder } from '../../types/onlineCampaign';
import { formatPrice } from '../../utils/currency';
import OrderStatus from './OrderStatus';

function CampaignOrderView({ order: initialOrder }: { order: CampaignOrder }) {
  const { slug, code } = useParams<{ slug: string; code: string }>();
  const { t, dateLocale } = useI18n();
  const [order, setOrder] = useState(initialOrder);
  const [now, setNow] = useState(Date.now());
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [trackingCopied, setTrackingCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    if (!slug || !code) return;
    const row = await getPublicCampaignOrder(slug, code);
    if (row) setOrder(row);
  }, [code, slug]);

  useEffect(() => {
    const active = ['awaiting_payment', 'payment_submitted', 'payment_submitted_late', 'refund_pending'].includes(order.payment_status)
      || ['awaiting_shipment', 'awaiting_pickup'].includes(order.fulfillment_status);
    if (!active) return;
    const timer = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(timer);
  }, [load, order.fulfillment_status, order.payment_status]);

  const deadline = order.upload_grace_expires_at || order.stock_hold_expires_at;
  const deadlineMs = deadline ? new Date(deadline).getTime() : 0;

  useEffect(() => {
    if (order.payment_status !== 'awaiting_payment') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [order.payment_status]);

  const secondsLeft = Math.max(0, Math.floor((deadlineMs - now) / 1000));
  const countdown = Math.floor(secondsLeft / 60) + ':' + String(secondsLeft % 60).padStart(2, '0');
  const expired = order.payment_status === 'payment_expired' || (order.payment_status === 'awaiting_payment' && deadlineMs > 0 && now >= deadlineMs);
  const canUpload = order.payment_status === 'awaiting_payment' || order.payment_status === 'payment_expired';

  const status = useMemo(() => {
    if (order.payment_status === 'payment_confirmed') return { icon: <CheckCircle className="text-emerald-600" />, title: t('campaignOrderConfirmed'), tone: 'border-emerald-200 bg-emerald-50' };
    if (order.payment_status === 'payment_submitted') return { icon: <Clock className="text-amber-600" />, title: t('campaignOrderReview'), tone: 'border-amber-200 bg-amber-50' };
    if (order.payment_status === 'payment_submitted_late') return { icon: <Clock className="text-orange-600" />, title: t('campaignOrderLateReview'), tone: 'border-orange-200 bg-orange-50' };
    if (order.payment_status === 'refund_pending') return { icon: <Clock className="text-blue-600" />, title: t('campaignOrderRefundPending'), tone: 'border-blue-200 bg-blue-50' };
    if (order.payment_status === 'refunded') return { icon: <CheckCircle className="text-gray-600" />, title: t('campaignOrderRefunded'), tone: 'border-gray-200 bg-gray-50' };
    if (expired) return { icon: <XCircle className="text-gray-500" />, title: t('campaignOrderExpired'), tone: 'border-gray-200 bg-gray-50' };
    return { icon: <Clock className="text-pink-600" />, title: t('campaignOrderAwaitingPayment'), tone: 'border-pink-200 bg-pink-50' };
  }, [expired, order.payment_status, t]);

  const submit = async () => {
    if (!file || !slug || !code || !order.campaign_id) return;
    setSubmitting(true);
    setFeedback('');
    try {
      if (!expired && order.payment_status === 'awaiting_payment') {
        await beginCampaignPaymentUpload(slug, code);
      }
      const path = await uploadCampaignPaymentEvidence(order.campaign_id, order.id, code, file);
      await submitCampaignPaymentEvidence(slug, code, path, crypto.randomUUID());
      setFile(null);
      setFeedback(expired ? t('campaignLateEvidenceSent') : t('campaignEvidenceSent'));
      await load();
    } catch (error) {
      console.error(error);
      setFeedback(t('campaignEvidenceFailed'));
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const copyTracking = async () => {
    if (!order.tracking_number) return;
    try {
      await navigator.clipboard.writeText(order.tracking_number);
      setTrackingCopied(true);
      window.setTimeout(() => setTrackingCopied(false), 2000);
    } catch {
      // Keep the tracking number visible for manual copying.
    }
  };

  return (
    <main className="min-h-screen bg-pink-50/30 px-4 py-6 text-slate-800">
      <div className="mx-auto max-w-lg space-y-4">
        <header className="rounded-2xl border border-pink-100 bg-white p-4">
          <div className="text-xs font-black uppercase tracking-wide text-pink-600">{order.artist_name}</div>
          <h1 className="mt-1 text-xl font-black text-gray-950">{t('campaignOrderTitle')}</h1>
          <div className="mt-1 font-mono text-sm font-black text-gray-600">{order.order_code}</div>
        </header>

        <section className={'rounded-2xl border p-4 ' + status.tone}>
          <div className="flex items-center gap-3">{status.icon}<div><h2 className="font-black">{status.title}</h2><p className="text-sm font-semibold opacity-80">{order.review_note || t('campaignOrderStatusHint')}</p></div></div>
          {order.payment_status === 'awaiting_payment' && !expired && (
            <div className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-center">
              <div className="text-xs font-black uppercase text-gray-500">{t('campaignPaymentTimeLeft')}</div>
              <div className="font-mono text-3xl font-black text-pink-700">{countdown}</div>
            </div>
          )}
        </section>

        {order.payment_status === 'awaiting_payment' && !expired && (
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <h2 className="font-black">{t('campaignPaymentMethods')}</h2>
            <div className="mt-3 space-y-2">
              {(order.payment_methods || []).map((method) => (
                <div key={method.id} className="rounded-xl bg-gray-50 p-3">
                  <div className="font-black">{method.display_name || method.method_type}</div>
                  {method.promptpay_id && <div className="mt-1 text-lg font-black">PromptPay: {method.promptpay_id}</div>}
                  {method.account_number && <div className="mt-1 font-black">{method.bank_name} · {method.account_number}</div>}
                  {method.qr_image_url && <img src={method.qr_image_url} alt="" className="mt-2 h-44 w-44 rounded-xl object-contain" />}
                  {method.instructions && <p className="mt-1 text-sm font-semibold text-gray-600">{method.instructions}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {canUpload && (
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <h2 className="font-black">{expired ? t('campaignTransferredAlready') : t('campaignUploadEvidence')}</h2>
            <p className="mt-1 text-sm font-semibold text-gray-600">{expired ? t('campaignLateEvidenceWarning') : t('campaignUploadEvidenceHint')}</p>
            <input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={(event) => setFile(event.target.files?.[0] || null)} />
            <button type="button" onClick={() => inputRef.current?.click()} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-pink-200 bg-pink-50 text-sm font-black text-pink-700"><Upload size={17} />{file?.name || t('campaignChooseEvidence')}</button>
            <button type="button" disabled={!file || submitting} onClick={() => void submit()} className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-pink-600 text-sm font-black text-white disabled:opacity-50">{submitting && <Loader2 className="animate-spin" size={16} />}{expired ? t('campaignNotifyShop') : t('campaignSubmitEvidence')}</button>
            {feedback && <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">{feedback}</div>}
          </section>
        )}

        <section className="rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="font-black">{t('campaignOrderItems')}</h2>
          <div className="mt-2 divide-y divide-gray-100">
            {order.items.map((item, index) => <div key={(item.product_id || item.name) + index} className="flex justify-between gap-3 py-2 text-sm"><span className="font-bold">{item.name} × {item.quantity}{item.line_type === 'promotion_reward' && <span className="ml-2 rounded-full bg-pink-50 px-2 py-0.5 text-xs text-pink-700">ของแถม</span>}</span><strong>{formatPrice(item.price_per_unit * item.quantity, order.currency)}</strong></div>)}
          </div>
          <div className="mt-2 space-y-1 border-t border-gray-200 pt-2 text-sm">
            <div className="flex justify-between"><span>{t('campaignSubtotal')}</span><strong>{formatPrice(order.subtotal_price, order.currency)}</strong></div>
            {order.discount_total > 0 && <div className="flex justify-between text-emerald-700"><span>ส่วนลดโปรโมชั่น</span><strong>−{formatPrice(order.discount_total, order.currency)}</strong></div>}
            <div className="flex justify-between"><span>{t('campaignShippingFee')}</span><strong>{formatPrice(order.shipping_fee, order.currency)}</strong></div>
            <div className="flex justify-between text-base"><span className="font-black">{t('campaignTotal')}</span><strong>{formatPrice(order.total_price, order.currency)}</strong></div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 font-black">{order.fulfillment_method === 'shipping' ? <Truck size={18} /> : <PackageCheck size={18} />}{order.fulfillment_method === 'shipping' ? t('campaignShipping') : t('campaignPickup')}</div>
          {order.shipping_address && <p className="mt-2 whitespace-pre-line text-sm font-semibold text-gray-700">{order.shipping_address}</p>}
          {order.pickup_point && <div className="mt-2 text-sm font-semibold text-gray-700"><div className="font-black">{order.pickup_point.name}</div><div>{order.pickup_point.address}</div><div>{new Date(order.pickup_point.starts_at).toLocaleString(dateLocale)}</div></div>}
          {order.tracking_number && (
            <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3">
              {order.shipping_carrier && <div className="text-xs font-bold text-blue-700"><span className="font-black">{t('campaignShippingCarrier')}:</span> {order.shipping_carrier}</div>}
              <div className="mt-2 text-xs font-black text-blue-700">{t('campaignTrackingNumber')}</div>
              <div className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg bg-white px-3 py-2 font-mono text-sm font-black text-blue-950">{order.tracking_number}</code>
                <button type="button" onClick={() => void copyTracking()} aria-label={t('campaignCopyTracking')} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-blue-200 bg-white px-3 text-xs font-black text-blue-700">
                  {trackingCopied ? <Check size={15} /> : <Copy size={15} />}{trackingCopied ? t('campaignCopied') : t('campaignCopy')}
                </button>
              </div>
            </div>
          )}
        </section>

        <Link to={'/' + slug + '/campaign/' + order.campaign_slug} className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-pink-200 bg-white text-sm font-black text-pink-700">{t('campaignBackToCampaign')}</Link>
      </div>
    </main>
  );
}
export default function CampaignAwareOrderStatus() {
  const { slug, code } = useParams<{ slug: string; code: string }>();
  const [campaignOrder, setCampaignOrder] = useState<CampaignOrder | null | undefined>(undefined);

  useEffect(() => {
    if (!slug || !code) return;
    void getPublicCampaignOrder(slug, code)
      .then(setCampaignOrder)
      .catch(() => setCampaignOrder(null));
  }, [code, slug]);

  if (campaignOrder === undefined) return <div className="grid min-h-screen place-items-center text-pink-600"><Loader2 className="animate-spin" /></div>;
  return campaignOrder ? <CampaignOrderView order={campaignOrder} /> : <OrderStatus />;
}
