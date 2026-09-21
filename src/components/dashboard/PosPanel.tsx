import { useI18n } from '../../i18n';
import { recordPreparedPayment, saveOffline, type OfflineEntry } from '../../lib/offlineOperations';
import { Fragment, useEffect, useState, useMemo, useRef, useCallback } from 'react';
import PromotionChoicePicker from '../promotions/PromotionChoicePicker';
import { supabase } from '../../supabaseClient';
import { RealtimeChannel } from '@supabase/supabase-js';
import { User, CheckCircle, Grid2x2, Rows3, Pin, Flame, Clock3, PackageX, Sparkles, AlertTriangle, ImageOff } from 'lucide-react';
import { formatPrice } from '../../utils/currency';
import { Toast } from '../ui/Feedback';
import type { ActorContext } from '../../types/access';
import { getAvailableUnits, isLowStock } from '../../utils/posCatalog';
import { calculatePromotionPricing, getPromotionBadgesForProduct, type PromotionRule } from '../../utils/promotionPricing';
import { normalizeProductRecord } from '../../utils/schemaCompat';
import { quotePromotions, requiresPromotionReview } from '../../lib/promotions';
import type { PromotionChoice, PromotionQuote } from '../../types/promotion';

// Maximum ms the full payment RPC sequence may take before the UI declares
// "status unknown."  Each individual fetch already has a 15 s per-request
// timeout in supabaseClient.ts; this outer limit caps the total sequence so
// the loading spinner can never hang indefinitely.
const PAYMENT_TIMEOUT_MS = 20_000;

interface PricingSnapshot {
    subtotal: number;
    discountTotal: number;
    total: number;
    appliedPromotions: unknown[];
}

const createPaymentAttemptId = (): string => {
    try {
        if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
            return crypto.randomUUID();
        }
    } catch {
        // Fall through for older browser/test environments.
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

const hashPaymentAttemptContext = (value: string): string => {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
};

const getOrCreatePaymentAttemptId = (storageKey: string): string => {
    try {
        const stored = window.localStorage.getItem(storageKey);
        if (stored) return stored;
        const next = createPaymentAttemptId();
        window.localStorage.setItem(storageKey, next);
        return next;
    } catch {
        return createPaymentAttemptId();
    }
};

const clearPaymentAttemptId = (storageKey: string): void => {
    try {
        window.localStorage.removeItem(storageKey);
    } catch {
        // Safe to ignore: inability to clear storage only affects future retry reuse.
    }
};

// Sentinel used to distinguish a sequence-level timeout from a real RPC error
// in the handlePayment catch block.
class PaymentTimeoutError extends Error {
    constructor() {
        super('payment_timeout');
        this.name = 'PaymentTimeoutError';
    }
}

// Returns true for errors where the DB commit status is genuinely ambiguous:
// an AbortError / "failed to fetch" means the request may have committed but
// the response was lost in transit.  Callers should warn staff to check order
// history rather than assume the payment failed.
const paymentErrorText = (err: unknown): string => typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string' ? err.message : String(err);

const isNetworkAmbiguousError = (err: unknown): boolean => {
    const msg = paymentErrorText(err).toLowerCase();
    return (
        err instanceof PaymentTimeoutError ||
        msg.includes('aborted') ||
        msg.includes('failed to fetch') ||
        msg.includes('networkerror') ||
        msg.includes('load failed') ||
        msg.includes('network request failed')
    );
};

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
    variant_group_name?: string | null;
    variant_name?: string | null;
    variant_sort_order?: number;
}

interface CartItem { product: Product; quantity: number; notes?: string; }

