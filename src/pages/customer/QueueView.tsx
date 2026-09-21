import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useMidnightTick } from '../../hooks/useMidnightTick';
import { Button } from '../../components/ui';
import { ConfirmDialog, Toast } from '../../components/ui/Feedback';
import { Ban, RefreshCcw, LogOut, Ticket } from 'lucide-react';
import { resolveAvatarUrl } from '../../utils/avatarUrl';
import { useI18n } from '../../i18n';
import { formatDateInTimeZone } from '../../utils/timezone';
import { resolveQueueAvailability } from '../../lib/queueAvailability';
import {
    TICKET_UPDATED_EVENT,
    clearStoredTicketId,
    getOrCreateCustomerFingerprint,
    getStoredTicketId,
    setStoredTicketId,
    ticketStorageKey,
} from '../../utils/customerEvents';
import type { CustomerOutletContext } from '../../types/customerContext';

interface Ticket {
    id: string;
    event_id?: string;
    queue_service_date?: string | null;
    queue_number: number;
    status: 'waiting' | 'calling' | 'serving' | 'complete' | 'missed' | 'expired';
    created_at: string;
}

const formatTime = (dateString: string, locale: string) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
};

const QueueView = () => {
    const { t, language, dateLocale } = useI18n();
    // Midnight Watcher: Triggers update when day changes
    const currentDate = useMidnightTick();

    // 1. Shared customer event context from CustomerLayout.
    const {
        artist: contextArtist,
        events,
        isConnected,
        refresh,
        selectedEvent,
        availableEvents,
        setSelectedEventId,
    } = useOutletContext<CustomerOutletContext>();
    const displayArtist = contextArtist;

    const [myTicket, setMyTicket] = useState<Ticket | null>(null);
    const [nowServingNumber, setNowServingNumber] = useState<number | null>(null);
    const [etaWindow, setEtaWindow] = useState<{ min: number; max: number; peopleAhead: number } | null>(null);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<{ tone?: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string } | null>(null);
    const [isLeaveConfirmOpen, setIsLeaveConfirmOpen] = useState(false);
    const nowServingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Guards handleGetTicket against double-tap / rapid duplicate RPCs.
    // React's disabled={loading} prop is a render-time guard, but a fast
    // second click can fire before the re-render lands.
    const getTicketInFlightRef = useRef(false);

    // Latest availableEvents kept in a ref so restoreStoredTicket and other
    // long-lived callbacks can read it without listing the array in their
    // dependency arrays (the array identity changes on every realtime event,
    // which would otherwise tear down the queues channel and other effects).
    const availableEventsRef = useRef(availableEvents);
    availableEventsRef.current = availableEvents;
    // Same pattern for setSelectedEventId — CustomerLayout creates a new
    // function identity per render, so without this ref the queues channel
    // would be re-subscribed every time CustomerLayout re-renders.
    const setSelectedEventIdRef = useRef(setSelectedEventId);
    setSelectedEventIdRef.current = setSelectedEventId;

    const leaveQueueInFlightRef = useRef(false);
    // Always-current ref so the realtime DELETE handler can read myTicket
    // without capturing a stale closure value.
    const myTicketRef = useRef(myTicket);
    myTicketRef.current = myTicket;

    const activeEvent = selectedEvent;
    const [updatesDelayed, setUpdatesDelayed] = useState(false);
    useEffect(() => {
        if (!activeEvent?.id) { setUpdatesDelayed(false); return; }
        let active = true;
        const check = async () => { const result = await supabase.rpc('queue_updates_delayed', { p_event_id: activeEvent.id }); if (active) setUpdatesDelayed(Boolean(result.error) || result.data === true); };
        void check(); const timer = window.setInterval(() => void check(), 20000);
        return () => { active = false; window.clearInterval(timer); };
    }, [activeEvent?.id]);

    const activeServiceDate = activeEvent
        ? formatDateInTimeZone(new Date(), activeEvent.event_timezone || 'Asia/Bangkok')
        : null;

    // Derived Status Message
    let eventStatusMessage = t('customerBoothClosed');
    if (!activeEvent) {
        const todayStr = currentDate;
        const cancelled = events.find(e => {
            const start = e.start_date.substring(0, 10);
            const end = e.end_date.substring(0, 10);
            return e.status === 'Cancelled' && todayStr >= start && todayStr <= end;
        });
        if (cancelled) eventStatusMessage = t('queueEventCancelledBody');
    }

    // Helper to fetch the "Now Serving" number for a specific EVENT
    const fetchNowServing = async (eventId: string, serviceDate?: string | null) => {
        // PRIORITY 1: LOWEST 'serving' number (Active Service)
        let servingQuery = supabase
            .from('queues')
            .select('queue_number')
            .eq('artist_id', displayArtist.id)
            .eq('event_id', eventId)
            .eq('status', 'serving');
        if (serviceDate) servingQuery = servingQuery.eq('queue_service_date', serviceDate);
        const { data: servingRows } = await servingQuery
            .order('queue_number', { ascending: true }) // Show Lowest # first (Sequential)
            .limit(1);
        const servingData = servingRows?.[0];

        if (servingData) {
            setNowServingNumber(servingData.queue_number);
            return;
        }

        // PRIORITY 2: Fallback to 'calling' (Latest called) if no one is serving
        let callingQuery = supabase
            .from('queues')
            .select('queue_number')
            .eq('artist_id', displayArtist.id)
            .eq('event_id', eventId)
            .eq('status', 'calling');
        if (serviceDate) callingQuery = callingQuery.eq('queue_service_date', serviceDate);
        const { data: callingRows } = await callingQuery
            .order('last_updated_at', { ascending: false }) // Show most recent call
            .limit(1);
        const callingData = callingRows?.[0];

        setNowServingNumber(callingData ? callingData.queue_number : null);
    };

    const fetchEta = async (eventId: string, queueNumber: number, status: Ticket['status']) => {
        if (!['waiting', 'calling', 'serving'].includes(status)) {
            setEtaWindow(null);
            return;
        }

        const { data, error } = await supabase.rpc('estimate_queue_eta', {
            p_event_id: eventId,
            p_queue_number: queueNumber,
        });

        if (error) {
            console.error('ETA fetch error:', error);
            return;
        }

        const result = Array.isArray(data) ? data[0] : data;
        if (!result) {
            setEtaWindow(null);
            return;
        }

        setEtaWindow({
            min: result.eta_min_minutes ?? 0,
            max: result.eta_max_minutes ?? 0,
            peopleAhead: result.people_ahead ?? 0,
        });
    };

    // Stable restore helper: re-reads localStorage, validates against Supabase,
    // and reconciles myTicket. Used on mount, on cross-tab/same-tab ticket
    // changes, and after rejoins. Returns whether a valid ticket was loaded.
    const restoreStoredTicket = useCallback(async (): Promise<boolean> => {
        if (!activeEvent) return false;
        const storedTicketId = getStoredTicketId(displayArtist.id);
        if (!storedTicketId) {
            setMyTicket((prev) => (prev ? null : prev));
            return false;
        }

        const { data: ticket, error } = await supabase
            .from('queues')
            .select('id, event_id, queue_service_date, queue_number, status, created_at')
            .eq('id', storedTicketId)
            .maybeSingle();

        if (error) {
            setToast({ tone: 'warning', title: t('queueTryAgain') });
            return Boolean(myTicketRef.current);
        }

        if (!ticket) {
            // Row was deleted (admin reset, retention) — clear stale id uniformly.
            clearStoredTicketId(displayArtist.id);
            setMyTicket(null);
            return false;
        }

        // Mismatch handling: check the ticket against ITS OWN event/timezone
        // first; only fall back to clearing when the ticket is genuinely
        // not-from-today or its event is gone. Read availableEvents from the
        // ref so this callback's identity doesn't churn when the events list
        // updates via realtime.
        const ticketEvent = ticket.event_id
            ? availableEventsRef.current.find((event) => event.id === ticket.event_id)
            : undefined;
        const ticketTodayInOwnTz = ticketEvent
            ? formatDateInTimeZone(new Date(), ticketEvent.event_timezone || 'Asia/Bangkok')
            : null;
        const ticketIsActive = ['waiting', 'calling', 'serving'].includes(ticket.status);
        const ticketIsFromToday =
            ticketTodayInOwnTz !== null && ticket.queue_service_date === ticketTodayInOwnTz;

        if (ticket.event_id !== activeEvent.id || ticket.queue_service_date !== activeServiceDate) {
            // Not for the active event — try to switch context if the ticket
            // is still valid in its own event/tz.
            if (ticketEvent && ticketIsActive && ticketIsFromToday) {
                setSelectedEventIdRef.current(ticket.event_id || ticketEvent.id);
                return true;
            }
            // Ticket genuinely doesn't apply (event missing, stale day, ended state) — clear.
            console.warn('Ticket Event Mismatch. Clearing.');
            clearStoredTicketId(displayArtist.id);
            setMyTicket(null);
            return false;
        }

        setMyTicket(ticket as Ticket);
        return true;
        // setSelectedEventId is read via ref to keep the callback identity
        // stable across CustomerLayout re-renders.
    }, [activeEvent?.id, activeServiceDate, displayArtist.id]);

    // 2. EFFECT: Fetch Queue Data when Active Event Changes (or on Mount/Refresh)
    useEffect(() => {
        if (!activeEvent) {
            setNowServingNumber(null);
            setLoading(false);
            return;
        }

        let cancelled = false;
        const initQueueData = async () => {
            await fetchNowServing(activeEvent.id, activeServiceDate);
            if (cancelled) return;
            await restoreStoredTicket();
            if (cancelled) return;
            setLoading(false);
        };

        initQueueData();

        // Realtime Queue Updates (Keep local subscription for Queue data)
        const channel = supabase
            .channel(`public:queues:${activeEvent.id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'queues', filter: `event_id=eq.${activeEvent.id}` }, (payload: any) => {
                // Coalesce burst updates into one fetch to reduce network pressure.
                if (nowServingTimerRef.current) {
                    clearTimeout(nowServingTimerRef.current);
                }
                nowServingTimerRef.current = setTimeout(() => {
                    fetchNowServing(activeEvent.id, activeServiceDate);
                }, 200);

                // Handle ticket row deleted by admin (reset, retention). payload.new
                // is null on DELETE; read the deleted id from payload.old instead.
                if (payload?.eventType === 'DELETE') {
                    const deletedId = (payload.old as { id?: string } | null)?.id;
                    if (deletedId && myTicketRef.current?.id === deletedId) {
                        clearStoredTicketId(displayArtist.id);
                        setMyTicket(null);
                    }
                    return;
                }

                const next = payload?.new as Ticket | null | undefined;
                if (!next || !next.id) return;

                setMyTicket((prev) => {
                    if (prev && next.id === prev.id && next.queue_service_date === activeServiceDate) {
                        return next;
                    }
                    return prev;
                });
            })
            .subscribe();

        return () => {
            cancelled = true;
            if (nowServingTimerRef.current) {
                clearTimeout(nowServingTimerRef.current);
                nowServingTimerRef.current = null;
            }
            supabase.removeChannel(channel);
        };

        // Note: availableEvents is intentionally NOT in the dep array.
        // restoreStoredTicket reads it via availableEventsRef so this
        // subscription doesn't churn (teardown + re-subscribe) every time
        // the events list updates over realtime.
    }, [activeEvent?.id, activeEvent?.is_booth_open, activeServiceDate, displayArtist.id, restoreStoredTicket]);

    // Cross-tab + same-tab ticket sync. The init effect above only re-runs on
    // event/artist changes, so a ticket created/leaved in another tab (or in
    // CallingNotification's flow) would not be reflected without this listener.
    useEffect(() => {
        if (!activeEvent || !displayArtist.id) return;

        const storageKey = ticketStorageKey(displayArtist.id);

        const sync = () => { void restoreStoredTicket(); };

        const handleStorage = (e: StorageEvent) => {
            if (e.key === storageKey) sync();
        };

        window.addEventListener(TICKET_UPDATED_EVENT, sync);
        window.addEventListener('storage', handleStorage);
        return () => {
            window.removeEventListener(TICKET_UPDATED_EVENT, sync);
            window.removeEventListener('storage', handleStorage);
        };
    }, [activeEvent?.id, displayArtist.id, restoreStoredTicket]);

    useEffect(() => {
        if (!activeEvent || !myTicket) {
            setEtaWindow(null);
            return;
        }
        fetchEta(activeEvent.id, myTicket.queue_number, myTicket.status);
    }, [activeEvent?.id, myTicket?.queue_number, myTicket?.status, nowServingNumber]);

    useEffect(() => {
        if (!myTicket?.id || !activeEvent?.id) return;

        let isMounted = true;
        const syncTicketStatus = async () => {
            const { data, error } = await supabase
                .from('queues')
                .select('id, event_id, queue_service_date, queue_number, status, created_at')
                .eq('id', myTicket.id)
                .maybeSingle();

            if (!isMounted || error) return;
            if (!data) {
                clearStoredTicketId(displayArtist.id);
                setMyTicket(null);
                setToast({ tone: 'warning', title: t('queueTicketRemoved'), detail: t('queueTicketRemovedDetail') });
                return;
            }
            if (data.event_id !== activeEvent.id || data.queue_service_date !== activeServiceDate) {
                clearStoredTicketId(displayArtist.id);
                setMyTicket(null);
                setToast({ tone: 'warning', title: t('queueTicketExpired'), detail: t('queueTicketExpiredDetail') });
                return;
            }
            setMyTicket(data as Ticket);
        };

        const pollId = window.setInterval(() => { void syncTicketStatus(); }, 3000);
        return () => {
            isMounted = false;
            window.clearInterval(pollId);
        };
    }, [activeEvent?.id, activeServiceDate, displayArtist.id, myTicket?.id]);

    // All hooks above. Guard placed here so hook call count is unconditional.
    if (!displayArtist) return <div className="p-12 text-center text-gray-400 font-medium">{t('loading')}</div>;

    const handleGetTicket = async () => {
        if (!activeEvent) return;
        if (getTicketInFlightRef.current) return;
        getTicketInFlightRef.current = true;

        // Safety Check: Ensure Event hasn't ended
        const now = new Date();
        const end = new Date(activeEvent.end_date);
        if (now > end) {
            setToast({ tone: 'warning', title: t('queueEventEnded'), detail: t('queueEventEndedDetail') });
            refresh();
            getTicketInFlightRef.current = false;
            return;
        }

        setLoading(true);
        try {
            // Idempotency: if a stored ticket already exists and is still
            // active for this event/service date, reuse it instead of issuing
            // a new RPC. Covers the cross-tab case (Tab A created a ticket,
            // Tab B's UI hasn't synced yet) and the rapid-tap case.
            const existingId = getStoredTicketId(displayArtist.id);
            if (existingId) {
                const { data: existing } = await supabase
                    .from('queues')
                    .select('id, event_id, queue_service_date, queue_number, status, created_at')
                    .eq('id', existingId)
                    .maybeSingle();

                if (
                    existing &&
                    existing.event_id === activeEvent.id &&
                    existing.queue_service_date === activeServiceDate &&
                    ['waiting', 'calling', 'serving'].includes(existing.status)
                ) {
                    setMyTicket(existing as Ticket);
                    // Re-dispatch so other tabs/components reconcile against
                    // the (already-stored) id.
                    setStoredTicketId(displayArtist.id, existing.id);
                    return;
                }
                if (!existing) {
                    // Stale id pointing at a deleted row — clear before creating fresh.
                    clearStoredTicketId(displayArtist.id);
                }
            }

            const { data: createdTicket, error: insertError } = await supabase.rpc('create_queue_ticket', {
                p_artist_id: displayArtist.id,
                p_event_id: activeEvent.id,
                p_customer_fingerprint: getOrCreateCustomerFingerprint(displayArtist.id),
            });

            if (insertError) {
                console.error("Supabase Insert Error:", insertError);
                throw insertError;
            }

            const data = Array.isArray(createdTicket) ? createdTicket[0] : createdTicket;
            if (data) {
                // Helper writes localStorage AND dispatches TICKET_UPDATED_EVENT
                // so CallingNotification (and other tabs via 'storage') sync.
                setStoredTicketId(displayArtist.id, data.id);
                setMyTicket(data);
            }

        } catch (err) {
            console.error("handleGetTicket Exception:", err);
            const suspended = String((err as { message?: string })?.message || '').includes('store_suspended');
            setToast({ tone: 'error', title: t('queueCouldNotGetTicket'), detail: suspended
                ? (language === 'th' ? 'ร้านนี้ถูกระงับการรับคิวใหม่' : 'This store is not accepting new queue tickets.')
                : t('queueTryAgain') });
        } finally {
            setLoading(false);
            getTicketInFlightRef.current = false;
        }
    };

    const handleRefresh = async () => {
        setLoading(true);
        try {
            await refresh();
            if (activeEvent) {
                await fetchNowServing(activeEvent.id, activeServiceDate);
                await restoreStoredTicket();
            }
        } catch {
            setToast({ tone: 'warning', title: t('queueTryAgain') });
        } finally {
            setLoading(false);
        }
    };

    const handleLeaveQueue = async () => {
        if (!myTicket) return;

        const status = myTicket.status.toLowerCase();
        const activeStatuses = ['waiting', 'calling', 'serving']; // Active service
        const endedStatuses = ['complete', 'missed', 'expired']; // Final states

        // SCENARIO B: Ended Statuses -> Just clear local
        if (endedStatuses.includes(status)) {
            clearStoredTicketId(displayArtist.id);
            setMyTicket(null);
            return;
        }

        if (activeStatuses.includes(status) || !endedStatuses.includes(status)) {
            setIsLeaveConfirmOpen(true);
        }
    };

    const confirmLeaveQueue = async () => {
        if (!myTicket) return;
        if (leaveQueueInFlightRef.current) return;
        leaveQueueInFlightRef.current = true;

        try {
            const { error } = await supabase.rpc('leave_queue_ticket', {
                p_ticket_id: myTicket.id,
                p_customer_fingerprint: getOrCreateCustomerFingerprint(displayArtist.id),
            });

            if (error) {
                console.error("Error leaving queue (RPC Failed):", error, "Ticket ID:", myTicket.id);
                setToast({ tone: 'error', title: t('queueCouldNotLeave'), detail: t('queueTryAgain') });
                return;
            }

            clearStoredTicketId(displayArtist.id);
            setMyTicket(null);
            setIsLeaveConfirmOpen(false);
            setToast({ tone: 'success', title: t('queueCancelledToast') });
        } finally {
            leaveQueueInFlightRef.current = false;
        }
    };

    // UI State Components
    const renderTicketStatus = () => {
        if (!myTicket) return null;

        const { status, queue_number } = myTicket;
        const queueingArea = activeEvent?.queueing_area?.trim();
        const callingMessage = queueingArea ? t('queueProceedToArea', { area: queueingArea }) : t('queueProceedToBooth');

        // Configuration for each status
        const config = {
            waiting: {
                bg: 'bg-pink-50',
                border: 'border-gray-200',
                badge: { text: t('queueStatusWaiting'), bg: 'bg-gray-200', color: 'text-gray-700' },
                messageColor: 'text-gray-500',
                message: t('queueWaitingMessage'),
                subMessage: undefined
            },
            calling: {
                bg: 'bg-yellow-50',
                border: 'border-yellow-200',
                badge: { text: t('queueStatusTurn'), bg: 'bg-yellow-500', color: 'text-white' },
                messageColor: 'text-yellow-800',
                message: callingMessage,
                subMessage: t('queueCalling')
            },
            serving: {
                bg: 'bg-sky-50',
                border: 'border-sky-200',
                badge: { text: t('queueStatusServing'), bg: 'bg-sky-500', color: 'text-white' },
                messageColor: 'text-sky-800',
                message: t('queueServingMessage'),
                subMessage: t('queueActive')
            },
            complete: {
                bg: 'bg-green-50',
                border: 'border-green-200',
                badge: { text: t('queueStatusComplete'), bg: 'bg-green-100', color: 'text-green-700' },
                messageColor: 'text-green-800',
                message: t('queueCompleteMessage'),
                subMessage: undefined
            },
            expired: {
                bg: 'bg-purple-50',
                border: 'border-purple-200',
                badge: { text: t('queueStatusExpired'), bg: 'bg-purple-100', color: 'text-purple-700' },
                messageColor: 'text-purple-800',
                message: t('queueExpiredMessage'),
                subMessage: undefined
            },
            missed: { // Acts as Cancelled
                bg: 'bg-red-50',
                border: 'border-red-200',
                badge: { text: t('queueStatusCancelled'), bg: 'bg-red-100', color: 'text-red-700' },
                messageColor: 'text-red-800',
                message: t('queueCancelledMessage'),
                subMessage: undefined
            }
        };

        // Fallback to 'missed' config if status is unknown (or use type assertion key)
        const theme = config[status as keyof typeof config] || config.missed;

        return (
            <section className={`customer-queue-ticket ${theme.bg} ${theme.border}`} aria-label={language === 'th' ? 'บัตรคิวของคุณ' : 'Your queue ticket'}>
                <div className="queue-ticket-top"><Ticket size={22} aria-hidden="true" /><span>{language === 'th' ? 'บัตรคิวของคุณ' : 'Your queue ticket'}</span></div>
                <div className="queue-ticket-number">#{queue_number}</div>
                <div aria-live="polite" aria-atomic="true">
                    <h2 className={`queue-ticket-status ${theme.messageColor}`}>{theme.badge.text}</h2>
                    <p className="queue-ticket-message">{theme.message}</p>
                </div>
                {etaWindow && status === 'waiting' && !updatesDelayed && isConnected && <div className="queue-ticket-estimate">
                    <strong>{t('queueEstimatedWait', { min: etaWindow.min, max: etaWindow.max, people: etaWindow.peopleAhead })}</strong>
                    <p>{language === 'th' ? 'เวลาโดยประมาณ อาจเปลี่ยนตามการให้บริการหน้าบูธ' : 'An estimate; timing may change with service at the booth.'}</p>
                </div>}
                <div className="queue-ticket-stub"><span>{t('queueBookedAt', { time: formatTime(myTicket.created_at, dateLocale) })}</span><span>{activeEvent?.event_name}</span></div>
            </section>
        );
    };

    if (loading) return (
        <div className="min-h-screen bg-[#fff7fb] pb-24 flex flex-col items-center w-full max-w-md mx-auto relative shadow-xl animate-pulse">
            {/* Header Skeleton */}
            <div className="w-full h-16 bg-white/50 border-b border-pink-50 flex items-center px-4 gap-3">
                <div className="w-10 h-10 rounded-full bg-gray-200" />
                <div className="h-4 w-24 bg-gray-200 rounded" />
            </div>

            <div className="w-full px-4 mt-8 flex flex-col items-center flex-1 gap-4">
                {/* Now Serving Skeleton */}
                <div className="w-full h-28 rounded-[1.75rem] bg-gray-900/5 border border-pink-100 p-5" />
                
                {/* Guidance Skeleton */}
                <div className="w-full h-20 rounded-2xl bg-white border border-pink-50 p-4">
                    <div className="h-2 w-16 bg-gray-200 rounded mb-2" />
                    <div className="h-3 w-32 bg-gray-200 rounded mb-1" />
                    <div className="h-2 w-48 bg-gray-100 rounded" />
                </div>

                {/* Main Card Skeleton */}
                <div className="w-full flex-1 min-h-[320px] rounded-[2rem] bg-white border border-pink-100 p-8 shadow-sm" />

                {/* Button Skeleton */}
                <div className="w-full h-14 rounded-2xl bg-gray-200 mt-auto" />
            </div>
        </div>
    );

    // Strict UI Check: Booth must be OPEN
    const isBoothOpen = activeEvent?.is_booth_open;

    // NOTE: artist prop from useArtistRealtime now contains is_queue_open
    const isQueueOpen = displayArtist?.is_queue_open ?? true; // Default to true if undefined
    const queueAvailability = resolveQueueAvailability({
        hasActiveEvent: Boolean(activeEvent),
        isBoothOpen: Boolean(isBoothOpen),
        isQueueOpen,
        broadcastMessage: displayArtist?.broadcast_message,
    });
    const isQueueUnavailable = !queueAvailability.acceptsTickets;
    const queueActionGuidance = (() => {
        if (!myTicket) {
            if (queueAvailability.state === 'queue-paused') {
                return {
                    title: t('queuePausedTitle'),
                    detail: queueAvailability.pauseReason || t('queuePausedDetail'),
                    tone: 'amber',
                };
            }
            if (queueAvailability.state === 'accepting') {
                return {
                    title: t('queueGetTicketFirstTitle'),
                    detail: t('queueGetTicketFirstDetail'),
                    tone: 'pink',
                };
            }
            return {
                title: t('queueUnavailableTitle'),
                detail: t('queueUnavailableDetail'),
                tone: 'slate',
            };
        }

        switch (myTicket.status) {
            case 'waiting':
                return {
                    title: t('queueWaitBrowseTitle'),
                    detail: t('queueWaitBrowseDetail'),
                    tone: 'slate',
                };
            case 'calling':
                return {
                    title: t('queueProceedTitle'),
                    detail: activeEvent?.queueing_area?.trim()
                        ? t('queueProceedDetailArea', { area: activeEvent.queueing_area.trim() })
                        : t('queueProceedDetailBooth'),
                    tone: 'amber',
                };
            case 'serving':
                return {
                    title: t('queueServingTitle'),
                    detail: t('queueServingDetail'),
                    tone: 'blue',
                };
            case 'complete':
                return {
                    title: t('queueTicketFinishedTitle'),
                    detail: t('queueTicketFinishedDetail'),
                    tone: 'green',
                };
            default:
                return {
                    title: t('queueTicketClosedTitle'),
                    detail: t('queueTicketClosedDetail'),
                    tone: 'red',
                };
        }
    })();


    return (
        <main className="customer-queue-page">
            <Toast message={toast} onClose={() => setToast(null)} />
            <ConfirmDialog open={isLeaveConfirmOpen} title={t('queueLeaveTitle')} detail={t('queueLeaveDetail')} confirmLabel={t('queueLeaveButton')} tone="danger" onConfirm={confirmLeaveQueue} onCancel={() => setIsLeaveConfirmOpen(false)} />
            <div className="customer-queue-layout">
                <header className="queue-page-heading">
                    <div className="queue-creator">
                        {displayArtist.image_url && <img src={resolveAvatarUrl(displayArtist.image_url)} alt="" />}
                        <div><p>{displayArtist.display_name}</p><h1>{language === 'th' ? 'คิวของคุณ' : 'Your queue'}</h1></div>
                    </div>
                    <p className="order-caption">{activeEvent?.event_name || eventStatusMessage}</p>
                </header>
                {(!isConnected || updatesDelayed) && <p role="status" className="queue-connection-warning">{!isConnected ? t('customerOffline') : (language === 'th' ? 'สถานะคิวอาจล่าช้า กรุณารอฟังหน้าบูธและแสดงหมายเลขนี้ให้สตาฟ' : 'Queue updates may be delayed. Listen at the booth and show this number to staff.')}</p>}
                <div className="queue-ticket-column">
                    {myTicket ? renderTicketStatus() : <section className="queue-join-card">
                        <div className="queue-join-icon">{isQueueUnavailable ? <Ban size={32} /> : <Ticket size={32} />}</div>
                        <h2>{isQueueUnavailable ? queueActionGuidance.title : t('queueJoinTitle')}</h2>
                        <p>{isQueueUnavailable ? queueActionGuidance.detail : t('queueJoinBody')}</p>
                        {!isQueueUnavailable && <Button onClick={handleGetTicket} disabled={loading} className="shop-add mt-6 w-full">{t('queueGetTicket')}</Button>}
                    </section>}
                    {myTicket && <div className="queue-ticket-actions">
                        <Button onClick={handleRefresh} className="queue-refresh" aria-label={t('queueRefreshStatus')}><RefreshCcw size={17} />{t('queueRefreshStatus')}</Button>
                        <button onClick={handleLeaveQueue} className="queue-leave"><LogOut size={16} />{['complete', 'missed', 'expired'].includes(myTicket.status) ? t('queueCloseTicket') : t('queueLeaveQueue')}</button>
                    </div>}
                </div>
                <aside className="queue-details-column">
                    {activeEvent && <section className="queue-now-serving">
                        <p>{t('queueNowServing')}</p>
                        <div role="status" aria-live="polite" aria-atomic="true"><strong>{nowServingNumber ? `#${nowServingNumber}` : '—'}</strong></div>
                        <span>{activeEvent.queueing_area?.trim() || (language === 'th' ? 'รอฟังประกาศหน้าบูธ' : 'Listen for announcements at the booth')}</span>
                    </section>}
                    <section className={`queue-guidance queue-guidance-${queueActionGuidance.tone}`}>
                        <p className="queue-eyebrow">{t('queueNextStep')}</p><h2>{queueActionGuidance.title}</h2><p>{queueActionGuidance.detail}</p>
                    </section>
                    <Link to="../menu" className="queue-browse"><Ticket size={21} aria-hidden="true" /><span><strong>{language === 'th' ? 'ดูสินค้าของครีเอเตอร์' : 'Browse creator goods'}</strong><small>{language === 'th' ? 'กลับมาดูคิวได้จากแถบด้านล่าง' : 'Return to your queue from navigation'}</small></span><span aria-hidden="true">→</span></Link>
                    <p className="order-caption">{language === 'th' ? 'ขอบคุณที่รอคิวและสนับสนุนครีเอเตอร์ พักและดื่มน้ำระหว่างรอได้นะ' : 'Thanks for supporting creators. Stay hydrated while you wait.'}</p>
                </aside>
            </div>
        </main>
    );
};

export default QueueView;
