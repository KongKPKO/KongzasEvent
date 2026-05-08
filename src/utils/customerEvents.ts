import type { RealtimeEvent } from '../hooks/useArtistRealtime';

export const customerEventStorageKey = (artistId: string) => `customerSelectedEventId:${artistId}`;

export const posSelectedEventStorageKey = (artistId: string) => `posSelectedEventId:${artistId}`;

export const clearMenuOrderState = (artistId: string | undefined | null): void => {
  if (!artistId) return;
  try {
    localStorage.removeItem(`cart_${artistId}`);
    localStorage.removeItem(`orderSent_${artistId}`);
    localStorage.removeItem(`sentOrderId_${artistId}`);
    localStorage.removeItem(`orderCompleted_${artistId}`);
  } catch {
    // localStorage may be unavailable (SSR, storage-full).
  }
};

// Custom event name dispatched after writing/clearing a ticket id in
// localStorage.  Same-tab listeners (CallingNotification, QueueView, MenuView)
// react to it; the native 'storage' event covers cross-tab.
export const TICKET_UPDATED_EVENT = 'ticket-updated' as const;

export const ticketStorageKey = (artistId: string) => `ticket_id_${artistId}`;

export const getStoredTicketId = (artistId: string | undefined | null): string | null => {
  if (!artistId) return null;
  try {
    return localStorage.getItem(ticketStorageKey(artistId));
  } catch {
    return null;
  }
};

const dispatchTicketUpdated = () => {
  try {
    window.dispatchEvent(new CustomEvent(TICKET_UPDATED_EVENT));
  } catch {
    // Safe to ignore: environments without window (SSR, tests) don't need the event.
  }
};

export const setStoredTicketId = (artistId: string | undefined | null, ticketId: string): void => {
  if (!artistId || !ticketId) return;
  try {
    localStorage.setItem(ticketStorageKey(artistId), ticketId);
  } catch {
    return;
  }
  dispatchTicketUpdated();
};

export const clearStoredTicketId = (artistId: string | undefined | null): void => {
  if (!artistId) return;
  try {
    localStorage.removeItem(ticketStorageKey(artistId));
  } catch {
    return;
  }
  dispatchTicketUpdated();
};

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
