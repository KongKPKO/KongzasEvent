import type { RealtimeEvent } from '../hooks/useArtistRealtime';

export const customerEventStorageKey = (artistId: string) => `customerSelectedEventId:${artistId}`;

// Custom event name dispatched by QueueView after writing a new ticket to
// localStorage.  CallingNotification listens for this to pick up tickets
// obtained in the current tab (the native 'storage' event only fires in
// OTHER tabs, so this covers the same-tab case).
export const TICKET_UPDATED_EVENT = 'ticket-updated' as const;

export const isCurrentCustomerEvent = (event: RealtimeEvent, nowIso = new Date().toISOString()) => {
  return event.status === 'Confirmed' && event.start_date <= nowIso && event.end_date >= nowIso;
};

export const sortCustomerEvents = (events: RealtimeEvent[]) => {
  return [...events].sort((a, b) => {
    const openScore = Number(Boolean(b.is_booth_open)) - Number(Boolean(a.is_booth_open));
    if (openScore !== 0) return openScore;
    return new Date(a.start_date).getTime() - new Date(b.start_date).getTime();
  });
};

export const getCurrentCustomerEvents = (events: RealtimeEvent[], nowIso = new Date().toISOString()) => {
  return sortCustomerEvents(events.filter((event) => isCurrentCustomerEvent(event, nowIso)));
};
