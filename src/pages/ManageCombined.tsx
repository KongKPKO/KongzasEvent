import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import QueuePanel from '../components/dashboard/QueuePanel';
import PosPanel from '../components/dashboard/PosPanel';
import AdminHeader from '../components/AdminHeader';
import { Loader2 } from 'lucide-react';
import type { ActorContext } from '../types/access';
import { canUsePos } from '../types/access';

export interface ActiveEvent {
    id: string;
    event_name: string;
    start_date: string;
    end_date: string;
    is_booth_open: boolean;
    status: string;
}

export interface QueueItem {
    id: string;
    artist_id: string;
    event_id?: string;
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
}

export default function ManageCombined({ actorContext }: ManageCombinedProps) {
    const [activeEvent, setActiveEvent] = useState<ActiveEvent | null>(null);
    const [eventLoading, setEventLoading] = useState(true);
    const [queues, setQueues] = useState<QueueItem[]>([]);

    const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
    const [selectedQueueNumber, setSelectedQueueNumber] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'queue' | 'pos'>('queue');
    const [isQueuePanelExpanded, setIsQueuePanelExpanded] = useState(false);

    const activeEventIdRef = useRef<string | null>(null);

    useEffect(() => {
        activeEventIdRef.current = activeEvent?.id || null;
    }, [activeEvent]);

    const fetchActiveEvent = useCallback(async () => {
        try {
            const now = new Date().toISOString();
            const { data, error } = await supabase
                .from('events')
                .select('id, event_name, start_date, end_date, is_booth_open, status')
                .eq('artist_id', actorContext.artist_id)
                .eq('status', 'Confirmed')
                .lte('start_date', now)
                .gte('end_date', now)
                .order('start_date', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error) {
                console.error('[ManageCombined] Error fetching active event:', error);
                setActiveEvent(null);
            } else {
                setActiveEvent((data as ActiveEvent) || null);
            }
        } catch (err) {
            console.error('[ManageCombined] Error fetching active event:', err);
            setActiveEvent(null);
        } finally {
            setEventLoading(false);
        }
    }, [actorContext.artist_id]);

    const fetchQueues = useCallback(async () => {
        const eventId = activeEventIdRef.current;
        if (!eventId) {
            setQueues([]);
            return;
        }

        const { data, error } = await supabase
            .from('queues')
            .select('id, artist_id, event_id, queue_number, status, called_at, last_updated_at, created_at, served_at, completed_at')
            .eq('artist_id', actorContext.artist_id)
            .eq('event_id', eventId)
            .order('queue_number', { ascending: true });

        if (!error && data) {
            setQueues(data);
        }
    }, [actorContext.artist_id]);

    const expireStaleCallingQueues = useCallback(async () => {
        const eventId = activeEventIdRef.current;
        if (!eventId) return;

        const staleThresholdMs = Date.now() - (30 * 60 * 1000);
        const { data, error } = await supabase
            .from('queues')
            .select('id, called_at, last_updated_at')
            .eq('artist_id', actorContext.artist_id)
            .eq('event_id', eventId)
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
        fetchActiveEvent();

        const channel = supabase.channel(`manage-combined-events-${actorContext.artist_id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `artist_id=eq.${actorContext.artist_id}` }, () => {
                fetchActiveEvent();
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [fetchActiveEvent, actorContext.artist_id]);

    useEffect(() => {
        if (activeEvent) {
            fetchQueues();
        } else {
            setQueues([]);
        }
    }, [activeEvent?.id, fetchQueues]);

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
                        setQueues((prev) => {
                            if (prev.find(q => q.id === newTicket.id)) return prev;
                            return [...prev, newTicket];
                        });
                    } else if (payload.eventType === 'UPDATE') {
                        const updatedTicket = payload.new as QueueItem;
                        setQueues((prev) => prev.map(q => q.id === updatedTicket.id ? { ...q, ...updatedTicket } : q));
                    } else if (payload.eventType === 'DELETE') {
                        const deletedId = (payload.old as QueueItem).id;
                        setQueues((prev) => prev.filter(q => q.id !== deletedId));
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [actorContext.artist_id, activeEvent?.id]);

    const filteredQueues = activeEvent?.id
        ? queues.filter(q => q.event_id === activeEvent.id)
        : queues;

    const servingQueues = filteredQueues.filter(q => q.status === 'serving');
    const otherQueues = filteredQueues.filter(q => q.status !== 'serving');
    const hasPosPermission = canUsePos(actorContext.role);

    if (eventLoading) {
        return (
            <div className="flex flex-col h-screen bg-gray-50 items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-pink-500 mb-3" />
                <p className="text-gray-500 text-sm font-medium">Loading workspace...</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-[100dvh] bg-gray-50 overflow-hidden">
            <AdminHeader activePage="pos" activeEvent={activeEvent} actorRole={actorContext.role} />

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
                    />
                </div>
            </div>
        </div>
    );
}
