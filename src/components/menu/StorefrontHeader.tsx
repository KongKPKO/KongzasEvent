import type { ReactNode } from 'react';
import { Heart, ImageOff, Sparkles, Star } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../i18n';
import { getMenuImageUrl } from '../../utils/imageUtils';

export function ShopImage({ src, name, className = '', eager = false }: { src?: string | null; name: string; className?: string; eager?: boolean }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const { language } = useI18n();
  if (!src || failedSource === src) return <div role="img" aria-label={`${name}: ${language === 'th' ? 'ไม่มีภาพสินค้า' : 'Image unavailable'}`} className={`shop-image-fallback ${className}`}><ImageOff size={28} aria-hidden="true" /></div>;
  return <img src={getMenuImageUrl(src)} alt={name} className={className} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailedSource(src)} />;
}

export default function StorefrontHeader({ name, bio, avatar, artworks = [], children }: {
  name: string; bio?: string | null; avatar?: string | null; artworks?: Array<{ id: string; name: string; image_url?: string | null }>; children?: ReactNode;
}) {
  const { language } = useI18n();
  const pictures = artworks.filter(product => product.image_url).slice(0, 3);
  return <section className="shop-intro">
    {pictures.length > 0 && <div className="shop-artwork" aria-hidden="true">
      <Heart className="shop-banner-heart" size={28} fill="currentColor" />
      <Sparkles className="shop-banner-sparkles" size={32} />
      <div className="shop-banner-confetti">{[0, 1, 2, 3, 4, 5].map(index => <Star key={index} className={`shop-confetti shop-confetti-${index}`} size={18} fill="currentColor" />)}</div>
      <span className="shop-artwork-caption">{language === 'th' ? 'ผลงานจากครีเอเตอร์' : 'Made by a creator'}<Heart size={20} fill="currentColor" /></span>
      <span className="shop-artwork-note">{language === 'th' ? 'ชิ้นเล็ก ๆ เติมสีให้ทุกวัน' : 'Little things, brighter days'}<Sparkles size={20} /></span>
      <div className="shop-artwork-pictures">{pictures.map(product => <div className="shop-print" key={product.id}><ShopImage src={product.image_url} name="" eager /></div>)}</div>
    </div>}
    <div className="shop-identity">
      {avatar ? <ShopImage src={avatar} name={name} className="shop-avatar" eager /> : <span className="shop-avatar shop-initial" aria-hidden="true">{name.charAt(0)}</span>}
      <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-pink-800">{language === 'th' ? 'ร้านครีเอเตอร์' : 'Creator shop'}</p><h1 className="shop-name">{name}</h1>{bio && <p className="mt-2 whitespace-pre-line break-words text-sm leading-6 text-gray-600">{bio}</p>}</div>
    </div>
    {children && <div className="shop-channels">{children}</div>}
  </section>;
}
