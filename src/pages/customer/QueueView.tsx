import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { Artist } from '../../hooks/useArtist';
import { Button, Card } from '../../components/ui';
import { RefreshCcw, LogOut } from 'lucide-react';

interface Ticket {
  id: string;
  event_id?: string;
  queue_number: number;
  status: 'waiting' | 'calling' | 'serving' | 'complete' | 'missed' | 'expired';
  created_at: string;
}

const QueueView = () => {
  const { artist } = useOutletContext<{ artist: Artist }>();
  const [myTicket, setMyTicket] = useState<Ticket | null>(null);
  const [nowServingNumber, setNowServingNumber] = useState<number | null>(null);
  const [activeEvent, setActiveEvent] = useState<any | null>(null); // Store the actual active event
  const [eventStatusMessage, setEventStatusMessage] = useState<string>("Booth Closed"); // Default message
  const [loading, setLoading] = useState(true);

  // Helper to fetch the "Now Serving" number for a specific EVENT
  const fetchNowServing = async (eventId: string) => {
      const { data } = await supabase
         .from('queues')
         .select('queue_number')
         .eq('artist_id', artist.id)
         .eq('event_id', eventId) // Filter by Event ID
         .in('status', ['calling', 'serving']) // "Calling" or "Serving" implies active service
         .order('last_updated_at', { ascending: false }) // Most recently updated
         .limit(1)
         .single();
      
      setNowServingNumber(data ? data.queue_number : null);
  };

   // Helper to check for active event TODAY (is_booth_open = true)
   // Returns the event object or null directly
   const fetchActiveEventData = async () => {
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];

      // Fetch potential events (Any Status, ending today or later)
      // We fetch ALL statuses to detect Cancelled events
      const { data: events } = await supabase
         .from('events')
         .select('*')
         .eq('artist_id', artist.id)
         .gte('end_date', todayStr); 
      
      if (events && events.length > 0) {
         // JavaScript Date Filter: Start <= Today <= End
         const todaysEvents = events.filter(event => {
            const start = new Date(event.start_date).toISOString().split('T')[0];
            const end = new Date(event.end_date).toISOString().split('T')[0];
            return todayStr >= start && todayStr <= end;
         });

         // Sort: Earliest start
         todaysEvents.sort((a,b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());

         if (todaysEvents.length > 0) {
             // Priority: Check for Confirmed First
             const confirmedEvent = todaysEvents.find(e => e.status === 'Confirmed');
             
             if (confirmedEvent) {
                 // Only return if booth is OPEN
                 if (confirmedEvent.is_booth_open) {
                     return confirmedEvent;
                 } else {
                     return null; // Confirmed but Closed -> Booth Closed default
                 }
             }

             // If no confirmed event, check if we have a Cancelled one for specific messaging
             const cancelledEvent = todaysEvents.find(e => e.status === 'Cancelled');
             if (cancelledEvent) {
                 return { isCancelled: true };
             }
         }
      }
      return null;
   };

  useEffect(() => {
     let mounted = true;

     const init = async () => {
        // 1. Identification: Determine the Active Event
        const eventResult = await fetchActiveEventData();
        
        if (!mounted) return;

        if (eventResult && 'isCancelled' in eventResult) {
            // Case: Cancelled Event Found
            setActiveEvent(null);
            setEventStatusMessage("Today's event has been cancelled.");
        } else if (eventResult) {
            // Case: Active Confirmed Event
            setActiveEvent(eventResult);
            setEventStatusMessage(""); // Clear message
        } else {
            // Case: No Event or Closed
            setActiveEvent(null);
            setEventStatusMessage("Booth Closed");
        }

        const event = (eventResult && !('isCancelled' in eventResult)) ? eventResult : null;

        if (event) {
           // 2. Fetch Global "Now Serving" for this Active Event
           await fetchNowServing(event.id);

           // 3. Ticket Validation Logic
           const storedTicketId = localStorage.getItem(`ticket_id_${artist.id}`);
           if (storedTicketId) {
               const { data: ticket } = await supabase
                   .from('queues')
                   .select('*')
                   .eq('id', storedTicketId)
                   .single();

               if (ticket) {
                   // Validation: Check Event ID Mismatch
                   if (ticket.event_id !== event.id) {
                       console.warn("Ticket Event Mismatch. Resetting state.");
                       localStorage.removeItem(`ticket_id_${artist.id}`);
                       setMyTicket(null);
                   } 
                   else {
                       // Validation: Check Date (Created Today?)
                       // Note: event_id usually implies date, but strict check requested.
                       const ticketDate = new Date(ticket.created_at).toISOString().split('T')[0];
                       const todayDate = new Date().toISOString().split('T')[0];

                       if (ticketDate !== todayDate) {
                           console.warn("Ticket Date Mismatch (Not Today). Resetting state.");
                           localStorage.removeItem(`ticket_id_${artist.id}`);
                           setMyTicket(null);
                       } else {
                           // Valid Ticket
                           setMyTicket(ticket);
                       }
                   }
               } else {
                   // Ticket ID in local storage but not in DB (deleted?)
                   localStorage.removeItem(`ticket_id_${artist.id}`);
                   setMyTicket(null); 
               }
           }
        } else {
            // No Active Event Found
            setNowServingNumber(null);
            
            // If we have a ticket but no active event, strictly clear it?
            const storedTicketId = localStorage.getItem(`ticket_id_${artist.id}`);
            if (storedTicketId) {
                console.warn("No active event. Clearing ticket state.");
                localStorage.removeItem(`ticket_id_${artist.id}`);
                setMyTicket(null);
            }
        }
         
        if (mounted) setLoading(false);
      };

      init();

      // Realtime Subscriptions
      const channel = supabase
        .channel(`public:queues:artist:${artist.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'queues', filter: `artist_id=eq.${artist.id}` }, async (payload) => {
           // Simple Strategy: Re-run a lightweight sync.
           const currentResult = await fetchActiveEventData();
           const currentEvent = (currentResult && !('isCancelled' in currentResult)) ? currentResult : null;

           if (currentEvent) {
               fetchNowServing(currentEvent.id);
               
               const storedTicketId = localStorage.getItem(`ticket_id_${artist.id}`);
               if (storedTicketId && (payload.new as Ticket)?.id === storedTicketId) {
                  // Re-fetch specific ticket
                  const { data } = await supabase.from('queues').select('*').eq('id', storedTicketId).single();
                  setMyTicket(data);
               }
           }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter: `artist_id=eq.${artist.id}` }, async () => {
             // Event Changed (Booth Toggle, etc) -> Re-run Init to potentially Reset State
             init();
        })
      
      // EOD Check Loop
      const timer = setInterval(() => {
          const today = new Date().toDateString();
          const lastDate = localStorage.getItem('last_queue_session');
          
          if (lastDate && lastDate !== today) {
              console.log("New Day Detected. Refreshing Queue View...");
              window.location.reload(); 
          } else {
              localStorage.setItem('last_queue_session', today);
          }
      }, 60000); 
      localStorage.setItem('last_queue_session', new Date().toDateString());

      return () => { 
         mounted = false;
         supabase.removeChannel(channel); 
         clearInterval(timer);
      };
   }, [artist.id]);

  const handleGetTicket = async () => {
     if (!activeEvent) return; // UI should disable button, but safety check

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
               artist_id: artist.id,
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
           localStorage.setItem(`ticket_id_${artist.id}`, data.id);
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
    // Re-run init logic basically, but we can just call helpers
    await fetchActiveEventData();
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
         localStorage.removeItem(`ticket_id_${artist.id}`);
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
           localStorage.removeItem(`ticket_id_${artist.id}`);
           setMyTicket(null);
        }
    }
  };

  // UI State Components
  const renderTicketStatus = () => {
      if (!myTicket) return null;

      // Status: WAITING
      if (myTicket.status === 'waiting') {
         return (
            <Card className="w-full p-6 text-center border-2 border-yellow-200 bg-white shadow-lg animate-fade-in">
               <div className="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase mb-4 bg-yellow-100 text-yellow-700">
                  Waiting
               </div>
               <div className="text-6xl font-black text-gray-900 mb-2">#{myTicket.queue_number}</div>
               <p className="text-gray-500 text-sm mb-6">
                  You are in the queue. Please wait for your number.
               </p>
            </Card>
         );
      }

      // Status: CALLING / SERVING (Active Service)
      if (myTicket.status === 'calling' || myTicket.status === 'serving') {
         return (
            <Card className="w-full p-8 text-center border-4 border-green-500 bg-green-50 shadow-xl animate-pulse-slow">
               <div className="inline-block px-4 py-1.5 rounded-full text-sm font-black uppercase mb-6 bg-green-500 text-white shadow-md">
                  It's Your Turn!
               </div>
               <div className="text-7xl font-black text-gray-900 mb-4">#{myTicket.queue_number}</div>
               <p className="text-green-800 font-bold text-lg mb-8">
                  Please proceed to the artist!
               </p>
               <div className="text-xs text-green-600 uppercase tracking-widest font-semibold">
                  {myTicket.status === 'serving' ? 'Being Served Now' : 'Calling...'}
               </div>
            </Card>
         );
      }

      // Status: COMPLETE
      if (myTicket.status === 'complete') {
         return (
            <Card className="w-full p-8 text-center border-2 border-gray-100 bg-white shadow-sm">
               <div className="w-16 h-16 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="material-icons-outlined text-4xl">check</span>
               </div>
               <h3 className="text-2xl font-bold text-gray-900 mb-2">Thank You!</h3>
               <p className="text-gray-500 mb-6">Your order has been completed.</p>
               <div className="text-4xl font-bold text-gray-300 mb-8">#{myTicket.queue_number}</div>
            </Card>
         );
      }
      
      // Status: MISSED / EXPIRED
      return (
         <Card className="w-full p-6 text-center border-2 border-red-100 bg-red-50">
            <h3 className="text-xl font-bold text-red-600 mb-2">Ticket Ended</h3>
            <p className="text-red-400 text-sm mb-4">Status: {myTicket.status}</p>
         </Card>
      );
  };

  if (loading) return <div className="p-12 text-center text-gray-400 font-medium">Loading status...</div>;

  return (
    <div className="p-6 flex flex-col items-center min-h-screen pb-32 max-w-md mx-auto relative">
       <div className="w-full mb-8 text-center animate-fade-in-down">
          <h2 className="text-3xl font-black text-[#ff4d94] tracking-tight mb-2">
             {artist.display_name}
          </h2>
          {activeEvent && (
              <div className="inline-block bg-pink-50 text-pink-700 px-3 py-1 rounded-full text-xs font-bold border border-pink-100">
                 Queue Event: {activeEvent.event_name}
              </div>
          )}
       </div>

       {/* NOW SERVING INDICATOR (Global) */}
       <div className="w-full bg-slate-900 rounded-3xl p-6 shadow-xl shadow-slate-200 mb-8 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-pink-500 rounded-full blur-[60px] opacity-20 -mr-10 -mt-10 animate-pulse-slow"></div>
          
          <div className="relative flex flex-col items-center justify-center text-center">
             <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Current Queue Serving</span>
             </div>
             
             <div className={`text-7xl font-black tracking-tighter ${nowServingNumber ? 'text-white' : 'text-gray-700'}`}>
                {nowServingNumber ? (
                   <span><span className="text-pink-500 text-5xl align-top mr-1">#</span>{nowServingNumber}</span>
                ) : (
                   <span className="text-4xl text-gray-600">--</span>
                )}
             </div>
          </div>
       </div>

       {/* MAIN TICKET AREA */}
       {myTicket ? (
          <div className="w-full flex-1 flex flex-col gap-6">
             {renderTicketStatus()}

             {/* ACTION BUTTONS (Outside Card) */}
             <div className="flex flex-col gap-3 w-full animate-fade-in-up delay-100">
                 <Button 
                    onClick={handleRefresh} 
                    className="w-full bg-[#ff4d94] hover:bg-pink-600 text-white font-bold flex items-center justify-center gap-2 py-4 rounded-xl shadow-lg shadow-pink-200 transition-all active:scale-95"
                 >
                    <RefreshCcw size={18} /> Refresh Status
                 </Button>
                 
                 <button 
                    onClick={handleLeaveQueue} 
                    className="flex items-center justify-center gap-2 text-gray-400 hover:text-red-500 font-medium text-sm transition-colors py-2"
                 >
                    <LogOut size={16} /> 
                    {['complete', 'missed', 'expired'].includes(myTicket.status.toLowerCase()) ? 'Close Ticket' : 'Leave Queue'}
                 </button>
             </div>
          </div>
       ) : (
          <div className="w-full flex-1 flex flex-col justify-center">
             <div className="bg-white p-8 rounded-3xl shadow-xl shadow-pink-100 border border-white text-center mb-6">
                <div className="w-20 h-20 bg-pink-50 text-pink-500 rounded-full flex items-center justify-center mx-auto mb-6">
                   <span className="material-icons-outlined text-4xl">confirmation_number</span>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                   {activeEvent ? "Join the Queue" : (eventStatusMessage || "Booth Closed")}
                </h3>
                <p className="text-gray-500 text-sm leading-relaxed">
                   {activeEvent 
                      ? "Get a ticket number and wait for your turn. We'll notify you here when called." 
                      : (eventStatusMessage === "Today's event has been cancelled." 
                            ? "This event has been cancelled by the artist."
                            : "The artist booth is currently not accepting new queue tickets.")}
                </p>
             </div>
             <Button 
                onClick={handleGetTicket} 
                disabled={!activeEvent || loading}
                className={`w-full py-6 text-lg shadow-xl font-bold rounded-2xl transition-transform active:scale-95 ${
                   activeEvent 
                    ? 'bg-pink-500 hover:bg-pink-600 shadow-pink-200 text-white' 
                    : 'bg-gray-300 text-gray-500 shadow-none cursor-not-allowed'
                }`}
             >
                {activeEvent ? "Get Ticket" : (eventStatusMessage || "Booth Closed")}
             </Button>
          </div>
       )}
    </div>
  );
};

export default QueueView;
