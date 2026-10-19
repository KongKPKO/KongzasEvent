import { expect, test } from '@playwright/test';
import { resolveQueueAvailability } from '../lib/queueAvailability';

test('queue availability distinguishes booth closed, queue paused, and accepting', () => {
  expect(resolveQueueAvailability({ hasActiveEvent: true, isBoothOpen: false, isQueueOpen: false }).state).toBe('booth-closed');
  expect(resolveQueueAvailability({ hasActiveEvent: true, isBoothOpen: true, isQueueOpen: false, broadcastMessage: 'พัก 10 นาที' })).toEqual({
    state: 'queue-paused', acceptsTickets: false, pauseReason: 'พัก 10 นาที',
  });
  expect(resolveQueueAvailability({ hasActiveEvent: true, isBoothOpen: true, isQueueOpen: true }).acceptsTickets).toBe(true);
});


test('queue intake follows the event window even when post-order booth flags stay open', () => {
  const now = Date.parse('2026-10-19T12:00:00+07:00');
  const base = { hasActiveEvent: true, isBoothOpen: true, isQueueOpen: true, eventStatus: 'Confirmed', eventStartsAt: '2026-10-18T10:00:00+07:00', eventEndsAt: '2026-10-18T18:00:00+07:00', now };
  expect(resolveQueueAvailability(base)).toEqual({ state: 'event-ended', acceptsTickets: false, pauseReason: null });
  expect(resolveQueueAvailability({ ...base, eventStatus: 'Ended', eventEndsAt: '2026-10-20T18:00:00+07:00' }).acceptsTickets).toBe(false);
  expect(resolveQueueAvailability({ ...base, eventStartsAt: '2026-10-20T10:00:00+07:00', eventEndsAt: '2026-10-20T18:00:00+07:00' }).acceptsTickets).toBe(false);
  expect(resolveQueueAvailability({ ...base, eventEndsAt: '2026-10-19T18:00:00+07:00' }).acceptsTickets).toBe(true);
});
