import { useEffect, useRef, useState } from 'react';
import { ShoppingBag, ShoppingCart, Plus, Minus, X } from 'lucide-react';
import { formatPrice } from '../../utils/currency';
import { getPromotionBadgesForProduct, type PromotionRule } from '../../utils/promotionPricing';
import { useI18n } from '../../i18n';
import { ShopImage } from './StorefrontHeader';

interface Product {
  id: string; name: string; price: number; image_url: string; description?: string; category?: string;
  status?: 'enable' | 'disable' | 'soldout'; currency?: string; stock_total?: number | null;
  stock_reserved?: number; stock_sold?: number; is_unlimited?: boolean;
  variant_group_name?: string | null; variant_name?: string | null; variant_sort_order?: number;
}
interface ProductListProps {
  products: Product[]; promotions?: PromotionRule[]; cart: Record<string, number>; isOrderSent: boolean;
  onUpdateQuantity: (id: string, delta: number, name?: string) => void; onClearFilters?: () => void;
}
type ProductEntry = { type: 'product'; product: Product } | { type: 'group'; key: string; label: string; products: Product[] };
const buildProductEntries = (products: Product[]): ProductEntry[] => {
  const entries: ProductEntry[] = [], groups = new Map<string, { label: string; products: Product[] }>();
  for (const product of products) {
    const label = product.variant_group_name?.trim();
    if (!label) { entries.push({ type: 'product', product }); continue; }
    const key = label.toLowerCase(), group = groups.get(key) || { label, products: [] };
    group.products.push(product); groups.set(key, group);
  }
  groups.forEach((group, key) => {
    group.products.sort((a, b) => (a.variant_sort_order || 0) - (b.variant_sort_order || 0) || (a.variant_name || a.name).localeCompare(b.variant_name || b.name));
    entries.push({ type: 'group', key, ...group });
  });
  return entries;
};
const availableUnits = (product: Product) => product.is_unlimited ? Infinity : Math.max(0, (product.stock_total || 0) - (product.stock_reserved || 0) - (product.stock_sold || 0));

