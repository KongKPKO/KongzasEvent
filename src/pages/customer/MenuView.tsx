import { useEffect, useState, useMemo, Suspense, lazy } from 'react';
import { useOutletContext, useNavigate, useLocation, useParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useArtistRealtime } from '../../hooks/useArtistRealtime';
import { Search, ArrowUpDown, ChevronDown, ChevronUp, CheckCircle, X, Home, Users, Trash2, Ticket, ShoppingBag } from 'lucide-react';
import { getOptimizedImageUrl } from '../../utils/imageUtils';
import ProductSkeleton from '../../components/menu/ProductSkeleton';

const ProductList = lazy(() => import('../../components/menu/ProductList'));
import { formatPrice } from '../../utils/currency';

interface Product {
  id: string;
  name: string;
  price: number;
  image_url: string;
  description?: string;
  category?: string;
  status?: 'enable' | 'disable' | 'soldout';
  currency?: string;  // ✅ NEW: Currency code
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
  
  // UI States
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Filter & Sort State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
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

  // --- 1. Derived Data ---
  const uniqueCategories = useMemo(() => {
      const cats = products.map(p => p.category || 'Other').filter(Boolean);
      return ['All', ...Array.from(new Set(cats)).sort()];
  }, [products]);

  const filteredProducts = useMemo(() => {
      return products.filter(product => {
         const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase());
         const matchesCategory = selectedCategory === 'All' || (product.category || 'Other') === selectedCategory;
         const isVisible = product.status !== 'disable';
         return matchesSearch && matchesCategory && isVisible;
      }).sort((a, b) => {
         if (sortOption === 'name_asc') return a.name.localeCompare(b.name);
         if (sortOption === 'price_asc') return a.price - b.price;
         if (sortOption === 'price_desc') return b.price - a.price;
         return 0;
      });
  }, [products, searchQuery, selectedCategory, sortOption]);

  const totalItems = useMemo(() => Object.values(cart).reduce((sum, qty) => sum + qty, 0), [cart]);
  const totalPrice = useMemo(() => products.reduce((sum, p) => sum + (p.price * (cart[p.id] || 0)), 0), [products, cart]);
  
  // ✅ NEW: Get currency from first cart item for totals display
  const cartCurrency = useMemo(() => {
    const firstProductId = Object.keys(cart).find(id => cart[id] > 0);
    const firstProduct = firstProductId ? products.find(p => p.id === firstProductId) : null;
    return firstProduct?.currency;
  }, [cart, products]);

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
                console.log("Customer is Queue:", queueData.queue_number);
            } else {
               setUserQueueNumber(null);
            }
        }

        // 2.2 ดึงสินค้า
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .eq('artist_id', displayArtist.id)
            .order('created_at', { ascending: false });

        if (!error && data) {
            setProducts(data);
            setProductsLoaded(true);
        }
        setLoading(false);
    };

    if (displayArtist?.id) {
       initData();
       
       const channel = supabase
         .channel(`menu-realtime-${displayArtist.id}`)
         .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `artist_id=eq.${displayArtist.id}` }, (payload) => {
               if (payload.eventType === 'INSERT') setProducts(prev => [payload.new as Product, ...prev]);
               if (payload.eventType === 'UPDATE') setProducts(prev => prev.map(p => p.id === payload.new.id ? payload.new as Product : p));
               if (payload.eventType === 'DELETE') setProducts(prev => prev.filter(p => p.id !== payload.old.id));
            }
         ).subscribe();
         
       return () => { supabase.removeChannel(channel); };
    }
  }, [displayArtist?.id]);

  // ✅ NEW: Realtime Cart Cleanup - Remove sold out/disabled items automatically
  useEffect(() => {
    if (loading || !productsLoaded) return;
    if (Object.keys(cart).length === 0) return;

    const itemsToRemove = Object.keys(cart).filter(id => {
        const product = products.find(p => p.id === id);
        // Remove if product not found (deleted) or status is not 'enable'
        return !product || product.status !== 'enable';
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
        
        const removedNames = itemsToRemove.map(id => products.find(p => p.id === id)?.name || cartItemNames[id] || 'Unknown Item');
        alert(`The following items in your cart are no longer available and have been removed:\n- ${removedNames.join('\n- ')}`);
    }
  }, [cart, cartItemNames, loading, products, productsLoaded]); // Run whenever products list updates (via realtime)

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
      const next = Math.max(0, current + delta);
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

    if (!confirm(`Confirm order for ${totalItems} items (${formatPrice(totalPrice, cartCurrency)})?`)) return;

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
        // Allow only active queues
        if (!['waiting', 'calling', 'serving', 'in_progress'].includes(queueData.status)) {
             // If completed/cancelled, force clear and redirect
             localStorage.removeItem(`ticket_id_${displayArtist?.id}`);
             alert(`Your queue ticket is ${queueData.status} (expired/completed).\nPlease get a new ticket.`);
             navigate(`/${displayArtist?.slug || slug}/queue`);
             return;
        }

        // 3. Validate Shop/Event Status
        const now = new Date().toISOString();
        const { data: events } = await supabase
            .from('events')
            .select('id')
            .eq('artist_id', displayArtist.id)
            .eq('status', 'Confirmed')
            .gte('end_date', now)
            .order('start_date', { ascending: false })
            .limit(1);

        const event = events?.[0];
        if (!event) throw new Error("Shop is currently closed (No Active Event).");

        // 4. Validate Products (Race Condition Check)
        // Fetch latest status of items in cart
        const cartItemIds = Object.keys(cart);
        const { data: latestProducts } = await supabase
            .from('products')
            .select('id, status, price, name')
            .in('id', cartItemIds);
            
        const validCartItems: Record<string, number> = {};
        const invalidItemNames: string[] = [];
        let newTotalPrice = 0;

        cartItemIds.forEach(id => {
            const product = latestProducts?.find(p => p.id === id);
            if (product && product.status === 'enable') {
                validCartItems[id] = cart[id];
                newTotalPrice += product.price * cart[id];
            } else {
                invalidItemNames.push(product?.name || cartItemNames[id] || 'Unknown Item');
            }
        });

        // If ALL items are invalid
        if (Object.keys(validCartItems).length === 0) {
            clearCart(); // Clear cart as they are all sold out
            throw new Error(`All items in your cart are now Sold Out:\n- ${invalidItemNames.join('\n- ')}`);
        }

        // 5. Create Order (with valid items only)
        const { data: order, error: orderError } = await supabase.from('orders').insert({
            event_id: event.id,
            queue_id: localQueueId,
            status: 'confirmed',
            total_price: newTotalPrice, // Use recalculated price
            currency: cartCurrency || 'THB',
            payment_method: null
        }).select().single();

        if (orderError) throw orderError;

        // 6. Create Items
        const itemsToInsert = Object.entries(validCartItems).map(([productId, qty]) => {
            const product = latestProducts?.find(p => p.id === productId); 
            return {
                order_id: order.id,
                product_id: productId,
                quantity: qty,
                price_per_unit: product?.price || 0,
                notes: '' 
            };
        });

        await supabase.from('order_items').insert(itemsToInsert);
        
        // Notify if some items were removed
        if (invalidItemNames.length > 0) {
            alert(`✅ Order placed successfully!\n\n⚠️ However, the following items were sold out and removed from your order:\n- ${invalidItemNames.join('\n- ')}`);
            // Update cart to match what was actually ordered (or clear it? Usually clear it creates empty cart)
            // But strict logic says "clear ordered items". 
            // Since we ordered validItems, we should clear everything.
            // The invalid items are also effectively "dealt with" (user notified).
            clearCart();
        } else {
            // Normal success (all items ordered)
            setIsCartOpen(false);
            // We don't need alert here if we just change UI state to 'Order Sent'
            // But maybe a small toast? The UI changes to "ORDER SENT" so that's enough feedback.
        }

        setSentOrderId(order.id);
        setIsOrderSent(true);
        setIsCartOpen(false);

        // Also clean invalid items from cart state if we didn't clear all
        if (invalidItemNames.length > 0) {
             clearCart();
        }

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
          const { error } = await supabase.from('orders').delete().eq('id', sentOrderId);
          if (error) throw error;
          
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

  // ✅ NEW: Realtime listener for order completion
  useEffect(() => {
      if (!sentOrderId) return;

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
          .subscribe();

      return () => { supabase.removeChannel(channel); };
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
                 if (['complete', 'missed', 'expired'].includes(newStatus)) {
                    setUserQueueNumber(null); // Clear badge
                 } else if (payload.new?.queue_number) {
                    setUserQueueNumber(payload.new.queue_number);
                 }
             }
         )
         .subscribe();

      return () => { supabase.removeChannel(channel); };
  }, [displayArtist?.id]);

  // Helper to reset order state - Clear all localStorage and state
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
      <div className="fixed top-0 z-40 bg-white/95 backdrop-blur-md shadow-sm border-b border-gray-200 w-full max-w-md">
         
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
            <div className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-bold shadow-sm ${userQueueNumber ? 'bg-pink-50 border-pink-200 text-pink-600' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>
               <Ticket size={14} />
               <span>{userQueueNumber ? `Q #${userQueueNumber}` : 'Queue Number'}</span>
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

            {/* Categories */}
            <div className="px-3 pb-2 pt-0.5 flex gap-1.5 overflow-x-auto no-scrollbar">
                {uniqueCategories.map(cat => (
                    <button key={cat} onClick={() => setSelectedCategory(cat)} className={`px-2.5 py-1 rounded-full text-[10px] font-bold whitespace-nowrap transition-all ${selectedCategory === cat ? 'bg-pink-500 text-white shadow-sm' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>{cat}</button>
                ))}
            </div>
       </div>

       {/* --- MENU GRID (LAZY LOADED) --- */}
       <Suspense fallback={<ProductSkeleton />}>
          <ProductList 
              products={filteredProducts}
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
                                    return (
                                        <div key={id} className="flex items-center justify-between bg-gray-50 p-2 rounded-lg border border-gray-100">
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <div className="w-8 h-8 rounded-md bg-gray-200 bg-cover bg-center shrink-0" style={{backgroundImage: `url(${getProductImageUrl(product.image_url, 100)})`}}></div>
                                                <div className="min-w-0"><div className="font-bold text-xs text-gray-800 truncate">{product.name}</div><div className="text-[10px] text-gray-500">{formatPrice(product.price, product.currency)} / unit</div></div>
                                            </div>
                                            <div className="font-bold text-xs w-10 text-right text-pink-600">x {qty}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    <div className="p-2 px-3 flex items-center gap-3 bg-white/95 backdrop-blur-sm h-14">
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
                                    <div className="flex items-baseline gap-1.5"><span className="text-lg font-black text-gray-900 leading-none">{formatPrice(totalPrice, cartCurrency)}</span><span className="text-[10px] font-medium text-gray-400">/ {totalItems} items</span></div>
                                </div>
                                <button onClick={handleConfirmOrder} disabled={submitting} className="bg-pink-600 hover:bg-pink-700 text-white px-4 py-2 rounded-lg font-bold text-xs shadow-lg shadow-pink-200 active:scale-95 transition-all disabled:opacity-70 disabled:scale-100 flex items-center gap-1.5 h-10">{submitting ? 'Sending...' : (<><span>Confirm</span><ShoppingBag size={14} strokeWidth={2.5} /></>)}</button>
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
            </div>
        </div>
    </div>
  );
};

export default MenuView;

