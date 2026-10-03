import { useState, type ReactNode } from 'react';
import { CalendarClock, Clock3, Images, Package, PackageSearch, Pencil, Search, Users, X } from 'lucide-react';
import type { ProductParent } from '../../types/productFamily';
import { formatPrice } from '../../utils/currency';
import { useI18n } from '../../i18n';
import { useDialogFocus } from '../../hooks/useDialogFocus';

export interface CatalogFamilyVariant {
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

const kindLabels: Record<ProductParent['product_kind'], string> = {
  single: 'Single item',
  photo: 'Photo set',
  bundle: 'Bundle',
  preorder: 'Pre-order',
  service: 'Service',
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
};

function ProductVisual<TVariant extends CatalogFamilyVariant>({ parent, variants, getImageUrl }: {
  parent: ProductParent;
  variants: TVariant[];
  getImageUrl: ProductFamilyCatalogProps<TVariant>['getImageUrl'];
}) {
  const gallery = parent.product_kind === 'photo'
    ? [parent.image_url, ...(parent.gallery_images || [])].filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index)
    : [];
  const fallbackImage = parent.image_url || variants.find((variant) => variant.image_url)?.image_url;

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

  return fallbackImage ? <img src={getImageUrl(fallbackImage, 650)} alt={parent.name} className="h-full w-full object-cover" loading="lazy" decoding="async" /> : <div className="flex h-full flex-col items-center justify-center gap-2 bg-gray-50 text-gray-400"><PackageSearch size={28} /><span className="text-xs font-black uppercase tracking-wide">Missing image</span></div>;
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
        <div className="shrink-0 p-4 pb-2"><label className="relative block"><Search size={16} className="absolute left-3 top-3.5 text-gray-400" /><span className="sr-only">{thai ? 'ค้นหาตัวเลือกหรือ SKU' : 'Search variants or SKU'}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={thai ? 'ค้นหาชื่อตัวเลือก หรือ SKU' : 'Search variant name or SKU'} className="min-h-11 w-full rounded-xl border border-gray-200 py-2 pl-10 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" /></label></div>
        <div data-testid="product-options-list" className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
          {filteredVariants.map((variant) => (
            <article key={variant.id} data-testid={`catalog-variant-${variant.id}`} className="rounded-xl border border-gray-200 p-3">
              <div className="flex items-start gap-3"><div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-gray-100">{variant.image_url || preview.parent.image_url ? <img src={getImageUrl(variant.image_url || preview.parent.image_url, 160)} alt="" className="h-full w-full object-cover" /> : <PackageSearch className="m-4 text-gray-400" />}</div><div className="min-w-0 flex-1"><h3 className="break-words text-sm font-black text-gray-900">{variant.variant_name || variant.name}</h3>{variant.sku && <p className="mt-1 break-all font-mono text-[10px] text-gray-500">SKU: {variant.sku}</p>}<span className="mt-1 inline-block text-xs font-bold text-gray-600">{variant.status === 'enable' ? (thai ? 'เปิดใช้งาน' : 'Active') : variant.status === 'soldout' ? (thai ? 'ขายหมด' : 'Sold out') : (thai ? 'ปิดใช้งาน' : 'Inactive')}</span></div><p className="shrink-0 text-sm font-black text-pink-700">{formatPrice(variant.price_override ?? preview.parent.base_price, preview.parent.currency)}</p></div>
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
          const pictureCount = new Set([family.parent.image_url, ...(family.parent.gallery_images || [])].filter(Boolean)).size;
          const bundleCount = (family.parent.bundle_items || []).reduce((sum, item) => sum + item.quantity, 0);
          return (
            <article key={family.parent.id} data-testid={family.variants.length === 1 ? `catalog-card-${primary.id}` : `catalog-family-card-${family.parent.id}`} className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition hover:border-pink-100 hover:shadow-lg hover:shadow-pink-100/50">
              <div className="relative aspect-[4/3] overflow-hidden bg-gray-100"><ProductVisual parent={family.parent} variants={family.variants} getImageUrl={getImageUrl} /><div className="absolute left-3 top-3 flex flex-wrap gap-1.5"><span className="rounded-full bg-white/95 px-2 py-1 text-[10px] font-black text-gray-700 shadow-sm">{kindLabels[family.parent.product_kind]}</span>{family.parent.product_kind === 'photo' && <span className="inline-flex items-center gap-1 rounded-full bg-slate-950/80 px-2 py-1 text-[10px] font-black text-white"><Images size={11} /> {pictureCount} pics</span>}{family.parent.product_kind === 'bundle' && <span className="inline-flex items-center gap-1 rounded-full bg-slate-950/80 px-2 py-1 text-[10px] font-black text-white"><Package size={11} /> {bundleCount} items</span>}{family.parent.product_kind === 'preorder' && <span className="rounded-full bg-amber-500 px-2 py-1 text-[10px] font-black text-white">PRE-ORDER</span>}</div></div>
              <div className="space-y-3 p-4">
                <div><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="line-clamp-2 text-base font-black text-gray-950">{family.parent.name}</h3><p className="mt-1 text-[11px] font-bold text-gray-500">{family.variants.length > 1 ? `${family.variants.length} ${thai ? 'แบบ · ' : 'variants · '}` : ''}{thai ? `เปิดใช้งาน ${activeCount}` : `${activeCount} active`}</p></div><button type="button" onClick={() => onEditFamily(family)} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-600 hover:border-pink-200 hover:text-pink-700" aria-label={`Edit ${family.parent.name}`}><Pencil size={16} /></button></div><div className="mt-2 text-xl font-black text-pink-600">{priceRange(family)}</div></div>
                {family.parent.product_kind === 'bundle' && <ul className="space-y-1 rounded-xl bg-gray-50 p-3 text-xs font-semibold text-gray-600">{(family.parent.bundle_items || []).slice(0, 3).map((item, index) => <li key={`${item.name}-${index}`}>{item.name} ×{item.quantity}</li>)}</ul>}
                {family.parent.product_kind === 'preorder' && <div className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-900">{family.parent.preorder_closes_at && <div className="flex items-center gap-1.5"><CalendarClock size={14} /> Closes {formatDateTime(family.parent.preorder_closes_at)}</div>}{family.parent.preorder_eta && <div className="mt-1 text-amber-700">ETA {family.parent.preorder_eta}</div>}</div>}
                {family.parent.product_kind === 'service' && <div className="flex flex-wrap gap-2 rounded-xl bg-violet-50 p-3 text-xs font-black text-violet-800">{family.parent.service_duration_minutes != null && <span className="inline-flex items-center gap-1"><Clock3 size={14} /> {family.parent.service_duration_minutes} min</span>}{family.parent.service_slots != null && <span className="inline-flex items-center gap-1"><Users size={14} /> {family.parent.service_slots} slots</span>}</div>}
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
      {families.map((family) => {
        const primary = family.variants[0];
        const totalStock = family.variants.some((variant) => variant.is_unlimited) ? 'Unlimited' : family.variants.reduce((sum, variant) => sum + Number(variant.stock_total || 0), 0);
        return (
          <article key={family.parent.id} data-testid={family.variants.length === 1 ? `catalog-row-${primary.id}` : `catalog-family-row-${family.parent.id}`} className="overflow-visible rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="grid items-center gap-3 p-3 md:grid-cols-[minmax(260px,1.5fr)_110px_130px_110px_210px]">
              <div className="flex min-w-0 items-center gap-3"><div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-gray-100"><ProductVisual parent={family.parent} variants={family.variants} getImageUrl={getImageUrl} /></div><div className="min-w-0"><h3 className="truncate text-sm font-black text-gray-900">{family.parent.name}</h3><p className="mt-0.5 text-[11px] font-bold text-gray-500">{family.variants.length > 1 ? `${family.variants.length} ${thai ? 'แบบ · ' : 'variants · '}` : ''}{kindLabels[family.parent.product_kind]}</p></div></div>
              <div><span className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600">{family.parent.category || 'Other'}</span></div>
              <div className="text-sm font-black text-pink-700">{priceRange(family)}</div>
              <div className="text-sm font-black text-gray-800">{totalStock}</div>
              <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={() => onEditFamily(family)} aria-label={`Edit ${family.parent.name}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-pink-200 px-3 text-xs font-black text-pink-700 hover:bg-pink-50"><Pencil size={14} />{thai ? 'แก้ไขสินค้า' : 'Edit product'}</button>{family.variants.length > 1 && optionsButton(family)}</div>
            </div>
            {family.variants.length === 1 && primary && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 p-3"><div>{renderVariantStock(primary, true)}</div>{renderVariantActions(primary, 'table')}</div>}
          </article>
        );
      })}
    </div>
    {popup}
    </>
  );
}
