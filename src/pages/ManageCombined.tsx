import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import QueuePanel from '../components/dashboard/QueuePanel';
import PosPanel from '../components/dashboard/PosPanel';
import AdminHeader from '../components/AdminHeader';
import { CalendarDays, Clock, Loader2 } from 'lucide-react';
import type { ActorContext } from '../types/access';
import { canUsePos } from '../types/access';
import { Toast } from '../components/ui/Feedback';
import { formatDateInTimeZone } from '../utils/timezone';
import { posSelectedEventStorageKey } from '../utils/customerEvents';

export interface ActiveEvent {
    id: string;
    event_name: string;
    start_date: string;
    end_date: string;
    event_timezone?: string | null;
    is_booth_open: boolean;
    status: string;
}

export interface QueueItem {
    id: string;
    artist_id: string;
    event_id?: string;
    queue_service_date?: string | null;
    queue_number: number;
    status: 'waiting' | 'calling' | 'serving' | 'complete' | 'missed' | 'expired' | 'queued';
    last_updated_at: string;
    called_at?: string;
    created_at?: string;
    served_at?: string;
    completed_at?: string;
}

interface ManageCombinedProps {
    actorContext: ActorContext;
    /** Optional override for initial tab — used by /live/queue and /live/pos routes */
    initialTab?: 'queue' | 'pos';
}

interface UpcomingEvent {
    id: string;
    event_name: string;
    start_date: string;
    event_timezone: string | null;
}

// Formats a UTC ISO start_date string into a human-readable local time string
// using the event's configured timezone.  Used only for the upcoming-event hint.
const formatEventStart = (startDate: string, timezone: string | null): string => {
    const tz = timezone || 'Asia/Bangkok';
    const date = new Date(startDate);
    if (Number.isNaN(date.getTime())) return startDate;
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(date);
};

