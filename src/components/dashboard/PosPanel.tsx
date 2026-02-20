import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { RealtimeChannel } from '@supabase/supabase-js';
import { User, CheckCircle } from 'lucide-react';
import { formatPrice } from '../../utils/currency';
import type { ActorContext } from '../../types/access';

interface Product {
    id: string;
    name: string;
    price: number;
    image_url: string | null;
    status: string;
    category: string | null;
    currency?: string;
    stock_total?: number | null;
    stock_reserved?: number;
    stock_sold?: number;
    is_unlimited?: boolean;
}

interface CartItem { product: Product; quantity: number; notes?: string; }

interface ActiveEvent {
    id: string;
    event_name: string;
    start_date: string;
    end_date: string;
    is_booth_open: boolean;
    status: string;
}

interface QueueItem {
    id: string;
    artist_id: string;
    event_id?: string;
    queue_number: number;
    status: 'waiting' | 'calling' | 'serving' | 'complete' | 'missed' | 'expired' | 'queued';
    last_updated_at: string;
    created_at?: string;
    served_at?: string;
    completed_at?: string;
}

type SortType = 'name' | 'price_low' | 'price_high';

interface POSPanelProps {
    activeEvent: ActiveEvent | null;
    servingQueues: QueueItem[];
    selectedQueueId: string | null;
    selectedQueueNumber: string | null;
    actorContext: ActorContext;
    canUsePos: boolean;
    onSelectQueue: (queue: { id: string; queue_number: string }) => void;
    onClearQueue: () => void;
}

