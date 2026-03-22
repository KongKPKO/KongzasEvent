import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { RealtimeChannel } from '@supabase/supabase-js';
import { User, CheckCircle, Grid2x2, Rows3, Pin, Flame, Clock3, PackageX, Sparkles } from 'lucide-react';
import { formatPrice } from '../../utils/currency';
import type { ActorContext } from '../../types/access';
import { getAvailableUnits, isLowStock } from '../../utils/posCatalog';
import { calculatePromotionPricing, getPromotionBadgesForProduct, type PromotionRule } from '../../utils/promotionPricing';

interface Product {
    id: string;
    name: string;
    price: number;
    image_url: string | null;
    status: string;
    category: string | null;
    tags?: string[];
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
type QuickFilter = 'all' | 'promo' | 'low_stock' | 'recent' | 'pinned';
type ViewMode = 'compact' | 'visual';

interface POSPanelProps {
    activeEvent: ActiveEvent | null;
    servingQueues: QueueItem[];
    selectedQueueId: string | null;
    selectedQueueNumber: string | null;
    actorContext: ActorContext;
    canUsePos: boolean;
    isQueuePanelExpanded?: boolean;
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
    isQueuePanelExpanded = true,
    onSelectQueue,
    onClearQueue,
}: POSPanelProps) {
    const [products, setProducts] = useState<Product[]>([]);
    const [promotions, setPromotions] = useState<PromotionRule[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);

    const selectedQueueIdRef = useRef<string | null>(null);
    const productsRef = useRef<Product[]>([]);
    const isFetchingRef = useRef(false);

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const [selectedTag, setSelectedTag] = useState<string>('All');
    const [sortBy, setSortBy] = useState<SortType>('name');
    const [selectedQuickFilter, setSelectedQuickFilter] = useState<QuickFilter>('all');
    const [viewMode, setViewMode] = useState<ViewMode>(() => {
        if (typeof window === 'undefined') return 'compact';
        return (window.localStorage.getItem('posViewMode') as ViewMode) || 'compact';
    });
    const [pinnedProductIds, setPinnedProductIds] = useState<string[]>(() => {
        if (typeof window === 'undefined') return [];
        try {
            return JSON.parse(window.localStorage.getItem('posPinnedProducts') || '[]');
        } catch {
            return [];
        }
    });
    const [recentProductIds, setRecentProductIds] = useState<string[]>([]);
    const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);

    useEffect(() => {
        selectedQueueIdRef.current = selectedQueueId;
    }, [selectedQueueId]);

    useEffect(() => {
        productsRef.current = products;
    }, [products]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem('posViewMode', viewMode);
    }, [viewMode]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem('posPinnedProducts', JSON.stringify(pinnedProductIds));
    }, [pinnedProductIds]);

    const fetchProducts = useCallback(async () => {
        if (!canUsePos) {
            setProducts([]);
            return;
        }

        const { data } = await supabase
            .from('products')
            .select('id, name, price, image_url, status, category, tags, currency, stock_total, stock_reserved, stock_sold, is_unlimited')
            .eq('artist_id', actorContext.artist_id)
            .eq('status', 'enable')
            .is('deleted_at', null)
            .order('name');

        if (data) setProducts(data);
    }, [actorContext.artist_id, canUsePos]);

    const fetchPromotions = useCallback(async () => {
        if (!canUsePos) {
            setPromotions([]);
            return;
        }

        const { data } = await supabase
            .from('artist_promotions')
            .select('id, artist_id, name, target_type, rule_type, match_category, match_tag, match_product_id, match_product_ids, buy_quantity, reward_value, reward_quantity, priority, status')
            .eq('artist_id', actorContext.artist_id)
            .eq('status', 'active')
            .order('priority', { ascending: true })
            .order('created_at', { ascending: false });

        if (data) setPromotions(data as PromotionRule[]);
    }, [actorContext.artist_id, canUsePos]);

    useEffect(() => {
        fetchProducts();
        fetchPromotions();

        if (!canUsePos) return;

        const productChannel = supabase
            .channel(`pos-panel-products-${actorContext.artist_id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `artist_id=eq.${actorContext.artist_id}` }, fetchProducts)
            .subscribe();

        const promotionChannel = supabase
            .channel(`pos-panel-promotions-${actorContext.artist_id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'artist_promotions', filter: `artist_id=eq.${actorContext.artist_id}` }, fetchPromotions)
            .subscribe();

        return () => {
            supabase.removeChannel(productChannel);
            supabase.removeChannel(promotionChannel);
        };
    }, [fetchProducts, fetchPromotions, actorContext.artist_id, canUsePos]);

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
        const counts = new Map<string, number>();
        for (const product of products) {
            const label = (product.category || 'Other').trim() || 'Other';
            counts.set(label, (counts.get(label) || 0) + 1);
        }

        return [
            { label: 'All', count: products.length },
            ...Array.from(counts.entries())
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([label, count]) => ({ label, count })),
        ];
    }, [products]);

    const tags = useMemo(() => {
        const counts = new Map<string, number>();
        for (const product of products) {
            for (const tag of product.tags || []) {
                const label = tag.trim();
                if (!label) continue;
                counts.set(label, (counts.get(label) || 0) + 1);
            }
        }

        return [
            { label: 'All', count: products.length },
            ...Array.from(counts.entries())
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([label, count]) => ({ label, count })),
        ];
    }, [products]);

    const filteredProducts = useMemo(() => {
        const result = products
            .filter((product) => {
                const query = searchQuery.trim().toLowerCase();
                const tagHaystack = (product.tags || []).join(' ').toLowerCase();
                const matchesSearch =
                    query.length === 0 ||
                    product.name.toLowerCase().includes(query) ||
                    (product.category || '').toLowerCase().includes(query) ||
                    tagHaystack.includes(query);
                const matchesCategory = selectedCategory === 'All' || ((product.category || 'Other').trim() || 'Other') === selectedCategory;
                const matchesTag = selectedTag === 'All' || (product.tags || []).some((tag) => tag.trim() === selectedTag);
                const inStock = getAvailableUnits(product) > 0;
                const matchesQuickFilter =
                    selectedQuickFilter === 'all' ||
                    (selectedQuickFilter === 'promo' && getPromotionBadgesForProduct(product, promotions).length > 0) ||
                    (selectedQuickFilter === 'low_stock' && isLowStock(product)) ||
                    (selectedQuickFilter === 'recent' && recentProductIds.includes(product.id)) ||
                    (selectedQuickFilter === 'pinned' && pinnedProductIds.includes(product.id));

                return matchesSearch && matchesCategory && matchesTag && inStock && matchesQuickFilter;
            })
            .sort((a, b) => {
                const aPinned = pinnedProductIds.includes(a.id) ? 1 : 0;
                const bPinned = pinnedProductIds.includes(b.id) ? 1 : 0;
                if (aPinned !== bPinned) return bPinned - aPinned;
                if (sortBy === 'price_low') return a.price - b.price;
                if (sortBy === 'price_high') return b.price - a.price;
                return a.name.localeCompare(b.name);
            });

        return result;
    }, [products, promotions, searchQuery, selectedCategory, selectedTag, selectedQuickFilter, recentProductIds, pinnedProductIds, sortBy]);

    const cartItemCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
    const hasActiveProductFilters =
        searchQuery.trim().length > 0 ||
        selectedCategory !== 'All' ||
        selectedTag !== 'All' ||
        selectedQuickFilter !== 'all' ||
        sortBy !== 'name';

    const clearProductFilters = () => {
        setSearchQuery('');
        setSelectedCategory('All');
        setSelectedTag('All');
        setSelectedQuickFilter('all');
        setSortBy('name');
    };

    const getProductImage = (path: string | null) => {
        if (!path) return '';
        if (path.startsWith('http') || path.startsWith('blob:')) return path;
        const { data } = supabase.storage.from('Menu').getPublicUrl(path);
        return data.publicUrl;
    };

    const addToCart = (product: Product) => {
        if (!canUsePos) return;

        setRecentProductIds((prev) => [product.id, ...prev.filter((id) => id !== product.id)].slice(0, 12));

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

    const pricing = useMemo(() => calculatePromotionPricing(cart, promotions), [cart, promotions]);
    const promoInsights = pricing.insights;
    const highlightedCounts = useMemo(() => ({
        promo: products.filter((product) => getPromotionBadgesForProduct(product, promotions).length > 0).length,
        lowStock: products.filter((product) => isLowStock(product) && getAvailableUnits(product) > 0).length,
        recent: recentProductIds.length,
        pinned: pinnedProductIds.length,
    }), [products, promotions, recentProductIds.length, pinnedProductIds.length]);

    const togglePinnedProduct = (productId: string) => {
        setPinnedProductIds((prev) =>
            prev.includes(productId) ? prev.filter((id) => id !== productId) : [productId, ...prev].slice(0, 24)
        );
    };

    const buildItemPayload = () => cart.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
        notes: item.notes || '',
    }));

    const applyPricingToOrder = async (orderId: string) => {
        const { error } = await supabase.rpc('apply_order_pricing', {
            p_order_id: orderId,
            p_subtotal_price: pricing.subtotal,
            p_discount_total: pricing.discountTotal,
            p_total_price: pricing.total,
            p_pricing_breakdown: pricing.appliedPromotions,
        });
        if (error) throw error;
    };

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

                await applyPricingToOrder(currentOrderId);

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
                await applyPricingToOrder(orderId);
                const { error: completeError } = await supabase.rpc('complete_order_with_stock', {
                    p_order_id: orderId,
                    p_payment_method: method,
                });
                if (completeError) throw completeError;
            } else {
                const { data: walkinOrderId, error: walkinError } = await supabase.rpc('create_walkin_order_with_stock', {
                    p_event_id: activeEvent.id,
                    p_items: payloadItems,
                    p_payment_method: method,
                });
                if (walkinError) throw walkinError;
                const orderId = Array.isArray(walkinOrderId) ? walkinOrderId[0] : walkinOrderId;
                await applyPricingToOrder(orderId);
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

    const quickFilters: Array<{ id: QuickFilter; label: string; count: number; icon: typeof Sparkles }> = [
        { id: 'all', label: 'All items', count: products.length, icon: Grid2x2 },
        { id: 'promo', label: 'Promo', count: highlightedCounts.promo, icon: Sparkles },
        { id: 'low_stock', label: 'Low stock', count: highlightedCounts.lowStock, icon: PackageX },
        { id: 'recent', label: 'Recent', count: highlightedCounts.recent, icon: Clock3 },
        { id: 'pinned', label: 'Pinned', count: highlightedCounts.pinned, icon: Pin },
    ];

    const renderPromoHelper = () => {
        if (promoInsights.length === 0) return null;

        return (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-center gap-2 text-amber-800 text-xs font-black uppercase tracking-wide mb-2">
                    <Flame size={14} />
                    Promo helper
                </div>
                <div className="space-y-2">
                    {promoInsights.map((insight) => (
                        <div key={insight.id} className="rounded-lg bg-white/80 border border-amber-100 px-2.5 py-2">
                            <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="text-[11px] font-bold text-gray-800">{insight.label}</span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${insight.status === 'ready' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                    {insight.status === 'ready' ? 'Ready' : 'In progress'}
                                </span>
                            </div>
                            <div className="text-[10px] text-gray-600">{insight.message}</div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderAppliedPromotions = () => {
        if (pricing.appliedPromotions.length === 0) return null;

        return (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <div className="flex items-center gap-2 text-emerald-800 text-xs font-black uppercase tracking-wide mb-2">
                    <Sparkles size={14} />
                    Applied promotions
                </div>
                <div className="space-y-2">
                    {pricing.appliedPromotions.map((promotion) => (
                        <div key={promotion.ruleId} className="rounded-lg bg-white/90 border border-emerald-100 px-2.5 py-2 flex items-start justify-between gap-2">
                            <div>
                                <div className="text-[11px] font-bold text-gray-800">{promotion.label}</div>
                                <div className="text-[10px] text-gray-600">{promotion.message}</div>
                            </div>
                            <div className="text-[11px] font-black text-emerald-700">- {formatPrice(promotion.discountAmount, cart[0]?.product.currency)}</div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderCartItems = () => {
        if (cart.length === 0) {
            return (
                <div className="h-full flex flex-col items-center justify-center text-gray-600 opacity-80">
                    <span className="text-4xl mb-2">🛒</span>
                    <p className="font-medium text-sm">{loading ? 'Loading...' : 'Cart is empty'}</p>
                    <p className="mt-1 text-xs text-gray-400 text-center max-w-[220px]">Select products first. Promotions and totals update automatically.</p>
                </div>
            );
        }

        return (
            <>
                {renderPromoHelper()}
                {renderAppliedPromotions()}

                {cart.map((item) => {
                    const promoBadges = getPromotionBadgesForProduct(item.product, promotions);

                    return (
                        <div key={item.product.id} className="flex items-center justify-between p-2 bg-white border border-gray-100 rounded-lg shadow-sm">
                            <div className="flex items-center gap-2 overflow-hidden">
                                <div className="w-10 h-10 shrink-0 rounded-md overflow-hidden border border-gray-200 bg-gray-100">
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
                                <div className="flex flex-col min-w-0 flex-1">
                                    <span className="font-bold text-xs text-gray-800 leading-tight break-words line-clamp-2" title={item.product.name}>{item.product.name}</span>
                                    <span className="text-[10px] text-gray-500">{formatPrice(item.product.price, item.product.currency)}</span>
                                    {!!promoBadges.length && (
                                        <div className="mt-1 flex flex-wrap gap-1">
                                            {promoBadges.slice(0, 2).map((badge) => (
                                                <span key={badge.id} className="inline-flex items-center px-1.5 py-0.5 rounded-full border text-[9px] font-bold w-fit bg-rose-50 text-rose-700 border-rose-100">
                                                    {badge.shortLabel}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-0.5 ml-1">
                                <span className="font-bold text-pink-600 text-xs">{formatPrice(item.product.price * item.quantity, item.product.currency)}</span>
                                <div className="flex items-center gap-1">
                                    <div className="flex items-center bg-gray-50 rounded border border-gray-200 h-6">
                                        <button onClick={() => decreaseQuantity(item.product.id)} className="w-6 h-full flex items-center justify-center text-gray-500 hover:text-red-600 text-[11px]" aria-label={`Decrease quantity of ${item.product.name}`}>-</button>
                                        <span className="min-w-[18px] text-center font-bold text-gray-700 text-[10px]">{item.quantity}</span>
                                        <button onClick={() => addToCart(item.product)} className="w-6 h-full flex items-center justify-center text-gray-500 hover:text-green-600 text-[11px]" aria-label={`Increase quantity of ${item.product.name}`}>+</button>
                                    </div>
                                    <button onClick={() => removeFromCart(item.product.id)} className="text-[9px] text-gray-500 hover:text-red-500" aria-label={`Remove ${item.product.name} from cart`}>✕</button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </>
        );
    };

    const renderCartTotals = (mobile = false) => (
        <>
            <div className="space-y-1.5 mb-2">
                <div className="flex justify-between items-baseline">
                    <span className="text-gray-500 font-medium text-sm">Subtotal</span>
                    <span className="text-sm font-bold text-gray-700">{formatPrice(pricing.subtotal, cart[0]?.product.currency)}</span>
                </div>
                {pricing.discountTotal > 0 && (
                    <div className="flex justify-between items-baseline">
                        <span className="text-emerald-700 font-medium text-sm">Discount</span>
                        <span className="text-sm font-black text-emerald-700">- {formatPrice(pricing.discountTotal, cart[0]?.product.currency)}</span>
                    </div>
                )}
                <div className="flex justify-between items-baseline pt-1 border-t border-gray-100">
                    <span className="text-gray-500 font-medium text-sm">Total</span>
                    <span className={`${mobile ? 'text-xl' : 'text-2xl'} font-extrabold text-gray-900`}>{formatPrice(pricing.total, cart[0]?.product.currency)}</span>
                </div>
            </div>

            {!activeEvent && (
                <div className="mb-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-600 font-bold text-center">
                    ⚠️ No Active Event / Event Ended
                </div>
            )}

            <button
                disabled={cart.length === 0 || loading || !activeEvent}
                onClick={() => {
                    setIsMobileCartOpen(false);
                    setIsPaymentModalOpen(true);
                }}
                className="w-full bg-pink-500 hover:bg-pink-600 text-white text-sm font-bold py-3 rounded-xl shadow-lg shadow-pink-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all active:scale-95"
            >
                {loading ? 'Processing...' : !activeEvent ? 'Event Ended' : 'Charge ' + formatPrice(pricing.total, cart[0]?.product.currency)}
            </button>
        </>
    );

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

            <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
                <div className="hidden md:flex w-full h-auto max-h-[36dvh] md:max-h-none md:h-full md:w-[320px] bg-white border-t md:border-t-0 md:border-b-0 md:border-r border-pink-100 flex-col shrink-0 order-2 md:order-1">
                    <div className="px-3 py-3 border-b border-gray-100 bg-gradient-to-r from-white to-pink-50/40 shrink-0">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Cart Summary</div>
                                <div className="mt-1 text-sm font-bold text-gray-800">
                                    {cartItemCount} item{cartItemCount === 1 ? '' : 's'} · {cart.length} SKU
                                </div>
                            </div>
                            {pricing.discountTotal > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-700 border border-emerald-100">
                                    Save {formatPrice(pricing.discountTotal, cart[0]?.product.currency)}
                                </span>
                            )}
                        </div>
                        {selectedQueueId ? (
                            <p className="mt-1 text-xs text-gray-500">Editing preselected order for Queue #{selectedQueueNumber}.</p>
                        ) : (
                            <p className="mt-1 text-xs text-gray-500">Walk-in checkout. Add items, review promotions, then charge.</p>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[120px]" tabIndex={0} role="region" aria-label="Shopping cart">
                        {renderCartItems()}
                    </div>

                    <div className="p-3 border-t border-pink-100 bg-white shrink-0">
                        {renderCartTotals()}
                    </div>
                </div>

                <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-gray-50/50 order-1 md:order-2">
                    <div className="bg-white px-4 py-3 border-b border-gray-100 shadow-sm shrink-0 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Product Browser</div>
                                <div className="mt-1 flex items-center gap-2">
                                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-600">
                                        {filteredProducts.length} / {products.length}
                                    </span>
                                    <div className="hidden md:block text-xs text-gray-500">Search by name or tag, then narrow with quick filters, category, and tags.</div>
                                </div>
                            </div>
                            <div className="hidden md:flex items-center gap-2">
                                {hasActiveProductFilters && (
                                    <button
                                        onClick={clearProductFilters}
                                        className="rounded-full border border-pink-200 bg-pink-50 px-3 py-1 text-xs font-bold text-pink-600 hover:bg-pink-100 transition-colors"
                                    >
                                        Clear filters
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="Search by name or tag..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-400 text-sm"
                                aria-label="Search products"
                            />
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value as SortType)}
                                className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white cursor-pointer font-medium w-[110px] md:w-auto"
                                aria-label="Sort products by"
                            >
                                <option value="name">Name</option>
                                <option value="price_low">Price ↑</option>
                                <option value="price_high">Price ↓</option>
                            </select>
                            <div className="hidden md:flex items-center rounded-lg border border-gray-200 bg-gray-50 p-1">
                                <button
                                    onClick={() => setViewMode('compact')}
                                    className={`px-2 py-1 rounded-md ${viewMode === 'compact' ? 'bg-white text-pink-600 shadow-sm' : 'text-gray-500'}`}
                                    aria-label="Compact product view"
                                >
                                    <Rows3 size={16} />
                                </button>
                                <button
                                    onClick={() => setViewMode('visual')}
                                    className={`px-2 py-1 rounded-md ${viewMode === 'visual' ? 'bg-white text-pink-600 shadow-sm' : 'text-gray-500'}`}
                                    aria-label="Visual product view"
                                >
                                    <Grid2x2 size={16} />
                                </button>
                            </div>
                        </div>
                        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                            {quickFilters.map((filter) => {
                                const Icon = filter.icon;
                                return (
                                    <button
                                        key={filter.id}
                                        onClick={() => setSelectedQuickFilter(filter.id)}
                                        className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap inline-flex items-center gap-1.5 ${selectedQuickFilter === filter.id ? 'bg-gray-900 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                    >
                                        <Icon size={12} />
                                        <span>{filter.label}</span>
                                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${selectedQuickFilter === filter.id ? 'bg-white/20 text-white' : 'bg-white text-gray-500'}`}>{filter.count}</span>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                            {categories.map((cat) => (
                                <button
                                    key={cat.label}
                                    onClick={() => setSelectedCategory(cat.label)}
                                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${selectedCategory === cat.label ? 'bg-pink-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                >
                                    {cat.label} <span className={`ml-1 ${selectedCategory === cat.label ? 'text-pink-100' : 'text-gray-400'}`}>{cat.count}</span>
                                </button>
                            ))}
                        </div>
                        {tags.length > 1 && (
                            <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                                {tags.map((tag) => (
                                    <button
                                        key={tag.label}
                                        onClick={() => setSelectedTag(tag.label)}
                                        className={`px-3 py-1 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${selectedTag === tag.label ? 'bg-sky-600 text-white shadow-md' : 'bg-sky-50 text-sky-700 hover:bg-sky-100'}`}
                                    >
                                        {tag.label} <span className={`ml-1 ${selectedTag === tag.label ? 'text-sky-100' : 'text-sky-400'}`}>{tag.count}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                        {hasActiveProductFilters && (
                            <div className="flex flex-wrap gap-2 pt-1">
                                {selectedQuickFilter !== 'all' && (
                                    <span className="rounded-full bg-gray-100 px-3 py-1 text-[11px] font-semibold text-gray-600">
                                        Quick: {quickFilters.find((filter) => filter.id === selectedQuickFilter)?.label}
                                    </span>
                                )}
                                {selectedCategory !== 'All' && (
                                    <span className="rounded-full bg-pink-50 px-3 py-1 text-[11px] font-semibold text-pink-600">
                                        Category: {selectedCategory}
                                    </span>
                                )}
                                {selectedTag !== 'All' && (
                                    <span className="rounded-full bg-sky-50 px-3 py-1 text-[11px] font-semibold text-sky-700">
                                        Tag: {selectedTag}
                                    </span>
                                )}
                                {searchQuery.trim() && (
                                    <span className="rounded-full bg-gray-100 px-3 py-1 text-[11px] font-semibold text-gray-600">
                                        Search: {searchQuery.trim()}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 md:p-4 min-h-0" tabIndex={0} role="region" aria-label="Product grid">
                        {filteredProducts.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-500 opacity-60"><p>No products found.</p></div>
                        ) : (
                            <div className={viewMode === 'compact' ? 'space-y-2' : (isQueuePanelExpanded ? 'grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2' : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2')}>
                                {filteredProducts.map((product) => (
                                    (() => {
                                        const promoBadges = getPromotionBadgesForProduct(product, promotions);
                                        const available = getAvailableUnits(product);
                                        const lowStock = isLowStock(product);
                                        const isPinned = pinnedProductIds.includes(product.id);

                                        if (viewMode === 'compact') {
                                            return (
                                                <div
                                                    key={product.id}
                                                    className="bg-white rounded-xl shadow-sm border border-gray-100 px-3 py-2 flex items-center gap-3"
                                                >
                                                    <button
                                                        onClick={() => addToCart(product)}
                                                        className="flex items-center gap-3 flex-1 min-w-0 text-left"
                                                    >
                                                        <div className="w-14 h-14 rounded-lg overflow-hidden border border-gray-200 bg-gray-100 shrink-0">
                                                            {product.image_url ? (
                                                                <img
                                                                    src={getProductImage(product.image_url)}
                                                                    alt={product.name}
                                                                    className="w-full h-full object-cover"
                                                                    onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/200x200?text=No+Img'; }}
                                                                />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">📷</div>
                                                            )}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-start justify-between gap-2">
                                                                <div className="min-w-0">
                                                                    <div className="font-bold text-sm text-gray-800 leading-tight break-words" title={product.name}>{product.name}</div>
                                                                    <div className="text-[11px] text-gray-500 break-words">{(product.category || 'Other').trim() || 'Other'}</div>
                                                                </div>
                                                                <div className="text-right shrink-0">
                                                                    <div className="font-black text-pink-600 text-sm">{formatPrice(product.price, product.currency)}</div>
                                                                    <div className="text-[10px] text-gray-500">{Number.isFinite(available) ? `${available} left` : 'Unlimited'}</div>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                                                                {promoBadges.slice(0, 2).map((badge) => (
                                                                    <span key={badge.id} className="inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold bg-rose-50 text-rose-700 border-rose-100">
                                                                        {badge.shortLabel}
                                                                    </span>
                                                                ))}
                                                                {lowStock && (
                                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold bg-amber-50 text-amber-700 border-amber-100">
                                                                        Low stock
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </button>
                                                    <button
                                                        onClick={() => togglePinnedProduct(product.id)}
                                                        className={`p-2 rounded-lg border ${isPinned ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-400 border-gray-200'}`}
                                                        aria-label={isPinned ? `Unpin ${product.name}` : `Pin ${product.name}`}
                                                    >
                                                        <Pin size={14} />
                                                    </button>
                                                </div>
                                            );
                                        }

                                        return (
                                            <div
                                                key={product.id}
                                                className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden transition-all group flex flex-col gap-1 p-0 relative"
                                            >
                                                <button
                                                    onClick={() => addToCart(product)}
                                                    className="cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all active:scale-[0.98] text-left"
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
                                                    <div className="flex flex-col px-2.5 pb-2.5 pt-1.5 justify-between flex-1 min-w-0">
                                                        <div className="flex flex-col justify-between items-start w-full">
                                                            <h3 className="font-bold text-gray-800 text-xs leading-tight w-full mb-0.5 break-words min-h-[2rem]" title={product.name}>{product.name}</h3>
                                                            <p className="text-pink-600 font-extrabold text-xs">{formatPrice(product.price, product.currency)}</p>
                                                            <div className="mt-1 flex flex-wrap gap-1">
                                                                {promoBadges.slice(0, 2).map((badge) => (
                                                                    <span key={badge.id} className="inline-flex items-center px-1.5 py-0.5 rounded-full border text-[9px] font-bold bg-rose-50 text-rose-700 border-rose-100">{badge.shortLabel}</span>
                                                                ))}
                                                                {lowStock && <span className="inline-flex items-center px-1.5 py-0.5 rounded-full border text-[9px] font-bold bg-amber-50 text-amber-700 border-amber-100">Low</span>}
                                                            </div>
                                                        </div>
                                                        <div className="mt-2 w-full text-right text-[10px] font-semibold text-gray-500">
                                                            {Number.isFinite(available) ? `Left: ${available}` : 'Left: Unlimited'}
                                                        </div>
                                                    </div>
                                                </button>
                                                <button
                                                    onClick={() => togglePinnedProduct(product.id)}
                                                    className={`absolute top-2 right-2 p-1.5 rounded-full ${isPinned ? 'bg-gray-900 text-white' : 'bg-white/90 text-gray-500'}`}
                                                    aria-label={isPinned ? `Unpin ${product.name}` : `Pin ${product.name}`}
                                                >
                                                    <Pin size={12} />
                                                </button>
                                            </div>
                                        );
                                    })()
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="md:hidden sticky bottom-0 z-20 border-t border-pink-100 bg-white/95 backdrop-blur px-3 py-2 shadow-[0_-6px_16px_rgba(15,23,42,0.08)]">
                <button
                    onClick={() => setIsMobileCartOpen(true)}
                    className="w-full rounded-2xl border border-pink-100 bg-gradient-to-r from-white to-pink-50 px-3 py-2.5 text-left"
                >
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">Cart</div>
                            <div className="text-sm font-bold text-gray-800">{cartItemCount} item{cartItemCount === 1 ? '' : 's'} · {cart.length} SKU</div>
                            <div className="text-[11px] text-gray-500 truncate">
                                {selectedQueueId ? `Queue #${selectedQueueNumber}` : 'Walk-in checkout'}
                            </div>
                        </div>
                        <div className="text-right shrink-0">
                            {pricing.discountTotal > 0 && (
                                <div className="text-[11px] font-bold text-emerald-600">Save {formatPrice(pricing.discountTotal, cart[0]?.product.currency)}</div>
                            )}
                            <div className="text-lg font-extrabold text-gray-900">{formatPrice(pricing.total, cart[0]?.product.currency)}</div>
                            <div className="text-[11px] font-bold text-pink-600">{cart.length === 0 ? 'Select items' : 'View cart'}</div>
                        </div>
                    </div>
                </button>
            </div>

            {isMobileCartOpen && (
                <div className="md:hidden fixed inset-0 z-40">
                    <button
                        className="absolute inset-0 bg-gray-900/45 backdrop-blur-[1px]"
                        aria-label="Close mobile cart"
                        onClick={() => setIsMobileCartOpen(false)}
                    />
                    <div className="absolute inset-x-0 bottom-0 max-h-[78dvh] rounded-t-3xl bg-white shadow-2xl border-t border-pink-100 flex flex-col overflow-hidden">
                        <div className="shrink-0 px-4 pt-3 pb-2 border-b border-gray-100">
                            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-gray-200" />
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Cart Summary</div>
                                    <div className="mt-1 text-sm font-bold text-gray-800">
                                        {cartItemCount} item{cartItemCount === 1 ? '' : 's'} · {cart.length} SKU
                                    </div>
                                    <div className="mt-1 text-xs text-gray-500">
                                        {selectedQueueId ? `Editing Queue #${selectedQueueNumber}` : 'Walk-in checkout'}
                                    </div>
                                </div>
                                <button
                                    onClick={() => setIsMobileCartOpen(false)}
                                    className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[180px]">
                            {renderCartItems()}
                        </div>
                        <div className="shrink-0 border-t border-pink-100 bg-white p-3">
                            {renderCartTotals(true)}
                        </div>
                    </div>
                </div>
            )}

            {isPaymentModalOpen && (
                <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
                        <h3 className="text-2xl font-black text-gray-800 text-center mb-2">Confirm Payment</h3>
                        <p className="text-gray-500 text-center mb-6">Amount: <span className="text-pink-600 font-bold">{formatPrice(pricing.total, cart[0]?.product.currency)}</span></p>
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
