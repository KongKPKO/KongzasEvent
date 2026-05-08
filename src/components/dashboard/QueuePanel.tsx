import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { Button } from '../ui';
import type { ActorContext } from '../../types/access';
import { 
    LayoutDashboard, Bell, RotateCcw, Play, 
    Coffee, AlertCircle, PauseCircle, X 
} from 'lucide-react';
import { Toast } from '../ui/Feedback';

// --- TYPES ---
interface QueueItem {
    id: string;
    artist_id: string;
    event_id?: string;
    queue_number: number;
    status: 'waiting' | 'calling' | 'serving' | 'complete' | 'missed' | 'expired' | 'queued';
    called_at?: string;
    last_updated_at: string;
    created_at?: string;
    served_at?: string;
    completed_at?: string;
}

// ✅ SHARED TYPE: Active Event (from parent)
interface ActiveEvent {
    id: string;
    event_name: string;
    start_date: string;
    end_date: string;
    is_booth_open: boolean;
    status: string;
}

// --- PROPS ---
interface QueuePanelProps {
    activeEvent: ActiveEvent | null;
    queues: QueueItem[];  // ✅ NOW A PROP (passed from parent, already filtered - no 'serving')
    selectedQueueId: string | null;
    actorContext: ActorContext;
    isInitialLoading?: boolean;
    onSelectQueue: (queue: { id: string; queue_number: string }) => void;
    onStatusUpdated?: (id: string, updates: Partial<QueueItem>) => void;
}

