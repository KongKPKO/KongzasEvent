import './sales-reports.css';
import EventDateFilter, { matchesEventDate } from '../../components/EventDateFilter';
import { useI18n } from '../../i18n';
import { eventCopy } from '../../lib/eventCopy';
import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import EventNavTabs from '../../components/EventNavTabs';
import { supabase } from '../../supabaseClient';
import { ArrowLeft } from 'lucide-react';
import { formatPrice } from '../../utils/currency'; // ✅ NEW
import type { OrderType, PickupStatus } from '../../types/preorder';

interface OrderItem {
    quantity: number;
    price_per_unit: number;
    products: {
        name: string;
        image_url: string | null;
    } | null;
}

interface Order {
    id: string;
    created_at: string;
    total_price: number;
    payment_method: 'cash' | 'transfer';
    status: string;
    queue_id: string | null;
    queues: { queue_number: string } | null;
    order_items: OrderItem[];
    currency: string; // ✅ NEW
    order_type: OrderType | null;
    pickup_code: string | null;
    customer_name: string | null;
    pickup_status: PickupStatus | null;
    picked_up_at: string | null;
}

interface EventInfo {
    event_timezone?: string | null;
    event_name: string;
    start_date: string;
}

export default function EventHistory() {
  const { language } = useI18n();
  const copy = (value: string) => eventCopy(language, value);

    const { eventId } = useParams();
    const navigate = useNavigate();
    const [orders, setOrders] = useState<Order[]>([]);
    const [eventInfo, setEventInfo] = useState<EventInfo | null>(null);
    const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  const timeZone = eventInfo?.event_timezone || 'Asia/Bangkok';
  const th = language === 'th';
  const query = searchParams.get('q') || '';
  const method = searchParams.get('method') || '';
  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next, { replace: true });
  };
  const filteredOrders = useMemo(() => orders.filter(order =>
    matchesEventDate(order.created_at, from, to, timeZone) &&
    (!method || order.payment_method === method) &&
    (!query.trim() || [order.id, order.customer_name, order.pickup_code, order.queues?.queue_number,
      ...order.order_items.map(item => item.products?.name)].some(value => value?.toLowerCase().includes(query.trim().toLowerCase())))
  ), [orders, from, to, timeZone, query, method]);
  const changeDates = (nextFrom: string, nextTo: string) => {
    const next = new URLSearchParams(searchParams);
    if (nextFrom) next.set('from', nextFrom); else next.delete('from');
    if (nextTo) next.set('to', nextTo); else next.delete('to');
    setSearchParams(next, { replace: true });
  };

    useEffect(() => {
        if (eventId) {
            fetchEventData();
        }
    }, [eventId]);

    const fetchEventData = async () => {
        setLoading(true);
        setLoadError(false);
        try {
            const { data: event, error: eventError } = await supabase
                .from('events')
                .select('event_name, start_date, event_timezone')
                .eq('id', eventId)
                .single();

            if (eventError) throw eventError;
            if (event) setEventInfo(event);

            const { data: ordersData, error } = await supabase
                .from('orders')
                .select(`
                    id,
                    created_at,
                    event_id,
                    queue_id,
                    status,
                    total_price,
                    payment_method,
                    currency,
                    order_type,
                    pickup_code,
                    customer_name,
                    pickup_status,
                    picked_up_at,
                    subtotal_price,
                    discount_total,
                    pricing_breakdown,
                    queues (queue_number),
                    order_items (
                        quantity,
                        price_per_unit,
                        products (name, image_url)
                    )
                `)
                .eq('event_id', eventId)
                .eq('status', 'completed')
                .order('created_at', { ascending: false });

            if (error) throw error;
            if (ordersData) setOrders(ordersData as unknown as Order[]);

        } catch (err) {
            console.error("Error fetching history:", err);
            setLoadError(true);
        } finally {
            setLoading(false);
        }
    };

    const summary = useMemo(() => {
        const totalRevenue = filteredOrders.reduce((sum, o) => sum + Number(o.total_price), 0);
        const totalOrders = filteredOrders.length;
        const getOrderType = (order: Order): OrderType => order.order_type || (order.queue_id ? 'live_queue' : 'pos_walkin');

        const cashOnly = filteredOrders.filter(o => o.payment_method === 'cash');
        const cashTotal = cashOnly.reduce((sum, o) => sum + Number(o.total_price), 0);
        const cashOrders = cashOnly.length;

        const transferOnly = filteredOrders.filter(o => o.payment_method === 'transfer');
        const transferTotal = transferOnly.reduce((sum, o) => sum + Number(o.total_price), 0);
        const transferOrders = transferOnly.length;
        const preorderOrders = filteredOrders.filter(order => getOrderType(order) === 'preorder');
        const preorderTotal = preorderOrders.reduce((sum, order) => sum + Number(order.total_price), 0);

        const productStats: Record<string, { name: string; qty: number; total: number }> = {};

        filteredOrders.forEach(order => {
            order.order_items.forEach(item => {
                const prodName = item.products?.name || 'Unknown';
                if (!productStats[prodName]) {
                    productStats[prodName] = { name: prodName, qty: 0, total: 0 };
                }
                productStats[prodName].qty += item.quantity;
                productStats[prodName].total += (item.quantity * item.price_per_unit);
            });
        });

        const topProducts = Object.values(productStats).sort((a, b) => b.qty - a.qty);

        return { totalRevenue, totalOrders, cashTotal, transferTotal, cashOrders, transferOrders, preorderTotal, preorderOrders: preorderOrders.length, topProducts };
    }, [filteredOrders]);

  if (loadError) return <div role="alert" className="mx-auto max-w-lg p-6 text-center">
    <p>{language === 'th' ? 'โหลดข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง' : 'Could not load data. Please try again.'}</p>
    <button type="button" className="mt-3 min-h-11 rounded-xl border border-gray-200 px-4" onClick={() => window.location.reload()}>{language === 'th' ? 'ลองอีกครั้ง' : 'Retry'}</button>
  </div>;

    if (loading) return <div className="p-10 text-center text-gray-400">{copy("Loading history...")}</div>;

    return (
      <main className="sales-reports min-h-screen bg-gray-50 p-4 sm:p-6">
        <div className="max-w-6xl mx-auto space-y-5">
          {eventId && <EventNavTabs eventId={eventId} active="history" />}
          <header className="flex items-start gap-3">
            <button type="button" onClick={() => navigate(`/manage-events/${eventId}/workspace`)} aria-label={copy("Back to event workspace")} className="report-icon"><ArrowLeft size={20} /></button>
            <div><h1 className="text-2xl font-black">{th ? 'ประวัติการขาย' : 'Sales history'}</h1><p className="text-sm text-gray-600 mt-1">{eventInfo?.event_name}</p></div>
          </header>
          <EventDateFilter from={from} to={to} timeZone={timeZone} onChange={changeDates} />
          <section className="report-filters" aria-label={th ? 'กรองรายการขาย' : 'Filter sales'}>
            <label className="flex-1">{th ? 'ค้นหารายการ' : 'Search sales'}<input type="search" value={query} onChange={e => updateFilter('q', e.target.value)} placeholder={th ? 'รหัสออเดอร์ ชื่อลูกค้า คิว หรือสินค้า' : 'Order ID, customer, queue or product'} /></label>
            <label>{th ? 'การชำระเงิน' : 'Payment method'}<select aria-label={th ? 'การชำระเงิน' : 'Payment method'} value={method} onChange={e => updateFilter('method', e.target.value)}><option value="">{th ? 'ทุกวิธี' : 'All methods'}</option><option value="cash">{copy('Cash')}</option><option value="transfer">{copy('Transfer')}</option></select></label>
          </section>
          <section className="report-totals" aria-label={th ? 'ยอดตามตัวกรอง' : 'Filtered totals'}>
            <div><span>{th ? 'ยอดขายตามตัวกรอง' : 'Filtered sales'}</span><strong>{formatPrice(summary.totalRevenue, orders[0]?.currency || 'THB')}</strong><small>{summary.totalOrders} {copy('completed orders')}</small></div>
            <div><span>{copy('Cash')}</span><strong>{formatPrice(summary.cashTotal, orders[0]?.currency || 'THB')}</strong><small>{summary.cashOrders} {copy('orders')}</small></div>
            <div><span>{copy('Transfer')}</span><strong>{formatPrice(summary.transferTotal, orders[0]?.currency || 'THB')}</strong><small>{summary.transferOrders} {copy('orders')}</small></div>
          </section>
          <p className="text-sm text-gray-600">{th ? 'แสดงเฉพาะออเดอร์ที่ขายสำเร็จ ยอดหลังส่วนลดตามที่บันทึกไว้ในออเดอร์' : 'Completed orders only. Totals use the saved order amount after discounts.'}</p>
          <section className="report-panel">
            <h2 className="text-lg font-bold mb-4">{th ? `รายการขาย (${filteredOrders.length})` : `Transactions (${filteredOrders.length})`}</h2>
            {filteredOrders.length === 0 ? <div className="py-10 text-center"><p>{th ? 'ไม่พบรายการขายที่ตรงกับตัวกรอง' : 'No sales match these filters.'}</p><button type="button" className="report-button mt-4" onClick={() => setSearchParams({}, { replace: true })}>{th ? 'ล้างตัวกรองทั้งหมด' : 'Clear all filters'}</button></div> :
              <div className="space-y-3">{filteredOrders.map(order => <details key={order.id} className="report-order">
                <summary>
                  <div className="min-w-0"><span className="font-bold block break-words">{order.customer_name || (order.queues ? `#${order.queues.queue_number}` : copy('Walk-in'))}</span><span className="text-xs text-gray-600 block break-all">{order.pickup_code || order.id}</span><time className="text-xs text-gray-600" dateTime={order.created_at}>{new Date(order.created_at).toLocaleString(th ? 'th-TH' : 'en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'short' })}</time></div>
                  <div className="text-right shrink-0"><strong className="block">{formatPrice(order.total_price, order.currency)}</strong><span className="text-xs">{copy(order.payment_method === 'transfer' ? 'Transfer' : 'Cash')}</span><span className="block text-xs text-pink-700 mt-1">{th ? 'ดูรายละเอียด' : 'View details'}</span></div>
                </summary>
                <div className="report-order-body"><p className="text-sm mb-3">{th ? 'ช่องทาง: ' : 'Channel: '}{copy(order.order_type === 'preorder' ? 'Pre-order' : order.order_type === 'post_event' ? 'Post-order' : order.queue_id ? 'Live Queue' : 'Walk-in')}</p>
                  {order.pickup_status && order.pickup_status !== 'not_required' && <p className="text-sm mb-3">{th ? 'การรับสินค้า: ' : 'Fulfillment: '}{({ awaiting_pickup: th ? 'รอรับสินค้า' : 'Awaiting pickup', picked_up: th ? 'รับสินค้าแล้ว' : 'Picked up', cancelled: th ? 'ยกเลิก' : 'Cancelled', expired: th ? 'หมดอายุ' : 'Expired', awaiting_shipment: th ? 'รอจัดส่ง' : 'Awaiting shipment', shipped: th ? 'จัดส่งแล้ว' : 'Shipped' })[order.pickup_status]}{order.picked_up_at && ` · ${new Date(order.picked_up_at).toLocaleString(th ? 'th-TH' : 'en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'short' })}`}</p>}
                  {order.order_items.length === 0 && <p className="text-sm text-gray-600">{th ? 'ไม่มีรายละเอียดสินค้าในรายการนี้' : 'No item details for this order.'}</p>}
                  {order.order_items.map((item, index) => <div key={index} className="flex justify-between gap-4 py-2 text-sm"><span>{item.quantity} × {item.products?.name || (th ? 'สินค้าเดิมถูกลบแล้ว' : 'Product removed')}</span><span className="shrink-0">{formatPrice(item.quantity * item.price_per_unit, order.currency)}</span></div>)}
                  <p className="text-xs text-gray-600 mt-3">{th ? 'ราคาสินค้าแต่ละรายการก่อนส่วนลด ยอดชำระจริงแสดงด้านบน' : 'Line prices are before discounts. The paid total appears above.'}</p>
                </div>
              </details>)}</div>}
          </section>
          <details className="report-panel"><summary className="font-bold cursor-pointer">{th ? 'สินค้าที่ขายในช่วงที่เลือก' : 'Products sold in this selection'}</summary><p className="text-xs text-gray-600 my-3">{th ? 'มูลค่าสินค้าก่อนส่วนลด รวมรายการของแถมราคา 0' : 'Item value before discounts, including zero-priced gifts.'}</p>{summary.topProducts.map(prod => <div key={prod.name} className="flex justify-between gap-4 py-3 border-b border-gray-100 text-sm"><span>{prod.name} · {prod.qty} {copy('units')}</span><strong>{formatPrice(prod.total, orders[0]?.currency || 'THB')}</strong></div>)}</details>
        </div>
      </main>
    );
}
