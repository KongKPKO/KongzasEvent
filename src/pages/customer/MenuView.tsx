import { useEffect, useState, useMemo } from 'react';
import { useOutletContext, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useArtistRealtime } from '../../hooks/useArtistRealtime';
import { ShoppingBag, Plus, Minus, Search, ArrowUpDown, ChevronDown, ChevronUp, CheckCircle, X, Home, Users, Trash2, Ticket } from 'lucide-react'; // เพิ่ม icon Ticket
import { getOptimizedImageUrl } from '../../utils/imageUtils';

interface Product {
  id: string;
  name: string;
  price: number;
  image_url: string;
  description?: string;
  category?: string;
  status?: 'enable' | 'disable' | 'soldout';
}

const MenuView = () => {
  const { artist: contextArtist } = useOutletContext<{ artist: any }>();
  const { artist, isConnected } = useArtistRealtime({ 
    artistId: contextArtist?.id 
  });
  
  const displayArtist = artist || contextArtist;
  const navigate = useNavigate();
  const location = useLocation();
  
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [userQueueNumber, setUserQueueNumber] = useState<string | null>(null); // ✅ เก็บเลขคิวของลูกค้า
  
  // UI States
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Filter & Sort State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [sortOption, setSortOption] = useState('name_asc');

  // Order Submission State
  const [submitting, setSubmitting] = useState(false);
  const [isOrderSent, setIsOrderSent] = useState(false);
  const [sentOrderId, setSentOrderId] = useState<string | null>(null);
  const [isOrderCompleted, setIsOrderCompleted] = useState(false);  // ✅ NEW: Track order completion

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

  // --- 2. Fetch Data ---
  useEffect(() => {
    const initData = async () => {
        setLoading(true);
        
        // 2.1 ✅ ตรวจสอบคิวของลูกค้าจาก LocalStorage
        const localQueueId = localStorage.getItem('myQueueId');
        if (localQueueId) {
            const { data: queueData } = await supabase
                .from('queues')
                .select('queue_number')
                .eq('id', localQueueId)
                .single();
            
            if (queueData) {
                setUserQueueNumber(queueData.queue_number);
                console.log("Customer is Queue:", queueData.queue_number);
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

  const updateQuantity = (productId: string, delta: number) => {
    if (isOrderSent) return;
    setCart(prev => {
      const current = prev[productId] || 0;
      const next = Math.max(0, current + delta);
      const newCart = { ...prev, [productId]: next };
      if (next === 0) delete newCart[productId];
      return newCart;
    });
  };

  // --- 4. Confirm Order Logic ---
const handleConfirmOrder = async () => {
    if (totalItems === 0) return;

    // ✅ FIX 1: เช็คก่อนเลยว่ามีคิวไหม? ถ้าไม่มี ไล่ไปหน้า Queue ทันที
    const localQueueId = localStorage.getItem('myQueueId');
    if (!localQueueId) {
        alert("Please get a queue ticket first!\nกรุณากดรับบัตรคิวที่เมนู 'Queue' ด้านล่างก่อนสั่งอาหารครับ");
        navigate(`/${displayArtist?.slug}/queue`); // ดีดไปหน้า Queue
        return; // จบการทำงาน ไม่ให้สั่ง
    }

    if (!confirm(`Confirm order for ${totalItems} items (฿${totalPrice.toLocaleString()})?`)) return;

    setSubmitting(true);
    try {
        // 1. ✅ FIX: Match Admin Panel logic - filter by artist_id, end_date >= now, descending sort
        const now = new Date().toISOString();
        const { data: events } = await supabase
            .from('events')
            .select('id')
            .eq('artist_id', displayArtist.id)  // ✅ Must be this artist's event
            .eq('status', 'Confirmed')
            .gte('end_date', now)  // ✅ Must not be ended
            .order('start_date', { ascending: false })  // ✅ Get LATEST started event
            .limit(1);

        const event = events?.[0];
        if (!event) throw new Error("Shop is currently closed (No Active Event).");

        // 2. เช็คสถานะคิว (เหมือนเดิม แต่ตอนนี้มั่นใจแล้วว่า localQueueId มีค่าแน่นอน)
        const { data: queueData } = await supabase
            .from('queues')
            .select('status')
            .eq('id', localQueueId)
            .single();

        if (queueData && ['cancelled', 'missed', 'expired'].includes(queueData.status)) {
            throw new Error(`Your queue is ${queueData.status}. Please get a new ticket.`);
        }

        // 3. Create Order
        const { data: order, error: orderError } = await supabase.from('orders').insert({
            event_id: event.id,
            queue_id: localQueueId, // ✅ ใส่ ID คิวไปเลย (ไม่ต้อง || null แล้ว เพราะดักไว้ข้างบนแล้ว)
            status: 'confirmed',
            total_price: totalPrice,
            payment_method: null
        }).select().single();

        if (orderError) throw orderError;

        // 4. Create Items (เหมือนเดิม)
        const itemsToInsert = Object.entries(cart).map(([productId, qty]) => {
            const product = products.find(p => p.id === productId);
            return {
                order_id: order.id,
                product_id: productId,
                quantity: qty,
                price_per_unit: product?.price || 0,
                notes: '' 
            };
        });

        await supabase.from('order_items').insert(itemsToInsert);

        setSentOrderId(order.id);
        setIsOrderSent(true);
        setIsCartOpen(false);

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
          setIsOrderSent(false);
          setSentOrderId(null);
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

  // Helper to reset order state
  const handleCloseCompletedOrder = () => {
      setCart({});
      setIsOrderSent(false);
      setSentOrderId(null);
      setIsOrderCompleted(false);
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
         
         {/* Row 1: Shop Name & Queue Badge (จัดกึ่งกลาง) */}
         <div className="flex items-center justify-center px-4 py-3 border-b border-gray-100/50 bg-white gap-3 relative">
            
            {/* Center: Logo & Name */}
            <div className="flex items-center">
                  {displayArtist?.image_url && (
                     <img 
                        src={displayArtist.image_url} 
                        alt="Logo" 
                        className="w-9 h-9 rounded-full mr-3 object-cover shadow-sm border border-gray-100"
                     />
                  )}
                  <h1 className="text-xl font-black text-pink-500 tracking-tight whitespace-nowrap">
                     {displayArtist?.display_name || 'Menu'}
                  </h1>
            </div>
        
        {/* Right Side: Queue Badge (Position Absolute ขวาบน) */}
        <div className={`absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-bold shadow-sm ${userQueueNumber ? 'bg-pink-50 border-pink-200 text-pink-600' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>
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

       {/* --- MENU GRID --- */}
       <div className="pt-[115px] px-3 grid grid-cols-2 gap-2 pb-44 overflow-y-auto">
          {filteredProducts.map(product => {
            const qty = cart[product.id] || 0;
            return (
               <div key={product.id} className={`bg-white rounded-xl shadow-sm overflow-hidden flex flex-col h-full border border-gray-100 transition-all ${qty > 0 ? 'ring-2 ring-pink-500' : ''}`}>
                  <div className="aspect-square bg-gray-100 relative w-full overflow-hidden">
                     {product.image_url ? (
                        <img src={getProductImageUrl(product.image_url, 400)} alt={product.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/400x400?text=No+Img'; }} />
                     ) : (<div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">No Img</div>)}
                     {product.status === 'soldout' && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10"><span className="text-white font-bold border-2 px-2 py-1 rotate-[-12deg] text-xs">SOLD OUT</span></div>
                     )}
                  </div>
                  <div className="p-2.5 flex flex-col flex-1 justify-between">
                     <div className="mb-2">
                        <h3 className="font-bold text-gray-900 text-xs leading-tight line-clamp-2">{product.name}</h3>
                        {product.description && <p className="text-[10px] text-gray-400 line-clamp-1 mt-0.5">{product.description}</p>}
                     </div>
                     <div className="flex flex-col gap-1.5">
                        <div className="text-pink-600 font-extrabold text-sm">฿{product.price}</div>
                        {qty === 0 ? (
                           <button onClick={() => product.status !== 'soldout' && updateQuantity(product.id, 1)} disabled={product.status === 'soldout' || isOrderSent} className={`w-full rounded-md py-1 flex items-center justify-center gap-1 text-[10px] font-bold transition-all ${product.status === 'soldout' || isOrderSent ? 'bg-gray-100 text-gray-400' : 'bg-gray-900 text-white active:scale-95'}`}><ShoppingBag size={10} /> ADD</button>
                        ) : (
                           <div className="flex items-center justify-between bg-pink-50 rounded-md p-0.5 border border-pink-100">
                              <button onClick={() => updateQuantity(product.id, -1)} className="w-6 h-6 rounded bg-white text-pink-600 flex items-center justify-center shadow-sm"><Minus size={12} /></button>
                              <span className="font-bold text-xs">{qty}</span>
                              <button onClick={() => updateQuantity(product.id, 1)} className="w-6 h-6 rounded bg-pink-500 text-white flex items-center justify-center shadow-md"><Plus size={12} /></button>
                           </div>
                        )}
                     </div>
                  </div>
               </div>
            );
          })}
          <div className="col-span-2 h-10 text-center text-[10px] text-gray-300 pt-4">End of Menu</div>
       </div>

        {/* --- CONFIRM ORDER BAR --- */}
        {totalItems > 0 && (
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
                                                <div className="min-w-0"><div className="font-bold text-xs text-gray-800 truncate">{product.name}</div><div className="text-[10px] text-gray-500">฿{product.price} / unit</div></div>
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
                                    <div className="flex items-baseline gap-1.5"><span className="text-lg font-black text-gray-900 leading-none">฿{totalPrice.toLocaleString()}</span><span className="text-[10px] font-medium text-gray-400">/ {totalItems} items</span></div>
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

