export interface PosProductLike {
  id: string;
  name: string;
  category?: string | null;
  tags?: string[];
  stock_total?: number | null;
  stock_reserved?: number;
  stock_sold?: number;
  is_unlimited?: boolean;
}

export interface PromoHint {
  id: string;
  label: string;
  shortLabel: string;
  helper: string;
  tone: 'rose' | 'amber' | 'emerald' | 'sky';
}

export interface CartPromoInsight {
  id: string;
  label: string;
  status: 'progress' | 'ready';
  message: string;
}

const normalize = (value?: string | null) => (value || '').trim().toLowerCase();

export const getCatalogGroup = (category?: string | null) => {
  const normalized = normalize(category);

  if (normalized.includes('photo')) return 'Photocard';
  if (normalized.includes('poro') || normalized.includes('pola')) return 'Polaroid';
  if (normalized.includes('sticker')) return 'Sticker';
  if (normalized.includes('charm') && normalized.includes('keychain')) return 'Charm keychain';
  if (normalized.includes('couple') && normalized.includes('keyring')) return 'Couple keyring';
  if (normalized.includes('carabiner')) return 'Carabiner';
  if (normalized.includes('hairclip') || normalized.includes('hair clip')) return 'Hairclip';
  if (normalized.includes('keychain')) return 'Keychain';
  if (normalized.includes('keyring')) return 'Keyring';
  if (normalized.includes('poster')) return 'Poster';
  if (normalized.includes('standee')) return 'Standee';
  if (normalized.includes('shaker')) return 'Shaker';
  if (normalized.includes('add on') || normalized.includes('add-on') || normalized.includes('character')) return 'Add-on';

  return category?.trim() || 'Other';
};

export const getPromoHint = (product: PosProductLike): PromoHint | null => {
  const normalizedCategory = normalize(product.category);
  const normalizedName = normalize(product.name);
  const haystack = `${normalizedCategory} ${normalizedName}`;

  if (haystack.includes('photocard')) {
    return {
      id: 'photocard-3-for-130',
      label: 'Photocard 3 for 130',
      shortLabel: '3 for 130',
      helper: 'Auto-group 3 photocard items when pricing engine is enabled.',
      tone: 'rose',
    };
  }

  if (haystack.includes('polaroid') || haystack.includes('poraloid')) {
    return {
      id: 'polaroid-3-for-100',
      label: 'Polaroid 3 for 100',
      shortLabel: '3 for 100',
      helper: 'Track progress in cart so staff can close the set fast.',
      tone: 'amber',
    };
  }

  if (
    haystack.includes('otaku a6 sticker') ||
    haystack.includes('oc sticker') ||
    haystack.includes('half a6 sticker')
  ) {
    return {
      id: 'sticker-5-get-1',
      label: 'Sticker 5 get 1',
      shortLabel: '5 + 1',
      helper: 'Count six stickers in the same promo family and mark one free item.',
      tone: 'emerald',
    };
  }

  if (haystack.includes('shaker')) {
    return {
      id: 'shaker-free-addon',
      label: 'Free add-on character',
      shortLabel: 'Free add-on',
      helper: 'Every shaker should trigger one add-on character selection.',
      tone: 'sky',
    };
  }

  return null;
};

export const getAvailableUnits = (product: PosProductLike) => {
  if (product.is_unlimited) return Number.POSITIVE_INFINITY;
  const total = product.stock_total || 0;
  const reserved = product.stock_reserved || 0;
  const sold = product.stock_sold || 0;
  return Math.max(0, total - reserved - sold);
};

export const getLowStockThreshold = (product: PosProductLike) => {
  const group = getCatalogGroup(product.category);
  if (group === 'Photocard' || group === 'Polaroid' || group === 'Sticker') return 10;
  return 3;
};

export const isLowStock = (product: PosProductLike) => {
  if (product.is_unlimited) return false;
  const available = getAvailableUnits(product);
  return available <= getLowStockThreshold(product);
};

export const getCartPromoInsights = (
  cart: Array<{ product: PosProductLike; quantity: number }>
): CartPromoInsight[] => {
  const totals = {
    photocard: 0,
    polaroid: 0,
    otakuSticker: 0,
    ocSticker: 0,
    halfSticker: 0,
    shaker: 0,
    addon: 0,
  };

  for (const item of cart) {
    const haystack = `${normalize(item.product.category)} ${normalize(item.product.name)}`;
    if (haystack.includes('photocard')) totals.photocard += item.quantity;
    if (haystack.includes('polaroid') || haystack.includes('poraloid')) totals.polaroid += item.quantity;
    if (haystack.includes('otaku a6 sticker')) totals.otakuSticker += item.quantity;
    if (haystack.includes('oc sticker')) totals.ocSticker += item.quantity;
    if (haystack.includes('half a6 sticker')) totals.halfSticker += item.quantity;
    if (haystack.includes('shaker')) totals.shaker += item.quantity;
    if (haystack.includes('add on') || haystack.includes('add-on') || haystack.includes('character')) totals.addon += item.quantity;
  }

  const insights: CartPromoInsight[] = [];

  const addBundleInsight = (id: string, label: string, qty: number, size: number) => {
    if (qty <= 0) return;
    const remainder = qty % size;
    const needed = remainder === 0 ? 0 : size - remainder;
    insights.push({
      id,
      label,
      status: needed === 0 ? 'ready' : 'progress',
      message: needed === 0
        ? `${qty} items selected. Bundle is ready for checkout.`
        : `Add ${needed} more item${needed > 1 ? 's' : ''} to complete the bundle.`,
    });
  };

  const addFreeItemInsight = (id: string, label: string, qty: number) => {
    if (qty <= 0) return;
    const remainder = qty % 6;
    const needed = remainder === 0 ? 0 : 6 - remainder;
    insights.push({
      id,
      label,
      status: needed === 0 ? 'ready' : 'progress',
      message: needed === 0
        ? `${qty} items selected. One free item should be applied in this group.`
        : `Add ${needed} more item${needed > 1 ? 's' : ''} to unlock the free sticker.`,
    });
  };

  addBundleInsight('photocard-3-for-130', 'Photocard 3 for 130', totals.photocard, 3);
  addBundleInsight('polaroid-3-for-100', 'Polaroid 3 for 100', totals.polaroid, 3);
  addFreeItemInsight('otaku-sticker-5-get-1', 'Otaku A6 Sticker 5 get 1', totals.otakuSticker);
  addFreeItemInsight('oc-sticker-5-get-1', 'OC Sticker 5 get 1', totals.ocSticker);
  addFreeItemInsight('half-sticker-5-get-1', 'Half A6 Sticker 5 get 1', totals.halfSticker);

  if (totals.shaker > 0) {
    const missingAddons = Math.max(0, totals.shaker - totals.addon);
    insights.push({
      id: 'shaker-addon',
      label: 'Shaker free add-on',
      status: missingAddons === 0 ? 'ready' : 'progress',
      message: missingAddons === 0
        ? 'Every shaker in cart already has enough add-on characters.'
        : `Select ${missingAddons} more add-on character${missingAddons > 1 ? 's' : ''} to complete shaker freebies.`,
    });
  }

  return insights;
};
