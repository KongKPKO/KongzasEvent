import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import EventNavTabs from '../../components/EventNavTabs';
import { supabase } from '../../supabaseClient';
import { ArrowLeft, Clock3, CreditCard, DollarSign, Download, PackageCheck, ShoppingBag, Store, Ticket, TrendingUp, Users } from 'lucide-react';
import { formatPrice } from '../../utils/currency';
import { normalizeEventRecord } from '../../utils/schemaCompat';
import type { OrderType, PickupStatus } from '../../types/preorder';

interface EventInfo {
  id: string;
  event_name: string;
  start_date: string;
  end_date: string;
  location?: string | null;
  booth_detail?: string | null;
  status: string;
}

interface OrderItemRow {
  quantity: number;
  price_per_unit: number;
  products: {
    id: string;
    name: string;
    category?: string | null;
  } | null;
}

interface OrderRow {
  id: string;
  created_at: string;
  queue_id?: string | null;
  total_price: number;
  subtotal_price?: number | null;
  discount_total?: number | null;
  payment_method: 'cash' | 'transfer';
  status: string;
  currency?: string;
  order_type?: OrderType | null;
  pickup_code?: string | null;
  customer_name?: string | null;
  customer_contact?: string | null;
  pickup_status?: PickupStatus | null;
  picked_up_at?: string | null;
  order_items: OrderItemRow[];
}

interface QueueRow {
  id: string;
  status: 'waiting' | 'calling' | 'serving' | 'complete' | 'missed' | 'expired' | 'queued';
  created_at?: string | null;
  called_at?: string | null;
  served_at?: string | null;
  completed_at?: string | null;
}

const formatMinutes = (value: number) => `${Math.round(value)}m`;

