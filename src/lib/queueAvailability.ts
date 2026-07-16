export type QueueAvailabilityState = 'event-unavailable' | 'booth-closed' | 'queue-paused' | 'accepting';

export interface QueueAvailability {
  state: QueueAvailabilityState;
  acceptsTickets: boolean;
  pauseReason: string | null;
}

export function resolveQueueAvailability(input: {
  hasActiveEvent: boolean;
  isBoothOpen: boolean;
  isQueueOpen: boolean;
  broadcastMessage?: string | null;
}): QueueAvailability {
  if (!input.hasActiveEvent) return { state: 'event-unavailable', acceptsTickets: false, pauseReason: null };
  if (!input.isBoothOpen) return { state: 'booth-closed', acceptsTickets: false, pauseReason: null };
  if (!input.isQueueOpen) {
    return { state: 'queue-paused', acceptsTickets: false, pauseReason: input.broadcastMessage?.trim() || null };
  }
  return { state: 'accepting', acceptsTickets: true, pauseReason: null };
}
