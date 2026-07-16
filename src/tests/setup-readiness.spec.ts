import { expect, test } from '@playwright/test';
import { deriveSetupReadiness } from '../lib/setupReadiness';

const readyInput = {
  profile: { displayName: 'Nireq Creator', slug: 'nireq-creator', contact: 'creator@example.com' },
  event: {
    status: 'Confirmed', startDate: '2026-07-20', endDate: '2026-07-21', timezone: 'Asia/Bangkok', location: 'Hall A', booth: 'A12', queueArea: '', preorderEnabled: false, postorderEnabled: false,
  },
  sellingProductCount: 1,
  hasPaymentInstructions: false,
  hasPickupInstructions: false,
  isPublished: false,
};

test('guided setup derives its next step from domain data', () => {
  const initial = deriveSetupReadiness({ ...readyInput, profile: { displayName: '', slug: '', contact: '' }, sellingProductCount: 0 });
  expect(initial.nextStep?.id).toBe('profile');
  expect(initial.steps).toHaveLength(5);

  const readyToPublish = deriveSetupReadiness(readyInput);
  expect(readyToPublish.nextStep?.id).toBe('publish');

  const published = deriveSetupReadiness({ ...readyInput, isPublished: true });
  expect(published.complete).toBe(true);
});

test('payment and pickup are required only for timed ordering', () => {
  const timed = deriveSetupReadiness({
    ...readyInput,
    event: { ...readyInput.event, preorderEnabled: true },
  });
  expect(timed.nextStep?.id).toBe('payment');

  const configured = deriveSetupReadiness({
    ...readyInput,
    event: { ...readyInput.event, preorderEnabled: true },
    hasPaymentInstructions: true,
    hasPickupInstructions: true,
  });
  expect(configured.nextStep?.id).toBe('publish');
});
