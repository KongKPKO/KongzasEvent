import { CURRENCIES } from './currency';

const FALLBACK_EVENT_TIMEZONE = 'Asia/Bangkok';

type TimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const pad = (value: number) => String(value).padStart(2, '0');

const getPartsInTimeZone = (date: Date, timeZone: string): TimeParts => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const partMap = formatter
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') {
        acc[part.type] = part.value;
      }
      return acc;
    }, {});

  return {
    year: Number(partMap.year),
    month: Number(partMap.month),
    day: Number(partMap.day),
    hour: Number(partMap.hour),
    minute: Number(partMap.minute),
    second: Number(partMap.second),
  };
};

const getTimeZoneOffsetMinutes = (date: Date, timeZone: string): number => {
  const parts = getPartsInTimeZone(date, timeZone);
  const zonedAsUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((zonedAsUtcMs - date.getTime()) / 60000);
};

export const getBrowserTimeZone = (): string => {
  try {
    const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return browserTimeZone || FALLBACK_EVENT_TIMEZONE;
  } catch {
    return FALLBACK_EVENT_TIMEZONE;
  }
};

export type TimeZoneOption = {
  value: string;
  label: string;
  currencies: string[];
};

const CURRENCY_TIME_ZONE_MAP: Record<string, string[]> = {
  THB: ['Asia/Bangkok'],
  USD: [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Phoenix',
    'Pacific/Honolulu',
  ],
  EUR: [
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Rome',
    'Europe/Madrid',
    'Europe/Amsterdam',
    'Europe/Brussels',
    'Europe/Vienna',
    'Europe/Helsinki',
    'Europe/Dublin',
    'Europe/Lisbon',
  ],
  GBP: ['Europe/London'],
  JPY: ['Asia/Tokyo'],
  SGD: ['Asia/Singapore'],
  MYR: ['Asia/Kuala_Lumpur'],
  KRW: ['Asia/Seoul'],
  CNY: ['Asia/Shanghai'],
  TWD: ['Asia/Taipei'],
  HKD: ['Asia/Hong_Kong'],
  PHP: ['Asia/Manila'],
  IDR: ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'],
  VND: ['Asia/Ho_Chi_Minh'],
  AUD: [
    'Australia/Sydney',
    'Australia/Melbourne',
    'Australia/Brisbane',
    'Australia/Adelaide',
    'Australia/Perth',
    'Australia/Darwin',
    'Australia/Hobart',
  ],
};

const humanizeTimeZone = (timeZone: string): string => timeZone.replace(/_/g, ' ');

export const getEventTimeZoneOptions = (selectedTimeZone?: string | null): TimeZoneOption[] => {
  const browserTimeZone = getBrowserTimeZone();
  const activeCurrencies = new Set(Object.keys(CURRENCIES));
  const timeZoneCurrencyMap = new Map<string, Set<string>>();

  for (const [currencyCode, timeZones] of Object.entries(CURRENCY_TIME_ZONE_MAP)) {
    if (!activeCurrencies.has(currencyCode)) continue;

    for (const timeZone of timeZones) {
      const existing = timeZoneCurrencyMap.get(timeZone) || new Set<string>();
      existing.add(currencyCode);
      timeZoneCurrencyMap.set(timeZone, existing);
    }
  }

  const ensureTimeZone = (timeZone: string, currencyCode: string) => {
    if (!timeZoneCurrencyMap.has(timeZone)) {
      timeZoneCurrencyMap.set(timeZone, new Set([currencyCode]));
    }
  };

  ensureTimeZone(FALLBACK_EVENT_TIMEZONE, 'THB');
  ensureTimeZone(browserTimeZone, 'THB');
  if (selectedTimeZone) {
    ensureTimeZone(selectedTimeZone, 'THB');
  }

  return Array.from(timeZoneCurrencyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([timeZone, currencySet]) => {
      const currencies = Array.from(currencySet).sort();
      return {
        value: timeZone,
        currencies,
        label: `${humanizeTimeZone(timeZone)} (${currencies.join(', ')})`,
      };
    });
};

export const formatDateTimeForInput = (
  dateInput: string | Date | null | undefined,
  timeZone: string
): string => {
  if (!dateInput) return '';

  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '';

  const parts = getPartsInTimeZone(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
};

export const formatDateInTimeZone = (
  dateInput: string | Date | null | undefined,
  timeZone?: string | null
): string => {
  if (!dateInput) return '';

  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '';

  const parts = getPartsInTimeZone(date, timeZone || FALLBACK_EVENT_TIMEZONE);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
};

export const parseDateTimeInputInTimeZone = (input: string, timeZone: string): Date | null => {
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  const baseUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = new Date(baseUtcMs);
  let offset = getTimeZoneOffsetMinutes(candidate, timeZone);
  candidate = new Date(baseUtcMs - offset * 60_000);

  const adjustedOffset = getTimeZoneOffsetMinutes(candidate, timeZone);
  if (adjustedOffset !== offset) {
    candidate = new Date(baseUtcMs - adjustedOffset * 60_000);
  }

  return Number.isNaN(candidate.getTime()) ? null : candidate;
};
