import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X, ImageOff, Images, Package } from 'lucide-react';
import type { PresentableProduct } from '../../types/productPresentation';
import { getBundleItemCount, getProductImages, getProductPresentationKind } from '../../utils/productPresentation';
import { uiText, useI18n } from '../../i18n';

type Labels = {
  photos: string;
  bundleItems: string;
  preorder: string;
  preorderClosed: string;
  closes: string;
  eta: string;
  duration: string;
  slots: string;
  service: string;
  minutes: string;
};

const labelsByLanguage: Record<'en' | 'th', Labels> = {
  en: { photos: 'pics', bundleItems: 'items', preorder: 'Pre-order', preorderClosed: 'Pre-order closed', closes: 'Closes', eta: 'ETA', duration: 'Duration', slots: 'slots per session', service: 'Service', minutes: 'min' },
  th: { photos: 'รูป', bundleItems: 'ชิ้น', preorder: 'พรีออเดอร์', preorderClosed: 'ปิดรับพรีออเดอร์', closes: 'ปิดรับ', eta: 'พร้อมรับ/จัดส่ง', duration: 'ระยะเวลา', slots: 'คิวต่อรอบ', service: 'บริการ', minutes: 'นาที' },
};

function ImageFallback({ name }: { name: string }) {
  const { language } = useI18n();
  return (
    <div
      role="img"
      aria-label={`${name}: ${language === 'th' ? 'ไม่มีภาพสินค้า' : 'Image unavailable'}`}
      data-testid="campaign-product-image-fallback"
      className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gray-100 text-gray-400"
    >
      <ImageOff size={26} strokeWidth={1.8} aria-hidden="true" />
      <span className="max-w-[80%] truncate text-xs font-black text-gray-500">{name.charAt(0).toUpperCase()}</span>
    </div>
  );
}

export function ProductMedia({
  product,
  getImageUrl,
  eager = false,
}: {
  product: PresentableProduct;
  getImageUrl: (value: string, width?: number) => string;
  eager?: boolean;
}) {
  const { language } = useI18n();
  const kind = getProductPresentationKind(product);
  const images = getProductImages(product);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const visibleImages = kind === 'photo' ? images.slice(0, 4) : images.slice(0, 1);
  const gridClass = visibleImages.length === 1
    ? 'grid-cols-1'
    : visibleImages.length === 2
      ? 'grid-cols-2'
      : 'grid-cols-2 grid-rows-2';

  if (visibleImages.length === 0) return <ImageFallback name={product.name} />;

  return (
    <div className={`grid h-full w-full gap-0.5 bg-pink-100 ${gridClass}`}>
      {visibleImages.map((image, index) => {
        const overflowCount = images.length > 4 && index === 3 ? images.length - 4 : 0;
        return (
          <div key={image} className="relative min-h-0 min-w-0 overflow-hidden bg-pink-50">
            {failedImages[image] ? <ImageFallback name={product.name} /> : (
              <img
                src={getImageUrl(image, 360)}
                alt={`${product.name}${images.length > 1 ? ` ${index + 1}` : ''}`}
                loading={eager && index === 0 ? 'eager' : 'lazy'}
                className="h-full w-full object-cover"
                onError={() => setFailedImages((current) => ({ ...current, [image]: true }))}
              />
            )}
            {overflowCount > 0 && (
              <div className="absolute inset-0 grid place-items-center bg-gray-950/65 text-xl font-black text-white" aria-label={`${overflowCount} ${uiText(language, 'more images')}`}>
                +{overflowCount}
              </div>
            )}
          </div>
        );
      })}
      {kind === 'photo' && (
        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-gray-950/75 px-2 py-1 text-[10px] font-black text-white shadow-sm" aria-label={`${images.length} ${uiText(language, 'product images')}`}>
          <Images size={12} aria-hidden="true" /> {images.length}
        </span>
      )}
    </div>
  );
}

