import { expect, test } from '@playwright/test';
import { resolveQueueAvailability } from '../lib/queueAvailability';

test('queue availability distinguishes booth closed, queue paused, and accepting', () => {
  expect(resolveQueueAvailability({ hasActiveEvent: true, isBoothOpen: false, isQueueOpen: false }).state).toBe('booth-closed');
  expect(resolveQueueAvailability({ hasActiveEvent: true, isBoothOpen: true, isQueueOpen: false, broadcastMessage: 'พัก 10 นาที' })).toEqual({
    state: 'queue-paused', acceptsTickets: false, pauseReason: 'พัก 10 นาที',
  });
  expect(resolveQueueAvailability({ hasActiveEvent: true, isBoothOpen: true, isQueueOpen: true }).acceptsTickets).toBe(true);
});
