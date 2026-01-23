import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useMidnightTick } from '../../hooks/useMidnightTick';
import { useArtistRealtime } from '../../hooks/useArtistRealtime';
import { Button, Card } from '../../components/ui';
import { RefreshCcw, LogOut } from 'lucide-react';
import CustomerHeader from '../../components/CustomerHeader';

interface Ticket {
  id: string;
  event_id?: string;
  queue_number: number;
  status: 'waiting' | 'calling' | 'serving' | 'complete' | 'missed' | 'expired';
  created_at: string;
}

const formatTime = (dateString: string) => {
  if (!dateString) return '';
  return new Date(dateString).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
};

const QueueView = () => {
  // Midnight Watcher: Triggers update when day changes
  const currentDate = useMidnightTick();

  // 1. Unified Realtime Hook
  const { artist: contextArtist } = useOutletContext<{ artist: any }>();
  const { artist, events, isConnected, refresh } = useArtistRealtime({ 
    artistId: contextArtist?.id 
  });
  const displayArtist = artist || contextArtist;

  // Early return if no artist data
  if (!displayArtist) return <div className="p-12 text-center text-gray-400 font-medium">Loading...</div>;

  const [myTicket, setMyTicket] = useState<Ticket | null>(null);
  const [nowServingNumber, setNowServingNumber] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // DERIVED STATE: Syncs instantly with Realtime Hook (No useEffect delay)
  // Logic matches SupabaseDashboard: Find today's events, Sort by start time, Pick first CONFIRMED event.
  const activeEvent = (() => {
      const todayStr = currentDate;
      const todaysEvents = events.filter(event => {
          const start = event.start_date.substring(0, 10);
          const end = event.end_date.substring(0, 10);
          return todayStr >= start && todayStr <= end;
      });
      // Sort earliest first
      todaysEvents.sort((a,b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
      
      // Return first Confirmed event (ignores Cancelled events unless no confirmed exists)
      return todaysEvents.find(e => e.status === 'Confirmed') || null;
  })();

  // Derived Status Message
  let eventStatusMessage = "Booth Closed";
  if (!activeEvent) {
      const todayStr = currentDate;
      const cancelled = events.find(e => {
         const start = e.start_date.substring(0, 10);
         const end = e.end_date.substring(0, 10);
         return e.status === 'Cancelled' && todayStr >= start && todayStr <= end;
      });
      if (cancelled) eventStatusMessage = "Today's event has been cancelled.";
  }

  // Helper to fetch the "Now Serving" number for a specific EVENT
  const fetchNowServing = async (eventId: string) => {
      // PRIORITY 1: LOWEST 'serving' number (Active Service)
      let { data: servingData } = await supabase
         .from('queues')
         .select('queue_number')
         .eq('artist_id', displayArtist.id)
         .eq('event_id', eventId)
         .eq('status', 'serving')
         .order('queue_number', { ascending: true }) // Show Lowest # first (Sequential)
         .limit(1)
         .maybeSingle();

      if (servingData) {
          setNowServingNumber(servingData.queue_number);
          return;
      }

      // PRIORITY 2: Fallback to 'calling' (Latest called) if no one is serving
      let { data: callingData } = await supabase
         .from('queues')
         .select('queue_number')
         .eq('artist_id', displayArtist.id)
         .eq('event_id', eventId)
         .eq('status', 'calling')
         .order('last_updated_at', { ascending: false }) // Show most recent call
         .limit(1)
         .maybeSingle();

      setNowServingNumber(callingData ? callingData.queue_number : null);
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
         await fetchNowServing(activeEvent.id);

         // Ticket Verification
         const storedTicketId = localStorage.getItem(`ticket_id_${displayArtist.id}`);
         if (storedTicketId) {
             const { data: ticket } = await supabase.from('queues').select('*').eq('id', storedTicketId).single();
             
             if (ticket) {
                 // Check Mismatch
                 if (ticket.event_id !== activeEvent.id) {
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
        .on('postgres_changes', { event: '*', schema: 'public', table: 'queues', filter: `event_id=eq.${activeEvent.id}` }, (payload) => {
             // If "Now Serving" updates or "My Ticket" updates
             fetchNowServing(activeEvent.id);
             
             setMyTicket((prev) => {
                 if (prev && (payload.new as Ticket)?.id === prev.id) {
                     return payload.new as Ticket;
                 }
                 return prev;
             });
        })
        .subscribe();

      return () => {
          supabase.removeChannel(channel);
      };

  }, [activeEvent?.id, activeEvent?.is_booth_open, displayArtist.id]);



  const handleGetTicket = async () => {
     if (!activeEvent) return; 

     // Safety Check: Ensure Event hasn't ended
     const now = new Date();
     const end = new Date(activeEvent.end_date);
     if (now > end) {
        alert("This event has unfortunately ended.");
        refresh();
        return;
     }

     setLoading(true);
     try {
        // 2. Auto-Sequence Logic: Calculate Next Ticket Number
        const startOfDay = new Date();
        startOfDay.setHours(0,0,0,0);

        // Query for the latest ticket for this event TODAY
        const { data: maxData, error: maxError } = await supabase
           .from('queues')
           .select('queue_number')
           .eq('event_id', activeEvent.id)
           .gte('created_at', startOfDay.toISOString())
           .order('queue_number', { ascending: false })
           .limit(1)
           .single();

        if (maxError && maxError.code !== 'PGRST116') {
             console.error("Error fetching max ticket number:", maxError);
        }

        const nextNum = (maxData?.queue_number || 0) + 1;

        console.log(`Generating Ticket | Event ID: ${activeEvent.id} | Next Number: ${nextNum}`);

        const { data, error: insertError } = await supabase
           .from('queues')
           .insert([{
               artist_id: displayArtist.id,
               event_id: activeEvent.id,
               queue_number: nextNum,
               status: 'waiting'
           }])
           .select()
           .single();

        if (insertError) {
             console.error("Supabase Insert Error:", insertError);
             throw insertError;
        }

        if (data) {
           localStorage.setItem(`ticket_id_${displayArtist.id}`, data.id);
           setMyTicket(data);
        }

     } catch (err) {
        console.error("handleGetTicket Exception:", err);
        alert('Failed to get ticket. Please try again.');
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
       await fetchNowServing(activeEvent.id);
       if (myTicket) {
           const { data } = await supabase.from('queues').select('*').eq('id', myTicket.id).single();
           if (data) setMyTicket(data);
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

    // SCENARIO A: Active (Waiting, Calling, Serving) -> Confirm + Update DB + Clear
    if (activeStatuses.includes(status) || !endedStatuses.includes(status)) {
        if (confirm("Are you sure you want to leave the queue? This action cannot be undone.")) {
           console.log(`Attempting to leave queue for ticket ${myTicket.id} with status ${status}`);
           
           const { error } = await supabase
               .from('queues')
               .update({ status: 'missed' }) // Set to 'missed' to satisfy constraint & logic
               .eq('id', myTicket.id);
           
           if (error) {
               console.error("Error leaving queue (DB Update Failed):", error, "Ticket ID:", myTicket.id);
               alert("Failed to leave queue. Please try again.");
               return; // DO NOT clear local state if DB update fails
           }
           
           // ONLY Clear local storage after successful DB update
           localStorage.removeItem(`ticket_id_${displayArtist.id}`);
           setMyTicket(null);
        }
    }
  };

  // UI State Components
  const renderTicketStatus = () => {
      if (!myTicket) return null;

      const { status, queue_number } = myTicket;

      // Configuration for each status
      const config = {
          waiting: {
              bg: 'bg-gray-50',
              border: 'border-gray-200',
              badge: { text: 'Waiting', bg: 'bg-gray-200', color: 'text-gray-700' },
              messageColor: 'text-gray-500',
              message: 'You are in the queue.\nPlease wait for your number.',
              subMessage: undefined
          },
          calling: {
              bg: 'bg-yellow-50',
              border: 'border-yellow-200',
              badge: { text: "It's Your Turn!", bg: 'bg-yellow-500', color: 'text-white' },
              messageColor: 'text-yellow-800',
              message: 'Please proceed to the booth!',
              subMessage: 'Calling...'
          },
          serving: {
              bg: 'bg-sky-50',
              border: 'border-sky-200',
              badge: { text: 'Being Served', bg: 'bg-sky-500', color: 'text-white' },
              messageColor: 'text-sky-800',
              message: 'You are being served.',
              subMessage: 'Active'
          },
          complete: {
              bg: 'bg-green-50',
              border: 'border-green-200',
              badge: { text: 'Completed', bg: 'bg-green-100', color: 'text-green-700' },
              messageColor: 'text-green-800',
              message: 'Thank you! Your order is complete.',
              subMessage: undefined
          },
          expired: {
              bg: 'bg-purple-50',
              border: 'border-purple-200',
              badge: { text: 'Expired', bg: 'bg-purple-100', color: 'text-purple-700' },
              messageColor: 'text-purple-800',
              message: 'Ticket Expired',
              subMessage: undefined
          },
          missed: { // Acts as Cancelled
              bg: 'bg-red-50',
              border: 'border-red-200',
              badge: { text: 'Cancelled', bg: 'bg-red-100', color: 'text-red-700' },
              messageColor: 'text-red-800',
              message: 'Cancelled Ticket by customer',
              subMessage: undefined
          }
      };

      // Fallback to 'missed' config if status is unknown (or use type assertion key)
      const theme = config[status as keyof typeof config] || config.missed;

      return (
          <Card className={`w-full min-h-[320px] p-8 flex flex-col justify-center items-center text-center border-2 shadow-lg transition-all duration-300 ${theme.bg} ${theme.border}`}>
              
              {/* Status Badge */}
              <div className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase mb-8 shadow-sm tracking-wide ${theme.badge.bg} ${theme.badge.color}`}>
                  {theme.badge.text}
              </div>

              {/* Created Time */}
              <div className="mb-4 text-xs font-medium text-gray-400 uppercase tracking-wide">
                  Booked at {formatTime(myTicket.created_at)}
              </div>

              {/* Queue Number */}
              <div className="text-7xl font-black text-gray-900 mb-6 leading-none tracking-tight">
                  #{queue_number}
              </div>

              {/* Primary Message */}
              <p className={`font-bold text-lg whitespace-pre-line ${theme.messageColor}`}>
                  {theme.message}
              </p>

              {/* Secondary Message (Calling/Serving) */}
              {(status === 'calling' || status === 'serving') && theme.subMessage && (
                  <div className={`mt-4 text-xs uppercase tracking-widest font-semibold opacity-75 ${status === 'calling' ? 'animate-pulse' : ''}`}>
                      {theme.subMessage}
                  </div>
              )}
          </Card>
      );
  };

  if (loading) return <div className="p-12 text-center text-gray-400 font-medium">Loading status...</div>;
  
  // Strict UI Check: Booth must be OPEN
  const isBoothOpen = activeEvent?.is_booth_open;

  return (
    <div className="px-4 py-2 pt-8 flex flex-col items-center min-h-screen pb-24 w-full max-w-md mx-auto relative bg-gray-50/50">
       {/* Offline Indicator */}
       {!isConnected && (
         <div className="bg-red-500 text-white text-[10px] uppercase font-bold text-center py-1 tracking-widest sticky top-0 z-[60]">
            Offline - Reconnecting...
         </div>
       )}

       <CustomerHeader 
          artistId={displayArtist.id} 
          title={displayArtist.display_name || 'Queue'}
          transparent={true} // Removes white background
       >
          {activeEvent && (
              <div className="inline-block bg-pink-50 text-pink-700 px-2 py-0.5 rounded-full text-[10px] font-bold border border-pink-100">
                 {activeEvent.event_name}
              </div>
          )}
       </CustomerHeader>

       {/* NOW SERVING INDICATOR (Compact) */}
       <div className="w-full bg-slate-900 rounded-2xl p-4 shadow-xl shadow-slate-200 mb-4 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-pink-500 rounded-full blur-[40px] opacity-20 -mr-8 -mt-8 animate-pulse-slow"></div>
          
          <div className="relative flex flex-row items-center justify-between px-2">
             <div className="flex flex-col items-start gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse mb-1"></span>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-tight">Now<br/>Serving</span>
             </div>
             
             <div className={`text-4xl font-black tracking-tighter ${nowServingNumber ? 'text-white' : 'text-gray-700'}`}>
                {nowServingNumber ? (
                   <span><span className="text-pink-500 text-2xl align-top mr-0.5">#</span>{nowServingNumber}</span>
                ) : (
                   <span className="text-2xl text-gray-600">--</span>
                )}
             </div>
          </div>
       </div>

       {/* MAIN TICKET AREA */}
       {myTicket ? (
          <div className="w-full flex-1 flex flex-col gap-4">
             {renderTicketStatus()}

             {/* ACTION BUTTONS (Outside Card) */}
             <div className="flex flex-col gap-2 w-full animate-fade-in-up delay-100 mt-auto">
                 <Button 
                    onClick={handleRefresh} 
                    className="w-full bg-[#ff4d94] hover:bg-pink-600 text-white font-bold flex items-center justify-center gap-2 py-3 rounded-xl shadow-md shadow-pink-200 transition-all active:scale-95 text-sm"
                 >
                    <RefreshCcw size={16} /> Refresh Status
                 </Button>
                 
                 <button 
                    onClick={handleLeaveQueue} 
                    className="flex items-center justify-center gap-1 text-gray-400 hover:text-red-500 font-medium text-xs transition-colors py-2"
                 >
                    <LogOut size={14} /> 
                    {['complete', 'missed', 'expired'].includes(myTicket.status.toLowerCase()) ? 'Close Ticket' : 'Leave Queue'}
                 </button>
              </div>
          </div>
       ) : (
          <div className="w-full flex-1 flex flex-col justify-center">
             <div className="bg-white p-6 rounded-3xl shadow-lg border border-white text-center mb-4">
                <div className="w-16 h-16 bg-pink-50 text-pink-500 rounded-full flex items-center justify-center mx-auto mb-4">
                   <span className="material-icons-outlined text-3xl">confirmation_number</span>
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-1">
                   {activeEvent && isBoothOpen ? "Join the Queue" : (eventStatusMessage || "Booth Closed")}
                </h3>
                <p className="text-gray-500 text-xs leading-relaxed px-4">
                   {activeEvent && isBoothOpen
                      ? "Get a number and wait for your turn." 
                      : (eventStatusMessage === "Today's event has been cancelled." 
                            ? "This event has been cancelled."
                            : "Queue is currently closed.")}
                </p>
             </div>
             <Button 
                onClick={handleGetTicket} 
                disabled={!activeEvent || !isBoothOpen || loading}
                className={`w-full py-4 text-base shadow-lg font-bold rounded-xl transition-transform active:scale-95 ${
                   activeEvent && isBoothOpen
                    ? 'bg-pink-500 hover:bg-pink-600 shadow-pink-200 text-white' 
                    : 'bg-gray-300 text-gray-500 shadow-none cursor-not-allowed'
                }`}
             >
                {activeEvent && isBoothOpen ? "Get Ticket" : (eventStatusMessage || "Booth Closed")}
             </Button>
          </div>
       )}
    </div>
  );
};

export default QueueView;
