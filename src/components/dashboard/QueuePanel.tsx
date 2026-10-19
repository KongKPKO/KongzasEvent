import { useQueueOperations } from '../../hooks/useQueueOperations';
import { useEffect, useState, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { Button } from '../ui';
import { canUsePos } from '../../types/access';
import type { ActorContext } from '../../types/access';
import { 
    LayoutDashboard, Bell, RotateCcw, Play, 
    Coffee, AlertCircle, PauseCircle, X 
} from 'lucide-react';
import { Toast } from '../ui/Feedback';
import { uiText, useI18n } from '../../i18n';

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
    arrived_at?: string | null;
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
    const { language } = useI18n();
    const text = (en: string, th: string) => language === 'th' ? th : en;
    const [isBoothActive, setIsBoothActive] = useState(false);
    const [isQueueOpen, setIsQueueOpen] = useState(true);
    const [broadcastMessage, setBroadcastMessage] = useState<string | null>(null);
    const [toast, setToast] = useState<{ tone?: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string } | null>(null);

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
            setToast({ tone: 'warning', title: uiText(language, 'No active event'), detail: uiText(language, 'Activate an event to open the booth.') });
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



    const operations = useQueueOperations(activeEvent?.id, (id, updates) => onStatusUpdated?.(id, updates));
    useEffect(() => { if (operations.error) setToast({ tone: 'error', title: operations.error }); }, [operations.error]);
    const updateStatus = async (id: string, newStatus: 'waiting' | 'serving' | 'arrive') => {
        const ticket = queues.find(row => row.id === id);
        return ticket ? operations.action(ticket, newStatus) : null;
    };

    const handleCallNext = () => { void operations.callBatch(1); };
    const handleConfirmArrival = (ticket: QueueItem) => { void operations.action(ticket, 'arrive'); };

    // --- DERIVED STATE from prop ---
    const waitingTickets = queues.filter(q => q.status === 'waiting' || (q.status as string) === 'queued').sort((a, b) => a.queue_number - b.queue_number);
    const readyTickets = queues.filter(q => q.status === 'calling' && !q.arrived_at);
    const arrivedTickets = queues.filter(q => q.status === 'calling' && q.arrived_at);
    const servingTickets = queues.filter(q => q.status === 'serving');
    const expiredTickets = queues.filter(q => q.status === 'missed' || q.status === 'expired');

    const nextTicket = waitingTickets[0];
    const totalInQueue = queues.length;

    return (
        <div className="festival-queue flex flex-col h-full overflow-hidden">
            <Toast message={toast} onClose={() => setToast(null)} />
            {/* Header */}
            <div className="festival-queue-tools p-4 border-b border-gray-100 bg-white shrink-0">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="festival-title flex items-center gap-2">
                        <LayoutDashboard className="text-pink-500" size={18} />
                        {uiText(language, 'Queue Control')}
                    </h2>
                </div>

                {/* Broadcast Controls */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <div className="basis-full text-xs font-black uppercase tracking-[0.18em] text-gray-500">
                        {uiText(language, 'Status shown to customers')}
                    </div>
                    {/* ✅ Stop Queue - RED when active to indicate CLOSED */}
                    <button
                        onClick={() => handleSetBroadcast("Queue closed temporarily")}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-all touch-manipulation ${broadcastMessage === "Queue closed temporarily"
                            ? "bg-gray-200 text-gray-700 border-gray-300 ring-2 ring-gray-500 ring-offset-1"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200 border-gray-200"
                        }`}
                        aria-label={uiText(language, 'Stop queue temporarily')}
                        title={uiText(language, 'Pause new queue tickets on the customer queue page.')}
                    >
                        <PauseCircle size={14} aria-hidden="true" />
                        <span>{uiText(language, 'Stop queue')}</span>
                    </button>
                    <button
                        onClick={() => handleSetBroadcast("Break time")}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-all touch-manipulation ${broadcastMessage === "Break time"
                            ? "bg-pink-100 text-pink-700 border-pink-200 ring-2 ring-pink-500 ring-offset-1"
                            : "bg-pink-50 text-pink-700 hover:bg-pink-100 border-pink-200"
                        }`}
                        aria-label={uiText(language, 'Set break time message')}
                        title={uiText(language, 'Show customers that the booth is taking a short break.')}
                    >
                        <Coffee size={14} aria-hidden="true" />
                        <span>{uiText(language, 'Break')}</span>
                    </button>
                    <button
                        onClick={() => handleSetBroadcast("Urgent matter, sorry for the inconvenience")}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-all touch-manipulation ${broadcastMessage === "Urgent matter, sorry for the inconvenience"
                            ? "bg-orange-100 text-orange-700 border-orange-200 ring-2 ring-orange-500 ring-offset-1"
                            : "bg-orange-50 text-orange-700 hover:bg-orange-100 border-orange-200"
                        }`}
                        aria-label={uiText(language, 'Set urgent message')}
                        title={uiText(language, 'Show customers that service is delayed by an urgent matter.')}
                    >
                        <AlertCircle size={14} aria-hidden="true" />
                        <span>{uiText(language, 'Urgent delay')}</span>
                    </button>
                    {broadcastMessage && (
                        <button
                            onClick={() => handleSetBroadcast(null)}
                            className="p-1.5 rounded-lg border border-green-200 hover:bg-green-50 text-green-700 transition-colors flex items-center gap-1 touch-manipulation"
                            title={uiText(language, 'Clear message & Re-open queue')}
                        >
                            <X size={14} />
                            <span className="text-xs font-bold">{uiText(language, 'CLEAR')}</span>
                        </button>
                    )}
                </div>

                {/* Toggle Controls - Only Booth toggle remains */}
                <div className="flex items-center gap-4 text-xs">

                    <div className="flex items-center gap-2">
                        <span className={`font-bold uppercase tracking-wider ${isBoothActive ? 'text-green-700' : 'text-gray-500'}`}>
                            {isBoothActive ? text('BOOTH OPEN', 'บูธเปิดอยู่') : text('BOOTH CLOSED', 'บูธปิดอยู่')}
                        </span>
                        <button
                            onClick={handleToggleBooth}
                            className={`relative inline-flex h-11 w-16 items-center rounded-full transition-colors ${isBoothActive ? 'bg-green-500' : 'bg-gray-300'}`}
                            aria-label={isBoothActive ? text('Close booth', 'ปิดบูธ') : text('Open booth', 'เปิดบูธ')}
                            role="switch"
                            aria-checked={isBoothActive}
                        >
                            <span className={`${isBoothActive ? 'translate-x-8' : 'translate-x-2'} inline-block h-6 w-6 transform rounded-full bg-white transition-transform`} />
                        </button>
                    </div>
                </div>

                {!activeEvent && (
                    <div className="mt-3 bg-gray-50 border border-gray-200 rounded p-1.5 text-center text-xs text-gray-500">
                        {uiText(language, 'No Active Event Today')}
                    </div>
                )}
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-3 gap-2 p-3 text-center border-b border-gray-100 bg-gray-50/50 shrink-0">
                <div className="py-0.5">
                    <div className="text-xs font-medium text-gray-500 uppercase">{uiText(language, 'Total')}</div>
                    <div className="mt-0.5 text-xl font-black text-gray-900">{totalInQueue}</div>
                </div>
                <div className="py-0.5">
                    <div className="text-xs font-medium text-gray-500 uppercase">{uiText(language, 'Next')}</div>
                    <div className="mt-0.5 text-xl font-black text-pink-500">#{nextTicket ? nextTicket.queue_number : '-'}</div>
                </div>
                <div className="py-0.5">
                    <div className="text-xs font-medium text-gray-500 uppercase">{uiText(language, 'Waiting')}</div>
                    <div className="mt-0.5 text-xl font-black text-gray-900">{waitingTickets.length}</div>
                </div>
            </div>

            {/* Call Next Button */}
            <div className="p-3 border-b border-gray-100 bg-white shrink-0">
                <Button
                    onClick={handleCallNext}
                    disabled={(!nextTicket && operations.retryBatchCount === null) || operations.pending}
                    className={`w-full py-3 text-base rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2 ${
                        !nextTicket
                            ? '!bg-gray-200 !bg-none !text-gray-400 !shadow-none cursor-not-allowed hover:!bg-gray-200 hover:!shadow-none hover:!translate-y-0'
                            : 'bg-pink-700 hover:bg-pink-800 text-white'
                    }`}
                >
                    <Play size={18} fill="currentColor" />
                    <span className="font-black">{uiText(language, 'Call Next')} {nextTicket ? `(#${nextTicket.queue_number})` : ''}</span>
                </Button>
            </div>

            {/* Scrollable Content */}
            <div className="festival-queue-lists flex-1 overflow-y-auto p-3 space-y-3" tabIndex={0} role="region" aria-label={uiText(language, 'Queue list')}>
                {/* Calling Section */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                    <div className="p-3">
                        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <Bell className="text-yellow-500" size={14} />
                            {uiText(language, 'Calling')} ({readyTickets.length})
                        </h3>
                        {readyTickets.length > 0 ? (
                            <div className="space-y-1.5">
                                {readyTickets.map(ticket => (
                                    <div
                                        key={ticket.id}
                                        className={`bg-yellow-50 border rounded-md p-4 flex flex-col items-center text-center ${selectedQueueId === ticket.id ? 'border-pink-400 ring-2 ring-pink-200' : 'border-yellow-100'}`}
                                    >
                                        <div className="text-4xl font-black text-gray-900 leading-none">#{ticket.queue_number}</div>
                                        <div className="text-xs text-gray-500 mb-1.5">{formatElapsedTime(ticket.called_at || ticket.last_updated_at)} {uiText(language, 'ago')}</div>
                                        <Button
                                            disabled={operations.pending}
                                            onClick={() => handleConfirmArrival(ticket)}
                                            className="w-full bg-pink-500 hover:bg-pink-600 text-white border-none shadow-sm min-h-11 text-sm font-bold tracking-wide rounded"
                                        >
                                            {uiText(language, 'ARRIVED')}
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex-1 flex items-center justify-center text-gray-500 text-xs py-4 italic border border-dashed border-gray-100 rounded-md">
                                {uiText(language, 'No one called yet')}
                            </div>
                        )}
                    </div>
                </div>

                {arrivedTickets.length > 0 && <section className="rounded-xl border border-green-200 bg-green-50 p-4"><h3 className="font-bold">{text('Arrived', 'มาถึงแล้ว')} ({arrivedTickets.length})</h3><div className="mt-2 space-y-2">{arrivedTickets.map(ticket => <div key={ticket.id} className="flex items-center justify-between gap-3 rounded-xl bg-white p-3"><strong>#{ticket.queue_number}</strong><button type="button" disabled={operations.pending} className="min-h-11 rounded-lg bg-pink-700 px-3 font-bold text-white" onClick={() => void operations.action(ticket, 'serving').then(updated => { if (updated && canUsePos(actorContext.role)) onSelectQueue({ id: ticket.id, queue_number: String(ticket.queue_number) }); })}>{text('Start serving', 'เริ่มให้บริการ')}</button></div>)}</div></section>}

                {servingTickets.length > 0 && <section className="rounded-xl border border-pink-200 bg-pink-50 p-4">
                    <h3 className="font-bold text-pink-800">{text('Serving', 'กำลังให้บริการ')} ({servingTickets.length})</h3>
                    <div className="mt-3 flex flex-wrap gap-3">{servingTickets.map(ticket => <div key={ticket.id} className="rounded-xl border border-pink-200 bg-white p-4">
                        <div className="text-4xl font-black">#{ticket.queue_number}</div>
                        {canUsePos(actorContext.role) && <button className="mt-2 rounded-lg bg-pink-700 px-4 text-sm font-bold text-white" onClick={() => onSelectQueue({id:ticket.id,queue_number:String(ticket.queue_number)})}>{text('Open sale', 'เปิดรายการขาย')}</button>}
                    </div>)}</div>
                </section>}

                {/* Waiting List */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                        <h3 className="font-bold text-xs text-gray-900">{uiText(language, 'Waiting List')}</h3>
                        <span className="bg-gray-200 text-gray-600 text-xs px-1.5 py-0.5 rounded-full font-bold">{waitingTickets.length}</span>
                    </div>
                    <div className="max-h-[min(300px,40dvh)] overflow-y-auto overscroll-contain">
                        {waitingTickets.length > 0 ? (
                            <ul className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2 p-3">
                                {waitingTickets.map((t, idx) => (
                                    <li key={t.id} className="min-w-0 rounded-xl border border-pink-100 bg-white p-2 text-center">
                                        <div className="flex flex-col items-center gap-1">
                                            <div className="w-11 h-11 rounded-xl bg-pink-100 text-pink-600 flex items-center justify-center text-xs font-bold">
                                                #{t.queue_number}
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-gray-800 leading-none">
                                                    {idx === 0 ? text('Next', 'ถัดไป') : text('Wait', 'รอเรียก')}
                                                </p>
                                                <p className="text-xs text-gray-500 leading-none mt-0.5">
                                                    {t.created_at ? formatElapsedTime(t.created_at) : uiText(language, 'Queued')}
                                                </p>
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div className="p-4 text-center text-gray-500 text-xs">{uiText(language, 'No customers waiting')}</div>
                        )}
                    </div>
                </div>

                {/* Missed Tickets */}
                {expiredTickets.length > 0 && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden opacity-90">
                        <div className="px-3 py-1.5 border-b border-gray-100 flex justify-between items-center bg-red-50/30">
                            <h3 className="font-bold text-xs text-gray-900 flex items-center gap-1.5">
                                <RotateCcw size={12} className="text-red-400" />
                                {uiText(language, 'Missed')}
                            </h3>
                            <span className="bg-red-100 text-red-600 text-xs px-1.5 py-0.5 rounded-full font-bold">{expiredTickets.length}</span>
                        </div>
                        <div className="max-h-[min(160px,25dvh)] overflow-y-auto overscroll-contain">
                            <ul className="divide-y divide-gray-50">
                                {expiredTickets.map(t => (
                                    <li key={t.id} className="px-3 py-1 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-red-400">#{t.queue_number}</span>
                                            <span className="text-xs text-gray-500">
                                                {t.status === 'expired' ? text('Expired', 'หมดเวลา') : text('Missed', 'ไม่ได้มา')}
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
                                            className="text-xs text-pink-500 font-bold hover:underline"
                                        >
                                            {uiText(language, 'Recall')}
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
