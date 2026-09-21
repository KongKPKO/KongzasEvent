import './sales-reports.css';
import EventDateFilter, { matchesEventDate } from '../../components/EventDateFilter';
import { useI18n } from '../../i18n';
import { eventCopy } from '../../lib/eventCopy';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import EventNavTabs from '../../components/EventNavTabs';
import { supabase } from '../../supabaseClient';
import { ArrowLeft, Clock3, CreditCard, DollarSign, Download, PackageCheck, ShoppingBag, Store, Ticket, TrendingUp, Users } from 'lucide-react';
import { formatPrice } from '../../utils/currency';
import { normalizeEventRecord } from '../../utils/schemaCompat';
import type { OrderType, PickupStatus } from '../../types/preorder';

interface EventInfo {
    event_timezone?: string | null;
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
  const { language } = useI18n();
  const copy = (value: string) => eventCopy(language, value);
  const th = language === 'th';

  const { eventId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [eventInfo, setEventInfo] = useState<EventInfo | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [queues, setQueues] = useState<QueueRow[]>([]);

  const [searchParams, setSearchParams] = useSearchParams();
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  const timeZone = eventInfo?.event_timezone || 'Asia/Bangkok';
  const filteredOrders = useMemo(() => orders.filter(order => matchesEventDate(order.created_at, from, to, timeZone)), [orders, from, to, timeZone]);
  const changeDates = (nextFrom: string, nextTo: string) => {
    const next = new URLSearchParams(searchParams);
    if (nextFrom) next.set('from', nextFrom); else next.delete('from');
    if (nextTo) next.set('to', nextTo); else next.delete('to');
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (!eventId) return;

    const fetchDashboard = async () => {
      setLoading(true);
        setLoadError(false);
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
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };

    void fetchDashboard();
  }, [eventId]);

  const filteredQueues = useMemo(() => queues.filter(queue => matchesEventDate(queue.created_at, from, to, timeZone)), [queues, from, to, timeZone]);

  const analytics = useMemo(() => {
    const completedOrders = filteredOrders.filter((order) => order.status === 'completed');
    const currency = completedOrders[0]?.currency || filteredOrders[0]?.currency || 'THB';
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
    const postOrders = completedOrders.filter(order => getOrderType(order) === 'post_event');
    const walkinOrders = completedOrders.filter((order) => getOrderType(order) === 'pos_walkin');
    const awaitingPickupCount = filteredOrders.filter((order) => getOrderType(order) === 'preorder' && order.pickup_status === 'awaiting_pickup').length;

    const productMap = new Map<string, { name: string; qty: number; revenue: number; category: string }>();
    const categoryMap = new Map<string, { category: string; qty: number; revenue: number }>();
    const hourMap = new Map<string, { hour: string; orders: number; revenue: number }>();

    completedOrders.forEach((order) => {
      const hour = new Date(order.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone }) + ':00';
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

    const totalQueues = filteredQueues.length;
    const completedQueues = filteredQueues.filter((queue) => queue.status === 'complete').length;
    const expiredQueues = filteredQueues.filter((queue) => queue.status === 'expired').length;
    const missedQueues = filteredQueues.filter((queue) => queue.status === 'missed').length;
    const activeQueues = filteredQueues.filter((queue) => ['waiting', 'queued', 'calling', 'serving'].includes(queue.status)).length;
    const conversionRate = totalQueues > 0 ? (completedQueues / totalQueues) * 100 : 0;

    let totalWaitMinutes = 0;
    let totalWaitCount = 0;
    let totalServiceMinutes = 0;
    let totalServiceCount = 0;

    filteredQueues.forEach((queue) => {
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
        postOrders: postOrders.length,
        postRevenue: postOrders.reduce((sum, order) => sum + Number(order.total_price || 0), 0),
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
  }, [filteredOrders, filteredQueues, timeZone]);

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
        detail: language === 'th' ? `${topCategory.category} มียอดขายก่อนส่วนลด ${formatPrice(topCategory.revenue, analytics.currency)} ใช้ประกอบการเตรียมสต็อกงานถัดไป` : `${topCategory.category} led revenue at ${formatPrice(topCategory.revenue, analytics.currency)}. Use this to plan stock for the next event.`,
        tone: 'pink',
      });
    }