export default function POSPanel({
    activeEvent,
    servingQueues,
    selectedQueueId,
    selectedQueueNumber,
    actorContext,
    canUsePos,
    onSelectQueue,
    onClearQueue,
}: POSPanelProps) {
    const [products, setProducts] = useState<Product[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);

    const selectedQueueIdRef = useRef<string | null>(null);
    const productsRef = useRef<Product[]>([]);
    const isFetchingRef = useRef(false);

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const [sortBy, setSortBy] = useState<SortType>('name');

    useEffect(() => {
        selectedQueueIdRef.current = selectedQueueId;
    }, [selectedQueueId]);

    useEffect(() => {
        productsRef.current = products;
    }, [products]);

    const getAvailableUnits = (product: Product) => {
        if (product.is_unlimited) return Number.POSITIVE_INFINITY;
        const total = product.stock_total || 0;
        const reserved = product.stock_reserved || 0;
        const sold = product.stock_sold || 0;
        return Math.max(0, total - reserved - sold);
    };

    const fetchProducts = useCallback(async () => {
        if (!canUsePos) {
            setProducts([]);
            return;
        }

        const { data } = await supabase
            .from('products')
            .select('id, name, price, image_url, status, category, currency, stock_total, stock_reserved, stock_sold, is_unlimited')
            .eq('artist_id', actorContext.artist_id)
            .eq('status', 'enable')
            .is('deleted_at', null)
            .order('name');

        if (data) setProducts(data);
    }, [actorContext.artist_id, canUsePos]);

    useEffect(() => {
        fetchProducts();

        if (!canUsePos) return;

        const channel = supabase
            .channel(`pos-panel-products-${actorContext.artist_id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `artist_id=eq.${actorContext.artist_id}` }, fetchProducts)
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchProducts, actorContext.artist_id, canUsePos]);

    const fetchCurrentOrder = useCallback(async () => {
        if (!canUsePos || !activeEvent) return;
        if (isFetchingRef.current) return;

        isFetchingRef.current = true;
        const targetQueueId = selectedQueueIdRef.current;
        setLoading(true);

        try {
            let query = supabase
                .from('orders')
                .select('id, status, queue_id, event_id, order_items(product_id, quantity, notes)')
                .in('status', ['draft', 'confirmed'])
                .eq('event_id', activeEvent.id);

            if (targetQueueId) {
                query = query.eq('queue_id', targetQueueId);
            } else {
                query = query.is('queue_id', null);
            }

            const { data: order, error } = await query
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (selectedQueueIdRef.current !== targetQueueId) {
                isFetchingRef.current = false;
                return;
            }

            if (error) {
                console.error('[POS] Error fetching order:', error);
                setLoading(false);
                isFetchingRef.current = false;
                return;
            }

            if (!order) {
                setCurrentOrderId(null);
                setCart([]);
                return;
            }

            setCurrentOrderId(order.id);

            const currentProducts = productsRef.current;
            const items = Array.isArray((order as any).order_items) ? (order as any).order_items : [];

            if (items.length > 0 && currentProducts.length > 0) {
                const newCart: CartItem[] = items
                    .map((item: { product_id: string; quantity: number; notes?: string }) => {
                        const prod = currentProducts.find((p) => p.id === item.product_id);
                        return prod ? { product: prod, quantity: item.quantity, notes: item.notes } : null;
                    })
                    .filter(Boolean) as CartItem[];
                setCart(newCart);
            } else {
                setCart([]);
            }
        } catch (err) {
            console.error('[POS] Critical fetch order error:', err);
        } finally {
            isFetchingRef.current = false;
            if (selectedQueueIdRef.current === targetQueueId) {
                setLoading(false);
            }
        }
    }, [activeEvent?.id, canUsePos]);

    useEffect(() => {
        setCart([]);
        setCurrentOrderId(null);
        setLoading(false);
        isFetchingRef.current = false;

        if (activeEvent && canUsePos) {
            fetchCurrentOrder();
        }

        let orderChannel: RealtimeChannel | null = null;

        if (selectedQueueId && canUsePos) {
            const channelName = `pos-orders-${selectedQueueId}-${Date.now()}`;
            orderChannel = supabase
                .channel(channelName)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `queue_id=eq.${selectedQueueId}` }, (payload) => {
                    if (payload.eventType === 'UPDATE') {
                        const nextStatus = (payload.new as { status?: string }).status;
                        if (nextStatus === 'cancelled' || nextStatus === 'completed') {
                            setCart([]);
                            setCurrentOrderId(null);
                            return;
                        }
                    }
                    fetchCurrentOrder();
                })
                .subscribe();
        }

        return () => {
            if (orderChannel) {
                supabase.removeChannel(orderChannel);
            }
        };
    }, [selectedQueueId, activeEvent?.id, fetchCurrentOrder, canUsePos]);

    const categories = useMemo(() => {
        const cats = products.map((p) => p.category).filter(Boolean) as string[];
        return ['All', ...new Set(cats)];
    }, [products]);

    const filteredProducts = useMemo(() => {
        const result = products
            .filter((product) => {
                const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase());
                const matchesCategory = selectedCategory === 'All' || product.category === selectedCategory;
                const inStock = getAvailableUnits(product) > 0;
                return matchesSearch && matchesCategory && inStock;
            })
            .sort((a, b) => {
                if (sortBy === 'price_low') return a.price - b.price;
                if (sortBy === 'price_high') return b.price - a.price;
                return a.name.localeCompare(b.name);
            });

        return result;
    }, [products, searchQuery, selectedCategory, sortBy]);

    const getProductImage = (path: string | null) => {
        if (!path) return '';
        if (path.startsWith('http') || path.startsWith('blob:')) return path;
        const { data } = supabase.storage.from('Menu').getPublicUrl(path);
        return data.publicUrl;
    };

    const addToCart = (product: Product) => {
        if (!canUsePos) return;

        setCart((prev) => {
            const existing = prev.find((item) => item.product.id === product.id);
            const currentQty = existing?.quantity || 0;
            const available = getAvailableUnits(product);
            if (!Number.isFinite(available)) {
                if (existing) return prev.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
                return [...prev, { product, quantity: 1 }];
            }

            if (currentQty + 1 > available) return prev;
            if (existing) return prev.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
            return [...prev, { product, quantity: 1 }];
        });
    };

    const decreaseQuantity = (productId: string) => {
        setCart((prev) => prev
            .map((item) => item.product.id === productId ? { ...item, quantity: item.quantity - 1 } : item)
            .filter((item) => item.quantity > 0));
    };

    const removeFromCart = (productId: string) => {
        setCart((prev) => prev.filter((item) => item.product.id !== productId));
    };

    const totalPrice = useMemo(() => cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0), [cart]);

    const buildItemPayload = () => cart.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
        notes: item.notes || '',
    }));

    const handlePayment = async (method: 'cash' | 'transfer') => {
        if (!canUsePos) {
            alert('You do not have POS permission.');
            return;
        }
        if (!activeEvent) {
            alert('Cannot process payment: No active event.');
            return;
        }
        if (cart.length === 0) {
            alert('Cart is empty.');
            return;
        }

        setLoading(true);

        try {
            const payloadItems = buildItemPayload();
            if (currentOrderId) {
                const { error: syncError } = await supabase.rpc('sync_customer_order_items_with_stock', {
                    p_order_id: currentOrderId,
                    p_items: payloadItems,
                });
                if (syncError) throw syncError;

                const { error: completeError } = await supabase.rpc('complete_order_with_stock', {
                    p_order_id: currentOrderId,
                    p_payment_method: method,
                });
                if (completeError) throw completeError;
            } else if (selectedQueueId) {
                const { data: createdOrderId, error: createError } = await supabase.rpc('create_customer_order_with_stock', {
                    p_queue_id: selectedQueueId,
                    p_items: payloadItems,
                });
                if (createError) throw createError;

                const orderId = Array.isArray(createdOrderId) ? createdOrderId[0] : createdOrderId;
                const { error: completeError } = await supabase.rpc('complete_order_with_stock', {
                    p_order_id: orderId,
                    p_payment_method: method,
                });
                if (completeError) throw completeError;
            } else {
                const { error: walkinError } = await supabase.rpc('create_walkin_order_with_stock', {
                    p_event_id: activeEvent.id,
                    p_items: payloadItems,
                    p_payment_method: method,
                });
                if (walkinError) throw walkinError;
            }

            setCart([]);
            setCurrentOrderId(null);
            setIsPaymentModalOpen(false);
            onClearQueue();
            await fetchProducts();
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            console.error('[Payment] error:', err);
            alert('Error: ' + errorMessage);
        } finally {
            setLoading(false);
        }
    };

    if (!canUsePos) {
        return (
            <div className="h-full flex items-center justify-center p-6">
                <div className="max-w-md w-full bg-white border border-gray-200 rounded-xl p-6 text-center">
                    <h3 className="text-lg font-bold text-gray-800 mb-2">POS Access Restricted</h3>
                    <p className="text-sm text-gray-600">Your account role is queue-only. You can manage queue flow but cannot charge orders.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="bg-white border-b border-gray-200 shrink-0 shadow-sm">
                <div className="px-4 py-2">
                    <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Select Customer</div>
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                        <button
                            onClick={onClearQueue}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all shrink-0 ${
                                !selectedQueueId
                                    ? 'bg-pink-600 text-white shadow-md shadow-pink-200'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                        >
                            <User size={16} />
                            <span>Walk-in</span>
                        </button>

                        {servingQueues.map((queue) => {
                            const isSelected = selectedQueueId === queue.id;
                            return (
                                <button
                                    key={queue.id}
                                    onClick={() => onSelectQueue({ id: queue.id, queue_number: String(queue.queue_number) })}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all shrink-0 ${
                                        isSelected
                                            ? 'bg-pink-600 text-white shadow-md shadow-pink-200'
                                            : 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100'
                                    }`}
                                >
                                    <CheckCircle size={14} className={isSelected ? 'text-white' : 'text-green-500'} />
                                    <span>Queue #{queue.queue_number}</span>
                                </button>
                            );
                        })}

                        {servingQueues.length === 0 && (
                            <div className="text-xs text-gray-500 italic px-2">No queues serving</div>
                        )}
                    </div>
                </div>

                <div className={`px-4 py-2 border-t transition-colors ${
                    selectedQueueId
                        ? 'bg-gradient-to-r from-pink-50 to-rose-50 border-pink-100'
                        : 'bg-gray-50/50 border-gray-100'
                }`}>
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            {selectedQueueId ? (
                                <>
                                    <span className="inline-flex items-center gap-2 bg-pink-600 text-white px-3 py-1 rounded-full shadow-sm">
                                        <span className="text-xs font-bold">Queue</span>
                                        <span className="text-lg font-black">#{selectedQueueNumber}</span>
                                    </span>
                                    {currentOrderId && (
                                        <span className="text-xs text-green-600 font-bold flex items-center gap-1">
                                            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                                            Active Order
                                        </span>
                                    )}
                                </>
                            ) : (
                                <span className="text-lg font-extrabold text-gray-700">Walk-in Customer</span>
                            )}
                        </div>

                        {activeEvent && (
                            <div className="text-right">
                                <div className="text-[9px] font-bold text-gray-500 uppercase tracking-wider">Event</div>
                                <div className="text-xs font-bold text-pink-600 max-w-[150px] truncate" title={activeEvent.event_name}>
                                    {activeEvent.event_name}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                <div className="w-full h-[40%] md:h-full md:w-[280px] bg-white border-b md:border-b-0 md:border-r border-pink-100 flex flex-col shrink-0 order-1 md:order-1">
                    <div className="flex-1 overflow-y-auto p-3 space-y-2" tabIndex={0} role="region" aria-label="Shopping cart">
                        {cart.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-600 opacity-80">
                                <span className="text-4xl mb-2">🛒</span>
                                <p className="font-medium text-sm">{loading ? 'Loading...' : 'Cart is empty'}</p>
                            </div>
                        ) : (
                            cart.map((item) => (
                                <div key={item.product.id} className="flex items-center justify-between p-2 bg-white border border-gray-100 rounded-lg shadow-sm">
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        <div className="w-8 h-8 shrink-0 rounded-md overflow-hidden border border-gray-200 bg-gray-100">
                                            {item.product.image_url ? (
                                                <img
                                                    src={getProductImage(item.product.image_url)}
                                                    alt={item.product.name}
                                                    className="w-full h-full object-cover"
                                                    onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/100x100?text=No+Img'; }}
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-[8px] text-gray-500">No Img</div>
                                            )}
                                        </div>
                                        <div className="flex flex-col truncate">
                                            <span className="font-bold text-xs text-gray-800 truncate block max-w-[100px]" title={item.product.name}>{item.product.name}</span>
                                            <span className="text-[10px] text-gray-500">{formatPrice(item.product.price, item.product.currency)}</span>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end gap-0.5 ml-1">
                                        <span className="font-bold text-pink-600 text-xs">{formatPrice(item.product.price * item.quantity, item.product.currency)}</span>
                                        <div className="flex items-center gap-1">
                                            <div className="flex items-center bg-gray-50 rounded border border-gray-200 h-5">
                                                <button onClick={() => decreaseQuantity(item.product.id)} className="w-5 h-full flex items-center justify-center text-gray-500 hover:text-red-600 text-[10px]" aria-label={`Decrease quantity of ${item.product.name}`}>-</button>
                                                <span className="min-w-[16px] text-center font-bold text-gray-700 text-[10px]">{item.quantity}</span>
                                                <button onClick={() => addToCart(item.product)} className="w-5 h-full flex items-center justify-center text-gray-500 hover:text-green-600 text-[10px]" aria-label={`Increase quantity of ${item.product.name}`}>+</button>
                                            </div>
                                            <button onClick={() => removeFromCart(item.product.id)} className="text-[9px] text-gray-500 hover:text-red-500" aria-label={`Remove ${item.product.name} from cart`}>✕</button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="p-3 border-t border-pink-100 bg-white shrink-0">
                        <div className="flex justify-between items-baseline mb-2">
                            <span className="text-gray-500 font-medium text-sm">Total</span>
                            <span className="text-2xl font-extrabold text-gray-900">{formatPrice(totalPrice, cart[0]?.product.currency)}</span>
                        </div>

                        {!activeEvent && (
                            <div className="mb-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-600 font-bold text-center">
                                ⚠️ No Active Event / Event Ended
                            </div>
                        )}

                        <button
                            disabled={cart.length === 0 || loading || !activeEvent}
                            onClick={() => setIsPaymentModalOpen(true)}
                            className="w-full bg-pink-500 hover:bg-pink-600 text-white text-sm font-bold py-3 rounded-xl shadow-lg shadow-pink-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all active:scale-95"
                        >
                            {loading ? 'Processing...' : !activeEvent ? 'Event Ended' : 'Charge ' + formatPrice(totalPrice, cart[0]?.product.currency)}
                        </button>
                    </div>
                </div>

                <div className="flex-1 flex flex-col min-w-0 bg-gray-50/50 order-2 md:order-2">
                    <div className="bg-white px-4 py-3 border-b border-gray-100 shadow-sm shrink-0 space-y-2">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="Search products..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-400 text-sm"
                                aria-label="Search products"
                            />
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value as SortType)}
                                className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white cursor-pointer font-medium"
                                aria-label="Sort products by"
                            >
                                <option value="name">Name</option>
                                <option value="price_low">Price ↑</option>
                                <option value="price_high">Price ↓</option>
                            </select>
                        </div>
                        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                            {categories.map(cat => (
                                <button
                                    key={cat}
                                    onClick={() => setSelectedCategory(cat)}
                                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${selectedCategory === cat ? 'bg-pink-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                >
                                    {cat}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4" tabIndex={0} role="region" aria-label="Product grid">
                        {filteredProducts.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-500 opacity-60"><p>No products found.</p></div>
                        ) : (
                            <div className="grid grid-cols-4 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-2">
                                {filteredProducts.map((product) => (
                                    <div
                                        key={product.id}
                                        onClick={() => addToCart(product)}
                                        className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all active:scale-95 group flex flex-col gap-1 p-0"
                                    >
                                        <div className="w-full aspect-square bg-gray-100 relative overflow-hidden shrink-0">
                                            {product.image_url ? (
                                                <img
                                                    src={getProductImage(product.image_url)}
                                                    alt={product.name}
                                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                                    onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/400x400?text=No+Img'; }}
                                                />
                                            ) : (<div className="w-full h-full flex items-center justify-center text-xs text-gray-500">📷</div>)}
                                        </div>
                                        <div className="flex flex-col px-1 pb-1 justify-between flex-1 min-w-0">
                                            <div className="flex flex-col justify-between items-start w-full">
                                                <h3 className="font-bold text-gray-800 truncate text-[10px] w-full mb-0.5" title={product.name}>{product.name}</h3>
                                                <p className="text-pink-600 font-extrabold text-[10px]">{formatPrice(product.price, product.currency)}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {isPaymentModalOpen && (
                <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
                        <h3 className="text-2xl font-black text-gray-800 text-center mb-2">Confirm Payment</h3>
                        <p className="text-gray-500 text-center mb-6">Amount: <span className="text-pink-600 font-bold">{formatPrice(totalPrice, cart[0]?.product.currency)}</span></p>
                        <div className="grid grid-cols-2 gap-4 mb-4">
                            <button
                                onClick={() => handlePayment('cash')}
                                className="flex flex-col items-center justify-center p-6 bg-emerald-50 hover:bg-emerald-100 border-2 border-emerald-100 hover:border-emerald-300 rounded-xl transition-all active:scale-95"
                            >
                                <span className="text-4xl mb-2">💵</span>
                                <span className="font-bold text-emerald-700">CASH</span>
                            </button>
                            <button
                                onClick={() => handlePayment('transfer')}
                                className="flex flex-col items-center justify-center p-6 bg-sky-50 hover:bg-sky-100 border-2 border-sky-100 hover:border-sky-300 rounded-xl transition-all active:scale-95"
                            >
                                <span className="text-4xl mb-2">🏦</span>
                                <span className="font-bold text-sky-700">TRANSFER</span>
                            </button>
                        </div>
                        <button
                            onClick={() => setIsPaymentModalOpen(false)}
                            className="w-full py-2 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
