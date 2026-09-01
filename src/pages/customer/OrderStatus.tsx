import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, CheckCircle, ChevronLeft, Clock, Copy, Truck, XCircle } from 'lucide-react';
import { useI18n } from '../../i18n';
import { formatPrice } from '../../utils/currency';
import { ConfirmDialog } from '../../components/ui/Feedback';
import {
  cancelCustomerPreorderBeforePayment,
  getPreorderErrorMessage,
  getPublicPreorderByCode,
  notifyPreorderPayment,
  submitPaymentEvidence,
  uploadPaymentEvidence,
} from '../../lib/preorders';
import type { PublicPreorderDetail } from '../../types/preorder';

type Feedback = { tone: 'success' | 'warning' | 'error'; title: string; detail?: string };

const ACTIVE_PAYMENT_STATUSES = ['awaiting_payment', 'payment_submitted'];

const OrderStatus: React.FC = () => {
  const { slug, code } = useParams<{ slug: string; code: string }>();
  const { t, language } = useI18n();
  const locale = language === 'th' ? 'th-TH' : 'en-GB';

  const [detail, setDetail] = useState<PublicPreorderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreviewUrl, setSlipPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [linkCopied, setLinkCopied] = useState(false);
  const [trackingCopied, setTrackingCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const expiryRefreshRequestedRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!slug || !code) return;
    if (!silent) setLoading(true);
    try {
      const row = await getPublicPreorderByCode(slug, code);
      setDetail(row);
      setNotFound(!row);
    } catch (error) {
      console.error(error);
      if (!silent) setNotFound(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [slug, code]);

  useEffect(() => { load(); }, [load]);

  // Poll while the order is still moving (awaiting payment, under review, awaiting pickup/shipment).
  useEffect(() => {
    if (!detail) return;
    const active = ACTIVE_PAYMENT_STATUSES.includes(detail.payment_status)
      || detail.pickup_status === 'awaiting_pickup'
      || detail.pickup_status === 'awaiting_shipment';
    if (!active) return;
    const id = window.setInterval(() => load(true), 25000);
    return () => window.clearInterval(id);
  }, [detail, load]);

  const awaitingPayment = detail?.payment_status === 'awaiting_payment';
  const deadlineMs = detail?.payment_deadline_at ? new Date(detail.payment_deadline_at).getTime() : null;

  useEffect(() => {
    if (!awaitingPayment || !deadlineMs) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [awaitingPayment, deadlineMs]);

  useEffect(() => () => {
    if (slipPreviewUrl) URL.revokeObjectURL(slipPreviewUrl);
  }, [slipPreviewUrl]);

  const handleSlipChange = (file: File | null) => {
    setSlipFile(file);
    if (slipPreviewUrl) URL.revokeObjectURL(slipPreviewUrl);
    setSlipPreviewUrl(file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null);
  };

  const handleSubmitSlip = async () => {
    if (!detail) return;
    if (deadlinePassed) {
      setFeedback({ tone: 'error', title: t('orderSubmitError'), detail: t('orderPayDeadlinePassed') });
      await load(true);
      return;
    }
    if (!slipFile) {
      setFeedback({ tone: 'warning', title: t('orderSlipRequired') });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const slipPath = await uploadPaymentEvidence({
        eventId: detail.event_id,
        orderId: detail.order_id,
        pickupCode: detail.pickup_code,
        file: slipFile,
      });
      await submitPaymentEvidence({
        orderId: detail.order_id,
        pickupCode: detail.pickup_code,
        slipUrl: slipPath,
      });
      const { error: notifyError } = await notifyPreorderPayment({
        orderId: detail.order_id,
        pickupCode: detail.pickup_code,
        event: 'submitted',
      });
      handleSlipChange(null);
      setFeedback({
        tone: notifyError ? 'warning' : 'success',
        title: t('orderSubmitSuccess'),
        detail: notifyError ? t('orderSubmitEmailFailed') : t('orderSubmitSuccessDetail'),
      });
      await load(true);
    } catch (error) {
      console.error(error);
      setFeedback({ tone: 'error', title: t('orderSubmitError'), detail: getPreorderErrorMessage(error) });
      await load(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!detail) return;
    setCancelling(true);
    try {
      await cancelCustomerPreorderBeforePayment(detail.order_id, detail.pickup_code);
      setCancelOpen(false);
      await load(true);
    } catch (error) {
      console.error(error);
      setFeedback({ tone: 'error', title: t('orderCancelError'), detail: getPreorderErrorMessage(error) });
      setCancelOpen(false);
    } finally {
      setCancelling(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Clipboard unavailable (http, older browser): ignore quietly.
    }
  };

  const handleCopyTracking = async () => {
    if (!detail?.tracking_number) return;
    try {
      await navigator.clipboard.writeText(detail.tracking_number);
      setTrackingCopied(true);
      window.setTimeout(() => setTrackingCopied(false), 2000);
    } catch {
      // Clipboard unavailable: keep the tracking number visible for manual copy.
    }
  };

  const isPostOrder = detail?.order_type === 'post_event';
  const shipped = detail?.pickup_status === 'shipped';

  const stepIndex = useMemo(() => {
    if (!detail) return 0;
    if (detail.order_type === 'post_event') {
      if (detail.pickup_status === 'shipped') return 4;
      if (detail.payment_status === 'payment_confirmed' || detail.pickup_status === 'awaiting_shipment') return 3;
      if (detail.payment_status === 'payment_submitted') return 2;
      return 1;
    }
    if (detail.pickup_status === 'picked_up') return 4;
    switch (detail.payment_status) {
      case 'payment_confirmed': return 3;
      case 'payment_submitted': return 2;
      default: return 1;
    }
  }, [detail]);

  const terminal = detail
    && ['payment_rejected', 'payment_expired', 'payment_cancelled'].includes(detail.payment_status);
  const stockHoldExpired = detail?.payment_status === 'payment_expired'
    && detail.review_note === 'stock_hold_expired';
  // Rejected and legacy-expired payments can re-reserve on submission; an expired
  // checkout hold requires a new order because its original allocation is gone.
  const canResubmit = Boolean(detail
    && !stockHoldExpired
    && ['payment_rejected', 'payment_expired'].includes(detail.payment_status));
  const pickedUp = detail?.pickup_status === 'picked_up';
  const codeShowableAtBooth = !isPostOrder && (detail?.payment_status === 'payment_confirmed' || pickedUp);

  const formatDate = (value: string | null) => (value
    ? new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
    : '');

  const countdown = useMemo(() => {
    if (!deadlineMs) return null;
    const diff = deadlineMs - nowMs;
    if (diff <= 0) return null;
    const hours = Math.floor(diff / 3_600_000);
    const minutes = Math.floor((diff % 3_600_000) / 60_000);
    const seconds = Math.floor((diff % 60_000) / 1000);
    if (hours >= 48) return null; // beyond 2 days, the date label is enough
    return `${hours > 0 ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, [deadlineMs, nowMs]);

  const deadlinePassed = Boolean(awaitingPayment && deadlineMs && deadlineMs <= nowMs);

  useEffect(() => {
    if (!deadlinePassed) {
      expiryRefreshRequestedRef.current = false;
      return;
    }
    if (expiryRefreshRequestedRef.current) return;
    expiryRefreshRequestedRef.current = true;
    void load(true);
  }, [deadlinePassed, load]);

  const steps = isPostOrder
    ? [t('orderStepPlaced'), t('orderStepPay'), t('orderStepReview'), t('orderStepShip')]
    : [t('orderStepPlaced'), t('orderStepPay'), t('orderStepReview'), t('orderStepPickup')];

  const statusCard = (() => {
    if (!detail) return null;
    if (isPostOrder && shipped) {
      return {
        tone: 'border-green-200 bg-green-50 text-green-900',
        icon: <Truck size={22} className="text-green-600" />,
        title: t('orderStatusShippedTitle'),
        detail: t('orderStatusShippedDetail', { date: formatDate(detail.shipped_at) }),
      };
    }
    if (isPostOrder && (detail.payment_status === 'payment_confirmed' || detail.pickup_status === 'awaiting_shipment')) {
      return {
        tone: 'border-emerald-200 bg-emerald-50 text-emerald-900',
        icon: <CheckCircle size={22} className="text-emerald-600" />,
        title: t('orderStatusAwaitingShipTitle'),
        detail: t('orderStatusAwaitingShipDetail'),
      };
    }
    if (pickedUp) {
      return {
        tone: 'border-green-200 bg-green-50 text-green-900',
        icon: <CheckCircle size={22} className="text-green-600" />,
        title: t('orderStatusPickedUpTitle'),
        detail: t('orderStatusPickedUpDetail', { date: formatDate(detail.picked_up_at) }),
      };
    }
    switch (detail.payment_status) {
      case 'payment_confirmed':
        return {
          tone: 'border-green-200 bg-green-50 text-green-900',
          icon: <CheckCircle size={22} className="text-green-600" />,
          title: t('orderStatusConfirmedTitle'),
          detail: detail.pickup_instructions || t('orderStatusConfirmedDetail'),
        };
      case 'payment_submitted':
        return {
          tone: 'border-amber-200 bg-amber-50 text-amber-900',
          icon: <Clock size={22} className="text-amber-600" />,
          title: t('orderStatusSubmittedTitle'),
          detail: t('orderStatusSubmittedDetail'),
        };
      case 'payment_rejected':
        return {
          tone: 'border-red-200 bg-red-50 text-red-900',
          icon: <XCircle size={22} className="text-red-600" />,
          title: t('orderStatusRejectedTitle'),
          detail: t('orderStatusRejectedDetail'),
        };
      case 'payment_expired':
        return {
          tone: 'border-gray-200 bg-gray-50 text-gray-800',
          icon: <XCircle size={22} className="text-gray-500" />,
          title: t('orderStatusExpiredTitle'),
          detail: t(stockHoldExpired ? 'orderStatusHoldExpiredDetail' : 'orderStatusExpiredDetail'),
        };
      case 'payment_cancelled':
        return {
          tone: 'border-gray-200 bg-gray-50 text-gray-800',
          icon: <XCircle size={22} className="text-gray-500" />,
          title: t('orderStatusCancelledTitle'),
          detail: t('orderStatusCancelledDetail'),
        };
      default:
        return {
          tone: 'border-pink-200 bg-pink-50 text-pink-900',
          icon: <Clock size={22} className="text-pink-600" />,
          title: t('orderStatusAwaitingTitle'),
          detail: t('orderStatusAwaitingDetail'),
        };
    }
  })();

  return (
    <main className="min-h-screen bg-pink-50/40">
      <header className="sticky top-0 z-30 border-b border-pink-100 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-lg items-center justify-between gap-3 px-4">
          <Link
            to={`/${slug}/menu`}
            className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-bold text-pink-700 hover:bg-pink-50"
          >
            <ChevronLeft size={18} /> {t('orderBackToMenu')}
          </Link>
          <div className="truncate text-sm font-black text-gray-900">{t('orderPageTitle')}</div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-5 pb-16">
        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-label={t('orderLoading')}>
            <div className="h-20 animate-pulse rounded-2xl bg-pink-100/70" />
            <div className="h-36 animate-pulse rounded-2xl bg-white" />
            <div className="h-48 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : notFound || !detail ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center">
            <XCircle size={32} className="mx-auto text-gray-400" />
            <h1 className="mt-3 text-lg font-black text-gray-900">{t('orderNotFoundTitle')}</h1>
            <p className="mt-1 text-sm font-medium text-gray-600">{t('orderNotFoundDetail')}</p>
            <Link
              to={`/${slug}/menu`}
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-pink-600 px-5 text-sm font-black text-white hover:bg-pink-700"
            >
              {t('orderBackToMenu')}
            </Link>
          </div>
        ) : (
          <>
            {/* Step indicator */}
            <nav aria-label={t('orderStepsLabel')} className="rounded-2xl border border-pink-100 bg-white p-4">
              <ol className="flex items-start">
                {steps.map((label, index) => {
                  const done = !terminal && stepIndex > index;
                  const current = !terminal && stepIndex === index;
                  const broken = terminal && index >= 1;
                  return (
                    <li key={label} aria-current={current ? 'step' : undefined} className="relative flex flex-1 flex-col items-center text-center">
                      {index > 0 && (
                        <span
                          aria-hidden
                          className={`absolute right-1/2 top-[15px] h-0.5 w-full ${done || current ? 'bg-pink-500' : 'bg-gray-200'}`}
                        />
                      )}
                      <span
                        className={[
                          'relative z-10 grid h-8 w-8 place-items-center rounded-full border-2 text-xs font-black',
                          done ? 'border-pink-500 bg-pink-500 text-white'
                            : current ? 'border-pink-500 bg-white text-pink-600 ring-4 ring-pink-100'
                            : broken ? 'border-gray-200 bg-gray-100 text-gray-400'
                            : 'border-gray-200 bg-white text-gray-400',
                        ].join(' ')}
                      >
                        {done ? <Check size={15} strokeWidth={3} /> : index + 1}
                      </span>
                      <span className={`mt-1.5 px-0.5 text-xs font-bold leading-tight ${done || current ? 'text-gray-900' : 'text-gray-400'}`}>
                        {label}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </nav>

            {/* Status */}
            {statusCard && (
              <section aria-live="polite" className={`rounded-2xl border p-4 ${statusCard.tone}`}>
                <div className="flex items-start gap-3">
                  <div className="shrink-0">{statusCard.icon}</div>
                  <div className="min-w-0">
                    <h1 className="text-base font-black">{statusCard.title}</h1>
                    <p className="mt-1 text-sm font-medium leading-relaxed opacity-90">{statusCard.detail}</p>
                    {detail.payment_status === 'payment_rejected' && detail.review_note && (
                      <div className="mt-2 rounded-xl border border-red-200 bg-white/70 px-3 py-2">
                        <div className="text-xs font-black uppercase tracking-wide text-red-700">{t('orderRejectReasonLabel')}</div>
                        <div className="mt-0.5 text-sm font-bold text-red-900">{detail.review_note}</div>
                      </div>
                    )}
                    {isPostOrder && shipped && detail.tracking_number && (
                      <div className="mt-3 rounded-xl border border-green-200 bg-white/80 p-3">
                        <div className="text-xs font-black uppercase tracking-wide text-green-700">
                          {[detail.shipping_carrier, t('orderTrackingNumberLabel')].filter(Boolean).join(' · ')}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <code className="min-w-0 flex-1 break-all rounded-lg bg-gray-950 px-3 py-2 font-mono text-sm font-black tracking-wide text-white">
                            {detail.tracking_number}
                          </code>
                          <button
                            type="button"
                            onClick={handleCopyTracking}
                            aria-label={t('orderCopyTracking')}
                            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-lg border border-green-200 bg-green-50 px-3 text-xs font-black text-green-700 hover:bg-green-100"
                          >
                            {trackingCopied ? <Check size={15} /> : <Copy size={15} />}
                            {trackingCopied ? t('orderCopied') : t('orderCopy')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {terminal && (
                  <div className="mt-3 grid gap-2">
                    {detail.artist_facebook_url && (
                      <a
                        href={detail.artist_facebook_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-gray-300 bg-white px-4 text-sm font-black text-gray-800 hover:bg-gray-50"
                      >
                        {t('orderContactSeller')} · {detail.artist_name}
                      </a>
                    )}
                    <Link
                      to={`/${slug}/menu`}
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-pink-600 px-4 text-sm font-black text-white hover:bg-pink-700"
                    >
                      {t('orderOrderAgain')}
                    </Link>
                  </div>
                )}
              </section>
            )}

            {/* Pickup code */}
            {!terminal && (
              <section className="rounded-2xl border border-pink-100 bg-white p-4 text-center">
                <div className="text-xs font-black uppercase tracking-wide text-gray-500">
                  {codeShowableAtBooth ? t('orderCodeLabel') : t('orderCodePendingLabel')}
                </div>
                <div className="mt-1 font-mono text-3xl font-black tracking-[0.18em] text-gray-950">{detail.pickup_code}</div>
                <p className="mt-1 text-sm font-medium text-gray-600">
                  {isPostOrder ? t('orderCodePostHint') : codeShowableAtBooth ? t('orderShowCodeHint') : t('orderCodePendingHint')}
                </p>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="mt-3 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-pink-200 bg-pink-50 px-4 text-sm font-bold text-pink-700 hover:bg-pink-100"
                >
                  {linkCopied ? <Check size={15} /> : <Copy size={15} />} {t('orderSaveLinkHint')}
                </button>
              </section>
            )}

            {/* Inline feedback */}
            {feedback && (
              <div
                role="status"
                className={`rounded-2xl border p-3 text-sm font-bold ${
                  feedback.tone === 'success' ? 'border-green-200 bg-green-50 text-green-900'
                    : feedback.tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900'
                    : 'border-red-200 bg-red-50 text-red-900'
                }`}
              >
                <div>{feedback.title}</div>
                {feedback.detail && <div className="mt-0.5 font-medium opacity-90">{feedback.detail}</div>}
              </div>
            )}

            {/* Payment instructions + slip upload */}
            {(awaitingPayment || canResubmit) && (
              <section className="rounded-2xl border border-pink-100 bg-white p-4">
                <h2 className="text-sm font-black text-gray-900">{t('orderPayTitle')}</h2>
                {canResubmit && (
                  <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">
                    {t('orderResubmitNote')}
                  </div>
                )}
                {awaitingPayment && detail.payment_deadline_at && (
                  <div className={`mt-2 rounded-xl border px-3 py-2 text-sm font-bold ${deadlinePassed ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                    {deadlinePassed
                      ? t('orderPayDeadlinePassed')
                      : t('orderPayDeadline', { date: formatDate(detail.payment_deadline_at) })}
                    {!deadlinePassed && countdown && (
                      <span className="ml-2 font-mono font-black">{t('orderPayDeadlineCountdown', { time: countdown })}</span>
                    )}
                  </div>
                )}
                <div className="mt-3 space-y-2">
                  {detail.payment_methods.length === 0 ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">
                      {t('orderPayNoMethods')}
                    </div>
                  ) : (
                    detail.payment_methods.map((method) => (
                      <div key={method.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                        <div className="text-sm font-black text-gray-900">{method.display_name || method.method_type}</div>
                        {method.promptpay_id && (
                          <div className="mt-0.5 text-base font-black tracking-wide text-gray-900">PromptPay: {method.promptpay_id}</div>
                        )}
                        {method.account_number && (
                          <div className="mt-0.5 text-base font-black tracking-wide text-gray-900">
                            {[method.bank_name, method.account_number].filter(Boolean).join(' · ')}
                          </div>
                        )}
                        {method.account_name && <div className="text-sm font-bold text-gray-700">{method.account_name}</div>}
                        {method.qr_image_url && (
                          <img
                            src={method.qr_image_url}
                            alt={`${method.display_name || method.method_type} QR`}
                            loading="lazy"
                            className="mt-2 h-40 w-40 rounded-xl border border-gray-200 object-contain"
                          />
                        )}
                        {method.instructions && <div className="mt-1 text-sm font-medium text-gray-600">{method.instructions}</div>}
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-4">
                  <label htmlFor="order-slip-input" className="text-xs font-black uppercase tracking-wide text-gray-600">
                    {t('orderUploadLabel')}
                  </label>
                  <input
                    ref={fileInputRef}
                    id="order-slip-input"
                    type="file"
                    accept="image/*,.pdf"
                    disabled={deadlinePassed}
                    onChange={(event) => handleSlipChange(event.target.files?.[0] || null)}
                    className="sr-only"
                  />
                  {slipFile ? (
                    <div className="mt-2 flex items-center gap-3 rounded-xl border border-pink-200 bg-pink-50/60 p-3">
                      {slipPreviewUrl ? (
                        <img src={slipPreviewUrl} alt="" className="h-16 w-16 rounded-lg border border-pink-100 object-cover" />
                      ) : (
                        <div className="grid h-16 w-16 place-items-center rounded-lg border border-pink-100 bg-white text-xs font-black text-pink-600">PDF</div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold text-gray-900">{slipFile.name}</div>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={deadlinePassed}
                          className="mt-1 inline-flex min-h-11 items-center rounded-lg border border-pink-200 bg-white px-3 text-xs font-black text-pink-700 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {t('orderUploadChange')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={deadlinePassed}
                      className="mt-2 flex min-h-14 w-full items-center justify-center rounded-xl border-2 border-dashed border-pink-200 bg-pink-50/40 px-3 text-sm font-bold text-pink-700 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t('orderUploadHint')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleSubmitSlip}
                    disabled={!slipFile || submitting || deadlinePassed}
                    className="mt-3 min-h-12 w-full rounded-xl bg-pink-600 px-4 text-sm font-black text-white shadow-sm hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? t('orderSubmitting') : canResubmit ? t('orderSubmitNewSlip') : t('orderSubmitSlip')}
                  </button>
                  {awaitingPayment && (
                    <button
                      type="button"
                      onClick={() => setCancelOpen(true)}
                      className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-xl border border-red-200 bg-white px-4 text-sm font-bold text-red-700 hover:bg-red-50"
                    >
                      <XCircle size={15} /> {t('orderCancelOrder')}
                    </button>
                  )}
                </div>
              </section>
            )}

            {/* Items */}
            <section className="rounded-2xl border border-pink-100 bg-white p-4">
              <h2 className="text-sm font-black text-gray-900">{t('orderItemsTitle')}</h2>
              <ul className="mt-2 divide-y divide-gray-100">
                {detail.items.map((item) => (
                  <li key={item.product_id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-gray-900">{item.name}</div>
                      <div className="text-xs font-medium text-gray-500">x {item.quantity}</div>
                    </div>
                    <div className="shrink-0 text-sm font-black text-gray-900">
                      {formatPrice(item.price_per_unit * item.quantity, item.currency)}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center justify-between border-t border-gray-200 pt-2">
                <span className="text-sm font-bold text-gray-700">{t('orderTotalLabel')}</span>
                <span className="text-lg font-black text-gray-950">{formatPrice(detail.total_price, detail.currency)}</span>
              </div>
              {isPostOrder && detail.shipping_address && (
                <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                  <div className="text-xs font-black uppercase tracking-wide text-gray-500">{t('orderShippingAddressLabel')}</div>
                  <div className="mt-1 whitespace-pre-line text-sm font-semibold leading-6 text-gray-800">{detail.shipping_address}</div>
                </div>
              )}
              <div className="mt-2 text-xs font-medium text-gray-500">
                {detail.event_name} · {detail.customer_name}
                {detail.customer_email_masked ? ` · ${detail.customer_email_masked}` : ''}
              </div>
            </section>

            <p className="px-1 text-center text-xs font-medium text-gray-500">{t('orderTrustNote')}</p>
          </>
        )}
      </div>

      <ConfirmDialog
        open={cancelOpen}
        title={t('orderCancelConfirmTitle')}
        detail={t('orderCancelConfirmDetail')}
        tone="danger"
        loading={cancelling}
        confirmLabel={t('orderCancelOrder')}
        onConfirm={handleCancel}
        onCancel={() => setCancelOpen(false)}
      />
    </main>
  );
};

export default OrderStatus;
