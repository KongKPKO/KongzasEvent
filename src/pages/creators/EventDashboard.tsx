import './sales-reports.css';
import EventDateFilter from '../../components/EventDateFilter';
import { uiText, useI18n } from '../../i18n';
import { eventCopy } from '../../lib/eventCopy';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import EventNavTabs from '../../components/EventNavTabs';
import AdminHeader from '../../components/AdminHeader';
import ProductSalesBreakdown from '../../components/reports/ProductSalesBreakdown';
import { supabase } from '../../supabaseClient';
import { buildUtf8Csv, downloadUtf8Csv } from '../../lib/productSalesReport';
import { ArrowLeft, Clock3, CreditCard, DollarSign, Download, PackageCheck, ShoppingBag, Store, Ticket, TrendingUp, Users } from 'lucide-react';
import { formatPrice } from '../../utils/currency';
import { normalizeEventRecord } from '../../utils/schemaCompat';


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

interface SalesAnalytics {
  currency: string; currencies: string[]; revenue: number; subtotal: number; discountTotal: number;
  itemCount: number; completedOrderCount: number; avgOrderValue: number;
  paymentSummary: {cashOrders:number; cashRevenue:number; transferOrders:number; transferRevenue:number};
  orderTypeSummary: {preorderOrders:number; preorderRevenue:number; postOrders:number; postRevenue:number; awaitingPickupCount:number; liveQueueOrders:number; liveQueueRevenue:number; walkinOrders:number; walkinRevenue:number};
  queueSummary: {totalQueues:number; completedQueues:number; expiredQueues:number; missedQueues:number; activeQueues:number; conversionRate:number; avgWaitMinutes:number; avgServiceMinutes:number};
  topProducts: Array<{name:string; qty:number; revenue:number; category:string}>;
  categoryBreakdown: Array<{category:string; qty:number; revenue:number}>;
  hourlySales: Array<{hour:string; orders:number; revenue:number}>;
}
const emptyAnalytics: SalesAnalytics = {
  currency:'THB',currencies:[],revenue:0,subtotal:0,discountTotal:0,itemCount:0,completedOrderCount:0,avgOrderValue:0,
  paymentSummary:{cashOrders:0,cashRevenue:0,transferOrders:0,transferRevenue:0},
  orderTypeSummary:{preorderOrders:0,preorderRevenue:0,postOrders:0,postRevenue:0,awaitingPickupCount:0,liveQueueOrders:0,liveQueueRevenue:0,walkinOrders:0,walkinRevenue:0},
  queueSummary:{totalQueues:0,completedQueues:0,expiredQueues:0,missedQueues:0,activeQueues:0,conversionRate:0,avgWaitMinutes:0,avgServiceMinutes:0},
  topProducts:[],categoryBreakdown:[],hourlySales:[],
};

