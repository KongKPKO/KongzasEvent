import type { RealtimeEvent } from '../hooks/useArtistRealtime';

export const customerEventStorageKey = (artistId: string) => `customerSelectedEventId:${artistId}`;

export const posSelectedEventStorageKey = (artistId: string) => `posSelectedEventId:${artistId}`;

export const clearMenuOrderState = (artistId: string | undefined | null): boolean => {
  if (!artistId) return false;
  try {
    localStorage.removeItem(`cart_${artistId}`);
    localStorage.removeItem(`orderSent_${artistId}`);
    localStorage.removeItem(`sentOrderId_${artistId}`);
    localStorage.removeItem(`orderCompleted_${artistId}`);
    return true;
  } catch (err) {
    console.warn('Failed to clear menu order state from localStorage:', err);
    return false;
  }
};

// Custom event name dispatched after writing/clearing a ticket id in
// localStorage.  Same-tab listeners (CallingNotification, QueueView, MenuView)
// react to it; the native 'storage' event covers cross-tab.
export const TICKET_UPDATED_EVENT = 'ticket-updated' as const;

export const ticketStorageKey = (artistId: string) => `ticket_id_${artistId}`;

export const customerFingerprintStorageKey = (artistId: string) => `customer_fingerprint_${artistId}`;

// Try localStorage first; fall back to sessionStorage so same-session state
// survives storage quota exhaustion or browsers blocking localStorage
// (e.g. storage full). Cross-tab sync via the native 'storage' event only
// works for localStorage, but same-tab TICKET_UPDATED_EVENT still fires.
const storageRead = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { /* fall through */ }
  try { return sessionStorage.getItem(key); } catch { return null; }
};
const storageWrite = (key: string, value: string): void => {
  try { localStorage.setItem(key, value); return; } catch { /* fall through */ }
  try { sessionStorage.setItem(key, value); } catch { /* both unavailable */ }
};
const storageDelete = (key: string): void => {
  try { localStorage.removeItem(key); } catch { /* fall through */ }
  try { sessionStorage.removeItem(key); } catch { /* both unavailable */ }
};

export const getStoredTicketId = (artistId: string | undefined | null): string | null => {
  if (!artistId) return null;
  return storageRead(ticketStorageKey(artistId));
};

const createCustomerFingerprint = (): string => {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to a timestamp/random fallback for older browsers.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

export const getOrCreateCustomerFingerprint = (artistId: string | undefined | null): string | null => {
  if (!artistId) return null;
  const key = customerFingerprintStorageKey(artistId);
  const stored = storageRead(key);
  if (stored) return stored;

  const next = createCustomerFingerprint();
  storageWrite(key, next);
  return next;
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
  storageWrite(ticketStorageKey(artistId), ticketId);
  dispatchTicketUpdated();
};

export const clearStoredTicketId = (artistId: string | undefined | null): void => {
  if (!artistId) return;
  storageDelete(ticketStorageKey(artistId));
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
