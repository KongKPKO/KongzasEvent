import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { Artist } from '../../hooks/useArtist';
import { Button, Card } from '../../components/ui';

interface Ticket {
  id: string;
  queue_number: number;
  status: 'waiting' | 'ready' | 'pending' | 'completed' | 'expired' | 'cancelled';
}

const QueueView = () => {
  const { artist } = useOutletContext<{ artist: Artist }>();
  const [myTicket, setMyTicket] = useState<Ticket | null>(null);
  const [nowServingNumber, setNowServingNumber] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Helper to fetch the "Now Serving" number (Latest Ready or Pending)
  const fetchNowServing = async () => {
      const { data } = await supabase
         .from('queues')
         .select('queue_number')
         .eq('artist_id', artist.id)
         .in('status', ['ready', 'pending', 'calling']) // Include pending/calling/ready
         .order('last_updated_at', { ascending: false }) // Most recently updated
         .limit(1)
         .single();
      
      setNowServingNumber(data ? data.queue_number : null);
  };

  // Helper to refresh my ticket status
  const refreshMyTicket = async (ticketId: string) => {
      const { data } = await supabase
         .from('queues')
         .select('*')
         .eq('id', ticketId)
         .single();
      
      if (data) {
         setMyTicket(data);
      }
      // Note: We DO NOT remove local ticket if fetch fails or data missing immediately, 
      // to avoid flickering or accidental loss. Only remove on explict cancel/close.
  };

  useEffect(() => {
     let mounted = true;

     const init = async () => {
        // 1. Load My Ticket from LocalStorage
        const storedTicketId = localStorage.getItem(`ticket_id_${artist.id}`);
        if (storedTicketId) {
           await refreshMyTicket(storedTicketId);
        }

        // 2. Load Global "Now Serving"
        await fetchNowServing();
        
        if (mounted) setLoading(false);
     };

     init();

     // 3. Realtime Subscription
     const channel = supabase
       .channel(`public:queues:artist:${artist.id}`)
       .on('postgres_changes', { event: '*', schema: 'public', table: 'queues', filter: `artist_id=eq.${artist.id}` }, (payload) => {
          // Always refresh global "Now Serving" on any queue change for this artist
          fetchNowServing();

          // If the change affects MY ticket, update my state
          const storedTicketId = localStorage.getItem(`ticket_id_${artist.id}`);
          if (storedTicketId && (payload.new as Ticket)?.id === storedTicketId) {
             // Update local state directly from payload if possible, or fetch
             // Using fetch is safer for consistent type mapping
             refreshMyTicket(storedTicketId);
          }
       })
       .subscribe();

     return () => { 
        mounted = false;
        supabase.removeChannel(channel); 
     };
  }, [artist.id]);

  const handleGetTicket = async () => {
     setLoading(true);
     try {
        // Insert new ticket
        const { data, error } = await supabase
           .from('queues')
           .insert([{ artist_id: artist.id, status: 'waiting' }]) // Removed explicit queue_number as user removed it previously (likely auto-increment)
           .select()
           .single();

        if (error) throw error;
        if (data) {
           localStorage.setItem(`ticket_id_${artist.id}`, data.id);
           setMyTicket(data);
        }
     } catch (err) {
        console.error(err);
        alert('Failed to get ticket. Please try again.');
     } finally {
        setLoading(false);
     }
  };

  const handleLeaveQueue = () => {
     if (confirm("Are you sure you want to leave?")) {
        // Clear local storage
        localStorage.removeItem(`ticket_id_${artist.id}`);
        setMyTicket(null);
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
               <Button variant="ghost" onClick={handleLeaveQueue} className="text-red-400 hover:text-red-500">
                  Leave Queue
               </Button>
            </Card>
         );
      }

      // Status: READY / PENDING (Serving)
      if (myTicket.status === 'ready' || myTicket.status === 'pending' || myTicket.status === 'calling') {
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
                  {myTicket.status === 'pending' ? 'Being Served Now' : 'Calling...'}
               </div>
            </Card>
         );
      }

      // Status: COMPLETED
      if (myTicket.status === 'completed') {
         return (
            <Card className="w-full p-8 text-center border-2 border-gray-100 bg-white shadow-sm">
               <div className="w-16 h-16 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="material-icons-outlined text-4xl">check</span>
               </div>
               <h3 className="text-2xl font-bold text-gray-900 mb-2">Thank You!</h3>
               <p className="text-gray-500 mb-6">Your order has been completed.</p>
               <div className="text-4xl font-bold text-gray-300 mb-8">#{myTicket.queue_number}</div>
               <Button onClick={handleLeaveQueue} className="bg-gray-900 text-white hover:bg-black w-full py-4 rounded-xl">
                  Close Ticket
               </Button>
            </Card>
         );
      }
      
      // Status: EXPIRED / CANCELLED
      return (
         <Card className="w-full p-6 text-center border-2 border-red-100 bg-red-50">
            <h3 className="text-xl font-bold text-red-600 mb-2">Ticket Ended</h3>
            <p className="text-red-400 text-sm mb-4">Status: {myTicket.status}</p>
            <Button onClick={handleLeaveQueue} variant="ghost" className="text-red-500 hover:bg-red-100">
               Dismiss
            </Button>
         </Card>
      );
  };

  if (loading) return <div className="p-12 text-center text-gray-400 font-medium">Loading status...</div>;

  return (
    <div className="p-6 flex flex-col items-center min-h-[85vh] max-w-md mx-auto">
       <div className="flex items-center gap-2 mb-8 self-start">
          <h2 className="text-2xl font-black text-gray-900">Queue Status</h2>
          {nowServingNumber && (
             <span className="bg-gray-900 text-white text-xs px-2 py-1 rounded font-bold">Live</span>
          )}
       </div>

       {/* NOW SERVING INDICATOR (Global) */}
       <div className="w-full bg-white border border-gray-200 rounded-2xl p-4 flex items-center justify-between shadow-sm mb-8">
          <div className="flex flex-col">
             <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Now Serving</span>
             <span className="text-xs text-gray-300">Global Status</span>
          </div>
          <div className={`text-4xl font-black ${nowServingNumber ? 'text-pink-500' : 'text-gray-200'}`}>
             {nowServingNumber ? `#${nowServingNumber}` : '--'}
          </div>
       </div>

       {/* MAIN TICKET AREA */}
       {myTicket ? (
          renderTicketStatus()
       ) : (
          <div className="w-full flex-1 flex flex-col justify-center">
             <div className="bg-white p-8 rounded-3xl shadow-xl shadow-pink-100 border border-white text-center mb-6">
                <div className="w-20 h-20 bg-pink-50 text-pink-500 rounded-full flex items-center justify-center mx-auto mb-6">
                   <span className="material-icons-outlined text-4xl">confirmation_number</span>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Join the Queue</h3>
                <p className="text-gray-500 text-sm leading-relaxed">
                   Get a ticket number and wait for your turn. We'll notify you here when called.
                </p>
             </div>
             <Button 
                onClick={handleGetTicket} 
                className="w-full py-6 text-lg bg-pink-500 hover:bg-pink-600 shadow-xl shadow-pink-200 text-white font-bold rounded-2xl transition-transform active:scale-95"
             >
                Get Ticket
             </Button>
          </div>
       )}
    </div>
  );
};

export default QueueView;
