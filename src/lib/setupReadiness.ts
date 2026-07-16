export type SetupStepId = 'profile' | 'event' | 'catalog' | 'payment' | 'publish';

export interface SetupReadinessInput {
  profile: {
    displayName?: string | null;
    slug?: string | null;
    contact?: string | null;
  };
  event: {
    status?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    timezone?: string | null;
    location?: string | null;
    booth?: string | null;
    queueArea?: string | null;
    preorderEnabled?: boolean | null;
    postorderEnabled?: boolean | null;
  };
  sellingProductCount: number;
  hasPaymentInstructions: boolean;
  hasPickupInstructions: boolean;
  isPublished: boolean;
}

export interface SetupReadinessStep {
  id: SetupStepId;
  title: string;
  detail: string;
  complete: boolean;
  required: boolean;
}

export interface SetupReadiness {
  steps: SetupReadinessStep[];
  complete: boolean;
  nextStep: SetupReadinessStep | null;
}

const hasText = (value?: string | null) => Boolean(value?.trim());

export function deriveSetupReadiness(input: SetupReadinessInput): SetupReadiness {
  const timedOrdering = Boolean(input.event.preorderEnabled || input.event.postorderEnabled);
  const profileComplete = hasText(input.profile.displayName) && hasText(input.profile.slug) && hasText(input.profile.contact);
  const eventComplete = input.event.status === 'Confirmed'
    && hasText(input.event.startDate)
    && hasText(input.event.endDate)
    && hasText(input.event.timezone)
    && hasText(input.event.location)
    && (hasText(input.event.booth) || hasText(input.event.queueArea));
  const catalogComplete = input.sellingProductCount > 0;
  const paymentComplete = !timedOrdering || (input.hasPaymentInstructions && input.hasPickupInstructions);
  const readyToPublish = profileComplete && eventComplete && catalogComplete && paymentComplete;

  const steps: SetupReadinessStep[] = [
    { id: 'profile', title: 'Booth profile', detail: profileComplete ? 'Name, public URL, and contact are ready' : 'Add booth name, public URL, and contact', complete: profileComplete, required: true },
    { id: 'event', title: 'Event details', detail: eventComplete ? 'Date, timezone, location, and customer meeting point are ready' : 'Confirm date, timezone, location, and booth or queue area', complete: eventComplete, required: true },
    { id: 'catalog', title: 'Products and stock', detail: catalogComplete ? `${input.sellingProductCount} product${input.sellingProductCount === 1 ? '' : 's'} selling` : 'Add at least one selling product', complete: catalogComplete, required: true },
    { id: 'payment', title: 'Payment and fulfillment', detail: timedOrdering ? (paymentComplete ? 'Payment and pickup instructions are ready' : 'Add payment and pickup instructions') : 'Not required for live-only sales', complete: paymentComplete, required: timedOrdering },
    { id: 'publish', title: 'Preview and publish', detail: input.isPublished ? 'Booth is public' : readyToPublish ? 'Ready for final preview and publication' : 'Complete required setup first', complete: input.isPublished && readyToPublish, required: true },
  ];

  const nextStep = steps.find((step) => step.required && !step.complete) || null;
  return { steps, complete: nextStep === null, nextStep };
}
