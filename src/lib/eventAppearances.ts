import type { EventAppearance, EventAppearanceDraft } from '../types/eventAppearance';

export const toDateInputValue = (value: string, timeZone = 'Asia/Bangkok') => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

export const normalizeAppearanceTime = (value?: string | null) => value ? value.slice(0, 5) : '';

export const createEmptyAppearanceDraft = (
  defaultDate: string,
  defaults?: { booth?: string | null; zone?: string | null }
): EventAppearanceDraft => ({
  character_name: '',
  series_name: '',
  image_url: '',
  appearance_date: defaultDate,
  day_label: '',
  start_time: '',
  end_time: '',
  note: '',
  booth: defaults?.booth || '',
  zone: defaults?.zone || '',
  is_public: true,
});

export const appearanceToDraft = (appearance: EventAppearance): EventAppearanceDraft => ({
  character_name: appearance.character_name,
  series_name: appearance.series_name || '',
  image_url: appearance.image_url || '',
  appearance_date: appearance.appearance_date,
  day_label: appearance.day_label || '',
  start_time: normalizeAppearanceTime(appearance.start_time),
  end_time: normalizeAppearanceTime(appearance.end_time),
  note: appearance.note || '',
  booth: appearance.booth || '',
  zone: appearance.zone || '',
  is_public: appearance.is_public,
});

export const validateAppearanceDraft = (
  draft: EventAppearanceDraft,
  dateRange: { min: string; max: string }
): string | null => {
  if (!draft.character_name.trim()) return 'Add a character or look name.';
  if (!draft.appearance_date) return 'Choose an appearance date.';
  if (draft.appearance_date < dateRange.min || draft.appearance_date > dateRange.max) {
    return 'Appearance date must be within the event dates.';
  }
  if (draft.start_time && draft.end_time && draft.end_time <= draft.start_time) {
    return 'End time must be later than start time.';
  }
  return null;
};

export const formatAppearanceTimeRange = (appearance: Pick<EventAppearance, 'start_time' | 'end_time'>) => {
  const start = normalizeAppearanceTime(appearance.start_time);
  const end = normalizeAppearanceTime(appearance.end_time);
  if (start && end) return `${start}–${end}`;
  if (start) return `From ${start}`;
  if (end) return `Until ${end}`;
  return '';
};

export const sortEventAppearances = (appearances: EventAppearance[]) =>
  [...appearances].sort((left, right) => left.appearance_date.localeCompare(right.appearance_date)
    || (normalizeAppearanceTime(left.start_time) || '00:00').localeCompare(normalizeAppearanceTime(right.start_time) || '00:00')
    || (left.sort_order || 0) - (right.sort_order || 0)
    || (left.created_at || '').localeCompare(right.created_at || ''));
