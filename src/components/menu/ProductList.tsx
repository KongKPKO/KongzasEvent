import { useEffect, useState } from 'react';
import { ImageOff, ShoppingBag, Plus, Minus, X } from 'lucide-react';
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
   variant_group_name?: string | null;
   variant_name?: string | null;
   variant_sort_order?: number;
}

interface ProductListProps {
   products: Product[];
   promotions?: PromotionRule[];
   cart: Record<string, number>;
   isOrderSent: boolean;
   onUpdateQuantity: (id: string, delta: number, name?: string) => void;
   onClearFilters?: () => void;
}

type ProductEntry =
   | { type: 'product'; product: Product }
   | { type: 'group'; key: string; label: string; products: Product[] };

const buildProductEntries = (products: Product[]): ProductEntry[] => {
   const entries: ProductEntry[] = [];
   const groups = new Map<string, { label: string; products: Product[] }>();

   products.forEach((product) => {
      const groupName = product.variant_group_name?.trim();
      if (!groupName) {
         entries.push({ type: 'product', product });
         return;
      }

      const key = groupName.toLowerCase();
      const group = groups.get(key) || { label: groupName, products: [] };
      group.products.push(product);
      groups.set(key, group);
   });

   groups.forEach((group, key) => {
      group.products.sort((a, b) => {
         const sortDiff = (a.variant_sort_order || 0) - (b.variant_sort_order || 0);
         if (sortDiff !== 0) return sortDiff;
         return (a.variant_name || a.name).localeCompare(b.variant_name || b.name);
      });
      entries.push({ type: 'group', key, label: group.label, products: group.products });
   });

   return entries;
};

