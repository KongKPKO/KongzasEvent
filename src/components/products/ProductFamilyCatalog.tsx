import { useState, type ReactNode } from 'react';
import { Images, Package, PackageSearch, Pencil, Search, X } from 'lucide-react';
import type { ProductParent } from '../../types/productFamily';
import { formatPrice } from '../../utils/currency';
import { getProductImages } from '../../utils/productPresentation';
import { uiText, useI18n } from '../../i18n';
import { useDialogFocus } from '../../hooks/useDialogFocus';

export interface CatalogFamilyVariant {
  variant_gallery_images?: string[] | null;
  gallery_images?: string[] | null;
  id: string;
  name: string;
  price: number;
  image_url?: string | null;
  sku?: string | null;
  variant_name?: string | null;
  price_override?: number | null;
  stock_total?: number | null;
  is_unlimited?: boolean;
  status?: 'enable' | 'disable' | 'soldout';
  variant_sort_order?: number;
}

export interface CatalogProductFamily<TVariant extends CatalogFamilyVariant> {
  parent: ProductParent;
  variants: TVariant[];
}

interface ProductFamilyCatalogProps<TVariant extends CatalogFamilyVariant> {
  families: Array<CatalogProductFamily<TVariant>>;
  displayMode: 'visual' | 'operations';
  getImageUrl: (path?: string | null, width?: number) => string;
  renderVariantStock: (variant: TVariant, compact?: boolean) => ReactNode;
  renderVariantActions: (variant: TVariant, surface: 'card' | 'mobile' | 'table', onAction?: () => void) => ReactNode;
  onEditFamily: (family: CatalogProductFamily<TVariant>) => void;
}

const kindLabel = (language: 'en' | 'th', kind: ProductParent['product_kind']) => uiText(language, ({
  single: 'Single item',
  photo: 'Photo set',
  bundle: 'Bundle',
  preorder: 'Single item',
  service: 'Single item',
})[kind]);

function ProductVisual<TVariant extends CatalogFamilyVariant>({ parent, variants, getImageUrl, language }: {
  parent: ProductParent;
  variants: TVariant[];
  getImageUrl: ProductFamilyCatalogProps<TVariant>['getImageUrl'];
  language: 'en' | 'th';
}) {
  const item = variants[0];
  const gallery = parent.product_kind === 'photo'
    ? (item?.variant_gallery_images != null ? item.variant_gallery_images : [item?.image_url || parent.image_url, ...(item?.gallery_images || parent.gallery_images || [])]).filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index)
    : [];
  const fallbackImage = item?.variant_gallery_images != null ? gallery[0] : gallery[0] || parent.image_url || variants.find((variant) => variant.image_url)?.image_url;

  if (gallery.length > 1) {
    const shown = gallery.slice(0, 4);
    return (
      <div className={`grid h-full w-full gap-0.5 bg-gray-100 ${shown.length === 2 ? 'grid-cols-2' : 'grid-cols-2 grid-rows-2'}`}>
        {shown.map((image, index) => (
          <div key={`${image}-${index}`} className={`relative min-h-0 overflow-hidden ${shown.length === 3 && index === 0 ? 'row-span-2' : ''}`}>
            <img src={getImageUrl(image, 500)} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
            {index === 3 && gallery.length > 4 && <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 text-2xl font-black text-white">+{gallery.length - 4}</div>}
          </div>
        ))}
      </div>
    );
  }

  return fallbackImage ? <img src={getImageUrl(fallbackImage, 650)} alt={parent.name} className="h-full w-full object-cover" loading="lazy" decoding="async" /> : <div className="flex h-full flex-col items-center justify-center gap-2 bg-gray-50 text-gray-600"><PackageSearch size={28} /><span className="text-xs font-black uppercase tracking-wide">{uiText(language, 'Missing image')}</span></div>;
}