interface ActiveEvent {
    id: string;
    event_name: string;
    event_timezone?: string | null;
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
type ViewPreference = 'auto' | ViewMode;

interface POSPanelProps {
    activeEvent: ActiveEvent | null;
    servingQueues: QueueItem[];
    selectedQueueId: string | null;
    selectedQueueNumber: string | null;
    actorContext: ActorContext;
    canUsePos: boolean;
    isQueuePanelExpanded?: boolean;
    isInitialLoading?: boolean;
    onSelectQueue: (queue: { id: string; queue_number: string }) => void;
    onClearQueue: () => void;
    onQueueCompleted?: (queueId: string) => void;
}

export default function POSPanel({
    activeEvent,
    servingQueues,
    selectedQueueId,
    selectedQueueNumber,
    actorContext,
    canUsePos,
    isQueuePanelExpanded = true,
    isInitialLoading: _isInitialLoading = false,
    onSelectQueue,
    onClearQueue,
    onQueueCompleted,
}: POSPanelProps) {
    const { language } = useI18n();
    const text = (en: string, th: string) => language === 'th' ? th : en;
    const [products, setProducts] = useState<Product[]>([]);
    const [promotions, setPromotions] = useState<PromotionRule[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [promotionQuote, setPromotionQuote] = useState<PromotionQuote | null>(null);
    const [promotionQuoteLoading, setPromotionQuoteLoading] = useState(false);
    const [rewardChoices, setRewardChoices] = useState<PromotionChoice[]>([]);
    const [promotionChoices, setPromotionChoices] = useState<PromotionChoice[]>([]);
    const [acceptExhaustedRewards, setAcceptExhaustedRewards] = useState(false);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [fetchError, setFetchError] = useState(false);
    const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
    // Track the latest fetch to ignore stale results from superseded requests.
    const fetchVersionRef = useRef(0);

    const [toast, setToast] = useState<{ tone?: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string } | null>(null);
    // Non-null when the payment sequence timed out or the network aborted mid-flight
    // and we cannot confirm whether the DB committed.  Stores the event ID so the
    // order history link can point to the right event.  Cleared on confirmed success
    // or confirmed failure.
    const [paymentUnknownEventId, setPaymentUnknownEventId] = useState<string | null>(null);

    const selectedQueueIdRef = useRef<string | null>(null);
    const productsRef = useRef<Product[]>([]);
    const cartRef = useRef<CartItem[]>([]);
    const paymentInFlightRef = useRef(false);

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const [selectedTag, setSelectedTag] = useState<string>('All');
    const [sortBy, setSortBy] = useState<SortType>('name');
    const [selectedQuickFilter, setSelectedQuickFilter] = useState<QuickFilter>('all');
    const [viewPreference, setViewPreference] = useState<ViewPreference>(() => {
        if (typeof window === 'undefined') return 'auto';
        const savedPreference = window.localStorage.getItem('posViewPreference') as ViewPreference | null;
        return savedPreference || 'auto';
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
    const paymentDialogRef = useRef<HTMLDivElement>(null);
    const cartDialogRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const dialog = isPaymentModalOpen ? paymentDialogRef.current : isMobileCartOpen ? cartDialogRef.current : null;
        if (!dialog) return;
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.focus();
        const handleKey = (event: KeyboardEvent) => {
            if (event.key !== 'Tab') return;
            const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]')).filter(node => node.getClientRects().length > 0);
            const first = controls[0], last = controls[controls.length - 1];
            if (!first) { event.preventDefault(); return; }
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        };
        dialog.addEventListener('keydown', handleKey);
        return () => { dialog.removeEventListener('keydown', handleKey); if (previousFocus?.isConnected) previousFocus.focus(); };
    }, [isPaymentModalOpen, isMobileCartOpen]);

    useEffect(() => {
        selectedQueueIdRef.current = selectedQueueId;
    }, [selectedQueueId]);

    useEffect(() => {
        productsRef.current = products;
    }, [products]);

    useEffect(() => {
        cartRef.current = cart;
    }, [cart]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem('posViewPreference', viewPreference);
    }, [viewPreference]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem('posPinnedProducts', JSON.stringify(pinnedProductIds));
    }, [pinnedProductIds]);

    const fetchProducts = useCallback(async () => {
        if (!canUsePos || !activeEvent?.id) {
            setProducts([]);
            return;
        }

        const { data, error } = await supabase.rpc('list_event_products', {
            p_event_id: activeEvent.id,
        });

        if (error) {
            console.error('[POS] Error fetching event catalog:', error);
            setProducts([]);
            return;
        }

        if (data) setProducts((data as Record<string, any>[]).map((product) => normalizeProductRecord(product) as Product));
    }, [activeEvent?.id, canUsePos]);

    const fetchPromotions = useCallback(async () => {
        if (!canUsePos) {
            setPromotions([]);
            return;
        }

        const { data } = await supabase.rpc('list_active_promotions', {
            p_artist_id: actorContext.artist_id,
            p_event_id: activeEvent?.id || null,
        });

        if (data) setPromotions(data as PromotionRule[]);
    }, [activeEvent?.id, actorContext.artist_id, canUsePos]);

    useEffect(() => {
        fetchProducts();
        fetchPromotions();

        if (!canUsePos || !activeEvent?.id) return;

        const productChannel = supabase
            .channel(`pos-panel-products-${actorContext.artist_id}-${activeEvent.id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `artist_id=eq.${actorContext.artist_id}` }, fetchProducts)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'event_products', filter: `event_id=eq.${activeEvent?.id}` }, fetchProducts)
            .subscribe();

        const promotionChannel = supabase
            .channel(`pos-panel-promotions-${actorContext.artist_id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'artist_promotions', filter: `artist_id=eq.${actorContext.artist_id}` }, fetchPromotions)
            .subscribe();

        return () => {
            supabase.removeChannel(productChannel);
            supabase.removeChannel(promotionChannel);
        };
    }, [fetchProducts, fetchPromotions, actorContext.artist_id, activeEvent?.id, canUsePos]);

    const fetchCurrentOrder = useCallback(async () => {
        if (!canUsePos || !activeEvent) return;

        const version = ++fetchVersionRef.current;
        setLoading(true);
        setFetchError(false);

        try {
            let query = supabase
                .from('orders')
                .select('id, status, queue_id, event_id, order_items(product_id, quantity, notes)')
                .in('status', ['draft', 'confirmed'])
                .eq('event_id', activeEvent.id);

            if (selectedQueueIdRef.current) {
                query = query.eq('queue_id', selectedQueueIdRef.current);
            } else {
                query = query.is('queue_id', null);
            }

            const { data: order, error } = await query
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            // Ignore if a newer fetch has started
            if (version !== fetchVersionRef.current) return;

            if (error) {
                console.error('[POS] Error fetching order:', error);
                setFetchError(true);
                setCurrentOrderId(null);
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

            const newCart: CartItem[] = items
                .map((item: { product_id: string; quantity: number; notes?: string }) => {
                    const prod = currentProducts.find((p) => p.id === item.product_id);
                    return prod ? { product: prod, quantity: item.quantity, notes: item.notes } : null;
                })
                .filter(Boolean) as CartItem[];
            setCart(newCart);

        } catch (err) {
            console.error('[POS] Critical fetch order error:', err);
            if (version === fetchVersionRef.current) {
                setFetchError(true);
                setCurrentOrderId(null);
            }
        } finally {
            if (version === fetchVersionRef.current) {
                setLoading(false);
            }
        }
    }, [activeEvent?.id, canUsePos]);

    useEffect(() => {
        // Do NOT clear cart or orderId here.
        // fetchCurrentOrder will eventually overwrite them with the correct state.
        if (activeEvent && canUsePos) {
            fetchCurrentOrder();
        }

        let orderChannel: RealtimeChannel | null = null;

        if (selectedQueueId && canUsePos) {
            orderChannel = supabase
                .channel(`pos-orders-${selectedQueueId}`)
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
                    (product.variant_group_name || '').toLowerCase().includes(query) ||
                    (product.variant_name || '').toLowerCase().includes(query) ||
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
                const aGroup = (a.variant_group_name || '').trim();
                const bGroup = (b.variant_group_name || '').trim();
                if (aGroup || bGroup) {
                    const groupDiff = (aGroup || a.name).localeCompare(bGroup || b.name);
                    if (groupDiff !== 0) return groupDiff;
                    const sortDiff = (a.variant_sort_order || 0) - (b.variant_sort_order || 0);
                    if (sortDiff !== 0) return sortDiff;
                    return (a.variant_name || a.name).localeCompare(b.variant_name || b.name);
                }
                return a.name.localeCompare(b.name);
            });

        return result;
    }, [products, promotions, searchQuery, selectedCategory, selectedTag, selectedQuickFilter, recentProductIds, pinnedProductIds, sortBy]);

    // O(1) lookup into the freshest product data from the last fetchProducts call.
    // Used by cart validation and the overdraft visual flag in renderCartItems.
    const productsById = useMemo(
        () => new Map(products.map((p) => [p.id, p])),
        [products]
    );

    // Derive which cart items exceed currently-available stock.
    // Overdraft can only arise from a realtime product update (another device sold
    // the last unit while the item was already sitting in this cart), because
    // addToCart already blocks adding beyond getAvailableUnits at add-time.
    const overdraftProductIds = useMemo<ReadonlySet<string>>(() => {
        if (products.length === 0 || cart.length === 0) return new Set();
        const overdrafts = new Set<string>();
        for (const item of cart) {
            const fresh = productsById.get(item.product.id);
            if (!fresh) continue;
            const available = getAvailableUnits(fresh);
            if (Number.isFinite(available) && item.quantity > available) {
                overdrafts.add(item.product.id);
            }
        }
        return overdrafts;
    }, [cart, products, productsById]);

    // Show a warning toast only when the overdraft count increases (i.e. a realtime
    // product update just made cart items unavailable).  Decreases happen when the
    // user removes/reduces an item — no toast needed then.
    //
    // cartRef is used instead of cart directly so we can list affected product names
    // without adding cart to the deps array.  Adding cart would fire the toast on
    // every user edit, not just on stock changes.  cartRef is always current because
    // the sync effect above keeps it updated on every render.
    const prevOverdraftCountRef = useRef(0);
    useEffect(() => {
        const current = overdraftProductIds.size;
        const prev = prevOverdraftCountRef.current;
        prevOverdraftCountRef.current = current;

        if (current > 0 && current > prev) {
            const affectedNames = cartRef.current
                .filter((item) => overdraftProductIds.has(item.product.id))
                .slice(0, 2)
                .map((item) => item.product.name);
            const extra = overdraftProductIds.size > 2 ? ` +${overdraftProductIds.size - 2} more` : '';
            setToast({
                tone: 'warning',
                title: 'Stock updated',
                detail: `${affectedNames.join(', ')}${extra} — reduce quantity or remove before charging.`,
            });
        }
    }, [overdraftProductIds]);

    const cartItemCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
    const effectiveViewMode: ViewMode = viewPreference === 'auto'
        ? (isQueuePanelExpanded ? 'compact' : 'visual')
        : viewPreference;
    const isVisualProductGrid = effectiveViewMode === 'visual';
    const hasActiveProductFilters =
        searchQuery.trim().length > 0 ||
        selectedCategory !== 'All' ||
        selectedTag !== 'All' ||
        selectedQuickFilter !== 'all' ||
        sortBy !== 'name';

    const renderImageFallback = (name: string, compact = false) => (
        <div className={`w-full h-full flex ${compact ? 'items-center justify-center' : 'flex-col items-center justify-center gap-1'} bg-gray-100 text-gray-400`}>
            <ImageOff size={compact ? 16 : 22} aria-hidden="true" />
            {!compact && <span className="text-[10px] font-black text-gray-500">{name.charAt(0).toUpperCase()}</span>}
        </div>
    );

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
        if (!canUsePos || loading || fetchError) return;

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
        if (loading || fetchError) return;
        setCart((prev) => prev
            .map((item) => item.product.id === productId ? { ...item, quantity: item.quantity - 1 } : item)
            .filter((item) => item.quantity > 0));
    };

    const removeFromCart = (productId: string) => {
        if (loading || fetchError) return;
        setCart((prev) => prev.filter((item) => item.product.id !== productId));
    };

    const pricing = useMemo(() => calculatePromotionPricing(cart, promotions), [cart, promotions]);
    const requiredPromotionChoices = promotionQuote?.required_choices.filter((choice) => !choice.exhausted) || [];
    const exhaustedPromotionChoices = promotionQuote?.required_choices.filter((choice) => choice.exhausted) || [];
    const displayedSubtotal = promotionQuote?.subtotal ?? pricing.subtotal;
    const displayedDiscount = promotionQuote?.discount_total ?? pricing.discountTotal;
    const displayedTotal = promotionQuote?.total ?? pricing.total;
    const canChargeOrder = cart.length > 0 && !loading && !fetchError && !!activeEvent && overdraftProductIds.size === 0 && !promotionQuoteLoading && Boolean(promotionQuote) && requiredPromotionChoices.length === 0 && (exhaustedPromotionChoices.length === 0 || acceptExhaustedRewards);

    useEffect(() => { setAcceptExhaustedRewards(false); }, [cart]);

    useEffect(() => {
        if (!activeEvent?.id || cart.length === 0) { setPromotionQuote(null); return; }
        let active = true;
        setPromotionQuoteLoading(true);
        const timer = window.setTimeout(() => {
            void quotePromotions({
                eventId: activeEvent.id,
                eventPhase: 'live',
                items: cart.map((item) => ({ product_id: item.product.id, quantity: item.quantity })),
                rewardChoices,
                promotionChoices,
            }).then((quote) => { if (active) setPromotionQuote(quote); })
              .catch((error) => { console.error(error); if (active) setToast({ tone: 'error', title: 'Could not calculate promotions' }); })
              .finally(() => { if (active) setPromotionQuoteLoading(false); });
        }, 100);
        return () => { active = false; window.clearTimeout(timer); };
    }, [activeEvent?.id, cart, promotionChoices, rewardChoices]);
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

    // Translates known RPC error strings to staff-readable messages.
    // The backend raises these as exception message text, which Supabase JS surfaces
    // on err.message.  Unknown errors get a generic fallback that warns about
    // retrying to avoid accidental duplicate charges.
    const toPaymentErrorMessage = (err: unknown): string => {
        const raw = paymentErrorText(err);
        if (raw.includes('insufficient_stock')) {
            return 'One or more items just sold out. Remove unavailable items and try again.';
        }
        if (raw.includes('order_not_editable')) {
            return 'This order was already processed. Refresh the page before retrying.';
        }
        if (raw.includes('order_cancelled')) {
            return 'This order was cancelled. Start a new transaction.';
        }
        if (raw.includes('event_not_active')) {
            return 'The event is no longer active.';
        }
        if (raw.includes('booth_closed')) {
            return 'The booth is closed. Open it before charging.';
        }
        if (raw.includes('forbidden')) {
            return 'Permission denied. Your role cannot complete this action.';
        }
        return 'Payment failed. Check order history before retrying to avoid a duplicate charge.';
    };

    const handlePayment = async (method: 'cash' | 'transfer') => {
        if (paymentInFlightRef.current) return;
        if (loading || fetchError) return;
        if (!canUsePos) {
            setToast({ tone: 'error', title: 'Charge not allowed', detail: 'Your role does not have permission to charge orders.' });
            return;
        }
        if (!activeEvent) {
            setToast({ tone: 'warning', title: 'No active event', detail: 'Select or activate an event first.' });
            return;
        }
        if (cart.length === 0) {
            setToast({ tone: 'warning', title: text('Cart is empty', 'ยังไม่มีสินค้าในตะกร้า'), detail: 'Select products before charging.' });
            return;
        }

        paymentInFlightRef.current = true;
        setLoading(true);

        // Snapshot the event ID and cart payload before the async sequence begins
        // so closure captures a stable value even if props/state change mid-flight.
        const eventId = activeEvent.id;
        const payloadItems = buildItemPayload();
        const orderIdAtPaymentStart = currentOrderId;
        const queueIdAtPaymentStart = selectedQueueId;
        const pricingSnapshot: PricingSnapshot = {
            subtotal: displayedSubtotal,
            discountTotal: displayedDiscount,
            total: displayedTotal,
            appliedPromotions: promotionQuote?.applied_promotions || [],
        };
        const paymentAttemptContext = JSON.stringify({
            artist_id: actorContext.artist_id,
            event_id: eventId,
            queue_id: queueIdAtPaymentStart,
            order_id: orderIdAtPaymentStart,
            method,
            items: payloadItems,
            pricing: pricingSnapshot,
        });
        const paymentAttemptStorageKey = `posPaymentAttempt:${hashPaymentAttemptContext(paymentAttemptContext)}`;
        const paymentAttemptId = getOrCreatePaymentAttemptId(paymentAttemptStorageKey);

        // The full RPC sequence (up to 3 sequential calls).  On confirmed success
        // it clears all payment-related state; on error it throws so the outer
        // catch can classify and display the right message.
        let durablePayment: OfflineEntry | null = null;
        const runPaymentSequence = async () => {
            durablePayment = await recordPreparedPayment(paymentAttemptId, eventId, {
                kind: 'sale', order_id: orderIdAtPaymentStart, items: cart.map(item => ({ product_id:item.product.id,quantity:item.quantity,notes:item.notes || '',name:item.product.name,unit_price:item.product.price,currency:item.product.currency })), currency:cart[0]?.product.currency, collected_total: pricingSnapshot.total, method,
                queue_number: selectedQueueNumber ? Number(selectedQueueNumber) : null,
                service_date: new Intl.DateTimeFormat('en-CA', { timeZone: activeEvent.event_timezone || 'Asia/Bangkok' }).format(new Date()), recorded_at: new Date().toISOString(),
                reward_choices: rewardChoices, promotion_choices: promotionChoices, expected_pricing_hash: promotionQuote?.pricing_hash,
                accept_exhausted_rewards: acceptExhaustedRewards,
            }, paymentAttemptStorageKey);

            if (orderIdAtPaymentStart) {
                const { error: syncError } = await supabase.rpc('sync_customer_order_items_with_stock', {
                    p_order_id: orderIdAtPaymentStart,
                    p_items: payloadItems,
                    p_payment_idempotency_key: paymentAttemptId,
                });
                if (syncError) throw syncError;

                const { error: completeError } = await supabase.rpc('complete_order_with_stock', {
                    p_order_id: orderIdAtPaymentStart,
                    p_payment_method: method,
                    p_payment_idempotency_key: paymentAttemptId,
                    p_reward_choices: rewardChoices,
                    p_promotion_choices: promotionChoices,
                    p_expected_pricing_hash: promotionQuote?.pricing_hash || null,
                    p_accept_exhausted_rewards: acceptExhaustedRewards,
                });
                if (completeError) throw completeError;
            } else if (queueIdAtPaymentStart) {
                const { data: createdOrderId, error: createError } = await supabase.rpc('create_customer_order_with_stock', {
                    p_queue_id: queueIdAtPaymentStart,
                    p_items: payloadItems,
                    p_payment_idempotency_key: paymentAttemptId,
                });
                if (createError) throw createError;

                const orderId = Array.isArray(createdOrderId) ? createdOrderId[0] : createdOrderId;
                const { error: completeError } = await supabase.rpc('complete_order_with_stock', {
                    p_order_id: orderId,
                    p_payment_method: method,
                    p_payment_idempotency_key: paymentAttemptId,
                    p_reward_choices: rewardChoices,
                    p_promotion_choices: promotionChoices,
                    p_expected_pricing_hash: promotionQuote?.pricing_hash || null,
                    p_accept_exhausted_rewards: acceptExhaustedRewards,
                });
                if (completeError) throw completeError;
            } else {
                const { error: walkinError } = await supabase.rpc('create_walkin_order_with_stock', {
                    p_event_id: eventId,
                    p_items: payloadItems,
                    p_payment_method: method,
                    p_payment_idempotency_key: paymentAttemptId,
                    p_reward_choices: rewardChoices,
                    p_promotion_choices: promotionChoices,
                    p_expected_pricing_hash: promotionQuote?.pricing_hash || null,
                    p_accept_exhausted_rewards: acceptExhaustedRewards,
                });
                if (walkinError) throw walkinError;
            }

            // Confirmed success: clear state and notify parent.
            // Also clear any prior "unknown" warning — we now know it succeeded.
            if (durablePayment) await saveOffline('operations', { ...durablePayment, status: 'applied' }).catch(() => { throw new PaymentTimeoutError(); });
            clearPaymentAttemptId(paymentAttemptStorageKey);
            setCart([]);
            setCurrentOrderId(null);
            setPaymentUnknownEventId(null);
            setIsPaymentModalOpen(false);
            if (selectedQueueId) {
                onQueueCompleted?.(selectedQueueId);
            }
            onClearQueue();
            await fetchProducts();
            setToast({ tone: 'success', title: 'Payment completed' });
        };

        // Outer timeout races against the entire sequence.  If the venue WiFi stalls
        // all three RPCs, staff would otherwise wait up to 45 s (3 × 15 s per-fetch
        // limit) with no feedback.  At PAYMENT_TIMEOUT_MS we stop the spinner and
        // show the "status unknown" warning so staff can check order history before
        // deciding whether to retry.
        //
        // IMPORTANT: we do NOT abort the in-flight requests when the timeout fires.
        // The DB may still commit after our UI has given up.  If it does,
        // runPaymentSequence will eventually resolve, clear the cart, and replace
        // the warning toast with "Payment completed" — giving staff a clear signal
        // that the charge went through without needing a retry.
        const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new PaymentTimeoutError()), PAYMENT_TIMEOUT_MS)
        );

        // Keep a reference to the sequence promise so we can suppress its rejection
        // if the timeout wins the race first.  Without this, a subsequent network
        // error from the in-flight RPC becomes an unhandled promise rejection.
        const sequencePromise = runPaymentSequence();
        sequencePromise.catch(() => { /* handled by the race winner's catch block */ });

        try {
            await Promise.race([sequencePromise, timeoutPromise]);
        } catch (err: unknown) {
            console.error('[Payment] error:', err);

            if (isNetworkAmbiguousError(err)) {
                // Network abort or sequence timeout: DB commit status is unknown.
                // Close the modal so staff cannot accidentally tap Charge again,
                // and show a persistent warning with an order history link.
                setIsPaymentModalOpen(false);
                setPaymentUnknownEventId(eventId);
                setToast({
                    tone: 'warning',
                    title: 'Payment status unknown',
                    detail: 'Network interrupted. Check order history before retrying to avoid a duplicate charge.',
                });
            } else {
                // Known error (insufficient_stock, order_cancelled, etc.): DB did
                // not commit, or the commit was definitively rejected.  Safe to
                // retry after fixing the underlying issue.
                clearPaymentAttemptId(paymentAttemptStorageKey);
                setPaymentUnknownEventId(null);
                if (requiresPromotionReview(err)) {
                    setRewardChoices([]);
                    setAcceptExhaustedRewards(false);
                    setIsPaymentModalOpen(false);
                }
                setToast({ tone: 'error', title: 'Payment failed', detail: toPaymentErrorMessage(err) });
            }
        } finally {
            setLoading(false);
            paymentInFlightRef.current = false;
        }
    };

    const quickFilters: Array<{ id: QuickFilter; label: string; count: number; icon: typeof Sparkles }> = [
        { id: 'all', label: text('All items', 'สินค้าทั้งหมด'), count: products.length, icon: Grid2x2 },
        { id: 'promo', label: text('Promo', 'โปรโมชัน'), count: highlightedCounts.promo, icon: Sparkles },
        { id: 'low_stock', label: text('Low stock', 'เหลือน้อย'), count: highlightedCounts.lowStock, icon: PackageX },
        { id: 'recent', label: text('Recent', 'ล่าสุด'), count: highlightedCounts.recent, icon: Clock3 },
        { id: 'pinned', label: text('Pinned', 'ปักหมุด'), count: highlightedCounts.pinned, icon: Pin },
    ];

    const renderPromoHelper = () => {
        if (promoInsights.length === 0) return null;

        return (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-center gap-2 text-amber-800 text-xs font-black uppercase tracking-wide mb-2">
                    <Flame size={14} />
                    {text("Promo helper", "เงื่อนไขโปรโมชัน")}
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
        if (!promotionQuote || promotionQuote.applied_promotions.length === 0) return null;

        return (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <div className="flex items-center gap-2 text-emerald-800 text-xs font-black uppercase tracking-wide mb-2">
                    <Sparkles size={14} />
                    {text("Applied promotions", "โปรโมชันที่ใช้")}
                </div>
                <div className="space-y-2">
                    {promotionQuote.applied_promotions.map((promotion) => (
                        <div key={promotion.id} className="rounded-lg bg-white/90 border border-emerald-100 px-2.5 py-2 flex items-start justify-between gap-2">
                            <div>
                                <div className="text-[11px] font-bold text-gray-800">{promotion.name}</div>
                                <div className="text-[10px] text-gray-600">{promotion.rule_text}</div>
                            </div>
                            {promotion.discount_amount > 0 && <div className="text-[11px] font-black text-emerald-700">- {formatPrice(promotion.discount_amount, cart[0]?.product.currency)}</div>}
                        </div>
                    ))}
                    {promotionQuote.reward_lines.map((reward) => <div key={`${reward.promotion_id}-${reward.tier_id || ''}-${reward.product_id}`} className="rounded-lg border border-emerald-100 bg-white/90 px-2.5 py-2 text-[11px] font-bold text-emerald-800">{text("Free gift:", "ของแถม:")} {reward.name} × {reward.quantity}</div>)}
                </div>
            </div>
        );
    };

    const renderPromotionChoices = () => <>
            {requiredPromotionChoices.map((choice) => <div className="mt-3" key={`${choice.kind}-${choice.promotion_id}-${choice.tier_id || ''}`}>
              <PromotionChoicePicker choice={choice} onConfirm={(selection) => {
                setAcceptExhaustedRewards(false);
                const setChoices = choice.kind === 'reward' ? setRewardChoices : setPromotionChoices;
                setChoices((current) => [...current.filter((item) => item.promotion_id !== choice.promotion_id || (item.tier_id || null) !== (choice.tier_id || null)), selection]);
              }} />
            </div>)}
        {exhaustedPromotionChoices.length > 0 && <label className="flex cursor-pointer gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"><input type="checkbox" checked={acceptExhaustedRewards} onChange={(event) => setAcceptExhaustedRewards(event.target.checked)} /><span><strong className="block">{text("All gifts for this promotion are out of stock.", "ของแถมในโปรโมชันนี้หมดแล้ว")}</strong>{text("Review the new total without this promotion before charging.", "ตรวจยอดใหม่ที่ไม่มีโปรโมชันนี้ก่อนรับชำระ")}</span></label>}
    </>;

    const renderCartItems = () => {
        // We ALWAYS render the cart structure if items exist.
        // If loading (and empty), we show a skeleton/empty state.
        // If loading (and cart populated), we overlay the content.
        if (cart.length === 0) {
            return (
                <div className="h-full flex flex-col items-center justify-center text-gray-600 opacity-80 relative">
                    {loading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-10 backdrop-blur-[1px]">
                            <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                    )}
                    <span className="text-4xl mb-2">🛒</span>
                    <p className="font-medium text-sm">{loading ? 'Loading...' : text('Cart is empty', 'ยังไม่มีสินค้าในตะกร้า')}</p>
                    <p className="mt-1 text-xs text-gray-400 text-center max-w-[220px]">{text('Select products first. Promotions and totals update automatically.', 'เลือกสินค้า ยอดรวมและโปรโมชันจะคำนวณให้อัตโนมัติ')}</p>
                </div>
            );
        }

        return (
            <div className="relative h-full">
                {loading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-20 backdrop-blur-[1px]">
                        <div className="w-6 h-6 border-2 border-pink-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                )}
                {!loading && fetchError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 z-20 backdrop-blur-[1px] gap-2 px-4">
                        <span className="text-red-500 font-bold text-sm text-center">{text("Failed to load order", "โหลดรายการขายไม่สำเร็จ")}</span>
                        <span className="text-xs text-gray-500 text-center">{text("Select this queue again or wait for an update.", "เลือกคิวนี้อีกครั้ง หรือรอข้อมูลอัปเดต")}</span>
                    </div>
                )}
                {renderPromoHelper()}
                {renderAppliedPromotions()}
                {renderPromotionChoices()}

                {cart.map((item) => {
                    const promoBadges = getPromotionBadgesForProduct(item.product, promotions);
                    const isOverdraft = overdraftProductIds.has(item.product.id);
                    const freshProduct = productsById.get(item.product.id);
                    const availableNow = freshProduct ? getAvailableUnits(freshProduct) : 0;

                    return (
                        <div
                            key={item.product.id}
                            className={`flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl border ${
                                isOverdraft
                                    ? 'bg-red-50 border-red-300'
                                    : 'bg-white border-gray-100'
                            }`}
                        >
                            <div className="flex items-center gap-2 overflow-hidden">
                                <div className="w-10 h-10 shrink-0 rounded-md overflow-hidden border border-gray-200 bg-gray-100">
                                    {item.product.image_url ? (
                                        <img
                                            src={getProductImage(item.product.image_url)}
                                            alt={item.product.name}
                                            className="w-full h-full object-cover"
                                            onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/nireq-mark.svg'; }}
                                        />
                                    ) : renderImageFallback(item.product.name, true)}
                                </div>
                                <div className="flex flex-col min-w-0 flex-1">
                                    <span className="font-bold text-xs text-gray-800 leading-tight break-words line-clamp-2" title={item.product.name}>{item.product.name}</span>
                                    <span className="text-[10px] text-gray-500">{formatPrice(item.product.price, item.product.currency)}</span>
                                    {isOverdraft && (
                                        <span className="text-[9px] font-bold text-red-600 mt-0.5">
                                            {text("Only", "เหลือ")} {availableNow} {text("left — reduce or remove", "ชิ้น กรุณาลดจำนวนหรือนำออก")}
                                        </span>
                                    )}
                                    {!isOverdraft && !!promoBadges.length && (
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
                            <div className="flex w-full items-center justify-between gap-2">
                                <span className={`font-bold text-xs ${isOverdraft ? 'text-red-500 line-through' : 'text-pink-600'}`}>
                                    {formatPrice(item.product.price * item.quantity, item.product.currency)}
                                </span>
                                <div className="flex items-center gap-1">
                                    <div className="flex items-center bg-gray-50 rounded-lg border border-gray-200 min-h-11">
                                        <button
                                            disabled={loading || fetchError}
                                            onClick={() => decreaseQuantity(item.product.id)}
                                            className="w-11 min-h-11 flex items-center justify-center text-gray-600 hover:text-red-600 text-[11px] disabled:opacity-50"
                                            aria-label={text(`Decrease quantity of ${item.product.name}`, `ลดจำนวน ${item.product.name}`)}
                                        >-</button>
                                        <span className={`min-w-[28px] text-center font-bold text-sm ${isOverdraft ? 'text-red-600' : 'text-gray-700'}`}>{item.quantity}</span>
                                        <button
                                            disabled={loading || fetchError}
                                            onClick={() => addToCart(item.product)}
                                            className="w-11 min-h-11 flex items-center justify-center text-gray-600 hover:text-green-600 text-[11px] disabled:opacity-50"
                                            aria-label={text(`Increase quantity of ${item.product.name}`, `เพิ่มจำนวน ${item.product.name}`)}
                                        >+</button>
                                    </div>
                                    <button
                                        disabled={loading || fetchError}
                                        onClick={() => removeFromCart(item.product.id)}
                                        className="w-11 min-h-11 text-sm text-gray-600 hover:text-red-700 disabled:opacity-50"
                                        aria-label={text(`Remove ${item.product.name} from cart`, `นำ ${item.product.name} ออกจากตะกร้า`)}
                                    >✕</button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderCartTotals = (mobile = false) => (
        <>
            <div className="space-y-1.5 mb-2">
                <div className="flex justify-between items-baseline">
                    <span className="text-gray-500 font-medium text-sm">{text("Subtotal", "ยอดสินค้า")}</span>
                    <span className="text-sm font-bold text-gray-700">{formatPrice(displayedSubtotal, cart[0]?.product.currency)}</span>
                </div>
                {displayedDiscount > 0 && (
                    <div className="flex justify-between items-baseline">
                        <span className="text-emerald-700 font-medium text-sm">{text("Discount", "ส่วนลด")}</span>
                        <span className="text-sm font-black text-emerald-700">- {formatPrice(displayedDiscount, cart[0]?.product.currency)}</span>
                    </div>
                )}
                <div className="flex justify-between items-baseline pt-1 border-t border-gray-100">
                    <span className="text-gray-500 font-medium text-sm">{text("Total", "ยอดรวม")}</span>
                    <span className={`${mobile ? 'text-xl' : 'text-2xl'} font-extrabold text-gray-900`}>{formatPrice(displayedTotal, cart[0]?.product.currency)}</span>
                </div>
            </div>

            {!activeEvent && (
                <div className="mb-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-600 font-bold text-center">
                    {text("No active event", "ยังไม่มีอีเวนต์ที่เปิดใช้งาน")}
                </div>
            )}

            {paymentUnknownEventId && (
                <div className="mb-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
                    <div className="flex items-start gap-2">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                            <div className="text-xs font-black text-amber-900 uppercase tracking-wide">
                                {text("Payment status unknown", "ยังไม่ทราบผลการรับชำระ")}
                            </div>
                            <div className="mt-1 text-[11px] font-medium text-amber-800 leading-snug">
                                {text("The network timed out. This payment may or may not have gone through. Check order history before charging again to avoid a duplicate.", "การเชื่อมต่อหมดเวลา รายการนี้อาจบันทึกแล้ว ตรวจประวัติการขายก่อนรับชำระอีกครั้งเพื่อป้องกันรายการซ้ำ")}
                            </div>
                            <div className="mt-2 flex items-center gap-3">
                                <a
                                    href={`/manage-events/${paymentUnknownEventId}/history`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[11px] font-black text-amber-900 underline underline-offset-2 hover:text-amber-700"
                                >
                                    {text("Open order history ↗", "เปิดประวัติการขาย ↗")}
                                </a>
                                <button
                                    type="button"
                                    onClick={() => setPaymentUnknownEventId(null)}
                                    className="text-[10px] font-bold text-amber-700 hover:text-amber-900 border border-amber-300 rounded px-2 py-0.5 hover:bg-amber-100"
                                >
                                    {text("Dismiss", "ปิดข้อความ")}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {overdraftProductIds.size > 0 && (
                <div className="mb-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 font-bold text-center">
                    {text("⚠️ Remove unavailable items before charging", "⚠️ นำสินค้าที่ไม่พร้อมขายออกก่อนรับชำระ")}
                </div>
            )}

            <button
                disabled={!canChargeOrder}
                onClick={() => {
                    setIsMobileCartOpen(false);
                    setIsPaymentModalOpen(true);
                }}
                className="w-full bg-pink-700 hover:bg-pink-800 text-white text-sm font-bold py-3 rounded-xl shadow-lg shadow-pink-200 disabled:bg-gray-200 disabled:[color:#475569] disabled:hover:bg-gray-200 disabled:cursor-not-allowed disabled:shadow-none transition-all active:scale-95"
            >
                {loading
                    ? text('Processing...', 'กำลังบันทึก...')
                    : fetchError
                    ? text('Order load failed', 'โหลดรายการไม่สำเร็จ')
                    : !activeEvent
                    ? text('Event Ended', 'อีเวนต์สิ้นสุดแล้ว')
                    : overdraftProductIds.size > 0
                    ? text('Cart has unavailable items', 'มีสินค้าที่ไม่พร้อมขาย')
                    : cart.length === 0
                    ? text('Charge ', 'รับชำระ ') + formatPrice(0, cart[0]?.product.currency)
                    : text('Charge ', 'รับชำระ ') + formatPrice(displayedTotal, cart[0]?.product.currency)}
            </button>
        </>
    );

    if (!canUsePos) {
        return (
            <div className="h-full flex items-center justify-center p-6">
                <div className="max-w-md w-full bg-white border border-gray-200 rounded-xl p-6 text-center">
                    <h3 className="text-lg font-bold text-gray-800 mb-2">{text("POS Access Restricted", "บัญชีนี้ไม่มีสิทธิ์ขายสินค้า")}</h3>
                    <p className="text-sm text-gray-600">{text("Your account role is queue-only. You can manage queue flow but cannot charge orders.", "คุณจัดการคิวได้ แต่ไม่มีสิทธิ์รับชำระเงิน")}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="festival-pos flex flex-col h-full overflow-hidden">
            <Toast message={toast} onClose={() => setToast(null)} />
            <div className="bg-white border-b border-gray-200 shrink-0 shadow-sm">
                <div className="px-4 py-2">
                    <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">{text('Select Customer', 'ขายให้')}</div>
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={onClearQueue}
                            className={`flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-bold transition-all ${
                                !selectedQueueId
                                    ? 'border-pink-600 bg-pink-600 text-white shadow-md shadow-pink-200'
                                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                            }`}
                        >
                            <User size={16} />
                            <span>{text('Walk-in', 'ลูกค้าหน้าบูธ')}</span>
                        </button>

                        <div className="min-w-0">
                            {servingQueues.length > 0 ? (
                                <div className="flex gap-2 overflow-x-auto no-scrollbar">
                                    {servingQueues.map((queue) => {
                                        const isSelected = selectedQueueId === queue.id;
                                        return (
                                            <button
                                                key={queue.id}
                                                onClick={() => onSelectQueue({ id: queue.id, queue_number: String(queue.queue_number) })}
                                                className={`flex min-h-10 min-w-full items-center justify-center gap-2 rounded-xl border px-3 text-sm font-bold whitespace-nowrap transition-all shrink-0 ${
                                                    isSelected
                                                        ? 'border-pink-600 bg-pink-600 text-white shadow-md shadow-pink-200'
                                                        : 'border-green-200 bg-white text-green-700 hover:bg-green-50'
                                                }`}
                                            >
                                                <CheckCircle size={14} className={isSelected ? 'text-white' : 'text-green-500'} />
                                                <span>{text("Queue #", "คิว #")}{queue.queue_number}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <button
                                    disabled
                                    className="flex min-h-10 w-full items-center justify-center rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-400"
                                >
                                    {text("From Queue", "ลูกค้าจากคิว")}
                                </button>
                            )}
                        </div>
                    </div>
                </div>

            </div>

            <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
                <div className="festival-cart hidden md:flex w-full h-auto max-h-[36dvh] md:max-h-none md:h-full md:w-[320px] bg-white border-t md:border-t-0 md:border-b-0 md:border-l border-pink-100 flex-col shrink-0 order-2 md:order-2">
                    <div className="px-3 py-3 border-b border-gray-100 bg-gradient-to-r from-white to-pink-50/40 shrink-0">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">{text('Cart Summary', 'รายการขายนี้')}</div>
                                <div className="mt-1 text-sm font-bold text-gray-800">
                                    {cartItemCount} {text("item", "ชิ้น")}{language === 'en' && cartItemCount !== 1 ? 's' : ''} · {cart.length} SKU
                                </div>
                            </div>
                            {displayedDiscount > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-700 border border-emerald-100">
                                    {text("Save", "ประหยัด")} {formatPrice(displayedDiscount, cart[0]?.product.currency)}
                                </span>
                            )}
                        </div>
                        {selectedQueueId ? (
                            <p className="mt-1 text-xs text-gray-500">{text("Editing preselected order for Queue #", "รายการที่เลือกไว้สำหรับคิว #")}{selectedQueueNumber}.</p>
                        ) : (
                            <p className="mt-1 text-xs text-gray-500">{text('Walk-in checkout. Add items, review promotions, then charge.', 'เพิ่มสินค้า ตรวจยอดและโปรโมชัน แล้วรับชำระเงิน')}</p>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[120px]" tabIndex={0} role="region" aria-label="Shopping cart">
                        {renderCartItems()}
                    </div>

                    <div className="p-3 border-t border-pink-100 bg-white shrink-0">
                        {renderCartTotals()}
                    </div>
                </div>

                <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-gray-50/50 order-1 md:order-1">
                    <div className="bg-white px-4 py-3 border-b border-gray-100 shadow-sm shrink-0 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <h1 className="festival-title">{text('Sell', 'ขายสินค้า')}</h1>
                                <div className="mt-1 flex items-center gap-2">
                                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-600">
                                        {filteredProducts.length} / {products.length}
                                    </span>
                                    <div className="hidden md:block text-xs text-gray-500">{text('Select products to start a sale.', 'เลือกสินค้าเพื่อเริ่มขาย')}</div>
                                </div>
                            </div>
                            <div className="hidden md:flex items-center gap-2">
                                {hasActiveProductFilters && (
                                    <button
                                        onClick={clearProductFilters}
                                        className="rounded-full border border-pink-200 bg-pink-50 px-3 py-1 text-xs font-bold text-pink-600 hover:bg-pink-100 transition-colors"
                                    >
                                        {text("Clear filters", "ล้างตัวกรอง")}
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder={text("Search by name or tag...", "ค้นหาชื่อสินค้าหรือแท็ก...")}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-400 text-sm"
                                aria-label={text("Search products", "ค้นหาสินค้า")}
                            />
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value as SortType)}
                                className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white cursor-pointer font-medium w-[110px] md:w-auto"
                                aria-label={text("Sort products by", "เรียงสินค้า") }
                            >
                                <option value="name">{text("Name", "ชื่อสินค้า")}</option>
                                <option value="price_low">{text("Price ↑", "ราคาต่ำก่อน")}</option>
                                <option value="price_high">{text("Price ↓", "ราคาสูงก่อน")}</option>
                            </select>
                            <div className="hidden md:flex items-center rounded-xl border border-gray-200 bg-gray-50 p-1" aria-label="Product browser layout">
                                <button
                                    onClick={() => setViewPreference('auto')}
                                    className={`min-h-9 px-3 py-1.5 rounded-lg text-xs font-black ${viewPreference === 'auto' ? 'bg-white text-pink-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                                    aria-label="Auto product layout"
                                >
                                    {text("Auto", "อัตโนมัติ")}
                                </button>
                                <button
                                    onClick={() => setViewPreference('visual')}
                                    className={`min-h-9 px-3 py-1.5 rounded-lg text-xs font-black inline-flex items-center gap-1.5 ${viewPreference === 'visual' ? 'bg-white text-pink-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                                    aria-label="Fast grid product view"
                                >
                                    <Grid2x2 size={16} />
                                    {text("Grid", "รูปสินค้า")}
                                </button>
                                <button
                                    onClick={() => setViewPreference('compact')}
                                    className={`min-h-9 px-3 py-1.5 rounded-lg text-xs font-black inline-flex items-center gap-1.5 ${viewPreference === 'compact' ? 'bg-white text-pink-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                                    aria-label="Detail list product view"
                                >
                                    <Rows3 size={16} />
                                    {text("List", "รายการ")}
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
                                        className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap inline-flex items-center gap-1.5 ${selectedQuickFilter === filter.id ? 'bg-gray-900 text-white shadow-md' : 'bg-gray-100 text-slate-700 hover:bg-gray-200'}`}
                                    >
                                        <Icon size={12} />
                                        <span>{filter.label}</span>
                                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${selectedQuickFilter === filter.id ? 'bg-white/20 text-white' : 'bg-white text-slate-600'}`}>{filter.count}</span>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                            {categories.map((cat) => (
                                <button
                                    key={cat.label}
                                    onClick={() => setSelectedCategory(cat.label)}
                                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${selectedCategory === cat.label ? 'bg-pink-600 text-white shadow-md' : 'bg-gray-100 text-pink-900 hover:bg-gray-200'}`}
                                >
                                    {cat.label} <span className={`ml-1 ${selectedCategory === cat.label ? 'text-pink-100' : 'text-slate-500'}`}>{cat.count}</span>
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
                                        {text("Quick:", "ตัวกรอง:")} {quickFilters.find((filter) => filter.id === selectedQuickFilter)?.label}
                                    </span>
                                )}
                                {selectedCategory !== 'All' && (
                                    <span className="rounded-full bg-pink-50 px-3 py-1 text-[11px] font-semibold text-pink-600">
                                        {text("Category:", "หมวด:")} {selectedCategory}
                                    </span>
                                )}
                                {selectedTag !== 'All' && (
                                    <span className="rounded-full bg-sky-50 px-3 py-1 text-[11px] font-semibold text-sky-700">
                                        {text("Tag:", "แท็ก:")} {selectedTag}
                                    </span>
                                )}
                                {searchQuery.trim() && (
                                    <span className="rounded-full bg-gray-100 px-3 py-1 text-[11px] font-semibold text-gray-600">
                                        {text("Search:", "ค้นหา:")} {searchQuery.trim()}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 md:p-4 min-h-0" tabIndex={0} role="region" aria-label={isVisualProductGrid ? 'Product grid' : 'Product list'}>
                        {filteredProducts.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-500 opacity-60"><p>{text("No products found.", "ไม่พบสินค้า ลองเปลี่ยนคำค้นหรือล้างตัวกรอง")}</p></div>
                        ) : (
                            <div className={effectiveViewMode === 'compact' ? 'space-y-2' : 'festival-product-grid grid gap-3'}>
                                {filteredProducts.map((product, productIndex) => {
                                    const groupName = product.variant_group_name?.trim() || '';
                                    const previousGroupName = filteredProducts[productIndex - 1]?.variant_group_name?.trim() || '';
                                    const showVariantHeader = groupName && groupName !== previousGroupName;

                                    return (
                                    <Fragment key={product.id}>
                                        {showVariantHeader && (
                                            <div className={effectiveViewMode === 'compact' ? 'rounded-xl border border-pink-100 bg-pink-50 px-3 py-2' : 'col-span-full rounded-xl border border-pink-100 bg-pink-50 px-3 py-2'}>
                                                <div className="text-sm font-black text-pink-950">{groupName}</div>
                                                <div className="text-[11px] font-bold text-pink-800">{text("Variants", "ตัวเลือก")}</div>
                                            </div>
                                        )}
                                    {(() => {
                                        const promoBadges = getPromotionBadgesForProduct(product, promotions);
                                        const available = getAvailableUnits(product);
                                        const lowStock = isLowStock(product);
                                        const isPinned = pinnedProductIds.includes(product.id);
                                        const displayName = product.variant_group_name && product.variant_name ? product.variant_name : product.name;

                                        if (effectiveViewMode === 'compact') {
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
                                                                    loading="lazy"
                                                                    decoding="async"
                                                                    onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/200x200?text=No+Img'; }}
                                                                />
                                                            ) : renderImageFallback(product.name, true)}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-start justify-between gap-2">
                                                                <div className="min-w-0">
                                                                    <div className="font-bold text-sm text-gray-800 leading-tight break-words" title={product.name}>{displayName}</div>
                                                                    {product.variant_group_name && product.variant_name && (
                                                                        <div className="text-[11px] font-bold text-pink-700 break-words">{product.name}</div>
                                                                    )}
                                                                    <div className="text-[11px] text-gray-500 break-words">{(product.category || 'Other').trim() || 'Other'}</div>
                                                                </div>
                                                                <div className="text-right shrink-0">
                                                                    <div className="font-black text-pink-600 text-sm">{formatPrice(product.price, product.currency)}</div>
                                                                    <div className="text-[10px] text-gray-500">{Number.isFinite(available) ? text(`${available} left`, `เหลือ ${available} ชิ้น`) : text('Unlimited', 'ไม่จำกัด')}</div>
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
                                                                        {text("Low stock", "เหลือน้อย")}
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
                                                    className="festival-product bg-white rounded-2xl border border-gray-100 overflow-hidden transition-all group flex flex-col p-0 relative hover:border-pink-200"
                                                >
                                                    <button
                                                    onClick={() => addToCart(product)}
                                                    className="cursor-pointer transition-all active:scale-[0.98] text-left h-full flex flex-col"
                                                >
                                                    <div className="w-full aspect-[4/3] bg-gray-100 relative overflow-hidden shrink-0">
                                                        {product.image_url ? (
                                                            <img
                                                                src={getProductImage(product.image_url)}
                                                                alt={product.name}
                                                                className="w-full h-full object-contain bg-white group-hover:scale-[1.03] transition-transform"
                                                                loading="lazy"
                                                                decoding="async"
                                                                onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/nireq-mark.svg'; }}
                                                            />
                                                        ) : renderImageFallback(product.name)}
                                                    </div>
                                                    <div className="flex flex-col px-3 pb-3 pt-2.5 justify-between flex-1 min-w-0">
                                                        <div>
                                                            <h3 className="font-black text-gray-900 text-sm leading-tight w-full line-clamp-2 min-h-[2.25rem]" title={product.name}>{displayName}</h3>
                                                            {product.variant_group_name && product.variant_name && (
                                                                <p className="mt-0.5 text-[11px] font-bold text-pink-700 truncate">{product.name}</p>
                                                            )}
                                                            <p className="mt-0.5 text-[11px] font-bold text-gray-500 truncate">{(product.category || 'Other').trim() || 'Other'}</p>
                                                            <div className="mt-2 flex flex-wrap gap-1">
                                                                {promoBadges.slice(0, 2).map((badge) => (
                                                                    <span key={badge.id} className="inline-flex items-center px-1.5 py-0.5 rounded-full border text-[9px] font-bold bg-rose-50 text-rose-700 border-rose-100">{badge.shortLabel}</span>
                                                                ))}
                                                                {lowStock && <span className="inline-flex items-center px-1.5 py-0.5 rounded-full border text-[9px] font-bold bg-amber-50 text-amber-700 border-amber-100">{text("Low", "เหลือน้อย")}</span>}
                                                            </div>
                                                        </div>
                                                        <div className="mt-3 flex items-end justify-between gap-2">
                                                            <div className="text-[10px] font-bold text-gray-500">
                                                                {Number.isFinite(available) ? text(`${available} left`, `เหลือ ${available} ชิ้น`) : text('Unlimited', 'ไม่จำกัด')}
                                                            </div>
                                                            <div className="text-base font-black text-pink-600">
                                                                {formatPrice(product.price, product.currency)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </button>
                                                <button
                                                    onClick={() => togglePinnedProduct(product.id)}
                                                    className={`absolute top-2 right-2 icon-touch min-w-9 min-h-9 rounded-xl shadow-sm ${isPinned ? 'bg-gray-900 text-white' : 'bg-white/95 text-gray-500 hover:text-pink-600'}`}
                                                    aria-label={isPinned ? `Unpin ${product.name}` : `Pin ${product.name}`}
                                                >
                                                    <Pin size={12} />
                                                </button>
                                            </div>
                                        );
                                    })()}
                                    </Fragment>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="md:hidden sticky bottom-0 z-20 border-t border-pink-100 bg-white/95 backdrop-blur px-3 pt-2 pb-safe-bar shadow-[0_-6px_16px_rgba(15,23,42,0.08)]">
                <button
                    onClick={() => setIsMobileCartOpen(true)}
                    className="w-full rounded-2xl border border-pink-100 bg-gradient-to-r from-white to-pink-50 px-3 py-2.5 text-left touch-manipulation"
                >
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">{text('Cart', 'ตะกร้า')}</div>
                            <div className="text-sm font-bold text-gray-800">{cartItemCount} {text("item", "ชิ้น")}{language === 'en' && cartItemCount !== 1 ? 's' : ''} · {cart.length} SKU</div>
                            <div className="text-[11px] text-gray-500 truncate">
                                {selectedQueueId ? `Queue #${selectedQueueNumber}` : text('Walk-in checkout', 'ขายให้ลูกค้าหน้าบูธ')}
                            </div>
                        </div>
                        <div className="text-right shrink-0">
                            {displayedDiscount > 0 && (
                                <div className="text-[11px] font-bold text-emerald-600">{text("Save", "ประหยัด")} {formatPrice(displayedDiscount, cart[0]?.product.currency)}</div>
                            )}
                            <div className="text-lg font-extrabold text-gray-900">{formatPrice(displayedTotal, cart[0]?.product.currency)}</div>
                            <div className="text-[11px] font-bold text-pink-600">{cart.length === 0 ? text('Select items', 'เลือกสินค้า') : text('View cart', 'ดูตะกร้า')}</div>
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
                    <div ref={cartDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={text("Shopping cart", "ตะกร้าสินค้า")} className="absolute inset-x-0 bottom-0 max-h-[78dvh] rounded-t-3xl bg-white shadow-2xl border-t border-pink-100 flex flex-col overflow-hidden">
                        <div className="shrink-0 px-4 pt-3 pb-2 border-b border-gray-100">
                            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-gray-200" />
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">{text('Cart Summary', 'รายการขายนี้')}</div>
                                    <div className="mt-1 text-sm font-bold text-gray-800">
                                        {cartItemCount} {text("item", "ชิ้น")}{language === 'en' && cartItemCount !== 1 ? 's' : ''} · {cart.length} SKU
                                    </div>
                                    <div className="mt-1 text-xs text-gray-500">
                                        {selectedQueueId ? `Editing Queue #${selectedQueueNumber}` : text('Walk-in checkout', 'ขายให้ลูกค้าหน้าบูธ')}
                                    </div>
                                </div>
                                <button
                                    onClick={() => setIsMobileCartOpen(false)}
                                    className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600"
                                >
                                    {text("Close", "ปิด")}
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto overscroll-contain p-3 space-y-2 min-h-[180px]">
                            {renderCartItems()}
                        </div>
                        <div className="shrink-0 border-t border-pink-100 bg-white px-3 pt-3 pb-safe-bar">
                            {renderCartTotals(true)}
                        </div>
                    </div>
                </div>
            )}

            {isPaymentModalOpen && (
                <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div ref={paymentDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="payment-title" className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md max-h-[90dvh] overflow-y-auto">
                        <h3 id="payment-title" className="text-2xl font-black text-gray-800 text-center mb-2">{text('Record payment', 'บันทึกการรับเงิน')}</h3>
                        <p className="text-gray-500 text-center mb-6">{text('Confirm what you received directly from the customer. Nireq does not check your bank account.', 'ยืนยันเงินที่ได้รับจากลูกค้า NireQ ไม่ได้ตรวจยอดในบัญชีธนาคารของคุณ')}<br />{text("Amount:", "ยอดเงิน:")} <span className="text-pink-600 font-bold">{formatPrice(displayedTotal, cart[0]?.product.currency)}</span></p>
                        <div className="grid grid-cols-2 gap-4 mb-4">
                            <button
                                onClick={() => handlePayment('cash')}
                                disabled={loading || fetchError}
                                className="flex flex-col items-center justify-center p-6 bg-emerald-50 hover:bg-emerald-100 border-2 border-emerald-100 hover:border-emerald-300 rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <span className="text-4xl mb-2">💵</span>
                                <span className="font-bold text-emerald-700">{text('CASH', 'เงินสด')}</span>
                            </button>
                            <button
                                onClick={() => handlePayment('transfer')}
                                disabled={loading || fetchError}
                                className="flex flex-col items-center justify-center p-6 bg-sky-50 hover:bg-sky-100 border-2 border-sky-100 hover:border-sky-300 rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <span className="text-4xl mb-2">🏦</span>
                                <span className="text-center font-bold text-sky-700">{text('Confirm transfer received', 'ยืนยันว่าได้รับเงินโอน')}</span>
                            </button>
                        </div>
                        <button
                            onClick={() => setIsPaymentModalOpen(false)}
                            className="w-full py-2 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition-colors"
                        >
                            {text("Cancel", "ยกเลิก")}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
