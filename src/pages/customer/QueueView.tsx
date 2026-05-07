import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useMidnightTick } from '../../hooks/useMidnightTick';
import { Button, Card } from '../../components/ui';
import { ConfirmDialog, Toast } from '../../components/ui/Feedback';
import { Ban, RefreshCcw, LogOut, Ticket } from 'lucide-react';
import CustomerHeader from '../../components/CustomerHeader';
import { motion, AnimatePresence } from 'framer-motion';
import { resolveAvatarUrl } from '../../utils/avatarUrl';
import { useI18n } from '../../i18n';
import { formatDateInTimeZone } from '../../utils/timezone';
import { TICKET_UPDATED_EVENT } from '../../utils/customerEvents';
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
    const funFacts = language === 'th'
        ? [
            'ขอบคุณที่มารอคิวนะคะ/ครับ',
            'ระหว่างรออย่าลืมพักและดื่มน้ำ',
            'ขอบคุณที่คอยซัพพอร์ต creator วันนี้',
        ]
        : [
            'Thanks for waiting in the queue.',
            'Take a quick break and stay hydrated while you wait.',
            'Thanks for supporting creators today.',
        ];
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

    // Early return if no artist data
    if (!displayArtist) return <div className="p-12 text-center text-gray-400 font-medium">{t('loading')}</div>;

    const [myTicket, setMyTicket] = useState<Ticket | null>(null);
    const [nowServingNumber, setNowServingNumber] = useState<number | null>(null);
    const [etaWindow, setEtaWindow] = useState<{ min: number; max: number; peopleAhead: number } | null>(null);
    const [loading, setLoading] = useState(true);
    const [factIndex, setFactIndex] = useState(0);
    const [toast, setToast] = useState<{ tone?: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string } | null>(null);
    const [isLeaveConfirmOpen, setIsLeaveConfirmOpen] = useState(false);
    const nowServingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Kept in refs so the queues channel effect does not re-subscribe on every
    // realtime event that causes CustomerLayout to emit new array/function identities.
    const availableEventsRef = useRef(availableEvents);
    availableEventsRef.current = availableEvents;
    const setSelectedEventIdRef = useRef(setSelectedEventId);
    setSelectedEventIdRef.current = setSelectedEventId;

    useEffect(() => {
        const interval = setInterval(() => {
            setFactIndex(prev => (prev + 1) % funFacts.length);
        }, 4000);
        return () => clearInterval(interval);
    }, [funFacts.length]);

    const activeEvent = selectedEvent;
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

    // 2. EFFECT: Fetch Queue Data when Active Event Changes (or on Mount/Refresh)
    useEffect(() => {
        if (!activeEvent) {
            setNowServingNumber(null);
            setLoading(false);
            // Optional: Clear ticket if strictly tied to event existence? 
            // Keeping it loosely allows viewing old tickets if needed, but per requirements usually we clear active state.
            // We will check ticket validity below.
            return;
        }

        const initQueueData = async () => {
            await fetchNowServing(activeEvent.id, activeServiceDate);

            // Ticket Verification
            const storedTicketId = localStorage.getItem(`ticket_id_${displayArtist.id}`);
            if (storedTicketId) {
                const { data: ticket } = await supabase
                    .from('queues')
                    .select('id, event_id, queue_service_date, queue_number, status, created_at')
                    .eq('id', storedTicketId)
                    .single();

                if (ticket) {
                    // Check Mismatch. If the stored active ticket belongs to another current event,
                    // switch the customer context instead of deleting a valid ticket.
                    if (ticket.event_id !== activeEvent.id || ticket.queue_service_date !== activeServiceDate) {
                        const ticketEvent = availableEventsRef.current.find((event) => event.id === ticket.event_id);
                        if (
                            ticketEvent &&
                            ['waiting', 'calling', 'serving'].includes(ticket.status) &&
                            ticket.queue_service_date === formatDateInTimeZone(new Date(), ticketEvent.event_timezone || 'Asia/Bangkok')
                        ) {
                            setSelectedEventIdRef.current(ticket.event_id || ticketEvent.id);
                            setLoading(false);
                            return;
                        }
                        console.warn("Ticket Event Mismatch. Clearing.");
                        localStorage.removeItem(`ticket_id_${displayArtist.id}`);
                        setMyTicket(null);
                    } else {
                        setMyTicket(ticket);
                    }
                } else {
                    localStorage.removeItem(`ticket_id_${displayArtist.id}`);
                    setMyTicket(null);
                }
            }

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

                setMyTicket((prev) => {
                    if (prev && (payload.new as Ticket)?.id === prev.id && (payload.new as Ticket)?.queue_service_date === activeServiceDate) {
                        return payload.new as Ticket;
                    }
                    return prev;
                });
            })
            .subscribe();

        return () => {
            if (nowServingTimerRef.current) {
                clearTimeout(nowServingTimerRef.current);
                nowServingTimerRef.current = null;
            }
            supabase.removeChannel(channel);
        };

    // availableEvents and setSelectedEventId are intentionally NOT in the dep array —
    // they are read via refs so identity changes from realtime updates do not
    // tear down and re-create this subscription on every queue event.
    }, [activeEvent?.id, activeEvent?.is_booth_open, activeServiceDate, displayArtist.id]);

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

            if (!isMounted || error || !data) return;
            if (data.event_id !== activeEvent.id || data.queue_service_date !== activeServiceDate) {
                localStorage.removeItem(`ticket_id_${displayArtist.id}`);
                setMyTicket(null);
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



    const handleGetTicket = async () => {
        if (!activeEvent) return;

        // Safety Check: Ensure Event hasn't ended
        const now = new Date();
        const end = new Date(activeEvent.end_date);
        if (now > end) {
            setToast({ tone: 'warning', title: t('queueEventEnded'), detail: t('queueEventEndedDetail') });
            refresh();
            return;
        }

        setLoading(true);
        try {
            const { data: createdTicket, error: insertError } = await supabase.rpc('create_queue_ticket', {
                p_artist_id: displayArtist.id,
                p_event_id: activeEvent.id,
            });

            if (insertError) {
                console.error("Supabase Insert Error:", insertError);
                throw insertError;
            }

            const data = Array.isArray(createdTicket) ? createdTicket[0] : createdTicket;
            if (data) {
                localStorage.setItem(`ticket_id_${displayArtist.id}`, data.id);
                // Notify CallingNotification (same tab) that a ticket now exists.
                // The native 'storage' event only fires in OTHER tabs, so we dispatch
                // a custom event here to cover the same-tab case.
                window.dispatchEvent(new CustomEvent(TICKET_UPDATED_EVENT));
                setMyTicket(data);
            }

        } catch (err) {
            console.error("handleGetTicket Exception:", err);
            setToast({ tone: 'error', title: t('queueCouldNotGetTicket'), detail: t('queueTryAgain') });
        } finally {
            setLoading(false);
        }
    };

    const handleRefresh = async () => {
        setLoading(true);
        // Refresh Realtime Data (Artist + Events)
        await refresh();

        // Refresh Queue Data (Now Serving + My Ticket)
        if (activeEvent) {
            await fetchNowServing(activeEvent.id, activeServiceDate);
            if (myTicket) {
                const { data } = await supabase
                    .from('queues')
                    .select('id, event_id, queue_service_date, queue_number, status, created_at')
                    .eq('id', myTicket.id)
                    .single();
                if (data && data.event_id === activeEvent.id && data.queue_service_date === activeServiceDate) {
                    setMyTicket(data);
                }
            }
        }
        setLoading(false);
    };

    const handleLeaveQueue = async () => {
        if (!myTicket) return;

        const status = myTicket.status.toLowerCase();
        const activeStatuses = ['waiting', 'calling', 'serving']; // Active service
        const endedStatuses = ['complete', 'missed', 'expired']; // Final states

        // SCENARIO B: Ended Statuses -> Just clear local
        if (endedStatuses.includes(status)) {
            localStorage.removeItem(`ticket_id_${displayArtist.id}`);
            setMyTicket(null);
            return;
        }

        if (activeStatuses.includes(status) || !endedStatuses.includes(status)) {
            setIsLeaveConfirmOpen(true);
        }
    };

    const confirmLeaveQueue = async () => {
        if (!myTicket) return;

        console.log(`Attempting to leave queue for ticket ${myTicket.id} with status ${myTicket.status}`);
        const { error } = await supabase
            .from('queues')
            .update({ status: 'missed' })
            .eq('id', myTicket.id);

        if (error) {
            console.error("Error leaving queue (DB Update Failed):", error, "Ticket ID:", myTicket.id);
            setToast({ tone: 'error', title: t('queueCouldNotLeave'), detail: t('queueTryAgain') });
            return;
        }

        localStorage.removeItem(`ticket_id_${displayArtist.id}`);
        setMyTicket(null);
        setIsLeaveConfirmOpen(false);
        setToast({ tone: 'success', title: t('queueCancelledToast') });
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
                bg: 'bg-gray-50',
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
            <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                className="w-full"
            >
                <Card className={`w-full min-h-[320px] p-8 flex flex-col justify-center items-center text-center border-2 shadow-lg transition-all duration-300 relative overflow-hidden ${theme.bg} ${theme.border} ${status === 'calling' ? 'ring-4 ring-yellow-400 ring-opacity-50' : ''}`}>

                    {/* Pulse Effect Background when calling */}
                    {status === 'calling' && (
                        <motion.div
                            className="absolute inset-0 bg-yellow-400/20"
                            animate={{ scale: [1, 1.05, 1], opacity: [0.2, 0.5, 0.2] }}
                            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                        />
                    )}

                    {/* Status Badge */}
                    <div className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase mb-8 shadow-sm tracking-wide z-10 ${theme.badge.bg} ${theme.badge.color}`}>
                        {theme.badge.text}
                    </div>

                    {/* Created Time */}
                    <div className="mb-4 text-xs font-medium text-gray-400 uppercase tracking-wide z-10">
                        {t('queueBookedAt', { time: formatTime(myTicket.created_at, dateLocale) })}
                    </div>

                    {/* Queue Number */}
                    <motion.div
                        className="text-7xl font-black text-gray-900 mb-6 leading-none tracking-tight z-10"
                        animate={status === 'waiting' ? { opacity: [0.8, 1, 0.8] } : {}}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    >
                        #{queue_number}
                    </motion.div>

                    {/* Primary Message */}
                    <p className={`font-bold text-lg whitespace-pre-line z-10 ${theme.messageColor}`}>
                        {theme.message}
                    </p>

                    {etaWindow && (status === 'waiting' || status === 'calling' || status === 'serving') && (
                        <div className="mt-4 text-sm font-semibold text-gray-600 z-10">
                            {t('queueEstimatedWait', { min: etaWindow.min, max: etaWindow.max, people: etaWindow.peopleAhead })}
                        </div>
                    )}

                    {/* Fun Facts Carousel for waiting status */}
                    {status === 'waiting' && (
                        <div className="mt-6 w-full h-8 relative overflow-hidden flex justify-center items-center z-10 bg-white/50 rounded-full px-2">
                            <AnimatePresence mode="popLayout">
                                <motion.div
                                    key={factIndex}
                                    initial={{ y: 20, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    exit={{ y: -20, opacity: 0 }}
                                    transition={{ duration: 0.4 }}
                                    className="absolute text-xs font-medium text-pink-600 tracking-wide w-full"
                                >
                                    {funFacts[factIndex]}
                                </motion.div>
                            </AnimatePresence>
                        </div>
                    )}

                    {/* Secondary Message (Calling/Serving) */}
                    {(status === 'calling' || status === 'serving') && theme.subMessage && (
                        <div className={`mt-4 text-xs uppercase tracking-widest font-semibold opacity-75 z-10 ${status === 'calling' ? 'animate-pulse' : ''}`}>
                            {theme.subMessage}
                        </div>
                    )}
                </Card>
            </motion.div>
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
    const queueActionGuidance = (() => {
        if (!myTicket) {
            if (!isQueueOpen) {
                return {
                    title: t('queuePausedTitle'),
                    detail: t('queuePausedDetail'),
                    tone: 'amber',
                };
            }
            if (activeEvent && isBoothOpen) {
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
        <div className="min-h-screen bg-[#fff7fb] pb-24 animate-fade-in flex flex-col items-center w-full max-w-md mx-auto relative shadow-xl">
            <Toast message={toast} onClose={() => setToast(null)} />
            <ConfirmDialog
                open={isLeaveConfirmOpen}
                title={t('queueLeaveTitle')}
                detail={t('queueLeaveDetail')}
                confirmLabel={t('queueLeaveButton')}
                tone="danger"
                onConfirm={confirmLeaveQueue}
                onCancel={() => setIsLeaveConfirmOpen(false)}
            />

            {/* Offline Indicator */}
            {!isConnected && (
                <div className="bg-red-600 text-white text-xs font-black text-center py-2.5 px-4 tracking-wide sticky top-0 z-[60] shadow-md">
                    {t('customerOffline')}
                </div>
            )}

            <CustomerHeader
                artistId={displayArtist.id}
                title={displayArtist.display_name || 'Queue'}
                transparent={true} // Restored transparent background
                avatarUrl={resolveAvatarUrl(displayArtist.image_url)}
                avatarDisplay="inline"
            />

            {/* Content Area with Padding */}
            <div className="w-full px-4 mt-4 flex flex-col items-center flex-1">
                {/* NOW SERVING INDICATOR (Compact) */}
                <motion.div
                    className="w-full rounded-[1.75rem] border border-pink-100 bg-gray-950 p-5 shadow-xl shadow-pink-100 mb-4 relative overflow-hidden group"
                    whileTap={{ scale: 0.99 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                >
                    <div className="relative flex flex-row items-center justify-between">
                        <div className="flex flex-col items-start gap-1">
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-pink-400"></span>
                                <span className="text-[10px] font-black text-pink-100 uppercase tracking-widest leading-tight">{t('queueNowServing')}</span>
                            </span>
                            {activeEvent?.queueing_area?.trim() && (
                                <span className="mt-1 text-[11px] font-bold text-gray-400">{activeEvent.queueing_area.trim()}</span>
                            )}
                        </div>

                        <div 
                            className={`text-5xl font-black tracking-tighter tabular-nums ${nowServingNumber ? 'text-white' : 'text-gray-700'}`}
                            aria-live="polite"
                            aria-atomic="true"
                            role="status"
                        >
                            <span className="sr-only">
                                {nowServingNumber 
                                    ? `Now serving queue number ${nowServingNumber}` 
                                    : "No queue is currently being served"}
                            </span>
                            <span aria-hidden="true">
                                {nowServingNumber ? (
                                    <span><span className="text-pink-400 text-2xl align-top mr-0.5">#</span>{nowServingNumber}</span>
                                ) : (
                                    <span className="text-3xl text-gray-600">--</span>
                                )}
                            </span>
                        </div>
                    </div>
                </motion.div>

                <div className={`w-full rounded-2xl border px-4 py-3 mb-4 ${
                    queueActionGuidance.tone === 'pink' ? 'bg-pink-50 border-pink-100' :
                    queueActionGuidance.tone === 'amber' ? 'bg-amber-50 border-amber-100' :
                    queueActionGuidance.tone === 'blue' ? 'bg-sky-50 border-sky-100' :
                    queueActionGuidance.tone === 'green' ? 'bg-green-50 border-green-100' :
                    queueActionGuidance.tone === 'red' ? 'bg-red-50 border-red-100' :
                    'bg-white border-pink-50'
                }`}>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">{t('queueNextStep')}</div>
                    <div className="mt-1 text-sm font-bold text-gray-900">{queueActionGuidance.title}</div>
                    <div className="mt-1 text-xs leading-relaxed text-gray-600">{queueActionGuidance.detail}</div>
                </div>

                {/* MAIN TICKET AREA */}
                {myTicket ? (
                    <div className="w-full flex-1 flex flex-col gap-4">
                        {renderTicketStatus()}

                        {/* ACTION BUTTONS (Outside Card) */}
                        <div className="flex flex-col gap-2 w-full animate-fade-in-up delay-100 mt-auto">
                            <Button
                                onClick={handleRefresh}
                                className="w-full bg-[#d63384] hover:bg-pink-700 text-white font-bold flex items-center justify-center gap-2 py-3 rounded-xl shadow-md shadow-pink-200 transition-all active:scale-95 text-sm"
                                aria-label={t('queueRefreshStatus')}
                            >
                                <RefreshCcw size={16} aria-hidden="true" /> {t('queueRefreshStatus')}
                            </Button>

                            <button
                                onClick={handleLeaveQueue}
                                className={`flex items-center justify-center gap-1.5 font-bold text-xs transition-all py-3 rounded-xl border ${
                                    ['complete', 'missed', 'expired'].includes(myTicket.status.toLowerCase())
                                        ? 'text-gray-400 border-transparent hover:text-gray-600'
                                        : 'text-red-500 border-red-100 bg-red-50/30 hover:bg-red-50 hover:border-red-200'
                                }`}
                            >
                                <LogOut size={14} />
                                {['complete', 'missed', 'expired'].includes(myTicket.status.toLowerCase()) ? t('queueCloseTicket') : t('queueLeaveQueue')}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="w-full flex-1 flex flex-col justify-start pt-8 pb-8">
                        <div className="rounded-[2rem] border border-pink-100 bg-white p-6 text-center shadow-xl shadow-pink-50 mb-4">
                            <div className={`mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl ${!isQueueOpen ? 'bg-red-50 text-red-500' : 'bg-pink-50 text-pink-600'
                                }`}>
                                {!isQueueOpen ? <Ban size={30} aria-hidden="true" /> : <Ticket size={30} aria-hidden="true" />}
                            </div>

                            <h3 className="text-xl font-black text-gray-950 mb-2">
                                {!isQueueOpen
                                    ? t('queueClosedTitle')
                                    : (activeEvent && isBoothOpen ? t('queueJoinTitle') : (eventStatusMessage || t('customerBoothClosed')))
                                }
                            </h3>

                            {activeEvent && (
                                <div className="mx-auto mb-3 inline-flex max-w-full items-center gap-1.5 rounded-full border border-pink-100 bg-pink-50 px-3 py-1.5 text-[11px] font-black text-pink-700">
                                    <Ticket size={13} aria-hidden="true" />
                                    <span className="truncate">{activeEvent.event_name}</span>
                                </div>
                            )}

                            <p className="text-gray-600 text-sm font-medium leading-relaxed px-2">
                                {!isQueueOpen
                                    ? t('queueClosedPausedBody')
                                    : (activeEvent && isBoothOpen
                                        ? t('queueJoinBody')
                                        : (eventStatusMessage === t('queueEventCancelledBody')
                                            ? t('queueEventCancelledBody')
                                            : t('queueCurrentlyClosedBody')))
                                }
                            </p>
                        </div>

                        {/* Hide Button if Queue is Closed (Paused) */}
                        {isQueueOpen && (
                            <Button
                                onClick={handleGetTicket}
                                disabled={!activeEvent || !isBoothOpen || loading}
                                className={`w-full min-h-14 py-4 text-base shadow-lg font-black rounded-2xl transition-transform active:scale-95 ${activeEvent && isBoothOpen
                                    ? 'bg-pink-600 hover:bg-pink-700 shadow-pink-200 text-white'
                                    : 'bg-gray-300 text-gray-500 shadow-none cursor-not-allowed'
                                    }`}
                            >
                                {activeEvent && isBoothOpen ? t('queueGetTicket') : (eventStatusMessage || t('customerBoothClosed'))}
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </div >
    );
};

export default QueueView;