    if (peakHour) {
      cards.push({
        title: 'Peak Sales Window',
        detail: language === 'th' ? `ช่วง ${peakHour.hour} มีออเดอร์มากที่สุด ${peakHour.orders} รายการ ใช้เตรียมกำลังคนและเติมสินค้า` : `${peakHour.hour} had the highest order volume at ${peakHour.orders} order${peakHour.orders === 1 ? '' : 's'}. Use this slot to prepare staff, queue calling, and restock.`,
        tone: 'blue',
      });
    }

    if (analytics.queueSummary.conversionRate < 50 && analytics.queueSummary.totalQueues >= 5) {
      cards.push({
        title: 'Queue Drop-Off Risk',
        detail: language === 'th' ? `คิวสำเร็จ ${Math.round(analytics.queueSummary.conversionRate)}% ควรตรวจเวลารอและขั้นตอนเรียกคิว` : `Only ${Math.round(analytics.queueSummary.conversionRate)}% of queues completed. Check wait time, calling flow, and booth instructions.`,
        tone: 'amber',
      });
    } else if (analytics.queueSummary.avgWaitMinutes > 12) {
      cards.push({
        title: 'Wait Time Risk',
        detail: language === 'th' ? `รอเฉลี่ย ${Math.round(analytics.queueSummary.avgWaitMinutes)} นาที ควรตรวจขั้นตอนเรียกคิวและจำนวนพนักงาน` : `Average wait is ${formatMinutes(analytics.queueSummary.avgWaitMinutes)}. Consider faster queue calling or moving more customers into calling state earlier.`,
        tone: 'amber',
      });
    }