export function ProductGallery({
  product,
  getImageUrl,
}: {
  product: PresentableProduct;
  getImageUrl: (value: string, width?: number) => string;
}) {
  const { language } = useI18n();
  const images = getProductImages(product);
  const [selected, setSelected] = useState(0);
  const preview = useRef<HTMLDialogElement>(null);
  const touchStart = useRef<number | null>(null);
  const move = (delta: number) => setSelected(current => (current + delta + images.length) % images.length);
  const previewLabel = language === 'th' ? 'ดูภาพใหญ่' : 'Preview image';

  useEffect(() => setSelected(0), [product.id, images.length]);

  if (images.length === 0) return <ImageFallback name={product.name} />;

  return (
    <div className="flex h-full min-h-[300px] flex-col p-4 sm:min-h-[560px] sm:p-6">
      <button type="button" aria-label={previewLabel} onClick={() => preview.current?.showModal()} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl bg-white/60">
        <img src={getImageUrl(images[selected] || images[0], 1000)} alt={`${product.name} ${selected + 1}`} className="h-full max-h-[70vh] w-full object-contain" />
      </button>
      {images.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label={`${images.length} ${uiText(language, 'product images')}`}>
          {images.map((image, index) => (
            <button
              key={image}
              type="button"
              onClick={() => setSelected(index)}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 bg-white ${selected === index ? 'border-pink-500' : 'border-white'}`}
              aria-label={`${uiText(language, 'View image')} ${index + 1} ${uiText(language, 'of')} ${images.length}`}
              aria-pressed={selected === index}
            >
              <img src={getImageUrl(image, 160)} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <dialog ref={preview} className="shop-image-preview" aria-label={previewLabel}
        onCancel={event => event.stopPropagation()}
        onClick={event => { if (event.target === event.currentTarget) preview.current?.close(); }}
        onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1); } }}>
        <button type="button" autoFocus className="shop-preview-close" aria-label={language === 'th' ? 'ปิดภาพใหญ่' : 'Close image preview'} onClick={() => preview.current?.close()}><X /></button>
        <div className="shop-preview-stage" onTouchStart={event => { touchStart.current = event.touches[0].clientX; }} onTouchEnd={event => {
          if (touchStart.current !== null) { const distance = event.changedTouches[0].clientX - touchStart.current; if (Math.abs(distance) > 40) move(distance < 0 ? 1 : -1); }
          touchStart.current = null;
        }}>
          <img src={getImageUrl(images[selected] || images[0], 1800)} alt={`${product.name} ${selected + 1}`} />
          {images.length > 1 && <><button type="button" className="shop-preview-previous" aria-label={language === 'th' ? 'ภาพก่อนหน้า' : 'Previous image'} onClick={() => move(-1)}><ChevronLeft /></button><button type="button" className="shop-preview-next" aria-label={language === 'th' ? 'ภาพถัดไป' : 'Next image'} onClick={() => move(1)}><ChevronRight /></button></>}
        </div>
        <p className="shop-preview-count" aria-live="polite">{selected + 1} / {images.length}</p>
      </dialog>
    </div>
  );
}

function ProductKindSummary({
  product,
  language = 'en',
  compact = false,
}: {
  product: PresentableProduct;
  language?: 'en' | 'th';
  compact?: boolean;
}) {
  const labels = labelsByLanguage[language];
  const kind = getProductPresentationKind(product);
  const images = getProductImages(product);
  const itemCount = getBundleItemCount(product.bundle_items);

  if (kind === 'photo') {
    return <div className="inline-flex items-center gap-1 text-[11px] font-bold text-pink-700"><Images size={13} />{images.length} {labels.photos}</div>;
  }
  if (kind === 'bundle') {
    return (
      <div className="text-[11px] font-bold text-indigo-700">
        <div className="inline-flex items-center gap-1"><Package size={13} />{itemCount} {labels.bundleItems}</div>
        {!compact && product.bundle_items?.length ? (
          <ul className="mt-2 space-y-1 text-xs font-semibold text-gray-600">
            {product.bundle_items.map((item, index) => <li key={`${item.name}-${index}`}>{item.name} × {item.quantity}</li>)}
          </ul>
        ) : null}
      </div>
    );
  }
  return null;
}


export function ProductPresentationSummary(props: { product: PresentableProduct; language?: 'en' | 'th'; compact?: boolean }) {
  return <div className="space-y-1">
    {props.product.supply_mode === 'production' && <p className="text-xs font-bold text-amber-800">{props.language === 'th' ? 'รับสั่งผลิต' : 'Made to order'}</p>}
    <ProductKindSummary {...props} />
  </div>;
}