export default function EventDashboard() {
  const { language } = useI18n();
  const copy = (value: string) => eventCopy(language, value);
  const th = language === 'th';

  const { eventId } = useParams();
  const navigate = useNavigate();
  const formatMinutes = (value: number) => language === 'th' ? `${Math.round(value)} นาที` : `${Math.round(value)}m`;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [eventInfo, setEventInfo] = useState<EventInfo | null>(null);
  const [analytics, setAnalytics] = useState<SalesAnalytics>(emptyAnalytics);
  const [currencyFilter, setCurrencyFilter] = useState('');

  const [searchParams, setSearchParams] = useSearchParams();
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  const timeZone = eventInfo?.event_timezone || 'Asia/Bangkok';
  const changeDates = (nextFrom: string, nextTo: string) => {
    if (nextFrom && nextTo && nextFrom > nextTo) {
      if (nextFrom !== from) nextTo = nextFrom; else nextFrom = nextTo;
    }
    const next = new URLSearchParams(searchParams);
    if (nextFrom) next.set('from', nextFrom); else next.delete('from');
    if (nextTo) next.set('to', nextTo); else next.delete('to');
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (!eventId) return;
    let active = true;
    setLoading(true); setLoadError(false);
    void Promise.all([
      supabase.from('events').select('*').eq('id',eventId).single(),
      supabase.rpc('get_event_sales_analytics',{p_event_id:eventId,p_from:from||null,p_to:to||null,p_currency:currencyFilter||null}),
    ]).then(([eventResult,reportResult])=>{
      if (!active) return;
      if (eventResult.error) throw eventResult.error;
      if (reportResult.error) throw reportResult.error;
      if (!reportResult.data) throw new Error('sales_analytics_missing');
      setEventInfo(normalizeEventRecord(eventResult.data as Record<string, unknown>) as unknown as EventInfo);
      setAnalytics(reportResult.data as SalesAnalytics);
    }).catch(error=>{if(active){console.error('[EventDashboard] fetch failed:',error);setLoadError(true);}})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  }, [eventId,from,to,currencyFilter]);

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
    {from && to && from > to && <button type="button" className="mt-3 min-h-11 rounded-xl border border-gray-200 px-4" onClick={() => changeDates('', '')}>{th ? 'ล้างช่วงวันที่' : 'Clear date range'}</button>}
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
      ['Currency', analytics.currency],
      ['Net Revenue', String(analytics.revenue)],
      ['Discount Given', String(analytics.discountTotal)],
      ['Completed Orders', String(analytics.completedOrderCount)],
      ['Items Sold', String(analytics.itemCount)],
      ['Queue Conversion %', String(Math.round(analytics.queueSummary.conversionRate))],
      ['Avg Wait Minutes', String(Math.round(analytics.queueSummary.avgWaitMinutes))],
      ['Avg Service Minutes', String(Math.round(analytics.queueSummary.avgServiceMinutes))],
    ];
    downloadUtf8Csv(buildUtf8Csv(rows), `${eventInfo.event_name.replace(/[^a-z0-9ก-๙]+/gi, '-').toLowerCase()}-summary.csv`);
  };

  return (
    <div>
      <AdminHeader activePage="events" activeEvent={eventId ? { id: eventId, event_name: eventInfo.event_name } : undefined} />
    <div className="sales-reports min-h-screen bg-gray-50 p-4 sm:p-6 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        {eventId && <EventNavTabs eventName={eventInfo.event_name} eventId={eventId} active="dashboard" />}
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
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">{th ? 'ภาพรวมยอดขาย' : 'Sales dashboard'}</h2>
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
{analytics.currencies.length>1 && <label className="report-panel block text-sm font-bold">{th?'สกุลเงินในรายงาน':'Report currency'}<select aria-label={th?'สกุลเงินในรายงาน':'Report currency'} value={analytics.currency} onChange={event=>setCurrencyFilter(event.target.value)} className="ml-3 min-h-11 rounded-xl border px-3">{analytics.currencies.map(code=><option key={code} value={code}>{code}</option>)}</select><span className="ml-3 text-xs text-gray-500">{th?'แสดงยอดเงินแยกตามสกุลเงิน':'Money totals are shown separately for each currency.'}</span></label>}
          <EventDateFilter from={from} to={to} timeZone={timeZone} onChange={changeDates} />
        <div className="report-metrics grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard icon={<DollarSign size={18} />} title={copy("Net Revenue")} value={formatPrice(analytics.revenue, analytics.currency)} helper={`${analytics.completedOrderCount} ${copy('completed orders')}`} tone="pink" />
          <MetricCard icon={<TrendingUp size={18} />} title={copy("Discount Given")} value={formatPrice(analytics.discountTotal, analytics.currency)} helper={`${th ? 'ยอดก่อนส่วนลด' : 'Before discounts'} ${formatPrice(analytics.subtotal, analytics.currency)}`} tone="emerald" />
          <MetricCard icon={<ShoppingBag size={18} />} title={th ? "ชิ้นสินค้า รวมของแถม" : "Units including gifts"} value={String(analytics.itemCount)} helper={`${th ? 'เฉลี่ยต่อออเดอร์' : 'Average order'} ${formatPrice(analytics.avgOrderValue, analytics.currency)}`} tone="blue" />
          <MetricCard icon={<Ticket size={18} />} title={th ? "ออเดอร์สำเร็จ" : "Completed orders"} value={String(analytics.completedOrderCount)} helper={th ? "ตามช่วงวันที่เลือก" : "In the selected period"} tone="slate" />
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
                <RecommendationCard key={card.title} title={uiText(language, card.title)} detail={card.detail} tone={card.tone} />
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
                    <div className="text-xs text-gray-400">{product.category === 'Other' ? uiText(language, 'Other') : product.category}</div>
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

        {eventId && <ProductSalesBreakdown eventId={eventId} eventName={eventInfo.event_name} from={from} to={to} currency={analytics.currency} />}

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