    return cards.slice(0, 3);
  }, [analytics, language]);

  if (loadError) return <div role="alert" className="mx-auto max-w-lg p-6 text-center">
    <p>{language === 'th' ? 'โหลดข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง' : 'Could not load data. Please try again.'}</p>
    <button type="button" className="mt-3 min-h-11 rounded-xl border border-gray-200 px-4" onClick={() => window.location.reload()}>{language === 'th' ? 'ลองอีกครั้ง' : 'Retry'}</button>
  </div>;

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500">{copy("Loading event dashboard...")}</div>;
  }

  if (!eventInfo) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500">{copy("Event not found.")}</div>;
  }

  const maxCategoryRevenue = Math.max(1, ...analytics.categoryBreakdown.map((item) => item.revenue));
  const maxHourlyRevenue = Math.max(1, ...analytics.hourlySales.map((item) => item.revenue));
  const paymentTotalRevenue = Math.max(1, analytics.paymentSummary.cashRevenue + analytics.paymentSummary.transferRevenue);

  const exportSummaryCsv = () => {
    const rows = [
      ['Metric', 'Value'],
      ['Event', eventInfo.event_name],
      ['From date', from || 'All dates'],
      ['To date', to || 'All dates'],
      ['Timezone', timeZone],
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
    <div className="sales-reports min-h-screen bg-gray-50 p-4 sm:p-6 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        {eventId && <EventNavTabs eventId={eventId} active="dashboard" />}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(`/manage-events/${eventId}/workspace`)}
            className="icon-touch inline-flex items-center justify-center bg-white rounded-xl shadow-sm border border-gray-100 hover:bg-gray-50 transition text-gray-500"
            aria-label={copy("Back to event workspace")}
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-black text-gray-800 tracking-tight">{th ? 'ภาพรวมยอดขาย' : 'Sales dashboard'}</h1>
            <p className="text-sm text-pink-500 font-bold mt-0.5">{eventInfo.event_name}</p>
            <p className="text-xs text-gray-500 mt-1">
              {new Date(eventInfo.start_date).toLocaleDateString(language === 'th' ? 'th-TH' : 'en-GB', { timeZone })} - {new Date(eventInfo.end_date).toLocaleDateString(language === 'th' ? 'th-TH' : 'en-GB', { timeZone })}
              {eventInfo.location ? ` | ${eventInfo.location}` : ''}
              {eventInfo.booth_detail ? ` | ${th ? 'บูธ' : 'Booth'} ${eventInfo.booth_detail}` : ''}
            </p>
          </div>
        </div>
          <button
            type="button"
            onClick={exportSummaryCsv}
            className="workspace-action inline-flex items-center justify-center gap-2 rounded-xl border border-pink-200 bg-pink-50 px-4 py-2 text-sm font-black text-pink-700 hover:bg-pink-100"
          >
            <Download size={16} aria-hidden="true" />
            {copy("Export summary")}</button>
        </div>

<div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-gray-600">{th ? 'ยอดขายนับเฉพาะออเดอร์ที่สำเร็จ หลังส่วนลดตามยอดที่บันทึกไว้' : 'Sales include completed orders only, using saved totals after discounts.'}</p>
          <button type="button" className="report-button" onClick={() => navigate(`/manage-events/${eventId}/history?${searchParams}`)}>{th ? 'ดูรายการขายในช่วงนี้ →' : 'View sales for this period →'}</button>
        </div>
<EventDateFilter from={from} to={to} timeZone={timeZone} onChange={changeDates} />
        <div className="report-metrics grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard icon={<DollarSign size={18} />} title={copy("Net Revenue")} value={formatPrice(analytics.revenue, analytics.currency)} helper={`${analytics.completedOrders.length} ${copy('completed orders')}`} tone="pink" />
          <MetricCard icon={<TrendingUp size={18} />} title={copy("Discount Given")} value={formatPrice(analytics.discountTotal, analytics.currency)} helper={`${th ? 'ยอดก่อนส่วนลด' : 'Before discounts'} ${formatPrice(analytics.subtotal, analytics.currency)}`} tone="emerald" />
          <MetricCard icon={<ShoppingBag size={18} />} title={th ? "ชิ้นสินค้า รวมของแถม" : "Units including gifts"} value={String(analytics.itemCount)} helper={`${th ? 'เฉลี่ยต่อออเดอร์' : 'Average order'} ${formatPrice(analytics.avgOrderValue, analytics.currency)}`} tone="blue" />
          <MetricCard icon={<Ticket size={18} />} title={th ? "ออเดอร์สำเร็จ" : "Completed orders"} value={String(analytics.completedOrders.length)} helper={th ? "ตามช่วงวันที่เลือก" : "In the selected period"} tone="slate" />
        </div>

        <details className="report-panel"><summary className="font-bold cursor-pointer">{th ? 'แยกช่องทางขายและสถิติคิว' : 'Sales channels and queue performance'}</summary><div className="space-y-4 mt-4"><p className="text-sm text-gray-600">{th ? 'คิวสำเร็จ' : 'Completed queues'} {analytics.queueSummary.completedQueues}/{analytics.queueSummary.totalQueues} ({Math.round(analytics.queueSummary.conversionRate)}%)</p>
        <div className="report-metrics grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard icon={<Users size={18} />} title={copy("Active Queue")} value={String(analytics.queueSummary.activeQueues)} helper={`${th ? 'หมดอายุ' : 'Expired'} ${analytics.queueSummary.expiredQueues} · ${th ? 'ไม่มาตามคิว' : 'Missed'} ${analytics.queueSummary.missedQueues}`} tone="slate" />
          <MetricCard icon={<Clock3 size={18} />} title={copy("Avg Wait")} value={`${Math.round(analytics.queueSummary.avgWaitMinutes)} ${th ? 'นาที' : 'min'}`} helper={copy("Queue created -> called/served")} tone="violet" />
          <MetricCard icon={<Clock3 size={18} />} title={copy("Avg Service")} value={`${Math.round(analytics.queueSummary.avgServiceMinutes)} ${th ? 'นาที' : 'min'}`} helper={copy("Called/served -> completed")} tone="indigo" />
          <MetricCard icon={<CreditCard size={18} />} title={copy("Payment Mix")} value={`${analytics.paymentSummary.cashOrders}/${analytics.paymentSummary.transferOrders}`} helper={copy("Cash / Transfer orders")} tone="cyan" />
        </div>

        <div className="report-metrics grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard icon={<PackageCheck size={18} />} title={copy("Pre-order Revenue")} value={formatPrice(analytics.orderTypeSummary.preorderRevenue, analytics.currency)} helper={`${analytics.orderTypeSummary.preorderOrders} ${copy('completed pre-orders')}`} tone="rose" />
          <MetricCard icon={<PackageCheck size={18} />} title={th ? "ยอดขายหลังงาน" : "Post-order revenue"} value={formatPrice(analytics.orderTypeSummary.postRevenue, analytics.currency)} helper={`${analytics.orderTypeSummary.postOrders} ${copy("orders")}`} tone="slate" />
          <MetricCard icon={<PackageCheck size={18} />} title={copy("Awaiting Pickup")} value={String(analytics.orderTypeSummary.awaitingPickupCount)} helper={copy("reserved stock still held")} tone="amber" />
          <MetricCard icon={<Ticket size={18} />} title={copy("Live Queue Revenue")} value={formatPrice(analytics.orderTypeSummary.liveQueueRevenue, analytics.currency)} helper={`${analytics.orderTypeSummary.liveQueueOrders} ${th ? 'ออเดอร์จากคิว' : 'queue orders'}`} tone="indigo" />
          <MetricCard icon={<Store size={18} />} title={copy("Walk-in Revenue")} value={formatPrice(analytics.orderTypeSummary.walkinRevenue, analytics.currency)} helper={`${analytics.orderTypeSummary.walkinOrders} ${th ? 'ออเดอร์หน้าบูธ' : 'POS orders'}`} tone="teal" />
        </div>

        </div></details>

        {recommendations.length > 0 && (
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-sm font-black text-gray-800 uppercase tracking-wide mb-4">{copy("What To Watch Next")}</h2>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              {recommendations.map((card) => (
                <RecommendationCard key={card.title} title={card.title} detail={card.detail} tone={card.tone} />
              ))}
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 xl:col-span-1">
            <h2 className="text-sm font-black text-gray-800 uppercase tracking-wide mb-4">{copy("Payment Summary")}</h2>
            <div className="space-y-4">
              <PaymentRow label={copy("Cash")} orders={analytics.paymentSummary.cashOrders} value={formatPrice(analytics.paymentSummary.cashRevenue, analytics.currency)} color="emerald" />
              <PaymentRow label={copy("Transfer")} orders={analytics.paymentSummary.transferOrders} value={formatPrice(analytics.paymentSummary.transferRevenue, analytics.currency)} color="blue" />
              <div className="overflow-hidden rounded-full bg-gray-100 h-3" aria-hidden="true">
                <div
                  className="h-full rounded-full bg-pink-500"
                  style={{ width: `${(analytics.paymentSummary.cashRevenue / paymentTotalRevenue) * 100}%` }}
                />
              </div>
              <p className="text-xs font-semibold text-gray-500">{copy("Pink segment shows cash revenue share. Remaining share is transfer.")}</p>
            </div>
          </section>

          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 xl:col-span-2">
            <h2 className="text-sm font-black text-gray-800 uppercase tracking-wide mb-4">{copy("Sales By Category")}</h2><p className="text-xs text-gray-600 mb-3">{th ? "มูลค่าสินค้าก่อนส่วนลด รวมรายการของแถมราคา 0" : "Item value before discounts, including zero-priced gifts."}</p>
            <div className="space-y-3">
              {analytics.categoryBreakdown.length === 0 ? (
                <div className="text-sm text-gray-400 py-8 text-center">{copy("No category sales yet.")}</div>
              ) : analytics.categoryBreakdown.map((entry) => (
                <div key={entry.category}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-bold text-gray-700">{entry.category}</span>
                    <span className="text-gray-500">{formatPrice(entry.revenue, analytics.currency)} · {entry.qty} {copy("sold")}</span>
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
            <h2 className="text-sm font-black text-gray-800 uppercase tracking-wide mb-4">{copy("Top Products")}</h2>
            <div className="space-y-3">
              {analytics.topProducts.length === 0 ? (
                <div className="text-sm text-gray-400 py-8 text-center">{copy("No product sales yet.")}</div>
              ) : analytics.topProducts.map((product, index) => (
                <div key={`${product.name}-${index}`} className="flex items-center justify-between border-b border-gray-50 pb-3 last:border-0 last:pb-0">
                  <div className="min-w-0 pr-3">
                    <div className="font-bold text-gray-800 text-sm truncate">{product.name}</div>
                    <div className="text-xs text-gray-400">{product.category}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-black text-gray-900 text-sm">{product.qty} {copy("sold")}</div>
                    <div className="text-xs text-gray-500">{formatPrice(product.revenue, analytics.currency)}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-sm font-black text-gray-800 uppercase tracking-wide mb-4">{copy("Hourly Sales Trend")}</h2><p className="text-xs text-gray-600 mb-3">{th ? "รวมยอดตามชั่วโมงของทุกวันที่เลือก" : "Combined by hour across all selected dates"} · {timeZone}</p>
            <div className="space-y-3" aria-label={th ? "ยอดขายรายชั่วโมง" : "Hourly sales revenue chart"}>
              {analytics.hourlySales.length === 0 ? (
                <div className="text-sm text-gray-400 py-8 text-center">{copy("No hourly sales yet.")}</div>
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
  const { language } = useI18n();
  const copy = (value: string) => eventCopy(language, value);

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
      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide mb-3">{icon}<span>{copy(title)}</span></div>
      <div className="text-3xl font-black leading-none mb-2">{value}</div>
      <div className="text-xs opacity-80">{copy(helper)}</div>
    </div>
  );
}

function PaymentRow({ label, orders, value, color }: { label: string; orders: number; value: string; color: 'emerald' | 'blue'; }) {
  const { language } = useI18n();
  const copy = (value: string) => eventCopy(language, value);

  return (
    <div className={`rounded-xl border px-4 py-3 ${color === 'emerald' ? 'bg-emerald-50 border-emerald-100' : 'bg-blue-50 border-blue-100'}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="font-bold text-gray-800">{copy(label)}</div>
        <div className="text-xs text-gray-500">{orders} {copy("orders")}</div>
      </div>
      <div className="text-lg font-black text-gray-900">{value}</div>
    </div>
  );
}

function RecommendationCard({ title, detail, tone }: { title: string; detail: string; tone: 'pink' | 'amber' | 'blue' }) {
  const { language } = useI18n();
  const copy = (value: string) => eventCopy(language, value);

  const styles = {
    pink: 'bg-pink-50 border-pink-100',
    amber: 'bg-amber-50 border-amber-100',
    blue: 'bg-blue-50 border-blue-100',
  } as const;

  return (
    <div className={`rounded-xl border p-4 ${styles[tone]}`}>
      <div className="text-xs font-black uppercase tracking-wide text-gray-700 mb-2">{copy(title)}</div>
      <p className="text-sm text-gray-600 leading-relaxed">{copy(detail)}</p>
    </div>
  );
}