export default function ProductList({ products, promotions = [], cart, isOrderSent, onUpdateQuantity, onClearFilters }: ProductListProps) {
  const { t, language } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  // Resolve the current record so an open detail view follows stock/price updates.
  const selected = products.find(product => product.id === selectedId);
  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
    if (!selected && dialog.current?.open) dialog.current.close();
  }, [selected]);
  const entries = buildProductEntries(products);
  const variants = selected?.variant_group_name ? products.filter(product => product.variant_group_name?.trim().toLowerCase() === selected.variant_group_name?.trim().toLowerCase()) : [];
  const detailLabel = (name: string) => language === 'th' ? `ดูรายละเอียด ${name}` : `View details: ${name}`;

  const quantityControls = (product: Product) => {
    const qty = cart[product.id] || 0, available = availableUnits(product);
    const soldOut = product.status === 'soldout' || product.status === 'disable' || available <= 0;
    return qty === 0 ? <button type="button" className="shop-add" disabled={soldOut || isOrderSent} onClick={() => onUpdateQuantity(product.id, 1, product.name)} aria-label={`${t('productAdd')}: ${product.name}`}><ShoppingCart size={17} aria-hidden="true" />{soldOut ? t('productSoldOut') : t('productAdd')}</button>
      : <div className="shop-quantity">
        <button type="button" disabled={isOrderSent} onClick={() => onUpdateQuantity(product.id, -1, product.name)} aria-label={t('productDecrease', { name: product.name })}><Minus size={17} /></button>
        <span className="text-center font-bold tabular-nums" aria-live="polite">{qty}</span>
        <button type="button" disabled={isOrderSent || soldOut || qty >= available} onClick={() => onUpdateQuantity(product.id, 1, product.name)} aria-label={t('productIncrease', { name: product.name })}><Plus size={17} /></button>
      </div>;
  };
  const stockLabel = (product: Product) => product.status === 'soldout' || product.status === 'disable' || availableUnits(product) === 0 ? t('productSoldOut') : product.is_unlimited ? t('productUnlimited') : `${t('productLeft')} ${availableUnits(product)}`;
  const card = (product: Product, index: number) => <article key={product.id} className={`shop-product ${cart[product.id] ? 'shop-product-selected' : ''}`} aria-label={product.name}>
    <button type="button" className="shop-product-picture" aria-label={detailLabel(product.name)} onClick={() => setSelectedId(product.id)}>
      <ShopImage src={product.image_url} name={product.name} eager={index < 3} />
      {(product.status === 'soldout' || availableUnits(product) === 0) && <span className="shop-sold-out">{t('productSoldOut')}</span>}
    </button>
    <div className="shop-product-copy">
      <h3 className="break-words font-bold leading-6 text-gray-950">{product.variant_name || product.name}</h3>
      {product.variant_name && <p className="mt-1 break-words text-xs text-gray-600">{product.name}</p>}
      <div className="mt-1 flex flex-wrap gap-1">{getPromotionBadgesForProduct(product, promotions).map(badge => <span key={badge.id} className="text-xs font-semibold text-pink-800">{badge.shortLabel}</span>)}</div>
      <div className="shop-product-purchase"><p className="shop-product-stock">{stockLabel(product)}</p><div className={`shop-product-buyline ${cart[product.id] ? 'has-quantity' : ''}`}><p className="shop-product-price">{formatPrice(product.price, product.currency)}</p>{quantityControls(product)}</div></div>
    </div>
  </article>;

  return <>
    {products.length === 0 ? <div className="shop-empty"><ShoppingBag size={36} aria-hidden="true" /><h2>{t('menuNoProductsTitle')}</h2><p>{t('menuNoProductsDetail')}</p>{onClearFilters && <button className="shop-outline" onClick={onClearFilters}>{t('menuClearFilters')}</button>}</div> : <div className="shop-product-grid">
      {entries.map((entry, index) => entry.type === 'product' ? card(entry.product, index) : <section className="shop-variant-group" key={entry.key} aria-label={entry.label}>
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3"><h2 className="text-xl font-bold text-gray-950">{entry.label}</h2><p className="text-sm text-gray-600">{entry.products.length} {language === 'th' ? 'ตัวเลือก · เลือกแบบที่ชอบ' : 'variants · Choose your design'}</p></div>
        <div className="shop-product-grid">{entry.products.map(card)}</div>
      </section>)}
      <p className="shop-grid-end">{t('productEnd')}</p>
    </div>}
    <dialog ref={dialog} className="shop-product-dialog" onCancel={event => { event.preventDefault(); setSelectedId(null); }} onClick={event => { if (event.target === event.currentTarget) setSelectedId(null); }} aria-label={selected?.name}>
      {selected && <div className="shop-detail">
        <button type="button" className="shop-detail-close" autoFocus onClick={() => setSelectedId(null)} aria-label={t('productDetailClose')}><X size={22} /></button>
        <div className="shop-detail-image"><ShopImage src={selected.image_url} name={selected.name} eager /></div>
        <div className="shop-detail-copy">
          {selected.category && <p className="text-sm font-semibold text-pink-800">{selected.category}</p>}
          <h2 className="mt-2 break-words text-2xl font-extrabold text-gray-950">{selected.name}</h2>
          <p className="mt-3 text-2xl font-bold">{formatPrice(selected.price, selected.currency)}</p>
          <p className="mt-2 text-sm text-gray-600">{stockLabel(selected)}</p>
          {selected.description && <p className="mt-5 whitespace-pre-line break-words text-sm leading-7 text-gray-600">{selected.description}</p>}
          {variants.length > 1 && <fieldset className="mt-5"><legend className="mb-2 text-sm font-bold">{t('productDetailVariantGroup')}</legend><div className="flex flex-wrap gap-2">{variants.map(product => <button type="button" key={product.id} aria-pressed={product.id === selected.id} className="shop-variant-option" onClick={() => setSelectedId(product.id)}>{product.variant_name || product.name}</button>)}</div></fieldset>}
          <div className="mt-6">{quantityControls(selected)}<p className="mt-3 text-xs leading-5 text-gray-600">{language === 'th' ? 'การใส่ตะกร้ายังไม่จองสต็อก ตรวจรายการก่อนยืนยัน' : 'Adding to cart does not reserve stock. Review your items before confirming.'}</p></div>
        </div>
      </div>}
    </dialog>
  </>;
}
