export type QueueAvailabilityState = 'event-unavailable' | 'event-ended' | 'booth-closed' | 'queue-paused' | 'accepting';

export interface QueueAvailability {
  state: QueueAvailabilityState;
  acceptsTickets: boolean;
  pauseReason: string | null;
}

export function resolveQueueAvailability(input: {
  hasActiveEvent: boolean;
  eventStatus?: string;
  eventStartsAt?: string;
  eventEndsAt?: string;
  now?: number;
  isBoothOpen: boolean;
  isQueueOpen: boolean;
  broadcastMessage?: string | null;
}): QueueAvailability {
  const now = input.now ?? Date.now();
  if (input.eventStatus === 'Ended' || (input.eventEndsAt && Date.parse(input.eventEndsAt) <= now)) return { state: 'event-ended', acceptsTickets: false, pauseReason: null };
  if (!input.hasActiveEvent || (input.eventStatus && input.eventStatus !== 'Confirmed') || (input.eventStartsAt && Date.parse(input.eventStartsAt) > now)) return { state: 'event-unavailable', acceptsTickets: false, pauseReason: null };
  if (!input.isBoothOpen) return { state: 'booth-closed', acceptsTickets: false, pauseReason: null };
  if (!input.isQueueOpen) {
    return { state: 'queue-paused', acceptsTickets: false, pauseReason: input.broadcastMessage?.trim() || null };
  }
  return { state: 'accepting', acceptsTickets: true, pauseReason: null };
}
