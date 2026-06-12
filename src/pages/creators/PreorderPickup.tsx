import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle, Clock3, PackageCheck, Search, Trash2 } from 'lucide-react';
import AdminHeader from '../../components/AdminHeader';
import EventNavTabs from '../../components/EventNavTabs';
import { useI18n } from '../../i18n';
import { ConfirmDialog, Toast } from '../../components/ui/Feedback';
import { cancelPreorder, expirePreordersForEvent, getPreorderErrorMessage, markPreorderPickedUp } from '../../lib/preorders';
import { supabase } from '../../supabaseClient';
import type { ActorContext } from '../../types/access';
import type { PickupStatus } from '../../types/preorder';
import { formatPrice } from '../../utils/currency';

interface PreorderPickupProps {
  actorContext: ActorContext;
}

interface EventInfo {
  id: string;
  artist_id: string;
  event_name: string;
  end_date: string;
  selling_mode?: string | null;
  status: string;
}

interface PickupOrderRow {
  id: string;
  created_at: string;
  status: string;
  pickup_status: PickupStatus;
  pickup_code: string;
  customer_name: string;
  customer_contact: string | null;
  customer_note: string | null;
  total_price: number;
  currency: string;
  order_items: Array<{ quantity: number; products: { name: string } | null }>;
}

type PickupFilter = 'awaiting_pickup' | 'picked_up' | 'all';
type ConfirmAction =
  | { type: 'pickup'; order: PickupOrderRow }
  | { type: 'cancel'; order: PickupOrderRow }
  | { type: 'expire' }
  | null;

const formatPickupStatus = (status: PickupStatus) => {
  const labels: Record<PickupStatus, string> = {
    not_required: 'Not required',
    awaiting_pickup: 'Awaiting pickup',
    picked_up: 'Picked up',
    cancelled: 'Cancelled',
    expired: 'Expired',
  };
  return labels[status] || status;
};

const getStatusClasses = (status: PickupStatus) => {
  if (status === 'awaiting_pickup') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (status === 'picked_up') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  if (status === 'cancelled' || status === 'expired') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-gray-100 text-gray-700 border-gray-200';
};

