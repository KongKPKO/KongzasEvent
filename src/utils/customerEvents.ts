import type { RealtimeEvent } from '../hooks/useArtistRealtime';
import type { EventSalesPhase } from '../types/preorder';

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

const isWithinWindow = (opensAt: string | null | undefined, closesAt: string | null | undefined, nowIso: string) => {
  if (opensAt && opensAt > nowIso) return false;
  if (closesAt && closesAt <= nowIso) return false;
  return true;
};

export const getEventSalesPhase = (event: RealtimeEvent, nowIso = new Date().toISOString()): EventSalesPhase => {
  if (event.sales_status_override === 'closed' || event.status === 'Cancelled') return 'closed';
  const preorderEnabled = Boolean(event.preorder_enabled) || event.selling_mode === 'preorder';
  const postorderEnabled = Boolean(event.postorder_enabled) || event.selling_mode === 'post_event';
  const postorderOpensAt = event.postorder_opens_at || (event.selling_mode === 'post_event' ? event.preorder_opens_at : null);
  const postorderClosesAt = event.postorder_closes_at || (event.selling_mode === 'post_event' ? event.preorder_closes_at : null);

  if (event.status === 'Confirmed' && event.start_date <= nowIso && event.end_date > nowIso) {
    return 'live';
  }

  if (
    event.status === 'Confirmed' &&
    preorderEnabled &&
    isWithinWindow(event.preorder_opens_at, event.preorder_closes_at, nowIso)
  ) {
    return 'preorder';
  }

  if (
    (event.status === 'Confirmed' || event.status === 'Ended') &&
    postorderEnabled &&
    isWithinWindow(postorderOpensAt, postorderClosesAt, nowIso)
  ) {
    return 'post_event';
  }

  return 'closed';
};

export const isPostEventStoreOpen = (event: RealtimeEvent, nowIso = new Date().toISOString()) =>
  getEventSalesPhase(event, nowIso) === 'post_event';

export const isPreorderStoreOpen = (event: RealtimeEvent, nowIso = new Date().toISOString()) =>
  getEventSalesPhase(event, nowIso) === 'preorder';

export const isLiveEventOpen = (event: RealtimeEvent, nowIso = new Date().toISOString()) =>
  getEventSalesPhase(event, nowIso) === 'live';

const isLegacyCustomerEvent = (event: RealtimeEvent, nowIso: string) => {
  if (event.selling_mode === 'post_event') {
    if (event.status !== 'Confirmed' && event.status !== 'Ended') return false;
    return isWithinWindow(event.preorder_opens_at, event.preorder_closes_at, nowIso);
  }

  if (event.status !== 'Confirmed' || event.end_date < nowIso) return false;
  if (event.start_date <= nowIso) return true;
  if (event.selling_mode !== 'preorder') return false;
  return isWithinWindow(event.preorder_opens_at, event.preorder_closes_at, nowIso);
};

export const isCurrentCustomerEvent = (event: RealtimeEvent, nowIso = new Date().toISOString()) => {
  const hasExplicitSchedule =
    event.sales_status_override !== undefined ||
    event.preorder_enabled !== undefined ||
    event.postorder_enabled !== undefined;

  if (!hasExplicitSchedule) return isLegacyCustomerEvent(event, nowIso);

  return getEventSalesPhase(event, nowIso) !== 'closed';
};

export const getEventPhaseWindow = (event: RealtimeEvent, nowIso = new Date().toISOString()) => {
  const phase = getEventSalesPhase(event, nowIso);
  if (phase === 'post_event') {
    return {
      opensAt: event.postorder_opens_at || (event.selling_mode === 'post_event' ? event.preorder_opens_at : null) || null,
      closesAt: event.postorder_closes_at || (event.selling_mode === 'post_event' ? event.preorder_closes_at : null) || null,
    };
  }
  if (phase === 'preorder') {
    return { opensAt: event.preorder_opens_at || null, closesAt: event.preorder_closes_at || null };
  }
  return { opensAt: null, closesAt: null };
};

export const sortCustomerEvents = (events: RealtimeEvent[], nowIso = new Date().toISOString()) => {
  return [...events].sort((a, b) => {
    const openScore = Number(Boolean(b.is_booth_open)) - Number(Boolean(a.is_booth_open));
    if (openScore !== 0) return openScore;
    // Live/upcoming events outrank ended post-event stores.
    const endedScore = Number(a.end_date < nowIso) - Number(b.end_date < nowIso);
    if (endedScore !== 0) return endedScore;
    return new Date(a.start_date).getTime() - new Date(b.start_date).getTime();
  });
};

export const getCurrentCustomerEvents = (events: RealtimeEvent[], nowIso = new Date().toISOString()) => {
  return sortCustomerEvents(events.filter((event) => isCurrentCustomerEvent(event, nowIso)));
};
