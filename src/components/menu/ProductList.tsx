
import { ImageOff, ShoppingBag, Plus, Minus } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { getOptimizedImageUrl } from '../../utils/imageUtils';
import { formatPrice } from '../../utils/currency';
import { motion } from 'framer-motion';
import { getPromotionBadgesForProduct, type PromotionRule } from '../../utils/promotionPricing';
import { useI18n } from '../../i18n';

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
   promotions?: PromotionRule[];
   cart: Record<string, number>;
   isOrderSent: boolean;
   onUpdateQuantity: (id: string, delta: number, name?: string) => void;
   onClearFilters?: () => void;
}

const ProductList = ({ products, promotions = [], cart, isOrderSent, onUpdateQuantity, onClearFilters }: ProductListProps) => {
   const { t } = useI18n();

   if (products.length === 0) {
      return (
         <div className="flex flex-col items-center justify-center px-8 py-20 text-center animate-fade-in">
            <div className="mb-4 rounded-3xl bg-pink-50 p-6 text-pink-300">
               <ShoppingBag size={48} strokeWidth={1.5} />
            </div>
            <h3 className="mb-2 text-lg font-black text-gray-950">{t('homeNoCreators').replace(t('homeCreators'), t('customerNavMerch'))}</h3>
            <p className="mb-8 text-sm font-medium text-gray-500 leading-relaxed">
               {t('menuClearFilters').includes('Filters') ? 'Try clearing your search or filters to see more products.' : 'ลองล้างตัวกรองหรือคำค้นหาเพื่อดูสินค้าเพิ่มเติม'}
            </p>
            {onClearFilters && (
               <button
                  onClick={onClearFilters}
                  className="rounded-2xl border-2 border-pink-100 bg-white px-6 py-3 text-sm font-black text-pink-600 shadow-sm transition-all active:scale-95 hover:bg-pink-50"
               >
                  {t('menuClearFilters')}
               </button>
            )}
         </div>
      );
   }

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
      <motion.div
         className="grid grid-cols-2 gap-3 overflow-y-auto px-3 pb-40 pt-3"
         initial="hidden"
         animate="visible"
         variants={{
            hidden: { opacity: 0 },
            visible: {
               opacity: 1,
               transition: {
                  staggerChildren: 0.08
               }
            }
         }}
      >
         {products.map((product, index) => {
            const qty = cart[product.id] || 0;
            const isFirst = index === 0;
            const availableUnits = getAvailableUnits(product);
            const outOfStock = availableUnits <= 0;
            const soldOut = product.status === 'soldout' || outOfStock;
            const promoBadges = getPromotionBadgesForProduct(product, promotions);
            const isLowStock = Number.isFinite(availableUnits) && availableUnits > 0 && availableUnits <= 3;

            return (
               <motion.div
                  key={product.id}
                  className={`group flex h-full flex-col overflow-hidden rounded-3xl border bg-white shadow-sm transition-all ${
                     qty > 0
                        ? 'border-pink-200 ring-2 ring-pink-500 shadow-lg shadow-pink-100'
                        : 'border-pink-50'
                  }`}
                  variants={{
                     hidden: { opacity: 0, y: 30 },
                     visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } }
                  }}
               >
                  <div className="relative aspect-square w-full overflow-hidden bg-[#fff7fb]">
                     {product.image_url ? (
                        <motion.img
                           whileHover={{ scale: 1.05 }}
                           transition={{ duration: 0.3 }}
                           src={getProductImageUrl(product.image_url, 300)}
                           alt={product.name}
                           loading={isFirst ? "eager" : "lazy"}
                           width="300"
                           height="300"
                           className="h-full w-full object-contain p-2"
                           onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/300x300?text=No+Img'; }}
                        />
                     ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gray-100 text-gray-400">
                           <ImageOff size={24} strokeWidth={1.8} aria-hidden="true" />
                           <span className="max-w-[80%] truncate text-xs font-black text-gray-500">{product.name.charAt(0).toUpperCase()}</span>
                        </div>
                     )}
                     {soldOut && (
                        <motion.div
                           className="absolute inset-0 z-10 flex items-center justify-center bg-black/60"
                           initial={{ opacity: 0 }}
                           animate={{ opacity: 1 }}
                        >
                           <motion.span
                              className="border-2 border-white px-2 py-1 text-xs font-bold text-white"
                              initial={{ scale: 2.5, opacity: 0, rotate: -12 }}
                              animate={{ scale: 1, opacity: 1, rotate: -12 }}
                              transition={{ type: 'spring', stiffness: 400, damping: 15, delay: 0.1 }}
                           >
                              {t('productSoldOut')}
                           </motion.span>
                        </motion.div>
                     )}
                     {!soldOut && promoBadges.length > 0 && (
                        <div className="absolute left-2 top-2 z-10">
                           <span className="rounded-full border border-rose-100 bg-rose-50 px-2 py-1 text-[9px] font-black text-rose-700 shadow-sm">
                              {promoBadges[0].shortLabel}
                           </span>
                        </div>
                     )}
                  </div>
                  <div className="flex flex-1 flex-col justify-between p-3">
                     <div className="mb-2">
                        <h3 className="line-clamp-2 text-base font-black leading-tight text-gray-950">{product.name}</h3>
                        {product.description && <p className="mt-1 line-clamp-2 text-[11px] font-medium leading-4 text-gray-500">{product.description}</p>}
                     </div>
                     <div className="flex flex-col gap-2">
                        <div className="text-lg font-black leading-none text-pink-600">{formatPrice(product.price, product.currency)}</div>
                        <div className="flex min-h-4 items-center justify-between gap-2">
                           {!product.is_unlimited ? (
                              <div className="text-[10px] font-bold text-gray-500">{t('productLeft')} {Math.max(0, availableUnits - qty)}</div>
                           ) : (
                              <div className="text-[10px] font-bold text-gray-500">{t('productUnlimited')}</div>
                           )}
                           {isLowStock && <div className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-black text-amber-700">{t('productLowStock')}</div>}
                        </div>
                        {qty === 0 ? (
                           <button
                              onClick={() => !soldOut && onUpdateQuantity(product.id, 1, product.name)}
                              disabled={soldOut || isOrderSent}
                              className={`flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl text-[13px] font-black transition-all ${
                                 soldOut || isOrderSent
                                    ? 'bg-gray-100 text-gray-400'
                                    : 'bg-gradient-to-r from-pink-500 to-pink-600 text-white shadow-md shadow-pink-100 active:scale-95'
                              }`}
                           >
                              <ShoppingBag size={16} /> {t('productAdd')}
                           </button>
                        ) : (
                           <div className="flex min-h-[44px] items-center justify-between rounded-2xl border border-pink-100 bg-pink-50 p-1">
                              <button
                                 onClick={() => onUpdateQuantity(product.id, -1, product.name)}
                                 className="grid h-9 w-9 place-items-center rounded-xl bg-white text-pink-600 shadow-sm active:scale-95"
                                 aria-label={t('productDecrease', { name: product.name })}
                              >
                                 <Minus size={16} />
                              </button>
                              <span className="min-w-[40px] text-center text-sm font-black text-gray-950">{qty}</span>
                              <button
                                 onClick={() => onUpdateQuantity(product.id, 1, product.name)}
                                 disabled={!product.is_unlimited && qty >= availableUnits}
                                 className="grid h-9 w-9 place-items-center rounded-xl bg-pink-600 text-white shadow-md shadow-pink-100 active:scale-95 disabled:bg-gray-300 disabled:shadow-none"
                                 aria-label={t('productIncrease', { name: product.name })}
                              >
                                 <Plus size={16} />
                              </button>
                           </div>
                        )}
                     </div>
                  </div>
               </motion.div>
            );
         })}
         <div className="col-span-2 h-10 text-center text-[10px] text-gray-300 pt-4">{t('productEnd')}</div>
      </motion.div>
   );
};

export default ProductList;