export default function PreorderPickup({ actorContext }: PreorderPickupProps) {
  const { language } = useI18n();
  const { eventId } = useParams();
  const [eventInfo, setEventInfo] = useState<EventInfo | null>(null);
  const [orders, setOrders] = useState<PickupOrderRow[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PickupFilter>('awaiting_pickup');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [toast, setToast] = useState<{ tone?: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string } | null>(null);

  const canCancelPreorders = ['owner', 'manager', 'seller'].includes(actorContext.role);
  const canExpirePreorders = ['owner', 'manager'].includes(actorContext.role);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    try {
      const [{ data: eventData, error: eventError }, { data: orderData, error: orderError }] = await Promise.all([
        supabase
          .from('events')
          .select('id, artist_id, event_name, end_date, selling_mode, status')
          .eq('id', eventId)
          .eq('artist_id', actorContext.artist_id)
          .maybeSingle(),
        supabase
          .from('orders')
          .select(`
            id,
            created_at,
            status,
            pickup_status,
            pickup_code,
            customer_name,
            customer_contact,
            customer_note,
            total_price,
            currency,
            order_items (
              quantity,
              products (name)
            )
          `)
          .eq('event_id', eventId)
          .eq('order_type', 'preorder')
          .order('created_at', { ascending: false }),
      ]);

      if (eventError) throw eventError;
      if (orderError) throw orderError;

      setEventInfo((eventData || null) as EventInfo | null);
      setOrders((orderData || []) as unknown as PickupOrderRow[]);
    } catch (error) {
      setToast({
        tone: 'error',
        title: 'Could not load pickup orders',
        detail: getPreorderErrorMessage(error),
      });
    } finally {
      setLoading(false);
    }
  }, [actorContext.artist_id, eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const awaiting = orders.filter((order) => order.pickup_status === 'awaiting_pickup').length;
    const pickedUp = orders.filter((order) => order.pickup_status === 'picked_up').length;
    const released = orders.filter((order) => order.pickup_status === 'cancelled' || order.pickup_status === 'expired').length;
    return { awaiting, pickedUp, released };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesFilter = filter === 'all' || order.pickup_status === filter;
      const itemNames = order.order_items.map((item) => item.products?.name || '').join(' ');
      const haystack = `${order.pickup_code} ${order.customer_name} ${order.customer_contact || ''} ${itemNames}`.toLowerCase();
      return matchesFilter && (normalized.length === 0 || haystack.includes(normalized));
    });
  }, [filter, orders, query]);

  const runPickup = async (order: PickupOrderRow) => {
    setActionLoading(true);
    try {
      await markPreorderPickedUp(order.id);
      setToast({ tone: 'success', title: 'Pickup completed', detail: `${order.pickup_code} marked as picked up.` });
      await load();
    } catch (error) {
      setToast({ tone: 'error', title: 'Pickup failed', detail: getPreorderErrorMessage(error) });
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  };

  const runCancel = async (order: PickupOrderRow) => {
    setActionLoading(true);
    try {
      await cancelPreorder(order.id, 'staff_cancelled_no_show');
      setToast({ tone: 'success', title: 'Pre-order cancelled', detail: 'Reserved stock was released.' });
      await load();
    } catch (error) {
      setToast({ tone: 'error', title: 'Cancel failed', detail: getPreorderErrorMessage(error) });
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  };

  const runExpire = async () => {
    if (!eventId) return;
    setActionLoading(true);
    try {
      const result = await expirePreordersForEvent(eventId);
      setToast({
        tone: 'success',
        title: 'Remaining pre-orders expired',
        detail: `${result.expired_count || 0} order(s) released.`,
      });
      await load();
    } catch (error) {
      setToast({ tone: 'error', title: 'Expiry failed', detail: getPreorderErrorMessage(error) });
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  };

  const handleConfirm = () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'pickup') void runPickup(confirmAction.order);
    if (confirmAction.type === 'cancel') void runCancel(confirmAction.order);
    if (confirmAction.type === 'expire') void runExpire();
  };

  const confirmDetail = (() => {
    if (!confirmAction) return '';
    if (confirmAction.type === 'pickup') return `Pickup code ${confirmAction.order.pickup_code}\nReserved stock will be converted to sold stock.`;
    if (confirmAction.type === 'cancel') return `Pickup code ${confirmAction.order.pickup_code}\nReserved stock will be released back to inventory.`;
    return 'All awaiting pre-orders for this event will be expired and reserved stock will be released.';
  })();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader activePage="pos" actorRole={actorContext.role} userEmail={actorContext.member_email} />
        <div className="p-10 text-center text-sm font-bold text-gray-400">Loading pickup orders...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader
        activePage="pos"
        activeEvent={eventInfo ? { id: eventInfo.id, event_name: eventInfo.event_name } : null}
        actorRole={actorContext.role}
        userEmail={actorContext.member_email}
      />
      <Toast message={toast} onClose={() => setToast(null)} />
      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={
          confirmAction?.type === 'pickup'
            ? 'Mark picked up?'
            : confirmAction?.type === 'expire'
              ? 'Expire remaining pre-orders?'
              : 'Cancel pre-order?'
        }
        detail={confirmDetail}
        confirmLabel={confirmAction?.type === 'pickup' ? 'Picked up' : confirmAction?.type === 'expire' ? 'Expire' : 'Cancel order'}
        tone={confirmAction?.type === 'pickup' ? 'default' : 'danger'}
        loading={actionLoading}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmAction(null)}
      />

      <main className="mx-auto max-w-5xl p-4 md:p-6">
        {eventId && <EventNavTabs eventId={eventId} active="pickup" actorRole={actorContext.role} />}

        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <PackageCheck className="text-pink-600" size={24} />
              <h1 className="text-2xl font-black text-gray-900">Pickup Orders</h1>
            </div>
            <p className="mt-1 text-sm font-semibold text-gray-500">
              {eventInfo?.event_name || 'Event'} · Workspace role: {actorContext.role}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canExpirePreorders && (
              <button
                onClick={() => setConfirmAction({ type: 'expire' })}
                disabled={stats.awaiting === 0 || actionLoading}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 text-xs font-black text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Clock3 size={15} /> Expire remaining
              </button>
            )}
          </div>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
            <div className="text-xs font-black uppercase tracking-wide text-amber-700">Awaiting</div>
            <div className="mt-1 text-2xl font-black text-gray-900">{stats.awaiting}</div>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
            <div className="text-xs font-black uppercase tracking-wide text-emerald-700">Picked up</div>
            <div className="mt-1 text-2xl font-black text-gray-900">{stats.pickedUp}</div>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white p-3">
            <div className="text-xs font-black uppercase tracking-wide text-gray-500">Released</div>
            <div className="mt-1 text-2xl font-black text-gray-900">{stats.released}</div>
          </div>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pink-400" size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search code, name, contact, or product"
              className="min-h-12 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-3 text-sm font-bold outline-none focus:border-pink-300 focus:ring-4 focus:ring-pink-100"
            />
          </label>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as PickupFilter)}
            className="min-h-12 rounded-xl border border-gray-200 bg-white px-3 text-sm font-black outline-none focus:border-pink-300 focus:ring-4 focus:ring-pink-100"
          >
            <option value="awaiting_pickup">Awaiting pickup</option>
            <option value="picked_up">Picked up</option>
            <option value="all">All statuses</option>
          </select>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          {!eventInfo ? (
            <div className="p-8 text-center text-sm font-bold text-gray-400">Event not found or you do not have access.</div>
          ) : filteredOrders.length === 0 ? (
            <div className="p-8 text-center text-sm font-bold text-gray-400">No pickup orders found.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredOrders.map((order) => (
                <div key={order.id} className="grid gap-4 p-4 md:grid-cols-[240px_minmax(0,1fr)_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="text-xs font-black uppercase tracking-[0.14em] text-gray-400">Code</div>
                    <div className="whitespace-nowrap font-mono text-2xl font-black tracking-[0.08em] text-pink-700 md:text-[1.65rem]">{order.pickup_code}</div>
                    <div className="mt-1 text-[11px] font-bold text-gray-400">{new Date(order.created_at).toLocaleString(language === 'th' ? 'th-TH' : 'en-GB')}</div>
                  </div>
                  <div className="min-w-0 md:pl-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="max-w-full truncate text-sm font-black text-gray-900">{order.customer_name}</div>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-black ${getStatusClasses(order.pickup_status)}`}>
                        {formatPickupStatus(order.pickup_status)}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-xs font-bold text-gray-500">
                      {order.customer_contact || 'No contact'} · {formatPrice(order.total_price, order.currency)}
                    </div>
                    <div className="mt-1 truncate text-xs font-semibold text-gray-600">
                      {order.order_items.map((item) => `${item.quantity}x ${item.products?.name || 'Unknown'}`).join(', ')}
                    </div>
                    {order.customer_note && (
                      <div className="mt-2 max-w-full truncate rounded-lg bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600">{order.customer_note}</div>
                    )}
                  </div>
                  <div className="flex justify-end md:min-w-[220px]">
                    {order.pickup_status === 'awaiting_pickup' ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        {canCancelPreorders && (
                          <button
                            onClick={() => setConfirmAction({ type: 'cancel', order })}
                            disabled={actionLoading}
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-sm font-black text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            <Trash2 size={15} /> Cancel
                          </button>
                        )}
                        <button
                          onClick={() => setConfirmAction({ type: 'pickup', order })}
                          disabled={actionLoading}
                          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <CheckCircle size={17} /> Picked up
                        </button>
                      </div>
                    ) : (
                      <span className={`inline-flex min-h-11 items-center rounded-xl border px-4 text-sm font-black ${getStatusClasses(order.pickup_status)}`}>
                        {formatPickupStatus(order.pickup_status)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
