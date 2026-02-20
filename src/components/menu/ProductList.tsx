
import { ShoppingBag, Plus, Minus } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { getOptimizedImageUrl } from '../../utils/imageUtils';
import { formatPrice } from '../../utils/currency';

interface Product {
    id: string;
    name: string;
    price: number;
    image_url: string;
    description?: string;
    category?: string;
    status?: 'enable' | 'disable' | 'soldout';
    currency?: string;
    stock_total?: number | null;
    stock_reserved?: number;
    stock_sold?: number;
    is_unlimited?: boolean;
}

interface ProductListProps {
    products: Product[];
    cart: Record<string, number>;
    isOrderSent: boolean;
    onUpdateQuantity: (id: string, delta: number, name?: string) => void;
}

const ProductList = ({ products, cart, isOrderSent, onUpdateQuantity }: ProductListProps) => {
    const getAvailableUnits = (product: Product) => {
        if (product.is_unlimited) return Number.POSITIVE_INFINITY;
        const total = product.stock_total || 0;
        const reserved = product.stock_reserved || 0;
        const sold = product.stock_sold || 0;
        return Math.max(0, total - reserved - sold);
    };

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

    return (
       <div className="pt-[115px] px-3 grid grid-cols-2 gap-2 pb-44 overflow-y-auto">
          {products.map((product, index) => {
            const qty = cart[product.id] || 0;
            const isFirst = index === 0;
            const availableUnits = getAvailableUnits(product);
            const outOfStock = availableUnits <= 0;
            const soldOut = product.status === 'soldout' || outOfStock;

            return (
               <div key={product.id} className={`bg-white rounded-xl shadow-sm overflow-hidden flex flex-col h-full border border-gray-100 transition-all ${qty > 0 ? 'ring-2 ring-pink-500' : ''}`}>
                  <div className="aspect-square bg-gray-100 relative w-full overflow-hidden">
                     {product.image_url ? (
                        <img 
                           // Optimization: 300px width (sufficient for 2-column layout), q-80 is handled by helper
                           src={getProductImageUrl(product.image_url, 300)} 
                           alt={product.name} 
                           // LCP Optimization: Prioritize the first image
                           loading={isFirst ? "eager" : "lazy"}
                           // @ts-ignore
                           fetchPriority={isFirst ? "high" : "auto"}
                           // Layout Stability: Explicit dimensions matching aspect-square (1:1)
                           width="300"
                           height="300"
                           className="w-full h-full object-cover" 
                           onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/300x300?text=No+Img'; }} 
                        />
                     ) : (<div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">No Img</div>)}
                     {soldOut && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10"><span className="text-white font-bold border-2 px-2 py-1 rotate-[-12deg] text-xs">SOLD OUT</span></div>
                     )}
                  </div>
                  <div className="p-2.5 flex flex-col flex-1 justify-between">
                     <div className="mb-2">
                        <h3 className="font-bold text-gray-900 text-xs leading-tight line-clamp-2">{product.name}</h3>
                        {product.description && <p className="text-[10px] text-gray-400 line-clamp-1 mt-0.5">{product.description}</p>}
                     </div>
                     <div className="flex flex-col gap-1.5">
                        <div className="text-pink-600 font-extrabold text-sm">{formatPrice(product.price, product.currency)}</div>
                        {!product.is_unlimited && (
                           <div className="text-[9px] text-gray-400">Left: {Math.max(0, availableUnits - qty)}</div>
                        )}
                        {qty === 0 ? (
                           <button onClick={() => !soldOut && onUpdateQuantity(product.id, 1, product.name)} disabled={soldOut || isOrderSent} className={`w-full rounded-md py-1 flex items-center justify-center gap-1 text-[10px] font-bold transition-all ${soldOut || isOrderSent ? 'bg-gray-100 text-gray-400' : 'bg-gray-900 text-white active:scale-95'}`}><ShoppingBag size={10} /> ADD</button>
                        ) : (
                           <div className="flex items-center justify-between bg-pink-50 rounded-md p-0.5 border border-pink-100">
                              <button onClick={() => onUpdateQuantity(product.id, -1, product.name)} className="w-6 h-6 rounded bg-white text-pink-600 flex items-center justify-center shadow-sm"><Minus size={12} /></button>
                              <span className="font-bold text-xs">{qty}</span>
                              <button onClick={() => onUpdateQuantity(product.id, 1, product.name)} disabled={!product.is_unlimited && qty >= availableUnits} className="w-6 h-6 rounded bg-pink-500 text-white flex items-center justify-center shadow-md disabled:bg-gray-300 disabled:shadow-none"><Plus size={12} /></button>
                           </div>
                        )}
                     </div>
                  </div>
               </div>
            );
          })}
          <div className="col-span-2 h-10 text-center text-[10px] text-gray-300 pt-4">End of Menu</div>
       </div>
    );
};

export default ProductList;
