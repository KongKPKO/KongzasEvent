import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { RealtimeChannel } from '@supabase/supabase-js';
import { User, CheckCircle } from 'lucide-react';
import { formatPrice } from '../../utils/currency';

// --- TYPES ---
interface Product {
    id: string;
    name: string;
    price: number;
    image_url: string | null;
    is_out_of_stock: boolean;
    status: string;
    category: string | null;
    currency?: string;  // ✅ NEW: Currency code
}
interface CartItem { product: Product; quantity: number; notes?: string; }

// ✅ SHARED TYPE: Active Event (from parent)
interface ActiveEvent {
    id: string;
    event_name: string;
    start_date: string;
    end_date: string;
    is_booth_open: boolean;
    status: string;
}

// ✅ SHARED TYPE: Queue Item (from parent)
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

// --- PROPS ---
interface POSPanelProps {
    activeEvent: ActiveEvent | null;
    servingQueues: QueueItem[];  // ✅ NEW: Serving queues from parent
    selectedQueueId: string | null;
    selectedQueueNumber: string | null;
    onSelectQueue: (queue: { id: string; queue_number: string }) => void;  // ✅ NEW: Tab selection
    onClearQueue: () => void;
}

export default function POSPanel({ activeEvent, servingQueues, selectedQueueId, selectedQueueNumber, onSelectQueue, onClearQueue }: POSPanelProps) {
    const [products, setProducts] = useState<Product[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);

    // REFS to prevent stale closures and infinite loops
    const selectedQueueIdRef = useRef<string | null>(null);
    const currentOrderIdRef = useRef<string | null>(null);
    const productsRef = useRef<Product[]>([]);
    const isFetchingRef = useRef(false);

    // Search, Filter & Sort
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const [sortBy, setSortBy] = useState<SortType>('name');

    // Keep refs in sync with state
    useEffect(() => {
        selectedQueueIdRef.current = selectedQueueId;
    }, [selectedQueueId]);

    useEffect(() => {
        currentOrderIdRef.current = currentOrderId;
    }, [currentOrderId]);

    useEffect(() => {
        productsRef.current = products;
    }, [products]);

    // --- FETCH PRODUCTS (with artist_id filter for multi-tenant isolation) ---
    const fetchProducts = useCallback(async () => {
        // 🔐 SECURITY: Must get current user first
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            console.warn('[POS] No authenticated user for products fetch');
            setProducts([]);
            return;
        }

        // 🔐 SECURITY: Filter by artist_id to prevent data leakage
        const { data } = await supabase
            .from('products')
            .select('*')
            .eq('artist_id', user.id)  // ✅ CRITICAL: Only this artist's products
            .eq('status', 'enable')
            .order('name');
        
        if (data) {
            console.log('[POS] Loaded products for artist:', user.id, 'count:', data.length);
            setProducts(data);
        }
    }, []);

    // --- 1. FETCH PRODUCTS + Static Realtime (runs once on mount) ---
    useEffect(() => {
        fetchProducts();

        const channel = supabase.channel('pos-panel-products')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, fetchProducts)
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [fetchProducts]);

    // --- 2. STABLE FETCH ORDER FUNCTION ---
    const fetchCurrentOrder = useCallback(async () => {
        if (isFetchingRef.current) return;
        
        isFetchingRef.current = true;

        const targetQueueId = selectedQueueIdRef.current;
        
        setLoading(true);
        console.log('[POS] Fetching order for Queue:', targetQueueId);

        try {
            let query = supabase.from('orders')
                .select('id, status, queue_id, event_id')
                .neq('status', 'completed');

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
                console.error("Error fetching order:", error);
                isFetchingRef.current = false;
                setLoading(false);
                return;
            }

            if (order) {
                console.log('[POS] Found existing order:', order.id, 'for event:', order.event_id);
                setCurrentOrderId(order.id);
                
                const { data: items } = await supabase.from('order_items').select('*').eq('order_id', order.id);

                if (selectedQueueIdRef.current !== targetQueueId) {
                    isFetchingRef.current = false;
                    return;
                }

                const currentProducts = productsRef.current;
                if (items && currentProducts.length > 0) {
                    const newCart: CartItem[] = items.map(item => {
                        const prod = currentProducts.find(p => p.id === item.product_id);
                        return prod ? { product: prod, quantity: item.quantity, notes: item.notes } : null;
                    }).filter(Boolean) as CartItem[];

                    setCart(newCart);
                } else {
                    setCart([]);
                }
            } else {
                console.log('[POS] No existing order found for this queue/event');
                setCurrentOrderId(null);
                setCart([]);
            }
        } catch (err) {
            console.error("Critical Error:", err);
        } finally {
            isFetchingRef.current = false;
            if (selectedQueueIdRef.current === targetQueueId) {
                setLoading(false);
            }
        }
    }, []);

    // --- 3. REACT TO selectedQueueId OR activeEvent CHANGES ---
    useEffect(() => {
        setCart([]);
        setCurrentOrderId(null);
        setLoading(false);
        isFetchingRef.current = false;

        if (activeEvent) {
            fetchCurrentOrder();
        }

        let orderChannel: RealtimeChannel | null = null;

        if (selectedQueueId) {
            const channelName = `pos-orders-${selectedQueueId}-${Date.now()}`;
            
            orderChannel = supabase.channel(channelName)
                .on(
                    'postgres_changes',
                    { 
                        event: 'INSERT', 
                        schema: 'public', 
                        table: 'orders', 
                        filter: `queue_id=eq.${selectedQueueId}` 
                    },
                    (payload) => {
                        console.log('[POS] New order INSERT detected:', payload.new);
                        setTimeout(() => {
                            fetchCurrentOrder();
                        }, 100);
                    }
                )
                .on(
                    'postgres_changes',
                    { 
                        event: 'DELETE', 
                        schema: 'public', 
                        table: 'orders'
                    },
                    (payload) => {
                        // When order is deleted (e.g., customer cancelled from MenuView)
                        // Check if it matches current order and clear cart
                        console.log('[POS] Order DELETE detected:', payload.old);
                        if (currentOrderIdRef.current && payload.old?.id === currentOrderIdRef.current) {
                            console.log('[POS] Current order was cancelled by customer, clearing cart');
                            setCart([]);
                            setCurrentOrderId(null);
                        }
                    }
                )
                .subscribe();
        }

        return () => {
            if (orderChannel) {
                supabase.removeChannel(orderChannel);
            }
        };
    }, [selectedQueueId, activeEvent, fetchCurrentOrder]);

    // --- 4. DISPLAY LOGIC ---
    const categories = useMemo(() => {
        const cats = products.map(p => p.category).filter(Boolean) as string[];
        return ['All', ...new Set(cats)];
    }, [products]);

    const filteredProducts = useMemo(() => {
        let result = products.filter(product => {
            const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesCategory = selectedCategory === 'All' || product.category === selectedCategory;
            return matchesSearch && matchesCategory;
        });
        return result.sort((a, b) => {
            if (sortBy === 'price_low') return a.price - b.price;
            if (sortBy === 'price_high') return b.price - a.price;
            return a.name.localeCompare(b.name);
        });
    }, [products, searchQuery, selectedCategory, sortBy]);

    // --- 5. HELPERS ---
    const getProductImage = (path: string | null) => {
        if (!path) return '';
        if (path.startsWith('http') || path.startsWith('blob:')) return path;
        return `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/Menu/${path}`;
    };

    const addToCart = (product: Product) => {
        setCart(prev => {
            const existing = prev.find(item => item.product.id === product.id);
            if (existing) return prev.map(item => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
            return [...prev, { product, quantity: 1 }];
        });
    };

    const decreaseQuantity = (productId: string) => {
        setCart(prev => prev.map(item => item.product.id === productId ? { ...item, quantity: item.quantity - 1 } : item).filter(item => item.quantity > 0));
    };

    const removeFromCart = (productId: string) => {
        setCart(prev => prev.filter(item => item.product.id !== productId));
    };

    const totalPrice = useMemo(() => cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0), [cart]);

    // --- 6. PAYMENT HANDLER ---
    const handlePayment = async (method: 'cash' | 'transfer') => {
        if (!activeEvent) {
            alert('Cannot process payment: No active event.');
            return;
        }

        setLoading(true);

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            let orderId = currentOrderId;

            if (!orderId) {
                // ✅ FIX: Removed artist_id - orders table uses event_id to link to artist
                const { data: order, error } = await supabase.from('orders').insert({
                    event_id: activeEvent.id,
                    queue_id: selectedQueueId,
                    status: 'completed',
                    total_price: totalPrice,
                    currency: cart[0]?.product.currency || 'THB', // ✅ NEW: Save currency
                    payment_method: method,
                }).select('id').single();

                if (error) {
                    console.error('[Payment] INSERT error:', error);
                    throw error;
                }
                orderId = order.id;
            } else {
                console.log('[Payment] Adopting order', orderId, 'into event:', activeEvent.id);
                
                const { error } = await supabase.from('orders').update({ 
                    status: 'completed', 
                    total_price: totalPrice,
                    currency: cart[0]?.product.currency || 'THB', // ✅ NEW: Update currency
                    payment_method: method,
                    event_id: activeEvent.id
                }).eq('id', orderId);
                
                if (error) {
                    console.error('[Payment] UPDATE error:', error);
                    throw error;
                }
            }

            await supabase.from('order_items').delete().eq('order_id', orderId);
            
            const itemsToInsert = cart.map(item => ({
                order_id: orderId,
                product_id: item.product.id,
                quantity: item.quantity,
                price_per_unit: item.product.price,
                notes: item.notes || ''
            }));
            
            if (itemsToInsert.length > 0) {
                await supabase.from('order_items').insert(itemsToInsert);
            }

            if (selectedQueueId) {
                const { error: queueError } = await supabase
                    .from('queues')
                    .update({ status: 'complete' }) 
                    .eq('id', selectedQueueId);
                
                if (queueError) {
                    console.error('[Payment] Queue update error:', queueError);
                    throw queueError;
                }
            }

            console.log('[Payment] Success:', method.toUpperCase());
            
            setCart([]); 
            setCurrentOrderId(null);
            setIsPaymentModalOpen(false);
            onClearQueue();

        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            console.error('[Payment] Full error:', err);
            alert('Error: ' + errorMessage);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* ✅ NEW: Horizontal Tabs Header for Customer Selection */}
            <div className="bg-white border-b border-gray-200 shrink-0 shadow-sm">
                <div className="px-4 py-2">
                    <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Select Customer</div>
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                        {/* Walk-in Tab (Always First) */}
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

                        {/* Serving Queue Tabs */}
                        {servingQueues.map(queue => {
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

                        {/* Empty state hint */}
                        {servingQueues.length === 0 && (
                            <div className="text-xs text-gray-500 italic px-2">No queues serving</div>
                        )}
                    </div>
                </div>

                {/* Current Selection Indicator */}
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
                {/* LEFT: Cart */}
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

                    {/* Total & Charge */}
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

                {/* RIGHT: Product Grid */}
                <div className="flex-1 flex flex-col min-w-0 bg-gray-50/50 order-2 md:order-2">
                    {/* Search & Filter */}
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

                    {/* Product Grid */}
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

            {/* Payment Modal */}
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
                            className="w-full py-3 text-gray-500 font-bold hover:bg-gray-50 hover:text-gray-600 rounded-xl transition-colors"
                        >
                            CANCEL
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