export default function EventDashboard() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [eventInfo, setEventInfo] = useState<EventInfo | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [queues, setQueues] = useState<QueueRow[]>([]);

  useEffect(() => {
    if (!eventId) return;

    const fetchDashboard = async () => {
      setLoading(true);
      try {
        const [{ data: event, error: eventError }, { data: orderData, error: orderError }, { data: queueData, error: queueError }] = await Promise.all([
          supabase
            .from('events')
            .select('*')
            .eq('id', eventId)
            .single(),
          supabase
            .from('orders')
            .select(`
              id,
              created_at,
              queue_id,
              total_price,
              subtotal_price,
              discount_total,
              payment_method,
              status,
              currency,
              order_type,
              pickup_code,
              customer_name,
              customer_contact,
              pickup_status,
              picked_up_at,
              order_items (
                quantity,
                price_per_unit,
                products (id, name, category)
              )
            `)
            .eq('event_id', eventId)
            .order('created_at', { ascending: true }),
          supabase
            .from('queues')
            .select('id, status, created_at, called_at, served_at, completed_at')
            .eq('event_id', eventId)
            .order('created_at', { ascending: true }),
        ]);

        if (eventError) throw eventError;
        if (orderError) throw orderError;
        if (queueError) throw queueError;

        setEventInfo(normalizeEventRecord(event as Record<string, any>) as unknown as EventInfo);
        setOrders((orderData || []) as unknown as OrderRow[]);
        setQueues((queueData || []) as QueueRow[]);
      } catch (error) {
        console.error('[EventDashboard] fetch failed:', error);
      } finally {
        setLoading(false);
      }
    };

    void fetchDashboard();
  }, [eventId]);

  const analytics = useMemo(() => {
    const completedOrders = orders.filter((order) => order.status === 'completed');
    const currency = completedOrders[0]?.currency || orders[0]?.currency || 'THB';
    const getOrderType = (order: OrderRow): OrderType => order.order_type || (order.queue_id ? 'live_queue' : 'pos_walkin');

    const revenue = completedOrders.reduce((sum, order) => sum + Number(order.total_price || 0), 0);
    const subtotal = completedOrders.reduce((sum, order) => sum + Number(order.subtotal_price || order.total_price || 0), 0);
    const discountTotal = completedOrders.reduce((sum, order) => sum + Number(order.discount_total || 0), 0);
    const itemCount = completedOrders.reduce((sum, order) => sum + order.order_items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0);
    const avgOrderValue = completedOrders.length > 0 ? revenue / completedOrders.length : 0;

    const byPayment = {
      cash: completedOrders.filter((order) => order.payment_method === 'cash'),
      transfer: completedOrders.filter((order) => order.payment_method === 'transfer'),
    };
    const preorderOrders = completedOrders.filter((order) => getOrderType(order) === 'preorder');
    const liveQueueOrders = completedOrders.filter((order) => getOrderType(order) === 'live_queue');
    const walkinOrders = completedOrders.filter((order) => getOrderType(order) === 'pos_walkin');
    const awaitingPickupCount = orders.filter((order) => getOrderType(order) === 'preorder' && order.pickup_status === 'awaiting_pickup').length;

    const productMap = new Map<string, { name: string; qty: number; revenue: number; category: string }>();
    const categoryMap = new Map<string, { category: string; qty: number; revenue: number }>();
    const hourMap = new Map<string, { hour: string; orders: number; revenue: number }>();

    completedOrders.forEach((order) => {
      const hour = new Date(order.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
      const existingHour = hourMap.get(hour) || { hour, orders: 0, revenue: 0 };
      existingHour.orders += 1;
      existingHour.revenue += Number(order.total_price || 0);
      hourMap.set(hour, existingHour);

      order.order_items.forEach((item) => {
        const productName = item.products?.name || 'Unknown Product';
        const category = item.products?.category?.trim() || 'Other';
        const revenueValue = item.quantity * item.price_per_unit;
        const productKey = item.products?.id || productName;

        const productEntry = productMap.get(productKey) || { name: productName, qty: 0, revenue: 0, category };
        productEntry.qty += item.quantity;
        productEntry.revenue += revenueValue;
        productMap.set(productKey, productEntry);

        const categoryEntry = categoryMap.get(category) || { category, qty: 0, revenue: 0 };
        categoryEntry.qty += item.quantity;
        categoryEntry.revenue += revenueValue;
        categoryMap.set(category, categoryEntry);
      });
    });

    const totalQueues = queues.length;
    const completedQueues = queues.filter((queue) => queue.status === 'complete').length;
    const expiredQueues = queues.filter((queue) => queue.status === 'expired').length;
    const missedQueues = queues.filter((queue) => queue.status === 'missed').length;
    const activeQueues = queues.filter((queue) => ['waiting', 'queued', 'calling', 'serving'].includes(queue.status)).length;
    const conversionRate = totalQueues > 0 ? (completedQueues / totalQueues) * 100 : 0;

    let totalWaitMinutes = 0;
    let totalWaitCount = 0;
    let totalServiceMinutes = 0;
    let totalServiceCount = 0;

    queues.forEach((queue) => {
      const start = queue.created_at ? new Date(queue.created_at).getTime() : null;
      const calledOrServed = queue.served_at || queue.called_at;
      if (start && calledOrServed) {
        const waitMinutes = (new Date(calledOrServed).getTime() - start) / 60000;
        if (waitMinutes >= 0 && waitMinutes < 600) {
          totalWaitMinutes += waitMinutes;
          totalWaitCount += 1;
        }
      }

      const serviceStart = queue.served_at || queue.called_at;
      if (queue.completed_at && serviceStart) {
        const serviceMinutes = (new Date(queue.completed_at).getTime() - new Date(serviceStart).getTime()) / 60000;
        if (serviceMinutes >= 0 && serviceMinutes < 300) {
          totalServiceMinutes += serviceMinutes;
          totalServiceCount += 1;
        }
      }
    });

    return {
      currency,
      revenue,
      subtotal,
      discountTotal,
      itemCount,
      completedOrders,
      avgOrderValue,
      paymentSummary: {
        cashOrders: byPayment.cash.length,
        cashRevenue: byPayment.cash.reduce((sum, order) => sum + Number(order.total_price || 0), 0),
        transferOrders: byPayment.transfer.length,
        transferRevenue: byPayment.transfer.reduce((sum, order) => sum + Number(order.total_price || 0), 0),
      },
      orderTypeSummary: {
        preorderOrders: preorderOrders.length,
        preorderRevenue: preorderOrders.reduce((sum, order) => sum + Number(order.total_price || 0), 0),
        awaitingPickupCount,
        liveQueueOrders: liveQueueOrders.length,
        liveQueueRevenue: liveQueueOrders.reduce((sum, order) => sum + Number(order.total_price || 0), 0),
        walkinOrders: walkinOrders.length,
        walkinRevenue: walkinOrders.reduce((sum, order) => sum + Number(order.total_price || 0), 0),
      },
      queueSummary: {
        totalQueues,
        completedQueues,
        expiredQueues,
        missedQueues,
        activeQueues,
        conversionRate,
        avgWaitMinutes: totalWaitCount > 0 ? totalWaitMinutes / totalWaitCount : 0,
        avgServiceMinutes: totalServiceCount > 0 ? totalServiceMinutes / totalServiceCount : 0,
      },
      topProducts: Array.from(productMap.values()).sort((a, b) => b.qty - a.qty).slice(0, 8),
      categoryBreakdown: Array.from(categoryMap.values()).sort((a, b) => b.revenue - a.revenue),
      hourlySales: Array.from(hourMap.values()).sort((a, b) => a.hour.localeCompare(b.hour)),
    };
  }, [orders, queues]);

  const recommendations = useMemo(() => {
    const cards: Array<{ title: string; detail: string; tone: 'pink' | 'amber' | 'blue' }> = [];
    const topCategory = analytics.categoryBreakdown[0];
    const peakHour = analytics.hourlySales.reduce<{ hour: string; orders: number; revenue: number } | null>((best, current) => {
      if (!best || current.orders > best.orders) return { hour: current.hour, orders: current.orders, revenue: current.revenue };
      if (best && current.orders === best.orders && current.revenue > best.revenue) {
        return { hour: current.hour, orders: current.orders, revenue: current.revenue };
      }
      return best;
    }, null);

    if (topCategory) {
      cards.push({
        title: 'Top Seller',
        detail: `${topCategory.category} led revenue at ${formatPrice(topCategory.revenue, analytics.currency)}. Use this to plan stock for the next event.`,
        tone: 'pink',
      });
    }

    if (peakHour) {
      cards.push({
        title: 'Peak Sales Window',
        detail: `${peakHour.hour} had the highest order volume at ${peakHour.orders} order${peakHour.orders === 1 ? '' : 's'}. Use this slot to prepare staff, queue calling, and restock.`,
        tone: 'blue',
      });
    }

    if (analytics.queueSummary.conversionRate < 50 && analytics.queueSummary.totalQueues >= 5) {
      cards.push({
        title: 'Queue Drop-Off Risk',
        detail: `Only ${Math.round(analytics.queueSummary.conversionRate)}% of queues completed. Check wait time, calling flow, and booth instructions.`,
        tone: 'amber',
      });
    } else if (analytics.queueSummary.avgWaitMinutes > 12) {
      cards.push({
        title: 'Wait Time Risk',
        detail: `Average wait is ${formatMinutes(analytics.queueSummary.avgWaitMinutes)}. Consider faster queue calling or moving more customers into calling state earlier.`,
        tone: 'amber',
      });
    }

    return cards.slice(0, 3);
  }, [analytics]);

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500">Loading event dashboard...</div>;
  }

  if (!eventInfo) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500">Event not found.</div>;
  }

  const maxCategoryRevenue = Math.max(1, ...analytics.categoryBreakdown.map((item) => item.revenue));
  const maxHourlyRevenue = Math.max(1, ...analytics.hourlySales.map((item) => item.revenue));
  const paymentTotalRevenue = Math.max(1, analytics.paymentSummary.cashRevenue + analytics.paymentSummary.transferRevenue);

  const exportSummaryCsv = () => {
    const rows = [
      ['Metric', 'Value'],
      ['Event', eventInfo.event_name],
      ['Net Revenue', String(analytics.revenue)],
      ['Discount Given', String(analytics.discountTotal)],
      ['Completed Orders', String(analytics.completedOrders.length)],
      ['Items Sold', String(analytics.itemCount)],
      ['Queue Conversion %', String(Math.round(analytics.queueSummary.conversionRate))],
      ['Avg Wait Minutes', String(Math.round(analytics.queueSummary.avgWaitMinutes))],
      ['Avg Service Minutes', String(Math.round(analytics.queueSummary.avgServiceMinutes))],
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${eventInfo.event_name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-summary.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        {eventId && <EventNavTabs eventId={eventId} active="dashboard" />}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(`/manage-events/${eventId}/workspace`)}
            className="icon-touch inline-flex items-center justify-center bg-white rounded-xl shadow-sm border border-gray-100 hover:bg-gray-50 transition text-gray-500"
            aria-label="Back to event workspace"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-black text-gray-800 tracking-tight">Event Dashboard</h1>
            <p className="text-sm text-pink-500 font-bold mt-0.5">{eventInfo.event_name}</p>
            <p className="text-xs text-gray-500 mt-1">
              {new Date(eventInfo.start_date).toLocaleDateString('en-GB')} - {new Date(eventInfo.end_date).toLocaleDateString('en-GB')}
              {eventInfo.location ? ` | ${eventInfo.location}` : ''}
              {eventInfo.booth_detail ? ` | Booth ${eventInfo.booth_detail}` : ''}
            </p>
          </div>
        </div>
          <button
            type="button"
            onClick={exportSummaryCsv}
            className="workspace-action inline-flex items-center justify-center gap-2 rounded-xl border border-pink-200 bg-pink-50 px-4 py-2 text-sm font-black text-pink-700 hover:bg-pink-100"
          >
            <Download size={16} aria-hidden="true" />
            Export summary
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard icon={<DollarSign size={18} />} title="Net Revenue" value={formatPrice(analytics.revenue, analytics.currency)} helper={`${analytics.completedOrders.length} completed orders`} tone="pink" />
          <MetricCard icon={<TrendingUp size={18} />} title="Discount Given" value={formatPrice(analytics.discountTotal, analytics.currency)} helper={`from ${formatPrice(analytics.subtotal, analytics.currency)} gross`} tone="emerald" />
          <MetricCard icon={<ShoppingBag size={18} />} title="Items Sold" value={String(analytics.itemCount)} helper={`Avg order ${formatPrice(analytics.avgOrderValue, analytics.currency)}`} tone="blue" />
          <MetricCard icon={<Ticket size={18} />} title="Queue Conversion" value={`${Math.round(analytics.queueSummary.conversionRate)}%`} helper={`${analytics.queueSummary.completedQueues}/${analytics.queueSummary.totalQueues} completed`} tone="amber" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard icon={<Users size={18} />} title="Active Queue" value={String(analytics.queueSummary.activeQueues)} helper={`Expired ${analytics.queueSummary.expiredQueues} | Missed ${analytics.queueSummary.missedQueues}`} tone="slate" />
          <MetricCard icon={<Clock3 size={18} />} title="Avg Wait" value={formatMinutes(analytics.queueSummary.avgWaitMinutes)} helper="Queue created -> called/served" tone="violet" />
          <MetricCard icon={<Clock3 size={18} />} title="Avg Service" value={formatMinutes(analytics.queueSummary.avgServiceMinutes)} helper="Called/served -> completed" tone="indigo" />
          <MetricCard icon={<CreditCard size={18} />} title="Payment Mix" value={`${analytics.paymentSummary.cashOrders}/${analytics.paymentSummary.transferOrders}`} helper="Cash / Transfer orders" tone="cyan" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard icon={<PackageCheck size={18} />} title="Pre-order Revenue" value={formatPrice(analytics.orderTypeSummary.preorderRevenue, analytics.currency)} helper={`${analytics.orderTypeSummary.preorderOrders} completed pre-orders`} tone="rose" />
          <MetricCard icon={<PackageCheck size={18} />} title="Awaiting Pickup" value={String(analytics.orderTypeSummary.awaitingPickupCount)} helper="reserved stock still held" tone="amber" />
          <MetricCard icon={<Ticket size={18} />} title="Live Queue Revenue" value={formatPrice(analytics.orderTypeSummary.liveQueueRevenue, analytics.currency)} helper={`${analytics.orderTypeSummary.liveQueueOrders} queue orders`} tone="indigo" />
          <MetricCard icon={<Store size={18} />} title="Walk-in Revenue" value={formatPrice(analytics.orderTypeSummary.walkinRevenue, analytics.currency)} helper={`${analytics.orderTypeSummary.walkinOrders} POS orders`} tone="teal" />
        </div>

        {recommendations.length > 0 && (
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-sm font-black text-gray-800 uppercase tracking-wide mb-4">What To Watch Next</h2>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              {recommendations.map((card) => (
                <RecommendationCard key={card.title} title={card.title} detail={card.detail} tone={card.tone} />
              ))}
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 xl:col-span-1">
            <h2 className="text-sm font-black text-gray-800 uppercase tracking-wide mb-4">Payment Summary</h2>
            <div className="space-y-4">
              <PaymentRow label="Cash" orders={analytics.paymentSummary.cashOrders} value={formatPrice(analytics.paymentSummary.cashRevenue, analytics.currency)} color="emerald" />
              <PaymentRow label="Transfer" orders={analytics.paymentSummary.transferOrders} value={formatPrice(analytics.paymentSummary.transferRevenue, analytics.currency)} color="blue" />
              <div className="overflow-hidden rounded-full bg-gray-100 h-3" aria-label="Payment revenue mix">
                <div
                  className="h-full rounded-full bg-pink-500"
                  style={{ width: `${(analytics.paymentSummary.cashRevenue / paymentTotalRevenue) * 100}%` }}
                  title="Cash revenue share"
                />
              </div>
              <p className="text-xs font-semibold text-gray-500">Pink segment shows cash revenue share. Remaining share is transfer.</p>
            </div>
          </section>

          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 xl:col-span-2">
            <h2 className="text-sm font-black text-gray-800 uppercase tracking-wide mb-4">Sales By Category</h2>
            <div className="space-y-3">
              {analytics.categoryBreakdown.length === 0 ? (
                <div className="text-sm text-gray-400 py-8 text-center">No category sales yet.</div>
              ) : analytics.categoryBreakdown.map((entry) => (
                <div key={entry.category}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-bold text-gray-700">{entry.category}</span>
                    <span className="text-gray-500">{formatPrice(entry.revenue, analytics.currency)} · {entry.qty} sold</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full bg-pink-500" style={{ width: `${(entry.revenue / maxCategoryRevenue) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-sm font-black text-gray-800 uppercase tracking-wide mb-4">Top Products</h2>
            <div className="space-y-3">
              {analytics.topProducts.length === 0 ? (
                <div className="text-sm text-gray-400 py-8 text-center">No product sales yet.</div>
              ) : analytics.topProducts.map((product, index) => (
                <div key={`${product.name}-${index}`} className="flex items-center justify-between border-b border-gray-50 pb-3 last:border-0 last:pb-0">
                  <div className="min-w-0 pr-3">
                    <div className="font-bold text-gray-800 text-sm truncate">{product.name}</div>
                    <div className="text-xs text-gray-400">{product.category}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-black text-gray-900 text-sm">{product.qty} sold</div>
                    <div className="text-xs text-gray-500">{formatPrice(product.revenue, analytics.currency)}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-sm font-black text-gray-800 uppercase tracking-wide mb-4">Hourly Sales Trend</h2>
            <div className="space-y-3" aria-label="Hourly sales revenue chart">
              {analytics.hourlySales.length === 0 ? (
                <div className="text-sm text-gray-400 py-8 text-center">No hourly sales yet.</div>
              ) : analytics.hourlySales.map((slot) => (
                <div key={slot.hour} className="grid grid-cols-[56px_1fr_90px] gap-3 items-center">
                  <div className="text-xs font-bold text-gray-500">{slot.hour}</div>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full bg-blue-500" style={{ width: `${(slot.revenue / maxHourlyRevenue) * 100}%` }} />
                  </div>
                  <div className="text-right text-xs text-gray-600">{formatPrice(slot.revenue, analytics.currency)}</div>
                </div>
              ))}
            </div>
          </section>
        </div>

      </div>
    </div>
  );
}

function MetricCard({ icon, title, value, helper, tone }: { icon: React.ReactNode; title: string; value: string; helper: string; tone: 'pink' | 'emerald' | 'blue' | 'amber' | 'slate' | 'violet' | 'indigo' | 'cyan' | 'rose' | 'teal'; }) {
  const tones: Record<string, string> = {
    pink: 'bg-pink-50 border-pink-100 text-pink-700',
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-700',
    blue: 'bg-blue-50 border-blue-100 text-blue-700',
    amber: 'bg-amber-50 border-amber-100 text-amber-700',
    slate: 'bg-slate-50 border-slate-100 text-slate-700',
    violet: 'bg-violet-50 border-violet-100 text-violet-700',
    indigo: 'bg-indigo-50 border-indigo-100 text-indigo-700',
    cyan: 'bg-cyan-50 border-cyan-100 text-cyan-700',
    rose: 'bg-rose-50 border-rose-100 text-rose-700',
    teal: 'bg-teal-50 border-teal-100 text-teal-700',
  };

  return (
    <div className={`rounded-2xl border p-5 ${tones[tone]}`}>
      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide mb-3">{icon}<span>{title}</span></div>
      <div className="text-3xl font-black leading-none mb-2">{value}</div>
      <div className="text-xs opacity-80">{helper}</div>
    </div>
  );
}

function PaymentRow({ label, orders, value, color }: { label: string; orders: number; value: string; color: 'emerald' | 'blue'; }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${color === 'emerald' ? 'bg-emerald-50 border-emerald-100' : 'bg-blue-50 border-blue-100'}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="font-bold text-gray-800">{label}</div>
        <div className="text-xs text-gray-500">{orders} orders</div>
      </div>
      <div className="text-lg font-black text-gray-900">{value}</div>
    </div>
  );
}

function RecommendationCard({ title, detail, tone }: { title: string; detail: string; tone: 'pink' | 'amber' | 'blue' }) {
  const styles = {
    pink: 'bg-pink-50 border-pink-100',
    amber: 'bg-amber-50 border-amber-100',
    blue: 'bg-blue-50 border-blue-100',
  } as const;

  return (
    <div className={`rounded-xl border p-4 ${styles[tone]}`}>
      <div className="text-xs font-black uppercase tracking-wide text-gray-700 mb-2">{title}</div>
      <p className="text-sm text-gray-600 leading-relaxed">{detail}</p>
    </div>
  );
}
