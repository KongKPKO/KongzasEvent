import { useEffect, useState, useMemo, useRef, Suspense, lazy } from 'react';
import { Link, useOutletContext, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { Search, ArrowUpDown, ChevronDown, ChevronUp, CheckCircle, X, XCircle, Trash2, Ticket, ShoppingBag, Sparkles } from 'lucide-react';
import { getOptimizedImageUrl } from '../../utils/imageUtils';
import ProductSkeleton from '../../components/menu/ProductSkeleton';
import { ConfirmDialog, Toast } from '../../components/ui/Feedback';

const ProductList = lazy(() => import('../../components/menu/ProductList'));
import { formatPrice } from '../../utils/currency';
import { calculatePromotionPricing, getPromotionBadgesForProduct, type PromotionRule } from '../../utils/promotionPricing';
import { normalizeProductRecord } from '../../utils/schemaCompat';
import { useI18n } from '../../i18n';
import { formatDateInTimeZone } from '../../utils/timezone';
import {
  createPreorder,
  getPreorderErrorMessage,
} from '../../lib/preorders';
import {
  TICKET_UPDATED_EVENT,
  clearMenuOrderState,
  clearStoredTicketId,
  getStoredTicketId,
  ticketStorageKey,
} from '../../utils/customerEvents';
import type { CustomerOutletContext } from '../../types/customerContext';
import type { PaymentStatus, PreorderPaymentMethod } from '../../types/preorder';

interface Product {
  id: string;
  name: string;
  price: number;
  image_url: string;
  description?: string;
  category?: string;
  tags?: string[];
  status?: 'enable' | 'disable' | 'soldout';
  currency?: string;  // ✅ NEW: Currency code
  stock_total?: number | null;
  stock_reserved?: number;
  stock_sold?: number;
  is_unlimited?: boolean;
}

type CartItems = Record<string, number>;
type CartItemNames = Record<string, string>;
type PreorderCustomerForm = { name: string; phone: string; social: string; email: string; shippingAddress: string; note: string };
type PreorderReceiptState = {
  orderId: string;
  pickupCode: string;
  totalPrice: number;
  currency: string;
  pickupInstructions: string;
  paymentStatus: PaymentStatus;
  paymentMethods: PreorderPaymentMethod[];
  paymentDeadlineAt: string | null;
  submittedAt?: string | null;
};

const getQueueEventTimeZone = (queueData: any): string => {
  const eventData = Array.isArray(queueData?.events) ? queueData.events[0] : queueData?.events;
  return eventData?.event_timezone || 'Asia/Bangkok';
};

const isQueueFromToday = (queueData: any): boolean => {
  if (!queueData?.queue_service_date) return true;
  return queueData.queue_service_date === formatDateInTimeZone(new Date(), getQueueEventTimeZone(queueData));
};

const createClientRequestId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const MenuView = () => {
  const { t } = useI18n();
  const {
    artist: contextArtist,
    isConnected,
    selectedEvent,
    setSelectedEventId,
  } = useOutletContext<CustomerOutletContext>();
  const displayArtist = contextArtist;
  const navigate = useNavigate();
  const { slug } = useParams();
  
  const [products, setProducts] = useState<Product[]>([]);
  const [promotions, setPromotions] = useState<PromotionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [productsLoaded, setProductsLoaded] = useState(false);
  
  // Cart State - Initialize from localStorage
  const readStoredCart = () => {
    const saved = localStorage.getItem(`cart_${contextArtist?.id}`);
    if (!saved) return { items: {}, names: {} };
    try {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if ('items' in parsed || 'names' in parsed) {
          return { items: parsed.items || {}, names: parsed.names || {} };
        }
        return { items: parsed as CartItems, names: {} };
      }
    } catch {
      return { items: {}, names: {} };
    }
    return { items: {}, names: {} };
  };
  const [cart, setCart] = useState<CartItems>(() => readStoredCart().items);
  const [cartItemNames, setCartItemNames] = useState<CartItemNames>(() => readStoredCart().names);
  const [userQueueNumber, setUserQueueNumber] = useState<string | null>(null);
  const [userQueueStatus, setUserQueueStatus] = useState<string | null>(null);
  
  // UI States
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Filter & Sort State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedTag, setSelectedTag] = useState('All');
  const [sortOption, setSortOption] = useState('name_asc');

  // Order Submission State - Initialize from localStorage
  const [submitting, setSubmitting] = useState(false);
  const [isOrderSent, setIsOrderSent] = useState<boolean>(() => {
    return localStorage.getItem(`orderSent_${contextArtist?.id}`) === 'true';
  });
  const isOrderSentRef = useRef(isOrderSent);
  isOrderSentRef.current = isOrderSent;
  const [sentOrderId, setSentOrderId] = useState<string | null>(() => {
    return localStorage.getItem(`sentOrderId_${contextArtist?.id}`) || null;
  });
  const [isOrderCompleted, setIsOrderCompleted] = useState<boolean>(() => {
    return localStorage.getItem(`orderCompleted_${contextArtist?.id}`) === 'true';
  });
  const [preorderCustomer, setPreorderCustomer] = useState<PreorderCustomerForm>({ name: '', phone: '', social: '', email: '', shippingAddress: '', note: '' });
  const [advanceOrderSubmitAttempted, setAdvanceOrderSubmitAttempted] = useState(false);
  const [postOrderPhoneTouched, setPostOrderPhoneTouched] = useState(false);
  const [postOrderAddressTouched, setPostOrderAddressTouched] = useState(false);
  const [preorderReceipt, setPreorderReceipt] = useState<PreorderReceiptState | null>(null);
  const [preorderHistory, setPreorderHistory] = useState<Array<{ orderId?: string; pickupCode: string; createdAt: string | null }>>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [toast, setToast] = useState<{ tone?: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<'submit_order' | 'cancel_order' | null>(null);
  const clearCart = () => {
    setCart({});
    setCartItemNames({});
  };

  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const product of products) {
      map.set(product.id, product);
    }
    return map;
  }, [products]);

  const getAvailableUnits = (product: Product | undefined) => {
    if (!product) return 0;
    if (product.is_unlimited) return Number.POSITIVE_INFINITY;
    const total = product.stock_total || 0;
    const reserved = product.stock_reserved || 0;
    const sold = product.stock_sold || 0;
    return Math.max(0, total - reserved - sold);
  };

  // --- 1. Derived Data ---
  const uniqueCategories = useMemo(() => {
      const cats = products.map(p => p.category || 'Other').filter(Boolean);
      return ['All', ...Array.from(new Set(cats)).sort()];
  }, [products]);

  const uniqueTags = useMemo(() => {
      const tags = products.flatMap((p) => p.tags || []).map((tag) => tag.trim()).filter(Boolean);
      return ['All', ...Array.from(new Set(tags)).sort()];
  }, [products]);

  const filteredProducts = useMemo(() => {
      const query = searchQuery.trim().toLowerCase();
      return products.filter(product => {
         const tagHaystack = (product.tags || []).join(' ').toLowerCase();
         const matchesSearch =
            query.length === 0 ||
            product.name.toLowerCase().includes(query) ||
            (product.category || '').toLowerCase().includes(query) ||
            (product.description || '').toLowerCase().includes(query) ||
            tagHaystack.includes(query);
         const matchesCategory = selectedCategory === 'All' || (product.category || 'Other') === selectedCategory;
         const matchesTag = selectedTag === 'All' || (product.tags || []).some((tag) => tag.trim() === selectedTag);
         const isVisible = product.status !== 'disable';
         return matchesSearch && matchesCategory && matchesTag && isVisible;
      }).sort((a, b) => {
         if (sortOption === 'name_asc') return a.name.localeCompare(b.name);
         if (sortOption === 'price_asc') return a.price - b.price;
         if (sortOption === 'price_desc') return b.price - a.price;
         return 0;
      });
  }, [products, searchQuery, selectedCategory, selectedTag, sortOption]);

  const totalItems = useMemo(() => Object.values(cart).reduce((sum, qty) => sum + qty, 0), [cart]);
  const cartItems = useMemo(() => products
    .filter((product) => (cart[product.id] || 0) > 0)
    .map((product) => ({ product, quantity: cart[product.id] || 0 })), [products, cart]);
  const pricing = useMemo(() => calculatePromotionPricing(cartItems, promotions), [cartItems, promotions]);
  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    selectedCategory !== 'All' ||
    selectedTag !== 'All' ||
    sortOption !== 'name_asc';
  const promoProductCount = useMemo(
    () => products.filter((product) => getPromotionBadgesForProduct(product, promotions).length > 0).length,
    [products, promotions]
  );
  const quickCategoryChips = uniqueCategories.slice(0, 5);
  const hasMoreCategories = uniqueCategories.length > quickCategoryChips.length;
  
  // ✅ NEW: Get currency from first cart item for totals display
  const cartCurrency = useMemo(() => {
    const firstProductId = Object.keys(cart).find(id => cart[id] > 0);
    const firstProduct = firstProductId ? productById.get(firstProductId) : null;
    return firstProduct?.currency;
  }, [cart, productById]);

  const isPreorderMode = selectedEvent?.selling_mode === 'preorder';
  const isPostOrderMode = selectedEvent?.selling_mode === 'post_event';
  const isAdvanceOrderFlow = isPreorderMode || isPostOrderMode;
  const preorderWindowOpen = useMemo(() => {
    if (!isAdvanceOrderFlow) return false;
    // Post-event stores run on events already marked Ended.
    const statusOk = selectedEvent?.status === 'Confirmed' || (isPostOrderMode && selectedEvent?.status === 'Ended');
    if (!statusOk) return false;
    const opensAt = selectedEvent?.preorder_opens_at ? new Date(selectedEvent.preorder_opens_at).getTime() : null;
    const closesAt = selectedEvent?.preorder_closes_at ? new Date(selectedEvent.preorder_closes_at).getTime() : null;
    const eventEndsAt = selectedEvent?.end_date ? new Date(selectedEvent.end_date).getTime() : null;
    if (opensAt && nowMs < opensAt) return false;
    if (closesAt && nowMs >= closesAt) return false;
    if (isPreorderMode && eventEndsAt && nowMs >= eventEndsAt) return false;
    return true;
  }, [isAdvanceOrderFlow, isPreorderMode, nowMs, selectedEvent?.end_date, selectedEvent?.preorder_closes_at, selectedEvent?.preorder_opens_at, selectedEvent?.status]);
  const preorderGuidance = preorderWindowOpen
    ? isPostOrderMode ? t('menuPostOrderGuidanceOpen') : t('menuPreorderGuidanceOpen')
    : t('menuPreorderGuidanceNotOpen');
  const preorderReceiptStorageKey = contextArtist?.id && selectedEvent?.id
    ? `preorderReceipt_${contextArtist.id}_${selectedEvent.id}`
    : null;
  const preorderCustomerStorageKey = contextArtist?.id ? `preorderCustomer_${contextArtist.id}` : null;
  const preorderContactDisplay = useMemo(
    () => [preorderCustomer.phone, preorderCustomer.social, preorderCustomer.email].map((value) => value.trim()).filter(Boolean).join(' · '),
    [preorderCustomer.email, preorderCustomer.phone, preorderCustomer.social]
  );
  const hasValidPreorderEmail = isValidEmail(preorderCustomer.email);
  const postOrderPhoneMissing = isPostOrderMode && preorderCustomer.phone.trim().length === 0;
  const postOrderAddressMissing = isPostOrderMode && preorderCustomer.shippingAddress.trim().length === 0;

  const fetchPromotions = async (artistId: string, eventId?: string | null) => {
    const { data, error } = await supabase.rpc('list_active_promotions', {
      p_artist_id: artistId,
      p_event_id: eventId || null,
    });

    if (error) {
      console.error('[MenuView] fetchPromotions failed:', error);
      setPromotions([]);
      return;
    }

    setPromotions((data || []) as PromotionRule[]);
  };

  // --- Persist cart to localStorage ---
  useEffect(() => {
    if (contextArtist?.id) {
      localStorage.setItem(`cart_${contextArtist.id}`, JSON.stringify({ items: cart, names: cartItemNames }));
    }
  }, [cart, cartItemNames, contextArtist?.id]);

  useEffect(() => {
    if (!isAdvanceOrderFlow) return;
    setNowMs(Date.now());
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => window.clearInterval(intervalId);
  }, [isAdvanceOrderFlow]);

  useEffect(() => {
    if (!preorderCustomerStorageKey) return;
    const saved = localStorage.getItem(preorderCustomerStorageKey);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      setPreorderCustomer({
        name: typeof parsed?.name === 'string' ? parsed.name : '',
        phone: typeof parsed?.phone === 'string' ? parsed.phone : '',
        social: typeof parsed?.social === 'string' ? parsed.social : typeof parsed?.contact === 'string' ? parsed.contact : '',
        email: typeof parsed?.email === 'string' ? parsed.email : '',
        shippingAddress: typeof parsed?.shippingAddress === 'string' ? parsed.shippingAddress : '',
        note: typeof parsed?.note === 'string' ? parsed.note : '',
      });
    } catch {
      setPreorderCustomer({ name: '', phone: '', social: '', email: '', shippingAddress: '', note: '' });
    }
  }, [preorderCustomerStorageKey]);

  useEffect(() => {
    if (!preorderCustomerStorageKey) return;
    localStorage.setItem(preorderCustomerStorageKey, JSON.stringify(preorderCustomer));
  }, [preorderCustomer, preorderCustomerStorageKey]);

  useEffect(() => {
    if (!preorderReceiptStorageKey) {
      setPreorderReceipt(null);
      setPreorderHistory([]);
      return;
    }
    const saved = localStorage.getItem(preorderReceiptStorageKey);
    if (!saved) {
      setPreorderReceipt(null);
    } else {
      try {
        const parsed = JSON.parse(saved);
        if (parsed?.orderId && parsed?.pickupCode) {
          setPreorderReceipt({
            orderId: parsed.orderId,
            pickupCode: parsed.pickupCode,
            totalPrice: Number(parsed.totalPrice || 0),
            currency: parsed.currency || 'THB',
            pickupInstructions: parsed.pickupInstructions || '',
            paymentStatus: parsed.paymentStatus || 'awaiting_payment',
            paymentMethods: Array.isArray(parsed.paymentMethods) ? parsed.paymentMethods : [],
            paymentDeadlineAt: parsed.paymentDeadlineAt || null,
            submittedAt: parsed.submittedAt || null,
          });
        } else {
          setPreorderReceipt(null);
        }
      } catch {
        setPreorderReceipt(null);
      }
    }
    // Order history for this artist+event (covers multiple pre-orders from one device).
    try {
      const rawHistory = localStorage.getItem(`${preorderReceiptStorageKey}_history`);
      const parsedHistory = rawHistory ? JSON.parse(rawHistory) : [];
      const entries = Array.isArray(parsedHistory)
        ? parsedHistory.filter((entry) => entry?.pickupCode)
        : [];
      // Migrate the legacy single receipt into history if missing.
      if (saved) {
        try {
          const legacy = JSON.parse(saved);
          if (legacy?.pickupCode && !entries.some((entry) => entry.pickupCode === legacy.pickupCode)) {
            entries.unshift({ orderId: legacy.orderId, pickupCode: legacy.pickupCode, createdAt: null });
          }
        } catch { /* ignore */ }
      }
      setPreorderHistory(entries.slice(0, 5));
    } catch {
      setPreorderHistory([]);
    }
  }, [preorderReceiptStorageKey]);

  // --- Persist order states to localStorage ---
  useEffect(() => {
    if (contextArtist?.id) {
      localStorage.setItem(`orderSent_${contextArtist.id}`, isOrderSent.toString());
      localStorage.setItem(`sentOrderId_${contextArtist.id}`, sentOrderId || '');
      localStorage.setItem(`orderCompleted_${contextArtist.id}`, isOrderCompleted.toString());
    }
  }, [isOrderSent, sentOrderId, isOrderCompleted, contextArtist?.id]);

  // --- 2. Fetch Data ---
  useEffect(() => {
    const initData = async () => {
        setLoading(true);
        setProductsLoaded(false);
        
        // 2.1 ✅ ตรวจสอบคิวของลูกค้าจาก LocalStorage (FIX: Scoped to Artist)
        const localQueueId = getStoredTicketId(displayArtist.id);
        if (localQueueId) {
            const { data: queueData } = await supabase
                .from('queues')
                .select('event_id, queue_number, status, queue_service_date, events(event_timezone)')
                .eq('id', localQueueId)
                .maybeSingle();

            // Only show queue number if status is active
            if (queueData && isQueueFromToday(queueData) && ['waiting', 'calling', 'serving'].includes(queueData.status)) {
                if (queueData.event_id && queueData.event_id !== selectedEvent?.id) {
                  setSelectedEventId(queueData.event_id);
                }
                setUserQueueNumber(queueData.queue_number);
                setUserQueueStatus(queueData.status);
            } else {
               // Clear stale id when row missing (deleted server-side) or
               // not from today's service date. Ended-state tickets are
               // intentionally preserved so the user can close them.
               if (!queueData || !isQueueFromToday(queueData)) {
                  clearStoredTicketId(displayArtist.id);
               }
               setUserQueueNumber(null);
               setUserQueueStatus(queueData?.status || null);
            }
        }

        // 2.2 ดึงสินค้า: use the selected customer event catalog, fallback to global catalog when no current event exists.
        const productRequest = selectedEvent?.id
            ? supabase.rpc('list_event_products', { p_event_id: selectedEvent.id })
            : supabase
                .from('products')
                .select('*')
                .eq('artist_id', displayArtist.id)
                .order('created_at', { ascending: false });

        const { data, error } = await productRequest;

        if (!error && data) {
            setProducts(((data || []) as Record<string, any>[]).map((product) => normalizeProductRecord(product) as Product));
            setProductsLoaded(true);
        }

        await fetchPromotions(displayArtist.id, selectedEvent?.id || null);
        setLoading(false);
    };

    if (displayArtist?.id) {
       initData();
       
       const productChannel = supabase
         .channel(`menu-realtime-${displayArtist.id}`)
         .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `artist_id=eq.${displayArtist.id}` }, () => {
               void initData();
            }
         )
         .on('postgres_changes', { event: '*', schema: 'public', table: 'event_products', filter: `event_id=eq.${selectedEvent?.id || '00000000-0000-0000-0000-000000000000'}` }, () => {
               void initData();
            }
         )
         .subscribe();

       const promotionChannel = supabase
         .channel(`menu-promotions-${displayArtist.id}`)
         .on('postgres_changes', { event: '*', schema: 'public', table: 'artist_promotions', filter: `artist_id=eq.${displayArtist.id}` }, () => {
            fetchPromotions(displayArtist.id, selectedEvent?.id || null);
         })
         .subscribe();
         
       return () => {
         supabase.removeChannel(productChannel);
         supabase.removeChannel(promotionChannel);
       };
    }
  }, [displayArtist?.id, selectedEvent?.id]);

  // ✅ NEW: Realtime Cart Cleanup - Remove sold out/disabled items automatically
  useEffect(() => {
    if (loading || !productsLoaded) return;
    if (Object.keys(cart).length === 0) return;

    const itemsToRemove = Object.keys(cart).filter(id => {
        const product = productById.get(id);
        // Remove if product not found (deleted), disabled, or no available stock left
        return !product || product.status !== 'enable' || getAvailableUnits(product) <= 0;
    });

    if (itemsToRemove.length > 0) {
        setCart(prev => {
            const next = { ...prev };
            itemsToRemove.forEach(id => delete next[id]);
            return next;
        });
        setCartItemNames(prev => {
            const next = { ...prev };
            itemsToRemove.forEach(id => delete next[id]);
            return next;
        });
        
        const removedNames = itemsToRemove.map(id => productById.get(id)?.name || cartItemNames[id] || t('menuUnknownItem'));
        setToast({
          tone: 'warning',
          title: t('menuCartUpdated'),
          detail: `${t('menuCartUpdatedDetail')}\n- ${removedNames.join('\n- ')}`,
        });
    }
  }, [cart, cartItemNames, loading, productById, productsLoaded]); // Run whenever products list updates (via realtime)

  // --- 3. Helpers ---
  const getProductImageUrl = (dbValue: string, width: number = 400) => {
    if (!dbValue) return '';
    let path = dbValue;
    if (dbValue.includes('http') && dbValue.includes('Menu/')) {
       const parts = dbValue.split('Menu/');
       if (parts.length > 1) path = parts[1];
    }
    const { data } = supabase.storage.from('Menu').getPublicUrl(path);
    return getOptimizedImageUrl(data.publicUrl, width);
  };

  const updateQuantity = (productId: string, delta: number, productName?: string) => {
    if (isOrderSent) return;
    setCart(prev => {
      const current = prev[productId] || 0;
      const product = productById.get(productId);
      const available = getAvailableUnits(product);
      let next = Math.max(0, current + delta);
      if (delta > 0 && Number.isFinite(available)) {
        next = Math.min(next, available);
      }
      const newCart = { ...prev, [productId]: next };
      if (next === 0) delete newCart[productId];
      setCartItemNames(prevNames => {
        const nextNames = { ...prevNames };
        if (next === 0) {
          delete nextNames[productId];
          return nextNames;
        }
        if (productName) nextNames[productId] = productName;
        return nextNames;
      });
      return newCart;
    });
  };

  // --- 4. Confirm Order Logic ---
  const handleConfirmOrder = async () => {
    if (totalItems === 0) return;

    if (isAdvanceOrderFlow) {
      setAdvanceOrderSubmitAttempted(true);
      if (!preorderWindowOpen) {
        setToast({ tone: 'warning', title: t('menuPreorderClosed'), detail: preorderGuidance });
        return;
      }
      if (!preorderCustomer.name.trim()) {
        setToast({
          tone: 'warning',
          title: t('menuPreorderNameRequired'),
          detail: t('menuPreorderNameRequiredDetail'),
        });
        setIsCartOpen(true);
        return;
      }
      if (!hasValidPreorderEmail) {
        setToast({
          tone: 'warning',
          title: t('menuPreorderEmailRequiredToast'),
          detail: t('menuPreorderEmailRequiredToastDetail'),
        });
        setIsCartOpen(true);
        return;
      }
      if (postOrderPhoneMissing) {
        setToast({
          tone: 'warning',
          title: t('menuPostOrderPhoneRequired'),
          detail: t('menuPostOrderPhoneRequired'),
        });
        setIsCartOpen(true);
        return;
      }
      if (postOrderAddressMissing) {
        setToast({
          tone: 'warning',
          title: t('menuPostOrderAddressRequired'),
          detail: t('menuPostOrderAddressRequired'),
        });
        setIsCartOpen(true);
        return;
      }
      setConfirmAction('submit_order');
      return;
    }

    const localQueueId = getStoredTicketId(displayArtist?.id);
    if (!localQueueId) {
        setToast({
          tone: 'warning',
          title: t('menuQueueTicketRequired'),
          detail: t('menuQueueTicketRequiredDetail'),
        });
        navigate(`/${displayArtist?.slug || slug}/queue`);
        return;
    }

    if (!canConfirmOrder) {
        setToast({ tone: 'info', title: t('menuPleaseWaitQueue'), detail: t('menuPleaseWaitQueueDetail') });
        return;
    }

    setConfirmAction('submit_order');
  };

  const submitConfirmedOrder = async () => {
    if (isAdvanceOrderFlow) {
      await submitConfirmedPreorder();
      return;
    }

    const localQueueId = getStoredTicketId(displayArtist?.id);
    if (!localQueueId) {
        setConfirmAction(null);
        setToast({ tone: 'warning', title: t('menuQueueTicketRequired'), detail: t('menuQueueTicketRequiredDetail') });
        navigate(`/${displayArtist?.slug || slug}/queue`);
        return;
    }

    setConfirmAction(null);
    setSubmitting(true);
    try {
        // 2. Validate Queue Status (Server Check - Strict)
        const { data: queueData, error: queueError } = await supabase
            .from('queues')
            .select('event_id, status, queue_service_date, events(event_timezone)')
            .eq('id', localQueueId)
            .maybeSingle();

        if (queueError) {
             throw queueError;
        }
        if (!queueData) {
             // Row deleted server-side — clear stale id and surface a friendly message.
             clearStoredTicketId(displayArtist?.id);
             setUserQueueNumber(null);
             setUserQueueStatus(null);
             setToast({
              tone: 'warning',
              title: t('menuTicketClosed'),
              detail: t('menuTicketClosedDetail', { status: 'expired' }),
             });
             navigate(`/${displayArtist?.slug || slug}/queue`);
             return;
        }

        if (!isQueueFromToday(queueData)) {
             clearStoredTicketId(displayArtist?.id);
             setUserQueueNumber(null);
             setUserQueueStatus(null);
             setToast({
              tone: 'warning',
              title: t('menuTicketClosed'),
              detail: t('menuTicketClosedDetail', { status: 'expired' }),
             });
             navigate(`/${displayArtist?.slug || slug}/queue`);
             return;
        }

        if (selectedEvent?.id && queueData.event_id !== selectedEvent.id) {
             if (queueData.event_id) setSelectedEventId(queueData.event_id);
             setToast({
              tone: 'info',
              title: t('menuQueueTicketRequired'),
              detail: t('menuQueueTicketRequiredDetail'),
             });
             navigate(`/${displayArtist?.slug || slug}/queue`);
             return;
        }

        if (!['calling', 'serving'].includes(queueData.status)) {
             if (['complete', 'missed', 'expired'].includes(queueData.status)) {
                 clearStoredTicketId(displayArtist?.id);
                 setToast({
                  tone: 'warning',
                  title: t('menuTicketClosed'),
                  detail: t('menuTicketClosedDetail', { status: queueData.status }),
                 });
                 navigate(`/${displayArtist?.slug || slug}/queue`);
                 return;
             }

             setUserQueueStatus(queueData.status);
             setToast({ tone: 'info', title: t('menuPleaseWaitQueue'), detail: t('menuPleaseWaitQueueDetail') });
             return;
        }

        const itemPayload = Object.entries(cart).map(([productId, qty]) => ({
            product_id: productId,
            quantity: qty,
            notes: ''
        }));

        const { data: createdOrderId, error: orderError } = await supabase.rpc('create_customer_order_with_stock', {
            p_queue_id: localQueueId,
            p_items: itemPayload
        });

        if (orderError) throw orderError;

        const orderId = Array.isArray(createdOrderId) ? createdOrderId[0] : createdOrderId;
        if (!orderId) throw new Error('Order creation failed');

        setSentOrderId(orderId);
        setIsOrderSent(true);
        setIsCartOpen(false);
        clearCart();
        setToast({ tone: 'success', title: t('menuOrderSentToast'), detail: t('menuOrderSentDetail') });

    } catch (err: any) {
        setToast({ tone: 'error', title: t('menuOrderSendError'), detail: err.message });
        console.error(err);
    } finally {
        setSubmitting(false);
    }
  };

  const submitConfirmedPreorder = async () => {
    setConfirmAction(null);
    if (!selectedEvent?.id) {
      setToast({ tone: 'warning', title: t('menuPreorderClosed'), detail: t('menuPreorderGuidanceNotOpen') });
      return;
    }
    if (!preorderWindowOpen) {
      setToast({ tone: 'warning', title: t('menuPreorderClosed'), detail: preorderGuidance });
      return;
    }
    if (!preorderCustomer.name.trim()) {
      setToast({
        tone: 'warning',
        title: t('menuPreorderNameRequired'),
        detail: t('menuPreorderNameRequiredDetail'),
      });
      setIsCartOpen(true);
      return;
    }
    if (!hasValidPreorderEmail) {
      setToast({
        tone: 'warning',
        title: t('menuPreorderEmailRequiredToast'),
        detail: t('menuPreorderEmailRequiredToastDetail'),
      });
      setIsCartOpen(true);
      return;
    }
    if (postOrderPhoneMissing) {
      setToast({
        tone: 'warning',
        title: t('menuPostOrderPhoneRequired'),
        detail: t('menuPostOrderPhoneRequired'),
      });
      setIsCartOpen(true);
      return;
    }
    if (postOrderAddressMissing) {
      setToast({
        tone: 'warning',
        title: t('menuPostOrderAddressRequired'),
        detail: t('menuPostOrderAddressRequired'),
      });
      setIsCartOpen(true);
      return;
    }

    setSubmitting(true);
    try {
      const result = await createPreorder({
        eventId: selectedEvent.id,
        items: Object.entries(cart)
          .filter(([, qty]) => qty > 0)
          .map(([productId, qty]) => ({ product_id: productId, quantity: qty, notes: '' })),
        customerName: preorderCustomer.name.trim(),
        customerContact: preorderContactDisplay,
        customerPhone: preorderCustomer.phone.trim(),
        customerSocial: preorderCustomer.social.trim(),
        customerEmail: preorderCustomer.email.trim(),
        shippingAddress: preorderCustomer.shippingAddress.trim(),
        customerNote: preorderCustomer.note.trim(),
        clientRequestId: createClientRequestId(),
      });

      const receipt: PreorderReceiptState = {
        orderId: result.order_id,
        pickupCode: result.pickup_code,
        totalPrice: result.total_price,
        currency: result.currency,
        pickupInstructions: result.pickup_instructions || selectedEvent.preorder_pickup_instructions || '',
        paymentStatus: result.payment_status,
        paymentMethods: Array.isArray(result.payment_methods) ? result.payment_methods : [],
        paymentDeadlineAt: result.payment_deadline_at,
        submittedAt: null,
      };
      setPreorderReceipt(receipt);
      const historyEntry = { orderId: result.order_id, pickupCode: result.pickup_code, createdAt: new Date().toISOString() };
      setPreorderHistory((prev) => {
        const next = [historyEntry, ...prev.filter((entry) => entry.pickupCode !== historyEntry.pickupCode)].slice(0, 5);
        if (preorderReceiptStorageKey) {
          localStorage.setItem(`${preorderReceiptStorageKey}_history`, JSON.stringify(next));
        }
        return next;
      });
      if (preorderReceiptStorageKey) {
        localStorage.setItem(preorderReceiptStorageKey, JSON.stringify(receipt));
      }
      setIsCartOpen(false);
      clearCart();
      navigate(`/${displayArtist?.slug || slug}/order/${result.pickup_code}`);
    } catch (err) {
      setToast({ tone: 'error', title: t('menuPreorderFailed'), detail: getPreorderErrorMessage(err) });
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelOrder = async () => {
      if (!sentOrderId) return;
      setConfirmAction('cancel_order');
  };

  const cancelConfirmedOrder = async () => {
      if (!sentOrderId) return;
      setConfirmAction(null);
      setSubmitting(true);
      try {
          const { data: cancelled, error } = await supabase.rpc('cancel_customer_order_with_stock_release', {
            p_order_id: sentOrderId
          });
          if (error) throw error;
          if (cancelled === false) throw new Error(t('menuOrderCannotCancel'));
          
          // Reset all states
          clearCart();
          setIsOrderSent(false);
          setSentOrderId(null);
          setIsOrderCompleted(false);
          
          const cleared = clearMenuOrderState(contextArtist?.id);
          if (!cleared) {
            setToast({ tone: 'warning', title: t('menuOrderCancelled'), detail: t('menuClearOrderError') });
          } else {
            setToast({ tone: 'success', title: t('menuOrderCancelled') });
          }
      } catch (err: any) {
          setToast({ tone: 'error', title: t('menuOrderCancelError'), detail: err.message });
      } finally {
          setSubmitting(false);
      }
  };

  // Keep completion status in sync even when realtime events are missed.
  useEffect(() => {
      const localQueueId = getStoredTicketId(displayArtist?.id);
      if (!sentOrderId || !localQueueId) return;

      let isMounted = true;

      const syncCompletionStatus = async () => {
          const { data, error } = await supabase.rpc('get_customer_order_status', {
              p_order_id: sentOrderId,
              p_queue_id: localQueueId,
          });

          const status = Array.isArray(data) ? data[0]?.status : data?.status;
          if (!isMounted || error || !status) return;
          if (status === 'completed') {
              setIsOrderCompleted(true);
          }
      };

      void syncCompletionStatus();
      const pollId = window.setInterval(() => { void syncCompletionStatus(); }, 5000);

      return () => {
          isMounted = false;
          window.clearInterval(pollId);
      };
  }, [sentOrderId, displayArtist?.id]);

  // Realtime listener for Queue Status (clears badge when completed).
  // Track the active ticket id in state so that cross-tab/same-tab ticket
  // changes (TICKET_UPDATED_EVENT, native 'storage') resubscribe the channel
  // to the right row instead of staying bound to whatever id was in storage
  // at mount time.
  const [menuTicketId, setMenuTicketId] = useState<string | null>(() => getStoredTicketId(displayArtist?.id));
  useEffect(() => {
      if (!displayArtist?.id) {
          setMenuTicketId(null);
          return;
      }
      const sync = () => {
          const next = getStoredTicketId(displayArtist.id);
          setMenuTicketId((prev) => (prev !== next ? next : prev));
      };
      sync();
      const handleStorage = (e: StorageEvent) => {
          if (e.key === ticketStorageKey(displayArtist.id)) sync();
      };
      window.addEventListener(TICKET_UPDATED_EVENT, sync);
      window.addEventListener('storage', handleStorage);
      return () => {
          window.removeEventListener(TICKET_UPDATED_EVENT, sync);
          window.removeEventListener('storage', handleStorage);
      };
  }, [displayArtist?.id]);

  useEffect(() => {
     if (!menuTicketId || !displayArtist?.id) return;

     const channel = supabase
         .channel(`menu-queue-status-${menuTicketId}`)
         .on('postgres_changes',
             { event: 'UPDATE', schema: 'public', table: 'queues', filter: `id=eq.${menuTicketId}` },
             (payload: any) => {
                 if (!payload.new) return;
                 const newStatus = payload.new.status;
                 if (!newStatus) return;
                 // Read via ref so this subscription is not torn down when
                 // isOrderSent flips (order submit / cancel).
                 if (newStatus === 'complete' && isOrderSentRef.current) {
                    setIsOrderCompleted(true);
                 }
                 setUserQueueStatus(newStatus || null);
                 if (['complete', 'missed', 'expired'].includes(newStatus)) {
                    setUserQueueNumber(null);
                 } else if (payload.new.queue_number) {
                    setUserQueueNumber(payload.new.queue_number);
                 }
             }
         )
         .subscribe();

      return () => { supabase.removeChannel(channel); };
  // isOrderSent is intentionally omitted — read via isOrderSentRef to avoid
  // re-subscribing every time the customer submits or cancels an order.
  }, [displayArtist?.id, menuTicketId]);

  // Helper to reset order state - Clear all localStorage and state
  const canConfirmOrder = userQueueStatus === 'calling' || userQueueStatus === 'serving';
  const queueGuidance = canConfirmOrder
    ? t('menuQueueGuidanceReady')
    : userQueueNumber
      ? t('menuQueueGuidanceWaiting')
      : t('menuQueueGuidanceNeedTicket');
  const canSubmitSelection = isAdvanceOrderFlow ? preorderWindowOpen : canConfirmOrder;
  const orderGuidance = isAdvanceOrderFlow ? preorderGuidance : queueGuidance;
  const orderStatusReadyLabel = isAdvanceOrderFlow ? t('menuPreorderReady') : t('menuReadyConfirm');
  const orderStatusWaitingLabel = isAdvanceOrderFlow ? t('menuPreorderClosed') : t('menuSelectionOnly');

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedCategory('All');
    setSelectedTag('All');
    setSortOption('name_asc');
  };

  const handleCloseCompletedOrder = () => {
      clearCart();
      setIsOrderSent(false);
      setSentOrderId(null);
      setIsOrderCompleted(false);
      
      const cleared = clearMenuOrderState(contextArtist?.id);
      if (!cleared) {
        setToast({ tone: 'warning', title: t('menuClearOrderError') });
      }
  };

  const handleStartNewPreorder = () => {
    if (preorderReceiptStorageKey) {
      localStorage.removeItem(preorderReceiptStorageKey);
      localStorage.removeItem(`${preorderReceiptStorageKey}_history`);
    }
    setPreorderReceipt(null);
    setPreorderHistory([]);
  };

  const activePreorderEntries = preorderHistory.length > 0
    ? preorderHistory
    : (preorderReceipt ? [{ orderId: preorderReceipt.orderId, pickupCode: preorderReceipt.pickupCode, createdAt: null }] : []);

  if (loading) return <main className="p-8 text-center text-gray-600">{t('menuLoading')}</main>;

  return (
    <main className="relative mx-auto min-h-screen w-full max-w-md overflow-hidden border-x border-pink-50 bg-pink-50 shadow-2xl lg:max-w-none lg:overflow-visible lg:border-x-0 lg:shadow-none">
      <Toast message={toast} onClose={() => setToast(null)} />
      <ConfirmDialog
        open={confirmAction === 'submit_order'}
        title={isAdvanceOrderFlow ? t('menuPreorderConfirmTitle') : t('menuConfirmOrderTitle')}
        detail={`${totalItems} ${t('menuItems')}\n${t('menuTotal')} ${formatPrice(pricing.total, cartCurrency)}`}
        confirmLabel={isPostOrderMode ? t('menuPostOrderSubmit') : isPreorderMode ? t('menuPreorderConfirmButton') : t('menuConfirmOrderButton')}
        loading={submitting}
        onConfirm={submitConfirmedOrder}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={confirmAction === 'cancel_order'}
        title={t('menuCancelOrderTitle')}
        detail={t('menuCancelOrderDetail')}
        confirmLabel={t('menuCancelOrderButton')}
        tone="danger"
        loading={submitting}
        onConfirm={cancelConfirmedOrder}
        onCancel={() => setConfirmAction(null)}
      />
       {!isConnected && (
         <div className="fixed left-0 right-0 top-0 z-[60] mx-auto max-w-md bg-red-500 py-1 text-center text-[11px] font-bold uppercase tracking-widest text-white lg:max-w-none">
            {t('customerOffline')}
         </div>
       )}

      <div className="sticky top-0 z-40 w-full border-b border-pink-100 bg-white/95 shadow-sm shadow-pink-50 backdrop-blur-xl">
         <div className="mx-auto max-w-md px-4 pb-3 pt-3 lg:max-w-6xl lg:px-6">
            <div className="space-y-2 lg:flex lg:items-center lg:justify-between lg:gap-4 lg:space-y-0">
               <div className="flex min-w-0 items-center gap-3 lg:flex-1">
                  {displayArtist?.image_url ? (
                     <img
                        src={displayArtist.image_url}
                        alt={displayArtist?.display_name || 'Creator'}
                        className="h-11 w-11 shrink-0 rounded-2xl border border-pink-100 bg-pink-50 object-cover shadow-sm"
                     />
                  ) : (
                     <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-pink-100 text-base font-black text-pink-600">
                        {(displayArtist?.display_name || 'M').charAt(0)}
                     </div>
                  )}
                  <div className="min-w-0">
                     <div className="text-[11px] font-black uppercase tracking-[0.18em] text-pink-700">{t('customerNavMerch')}</div>
                     <h1 className="truncate text-lg font-black leading-6 text-gray-950">
                        {displayArtist?.display_name || 'Menu'}
                     </h1>
                  </div>
               </div>

               <div className="flex items-center justify-between gap-2 pl-14 lg:pl-0">
                  {isAdvanceOrderFlow ? (
                     <div className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50 px-3 text-[11px] font-black text-pink-700">
                        <ShoppingBag size={14} aria-hidden="true" />
                        <span>{isPostOrderMode ? t('menuPostOrderMode') : t('menuPreorderMode')}</span>
                     </div>
                  ) : (
                     <button
                        type="button"
                        onClick={() => navigate(`/${displayArtist?.slug || slug}/queue`)}
                        className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-[11px] font-black transition active:scale-95 ${
                           userQueueNumber
                              ? 'border-pink-200 bg-pink-50 text-pink-700'
                              : 'border-gray-200 bg-white text-gray-600'
                        }`}
                     >
                        <Ticket size={14} aria-hidden="true" />
                        <span>{userQueueNumber ? `Q #${userQueueNumber}` : t('menuQueueNumber')}</span>
                     </button>
                  )}
                  <div className={`max-w-[180px] rounded-full border px-2.5 py-1 text-right text-[11px] font-black leading-tight lg:max-w-[280px] lg:px-3 lg:py-2 lg:text-left lg:text-[11px] ${
                     canSubmitSelection
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700'
                  }`}>
                     {orderGuidance}
                  </div>
               </div>
            </div>

            <div className="mt-3 flex gap-2 lg:grid lg:grid-cols-[minmax(260px,1fr)_170px_170px_150px]">
               <label className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pink-400" size={17} />
                  <input
                     type="text"
                     inputMode="search"
                     placeholder={t('menuSearchPlaceholder')}
                     value={searchQuery}
                     onChange={(e) => setSearchQuery(e.target.value)}
                     className="h-11 w-full rounded-2xl border border-pink-100 bg-pink-50 py-2 pl-10 pr-3 text-sm font-bold text-pink-950 outline-none transition focus:border-pink-300 focus:bg-white focus:ring-4 focus:ring-pink-100"
                  />
               </label>
               <label className="relative hidden lg:block">
                  <select
                     value={selectedCategory}
                     onChange={(e) => setSelectedCategory(e.target.value)}
                     className="h-11 w-full appearance-none rounded-2xl border border-pink-100 bg-white px-3 pr-8 text-xs font-black text-gray-700 outline-none transition focus:border-pink-300 focus:ring-4 focus:ring-pink-100"
                     aria-label={t('menuCategory')}
                  >
                     {uniqueCategories.map((cat) => (
                        <option key={cat} value={cat}>{cat === 'All' ? t('menuAll') : cat}</option>
                     ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
               </label>
               <label className="relative hidden lg:block">
                  <select
                     value={selectedTag}
                     onChange={(e) => setSelectedTag(e.target.value)}
                     className="h-11 w-full appearance-none rounded-2xl border border-pink-100 bg-white px-3 pr-8 text-xs font-black text-gray-700 outline-none transition focus:border-pink-300 focus:ring-4 focus:ring-pink-100"
                     aria-label={t('menuFilterByTag')}
                  >
                     {uniqueTags.map(tag => (
                        <option key={tag} value={tag}>{tag === 'All' ? t('menuAllTags') : tag}</option>
                     ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
               </label>
               <label className="relative w-[126px] shrink-0">
                  <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                  <select
                     value={sortOption}
                     onChange={(e) => setSortOption(e.target.value)}
                     className="h-11 w-full appearance-none rounded-2xl border border-pink-100 bg-white py-2 pl-9 pr-8 text-xs font-black text-gray-700 outline-none transition focus:border-pink-300 focus:ring-4 focus:ring-pink-100"
                     aria-label={t('menuSortName')}
                  >
                     <option value="name_asc">{t('menuSortName')}</option>
                     <option value="price_asc">{t('menuSortPriceLow')}</option>
                     <option value="price_desc">{t('menuSortPriceHigh')}</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
               </label>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
               <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-black text-gray-600">
                     {filteredProducts.length} {t('menuItems')}
                  </span>
                  {promoProductCount > 0 && (
                     <span className="rounded-full border border-rose-100 bg-rose-50 px-2.5 py-1 text-[11px] font-black text-rose-700">
                        {promoProductCount} {t('menuOnPromo')}
                     </span>
                  )}
               </div>
               {hasActiveFilters && (
                  <button
                     onClick={clearFilters}
                     className="min-h-11 shrink-0 rounded-full border border-pink-200 bg-pink-50 px-3 text-[11px] font-black text-pink-700 transition active:scale-95"
                  >
                     {t('menuClearFilters')}
                  </button>
               )}
            </div>

            <div className="mt-2 flex items-center gap-2 lg:hidden">
               <div className="no-scrollbar flex flex-1 gap-2 overflow-x-auto">
                  {quickCategoryChips.map(cat => (
                     <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`min-h-11 min-w-11 shrink-0 rounded-full px-3 text-xs font-black transition active:scale-95 ${
                           selectedCategory === cat
                              ? 'bg-pink-600 text-white shadow-md shadow-pink-100'
                              : 'border border-gray-200 bg-white text-gray-600'
                        }`}
                     >
                        {cat === 'All' ? t('menuAll') : cat}
                     </button>
                  ))}
               </div>
               {hasMoreCategories && (
                  <div className="relative w-[128px] shrink-0">
                     <select
                        value={quickCategoryChips.includes(selectedCategory) ? 'More' : selectedCategory}
                        onChange={(e) => {
                           const nextValue = e.target.value;
                           if (nextValue !== 'More') setSelectedCategory(nextValue);
                        }}
                        className="min-h-11 w-full appearance-none rounded-full border border-gray-200 bg-white px-3 pr-7 text-xs font-black text-gray-700 outline-none focus:ring-4 focus:ring-pink-100"
                        aria-label={t('menuMoreCategories')}
                     >
                        <option value="More" disabled>{t('menuMore')}</option>
                        {uniqueCategories.filter((cat) => !quickCategoryChips.includes(cat)).map((cat) => (
                           <option key={cat} value={cat}>{cat === 'All' ? t('menuAll') : cat}</option>
                        ))}
                     </select>
                     <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={13} />
                  </div>
               )}
            </div>

            {uniqueTags.length > 1 && (
               <div className="mt-2 lg:hidden">
                  <div className="relative">
                     <select
                        value={selectedTag}
                        onChange={(e) => setSelectedTag(e.target.value)}
                        className="h-10 w-full appearance-none rounded-2xl border border-pink-100 bg-white px-3 pr-8 text-xs font-black text-gray-700 outline-none focus:border-pink-300 focus:ring-4 focus:ring-pink-100"
                        aria-label={t('menuFilterByTag')}
                     >
                        {uniqueTags.map(tag => (
                           <option key={tag} value={tag}>{tag === 'All' ? t('menuAllTags') : tag}</option>
                        ))}
                     </select>
                     <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-pink-400" size={14} />
                  </div>
               </div>
            )}

            {hasActiveFilters && (
               <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedCategory !== 'All' && (
                     <span className="rounded-full border border-pink-100 bg-pink-50 px-2.5 py-1 text-[11px] font-black text-pink-700">
                        {t('menuCategory')} {selectedCategory}
                     </span>
                  )}
                  {selectedTag !== 'All' && (
                     <span className="rounded-full border border-pink-100 bg-white px-2.5 py-1 text-[11px] font-black text-pink-700">
                        {t('menuTag')} {selectedTag}
                     </span>
                  )}
                  {searchQuery.trim() && (
                     <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-black text-gray-600">
                        {t('menuSearch')} {searchQuery.trim()}
                     </span>
                  )}
               </div>
            )}
         </div>
      </div>

      <div className="mx-auto w-full max-w-md lg:max-w-6xl lg:px-6 lg:py-6">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0">
            {/* --- MENU GRID (LAZY LOADED) --- */}
            <Suspense fallback={<ProductSkeleton />}>
              <ProductList
                  products={filteredProducts}
                  promotions={promotions}
                  cart={cart}
                  isOrderSent={isOrderSent}
                  onUpdateQuantity={updateQuantity}
                  onClearFilters={clearFilters}
              />
            </Suspense>
          </div>

          {totalItems === 0 && !isOrderSent && activePreorderEntries.length === 0 && (
            <aside className="sticky top-28 hidden rounded-3xl border border-pink-100 bg-white p-5 shadow-lg shadow-pink-100/60 lg:block">
              <div className="rounded-2xl border border-dashed border-pink-200 bg-pink-50/70 p-5 text-center">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white text-pink-600 shadow-sm">
                  <ShoppingBag size={22} aria-hidden="true" />
                </div>
                <h2 className="mt-4 text-lg font-black text-gray-950">{isAdvanceOrderFlow ? isPostOrderMode ? t('menuPostOrderMode') : t('menuPreorderMode') : t('menuYourOrder')}</h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">
                  {isAdvanceOrderFlow ? preorderGuidance : queueGuidance}
                </p>
                <div className={`mt-4 rounded-xl border px-3 py-2 text-left text-xs font-bold ${
                  canSubmitSelection
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}>
                  {canSubmitSelection ? orderStatusReadyLabel : orderStatusWaitingLabel}
                </div>
              </div>
            </aside>
          )}

          {/* --- CONFIRM ORDER BAR / DESKTOP CHECKOUT PANEL --- */}
          {(totalItems > 0 || isOrderSent || activePreorderEntries.length > 0) && (
            <>
                {isCartOpen && !isOrderSent && (
                    <div className="fixed inset-0 z-[80] mx-auto max-w-md animate-fade-in bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setIsCartOpen(false)} />
                )}
                <div className={`fixed bottom-[80px] left-0 right-0 z-[90] mx-auto w-full max-w-md rounded-t-3xl border-t border-pink-100 shadow-[0_-12px_32px_rgba(131,24,67,0.14)] transition-all duration-300 lg:sticky lg:top-28 lg:z-30 lg:mx-0 lg:flex lg:max-h-[calc(100vh-8rem)] lg:max-w-none lg:flex-col lg:overflow-hidden lg:rounded-3xl lg:border lg:border-pink-100 lg:shadow-lg lg:shadow-pink-100/60 ${isOrderSent ? 'bg-green-50 border-green-200' : 'bg-white'}`}>
                    {!isOrderSent && totalItems > 0 && (
                        <div className={`${isCartOpen ? 'block' : 'hidden'} max-h-[62vh] overflow-y-auto rounded-t-xl border-b border-gray-100 bg-white p-3 animate-slide-up lg:block lg:max-h-none lg:min-h-0 lg:flex-1 lg:rounded-t-3xl lg:p-4`}>
                            <div className="flex justify-between items-center mb-3 sticky top-0 bg-white z-10 pb-2 border-b border-gray-50">
                                <h2 className="font-bold text-gray-800 text-sm">{t('menuYourOrder')} <span className="text-pink-700 text-xs font-semibold">({totalItems} {t('menuItems')})</span></h2>
                                <button onClick={() => setIsCartOpen(false)} className="grid h-11 w-11 place-items-center rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 lg:hidden" aria-label={t('menuClose')}><X size={16}/></button>
                            </div>
                            <div className="space-y-2">
                                {Object.entries(cart).map(([id, qty]) => {
                                    const product = products.find(p => p.id === id);
                                    if (!product || qty === 0) return null;
                                    const lineBreakdowns = pricing.lineBreakdowns[id] || [];
                                    const lineDiscount = lineBreakdowns.reduce((sum, item) => sum + item.discountAmount, 0);
                                    const lineSubtotal = product.price * qty;
                                    const lineTotal = Math.max(0, lineSubtotal - lineDiscount);
                                    return (
                                        <div key={id} className="bg-gray-50 p-2 rounded-lg border border-gray-100">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-2 overflow-hidden min-w-0 flex-1">
                                                    <div className="w-8 h-8 rounded-md bg-gray-200 bg-cover bg-center shrink-0" style={{backgroundImage: `url(${getProductImageUrl(product.image_url, 100)})`}}></div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="font-bold text-xs text-gray-800 truncate">{product.name}</div>
                                                        <div className="text-[11px] text-gray-500">{formatPrice(product.price, product.currency)} / {t('menuUnit')}</div>
                                                        {lineDiscount > 0 && (
                                                            <div className="mt-0.5 text-[11px] font-bold text-emerald-700">{t('menuNow')} {formatPrice(lineTotal, product.currency)} {t('menuFrom')} {formatPrice(lineSubtotal, product.currency)}</div>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <button onClick={() => updateQuantity(id, -1, product.name)} className="h-11 w-11 rounded-xl border border-gray-200 bg-white text-gray-600 text-sm font-black" aria-label={t('productDecrease', { name: product.name })}>-</button>
                                                    <div className="font-bold text-xs min-w-[28px] text-center text-pink-600">x {qty}</div>
                                                    <button onClick={() => updateQuantity(id, 1, product.name)} className="h-11 w-11 rounded-xl border border-gray-200 bg-white text-gray-600 text-sm font-black" aria-label={t('productIncrease', { name: product.name })}>+</button>
                                                    <button onClick={() => updateQuantity(id, -qty, product.name)} className="h-11 w-11 rounded-xl border border-red-200 bg-white text-red-600 text-xs font-black" aria-label={t('productRemove', { name: product.name })}>x</button>
                                                </div>
                                            </div>
                                            {lineBreakdowns.length > 0 && (
                                                <div className="mt-2 space-y-1">
                                                    {lineBreakdowns.map((entry, entryIndex) => (
                                                        <div key={`${entry.ruleId}-${entryIndex}`} className="rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1">
                                                            <div className="flex items-start justify-between gap-2">
                                                                <div>
                                                                    <div className="text-[11px] font-black text-emerald-800">{entry.label}</div>
                                                                    <div className="text-[11px] text-emerald-700">{entry.freeQuantity > 0 ? t('menuItemFree', { count: entry.freeQuantity }) : t('menuDiscountApplied', { count: entry.affectedQuantity })}</div>
                                                                </div>
                                                                <div className="text-[11px] font-black text-emerald-700">- {formatPrice(entry.discountAmount, product.currency)}</div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {pricing.appliedPromotions.length > 0 && (
                                <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5">
                                    <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-emerald-800 mb-2">
                                        <Sparkles size={12} /> {t('menuAppliedPromotions')}
                                    </div>
                                    <div className="space-y-1.5">
                                        {pricing.appliedPromotions.map((promotion) => (
                                            <div key={promotion.ruleId} className="flex items-start justify-between gap-2 rounded-lg bg-white/90 border border-emerald-100 px-2 py-1.5">
                                                <div>
                                                    <div className="text-[11px] font-bold text-gray-800">{promotion.label}</div>
                                                    <div className="text-[11px] text-gray-600">{promotion.message}</div>
                                                </div>
                                                <div className="text-[11px] font-black text-emerald-700">- {formatPrice(promotion.discountAmount, cartCurrency)}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-2.5 space-y-1.5">
                                <div className="flex items-center justify-between text-[11px] text-gray-600">
                                    <span>{t('menuSubtotal')}</span>
                                    <span className="font-bold text-gray-800">{formatPrice(pricing.subtotal, cartCurrency)}</span>
                                </div>
                                {pricing.discountTotal > 0 && (
                                    <div className="flex items-center justify-between text-[11px] text-emerald-700">
                                        <span>{t('menuDiscount')}</span>
                                        <span className="font-black">- {formatPrice(pricing.discountTotal, cartCurrency)}</span>
                                    </div>
                                )}
                                <div className="flex items-center justify-between pt-1 border-t border-gray-200">
                                    <span className="text-xs font-bold text-gray-700">{t('menuTotal')}</span>
                                    <span className="text-sm font-black text-gray-900">{formatPrice(pricing.total, cartCurrency)}</span>
                                </div>
                            </div>

                            {isAdvanceOrderFlow && (
                                <div className="mt-3 rounded-lg border border-pink-100 bg-pink-50/70 p-2.5 space-y-2">
                                    <label className="block">
                                        <span className="text-[11px] font-black uppercase tracking-wide text-pink-700">{t('menuPreorderName')}</span>
                                        <input
                                            value={preorderCustomer.name}
                                            onChange={(e) => setPreorderCustomer((prev) => ({ ...prev, name: e.target.value }))}
                                            placeholder={t('menuPreorderNamePlaceholder')}
                                            className="mt-1 min-h-11 w-full rounded-xl border border-pink-100 bg-white px-3 text-sm font-bold text-gray-900 outline-none focus:border-pink-300 focus:ring-4 focus:ring-pink-100"
                                        />
                                    </label>
                                    <div>
                                        <div className="text-[11px] font-black uppercase tracking-wide text-gray-600">{t('menuPreorderEmailLabel')}</div>
                                        <div className="mt-1 grid gap-2">
                                            <input
                                                value={preorderCustomer.email}
                                                onChange={(e) => setPreorderCustomer((prev) => ({ ...prev, email: e.target.value }))}
                                                placeholder={t('menuPreorderEmailPlaceholder')}
                                                inputMode="email"
                                                className="min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none focus:border-pink-300 focus:ring-4 focus:ring-pink-100"
                                            />
                                            <input
                                                value={preorderCustomer.phone}
                                                onChange={(e) => {
                                                    setPostOrderPhoneTouched(true);
                                                    setPreorderCustomer((prev) => ({ ...prev, phone: e.target.value }));
                                                }}
                                                placeholder={t('menuPreorderPhonePlaceholder')}
                                                inputMode="tel"
                                                required={isPostOrderMode}
                                                className="min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none focus:border-pink-300 focus:ring-4 focus:ring-pink-100"
                                            />
                                            <input
                                                value={preorderCustomer.social}
                                                onChange={(e) => setPreorderCustomer((prev) => ({ ...prev, social: e.target.value }))}
                                                placeholder={t('menuPreorderSocialPlaceholder')}
                                                className="min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none focus:border-pink-300 focus:ring-4 focus:ring-pink-100"
                                            />
                                        </div>
                                        {preorderCustomer.email.trim().length > 0 && !hasValidPreorderEmail && (
                                            <div className="mt-1 text-xs font-bold text-amber-700">{t('menuPreorderEmailInvalid')}</div>
                                        )}
                                        {isPostOrderMode && (advanceOrderSubmitAttempted || postOrderPhoneTouched) && postOrderPhoneMissing && (
                                            <div className="mt-1 text-xs font-bold text-amber-700">{t('menuPostOrderPhoneRequired')}</div>
                                        )}
                                    </div>
                                    {isPostOrderMode && (
                                        <label className="block">
                                            <span className="text-[11px] font-black uppercase tracking-wide text-gray-600">{t('menuPostOrderAddressLabel')}</span>
                                            <textarea
                                                value={preorderCustomer.shippingAddress}
                                                onChange={(e) => {
                                                    setPostOrderAddressTouched(true);
                                                    setPreorderCustomer((prev) => ({ ...prev, shippingAddress: e.target.value }));
                                                }}
                                                placeholder={t('menuPostOrderAddressPlaceholder')}
                                                rows={3}
                                                required
                                                className="mt-1 w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-pink-300 focus:ring-4 focus:ring-pink-100"
                                            />
                                            {(advanceOrderSubmitAttempted || postOrderAddressTouched) && postOrderAddressMissing && (
                                                <div className="mt-1 text-xs font-bold text-amber-700">{t('menuPostOrderAddressRequired')}</div>
                                            )}
                                        </label>
                                    )}
                                    <label className="block">
                                        <span className="text-[11px] font-black uppercase tracking-wide text-gray-600">{t('menuPreorderNote')}</span>
                                        <textarea
                                            value={preorderCustomer.note}
                                            onChange={(e) => setPreorderCustomer((prev) => ({ ...prev, note: e.target.value }))}
                                            placeholder={t('menuPreorderNotePlaceholder')}
                                            rows={2}
                                            className="mt-1 w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-pink-300 focus:ring-4 focus:ring-pink-100"
                                        />
                                    </label>
                                </div>
                            )}

                            <div className={`mt-3 rounded-lg border px-2.5 py-2 ${canSubmitSelection ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                                <div className={`text-[11px] font-black uppercase tracking-wide ${canSubmitSelection ? 'text-emerald-800' : 'text-amber-800'}`}>
                                    {canSubmitSelection ? orderStatusReadyLabel : orderStatusWaitingLabel}
                                </div>
                                <div className={`mt-1 text-[11px] leading-relaxed ${canSubmitSelection ? 'text-emerald-700' : 'text-amber-700'}`}>
                                    {orderGuidance}
                                </div>
                            </div>
                        </div>
                    )}
                    {activePreorderEntries.length > 0 && (
                        <div className="border-b border-pink-100 bg-pink-50/80 lg:shrink-0">
                            <div className="flex min-h-12 items-center gap-2 px-3 py-2">
                                <Link
                                    to={`/${displayArtist?.slug || slug}/order/${activePreorderEntries[0].pickupCode}`}
                                    className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1 py-1 hover:bg-pink-100/70"
                                >
                                    <CheckCircle size={16} className="shrink-0 text-pink-600" />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-xs font-bold text-pink-900">{t('menuPreorderActiveBanner')}</div>
                                        <div className="font-mono text-sm font-black tracking-[0.14em] text-gray-950">{activePreorderEntries[0].pickupCode}</div>
                                    </div>
                                    <span className="inline-flex min-h-11 shrink-0 items-center rounded-xl bg-pink-600 px-3 text-xs font-black text-white">
                                        {t('menuPreorderViewStatus')}
                                    </span>
                                </Link>
                                <button
                                    type="button"
                                    onClick={handleStartNewPreorder}
                                    aria-label={t('menuPreorderNew')}
                                    className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-pink-100 bg-white text-gray-500 hover:bg-pink-50"
                                >
                                    <XCircle size={16} />
                                </button>
                            </div>
                            {activePreorderEntries.length > 1 && (
                                <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
                                    <span className="text-[11px] font-bold text-pink-800">{t('menuPreorderOtherOrders')}</span>
                                    {activePreorderEntries.slice(1).map((entry) => (
                                        <Link
                                            key={entry.pickupCode}
                                            to={`/${displayArtist?.slug || slug}/order/${entry.pickupCode}`}
                                            className="inline-flex min-h-9 items-center rounded-lg border border-pink-200 bg-white px-2 font-mono text-xs font-black tracking-[0.1em] text-pink-700 hover:bg-pink-50"
                                        >
                                            {entry.pickupCode}
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    {(totalItems > 0 || isOrderSent) && (
                    <div className="flex min-h-14 items-center gap-3 bg-white/95 p-2 px-3 backdrop-blur-sm lg:shrink-0 lg:border-t lg:border-pink-50 lg:p-4">
                        {isOrderSent ? (
                            isOrderCompleted ? (
                                // ✅ ORDER COMPLETED UI
                                <div className="flex-1 flex items-center justify-between w-full animate-fade-in bg-green-100 px-3 py-2 rounded-lg border border-green-200">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle size={22} className="text-green-600" />
                                        <div>
                                            <div className="text-sm font-black text-green-800">{t('menuOrderCompleted')}</div>
                                            <div className="text-[11px] text-green-600">{t('menuOrderCompletedThanks')}</div>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={handleCloseCompletedOrder} 
                                        className="flex min-h-11 items-center gap-1 rounded-xl bg-green-600 px-3 text-xs font-bold text-white shadow-sm hover:bg-green-700"
                                    >
                                        <X size={14} /> {t('menuCloseCompletedOrder')}
                                    </button>
                                </div>
                            ) : (
                                // ORDER SENT (waiting)
                                <div className="flex-1 flex items-center justify-between w-full animate-fade-in bg-green-50 px-2 py-1 rounded-lg">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle size={20} className="text-green-600" />
                                        <div>
                                            <div className="text-xs font-black text-green-800">{t('menuOrderSent')}</div>
                                            <div className="text-[11px] text-green-600">{t('menuWaitForQueue')}</div>
                                        </div>
                                    </div>
                                    <button onClick={handleCancelOrder} disabled={submitting} className="flex min-h-11 items-center gap-1 rounded-xl border border-red-200 bg-white px-3 text-[11px] font-bold text-red-600 shadow-sm hover:bg-red-50">
                                        <Trash2 size={12} /> {t('menuCancel')}
                                    </button>
                                </div>
                            )
                        ) : (
                            <>
                                <button type="button" onClick={() => setIsCartOpen(!isCartOpen)} className="flex min-h-14 flex-1 cursor-pointer flex-col justify-center text-left lg:cursor-default">
                                    <div className="flex items-center gap-1 text-gray-600 text-[11px] font-bold uppercase tracking-wider"><span>{t('menuTotalLabel')}</span><span className="lg:hidden">{isCartOpen ? <ChevronDown size={10}/> : <ChevronUp size={10} className="cart-chevron-nudge"/>}</span></div>
                                    <div className="flex items-baseline gap-1.5"><span className="text-lg font-black text-gray-900 leading-none">{formatPrice(pricing.total, cartCurrency)}</span><span className="text-[11px] font-semibold text-gray-600">/ {totalItems} {t('menuItems')}</span></div>
                                    {pricing.discountTotal > 0 && (
                                        <div className="text-[11px] font-bold text-emerald-700">{t('menuSaved')} {formatPrice(pricing.discountTotal, cartCurrency)}</div>
                                    )}
                                    <div className={`mt-0.5 text-[11px] font-medium ${canSubmitSelection ? 'text-emerald-700' : 'text-amber-700'}`}>{orderGuidance}</div>
                                </button>
                                <button
                                    onClick={handleConfirmOrder}
                                    disabled={submitting || !canSubmitSelection}
                                    className={[
                                        'flex h-12 items-center gap-1.5 rounded-2xl bg-pink-600 px-4 text-xs font-black text-white shadow-lg shadow-pink-200 transition-all hover:bg-pink-700 active:scale-95',
                                        'disabled:scale-100 disabled:bg-gray-300 disabled:text-gray-700 disabled:shadow-none'
                                    ].join(' ')}
                                >
                                    {submitting ? t('menuSending') : (<><span>{isPostOrderMode ? t('menuPostOrderSubmit') : isPreorderMode ? t('menuPreorderSubmit') : canConfirmOrder ? t('menuConfirm') : t('menuWait')}</span><ShoppingBag size={14} strokeWidth={2.5} /></>)}
                                </button>
                            </>
                        )}
                    </div>
                    )}
                </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
};

export default MenuView;
