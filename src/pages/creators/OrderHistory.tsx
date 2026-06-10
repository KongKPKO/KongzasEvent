import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { ArrowLeft, DollarSign, CreditCard, ShoppingBag, FileText, LayoutList, PackageCheck } from 'lucide-react';
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
    customer_contact: string | null;
    pickup_status: PickupStatus | null;
    picked_up_at: string | null;
}

interface EventInfo {
    event_name: string;
    start_date: string;
}

export default function EventHistory() {
    const { eventId } = useParams();
    const navigate = useNavigate();
    const [orders, setOrders] = useState<Order[]>([]);
    const [eventInfo, setEventInfo] = useState<EventInfo | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (eventId) {
            fetchEventData();
        }
    }, [eventId]);

    const fetchEventData = async () => {
        setLoading(true);
        try {
            const { data: event } = await supabase
                .from('events')
                .select('event_name, start_date') 
                .eq('id', eventId)
                .single();
            
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
                    customer_contact,
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
            if (ordersData) setOrders(ordersData as any);

        } catch (err) {
            console.error("Error fetching history:", err);
        } finally {
            setLoading(false);
        }
    };

    const summary = useMemo(() => {
        const totalRevenue = orders.reduce((sum, o) => sum + o.total_price, 0);
        const totalOrders = orders.length;
        const getOrderType = (order: Order): OrderType => order.order_type || (order.queue_id ? 'live_queue' : 'pos_walkin');

        const cashOnly = orders.filter(o => o.payment_method === 'cash');
        const cashTotal = cashOnly.reduce((sum, o) => sum + o.total_price, 0);
        const cashOrders = cashOnly.length;

        const transferOnly = orders.filter(o => o.payment_method === 'transfer');
        const transferTotal = transferOnly.reduce((sum, o) => sum + o.total_price, 0);
        const transferOrders = transferOnly.length;
        const preorderOrders = orders.filter(order => getOrderType(order) === 'preorder');
        const preorderTotal = preorderOrders.reduce((sum, order) => sum + order.total_price, 0);

        const productStats: Record<string, { name: string; qty: number; total: number }> = {};
        
        orders.forEach(order => {
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
    }, [orders]);

    if (loading) return <div className="p-10 text-center text-gray-400">Loading history...</div>;

    return (
        <div className="min-h-screen bg-gray-50 p-6 font-sans">
            {/* --- HEADER --- */}
            <div className="max-w-5xl mx-auto mb-8 flex items-center gap-4">
                <button onClick={() => navigate('/manage-events')} className="p-2.5 bg-white rounded-xl shadow-sm border border-gray-100 hover:bg-gray-50 transition text-gray-500">
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h1 className="text-2xl font-black text-gray-800 tracking-tight">Order History</h1>
                    <p className="text-sm font-bold text-pink-500 flex items-center gap-1.5 mt-0.5">
                        <LayoutList size={14}/> 
                        {eventInfo?.event_name || 'Loading...'} 
                        <span className="text-gray-300">|</span>
                        <span className="text-gray-500 font-medium">
                            {eventInfo?.start_date ? new Date(eventInfo.start_date).toLocaleDateString('en-GB') : ''}
                        </span>
                    </p>
                </div>
            </div>

            <div className="max-w-5xl mx-auto space-y-6">
                {/* 1. Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-pink-100">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-full bg-pink-100 flex items-center justify-center text-pink-600"><DollarSign size={20} /></div>
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Revenue</span>
                        </div>
                        {/* ✅ FIX: Use currency from first order or default */}
                        <div className="text-3xl font-black text-gray-800">{formatPrice(summary.totalRevenue, orders[0]?.currency || 'THB')}</div>
                        <div className="text-xs text-gray-400 mt-1 font-medium">{summary.totalOrders} completed orders</div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-emerald-100">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600"><DollarSign size={20} /></div>
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Cash</span>
                        </div>
                        <div className="text-3xl font-black text-gray-800">{formatPrice(summary.cashTotal, orders[0]?.currency || 'THB')}</div>
                        <div className="text-xs text-gray-400 mt-1 font-medium">{summary.cashOrders} completed cash method</div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-blue-100">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600"><CreditCard size={20} /></div>
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Transfer</span>
                        </div>
                        <div className="text-3xl font-black text-gray-800">{formatPrice(summary.transferTotal, orders[0]?.currency || 'THB')}</div>
                        <div className="text-xs text-gray-400 mt-1 font-medium">{summary.transferOrders} completed transfer method</div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-rose-100">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center text-rose-600"><PackageCheck size={20} /></div>
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Pre-order</span>
                        </div>
                        <div className="text-3xl font-black text-gray-800">{formatPrice(summary.preorderTotal, orders[0]?.currency || 'THB')}</div>
                        <div className="text-xs text-gray-400 mt-1 font-medium">{summary.preorderOrders} completed pre-orders</div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* 2. Product Breakdown */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 lg:col-span-1 h-fit">
                        <h3 className="font-bold text-gray-800 mb-5 flex items-center gap-2 text-sm uppercase tracking-wide"><ShoppingBag size={16}/> Product Sales</h3>
                        <div className="space-y-4">
                            {summary.topProducts.map((prod, idx) => (
                                <div key={idx} className="flex justify-between items-center border-b border-gray-50 pb-3 last:border-0 last:pb-0">
                                    <div className="min-w-0 flex-1 pr-2">
                                        <div className="text-sm font-bold text-gray-700 truncate">{prod.name}</div>
                                        <div className="text-[10px] text-gray-400 font-medium">Sold: {prod.qty} units</div>
                                    </div>
                                    <div className="font-bold text-gray-800 text-sm">{formatPrice(prod.total, orders[0]?.currency || 'THB')}</div>
                                </div>
                            ))}
                            {summary.topProducts.length === 0 && <div className="text-center text-gray-400 text-sm py-4">No sales yet</div>}
                        </div>
                    </div>

                    {/* 3. Transaction History Table */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden lg:col-span-2">
                        <div className="p-6 border-b border-gray-100">
                            <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm uppercase tracking-wide"><FileText size={16}/> Transactions</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-gray-50/50 text-gray-400 text-[10px] uppercase font-bold tracking-wider">
                                    <tr>
                                        {/* ✅ ลด Padding เหลือ px-4 */}
                                        <th className="px-4 py-3">Date & Time</th>
                                        <th className="px-4 py-3">Customer</th>
                                        <th className="px-4 py-3">Items</th>
                                        <th className="px-4 py-3 text-right">Amount</th>
                                        <th className="px-4 py-3 text-right">Method</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {orders.map((order) => (
                                        <tr key={order.id} className="hover:bg-gray-50/80 transition-colors group">
                                            {/* ✅ ลด Padding และปรับ Date Time */}
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <div className="flex flex-col">
                                                    <span className="text-xs font-bold text-gray-700">
                                                        {new Date(order.created_at).toLocaleDateString('en-GB', {day: '2-digit', month: 'short', year: 'numeric'})}
                                                    </span>
                                                    <span className="text-[10px] text-gray-400 font-medium">
                                                        {new Date(order.created_at).toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'})}
                                                    </span>
                                                </div>
                                            </td>
                                            
                                            {/* ✅ เพิ่ม whitespace-nowrap เพื่อแก้ Walk-in ตกบรรทัด */}
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                {order.order_type === 'preorder' ? (
                                                    <div>
                                                        <span className="bg-rose-50 text-rose-700 px-2 py-1 rounded-md text-xs font-bold border border-rose-100 whitespace-nowrap">{order.customer_name || 'Pre-order'}</span>
                                                        {order.customer_contact && <div className="mt-1 text-[10px] font-semibold text-gray-400">{order.customer_contact}</div>}
                                                        <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-bold">
                                                            <span className="rounded-md bg-pink-50 px-2 py-1 text-pink-700">Pre-order</span>
                                                            {order.pickup_code && <span className="rounded-md bg-gray-100 px-2 py-1 text-gray-600">{order.pickup_code}</span>}
                                                            {order.pickup_status && <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">{order.pickup_status}</span>}
                                                        </div>
                                                    </div>
                                                ) : order.queues ? (
                                                    <span className="bg-pink-50 text-pink-600 px-2 py-1 rounded-md text-xs font-bold border border-pink-100 whitespace-nowrap">#{order.queues.queue_number}</span>
                                                ) : (
                                                    <span className="bg-gray-100 text-gray-500 px-2 py-1 rounded-md text-xs font-bold border border-gray-200 whitespace-nowrap">Walk-in</span>
                                                )}
                                            </td>

                                            <td className="px-4 py-3 text-sm text-gray-700">
                                                <div className="flex flex-col gap-1">
                                                    {order.order_items.map((item, idx) => (
                                                        <div key={idx} className="flex items-center gap-1.5 truncate max-w-[200px] text-xs">
                                                            <span className="font-black text-gray-800 bg-gray-100 px-1 rounded">{item.quantity}x</span> 
                                                            <span className="truncate text-gray-600">{item.products?.name}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </td>
                                            
                                            <td className="px-4 py-3 text-right font-black text-gray-800 text-sm whitespace-nowrap">
                                                {formatPrice(order.total_price, order.currency)}
                                            </td>
                                            
                                            <td className="px-4 py-3 text-right whitespace-nowrap">
                                                {order.payment_method === 'transfer' ? (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full"><CreditCard size={10}/> Transfer</span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full"><DollarSign size={10}/> Cash</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {orders.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="px-4 py-12 text-center text-gray-400 text-sm">No transactions found for this event.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