export default function ManageCombined({ actorContext, initialTab }: ManageCombinedProps) {
    const [activeEvent, setActiveEvent] = useState<ActiveEvent | null>(null);
    const [availableEvents, setAvailableEvents] = useState<ActiveEvent[]>([]);
    const [selectedEventId, setSelectedEventId] = useState<string | null>(() => {
        if (typeof window === 'undefined') return null;
        return window.localStorage.getItem(posSelectedEventStorageKey(actorContext.artist_id));
    });
    const [eventLoading, setEventLoading] = useState(true);
    const [loadingSlow, setLoadingSlow] = useState(false);
    const [boothToggleLoading, setBoothToggleLoading] = useState(false);
    const [nextUpcomingEvent, setNextUpcomingEvent] = useState<UpcomingEvent | null>(null);
    const [queues, setQueues] = useState<QueueItem[]>([]);

    const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
    const [selectedQueueNumber, setSelectedQueueNumber] = useState<string | null>(null);
    const hasPosPermission = canUsePos(actorContext.role);
    const [activeTab, setActiveTab] = useState<'queue' | 'pos'>(() => {
        // Explicit route preference wins (e.g. /live/queue or /live/pos)
        if (initialTab) return initialTab;
        if (typeof window === 'undefined') return 'queue';
        return hasPosPermission && window.matchMedia('(max-width: 767px)').matches ? 'pos' : 'queue';
    });
    const [isQueuePanelExpanded, setIsQueuePanelExpanded] = useState(() => {
        if (typeof window === 'undefined') return true;
        return !window.matchMedia('(max-width: 767px)').matches;
    });
    const [toast, setToast] = useState<{ tone?: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string } | null>(null);

    const activeEventIdRef = useRef<string | null>(null);
    const activeServiceDateRef = useRef<string | null>(null);
    const activeServiceDate = activeEvent
        ? formatDateInTimeZone(new Date(), activeEvent.event_timezone || 'Asia/Bangkok')
        : null;

    useEffect(() => {
        activeEventIdRef.current = activeEvent?.id || null;
        activeServiceDateRef.current = activeServiceDate || null;
    }, [activeEvent, activeServiceDate]);

    useEffect(() => {
        if (!eventLoading) { setLoadingSlow(false); return; }
        const t = setTimeout(() => setLoadingSlow(true), 6000);
        return () => clearTimeout(t);
    }, [eventLoading]);

    const handleBoothToggle = useCallback(async (nextOpen: boolean) => {
        if (!activeEvent?.id || boothToggleLoading) return;
        if (!nextOpen && activeEvent.is_booth_open && !window.confirm(`Close booth for ${activeEvent.event_name}? Customers will see the booth as closed.`)) {
            return;
        }

        try {
            setBoothToggleLoading(true);
            const { error } = await supabase
                .from('events')
                .update({ is_booth_open: nextOpen })
                .eq('id', activeEvent.id)
                .eq('artist_id', actorContext.artist_id);

            if (error) throw error;
            setActiveEvent((prev) => (prev ? { ...prev, is_booth_open: nextOpen } : prev));
        } catch (error) {
            console.error('[ManageCombined] Error updating booth status:', error);
            setToast({ tone: 'warning', title: 'Booth update failed', detail: 'Please try again.' });
        } finally {
            setBoothToggleLoading(false);
        }
    }, [activeEvent?.id, activeEvent?.event_name, activeEvent?.is_booth_open, actorContext.artist_id, boothToggleLoading]);

    const fetchActiveEvents = useCallback(async () => {
        try {
            const { data, error } = await supabase.rpc('list_accessible_pos_events');

            if (error) {
                console.error('[ManageCombined] Error fetching active events:', error);
                setAvailableEvents([]);
                setActiveEvent(null);
            } else {
                const events = (data || []) as ActiveEvent[];
                setAvailableEvents(events);

                setSelectedEventId((currentSelectedId) => {
                    const storedSelectedId = currentSelectedId || (
                        typeof window !== 'undefined'
                            ? window.localStorage.getItem(posSelectedEventStorageKey(actorContext.artist_id))
                            : null
                    );
                    const nextSelectedId = events.some((event) => event.id === storedSelectedId)
                        ? storedSelectedId
                        : events[0]?.id || null;

                    if (typeof window !== 'undefined') {
                        if (nextSelectedId) {
                            window.localStorage.setItem(posSelectedEventStorageKey(actorContext.artist_id), nextSelectedId);
                        } else {
                            window.localStorage.removeItem(posSelectedEventStorageKey(actorContext.artist_id));
                        }
                    }

                    return nextSelectedId;
                });
            }
        } catch (err) {
            console.error('[ManageCombined] Error fetching active events:', err);
            setAvailableEvents([]);
            setActiveEvent(null);
        } finally {
            setEventLoading(false);
        }
    }, [actorContext.artist_id]);

    // Fetches the nearest future Confirmed event for this artist.
    // Only runs when availableEvents is empty so we can explain why the POS
    // dropdown shows nothing.  Does NOT change any filtering or security logic —
    // list_accessible_pos_events still controls what appears in the dropdown.
    const fetchNextUpcomingEvent = useCallback(async () => {
        const { data } = await supabase
            .from('events')
            .select('id, event_name, start_date, event_timezone')
            .eq('artist_id', actorContext.artist_id)
            .eq('status', 'Confirmed')
            .gt('start_date', new Date().toISOString())
            .order('start_date', { ascending: true })
            .limit(1)
            .maybeSingle();
        setNextUpcomingEvent(data ?? null);
    }, [actorContext.artist_id]);

    // Trigger the upcoming-event lookup whenever the active event list becomes
    // empty (or clears it when active events exist so stale data is never shown).
    useEffect(() => {
        if (!eventLoading && availableEvents.length === 0) {
            void fetchNextUpcomingEvent();
        } else {
            setNextUpcomingEvent(null);
        }
    }, [eventLoading, availableEvents.length, fetchNextUpcomingEvent]);

    const fetchQueues = useCallback(async () => {
        const eventId = activeEventIdRef.current;
        const serviceDate = activeServiceDateRef.current;
        if (!eventId) {
            setQueues([]);
            return;
        }

        const { data, error } = await supabase
            .from('queues')
            .select('id, artist_id, event_id, queue_service_date, queue_number, status, called_at, last_updated_at, created_at, served_at, completed_at')
            .eq('artist_id', actorContext.artist_id)
            .eq('event_id', eventId)
            .eq('queue_service_date', serviceDate)
            .order('queue_number', { ascending: true });

        if (!error && data) {
            setQueues(data);
        }
    }, [actorContext.artist_id]);

    const expireStaleCallingQueues = useCallback(async () => {
        const eventId = activeEventIdRef.current;
        const serviceDate = activeServiceDateRef.current;
        if (!eventId) return;

        const staleThresholdMs = Date.now() - (30 * 60 * 1000);
        const { data, error } = await supabase
            .from('queues')
            .select('id, called_at, last_updated_at')
            .eq('artist_id', actorContext.artist_id)
            .eq('event_id', eventId)
            .eq('queue_service_date', serviceDate)
            .eq('status', 'calling');

        if (error || !data || data.length === 0) return;

        const staleIds = data
            .filter((ticket) => {
                const sourceTime = ticket.called_at || ticket.last_updated_at;
                const sourceMs = new Date(sourceTime).getTime();
                return Number.isFinite(sourceMs) && sourceMs <= staleThresholdMs;
            })
            .map((ticket) => ticket.id);

        if (staleIds.length === 0) return;

        const { error: updateError } = await supabase
            .from('queues')
            .update({
                status: 'expired',
                last_updated_at: new Date().toISOString(),
            })
            .in('id', staleIds)
            .eq('status', 'calling');

        if (updateError) {
            console.error('[ManageCombined] Failed to expire stale calling queues:', updateError);
        }
    }, [actorContext.artist_id]);

    useEffect(() => {
        fetchActiveEvents();

        const channel = supabase.channel(`manage-combined-events-${actorContext.artist_id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `artist_id=eq.${actorContext.artist_id}` }, () => {
                fetchActiveEvents();
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [fetchActiveEvents, actorContext.artist_id]);

    useEffect(() => {
        const nextActiveEvent = selectedEventId
            ? availableEvents.find((event) => event.id === selectedEventId) || null
            : null;
        setActiveEvent(nextActiveEvent);
    }, [availableEvents, selectedEventId]);

    useEffect(() => {
        setSelectedQueueId(null);
        setSelectedQueueNumber(null);
    }, [activeEvent?.id]);

    const handleSelectedEventChange = (eventId: string) => {
        if (selectedQueueId && eventId && eventId !== activeEvent?.id && !window.confirm('Switch event and clear the selected queue/order context?')) {
            return;
        }
        setSelectedEventId(eventId || null);
        if (typeof window !== 'undefined') {
            if (eventId) {
                window.localStorage.setItem(posSelectedEventStorageKey(actorContext.artist_id), eventId);
            } else {
                window.localStorage.removeItem(posSelectedEventStorageKey(actorContext.artist_id));
            }
        }
    };

    useEffect(() => {
        if (activeEvent) {
            fetchQueues();
        } else {
            setQueues([]);
        }
    }, [activeEvent?.id, activeServiceDate, fetchQueues]);

    useEffect(() => {
        if (!activeEvent?.id) return;

        expireStaleCallingQueues();
        const timer = setInterval(() => {
            expireStaleCallingQueues();
        }, 30_000);

        return () => clearInterval(timer);
    }, [activeEvent?.id, expireStaleCallingQueues]);

    useEffect(() => {
        if (!activeEvent?.id) return;

        const channel = supabase
            .channel(`manage-combined-queues-${actorContext.artist_id}-${activeEvent.id}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'queues', filter: `event_id=eq.${activeEvent.id}` },
                (payload) => {
                    if (payload.eventType === 'INSERT') {
                        const newTicket = payload.new as QueueItem;
                        if (newTicket.queue_service_date !== activeServiceDateRef.current) return;
                        setQueues((prev) => {
                            if (prev.find(q => q.id === newTicket.id)) return prev;
                            return [...prev, newTicket];
                        });
                    } else if (payload.eventType === 'UPDATE') {
                        const updatedTicket = payload.new as QueueItem;
                        if (updatedTicket.queue_service_date !== activeServiceDateRef.current) {
                            setQueues((prev) => prev.filter(q => q.id !== updatedTicket.id));
                            return;
                        }
                        setQueues((prev) => prev.map(q => q.id === updatedTicket.id ? { ...q, ...updatedTicket } : q));
                    } else if (payload.eventType === 'DELETE') {
                        const deletedId = (payload.old as QueueItem | null)?.id;
                        if (!deletedId) return;
                        setQueues((prev) => prev.filter(q => q.id !== deletedId));
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [actorContext.artist_id, activeEvent?.id, activeServiceDate]);

    const filteredQueues = activeEvent?.id
        ? queues.filter(q => q.event_id === activeEvent.id && q.queue_service_date === activeServiceDate)
        : queues;

    const servingQueues = filteredQueues.filter(q => q.status === 'serving');
    const otherQueues = filteredQueues.filter(q => q.status !== 'serving');
    if (eventLoading) {
        return (
            <div className="flex flex-col h-screen bg-gray-50 items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-pink-500 mb-3" />
                <p className="text-gray-500 text-sm font-medium">
                    {loadingSlow ? 'Taking longer than usual — check your connection.' : 'Loading workspace...'}
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-[100dvh] bg-gray-50 overflow-hidden">
            <Toast message={toast} onClose={() => setToast(null)} />
            <AdminHeader activePage="pos" activeEvent={activeEvent} actorRole={actorContext.role} />

            <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-3">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Booth Status</div>
                        <div className="mt-1 flex items-center gap-2 flex-wrap">
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold border ${
                                activeEvent?.is_booth_open
                                    ? 'border-green-200 bg-green-50 text-green-700'
                                    : 'border-gray-200 bg-gray-100 text-gray-600'
                            }`}>
                                <span className={`h-2 w-2 rounded-full ${activeEvent?.is_booth_open ? 'bg-green-500' : 'bg-gray-400'}`} />
                                <span data-testid="booth-status">
                                    {activeEvent?.is_booth_open ? 'Booth Open' : 'Booth Closed'}
                                </span>
                            </span>
                            <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold border ${
                                activeEvent
                                    ? 'border-pink-200 bg-pink-50 text-pink-700'
                                    : 'border-gray-200 bg-gray-100 text-gray-500'
                            }`}>
                                {activeEvent ? `Active Event: ${activeEvent.event_name}` : 'No active event'}
                            </span>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 lg:justify-end">
                        <label className="flex min-w-0 flex-1 sm:flex-none items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                            <CalendarDays size={16} className="shrink-0 text-pink-600" aria-hidden="true" />
                            <span className="sr-only">Select POS event</span>
                            <select
                                value={activeEvent?.id || ''}
                                onChange={(event) => handleSelectedEventChange(event.target.value)}
                                disabled={availableEvents.length === 0}
                                data-testid="pos-event-selector"
                                className="min-w-0 w-full sm:w-[240px] bg-transparent text-sm font-bold text-gray-800 outline-none disabled:text-gray-400"
                                aria-label="Select POS event"
                            >
                                {availableEvents.length === 0 && <option value="">No active event</option>}
                                {availableEvents.map((event) => (
                                    <option key={event.id} value={event.id}>
                                        {event.event_name}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <button
                            type="button"
                            disabled={!activeEvent || boothToggleLoading}
                            onClick={() => handleBoothToggle(!activeEvent?.is_booth_open)}
                            data-testid="booth-toggle"
                            className={`shrink-0 rounded-xl px-4 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                activeEvent?.is_booth_open
                                    ? 'bg-gray-900 text-white hover:bg-black'
                                    : 'bg-pink-600 text-white hover:bg-pink-700'
                            }`}
                        >
                            {boothToggleLoading
                                ? 'Updating...'
                                : activeEvent?.is_booth_open
                                    ? 'Close Booth'
                                    : 'Open Booth'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="md:hidden sticky top-0 z-20 flex p-2 bg-white border-b border-gray-200 gap-2 shrink-0" data-testid="pos-switcher">
                <button
                    onClick={() => setActiveTab('queue')}
                    className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                        activeTab === 'queue'
                            ? 'bg-pink-50 text-pink-600 border border-pink-200'
                            : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                    }`}
                >
                    Queue Control
                </button>
                {hasPosPermission && (
                    <button
                        onClick={() => setActiveTab('pos')}
                        className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                            activeTab === 'pos'
                                ? 'bg-pink-50 text-pink-600 border border-pink-200'
                                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                        }`}
                        data-testid="pos-tab"
                    >
                        POS / Order
                    </button>
                )}
            </div>

            <div className="flex flex-1 overflow-hidden relative">
                {availableEvents.length === 0 && !eventLoading && (
                    <div className="absolute inset-0 z-30 flex items-center justify-center bg-gray-50/95 backdrop-blur-sm p-6">
                        <div className="w-full max-w-sm text-center">
                            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-pink-50">
                                <CalendarDays size={26} className="text-pink-400" aria-hidden="true" />
                            </div>

                            <h2 className="text-lg font-black text-gray-900">No event running right now</h2>

                            {nextUpcomingEvent ? (
                                <>
                                    <p className="mt-2 text-sm font-medium text-gray-500">
                                        Your next event starts soon.
                                    </p>
                                    <div className="mt-5 rounded-2xl border border-pink-100 bg-white p-5 text-left shadow-sm">
                                        <div className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-pink-500">
                                            Up next
                                        </div>
                                        <div className="text-base font-black text-gray-900 leading-snug">
                                            {nextUpcomingEvent.event_name}
                                        </div>
                                        <div className="mt-2 flex items-center gap-1.5 text-sm font-bold text-gray-600">
                                            <Clock size={14} className="shrink-0 text-gray-400" aria-hidden="true" />
                                            <span>{formatEventStart(nextUpcomingEvent.start_date, nextUpcomingEvent.event_timezone)}</span>
                                        </div>
                                        <p className="mt-3 text-xs font-medium text-gray-400 leading-relaxed">
                                            This event will appear in the POS dashboard automatically after it starts.
                                        </p>
                                    </div>
                                </>
                            ) : (
                                <p className="mt-3 text-sm font-medium text-gray-500">
                                    No upcoming events found.{' '}
                                    <a href="/manage-events" className="font-bold text-pink-600 hover:underline">
                                        Create one in Event Management.
                                    </a>
                                </p>
                            )}
                        </div>
                    </div>
                )}

                <div className={`
                    ${activeTab === 'queue' ? 'flex' : 'hidden'}
                    ${!hasPosPermission || isQueuePanelExpanded ? 'md:flex' : 'md:hidden'}
                    w-full md:w-[35%] md:min-w-[320px] md:max-w-[400px]
                    border-r border-gray-200 bg-white flex-col z-10
                    shadow-[4px_0_24px_rgba(0,0,0,0.02)]
                `}>
                    <QueuePanel
                        activeEvent={activeEvent}
                        queues={otherQueues}
                        selectedQueueId={selectedQueueId}
                        actorContext={actorContext}
                        onSelectQueue={(queue) => {
                            setSelectedQueueId(queue.id);
                            setSelectedQueueNumber(queue.queue_number);
                            if (hasPosPermission) setActiveTab('pos');
                        }}
                        onStatusUpdated={(id, updates) => {
                            setQueues((prev) => prev.map((queue) => queue.id === id ? { ...queue, ...updates } : queue));
                        }}
                    />
                </div>

                <div className={`
                    ${activeTab === 'pos' ? 'flex' : 'hidden'}
                    md:flex flex-1 bg-gray-50 flex-col min-w-0 relative
                `} data-testid="pos-pane">
                    {hasPosPermission && (
                        <button
                            type="button"
                            onClick={() => setIsQueuePanelExpanded((prev) => !prev)}
                            className="hidden md:inline-flex absolute top-6 -left-px z-20 rounded-r-lg border border-l-0 border-gray-200 bg-white/95 backdrop-blur px-1.5 py-2 text-[10px] font-bold text-gray-700 shadow-sm hover:bg-white"
                            aria-label={isQueuePanelExpanded ? 'Collapse queue control' : 'Expand queue control'}
                            title={isQueuePanelExpanded ? 'Hide Queue Control' : 'Expand Queue Control'}
                        >
                            <span className="[writing-mode:vertical-rl] rotate-180 leading-none tracking-tight">{isQueuePanelExpanded ? '< Hide Queue' : '> Queue'}</span>
                        </button>
                    )}

                    <PosPanel
                        activeEvent={activeEvent}
                        servingQueues={servingQueues}
                        selectedQueueId={selectedQueueId}
                        selectedQueueNumber={selectedQueueNumber}
                        actorContext={actorContext}
                        canUsePos={hasPosPermission}
                        isQueuePanelExpanded={isQueuePanelExpanded}
                        onSelectQueue={(queue) => {
                            setSelectedQueueId(queue.id);
                            setSelectedQueueNumber(queue.queue_number);
                        }}
                        onClearQueue={() => {
                            setSelectedQueueId(null);
                            setSelectedQueueNumber(null);
                        }}
                        onQueueCompleted={(queueId) => {
                            setQueues((prev) => prev.map((queue) => (
                                queue.id === queueId
                                    ? { ...queue, status: 'complete', completed_at: new Date().toISOString(), last_updated_at: new Date().toISOString() }
                                    : queue
                            )));
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
