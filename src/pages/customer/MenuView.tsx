import { useEffect, useState, useMemo, Suspense, lazy } from 'react';
import { useOutletContext, useNavigate, useLocation, useParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useArtistRealtime } from '../../hooks/useArtistRealtime';
import { Search, ArrowUpDown, ChevronDown, ChevronUp, CheckCircle, X, Home, Users, Trash2, Ticket, ShoppingBag, Sparkles, Compass } from 'lucide-react';
import { getOptimizedImageUrl } from '../../utils/imageUtils';
import ProductSkeleton from '../../components/menu/ProductSkeleton';

const ProductList = lazy(() => import('../../components/menu/ProductList'));
import { formatPrice } from '../../utils/currency';
import { calculatePromotionPricing, getPromotionBadgesForProduct, type PromotionRule } from '../../utils/promotionPricing';

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

const MenuView = () => {
  const { artist: contextArtist } = useOutletContext<{ artist: any }>();
  const { artist, isConnected } = useArtistRealtime({ 
    artistId: contextArtist?.id 
  });
  
  const displayArtist = artist || contextArtist;
  const navigate = useNavigate();
  const location = useLocation();
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
  const [sentOrderId, setSentOrderId] = useState<string | null>(() => {
    return localStorage.getItem(`sentOrderId_${contextArtist?.id}`) || null;
  });
  const [isOrderCompleted, setIsOrderCompleted] = useState<boolean>(() => {
    return localStorage.getItem(`orderCompleted_${contextArtist?.id}`) === 'true';
  });

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

  const fetchPromotions = async (artistId: string) => {
    const { data, error } = await supabase
      .from('artist_promotions')
      .select('id, artist_id, name, target_type, rule_type, match_category, match_tag, match_product_id, match_product_ids, buy_quantity, reward_value, reward_quantity, priority, status')
      .eq('artist_id', artistId)
      .eq('status', 'active')
      .order('priority', { ascending: false });

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
        const localQueueId = localStorage.getItem(`ticket_id_${displayArtist.id}`);
        if (localQueueId) {
            const { data: queueData } = await supabase
                .from('queues')
                .select('queue_number, status')
                .eq('id', localQueueId)
                .single();
            
            // Only show queue number if status is active
            if (queueData && ['waiting', 'calling', 'serving'].includes(queueData.status)) {
                setUserQueueNumber(queueData.queue_number);
                setUserQueueStatus(queueData.status);
                console.log("Customer is Queue:", queueData.queue_number);
            } else {
               setUserQueueNumber(null);
               setUserQueueStatus(queueData?.status || null);
            }
        }

        // 2.2 ดึงสินค้า
        const { data, error } = await supabase
            .from('products')
            .select('id, name, price, image_url, description, category, tags, status, currency, stock_total, stock_reserved, stock_sold, is_unlimited')
            .eq('artist_id', displayArtist.id)
            .order('created_at', { ascending: false });

        if (!error && data) {
            setProducts(data);
            setProductsLoaded(true);
        }

        await fetchPromotions(displayArtist.id);
        setLoading(false);
    };

    if (displayArtist?.id) {
       initData();
       
       const productChannel = supabase
         .channel(`menu-realtime-${displayArtist.id}`)
         .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `artist_id=eq.${displayArtist.id}` }, (payload) => {
               if (payload.eventType === 'INSERT') setProducts(prev => [payload.new as Product, ...prev]);
               if (payload.eventType === 'UPDATE') setProducts(prev => prev.map(p => p.id === payload.new.id ? payload.new as Product : p));
               if (payload.eventType === 'DELETE') setProducts(prev => prev.filter(p => p.id !== payload.old.id));
            }
         ).subscribe();

       const promotionChannel = supabase
         .channel(`menu-promotions-${displayArtist.id}`)
         .on('postgres_changes', { event: '*', schema: 'public', table: 'artist_promotions', filter: `artist_id=eq.${displayArtist.id}` }, () => {
            fetchPromotions(displayArtist.id);
         })
         .subscribe();
         
       return () => {
         supabase.removeChannel(productChannel);
         supabase.removeChannel(promotionChannel);
       };
    }
  }, [displayArtist?.id]);

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
        
        const removedNames = itemsToRemove.map(id => productById.get(id)?.name || cartItemNames[id] || 'Unknown Item');
        alert(`The following items in your cart are no longer available and have been removed:\n- ${removedNames.join('\n- ')}`);
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

    // 1. Check Local Queue ID presence
    const localQueueId = localStorage.getItem(`ticket_id_${displayArtist?.id}`);
    if (!localQueueId) {
        alert("Please get a queue ticket first!\nกรุณารับบัตรคิวก่อนกด Confirm รายการ.");
        navigate(`/${displayArtist?.slug || slug}/queue`); 
        return; 
    }

    if (!canConfirmOrder) {
        alert('You can confirm when your queue is called.');
        return;
    }

    if (!confirm(`Confirm order for ${totalItems} items (${formatPrice(pricing.total, cartCurrency)})?`)) return;

    setSubmitting(true);
    try {
        // 2. Validate Queue Status (Server Check - Strict)
        const { data: queueData, error: queueError } = await supabase
            .from('queues')
            .select('status')
            .eq('id', localQueueId)
            .single();

        if (queueError || !queueData) {
             throw new Error("Queue ticket not found. Please queue again.");
        }
        // Allow only calling / serving queues to confirm cart
        if (!['calling', 'serving'].includes(queueData.status)) {
             if (['complete', 'missed', 'expired'].includes(queueData.status)) {
                 localStorage.removeItem(`ticket_id_${displayArtist?.id}`);
                 alert(`Your queue ticket is ${queueData.status} (expired/completed).\nPlease get a new ticket.`);
                 navigate(`/${displayArtist?.slug || slug}/queue`);
                 return;
             }

             setUserQueueStatus(queueData.status);
             alert('You can confirm when your queue is called.');
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

    } catch (err: any) {
        alert('Failed: ' + err.message);
        console.error(err);
    } finally {
        setSubmitting(false);
    }
  };

  const handleCancelOrder = async () => {
      if (!sentOrderId) return;
      if (!confirm("Are you sure you want to cancel this order?")) return;

      setSubmitting(true);
      try {
          const { data: cancelled, error } = await supabase.rpc('cancel_customer_order_with_stock_release', {
            p_order_id: sentOrderId
          });
          if (error) throw error;
          if (cancelled === false) throw new Error('Order cannot be cancelled anymore.');
          
          // Reset all states
          clearCart();
          setIsOrderSent(false);
          setSentOrderId(null);
          setIsOrderCompleted(false);
          
          // Clear localStorage
          if (contextArtist?.id) {
            localStorage.removeItem(`cart_${contextArtist.id}`);
            localStorage.removeItem(`orderSent_${contextArtist.id}`);
            localStorage.removeItem(`sentOrderId_${contextArtist.id}`);
            localStorage.removeItem(`orderCompleted_${contextArtist.id}`);
          }
      } catch (err: any) {
          alert('Failed to cancel: ' + err.message);
      } finally {
          setSubmitting(false);
      }
  };

  // Keep completion status in sync even when realtime events are missed.
  useEffect(() => {
      if (!sentOrderId) return;

      let isMounted = true;

      const syncCompletionStatus = async () => {
          const { data, error } = await supabase
              .from('orders')
              .select('status')
              .eq('id', sentOrderId)
              .maybeSingle();

          if (!isMounted || error || !data) return;
          if (data.status === 'completed') {
              setIsOrderCompleted(true);
          }
      };

      void syncCompletionStatus();
      const pollId = window.setInterval(() => { void syncCompletionStatus(); }, 5000);

      const channel = supabase
          .channel(`order-status-${sentOrderId}`)
          .on('postgres_changes', 
              { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${sentOrderId}` }, 
              (payload: any) => {
                  console.log('[Menu] Order update received:', payload.new?.status);
                  if (payload.new?.status === 'completed') {
                      setIsOrderCompleted(true);
                  }
              }
          )
          .subscribe((status) => {
              if (status === 'SUBSCRIBED') {
                  void syncCompletionStatus();
              }
          });

      return () => {
          isMounted = false;
          window.clearInterval(pollId);
          supabase.removeChannel(channel);
      };
  }, [sentOrderId]);

  // ✅ NEW: Realtime listener for Queue Status (To clear badge when completed)
  useEffect(() => {
     const localQueueId = localStorage.getItem(`ticket_id_${displayArtist?.id}`);
     if (!localQueueId || !displayArtist?.id) return;

     const channel = supabase
         .channel(`menu-queue-status-${localQueueId}`)
         .on('postgres_changes', 
             { event: 'UPDATE', schema: 'public', table: 'queues', filter: `id=eq.${localQueueId}` }, 
             (payload: any) => {
                 const newStatus = payload.new?.status;
                 if (newStatus === 'complete' && isOrderSent) {
                    setIsOrderCompleted(true);
                 }
                 setUserQueueStatus(newStatus || null);
                 if (['complete', 'missed', 'expired'].includes(newStatus)) {
                    setUserQueueNumber(null); // Clear badge
                 } else if (payload.new?.queue_number) {
                    setUserQueueNumber(payload.new.queue_number);
                 }
             }
         )
         .subscribe();

      return () => { supabase.removeChannel(channel); };
  }, [displayArtist?.id, isOrderSent]);

  // Helper to reset order state - Clear all localStorage and state
  const canConfirmOrder = userQueueStatus === 'calling' || userQueueStatus === 'serving';
  const queueGuidance = canConfirmOrder
    ? 'You can confirm now. Send your selected items before staying at booth.'
    : userQueueNumber
      ? 'You can select now. Confirm unlocks when your queue is called.'
      : 'You can select now. Get a queue number before confirming.';

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
      
      // Clear localStorage
      if (contextArtist?.id) {
        localStorage.removeItem(`cart_${contextArtist.id}`);
        localStorage.removeItem(`orderSent_${contextArtist.id}`);
        localStorage.removeItem(`sentOrderId_${contextArtist.id}`);
        localStorage.removeItem(`orderCompleted_${contextArtist.id}`);
      }
  };

  if (loading) return <div className="p-8 text-center text-gray-400">Loading menu...</div>;

  return (
    <div className="min-h-screen bg-gray-50 relative max-w-md mx-auto shadow-2xl overflow-hidden border-x border-gray-100">
       
       {!isConnected && (
         <div className="bg-red-500 text-white text-[10px] uppercase font-bold text-center py-1 tracking-widest fixed top-0 left-0 right-0 z-[60] max-w-md mx-auto">
            Offline - Reconnecting...
         </div>
       )}

      {/* --- 🌟 1. FIXED HEADER AREA (Fix Layout Overflow) --- */}
      <div className="sticky top-0 z-40 bg-white/95 backdrop-blur-md shadow-sm border-b border-gray-200 w-full max-w-md">
         
         {/* Row 1: Shop Name & Queue Badge (Left Aligned with standard Flexbox) */}
         <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100/50 bg-white gap-3">
            
            {/* Left: Avatar & Name */}
            <div className="flex items-center flex-1 min-w-0 mr-2">
                  {displayArtist?.image_url && (
                     <img 
                        src={displayArtist.image_url} 
                        alt="Logo" 
                        className="w-10 h-10 rounded-full shrink-0 mr-3 object-cover shadow-sm border border-gray-100"
                     />
                  )}
                  <h1 className="text-xl font-black text-pink-500 tracking-tight truncate">
                     {displayArtist?.display_name || 'Menu'}
                  </h1>
            </div>
        
            {/* Right Side: Queue Badge */}
            <div className="shrink-0 flex flex-col items-end gap-1">
               <div className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-bold shadow-sm ${userQueueNumber ? 'bg-pink-50 border-pink-200 text-pink-600' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>
                  <Ticket size={14} />
                  <span>{userQueueNumber ? `Q #${userQueueNumber}` : 'Queue Number'}</span>
               </div>
               <div className={`max-w-[200px] text-right px-2 py-1 rounded-full text-[9px] font-bold leading-tight ${canConfirmOrder ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                  {queueGuidance}
               </div>
            </div>
         </div>

            {/* Search & Sort */}
            <div className="px-3 py-1.5 flex gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                    <input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pink-500 transition-all text-xs" />
                </div>
                <div className="relative min-w-[50px]">
                    <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none"><ArrowUpDown className="text-gray-400" size={12} /></div>
                    <select value={sortOption} onChange={(e) => setSortOption(e.target.value)} className="w-full pl-7 pr-5 py-1.5 appearance-none rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-pink-500 text-[10px] h-full font-bold uppercase text-gray-600">
                        <option value="name_asc">Name</option>
                        <option value="price_asc">Price: Low</option>
                        <option value="price_desc">Price: High</option>
                    </select>
                </div>
            </div>

            <div className="px-3 pb-2 flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="px-2 py-1 rounded-full bg-gray-100 text-[10px] font-bold text-gray-600">
                        {filteredProducts.length} items
                    </span>
                    {promoProductCount > 0 && (
                        <span className="px-2 py-1 rounded-full bg-rose-50 text-[10px] font-bold text-rose-700 border border-rose-100">
                            {promoProductCount} on promo
                        </span>
                    )}
                </div>
                {hasActiveFilters && (
                    <button
                        onClick={clearFilters}
                        className="text-[10px] font-bold text-pink-600 border border-pink-200 bg-pink-50 rounded-full px-2.5 py-1"
                    >
                        Clear filters
                    </button>
                )}
            </div>

            {/* Categories */}
            <div className="px-3 pb-2 pt-0.5 flex items-center gap-1.5">
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar flex-1">
                    {quickCategoryChips.map(cat => (
                        <button key={cat} onClick={() => setSelectedCategory(cat)} className={`px-2.5 py-1 rounded-full text-[10px] font-bold whitespace-nowrap transition-all ${selectedCategory === cat ? 'bg-pink-500 text-white shadow-sm' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>{cat}</button>
                    ))}
                </div>
                {hasMoreCategories && (
                    <div className="relative min-w-[130px] shrink-0">
                        <select
                            value={quickCategoryChips.includes(selectedCategory) ? 'More' : selectedCategory}
                            onChange={(e) => {
                                const nextValue = e.target.value;
                                if (nextValue !== 'More') setSelectedCategory(nextValue);
                            }}
                            className="w-full appearance-none rounded-full border border-gray-200 bg-white px-3 py-1.5 pr-7 text-[10px] font-bold text-gray-600 focus:outline-none focus:ring-2 focus:ring-pink-500"
                            aria-label="More categories"
                        >
                            <option value="More" disabled>More</option>
                            {uniqueCategories.filter((cat) => !quickCategoryChips.includes(cat)).map((cat) => (
                                <option key={cat} value={cat}>{cat}</option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={12} />
                    </div>
                )}
            </div>

            {uniqueTags.length > 1 && (
                <div className="px-3 pb-2 pt-0">
                    <div className="relative">
                        <select
                            value={selectedTag}
                            onChange={(e) => setSelectedTag(e.target.value)}
                            className="w-full appearance-none rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 pr-8 text-[11px] font-bold text-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
                            aria-label="Filter products by tag"
                        >
                            {uniqueTags.map(tag => (
                                <option key={tag} value={tag}>{tag === 'All' ? 'All tags' : tag}</option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-sky-400 pointer-events-none" size={14} />
                    </div>
                </div>
            )}

            {hasActiveFilters && (
                <div className="px-3 pb-2 flex flex-wrap gap-1.5">
                    {selectedCategory !== 'All' && (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-pink-50 text-pink-600 border border-pink-100">
                            Category: {selectedCategory}
                        </span>
                    )}
                    {selectedTag !== 'All' && (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-100">
                            Tag: {selectedTag}
                        </span>
                    )}
                    {searchQuery.trim() && (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600">
                            Search: {searchQuery.trim()}
                        </span>
                    )}
                </div>
            )}
       </div>

       {/* --- MENU GRID (LAZY LOADED) --- */}
       <Suspense fallback={<ProductSkeleton />}>
          <ProductList 
              products={filteredProducts}
              promotions={promotions}
              cart={cart}
              isOrderSent={isOrderSent}
              onUpdateQuantity={updateQuantity}
          />
       </Suspense>

        {/* --- CONFIRM ORDER BAR --- */}
        {(totalItems > 0 || isOrderSent) && (
            <>
                {isCartOpen && !isOrderSent && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80] animate-fade-in max-w-md mx-auto" onClick={() => setIsCartOpen(false)} />
                )}
                <div className={`fixed bottom-[80px] left-0 right-0 z-[90] rounded-t-xl shadow-[0_-4px_20px_rgba(0,0,0,0.1)] w-full max-w-md mx-auto border-t border-pink-100 transition-all duration-300 ${isOrderSent ? 'bg-green-50 border-green-200' : 'bg-white'}`}>
                    {isCartOpen && !isOrderSent && (
                        <div className="max-h-[50vh] overflow-y-auto p-3 border-b border-gray-100 animate-slide-up bg-white rounded-t-xl">
                            <div className="flex justify-between items-center mb-3 sticky top-0 bg-white z-10 pb-2 border-b border-gray-50">
                                <h3 className="font-bold text-gray-800 text-sm">Your Order <span className="text-pink-500 text-xs font-normal">({totalItems} items)</span></h3>
                                <button onClick={() => setIsCartOpen(false)} className="bg-gray-100 p-1 rounded-full text-gray-500 hover:bg-gray-200"><X size={16}/></button>
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
                                                        <div className="text-[10px] text-gray-500">{formatPrice(product.price, product.currency)} / unit</div>
                                                        {lineDiscount > 0 && (
                                                            <div className="mt-0.5 text-[10px] font-bold text-emerald-700">Now {formatPrice(lineTotal, product.currency)} from {formatPrice(lineSubtotal, product.currency)}</div>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <button onClick={() => updateQuantity(id, -1, product.name)} className="w-6 h-6 rounded-md border border-gray-200 bg-white text-gray-600 text-xs font-black" aria-label={`Decrease quantity of ${product.name}`}>-</button>
                                                    <div className="font-bold text-xs min-w-[28px] text-center text-pink-600">x {qty}</div>
                                                    <button onClick={() => updateQuantity(id, 1, product.name)} className="w-6 h-6 rounded-md border border-gray-200 bg-white text-gray-600 text-xs font-black" aria-label={`Increase quantity of ${product.name}`}>+</button>
                                                    <button onClick={() => updateQuantity(id, -qty, product.name)} className="w-6 h-6 rounded-md border border-red-200 bg-white text-red-500 text-[10px] font-black" aria-label={`Remove ${product.name}`}>✕</button>
                                                </div>
                                            </div>
                                            {lineBreakdowns.length > 0 && (
                                                <div className="mt-2 space-y-1">
                                                    {lineBreakdowns.map((entry, entryIndex) => (
                                                        <div key={`${entry.ruleId}-${entryIndex}`} className="rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1">
                                                            <div className="flex items-start justify-between gap-2">
                                                                <div>
                                                                    <div className="text-[10px] font-black text-emerald-800">{entry.label}</div>
                                                                    <div className="text-[10px] text-emerald-700">{entry.freeQuantity > 0 ? `${entry.freeQuantity} item free` : `Discount applied on ${entry.affectedQuantity} item${entry.affectedQuantity > 1 ? 's' : ''}`}</div>
                                                                </div>
                                                                <div className="text-[10px] font-black text-emerald-700">- {formatPrice(entry.discountAmount, product.currency)}</div>
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
                                    <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-emerald-800 mb-2">
                                        <Sparkles size={12} /> Applied promotions
                                    </div>
                                    <div className="space-y-1.5">
                                        {pricing.appliedPromotions.map((promotion) => (
                                            <div key={promotion.ruleId} className="flex items-start justify-between gap-2 rounded-lg bg-white/90 border border-emerald-100 px-2 py-1.5">
                                                <div>
                                                    <div className="text-[11px] font-bold text-gray-800">{promotion.label}</div>
                                                    <div className="text-[10px] text-gray-600">{promotion.message}</div>
                                                </div>
                                                <div className="text-[11px] font-black text-emerald-700">- {formatPrice(promotion.discountAmount, cartCurrency)}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-2.5 space-y-1.5">
                                <div className="flex items-center justify-between text-[11px] text-gray-600">
                                    <span>Subtotal</span>
                                    <span className="font-bold text-gray-800">{formatPrice(pricing.subtotal, cartCurrency)}</span>
                                </div>
                                {pricing.discountTotal > 0 && (
                                    <div className="flex items-center justify-between text-[11px] text-emerald-700">
                                        <span>Discount</span>
                                        <span className="font-black">- {formatPrice(pricing.discountTotal, cartCurrency)}</span>
                                    </div>
                                )}
                                <div className="flex items-center justify-between pt-1 border-t border-gray-200">
                                    <span className="text-xs font-bold text-gray-700">Total</span>
                                    <span className="text-sm font-black text-gray-900">{formatPrice(pricing.total, cartCurrency)}</span>
                                </div>
                            </div>

                            <div className={`mt-3 rounded-lg border px-2.5 py-2 ${canConfirmOrder ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                                <div className={`text-[10px] font-black uppercase tracking-wide ${canConfirmOrder ? 'text-emerald-800' : 'text-amber-800'}`}>
                                    {canConfirmOrder ? 'Ready to confirm' : 'Selection only'}
                                </div>
                                <div className={`mt-1 text-[11px] leading-relaxed ${canConfirmOrder ? 'text-emerald-700' : 'text-amber-700'}`}>
                                    {queueGuidance}
                                </div>
                            </div>
                        </div>
                    )}
                    <div className="p-2 px-3 flex items-center gap-3 bg-white/95 backdrop-blur-sm min-h-14">
                        {isOrderSent ? (
                            isOrderCompleted ? (
                                // ✅ ORDER COMPLETED UI
                                <div className="flex-1 flex items-center justify-between w-full animate-fade-in bg-green-100 px-3 py-2 rounded-lg border border-green-200">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle size={22} className="text-green-600" />
                                        <div>
                                            <div className="text-sm font-black text-green-800">Order Completed!</div>
                                            <div className="text-[10px] text-green-600">Thank you for your purchase.</div>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={handleCloseCompletedOrder} 
                                        className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm hover:bg-green-700 flex items-center gap-1"
                                    >
                                        <X size={14} /> Close
                                    </button>
                                </div>
                            ) : (
                                // ORDER SENT (waiting)
                                <div className="flex-1 flex items-center justify-between w-full animate-fade-in bg-green-50 px-2 py-1 rounded-lg">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle size={20} className="text-green-600" />
                                        <div>
                                            <div className="text-xs font-black text-green-800">ORDER SENT!</div>
                                            <div className="text-[10px] text-green-600">Wait for queue.</div>
                                        </div>
                                    </div>
                                    <button onClick={handleCancelOrder} disabled={submitting} className="bg-white border border-red-200 text-red-500 px-3 py-1.5 rounded-lg text-[10px] font-bold shadow-sm hover:bg-red-50 flex items-center gap-1">
                                        <Trash2 size={12} /> Cancel
                                    </button>
                                </div>
                            )
                        ) : (
                            <>
                                <div onClick={() => setIsCartOpen(!isCartOpen)} className="flex-1 cursor-pointer flex flex-col justify-center">
                                    <div className="flex items-center gap-1 text-gray-400 text-[9px] font-bold uppercase tracking-wider"><span>TOTAL</span>{isCartOpen ? <ChevronDown size={10}/> : <ChevronUp size={10} className="animate-bounce"/>}</div>
                                    <div className="flex items-baseline gap-1.5"><span className="text-lg font-black text-gray-900 leading-none">{formatPrice(pricing.total, cartCurrency)}</span><span className="text-[10px] font-medium text-gray-400">/ {totalItems} items</span></div>
                                    {pricing.discountTotal > 0 && (
                                        <div className="text-[10px] font-bold text-emerald-700">Saved {formatPrice(pricing.discountTotal, cartCurrency)}</div>
                                    )}
                                    <div className={`text-[10px] font-medium mt-0.5 ${canConfirmOrder ? 'text-emerald-700' : 'text-amber-700'}`}>{queueGuidance}</div>
                                </div>
                                <button onClick={handleConfirmOrder} disabled={submitting || !canConfirmOrder} className="bg-pink-600 hover:bg-pink-700 text-white px-4 py-2 rounded-lg font-bold text-xs shadow-lg shadow-pink-200 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 flex items-center gap-1.5 h-10">{submitting ? 'Sending...' : (<><span>{canConfirmOrder ? 'Confirm' : 'Wait'}</span><ShoppingBag size={14} strokeWidth={2.5} /></>)}</button>
                            </>
                        )}
                    </div>
                </div>
            </>
        )}

        {/* BOTTOM NAV */}
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 pb-safe w-full max-w-md mx-auto">
            <div className="flex justify-around items-center h-[60px]">
                <button onClick={() => navigate(`/${displayArtist?.slug || ''}`)} className={`flex flex-col items-center justify-center w-full h-full space-y-0.5 ${location.pathname.endsWith(`/${displayArtist?.slug}`) ? 'text-pink-500' : 'text-gray-400 hover:text-gray-600'}`}><Home size={20} strokeWidth={2.5} /><span className="text-[9px] font-bold">Home</span></button>
                <button className="flex flex-col items-center justify-center w-full h-full space-y-0.5 text-pink-500"><ShoppingBag size={20} strokeWidth={2.5} /><span className="text-[9px] font-bold">Menu</span></button>
                <button onClick={() => navigate(`/${displayArtist?.slug || ''}/queue`)} className="flex flex-col items-center justify-center w-full h-full space-y-0.5 text-gray-400 hover:text-gray-600"><Users size={20} strokeWidth={2.5} /><span className="text-[9px] font-bold">Queue</span></button>
                <button onClick={() => navigate('/discover')} className={`flex flex-col items-center justify-center w-full h-full space-y-0.5 ${location.pathname.startsWith('/discover') ? 'text-pink-500' : 'text-gray-400 hover:text-gray-600'}`}><Compass size={20} strokeWidth={2.5} /><span className="text-[9px] font-bold">Discover</span></button>
            </div>
        </div>
    </div>
  );
};

export default MenuView;
