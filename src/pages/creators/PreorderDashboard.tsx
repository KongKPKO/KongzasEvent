import { useI18n } from '../../i18n';
import { eventCopy } from '../../lib/eventCopy';
import EvidenceReview from '../../components/EvidenceReview';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle, Download, Eye, ReceiptText, RefreshCw, Search, Truck, XCircle } from 'lucide-react';
import AdminHeader from '../../components/AdminHeader';
import EventNavTabs from '../../components/EventNavTabs';
import { ConfirmDialog, Toast } from '../../components/ui/Feedback';
import {
  confirmPreorderPayment,
  createPaymentEvidenceSignedUrl,
  getPreorderErrorMessage,
  listPreorderPaymentReview,
  listPreorderProductionSummary,
  markOrderShipped,
  notifyPreorderPayment,
  rejectPreorderPayment,
} from '../../lib/preorders';
import { supabase } from '../../supabaseClient';
import type { ActorContext } from '../../types/access';
import type { PaymentStatus, PreorderPaymentReviewRow, PreorderProductionSummaryRow } from '../../types/preorder';
import { formatPrice } from '../../utils/currency';

interface PreorderDashboardProps {
  actorContext: ActorContext;
  // Which order timeline this dashboard reviews. Pre-order and post-event are
  // separate tabs so a finished pre-order phase stays viewable after the event
  // flips to its post-event store.
  scope?: 'preorder' | 'post_event';
}

interface EventInfo {
  id: string;
  event_name: string;
  selling_mode?: string | null;
}

type ReviewAction =
  | { type: 'confirm'; order: PreorderPaymentReviewRow }
  | { type: 'reject'; order: PreorderPaymentReviewRow }
  | { type: 'ship'; order: PreorderPaymentReviewRow }
  | null;

type StatusFilter = 'needs_review' | 'to_ship' | 'confirmed' | 'closed' | 'all';

const statusLabels: Record<PaymentStatus, string> = {
  awaiting_payment: 'Awaiting payment',
  payment_submitted: 'Needs review',
  payment_confirmed: 'Confirmed',
  payment_rejected: 'Rejected',
  payment_expired: 'Expired',
  payment_cancelled: 'Cancelled',
};

const statusClasses: Record<PaymentStatus, string> = {
  awaiting_payment: 'border-gray-200 bg-gray-50 text-gray-700',
  payment_submitted: 'border-amber-200 bg-amber-50 text-amber-800',
  payment_confirmed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  payment_rejected: 'border-red-200 bg-red-50 text-red-700',
  payment_expired: 'border-slate-200 bg-slate-50 text-slate-700',
  payment_cancelled: 'border-gray-200 bg-gray-50 text-gray-600',
};

const CLOSED_STATUSES: PaymentStatus[] = ['payment_rejected', 'payment_expired', 'payment_cancelled'];

const toNumber = (value: unknown) => Number(value || 0);

