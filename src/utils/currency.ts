// Currency utility for multi-currency support
// Each product can have its own currency

export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
  position: 'before' | 'after';  // Symbol position relative to amount
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  THB: { code: 'THB', symbol: '฿', name: 'Thai Baht', position: 'before' },
  USD: { code: 'USD', symbol: '$', name: 'US Dollar', position: 'before' },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro', position: 'before' },
  GBP: { code: 'GBP', symbol: '£', name: 'British Pound', position: 'before' },
  JPY: { code: 'JPY', symbol: '¥', name: 'Japanese Yen', position: 'before' },
  SGD: { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', position: 'before' },
  MYR: { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit', position: 'before' },
  KRW: { code: 'KRW', symbol: '₩', name: 'Korean Won', position: 'before' },
  CNY: { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', position: 'before' },
  TWD: { code: 'TWD', symbol: 'NT$', name: 'Taiwan Dollar', position: 'before' },
  HKD: { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar', position: 'before' },
  PHP: { code: 'PHP', symbol: '₱', name: 'Philippine Peso', position: 'before' },
  IDR: { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah', position: 'before' },
  VND: { code: 'VND', symbol: '₫', name: 'Vietnamese Dong', position: 'after' },
  AUD: { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', position: 'before' },
};

export const DEFAULT_CURRENCY = 'THB';

/**
 * Get currency symbol from currency code
 */
export function getCurrencySymbol(currencyCode?: string | null): string {
  const code = currencyCode || DEFAULT_CURRENCY;
  return CURRENCIES[code]?.symbol || code;
}

/**
 * Format price with currency symbol
 * @param amount - The price amount
 * @param currencyCode - Currency code (e.g., 'THB', 'USD')
 * @returns Formatted price string (e.g., '฿1,500', '$50')
 */
export function formatPrice(amount: number, currencyCode?: string | null): string {
  const code = currencyCode || DEFAULT_CURRENCY;
  const currency = CURRENCIES[code] || CURRENCIES[DEFAULT_CURRENCY];
  const formattedAmount = amount.toLocaleString();
  
  if (currency.position === 'after') {
    return `${formattedAmount}${currency.symbol}`;
  }
  return `${currency.symbol}${formattedAmount}`;
}

/**
 * Get list of available currencies for dropdown
 */
export function getCurrencyOptions(): { value: string; label: string }[] {
  return Object.values(CURRENCIES).map(c => ({
    value: c.code,
    label: `${c.symbol} ${c.code} - ${c.name}`
  }));
}
