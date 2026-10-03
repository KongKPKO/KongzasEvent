import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { CalendarClock, Clock3, ImageOff, Images, Package, Sparkles, Users } from 'lucide-react';
import type { PresentableProduct } from '../../types/productPresentation';
import { getBundleItemCount, getProductImages, getProductPresentationKind, isProductPreorderClosed } from '../../utils/productPresentation';

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
};

const labelsByLanguage: Record<'en' | 'th', Labels> = {
  en: { photos: 'pics', bundleItems: 'items', preorder: 'Pre-order', preorderClosed: 'Pre-order closed', closes: 'Closes', eta: 'ETA', duration: 'Duration', slots: 'slots per session', service: 'Service' },
  th: { photos: 'รูป', bundleItems: 'ชิ้น', preorder: 'พรีออเดอร์', preorderClosed: 'ปิดรับพรีออเดอร์', closes: 'ปิดรับ', eta: 'พร้อมรับ/จัดส่ง', duration: 'ระยะเวลา', slots: 'คิวต่อรอบ', service: 'บริการ' },
};

const formatDate = (value: string, language: 'en' | 'th', includeTime = true) => {
  if (!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'medium',
    ...(includeTime ? { timeStyle: 'short' as const } : {}),
  }).format(date);
};

function ImageFallback({ name }: { name: string }) {
  const { language } = useI18n();
  return (
    <div role="img" aria-label={`${name}: ${language === 'th' ? 'ไม่มีภาพสินค้า' : 'Image unavailable'}`} data-testid="campaign-product-image-fallback" className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gray-100 text-gray-400">
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
              <div className="absolute inset-0 grid place-items-center bg-gray-950/65 text-xl font-black text-white" aria-label={`${overflowCount} more images`}>
                +{overflowCount}
              </div>
            )}
          </div>
        );
      })}
      {kind === 'photo' && (
        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-gray-950/75 px-2 py-1 text-[10px] font-black text-white shadow-sm" aria-label={`${images.length} product images`}>
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
  const images = getProductImages(product);
  const [selected, setSelected] = useState(0);

  useEffect(() => setSelected(0), [product.id]);

  if (images.length === 0) return <ImageFallback name={product.name} />;

  return (
    <div className="flex h-full min-h-[300px] flex-col p-4 sm:min-h-[560px] sm:p-6">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl bg-white/60">
        <img src={getImageUrl(images[selected], 1000)} alt={`${product.name} ${selected + 1}`} className="h-full max-h-[70vh] w-full object-contain" />
      </div>
      {images.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label={`${images.length} product images`}>
          {images.map((image, index) => (
            <button
              key={image}
              type="button"
              onClick={() => setSelected(index)}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 bg-white ${selected === index ? 'border-pink-500' : 'border-white'}`}
              aria-label={`View image ${index + 1} of ${images.length}`}
              aria-pressed={selected === index}
            >
              <img src={getImageUrl(image, 160)} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProductPresentationSummary({
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
    return <div className="inline-flex items-center gap-1 text-[11px] font-bold text-fuchsia-700"><Images size={13} />{images.length} {labels.photos}</div>;
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
  if (kind === 'preorder') {
    return (
      <div className="space-y-1 text-[11px] font-bold text-amber-800">
        <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1"><CalendarClock size={13} />{isProductPreorderClosed(product) ? labels.preorderClosed : labels.preorder}</div>
        {product.preorder_closes_at && <div>{labels.closes}: {formatDate(product.preorder_closes_at, language)}</div>}
        {product.preorder_eta && <div>{labels.eta}: {formatDate(product.preorder_eta, language, false)}</div>}
      </div>
    );
  }
  if (kind === 'service') {
    return (
      <div className="space-y-1 text-[11px] font-bold text-violet-800">
        <div className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-1"><Sparkles size={13} />{product.service_kind || labels.service}</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-gray-600">
          {product.service_duration_minutes ? <span className="inline-flex items-center gap-1"><Clock3 size={12} />{labels.duration} {product.service_duration_minutes} min</span> : null}
          {product.service_slots !== null && product.service_slots !== undefined ? <span className="inline-flex items-center gap-1"><Users size={12} />{product.service_slots} {labels.slots}</span> : null}
        </div>
      </div>
    );
  }
  return null;
}