export default function PreorderDashboard({ actorContext, scope = 'preorder' }: PreorderDashboardProps) {
  const { language } = useI18n();
  const copy = (value: string) => language === 'th' && value === 'Confirmed' ? 'ยืนยันชำระเงินแล้ว' : eventCopy(language, value);

  const { eventId } = useParams();
  const [eventInfo, setEventInfo] = useState<EventInfo | null>(null);
  const [summary, setSummary] = useState<PreorderProductionSummaryRow[]>([]);
  const [orders, setOrders] = useState<PreorderPaymentReviewRow[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<StatusFilter>('needs_review');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [reviewAction, setReviewAction] = useState<ReviewAction>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [shippingCarrier, setShippingCarrier] = useState('');
  const [canShip, setCanShip] = useState(false);
  const [slipPreview, setSlipPreview] = useState<{ order: PreorderPaymentReviewRow; url: string } | null>(null);
  const [slipLoadingId, setSlipLoadingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone?: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string } | null>(null);
  const [failedNotification, setFailedNotification] = useState<{ orderId: string; event: 'confirmed' | 'rejected'; pickupCode: string } | null>(null);
  const [notificationRetrying, setNotificationRetrying] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!eventId) return;
    if (!silent) setLoading(true);
    try {
      const [{ data: eventData, error: eventError }, summaryData, reviewData, shippingAccess] = await Promise.all([
        supabase
          .from('events')
          .select('id, event_name, selling_mode')
          .eq('id', eventId)
          .eq('artist_id', actorContext.artist_id)
          .maybeSingle(),
        listPreorderProductionSummary(eventId),
        listPreorderPaymentReview(eventId, null),
        supabase.rpc('has_shipping_access', { p_artist_id: actorContext.artist_id }),
      ]);

      if (eventError) throw eventError;
      if (shippingAccess.error) throw shippingAccess.error;
      setCanShip(shippingAccess.data === true);
      setEventInfo((eventData || null) as EventInfo | null);
      setSummary(summaryData);
      setOrders(reviewData.filter((order) => (scope === 'post_event' ? order.order_type === 'post_event' : order.order_type !== 'post_event')));
    } catch (error) {
      setToast({ tone: 'error', title: 'Could not load pre-order dashboard', detail: getPreorderErrorMessage(error) });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [actorContext.artist_id, eventId, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live updates: refresh quietly whenever orders or payments change for this event.
  useEffect(() => {
    if (!eventId) return;
    let timer: number | null = null;
    const queueReload = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(true), 800);
    };
    const channel = supabase
      .channel(`preorder-dashboard-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `event_id=eq.${eventId}` }, queueReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_payments' }, queueReload)
      .subscribe();
    return () => {
      if (timer) window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [eventId, load]);

  const totals = useMemo(() => {
    const submitted = orders.filter((order) => order.payment_status === 'payment_submitted');
    const confirmed = orders.filter((order) => order.payment_status === 'payment_confirmed');
    const closed = orders.filter((order) => CLOSED_STATUSES.includes(order.payment_status));
    const toShip = orders.filter((order) => order.order_type === 'post_event'
      && order.payment_status === 'payment_confirmed'
      && order.pickup_status === 'awaiting_shipment');
    const currency = orders[0]?.currency || 'THB';
    return {
      submittedCount: submitted.length,
      confirmedCount: confirmed.length,
      closedCount: closed.length,
      toShipCount: toShip.length,
      expectedAmount: summary.reduce((sum, row) => sum + toNumber(row.expected_amount), 0),
      confirmedAmount: summary.reduce((sum, row) => sum + toNumber(row.confirmed_amount), 0),
      currency,
    };
  }, [orders, summary]);

  const visibleOrders = useMemo(() => {
    let rows = orders;
    if (filter === 'needs_review') rows = rows.filter((order) => order.payment_status === 'payment_submitted');
    if (filter === 'to_ship') rows = rows.filter((order) => order.order_type === 'post_event'
      && order.payment_status === 'payment_confirmed'
      && order.pickup_status === 'awaiting_shipment');
    if (filter === 'confirmed') rows = rows.filter((order) => order.payment_status === 'payment_confirmed');
    if (filter === 'closed') rows = rows.filter((order) => CLOSED_STATUSES.includes(order.payment_status));
    const query = search.trim().toLowerCase();
    if (query) {
      rows = rows.filter((order) => [
        order.pickup_code,
        order.customer_name,
        order.customer_email,
        order.customer_phone,
        order.customer_social,
        order.customer_contact,
        order.shipping_address,
        order.tracking_number,
        order.shipping_carrier,
        ...order.items.map((item) => item.name),
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query)));
    }
    return rows;
  }, [orders, filter, search]);

  const openSlip = async (order: PreorderPaymentReviewRow) => {
    if (!order.slip_url) return;
    const cached = signedUrls[order.slip_url];
    if (cached) {
      setSlipPreview({ order, url: cached });
      return;
    }
    setSlipLoadingId(order.order_id);
    try {
      const url = await createPaymentEvidenceSignedUrl(order.slip_url);
      setSignedUrls((prev) => ({ ...prev, [order.slip_url as string]: url }));
      setSlipPreview({ order, url });
    } catch (error) {
      setToast({ tone: 'error', title: 'Could not open slip', detail: getPreorderErrorMessage(error) });
    } finally {
      setSlipLoadingId(null);
    }
  };

  const exportCsv = () => {
    const rows = [
      ['Product', 'Category', 'Submitted', 'Confirmed', 'Rejected', 'To prepare', 'Expected amount', 'Confirmed amount'],
      ...summary.map((row) => [
        row.product_name,
        row.category || '',
        String(row.submitted_quantity),
        String(row.confirmed_quantity),
        String(row.rejected_quantity),
        String(row.total_to_prepare),
        String(row.expected_amount),
        String(row.confirmed_amount),
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `preorder-production-${eventInfo?.event_name || eventId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const runReviewAction = async () => {
    if (!reviewAction) return;
    setActionLoading(true);
    try {
      const targetOrder = reviewAction.order;
      if (reviewAction.type === 'confirm') {
        await confirmPreorderPayment(targetOrder.order_id);
        setOrders((prev) => prev.map((order) => (
          order.order_id === targetOrder.order_id
            ? {
              ...order,
              payment_status: 'payment_confirmed' as PaymentStatus,
              pickup_status: order.order_type === 'post_event' ? 'awaiting_shipment' : 'awaiting_pickup',
              confirmed_at: new Date().toISOString(),
            }
            : order
        )));
        const { error: notifyError } = await notifyPreorderPayment({ orderId: targetOrder.order_id, event: 'confirmed' });
        setFailedNotification(notifyError ? { orderId: targetOrder.order_id, event: 'confirmed', pickupCode: targetOrder.pickup_code } : null);
        const readyMessage = targetOrder.order_type === 'post_event'
          ? `${targetOrder.pickup_code} is ready for shipment.`
          : `${targetOrder.pickup_code} is ready for pickup.`;
        setToast({
          tone: notifyError ? 'warning' : 'success',
          title: 'Payment confirmed',
          detail: notifyError
            ? `${readyMessage} Email was not sent. Use Retry email; the payment will not be confirmed twice.`
            : `${readyMessage} Customer email was sent.`,
        });
      } else if (reviewAction.type === 'reject') {
        const note = reviewNote.trim();
        if (!note) {
          setToast({ tone: 'warning', title: 'Reject reason required', detail: 'Add a short explanation for the customer before rejecting.' });
          return;
        }
        await rejectPreorderPayment(targetOrder.order_id, note);
        setOrders((prev) => prev.map((order) => (
          order.order_id === targetOrder.order_id
            ? { ...order, payment_status: 'payment_rejected' as PaymentStatus, rejected_at: new Date().toISOString(), review_note: note }
            : order
        )));
        const { error: notifyError } = await notifyPreorderPayment({ orderId: targetOrder.order_id, event: 'rejected' });
        setFailedNotification(notifyError ? { orderId: targetOrder.order_id, event: 'rejected', pickupCode: targetOrder.pickup_code } : null);
        setToast({
          tone: notifyError ? 'warning' : 'success',
          title: 'Payment rejected',
          detail: notifyError
            ? 'Reserved stock was released. Email was not sent; use Retry email.'
            : 'Reserved stock was released and the customer email was sent.',
        });
      } else {
        const tracking = trackingNumber.trim();
        const carrier = shippingCarrier.trim();
        if (!tracking) {
          setToast({ tone: 'warning', title: 'Tracking number required', detail: 'Add the shipment tracking number before marking this order shipped.' });
          return;
        }
        const result = await markOrderShipped(targetOrder.order_id, tracking, carrier);
        setOrders((prev) => prev.map((order) => (
          order.order_id === targetOrder.order_id
            ? {
              ...order,
              pickup_status: 'shipped',
              tracking_number: tracking,
              shipping_carrier: carrier || null,
              shipped_at: result.shipped_at,
            }
            : order
        )));
        setToast({
          tone: 'success',
          title: 'Order marked shipped',
          detail: `${targetOrder.pickup_code} · ${tracking}`,
        });
      }
      setReviewAction(null);
      setReviewNote('');
      setTrackingNumber('');
      setShippingCarrier('');
      void load(true);
    } catch (error) {
      setToast({ tone: 'error', title: 'Review failed', detail: getPreorderErrorMessage(error) });
    } finally {
      setActionLoading(false);
    }
  };

  const retryFailedNotification = async () => {
    if (!failedNotification || notificationRetrying) return;
    setNotificationRetrying(true);
    const { error } = await notifyPreorderPayment({
      orderId: failedNotification.orderId,
      event: failedNotification.event,
    });
    setNotificationRetrying(false);
    if (error) {
      setToast({ tone: 'warning', title: 'Email still not sent', detail: 'The order state is already saved. Try the email again later.' });
      return;
    }
    setToast({ tone: 'success', title: 'Customer email sent', detail: `${failedNotification.pickupCode} notification delivered without repeating the payment action.` });
    setFailedNotification(null);
  };

  const statCards: Array<{ key: StatusFilter; label: string; value: string; classes: string; activeClasses: string }> = [
    {
      key: 'needs_review',
      label: 'Needs review',
      value: String(totals.submittedCount),
      classes: 'border-amber-100 bg-amber-50 text-amber-700',
      activeClasses: 'ring-2 ring-amber-400 border-amber-300',
    },
    ...(scope === 'post_event' ? [{
      key: 'to_ship' as StatusFilter,
      label: 'To ship',
      value: String(totals.toShipCount),
      classes: 'border-violet-100 bg-violet-50 text-violet-700',
      activeClasses: 'ring-2 ring-violet-400 border-violet-300',
    }] : []),
    {
      key: 'confirmed',
      label: 'Confirmed',
      value: String(totals.confirmedCount),
      classes: 'border-emerald-100 bg-emerald-50 text-emerald-700',
      activeClasses: 'ring-2 ring-emerald-400 border-emerald-300',
    },
    {
      key: 'closed',
      label: 'Rejected / expired',
      value: String(totals.closedCount),
      classes: 'border-red-100 bg-red-50 text-red-700',
      activeClasses: 'ring-2 ring-red-300 border-red-300',
    },
    {
      key: 'all',
      label: 'All orders',
      value: String(orders.length),
      classes: 'border-gray-200 bg-white text-gray-600',
      activeClasses: 'ring-2 ring-gray-400 border-gray-300',
    },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader activePage="events" actorRole={actorContext.role} userEmail={actorContext.member_email} />
        <div className="p-10 text-center text-sm font-bold text-gray-400">{copy("Loading pre-order dashboard...")}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader
        activePage="events"
        activeEvent={eventInfo ? { id: eventInfo.id, event_name: eventInfo.event_name } : null}
        actorRole={actorContext.role}
        userEmail={actorContext.member_email}
      />
      <Toast message={toast ? { ...toast, title: copy(toast.title), detail: toast.detail ? copy(toast.detail) : undefined } : null} onClose={() => setToast(null)} />
      <ConfirmDialog
        open={Boolean(reviewAction)}
        title={
          reviewAction?.type === 'confirm'
            ? copy("Confirm transfer received?")
            : reviewAction?.type === 'ship'
              ? copy("Mark order shipped?")
              : copy("Reject payment?")
        }
        detail={
          reviewAction
            ? language === 'th'
              ? `${reviewAction.order.pickup_code} · ${reviewAction.order.customer_name}\n${reviewAction.type === 'confirm' ? 'ยืนยันว่าตรวจหลักฐานและได้รับเงินโอนแล้ว NireQ ไม่ได้ตรวจบัญชีธนาคารให้ ออเดอร์จะเข้าสู่รายการเตรียมส่งมอบ' : reviewAction.type === 'ship' ? 'กรอกเลขติดตามพัสดุที่ลูกค้าจะเห็นในหน้าออเดอร์' : 'การไม่รับสลิปจะยกเลิกออเดอร์และคืนสต็อกที่จอง หากลูกค้าโอนแล้วแต่แนบสลิปผิด ควรติดต่อให้ชัดเจนก่อน'}`
              : reviewAction.type === 'confirm'
              ? `${reviewAction.order.pickup_code} · ${reviewAction.order.customer_name}\nYou are confirming that you checked the evidence and received the transfer. Nireq does not verify the bank transaction. The order will move to ${reviewAction.order.order_type === 'post_event' ? 'the shipment list.' : 'the pickup list.'}`
              : reviewAction.type === 'ship'
                ? `${reviewAction.order.pickup_code} · ${reviewAction.order.customer_name}\nAdd the tracking number customers will see on their order page.`
                : `${reviewAction.order.pickup_code} · ${reviewAction.order.customer_name}\nRejecting cancels this order and releases the reserved stock. If the customer actually paid (for example, a wrong slip was attached), contact them first instead of rejecting.`
            : ''
        }
        confirmLabel={
          reviewAction?.type === 'confirm'
            ? copy("Confirm transfer received")
            : reviewAction?.type === 'ship'
              ? copy("Mark shipped")
              : copy("Reject payment")
        }
        tone={reviewAction?.type === 'reject' ? 'danger' : 'default'}
        loading={actionLoading}
        confirmDisabled={
          (reviewAction?.type === 'reject' && reviewNote.trim().length === 0)
          || (reviewAction?.type === 'ship' && trackingNumber.trim().length === 0)
        }
        onConfirm={runReviewAction}
        onCancel={() => {
          setReviewAction(null);
          setReviewNote('');
          setTrackingNumber('');
          setShippingCarrier('');
        }}
      >
        {reviewAction?.type === 'reject' && (
          <label className="mt-4 block">
            <span className="text-xs font-black uppercase tracking-wide text-red-700">{copy("Reject reason (sent to the customer)")}</span>
            <textarea
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              rows={3}
              placeholder={copy("Example: Transfer amount does not match, duplicate slip, or payment not found.")}
              className="mt-1 w-full resize-none rounded-xl border border-red-100 bg-red-50/50 px-3 py-2 text-sm font-bold text-red-950 outline-none focus:border-red-300 focus:ring-4 focus:ring-red-100"
            />
          </label>
        )}
        {reviewAction?.type === 'ship' && (
          <div className="mt-4 grid gap-3">
            <label className="block">
              <span className="text-xs font-black uppercase tracking-wide text-emerald-700">{copy("Tracking number")}</span>
              <input
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value)}
                placeholder={copy("Tracking number")}
                className="mt-1 min-h-11 w-full rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 text-sm font-bold text-emerald-950 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
              />
            </label>
            <label className="block">
              <span className="text-xs font-black uppercase tracking-wide text-gray-600">{copy("Carrier (e.g. Kerry, Flash, ไปรษณีย์ไทย)")}</span>
              <input
                value={shippingCarrier}
                onChange={(event) => setShippingCarrier(event.target.value)}
                placeholder={copy("Carrier")}
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
              />
            </label>
          </div>
        )}
      </ConfirmDialog>
      {slipPreview && <EvidenceReview title={`Payment slip for ${slipPreview.order.pickup_code}`} closeLabel="Close slip preview" code={slipPreview.order.pickup_code} customer={slipPreview.order.customer_name} amount={slipPreview.order.total_price} currency={slipPreview.order.currency} url={slipPreview.url} items={slipPreview.order.items} onClose={() => setSlipPreview(null)}>
            {slipPreview.order.payment_status === 'payment_submitted' && (
              <div className="grid grid-cols-2 gap-2 border-t border-gray-100 px-4 py-3">
                <button
                  type="button"
                  onClick={() => {
                    const order = slipPreview.order;
                    setSlipPreview(null);
                    setReviewAction({ type: 'reject', order });
                  }}
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-black text-red-700 hover:bg-red-100"
                >
                  <XCircle size={15} /> {copy("Reject")}</button>
                <button
                  type="button"
                  onClick={() => {
                    const order = slipPreview.order;
                    setSlipPreview(null);
                    setReviewAction({ type: 'confirm', order });
                  }}
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-sm font-black text-white hover:bg-emerald-700"
                >
                  <CheckCircle size={15} /> {copy("Confirm")}</button>
              </div>
            )}
      </EvidenceReview>}

      <main className="merchant-orders mx-auto max-w-6xl p-4 md:p-6">
        {eventId && <EventNavTabs eventId={eventId} active={scope === 'post_event' ? 'postorder' : 'preorder'} actorRole={actorContext.role} sellingMode={eventInfo?.selling_mode} />}
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void load()}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-xs font-black text-gray-700 hover:bg-gray-50"
            >
              <RefreshCw size={15} /> {copy("Refresh")}</button>
            <button
              onClick={exportCsv}
              disabled={summary.length === 0}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-gray-950 px-3 text-xs font-black text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={15} /> {copy("Export CSV")}</button>
          </div>
        </div>

        <section className="mb-5 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <ReceiptText className="text-pink-600" size={24} />
            <h1 className="text-2xl font-black text-gray-900">{scope === 'post_event' ? copy("Post-order Dashboard") : copy("Pre-order Dashboard")}</h1>
          </div>
          <p className="mt-1 text-sm font-semibold text-gray-500">{eventInfo?.event_name || copy("Event")} · {scope === 'post_event' ? copy("Review transfers, then ship orders") : copy("Review transfers, then prepare production")}</p>
          <p className="mt-2 text-xs font-semibold leading-5 text-gray-500">{copy("Customers pay the creator directly. Nireq stores private evidence for your review; you decide whether to confirm or reject it.")}</p>
        </section>

        {failedNotification && (
          <section className="mb-5 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between" role="status">
            <div>
              <p className="text-sm font-black text-amber-900">{copy("Order saved · email not sent")}</p>
              <p className="mt-1 text-xs font-semibold text-amber-800">{copy("Retry only sends the email for")}{failedNotification.pickupCode}{copy("; it does not repeat payment, stock, or fulfillment changes.")}</p>
            </div>
            <button type="button" onClick={retryFailedNotification} disabled={notificationRetrying} className="min-h-11 rounded-xl bg-amber-900 px-4 text-sm font-black text-white hover:bg-amber-950 disabled:opacity-60">
              {notificationRetrying ? copy("Sending…") : copy("Retry email")}
            </button>
          </section>
        )}

        <section aria-label={copy("Order status filters")} className={`mb-5 grid grid-cols-2 gap-3 ${scope === 'post_event' ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
          {statCards.map((card) => (
            <button
              key={card.key}
              type="button"
              onClick={() => setFilter(card.key)}
              aria-pressed={filter === card.key}
              className={`rounded-xl border p-4 text-left transition-shadow hover:shadow-md ${card.classes} ${filter === card.key ? card.activeClasses : ''}`}
            >
              <div className="text-xs font-black uppercase tracking-wide">{copy(card.label)}</div>
              <div className="mt-1 text-2xl font-black text-gray-950">{card.value}</div>
            </button>
          ))}
        </section>

        <section className="mb-5 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <h2 className="text-lg font-black text-gray-900">
              {filter === 'needs_review' ? `${language === 'th' ? 'รอตรวจสลิป' : 'Review queue'} (${visibleOrders.length})` : filter === 'to_ship' ? `${language === 'th' ? 'รอจัดส่ง' : 'Shipping queue'} (${visibleOrders.length})` : copy("Orders")}
            </h2>
            <label className="relative block md:w-72">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={copy("Search code, name, contact, product")}
                aria-label={copy("Search orders")}
                className="min-h-11 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm font-bold outline-none focus:border-pink-300 focus:ring-4 focus:ring-pink-100"
              />
            </label>
          </div>
          {visibleOrders.length === 0 ? (
            <div className="p-6 text-sm font-bold text-gray-400">
              {filter === 'needs_review' && !search
                ? copy("No slips waiting for review — all caught up.")
                : filter === 'to_ship' && !search
                  ? copy("Nothing waiting to ship.")
                  : copy("No orders match this view.")}
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {visibleOrders.map((order) => (
                <div key={order.order_id} className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-lg font-black tracking-[0.12em] text-gray-950">{order.pickup_code}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-black ${statusClasses[order.payment_status]}`}>
                        {copy(statusLabels[order.payment_status])}
                      </span>
                      {order.order_type === 'post_event' && (
                        <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-black text-violet-700">
                          {copy("Post · ship")}</span>
                      )}
                    </div>
                    <div className="mt-1 text-sm font-black text-gray-900">{order.customer_name}</div>
                    <div className="mt-1 text-xs font-bold text-gray-500">
                      {[order.customer_phone, order.customer_social, order.customer_email].filter(Boolean).join(' · ') || order.customer_contact || 'No contact'}
                    </div>
                    {order.order_type === 'post_event' && order.shipping_address && (
                      <div
                        className="mt-1 max-w-xl truncate text-xs font-bold text-sky-700"
                        title={order.shipping_address}
                      >
                        {copy("Ship to:")}{order.shipping_address}
                      </div>
                    )}
                    <div className="mt-2 text-xs font-semibold text-gray-600">
                      {order.items.map((item) => `${item.quantity}x ${item.name}`).join(', ')}
                    </div>
                    {order.order_type === 'post_event' && order.pickup_status === 'shipped' && order.tracking_number && (
                      <div className="mt-2 inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-black text-emerald-700">
                        <Truck size={13} /> <span className="truncate">{copy("Shipped ·")}{order.tracking_number}</span>
                      </div>
                    )}
                    {order.review_note && CLOSED_STATUSES.includes(order.payment_status) && (
                      <div className="mt-2 rounded-lg border border-red-100 bg-red-50/60 px-2 py-1 text-xs font-bold text-red-700">
                        {copy("Reason:")}{order.review_note}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <div className="mr-2 text-right">
                      <div className="text-xs font-bold text-gray-500">{copy("Amount")}</div>
                      <div className="text-sm font-black text-gray-950">{formatPrice(order.total_price, order.currency)}</div>
                    </div>
                    {order.slip_url && (
                      <button
                        type="button"
                        onClick={() => void openSlip(order)}
                        disabled={slipLoadingId === order.order_id}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-black text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <Eye size={14} /> {slipLoadingId === order.order_id ? copy("Opening…") : copy("Slip")}
                      </button>
                    )}
                    {order.payment_status === 'payment_submitted' && (
                      <>
                        <button
                          onClick={() => setReviewAction({ type: 'reject', order })}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-black text-red-700 hover:bg-red-100"
                        >
                          <XCircle size={15} /> {copy("Reject")}</button>
                        <button
                          onClick={() => setReviewAction({ type: 'confirm', order })}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-black text-white hover:bg-emerald-700"
                        >
                          <CheckCircle size={15} /> {copy("Confirm")}</button>
                      </>
                    )}
                    {canShip && order.order_type === 'post_event'
                      && order.payment_status === 'payment_confirmed'
                      && order.pickup_status === 'awaiting_shipment' && (
                        <button
                          onClick={() => setReviewAction({ type: 'ship', order })}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-black text-white hover:bg-emerald-700"
                        >
                          <Truck size={15} /> {copy("Mark shipped")}</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mb-5 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-pink-100 bg-pink-50 p-4">
            <div className="text-xs font-black uppercase tracking-wide text-pink-700">{copy("Expected revenue")}</div>
            <div className="mt-1 text-2xl font-black text-gray-950">{formatPrice(totals.expectedAmount, totals.currency)}</div>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
            <div className="text-xs font-black uppercase tracking-wide text-emerald-700">{copy("Confirmed revenue")}</div>
            <div className="mt-1 text-2xl font-black text-gray-950">{formatPrice(totals.confirmedAmount, totals.currency)}</div>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-lg font-black text-gray-900">{copy("Production Summary")}</h2>
          </div>
          {summary.length === 0 ? (
            <div className="p-6 text-sm font-bold text-gray-400">{copy("No submitted or confirmed pre-orders yet.")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs font-black uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">{copy("Product")}</th>
                    <th className="px-4 py-3">{copy("Needs review")}</th>
                    <th className="px-4 py-3">{copy("Confirmed")}</th>
                    <th className="px-4 py-3">{copy("To prepare")}</th>
                    <th className="px-4 py-3">{copy("Expected")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {summary.map((row) => (
                    <tr key={row.product_id}>
                      <td className="px-4 py-3">
                        <div className="font-black text-gray-900">{row.product_name}</div>
                        <div className="text-xs font-semibold text-gray-500">{row.category || 'Uncategorized'}</div>
                      </td>
                      <td className="px-4 py-3 font-bold text-amber-700">{row.submitted_quantity}</td>
                      <td className="px-4 py-3 font-bold text-emerald-700">{row.confirmed_quantity}</td>
                      <td className="px-4 py-3 text-lg font-black text-gray-950">{row.total_to_prepare}</td>
                      <td className="px-4 py-3 font-bold text-gray-700">{formatPrice(row.expected_amount, totals.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