const ProductList = ({ products, promotions = [], cart, isOrderSent, onUpdateQuantity, onClearFilters }: ProductListProps) => {
   const { t } = useI18n();
   const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

   useEffect(() => {
      if (!selectedProduct) return;
      const handleKeyDown = (event: KeyboardEvent) => {
         if (event.key === 'Escape') setSelectedProduct(null);
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
   }, [selectedProduct]);

   if (products.length === 0) {
      return (
         <div className="flex flex-col items-center justify-center px-8 py-20 text-center animate-fade-in">
            <div className="mb-4 rounded-3xl bg-pink-50 p-6 text-pink-300">
               <ShoppingBag size={48} strokeWidth={1.5} />
            </div>
            <h3 className="mb-2 text-lg font-black text-gray-950">{t('menuNoProductsTitle')}</h3>
            <p className="mb-8 text-sm font-medium text-gray-500 leading-relaxed">
               {t('menuNoProductsDetail')}
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

   const renderProductCard = (product: Product, index: number) => {
      const qty = cart[product.id] || 0;
      const isFirst = index === 0;
      const availableUnits = getAvailableUnits(product);
      const outOfStock = availableUnits <= 0;
      const soldOut = product.status === 'soldout' || outOfStock;
      const promoBadges = getPromotionBadgesForProduct(product, promotions);
      const isLowStock = Number.isFinite(availableUnits) && availableUnits > 0 && availableUnits <= 3;
      const displayName = product.variant_group_name && product.variant_name ? product.variant_name : product.name;

      return (
         <motion.div
            key={product.id}
            role="button"
            tabIndex={0}
            onClick={() => setSelectedProduct(product)}
            onKeyDown={(event) => {
               if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setSelectedProduct(product);
               }
            }}
            className={`group flex h-full flex-col overflow-hidden rounded-3xl border bg-white shadow-sm transition-all ${
               qty > 0
                  ? 'border-pink-200 ring-2 ring-pink-500 shadow-lg shadow-pink-100'
                  : 'border-pink-50 hover:border-pink-200 hover:shadow-lg hover:shadow-pink-100'
            }`}
            variants={{
               hidden: { opacity: 0, y: 30 },
               visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } }
            }}
         >
            <div className="relative aspect-square w-full overflow-hidden bg-pink-50">
               {product.image_url ? (
                  <motion.img
                     whileHover={{ scale: 1.05 }}
                     transition={{ duration: 0.3 }}
                     src={getProductImageUrl(product.image_url, 300)}
                     alt={product.name}
                     loading={isFirst ? 'eager' : 'lazy'}
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
                     <span className="rounded-full border border-rose-100 bg-rose-50 px-2 py-1 text-[11px] font-black text-rose-700 shadow-sm">
                        {promoBadges[0].shortLabel}
                     </span>
                  </div>
               )}
            </div>
            <div className="flex flex-1 flex-col justify-between p-3">
               <div className="mb-2">
                  <h3 className="line-clamp-2 text-base font-black leading-tight text-gray-950">{displayName}</h3>
                  {product.variant_group_name && product.variant_name && (
                     <p className="mt-1 line-clamp-1 text-[11px] font-black text-pink-700">{product.name}</p>
                  )}
                  {product.description && <p className="mt-1 line-clamp-2 text-[11px] font-medium leading-4 text-gray-500">{product.description}</p>}
               </div>
               <div className="flex flex-col gap-2">
                  <div className="text-lg font-black leading-none text-pink-600">{formatPrice(product.price, product.currency)}</div>
                  <div className="flex min-h-4 items-center justify-between gap-2">
                     {!product.is_unlimited ? (
                        <div className="text-[11px] font-bold text-gray-500">{t('productLeft')} {Math.max(0, availableUnits - qty)}</div>
                     ) : (
                        <div className="text-[11px] font-bold text-gray-500">{t('productUnlimited')}</div>
                     )}
                     {isLowStock && <div className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[11px] font-black text-amber-700">{t('productLowStock')}</div>}
                  </div>
                  {qty === 0 ? (
                     <button
                        onClick={(event) => {
                           event.stopPropagation();
                           if (!soldOut) onUpdateQuantity(product.id, 1, product.name);
                        }}
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
                           onClick={(event) => {
                              event.stopPropagation();
                              onUpdateQuantity(product.id, -1, product.name);
                           }}
                           className="grid h-11 w-11 place-items-center rounded-xl bg-white text-pink-700 shadow-sm active:scale-95"
                           aria-label={t('productDecrease', { name: product.name })}
                        >
                           <Minus size={16} />
                        </button>
                        <span className="min-w-[40px] text-center text-sm font-black text-gray-950">{qty}</span>
                        <button
                           onClick={(event) => {
                              event.stopPropagation();
                              onUpdateQuantity(product.id, 1, product.name);
                           }}
                           disabled={!product.is_unlimited && qty >= availableUnits}
                           className={[
                              'grid h-11 w-11 place-items-center rounded-xl bg-pink-600 text-white shadow-md shadow-pink-100 active:scale-95',
                              'disabled:bg-gray-300 disabled:text-gray-700 disabled:shadow-none'
                           ].join(' ')}
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
   };

   const entries = buildProductEntries(products);
   const selectedQty = selectedProduct ? cart[selectedProduct.id] || 0 : 0;
   const selectedAvailableUnits = selectedProduct ? getAvailableUnits(selectedProduct) : 0;
   const selectedSoldOut = selectedProduct
      ? selectedProduct.status === 'soldout' || selectedAvailableUnits <= 0
      : false;
   const selectedPromoBadges = selectedProduct ? getPromotionBadgesForProduct(selectedProduct, promotions) : [];

   return (
      <>
      <motion.div
         className="grid grid-cols-2 gap-3 overflow-y-auto px-3 pb-40 pt-3 sm:grid-cols-3 lg:grid-cols-2 lg:overflow-visible lg:px-0 lg:pb-10 lg:pt-0 xl:grid-cols-3"
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
         {entries.map((entry, index) => {
            if (entry.type === 'product') {
               return renderProductCard(entry.product, index);
            }

            return (
               <div key={`variant-group-${entry.key}`} className="col-span-2 sm:col-span-3 lg:col-span-2 xl:col-span-3">
                  <div className="mb-2 mt-1 rounded-xl border border-pink-100 bg-pink-50 px-3 py-2">
                     <h3 className="text-sm font-black text-pink-950">{entry.label}</h3>
                     <p className="text-[11px] font-bold text-pink-800">{entry.products.length} variants</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                     {entry.products.map((product, productIndex) => renderProductCard(product, productIndex))}
                  </div>
               </div>
            );
         })}
         <div className="col-span-2 sm:col-span-3 lg:col-span-2 xl:col-span-3 h-10 pt-4 text-center text-[11px] font-semibold text-gray-600">{t('productEnd')}</div>
      </motion.div>
      {selectedProduct && (
         <div
            className="fixed inset-0 z-[95] flex items-end justify-center bg-gray-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label={selectedProduct.name}
            onClick={() => setSelectedProduct(null)}
         >
            <motion.div
               initial={{ opacity: 0, y: 28, scale: 0.98 }}
               animate={{ opacity: 1, y: 0, scale: 1 }}
               transition={{ type: 'spring', stiffness: 320, damping: 28 }}
               className="relative max-h-[92vh] w-full overflow-hidden rounded-t-[2rem] bg-white shadow-2xl sm:max-w-5xl sm:rounded-[2rem]"
               onClick={(event) => event.stopPropagation()}
            >
               <button
                  type="button"
                  onClick={() => setSelectedProduct(null)}
                  className="absolute right-3 top-3 z-30 grid h-11 w-11 place-items-center rounded-full bg-white/95 text-gray-600 shadow-sm transition-colors hover:text-gray-950"
                  aria-label={t('productDetailClose')}
               >
                  <X size={20} />
               </button>
               <div className="grid max-h-[92vh] overflow-y-auto sm:grid-cols-2">
                  <div className="relative min-w-0 overflow-hidden bg-pink-50 sm:border-r sm:border-pink-100">
                     <div className="flex aspect-square min-h-[280px] items-center justify-center p-4 sm:h-full sm:min-h-[560px] sm:p-6">
                        {selectedProduct.image_url ? (
                           <img
                              src={getProductImageUrl(selectedProduct.image_url, 900)}
                              alt={selectedProduct.name}
                              className="h-full max-h-full w-full max-w-full object-contain"
                           />
                        ) : (
                           <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-3xl bg-gray-100 text-gray-400">
                              <ImageOff size={44} strokeWidth={1.6} aria-hidden="true" />
                              <span className="text-sm font-black text-gray-500">{selectedProduct.name}</span>
                           </div>
                        )}
                     </div>
                     {selectedSoldOut && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                           <span className="rotate-[-10deg] border-2 border-white px-4 py-2 text-sm font-black uppercase tracking-wide text-white">
                              {t('productSoldOut')}
                           </span>
                        </div>
                     )}
                  </div>

                  <div className="flex min-h-0 min-w-0 flex-col p-5 pt-14 sm:p-7 sm:pt-16">
                     <div className="mb-4 flex flex-wrap gap-2">
                        {selectedProduct.category && (
                           <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-black text-gray-600">{selectedProduct.category}</span>
                        )}
                        {selectedPromoBadges.map((badge) => (
                           <span key={badge.shortLabel} className="rounded-full border border-rose-100 bg-rose-50 px-3 py-1 text-xs font-black text-rose-700">
                              {badge.shortLabel}
                           </span>
                        ))}
                     </div>

                     <div className="space-y-2">
                        <h2 className="text-2xl font-black leading-tight text-gray-950 sm:text-3xl">
                           {selectedProduct.variant_group_name && selectedProduct.variant_name ? selectedProduct.variant_name : selectedProduct.name}
                        </h2>
                        {selectedProduct.variant_group_name && selectedProduct.variant_name && (
                           <p className="text-sm font-black text-pink-700">{selectedProduct.name}</p>
                        )}
                        <div className="text-3xl font-black text-pink-600">
                           {formatPrice(selectedProduct.price, selectedProduct.currency)}
                        </div>
                     </div>

                     <div className="mt-5 rounded-2xl border border-gray-100 bg-gray-50 p-4">
                        <div className="flex items-center justify-between gap-3">
                           {!selectedProduct.is_unlimited ? (
                              <span className="text-sm font-black text-gray-700">
                                 {t('productLeft')} {Math.max(0, selectedAvailableUnits - selectedQty)}
                              </span>
                           ) : (
                              <span className="text-sm font-black text-gray-700">{t('productUnlimited')}</span>
                           )}
                           {Number.isFinite(selectedAvailableUnits) && selectedAvailableUnits > 0 && selectedAvailableUnits <= 3 && (
                              <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-black text-amber-700">{t('productLowStock')}</span>
                           )}
                        </div>
                     </div>

                     {selectedProduct.description ? (
                        <div className="mt-5">
                           <h3 className="text-xs font-black uppercase tracking-wide text-gray-400">{t('productDetailDescription')}</h3>
                           <p className="mt-2 whitespace-pre-line text-sm font-semibold leading-6 text-gray-600">{selectedProduct.description}</p>
                        </div>
                     ) : (
                        <div className="mt-5 rounded-2xl border border-dashed border-gray-200 p-4 text-sm font-semibold text-gray-400">
                           {t('productDetailNoDescription')}
                        </div>
                     )}

                     {!!selectedProduct.variant_group_name && (
                        <div className="mt-5">
                           <h3 className="text-xs font-black uppercase tracking-wide text-gray-400">{t('productDetailVariantGroup')}</h3>
                           <div className="mt-2 inline-flex rounded-full bg-pink-50 px-3 py-1 text-sm font-black text-pink-700">
                              {selectedProduct.variant_group_name}
                           </div>
                        </div>
                     )}

                     {!!selectedProduct.category && (
                        <div className="mt-5">
                           <h3 className="text-xs font-black uppercase tracking-wide text-gray-400">{t('productDetailCategory')}</h3>
                           <div className="mt-2 inline-flex rounded-full bg-gray-100 px-3 py-1 text-sm font-black text-gray-700">
                              {selectedProduct.category}
                           </div>
                        </div>
                     )}

                     <div className="mt-auto pt-6">
                        {selectedQty === 0 ? (
                           <button
                              onClick={() => !selectedSoldOut && onUpdateQuantity(selectedProduct.id, 1, selectedProduct.name)}
                              disabled={selectedSoldOut || isOrderSent}
                              className={`flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl text-sm font-black transition-all ${
                                 selectedSoldOut || isOrderSent
                                    ? 'bg-gray-100 text-gray-400'
                                    : 'bg-gradient-to-r from-pink-500 to-pink-600 text-white shadow-lg shadow-pink-100 active:scale-[0.99]'
                              }`}
                           >
                              <ShoppingBag size={18} /> {t('productAdd')}
                           </button>
                        ) : (
                           <div className="flex min-h-[56px] items-center justify-between rounded-2xl border border-pink-100 bg-pink-50 p-1.5">
                              <button
                                 onClick={() => onUpdateQuantity(selectedProduct.id, -1, selectedProduct.name)}
                                 className="grid h-12 w-12 place-items-center rounded-xl bg-white text-pink-700 shadow-sm active:scale-95"
                                 aria-label={t('productDecrease', { name: selectedProduct.name })}
                              >
                                 <Minus size={18} />
                              </button>
                              <span className="min-w-[64px] text-center text-base font-black text-gray-950">{selectedQty}</span>
                              <button
                                 onClick={() => onUpdateQuantity(selectedProduct.id, 1, selectedProduct.name)}
                                 disabled={!selectedProduct.is_unlimited && selectedQty >= selectedAvailableUnits}
                                 className={[
                                    'grid h-12 w-12 place-items-center rounded-xl bg-pink-600 text-white shadow-md shadow-pink-100 active:scale-95',
                                    'disabled:bg-gray-300 disabled:text-gray-700 disabled:shadow-none'
                                 ].join(' ')}
                                 aria-label={t('productIncrease', { name: selectedProduct.name })}
                              >
                                 <Plus size={18} />
                              </button>
                           </div>
                        )}
                     </div>
                  </div>
               </div>
            </motion.div>
         </div>
      )}
      </>
   );
};

export default ProductList;
