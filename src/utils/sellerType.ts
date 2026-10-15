export const SELLER_TYPES = ['creator', 'cosplayer', 'shop'] as const;
export type SellerType = typeof SELLER_TYPES[number];

export function normalizeSellerType(value: unknown): SellerType {
  return value === 'cosplayer' || value === 'shop' ? value : 'creator';
}

export function getSellerLabels(value: unknown, language: 'th' | 'en') {
  const type = normalizeSellerType(value);
  if (language === 'th') {
    return type === 'shop'
      ? { person: 'ผู้ขาย', shop: 'ร้านค้า', artwork: 'สินค้า' }
      : type === 'cosplayer'
        ? { person: 'คอสเพลย์เยอร์', shop: 'ร้านคอสเพลย์เยอร์', artwork: 'ผลงานจากคอสเพลย์เยอร์' }
        : { person: 'ครีเอเตอร์', shop: 'ร้านครีเอเตอร์', artwork: 'ผลงานจากครีเอเตอร์' };
  }
  return type === 'shop'
    ? { person: 'Seller', shop: 'Shop', artwork: 'Products' }
    : type === 'cosplayer'
      ? { person: 'Cosplayer', shop: 'Cosplayer shop', artwork: 'Works by a cosplayer' }
      : { person: 'Creator', shop: 'Creator shop', artwork: 'Made by a creator' };
}
