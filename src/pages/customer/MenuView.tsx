import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { Artist } from '../../hooks/useArtist';
import { Card } from '../../components/ui';
import { ShoppingBag, Plus, Minus } from 'lucide-react';

interface Product {
  id: string;
  name: string;
  price: number;
  image_url: string;
  description?: string;
  category?: string;
}

const MenuView = () => {
  const { artist } = useOutletContext<{ artist: Artist }>();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const fetchProducts = async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('artist_id', artist.id)
        .order('created_at', { ascending: false });

      if (!error && data) {
         setProducts(data);
      }
      setLoading(false);
    };

    fetchProducts();
  }, [artist.id]);

  const getProductImageUrl = (dbValue: string) => {
    if (!dbValue) return '';
    let path = dbValue;
    if (dbValue.includes('http') && dbValue.includes('Menu/')) {
       const parts = dbValue.split('Menu/');
       if (parts.length > 1) path = parts[1];
    }
    const { data } = supabase.storage.from('Menu').getPublicUrl(path);
    return data.publicUrl;
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

  if (loading) return <div className="p-8 text-center text-gray-400">Loading menu...</div>;

  return (
    <div className="min-h-screen bg-gray-50 pb-32 animate-fade-in relative">
       {/* Header Section with Floating Summary */}
       <div className="sticky top-0 z-30 pt-4 pb-2 px-4 bg-gray-50/95 backdrop-blur-sm transition-all">
          <h2 className="text-2xl font-black text-center text-gray-900 mb-4 tracking-tight drop-shadow-sm">
             {artist?.display_name || 'Menu'}
          </h2>
          
          <div 
             onClick={() => totalItems > 0 && setIsExpanded(!isExpanded)}
             className={`mx-auto max-w-sm bg-white rounded-3xl shadow-lg border border-gray-100 overflow-hidden transition-all duration-300 ${totalItems > 0 ? 'cursor-pointer active:scale-95' : 'opacity-80'}`}
          >
             <div className="flex items-center justify-between px-6 py-3">
                <div className="flex flex-col">
                   <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Total</span>
                   <span className="text-pink-600 font-black text-xl leading-none">฿{totalPrice.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-3 pl-6 border-l border-gray-100">
                   <span className="font-bold text-gray-800 text-sm">{totalItems} items</span>
                   <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white shadow-md transition-colors ${totalItems > 0 ? 'bg-pink-500 shadow-pink-200' : 'bg-gray-300'}`}>
                      <ShoppingBag size={14} strokeWidth={3} />
                   </div>
                </div>
             </div>

              {/* Expanded Cart Details */}
              {isExpanded && totalItems > 0 && (
                 <div className="px-6 pb-4 pt-0 bg-white animate-fade-in">
                    <div className="h-px w-full bg-gray-100 mb-3"></div>
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                       {Object.entries(cart).map(([id, qty]) => {
                          const product = products.find(p => p.id === id);
                          if (!product || qty === 0) return null;
                          return (
                             <div key={id} className="flex justify-between items-center text-sm">
                                <span className="text-gray-600 font-medium truncate pr-4">{product.name}</span>
                                <span className="font-bold text-pink-600 shrink-0">x {qty}</span>
                             </div>
                          );
                       })}
                    </div>
                    <div className="mt-3 text-center">
                       <span className="text-[10px] text-gray-400 font-medium uppercase tracking-widest">Tap to close</span>
                    </div>
                 </div>
              )}
          </div>
       </div>

       {/* Menu Grid */}
       <div className="px-4 mt-2 grid grid-cols-2 gap-3 pb-safe">
          {products.map(product => {
            const qty = cart[product.id] || 0;
            return (
               <Card key={product.id} className={`overflow-hidden border-none shadow-sm flex flex-col h-full transition-all duration-300 ${qty > 0 ? 'ring-2 ring-pink-500' : ''}`}>
                  {/* Image Section - Full Width */}
                  <div className="aspect-square bg-gray-100 relative w-full overflow-hidden group">
                     {product.image_url ? (
                        <img 
                           src={getProductImageUrl(product.image_url)} 
                           alt={product.name} 
                           className="w-full h-full object-cover transform transition-transform duration-500 group-hover:scale-105" 
                           onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/400x400?text=No+Image'; }}
                        />
                     ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300">
                           <span className="material-icons-outlined text-4xl">image</span>
                        </div>
                     )}
                     
                     {/* Category Badge */}
                     {product.category && (
                        <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-sm uppercase tracking-wide">
                           {product.category}
                        </div>
                     )}
                  </div>

                  {/* Content Section */}
                  <div className="p-2.5 flex flex-col flex-1 bg-white">
                     {/* Locked Height Text Container for Alignment */}
                     <div className="min-h-[80px]">
                        <h3 className="font-bold text-gray-900 text-sm leading-snug line-clamp-2 mb-1">{product.name}</h3>
                        {product.description && (
                           <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{product.description}</p>
                        )}
                     </div>
                     
                     <div className="mt-auto pt-2 flex flex-col gap-2">
                        <div className="flex items-baseline justify-between">
                           <span className="text-pink-600 font-black text-lg">฿{product.price}</span>
                        </div>

                        {qty === 0 ? (
                           <button 
                              onClick={() => updateQuantity(product.id, 1)}
                              className="w-full bg-gray-900 text-white rounded-lg py-1.5 flex items-center justify-center gap-2 hover:bg-black active:scale-95 transition-all shadow-sm"
                           >
                              <ShoppingBag size={14} />
                              <span className="text-xs font-bold">Add</span>
                           </button>
                        ) : (
                           <div className="flex items-center justify-between bg-pink-50 rounded-lg p-1 border border-pink-100">
                              <button 
                                 onClick={() => updateQuantity(product.id, -1)}
                                 className="w-7 h-7 rounded bg-white text-pink-600 shadow-sm flex items-center justify-center hover:bg-pink-100 active:scale-90 transition-all border border-pink-100"
                              >
                                 <Minus size={14} strokeWidth={2.5} />
                              </button>
                              <span className="font-black text-gray-900 text-sm">{qty}</span>
                              <button 
                                 onClick={() => updateQuantity(product.id, 1)}
                                 className="w-7 h-7 rounded bg-pink-500 text-white shadow-md shadow-pink-200 flex items-center justify-center hover:bg-pink-600 active:scale-90 transition-all"
                              >
                                 <Plus size={14} strokeWidth={2.5} />
                              </button>
                           </div>
                        )}
                     </div>
                  </div>
               </Card>
            );
          })}
          
          {/* Placeholder Card */}
          <Card className="border border-dashed border-gray-300 shadow-none bg-transparent flex flex-col items-center justify-center h-full min-h-[280px] p-4 text-center opacity-60">
             <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 mb-3">
                <span className="material-icons-outlined">more_horiz</span>
             </div>
             <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">More items<br/>soon</p>
          </Card>
       </div>
    </div>
  );
};

export default MenuView;
