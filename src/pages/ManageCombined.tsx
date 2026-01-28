import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import QueuePanel from '../components/dashboard/QueuePanel';
import PosPanel from '../components/dashboard/PosPanel';
import AdminHeader from '../components/AdminHeader';
import { Loader2 } from 'lucide-react';

// --- SHARED TYPE: Active Event ---
export interface ActiveEvent {
    id: string;
    event_name: string;
    start_date: string;
    end_date: string;
    is_booth_open: boolean;
    status: string;
}

// --- SHARED TYPE: Queue Item ---
export interface QueueItem {
    id: string;
    artist_id: string;
    event_id?: string;
    queue_number: number;
    status: 'waiting' | 'calling' | 'serving' | 'complete' | 'missed' | 'expired' | 'queued';
    last_updated_at: string;
    created_at?: string;
    served_at?: string;
    completed_at?: string;
}

export default function ManageCombined() {
    // ✅ SINGLE SOURCE OF TRUTH: Active Event
    const [activeEvent, setActiveEvent] = useState<ActiveEvent | null>(null);
    const [eventLoading, setEventLoading] = useState(true);
    
    // ✅ LIFTED STATE: Queues now managed here (passed to children)
    const [queues, setQueues] = useState<QueueItem[]>([]);
    
    // Shared state to connect both panels
    const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
    const [selectedQueueNumber, setSelectedQueueNumber] = useState<string | null>(null);

    // Refs for stable callbacks
    const activeEventIdRef = useRef<string | null>(null);

    // Keep ref in sync
    useEffect(() => {
        activeEventIdRef.current = activeEvent?.id || null;
    }, [activeEvent]);

    // ✅ FETCH ACTIVE EVENT (with artist_id filter for multi-tenant isolation)
    const fetchActiveEvent = useCallback(async () => {
        try {
            // 🔐 SECURITY: Must get current user first
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                console.warn('[ManageCombined] No authenticated user');
                setActiveEvent(null);
                setEventLoading(false);
                return;
            }

            const now = new Date().toISOString();
            
            // 🔐 SECURITY: Filter by artist_id to prevent data leakage
            const { data, error } = await supabase
                .from('events')
                .select('*')
                .eq('artist_id', user.id)  // ✅ CRITICAL: Only this artist's events
                .eq('status', 'Confirmed')
                .gte('end_date', now)
                .order('start_date', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error) {
                console.error('[ManageCombined] Error fetching active event:', error);
                setActiveEvent(null);
            } else if (data) {
                console.log('[ManageCombined] Active event loaded:', data.event_name);
                setActiveEvent(data as ActiveEvent);
            } else {
                console.log('[ManageCombined] No active event found for this artist');
                setActiveEvent(null);
            }
        } catch (err) {
            console.error('[ManageCombined] Error fetching active event:', err);
            setActiveEvent(null);
        } finally {
            setEventLoading(false);
        }
    }, []);

    // ✅ FETCH QUEUES (lifted from QueuePanel)
    const fetchQueues = useCallback(async () => {
        const eventId = activeEventIdRef.current;
        if (!eventId) {
            setQueues([]);
            return;
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        console.log('[ManageCombined] Fetching queues for event:', eventId);
        const { data, error } = await supabase
            .from('queues')
            .select('*')
            .eq('artist_id', user.id)
            .eq('event_id', eventId)
            .order('id', { ascending: true });

        if (!error && data) {
            setQueues(data);
        }
    }, []);

    // ✅ Initial fetch + realtime subscriptions
    useEffect(() => {
        fetchActiveEvent();

        const channel = supabase.channel('manage-combined-events')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => {
                console.log('[ManageCombined] Event change detected, refetching...');
                fetchActiveEvent();
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [fetchActiveEvent]);

    // ✅ Fetch queues when activeEvent changes
    useEffect(() => {
        if (activeEvent) {
            fetchQueues();
        } else {
            setQueues([]);
        }
    }, [activeEvent?.id, fetchQueues]);

    // ✅ Realtime subscription for QUEUES (lifted from QueuePanel)
    useEffect(() => {
        let channel: ReturnType<typeof supabase.channel> | null = null;

        const setupQueueRealtime = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            channel = supabase
                .channel(`manage-combined-queues-${user.id}`)
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: 'queues', filter: `artist_id=eq.${user.id}` },
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
        };

        setupQueueRealtime();

        return () => {
            if (channel) supabase.removeChannel(channel);
        };
    }, []);



    // ✅ DERIVED STATE: Filter queues for each panel
    const filteredQueues = activeEvent?.id
        ? queues.filter(q => q.event_id === activeEvent.id)
        : queues;

    // Serving queues go to POS header (RIGHT panel)
    const servingQueues = filteredQueues.filter(q => q.status === 'serving');
    
    // Other queues go to QueuePanel (LEFT panel) - waiting, calling, missed
    const otherQueues = filteredQueues.filter(q => q.status !== 'serving');

    // Loading state
    if (eventLoading) {
        return (
            <div className="flex flex-col h-screen bg-gray-50 items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-pink-500 mb-3" />
                <p className="text-gray-500 text-sm font-medium">Loading workspace...</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
            {/* ✅ Unified Admin Header */}
            <AdminHeader activePage="pos" activeEvent={activeEvent} />

            {/* MAIN CONTENT (Split View) */}
            <div className="flex flex-1 overflow-hidden">
                
                {/* LEFT PANEL: Queue Management (35%) */}
                <div className="w-[35%] min-w-[320px] max-w-[400px] border-r border-gray-200 bg-white flex flex-col z-10 shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
                    <QueuePanel 
                        activeEvent={activeEvent}
                        queues={otherQueues}  /* ✅ PASSED: waiting, calling, missed only */
                        selectedQueueId={selectedQueueId}
                        onSelectQueue={(queue) => {
                            setSelectedQueueId(queue.id);
                            setSelectedQueueNumber(queue.queue_number);
                        }}
                    />
                </div>

                {/* RIGHT PANEL: POS & Orders (65%) */}
                <div className="flex-1 bg-gray-50 flex flex-col min-w-0">
                    <PosPanel 
                        activeEvent={activeEvent}
                        servingQueues={servingQueues}  /* ✅ PASSED: serving only */
                        selectedQueueId={selectedQueueId}
                        selectedQueueNumber={selectedQueueNumber}
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