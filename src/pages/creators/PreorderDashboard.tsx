import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle, Download, Eye, ReceiptText, RefreshCw, X, XCircle } from 'lucide-react';
import AdminHeader from '../../components/AdminHeader';
import { ConfirmDialog, Toast } from '../../components/ui/Feedback';
import {
  confirmPreorderPayment,
  createPaymentEvidenceSignedUrl,
  getPreorderErrorMessage,
  listPreorderPaymentReview,
  listPreorderProductionSummary,
  notifyPreorderPayment,
  rejectPreorderPayment,
} from '../../lib/preorders';
import { supabase } from '../../supabaseClient';
import type { ActorContext } from '../../types/access';
import type { PaymentStatus, PreorderPaymentReviewRow, PreorderProductionSummaryRow } from '../../types/preorder';
import { formatPrice } from '../../utils/currency';

interface PreorderDashboardProps {
  actorContext: ActorContext;
}

interface EventInfo {
  id: string;
  event_name: string;
}

type ReviewAction =
  | { type: 'confirm'; order: PreorderPaymentReviewRow }
  | { type: 'reject'; order: PreorderPaymentReviewRow }
  | null;

const statusLabels: Record<PaymentStatus, string> = {
  awaiting_payment: 'Awaiting payment',
  payment_submitted: 'Submitted',
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

const toNumber = (value: unknown) => Number(value || 0);

export default function PreorderDashboard({ actorContext }: PreorderDashboardProps) {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [eventInfo, setEventInfo] = useState<EventInfo | null>(null);
  const [summary, setSummary] = useState<PreorderProductionSummaryRow[]>([]);
  const [orders, setOrders] = useState<PreorderPaymentReviewRow[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<PaymentStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [reviewAction, setReviewAction] = useState<ReviewAction>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [slipPreview, setSlipPreview] = useState<{ order: PreorderPaymentReviewRow; url: string } | null>(null);
  const [toast, setToast] = useState<{ tone?: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string } | null>(null);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    try {
      const [{ data: eventData, error: eventError }, summaryData, reviewData] = await Promise.all([
        supabase
          .from('events')
          .select('id, event_name')
          .eq('id', eventId)
          .eq('artist_id', actorContext.artist_id)
          .maybeSingle(),
        listPreorderProductionSummary(eventId),
        listPreorderPaymentReview(eventId, filter === 'all' ? null : filter),
      ]);

      if (eventError) throw eventError;
      setEventInfo((eventData || null) as EventInfo | null);
      setSummary(summaryData);
      setOrders(reviewData);

      const submittedSlipPaths = reviewData
        .filter((order) => order.slip_url && order.payment_status === 'payment_submitted')
        .map((order) => order.slip_url as string);
      const urlPairs = await Promise.all(
        submittedSlipPaths.map(async (path) => {
          try {
            return [path, await createPaymentEvidenceSignedUrl(path)] as const;
          } catch {
            return [path, ''] as const;
          }
        })
      );
      setSignedUrls(Object.fromEntries(urlPairs.filter(([, url]) => Boolean(url))));
    } catch (error) {
      setToast({ tone: 'error', title: 'Could not load pre-order dashboard', detail: getPreorderErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  }, [actorContext.artist_id, eventId, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const submitted = orders.filter((order) => order.payment_status === 'payment_submitted');
    const confirmed = orders.filter((order) => order.payment_status === 'payment_confirmed');
    const rejected = orders.filter((order) => order.payment_status === 'payment_rejected' || order.payment_status === 'payment_expired' || order.payment_status === 'payment_cancelled');
    const currency = orders[0]?.currency || 'THB';
    return {
      submittedCount: submitted.length,
      confirmedCount: confirmed.length,
      rejectedCount: rejected.length,
      expectedAmount: summary.reduce((sum, row) => sum + toNumber(row.expected_amount), 0),
      confirmedAmount: summary.reduce((sum, row) => sum + toNumber(row.confirmed_amount), 0),
      currency,
    };
  }, [orders, summary]);

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
      if (reviewAction.type === 'confirm') {
        await confirmPreorderPayment(reviewAction.order.order_id);
        const { error: notifyError } = await notifyPreorderPayment({ orderId: reviewAction.order.order_id, event: 'confirmed' });
        setToast({
          tone: notifyError ? 'warning' : 'success',
          title: 'Payment confirmed',
          detail: notifyError
            ? `${reviewAction.order.pickup_code} is ready for pickup. Email delivery failed.`
            : `${reviewAction.order.pickup_code} is ready for pickup. Customer email was sent.`,
        });
      } else {
        const note = reviewNote.trim();
        if (!note) {
          setToast({ tone: 'warning', title: 'Reject reason required', detail: 'Add a short explanation for the customer before rejecting.' });
          return;
        }
        await rejectPreorderPayment(reviewAction.order.order_id, note);
        const { error: notifyError } = await notifyPreorderPayment({ orderId: reviewAction.order.order_id, event: 'rejected' });
        setToast({
          tone: notifyError ? 'warning' : 'success',
          title: 'Payment rejected',
          detail: notifyError
            ? 'Reserved stock was released. Email delivery failed.'
            : 'Reserved stock was released and the customer email was sent.',
        });
      }
      setReviewAction(null);
      setReviewNote('');
      await load();
    } catch (error) {
      setToast({ tone: 'error', title: 'Review failed', detail: getPreorderErrorMessage(error) });
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader activePage="events" actorRole={actorContext.role} userEmail={actorContext.member_email} />
        <div className="p-10 text-center text-sm font-bold text-gray-400">Loading pre-order dashboard...</div>
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
      <Toast message={toast} onClose={() => setToast(null)} />
      <ConfirmDialog
        open={Boolean(reviewAction)}
        title={reviewAction?.type === 'confirm' ? 'Confirm payment?' : 'Reject payment?'}
        detail={
          reviewAction
            ? `${reviewAction.order.pickup_code} · ${reviewAction.order.customer_name}\n${reviewAction.type === 'confirm' ? 'Order will move to pickup list.' : 'Reserved stock will be released.'}`
            : ''
        }
        confirmLabel={reviewAction?.type === 'confirm' ? 'Confirm payment' : 'Reject payment'}
        tone={reviewAction?.type === 'reject' ? 'danger' : 'default'}
        loading={actionLoading}
        confirmDisabled={reviewAction?.type === 'reject' && reviewNote.trim().length === 0}
        onConfirm={runReviewAction}
        onCancel={() => {
          setReviewAction(null);
          setReviewNote('');
        }}
      >
        {reviewAction?.type === 'reject' && (
          <label className="mt-4 block">
            <span className="text-xs font-black uppercase tracking-wide text-red-700">Reject reason</span>
            <textarea
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              rows={3}
              placeholder="Example: Transfer amount does not match, duplicate slip, or payment not found."
              className="mt-1 w-full resize-none rounded-xl border border-red-100 bg-red-50/50 px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-red-300 focus:ring-4 focus:ring-red-100"
            />
          </label>
        )}
      </ConfirmDialog>
      {slipPreview && (
        <div className="fixed inset-0 z-[135] flex items-center justify-center bg-gray-950/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-black text-gray-950">Payment slip</div>
                <div className="truncate text-xs font-bold text-gray-500">
                  {slipPreview.order.pickup_code} · {slipPreview.order.customer_name}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSlipPreview(null)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50"
                aria-label="Close slip preview"
              >
                <X size={18} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-gray-100 p-4">
              <img
                src={slipPreview.url}
                alt={`Payment slip for ${slipPreview.order.pickup_code}`}
                className="mx-auto max-h-[72vh] max-w-full rounded-xl bg-white object-contain shadow-sm"
              />
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl p-4 md:p-6">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <button
            onClick={() => navigate(`/manage-events/${eventId}/workspace`)}
            className="inline-flex min-h-10 w-fit items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-600 hover:border-pink-200 hover:text-pink-600"
          >
            <ArrowLeft size={18} /> Back to workspace
          </button>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void load()}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-xs font-black text-gray-700 hover:bg-gray-50"
            >
              <RefreshCw size={15} /> Refresh
            </button>
            <button
              onClick={exportCsv}
              disabled={summary.length === 0}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-gray-950 px-3 text-xs font-black text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={15} /> Export CSV
            </button>
          </div>
        </div>

        <section className="mb-5 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <ReceiptText className="text-pink-600" size={24} />
            <h1 className="text-2xl font-black text-gray-900">Pre-order Dashboard</h1>
          </div>
          <p className="mt-1 text-sm font-semibold text-gray-500">{eventInfo?.event_name || 'Event'} · Prepare production and review transfers</p>
        </section>

        <section className="mb-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
            <div className="text-xs font-black uppercase tracking-wide text-amber-700">Submitted</div>
            <div className="mt-1 text-2xl font-black text-gray-950">{totals.submittedCount}</div>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
            <div className="text-xs font-black uppercase tracking-wide text-emerald-700">Confirmed</div>
            <div className="mt-1 text-2xl font-black text-gray-950">{totals.confirmedCount}</div>
          </div>
          <div className="rounded-xl border border-red-100 bg-red-50 p-4">
            <div className="text-xs font-black uppercase tracking-wide text-red-700">Released</div>
            <div className="mt-1 text-2xl font-black text-gray-950">{totals.rejectedCount}</div>
          </div>
          <div className="rounded-xl border border-pink-100 bg-pink-50 p-4">
            <div className="text-xs font-black uppercase tracking-wide text-pink-700">Expected</div>
            <div className="mt-1 text-2xl font-black text-gray-950">{formatPrice(totals.expectedAmount, totals.currency)}</div>
          </div>
        </section>

        <section className="mb-5 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-lg font-black text-gray-900">Production Summary</h2>
          </div>
          {summary.length === 0 ? (
            <div className="p-6 text-sm font-bold text-gray-400">No submitted or confirmed pre-orders yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs font-black uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Submitted</th>
                    <th className="px-4 py-3">Confirmed</th>
                    <th className="px-4 py-3">To prepare</th>
                    <th className="px-4 py-3">Expected</th>
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

        <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <h2 className="text-lg font-black text-gray-900">Payment Review</h2>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as PaymentStatus | 'all')}
              className="min-h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm font-black outline-none focus:border-pink-300 focus:ring-4 focus:ring-pink-100"
            >
              <option value="all">All statuses</option>
              <option value="payment_submitted">Submitted</option>
              <option value="payment_confirmed">Confirmed</option>
              <option value="payment_rejected">Rejected</option>
              <option value="awaiting_payment">Awaiting payment</option>
              <option value="payment_expired">Expired</option>
              <option value="payment_cancelled">Cancelled</option>
            </select>
          </div>
          {orders.length === 0 ? (
            <div className="p-6 text-sm font-bold text-gray-400">No pre-order payments found.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {orders.map((order) => (
                <div key={order.order_id} className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-lg font-black tracking-[0.12em] text-gray-950">{order.pickup_code}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${statusClasses[order.payment_status]}`}>
                        {statusLabels[order.payment_status]}
                      </span>
                    </div>
                    <div className="mt-1 text-sm font-black text-gray-900">{order.customer_name}</div>
                    <div className="mt-1 text-xs font-bold text-gray-500">
                      {[order.customer_phone, order.customer_social, order.customer_email].filter(Boolean).join(' · ') || order.customer_contact || 'No contact'}
                    </div>
                    <div className="mt-2 text-xs font-semibold text-gray-600">
                      {order.items.map((item) => `${item.quantity}x ${item.name}`).join(', ')}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <div className="mr-2 text-right">
                      <div className="text-[10px] font-bold text-gray-500">Amount</div>
                      <div className="text-sm font-black text-gray-950">{formatPrice(order.total_price, order.currency)}</div>
                    </div>
                    {order.slip_url && signedUrls[order.slip_url] && (
                      <button
                        type="button"
                        onClick={() => setSlipPreview({ order, url: signedUrls[order.slip_url as string] })}
                        className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-black text-gray-700 hover:bg-gray-50"
                      >
                        <Eye size={14} /> Slip
                      </button>
                    )}
                    {order.payment_status === 'payment_submitted' && (
                      <>
                        <button
                          onClick={() => setReviewAction({ type: 'reject', order })}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-black text-red-700 hover:bg-red-100"
                        >
                          <XCircle size={15} /> Reject
                        </button>
                        <button
                          onClick={() => setReviewAction({ type: 'confirm', order })}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-black text-white hover:bg-emerald-700"
                        >
                          <CheckCircle size={15} /> Confirm
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