export default function ProductFamilyCatalog<TVariant extends CatalogFamilyVariant>({
  families,
  displayMode,
  getImageUrl,
  renderVariantStock,
  renderVariantActions,
  onEditFamily,
}: ProductFamilyCatalogProps<TVariant>) {
  const { language } = useI18n();
  const thai = language === 'th';
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const preview = families.find((family) => family.parent.id === previewId);
  const closePreview = () => { setPreviewId(null); setQuery(''); };
  const dialogRef = useDialogFocus<HTMLDivElement>(Boolean(preview), closePreview);
  const optionLabel = (count: number) => thai ? `ตัวเลือกสินค้า · ${count} แบบ` : `Product options · ${count} variants`;
  const openPreview = (id: string) => { setQuery(''); setPreviewId(id); };
  const optionsButton = (family: CatalogProductFamily<TVariant>) => (
    <button type="button" aria-haspopup="dialog" onClick={() => openPreview(family.parent.id)} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-pink-200 px-3 text-left text-xs font-black text-pink-700 hover:bg-pink-50">
      {optionLabel(family.variants.length)}<Search size={16} aria-hidden="true" />
    </button>
  );
  const filteredVariants = preview?.variants.filter((variant) =>
    `${variant.variant_name || variant.name} ${variant.sku || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  ) || [];
  const popup = preview && (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="product-options-title" className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-950/50 p-3 backdrop-blur-sm sm:p-6" onClick={(event) => { if (event.target === event.currentTarget) closePreview(); }}>
      <section className="flex max-h-[85dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 p-4">
          <div className="min-w-0"><h2 id="product-options-title" className="text-lg font-black text-gray-950">{preview.parent.name}</h2><p className="mt-1 text-xs font-bold text-gray-500">{optionLabel(preview.variants.length)}</p></div>
          <button type="button" onClick={closePreview} aria-label={thai ? 'ปิดตัวเลือกสินค้า' : 'Close product options'} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50"><X size={20} /></button>
        </header>
        <div className="shrink-0 p-4 pb-2"><label className="relative block"><Search size={16} className="absolute left-3 top-3.5 text-gray-400" /><span className="sr-only">{thai ? 'ค้นหาสินค้า' : 'Search products'}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={thai ? 'ค้นหาชื่อสินค้า' : 'Search products'} className="min-h-11 w-full rounded-xl border border-gray-200 py-2 pl-10 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" /></label></div>
        <div data-testid="product-options-list" className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
          {filteredVariants.map((variant) => (
            <article key={variant.id} data-testid={`catalog-variant-${variant.id}`} className="rounded-xl border border-gray-200 p-3">
              <div className="flex items-start gap-3"><div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-gray-100">{getProductImages(variant)[0] ? <img src={getImageUrl(getProductImages(variant)[0], 160)} alt="" className="h-full w-full object-cover" /> : <PackageSearch className="m-4 text-gray-400" />}</div><div className="min-w-0 flex-1"><h3 className="break-words text-sm font-black text-gray-900">{variant.variant_name || variant.name}</h3>{variant.sku && <p className="mt-1 break-all font-mono text-[10px] text-gray-500">{thai ? 'รหัสสินค้า' : 'Product code'}: {variant.sku}</p>}<span className="mt-1 inline-block text-xs font-bold text-gray-600">{variant.status === 'enable' ? (thai ? 'เปิดใช้งาน' : 'Active') : variant.status === 'soldout' ? (thai ? 'ขายหมด' : 'Sold out') : (thai ? 'ปิดใช้งาน' : 'Inactive')}</span></div><p className="shrink-0 text-sm font-black text-pink-700">{formatPrice(variant.price_override ?? preview.parent.base_price, preview.parent.currency)}</p></div>
              <div className="mt-3 rounded-xl bg-gray-50 p-3">{renderVariantStock(variant, true)}</div>
              <div className="mt-3">{renderVariantActions(variant, 'card', closePreview)}</div>
            </article>
          ))}
          {filteredVariants.length === 0 && <p className="py-8 text-center text-sm text-gray-500">{thai ? 'ไม่พบตัวเลือกที่ค้นหา' : 'No matching variants'}</p>}
        </div>
        <footer className="flex shrink-0 justify-end border-t border-gray-100 p-4"><button type="button" onClick={() => { closePreview(); onEditFamily(preview); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-pink-600 px-4 text-sm font-black text-white hover:bg-pink-700"><Pencil size={16} />{thai ? 'แก้ไขตัวเลือกสินค้า' : 'Edit variants'}</button></footer>
      </section>
    </div>
  );

  const priceRange = (family: CatalogProductFamily<TVariant>) => {
    const prices = family.variants.map((variant) => variant.price_override ?? family.parent.base_price);
    const min = Math.min(...(prices.length ? prices : [family.parent.base_price]));
    const max = Math.max(...(prices.length ? prices : [family.parent.base_price]));
    return min === max ? formatPrice(min, family.parent.currency) : `${formatPrice(min, family.parent.currency)}–${formatPrice(max, family.parent.currency)}`;
  };

  if (displayMode === 'visual') {
    return (
      <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {families.map((family) => {
          const primary = family.variants[0];
          const activeCount = family.variants.filter((variant) => variant.status === 'enable').length;
          const pictureCount = new Set((primary?.variant_gallery_images != null ? primary.variant_gallery_images : [primary?.image_url || family.parent.image_url, ...(primary?.gallery_images || family.parent.gallery_images || [])]).filter(Boolean)).size;
          const bundleCount = (family.parent.bundle_items || []).reduce((sum, item) => sum + item.quantity, 0);
          return (
            <article key={family.parent.id} data-testid={family.variants.length === 1 ? `catalog-card-${primary.id}` : `catalog-family-card-${family.parent.id}`} className="overflow-visible rounded-2xl border border-gray-100 bg-white shadow-sm transition hover:border-pink-100 hover:shadow-lg hover:shadow-pink-100/50">
              <div className="relative aspect-[4/3] overflow-hidden rounded-t-2xl bg-gray-100"><ProductVisual parent={family.parent} variants={family.variants} getImageUrl={getImageUrl} language={language} /><div className="absolute left-3 top-3 flex flex-wrap gap-1.5"><span className="rounded-full bg-white/95 px-2 py-1 text-[10px] font-black text-gray-700 shadow-sm">{kindLabel(language, family.parent.product_kind)}</span>{family.parent.product_kind === 'photo' && <span className="inline-flex items-center gap-1 rounded-full bg-slate-950/80 px-2 py-1 text-[10px] font-black text-white"><Images size={11} /> {pictureCount} {uiText(language, 'pics')}</span>}{family.parent.product_kind === 'bundle' && <span className="inline-flex items-center gap-1 rounded-full bg-slate-950/80 px-2 py-1 text-[10px] font-black text-white"><Package size={11} /> {bundleCount} {uiText(language, 'items')}</span>}</div></div>
              <div className="space-y-3 p-4">
                <div className="flex flex-wrap gap-1 text-[11px] font-bold text-gray-600"><span className="rounded-full bg-pink-50 px-2 py-1 text-pink-700">{family.parent.category || (thai ? 'อื่น ๆ' : 'Other')}</span>{family.parent.tags?.map(tag => <span key={tag} className="rounded-full bg-gray-100 px-2 py-1">{tag}</span>)}</div>
                <div><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="line-clamp-2 text-base font-black text-gray-950">{family.parent.name}</h3><p className="mt-1 text-[11px] font-bold text-gray-500">{family.variants.length > 1 ? `${family.variants.length} ${thai ? 'แบบ · ' : 'variants · '}` : ''}{thai ? `เปิดใช้งาน ${activeCount}` : `${activeCount} active`}</p></div><button type="button" onClick={() => onEditFamily(family)} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-600 hover:border-pink-200 hover:text-pink-700" aria-label={uiText(language, 'Edit {name}').replace('{name}', family.parent.name)}><Pencil size={16} /></button></div><div className="mt-2 text-xl font-black text-pink-600">{priceRange(family)}</div></div>
                {family.parent.product_kind === 'bundle' && <ul className="space-y-1 rounded-xl bg-gray-50 p-3 text-xs font-semibold text-gray-600">{(family.parent.bundle_items || []).slice(0, 3).map((item, index) => <li key={`${item.name}-${index}`}>{item.name} ×{item.quantity}</li>)}</ul>}
                {family.variants.length > 1 && optionsButton(family)}
                {primary && family.variants.length === 1 && <div className="space-y-3"><div className="rounded-xl border border-gray-100 bg-gray-50 p-3">{renderVariantStock(primary, true)}</div>{renderVariantActions(primary, 'card')}</div>}
              </div>
            </article>
          );
        })}
      </div>
      {popup}
      </>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {families.flatMap(family => family.variants.map(variant => (
          <article key={variant.id} data-testid={`catalog-row-${variant.id}`} className="overflow-visible rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="grid gap-3 p-3 xl:grid-cols-[minmax(200px,1fr)_minmax(160px,1fr)_100px_120px_220px] xl:items-center">
              <div className="flex min-w-0 items-center gap-3"><div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-gray-100"><ProductVisual parent={family.parent} variants={[variant]} getImageUrl={getImageUrl} language={language} /></div><div className="min-w-0"><h3 className="break-words text-sm font-black">{variant.variant_name && variant.variant_name !== 'Default' ? variant.variant_name : family.parent.name}</h3><p className="mt-1 text-xs text-gray-500">{kindLabel(language, family.parent.product_kind)}</p></div></div>
              <div><p className="text-[10px] font-bold text-gray-500">{thai ? 'สินค้าหลัก / หมวดหมู่' : 'Main product / category'}</p><p className="break-words text-sm font-bold text-pink-800">{family.parent.name}</p><p className="text-xs text-gray-600">{family.parent.category || (thai ? 'อื่น ๆ' : 'Other')}</p></div>
              <div className="text-sm font-black text-pink-700">{formatPrice(variant.price_override ?? family.parent.base_price, family.parent.currency)}</div>
              <div>{renderVariantStock(variant, true)}</div>
              <div>{renderVariantActions(variant, 'table')}</div>
            </div>
          </article>
        )))}
      </div>
      {popup}
    </>
  );
}