// --- HELPERS ---
const formatElapsedTime = (dateString?: string) => {
    if (!dateString) return '0s';
    const ms = Date.now() - new Date(dateString).getTime();
    const seconds = Math.floor(ms / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
};

export default function QueuePanel({ 
    activeEvent, 
    queues, 
    selectedQueueId, 
    actorContext, 
    isInitialLoading: _isInitialLoading = false,
    onSelectQueue,
    onStatusUpdated 
}: QueuePanelProps) {
    const [isBoothActive, setIsBoothActive] = useState(false);
    const [isQueueOpen, setIsQueueOpen] = useState(true);
    const [broadcastMessage, setBroadcastMessage] = useState<string | null>(null);
    const [toast, setToast] = useState<{ tone?: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string } | null>(null);

    const callNextInFlightRef = useRef(false);
    const boothToggleInFlightRef = useRef(false);
    const broadcastInFlightRef = useRef(false);
    const ticketActionInFlightRef = useRef<Set<string>>(new Set());

    // Sync booth status from activeEvent prop
    useEffect(() => {
        if (activeEvent) {
            setIsBoothActive(activeEvent.is_booth_open || false);
        }
    }, [activeEvent]);

    // Fetch artist settings on mount
    useEffect(() => {
        const fetchArtistSettings = async () => {
            const { data: artistData } = await supabase
                .from('artists')
                .select('broadcast_message, is_queue_open')
                .eq('id', actorContext.artist_id)
                .maybeSingle();

            if (artistData) {
                setBroadcastMessage(artistData.broadcast_message || null);
                setIsQueueOpen(artistData.is_queue_open ?? true);
            }
        };

        fetchArtistSettings();

        // Realtime for artist settings
        const realtimeChannel = supabase
            .channel(`queue-panel-artists-${actorContext.artist_id}`)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'artists', filter: `id=eq.${actorContext.artist_id}` },
                (payload) => {
                    if (!payload.new) return;
                    const updatedArtist = payload.new as { broadcast_message: string | null; is_queue_open: boolean };
                    setBroadcastMessage(updatedArtist.broadcast_message || null);
                    setIsQueueOpen(updatedArtist.is_queue_open ?? true);
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(realtimeChannel);
        };
    }, [actorContext.artist_id]);

    // --- BROADCAST HANDLER (Consolidated with is_queue_open logic) ---
    const handleSetBroadcast = async (msg: string | null) => {
        if (broadcastInFlightRef.current) return;
        broadcastInFlightRef.current = true;

        const newMessage = (msg === broadcastMessage && msg !== null) ? null : msg;
        const newQueueOpen = newMessage === "Queue closed temporarily" ? false : true;
        const previousMessage = broadcastMessage;
        const previousQueueOpen = isQueueOpen;

        setBroadcastMessage(newMessage);
        setIsQueueOpen(newQueueOpen);

        try {
            const { error } = await supabase.rpc('set_artist_queue_broadcast', {
                p_artist_id: actorContext.artist_id,
                p_message: newMessage,
            });

            if (error) {
                console.error('Error updating broadcast/queue status:', error);
                setBroadcastMessage(previousMessage);
                setIsQueueOpen(previousQueueOpen);
            }
        } finally {
            broadcastInFlightRef.current = false;
        }
    };

    const handleToggleBooth = async () => {
        if (!activeEvent) {
            setToast({ tone: 'warning', title: 'No active event', detail: 'Create or activate an event before opening the booth.' });
            return;
        }
        if (boothToggleInFlightRef.current) return;
        boothToggleInFlightRef.current = true;

        const newStatus = !isBoothActive;
        setIsBoothActive(newStatus);

        try {
            const { error } = await supabase.rpc('set_booth_open_status', {
                p_event_id: activeEvent.id,
                p_is_open: newStatus,
            });

            if (error) {
                console.error('Error updating booth status:', error);
                setIsBoothActive(!newStatus);
            }
        } finally {
            boothToggleInFlightRef.current = false;
        }
    };



    // --- STATUS UPDATE (triggers parent refetch via onRefreshQueues) ---
    const updateStatus = useCallback(async (id: string, newStatus: string) => {
        const updates: Record<string, unknown> = { status: newStatus, last_updated_at: new Date().toISOString() };
        if (newStatus === 'calling') updates.called_at = new Date().toISOString();
        if (newStatus === 'serving') updates.served_at = new Date().toISOString();
        if (newStatus === 'complete') updates.completed_at = new Date().toISOString();
        if (newStatus === 'waiting' || newStatus === 'queued') {
            updates.called_at = null;
            updates.served_at = null;
            updates.completed_at = null;
        }

        const { error } = await supabase
            .from('queues')
            .update(updates)
            .eq('id', id);

        if (error) {
            console.error(`Error updating status to ${newStatus}:`, error);
            return;
        }
        onStatusUpdated?.(id, updates as Partial<QueueItem>);
    }, [onStatusUpdated]);

    const handleCallNext = useCallback(() => {
        if (callNextInFlightRef.current) return;
        const waitingList = queues.filter(q => q.status === 'waiting' || (q.status as string) === 'queued').sort((a, b) => a.queue_number - b.queue_number);
        const next = waitingList[0];
        if (!next) return;
        callNextInFlightRef.current = true;
        updateStatus(next.id, 'calling').finally(() => {
            callNextInFlightRef.current = false;
        });
    }, [queues, updateStatus]);

    const handleConfirmArrival = useCallback((ticket: QueueItem) => {
        if (ticketActionInFlightRef.current.has(ticket.id)) return;
        ticketActionInFlightRef.current.add(ticket.id);
        updateStatus(ticket.id, 'serving').finally(() => {
            ticketActionInFlightRef.current.delete(ticket.id);
        });
        onSelectQueue({ id: ticket.id, queue_number: String(ticket.queue_number) });
    }, [updateStatus, onSelectQueue]);

    // --- DERIVED STATE from prop ---
    const waitingTickets = queues.filter(q => q.status === 'waiting' || (q.status as string) === 'queued').sort((a, b) => a.queue_number - b.queue_number);
    const readyTickets = queues.filter(q => q.status === 'calling');
    const expiredTickets = queues.filter(q => q.status === 'missed' || q.status === 'expired');

    const nextTicket = waitingTickets[0];
    const totalInQueue = queues.length;

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Toast message={toast} onClose={() => setToast(null)} />
            {/* Header */}
            <div className="p-4 border-b border-gray-100 bg-white shrink-0">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-base font-bold flex items-center gap-2 text-gray-800">
                        <LayoutDashboard className="text-pink-500" size={18} />
                        Queue Control
                    </h2>
                </div>

                {/* Broadcast Controls */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                    {/* ✅ Stop Queue - RED when active to indicate CLOSED */}
                    <button
                        onClick={() => handleSetBroadcast("Queue closed temporarily")}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-all ${broadcastMessage === "Queue closed temporarily"
                            ? "bg-gray-200 text-gray-700 border-gray-300 ring-2 ring-gray-500 ring-offset-1"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200 border-gray-200"
                            }`}
                        aria-label="Stop queue temporarily"
                    >
                        <PauseCircle size={14} aria-hidden="true" />
                        <span className="hidden sm:inline">หยุดรับคิว</span>
                    </button>
                    <button
                        onClick={() => handleSetBroadcast("Break time")}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-all ${broadcastMessage === "Break time"
                            ? "bg-pink-100 text-pink-700 border-pink-200 ring-2 ring-pink-500 ring-offset-1"
                            : "bg-pink-50 text-pink-700 hover:bg-pink-100 border-pink-200"
                            }`}
                        aria-label="Set break time message"
                    >
                        <Coffee size={14} aria-hidden="true" />
                        <span className="hidden sm:inline">พักเบรค</span>
                    </button>
                    <button
                        onClick={() => handleSetBroadcast("Urgent matter, sorry for the inconvenience")}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-all ${broadcastMessage === "Urgent matter, sorry for the inconvenience"
                            ? "bg-orange-100 text-orange-700 border-orange-200 ring-2 ring-orange-500 ring-offset-1"
                            : "bg-orange-50 text-orange-700 hover:bg-orange-100 border-orange-200"
                            }`}
                        aria-label="Set urgent message"
                    >
                        <AlertCircle size={14} aria-hidden="true" />
                        <span className="hidden sm:inline">ติดธุระ</span>
                    </button>
                    {broadcastMessage && (
                        <button
                            onClick={() => handleSetBroadcast(null)}
                            className="p-1.5 rounded-lg border border-green-200 hover:bg-green-50 text-green-700 transition-colors flex items-center gap-1"
                            title="Clear message & Re-open queue"
                        >
                            <X size={14} />
                            <span className="text-[9px] font-bold">CLEAR</span>
                        </button>
                    )}
                </div>

                {/* Toggle Controls - Only Booth toggle remains */}
                <div className="flex items-center gap-4 text-[10px]">

                    <div className="flex items-center gap-2">
                        <span className={`font-bold uppercase tracking-wider ${isBoothActive ? 'text-green-700' : 'text-gray-500'}`}>
                            {isBoothActive ? 'BOOTH OPEN' : 'BOOTH CLOSED'}
                        </span>
                        <button
                            onClick={handleToggleBooth}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isBoothActive ? 'bg-green-500' : 'bg-gray-300'}`}
                            aria-label={isBoothActive ? 'Close booth' : 'Open booth'}
                            role="switch"
                            aria-checked={isBoothActive}
                        >
                            <span className={`${isBoothActive ? 'translate-x-4' : 'translate-x-1'} inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform`} />
                        </button>
                    </div>
                </div>

                {/* Active Event Badge */}
                {activeEvent && (
                    <div className="mt-3 bg-pink-50/50 border border-pink-100 rounded p-1.5 text-center">
                        <div className="text-xs font-bold text-pink-700 uppercase tracking-wider mb-0.5">Active Event</div>
                        <div className="font-bold text-sm text-gray-900 leading-tight">{activeEvent.event_name}</div>
                    </div>
                )}
                {!activeEvent && (
                    <div className="mt-3 bg-gray-50 border border-gray-200 rounded p-1.5 text-center text-xs text-gray-500">
                        No Active Event Today
                    </div>
                )}
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-3 gap-2 p-3 text-center border-b border-gray-100 bg-gray-50/50 shrink-0">
                <div className="py-0.5">
                    <div className="text-[10px] font-medium text-gray-500 uppercase">Total</div>
                    <div className="mt-0.5 text-xl font-black text-gray-900">{totalInQueue}</div>
                </div>
                <div className="py-0.5">
                    <div className="text-[10px] font-medium text-gray-500 uppercase">Next</div>
                    <div className="mt-0.5 text-xl font-black text-pink-500">#{nextTicket ? nextTicket.queue_number : '-'}</div>
                </div>
                <div className="py-0.5">
                    <div className="text-[10px] font-medium text-gray-500 uppercase">Waiting</div>
                    <div className="mt-0.5 text-xl font-black text-gray-900">{waitingTickets.length}</div>
                </div>
            </div>

            {/* Call Next Button */}
            <div className="p-3 border-b border-gray-100 bg-white shrink-0">
                <Button
                    onClick={handleCallNext}
                    disabled={!nextTicket}
                    className={`w-full py-3 text-base rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 ${!nextTicket ? 'bg-gray-100 text-gray-500 cursor-not-allowed shadow-none' : 'bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white shadow-pink-200'}`}
                >
                    <Play size={18} fill="currentColor" />
                    <span className="font-black">Call Next {nextTicket ? `(#${nextTicket.queue_number})` : ''}</span>
                </Button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3" tabIndex={0} role="region" aria-label="Queue list">
                {/* Calling Section */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                    <div className="p-3">
                        <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <Bell className="text-yellow-500" size={14} />
                            Calling ({readyTickets.length})
                        </h3>
                        {readyTickets.length > 0 ? (
                            <div className="space-y-1.5">
                                {readyTickets.map(ticket => (
                                    <div
                                        key={ticket.id}
                                        className={`bg-yellow-50 border rounded-md p-2 flex flex-col items-center text-center ${selectedQueueId === ticket.id ? 'border-pink-400 ring-2 ring-pink-200' : 'border-yellow-100'}`}
                                    >
                                        <div className="text-2xl font-black text-gray-900 leading-none">#{ticket.queue_number}</div>
                                        <div className="text-[9px] text-gray-500 mb-1.5">{formatElapsedTime(ticket.called_at || ticket.last_updated_at)} ago</div>
                                        <Button
                                            onClick={() => handleConfirmArrival(ticket)}
                                            className="w-full bg-pink-500 hover:bg-pink-600 text-white border-none shadow-sm h-7 text-[10px] font-bold tracking-wide rounded"
                                        >
                                            ARRIVED
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex-1 flex items-center justify-center text-gray-500 text-[10px] py-4 italic border border-dashed border-gray-100 rounded-md">
                                No one called yet
                            </div>
                        )}
                    </div>
                </div>

                {/* ✅ SERVING SECTION REMOVED - Now in POS Panel Header */}

                {/* Waiting List */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                        <h3 className="font-bold text-xs text-gray-900">Waiting List</h3>
                        <span className="bg-gray-200 text-gray-600 text-[10px] px-1.5 py-0.5 rounded-full font-bold">{waitingTickets.length}</span>
                    </div>
                    <div className="max-h-[200px] overflow-y-auto">
                        {waitingTickets.length > 0 ? (
                            <ul className="divide-y divide-gray-50">
                                {waitingTickets.map((t, idx) => (
                                    <li key={t.id} className="px-3 py-1 hover:bg-gray-50 transition-colors flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="w-6 h-6 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center text-[10px] font-bold">
                                                #{t.queue_number}
                                            </div>
                                            <div>
                                                <p className="text-[11px] font-bold text-gray-800 leading-none">
                                                    {idx === 0 ? 'Next' : 'Wait'}
                                                </p>
                                                <p className="text-[9px] text-gray-500 leading-none mt-0.5">
                                                    {t.created_at ? formatElapsedTime(t.created_at) : 'Queued'}
                                                </p>
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div className="p-4 text-center text-gray-500 text-[10px]">No customers waiting</div>
                        )}
                    </div>
                </div>

                {/* Missed Tickets */}
                {expiredTickets.length > 0 && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden opacity-90">
                        <div className="px-3 py-1.5 border-b border-gray-100 flex justify-between items-center bg-red-50/30">
                            <h3 className="font-bold text-xs text-gray-900 flex items-center gap-1.5">
                                <RotateCcw size={12} className="text-red-400" />
                                Missed
                            </h3>
                            <span className="bg-red-100 text-red-600 text-[9px] px-1.5 py-0.5 rounded-full font-bold">{expiredTickets.length}</span>
                        </div>
                        <div className="max-h-[120px] overflow-y-auto">
                            <ul className="divide-y divide-gray-50">
                                {expiredTickets.map(t => (
                                    <li key={t.id} className="px-3 py-1 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold text-red-400">#{t.queue_number}</span>
                                            <span className="text-[9px] text-gray-500">
                                                {t.status === 'expired' ? 'Expired' : 'Cancelled'}
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => {
                                                if (ticketActionInFlightRef.current.has(t.id)) return;
                                                ticketActionInFlightRef.current.add(t.id);
                                                updateStatus(t.id, 'waiting').finally(() => {
                                                    ticketActionInFlightRef.current.delete(t.id);
                                                });
                                            }}
                                            className="text-[9px] text-pink-500 font-bold hover:underline"
                                        >
                                            Recall
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
