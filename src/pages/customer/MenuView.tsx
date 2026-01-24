import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useArtistRealtime } from '../../hooks/useArtistRealtime';
// import { Card } from '../../components/ui'; // ❌ ไม่ใช้ Card แล้ว เปลี่ยนเป็น div ธรรมดา
import { ShoppingBag, Plus, Minus, Search, ArrowUpDown, ChevronDown } from 'lucide-react';
import CustomerHeader from '../../components/CustomerHeader';
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
  
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [isExpanded, setIsExpanded] = useState(false);

  // Filter & Sort State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [sortOption, setSortOption] = useState('name_asc');

  // Derived Data
  const uniqueCategories = ['All', ...Array.from(new Set(products.map(p => p.category || 'Other'))).sort()];

  const filteredProducts = products.filter(product => {
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

  useEffect(() => {
    const fetchProducts = async () => {
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
       fetchProducts();
       
       const channel = supabase
         .channel(`menu-realtime-${displayArtist.id}`)
         .on(
            'postgres_changes',
            { 
               event: '*', 
               schema: 'public', 
               table: 'products',
               filter: `artist_id=eq.${displayArtist.id}`
            },
            (payload) => {
               if (payload.eventType === 'INSERT') {
                  setProducts(prev => [payload.new as Product, ...prev]);
               }
               if (payload.eventType === 'UPDATE') {
                  const updatedProduct = payload.new as Product;
                  setProducts(prev => prev.map(p => p.id === updatedProduct.id ? updatedProduct : p));
               }
               if (payload.eventType === 'DELETE') {
                  setProducts(prev => prev.filter(p => p.id !== payload.old.id));
               }
            }
         )
         .subscribe();
         
       return () => {
          supabase.removeChannel(channel);
       };
    }
  }, [displayArtist?.id]);

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
    setCart(prev => {
      const current = prev[productId] || 0;
      const next = Math.max(0, current + delta);
      const newCart = { ...prev, [productId]: next };
      if (next === 0) delete newCart[productId];
      return newCart;
    });
  };

  const totalItems = Object.values(cart).reduce((sum, qty) => sum + qty, 0);
  const totalPrice = products.reduce((sum, p) => sum + (p.price * (cart[p.id] || 0)), 0);

  if (!displayArtist) return <div className="p-8 text-center text-gray-400">Loading...</div>;
  if (loading) return <div className="p-8 text-center text-gray-400">Loading menu...</div>;

  return (
    <div className="min-h-screen bg-gray-50 pb-24 animate-fade-in relative max-w-md mx-auto shadow-xl">
       {!isConnected && (
         <div className="bg-red-500 text-white text-[10px] uppercase font-bold text-center py-1 tracking-widest sticky top-0 z-[60]">
            Offline - Reconnecting...
         </div>
       )}

       {/* Header with Cart Summary */}
       <CustomerHeader 
          artistId={displayArtist.id} 
          title={displayArtist?.display_name || 'Menu'}
          className=""
          avatarUrl={displayArtist.image_url}
          avatarDisplay="inline"
       >
             <div 
                onClick={() => totalItems > 0 && setIsExpanded(!isExpanded)}
                className={`mx-auto max-w-sm bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden transition-all duration-300 mt-2 ${totalItems > 0 ? 'cursor-pointer active:scale-95' : 'opacity-80'}`}
             >
                <div className="flex items-center justify-between px-4 py-6">
                   <div className="flex flex-col text-left">
                      <span className="text-[9px] uppercase font-bold text-gray-400 tracking-wider">Total</span>
                      <span className="text-pink-600 font-black text-lg leading-none">฿{totalPrice.toLocaleString()}</span>
                   </div>
                   <div className="flex items-center gap-2 pl-4 border-l border-gray-100">
                      <span className="font-bold text-gray-800 text-xs">{totalItems} items</span>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white shadow-md transition-colors ${totalItems > 0 ? 'bg-pink-500 shadow-pink-200' : 'bg-gray-300'}`}>
                         <ShoppingBag size={12} strokeWidth={3} />
                      </div>
                   </div>
                </div>

                 {isExpanded && totalItems > 0 && (
                    <div className="px-4 pb-3 pt-0 bg-white animate-fade-in text-left">
                       <div className="h-px w-full bg-gray-100 mb-2"></div>
                       <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                          {Object.entries(cart).map(([id, qty]) => {
                             const product = products.find(p => p.id === id);
                             if (!product || qty === 0) return null;
                             return (
                                <div key={id} className="flex justify-between items-center text-xs">
                                   <span className="text-gray-600 font-medium truncate pr-4">{product.name}</span>
                                   <span className="font-bold text-pink-600 shrink-0">x {qty}</span>
                                </div>
                             );
                          })}
                       </div>
                    </div>
                 )}
             </div>
       </CustomerHeader>

       {/* Filter & Sort Bar */}
       <div className="px-3 md:px-4 py-2 space-y-3 bg-white border-b border-gray-100/50 sticky top-[60px] z-50 shadow-sm backdrop-blur-xl bg-white/90">
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                    <input 
                        type="text"
                        placeholder="Search..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all shadow-sm text-sm"
                    />
                </div>
                <div className="relative min-w-[50px]">
                    <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                        <ArrowUpDown className="text-gray-400" size={14} />
                    </div>
                    <select
                        value={sortOption}
                        onChange={(e) => setSortOption(e.target.value)}
                        className="w-full pl-8 pr-6 py-2 appearance-none rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all shadow-sm font-medium text-xs h-full"
                    >
                        <option value="name_asc">Name</option>
                        <option value="price_asc">Price Low</option>
                        <option value="price_desc">Price High</option>
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={14} />
                </div>
            </div>

            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                {uniqueCategories.map(cat => (
                    <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-3 py-1 rounded-full text-[10px] font-bold whitespace-nowrap transition-all ${
                            selectedCategory === cat 
                            ? 'bg-pink-500 text-white shadow-md shadow-pink-200' 
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                    >
                        {cat}
                    </button>
                ))}
            </div>
       </div>

       {/* Menu Grid */}
       <div className="px-3 mt-2 grid grid-cols-2 gap-2 pb-safe">
          {filteredProducts.map(product => {
            const qty = cart[product.id] || 0;
            return (
               // ✅ FIX: ใช้ div แทน Card และบังคับ h-full แบบตรงไปตรงมา
               <div 
                  key={product.id} 
                  className={`bg-white rounded-xl shadow-sm overflow-hidden flex flex-col h-full border border-gray-100 transition-all duration-300 ${qty > 0 ? 'ring-2 ring-pink-500 ring-offset-1' : ''}`}
               >
                  {/* Image Section */}
                  <div className="aspect-square bg-gray-100 relative w-full overflow-hidden group">
                     {product.image_url ? (
                        <img 
                           src={getProductImageUrl(product.image_url, 400)} 
                           alt={product.name} 
                           loading="lazy"
                           decoding="async"
                           className="w-full h-full object-cover transform transition-transform duration-500 group-hover:scale-105 bg-gray-200"
                           onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/400x400?text=No+Image'; }}
                        />
                     ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300">
                           <span className="material-icons-outlined text-4xl">image</span>
                        </div>
                     )}
                     
                     {/* SOLD OUT OVERLAY */}
                     {product.status === 'soldout' && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-[2px] z-10">
                           <span className="text-white text-opacity-90 font-black text-lg tracking-widest border-4 border-white border-opacity-90 px-4 py-2 rotate-[-12deg] shadow-lg">
                              SOLD OUT
                           </span>
                        </div>
                     )}
                  </div>

                  {/* Content Section - Main Flex Wrapper */}
                  {/* ✅ FIX: ใส่ justify-between เพื่อดัน Footer ลงล่างสุดแน่นอน */}
                  <div className="p-2 flex flex-col flex-1 justify-between bg-white">
                     
                     {/* Top Part: Name & Desc (Pusher) */}
                     <div className="flex-1 min-h-0 w-full">
                        <h3 className="font-bold text-gray-900 text-xs leading-snug line-clamp-2 mb-1">{product.name}</h3>
                        {product.description && (
                           <p className="text-[10px] text-gray-400 line-clamp-2 leading-relaxed">{product.description}</p>
                        )}
                     </div>
                     
                     {/* Bottom Part: Footer (Anchored) */}
                     <div className="mt-2 pt-2 flex flex-col gap-1.5 w-full">
                        <div className="flex items-baseline justify-between">
                           <span className="text-pink-600 font-black text-sm">฿{product.price}</span>
                        </div>

                        {qty === 0 ? (
                           <button 
                              onClick={() => product.status !== 'soldout' && updateQuantity(product.id, 1)}
                              disabled={product.status === 'soldout'}
                              className={`w-full rounded-lg py-1.5 flex items-center justify-center gap-1.5 transition-all shadow-sm ${
                                 product.status === 'soldout' 
                                 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                                 : 'bg-gray-900 text-white hover:bg-black active:scale-95'
                              }`}
                           >
                              <ShoppingBag size={12} />
                              <span className="text-[10px] font-bold uppercase tracking-wide">
                                 {product.status === 'soldout' ? 'Sold Out' : 'Add'}
                              </span>
                           </button>
                        ) : (
                           <div className="flex items-center justify-between bg-pink-50 rounded-lg p-0.5 border border-pink-100">
                              <button 
                                 onClick={() => updateQuantity(product.id, -1)}
                                 className="w-6 h-6 rounded bg-white text-pink-600 shadow-sm flex items-center justify-center hover:bg-pink-100 active:scale-90 transition-all border border-pink-100"
                              >
                                 <Minus size={12} strokeWidth={6} />
                              </button>
                              <span className="font-black text-gray-900 text-xs">{qty}</span>
                              <button 
                                 onClick={() => updateQuantity(product.id, 1)}
                                 className="w-6 h-6 rounded bg-pink-500 text-white shadow-md shadow-pink-200 flex items-center justify-center hover:bg-pink-600 active:scale-90 transition-all"
                              >
                                 <Plus size={12} strokeWidth={4} />
                              </button>
                           </div>
                        )}
                     </div>
                  </div>
               </div>
            );
          })}
          
          {/* Placeholder Card - Fixed Height div */}
          <div className="border border-dashed border-gray-300 rounded-xl bg-transparent flex flex-col items-center justify-center h-full min-h-[220px] p-3 text-center opacity-60">
             <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 mb-2">
                <span className="material-icons-outlined">more_horiz</span>
             </div>
             <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">More items<br/>soon</p>
          </div>
       </div>
    </div>
  );
};

export default MenuView;