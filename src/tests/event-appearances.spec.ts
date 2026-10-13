import { expect, test } from '@playwright/test';
import {
  createEmptyAppearanceDraft,
  formatAppearanceTimeRange,
  sortEventAppearances,
  validateAppearanceDraft,
} from '../lib/eventAppearances';
import type { EventAppearance } from '../types/eventAppearance';

test.describe('event appearance model', () => {
  test('validates the event date and time range', () => {
    const draft = createEmptyAppearanceDraft('2026-10-03');
    expect(validateAppearanceDraft(draft, { min: '2026-10-03', max: '2026-10-04' })).toBe('Add a character or look name.');

    draft.character_name = 'Frieren';
    draft.appearance_date = '2026-10-05';
    expect(validateAppearanceDraft(draft, { min: '2026-10-03', max: '2026-10-04' })).toBe('Appearance date must be within the event dates.');

    draft.appearance_date = '2026-10-04';
    draft.start_time = '14:00';
    draft.end_time = '12:00';
    expect(validateAppearanceDraft(draft, { min: '2026-10-03', max: '2026-10-04' })).toBe('End time must be later than start time.');

    draft.end_time = '16:00';
    expect(validateAppearanceDraft(draft, { min: '2026-10-03', max: '2026-10-04' })).toBeNull();
  });

  test('sorts appearances by date, time, then creator order', () => {
    const base: Omit<EventAppearance, 'id' | 'appearance_date' | 'start_time' | 'sort_order'> = {
      artist_id: 'artist',
      event_id: 'event',
      character_name: 'Look',
      is_public: true,
    };
    const appearances: EventAppearance[] = [
      { ...base, id: 'late', appearance_date: '2026-10-04', start_time: '10:00', sort_order: 0 },
      { ...base, id: 'second', appearance_date: '2026-10-03', start_time: '11:00', sort_order: 1 },
      { ...base, id: 'first', appearance_date: '2026-10-03', start_time: '09:00', sort_order: 2 },
    ];

    expect(sortEventAppearances(appearances).map((appearance) => appearance.id)).toEqual(['first', 'second', 'late']);
    expect(formatAppearanceTimeRange(appearances[2])).toBe('From 09:00');
  });
});
