import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { Button } from '../components/ui';
import { LayoutDashboard, List, History, BarChart2, Bell, CheckCircle, RotateCcw, Play, Ticket } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

interface QueueItem {
  id: string; // UUID from DB
  artist_id: string;
  event_id?: string;
  queue_number: number;
  status: 'waiting' | 'calling' | 'serving' | 'complete' | 'missed' | 'expired' | 'queued'; // Standardized statuses
  last_updated_at: string;
  created_at?: string; // We might need timestamp for waiting time
}

interface DashboardEvent {
  id: string;
  event_name: string;
  start_date: string;
  end_date: string;
  is_booth_open: boolean;
  status: 'Confirmed' | 'Cancelled';
}

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

const SupabaseDashboard = () => {
  const [queues, setQueues] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isBoothActive, setIsBoothActive] = useState(false);
  
  // Event & Ticket State
  // Event & Ticket State
  const [events, setEvents] = useState<DashboardEvent[]>([]); 
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [activeEventStatusMessage, setActiveEventStatusMessage] = useState<string>('No Active Event Today');
  const [analyticsMode, setAnalyticsMode] = useState<'today' | 'total'>('today'); // New state for Analytics Toggle
  
  const location = useLocation();

  // Helper: Date Range Format


  // Fetch initial data
  const fetchQueues = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch artist status
      const { data: artistData } = await supabase
        .from('artists')
        .select('is_active')
        .eq('id', user.id)
        .single();
      
      if (artistData) {
         setIsBoothActive(artistData.is_active);
      }

      const { data: eventsData } = await supabase
        .from('events')
        .select('*')
        .eq('artist_id', user.id)
        .gte('end_date', new Date().toISOString()) // Only future/current events
        .order('start_date', { ascending: true });

      setEvents(eventsData || []);

      // AUTOMATIC EVENT SELECTION
      let currentEventId = '';

      if (eventsData && eventsData.length > 0) {
         const today = new Date();
         const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD

         // 1. Find ALL events overlapping with today
         const todaysEvents = eventsData.filter(event => {
            const start = new Date(event.start_date).toISOString().split('T')[0];
            const end = new Date(event.end_date).toISOString().split('T')[0];
            return todayStr >= start && todayStr <= end;
         });

         // 2. Sort by start date (earliest first)
         todaysEvents.sort((a,b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());

         if (todaysEvents.length > 0) {
            // 3. Find first CONFIRMED event
            const confirmedEvent = todaysEvents.find(e => e.status === 'Confirmed');

            if (confirmedEvent) {
               currentEventId = confirmedEvent.id;
               setSelectedEventId(confirmedEvent.id);
               setIsBoothActive(confirmedEvent.is_booth_open || false);
               setActiveEventStatusMessage('');
            } else {
               // Event exists but is NOT Confirmed (Cancelled)
               setSelectedEventId('');
               setIsBoothActive(false);
               setActiveEventStatusMessage("No confirmed event scheduled today"); // Specific message for Cancelled
            }
         } else {
             // No event at all
            setSelectedEventId('');
            setIsBoothActive(false);
            setActiveEventStatusMessage("No Active Event Today");
         }
      } else {
          setSelectedEventId('');
          setIsBoothActive(false);
          setActiveEventStatusMessage("No Active Event Today");
      }

      // CRITICAL UPDATE: Data Leak Fix
      // Only fetch queues if we have a valid Active Event ID.
      // Otherwise, clear the queues.
      if (currentEventId) {
          const { data, error } = await supabase
            .from('queues')
            .select('*')
            .eq('artist_id', user.id)
            .eq('event_id', currentEventId) // Strict Filter
            .order('id', { ascending: true });

          if (error) {
            console.error('Error fetching queues:', error);
          } else {
            // @ts-ignore
            setQueues(data || []);
          }
      } else {
          setQueues([]); // Reset UI
      }

    } catch (err) {
      console.error("Unexpected error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleBooth = async () => {
      if (!selectedEventId) {
          alert("No Active Event Today! Cannot open booth.");
          return;
      }

      const newStatus = !isBoothActive;
      setIsBoothActive(newStatus); // Optimistic update
      
      // Update local events state as well to reflect change in dropdown if we showed it there
      setEvents(prev => prev.map(e => e.id === selectedEventId ? { ...e, is_booth_open: newStatus } : e));

      const { error } = await supabase
          .from('events')
          .update({ is_booth_open: newStatus })
          .eq('id', selectedEventId);

      if (error) {
          console.error('Error updating booth status:', error);
          setIsBoothActive(!newStatus); // Revert on error
          alert('Failed to update booth status');
      }
  };

  useEffect(() => {
    fetchQueues();

    const channel = supabase
      .channel('public:queues')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queues' }, (payload) => {
        console.log('Change received!', payload);
        fetchQueues();
      })
      .subscribe();
      
    // EOD Reset Check
    // Check every minute if the day has changed
    const timer = setInterval(() => {
       const today = new Date().toDateString();
       const storedDate = localStorage.getItem('last_session_date');
       
       if (storedDate && storedDate !== today) {
           console.log("New Day Detected! Refreshing...");
           window.location.reload(); // Hard refresh to clear all state/caches
       } else {
           localStorage.setItem('last_session_date', today);
       }
    }, 60000); // Check every 60s
    
    // Initialize session date
    localStorage.setItem('last_session_date', new Date().toDateString());

    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, []);

  const updateStatus = async (id: string, newStatus: string) => {
    const { error } = await supabase
      .from('queues')
      .update({ status: newStatus, last_updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      console.error(`Error updating status to ${newStatus}:`, error);
      alert('Failed to update status');
    }
  };

  const handleCallNext = () => {
     if (nextTicket) {
        updateStatus(nextTicket.id, 'calling');
     }
  };

  const handleConfirmArrival = (id: string) => {
     updateStatus(id, 'serving');
  };

  const handleComplete = (id: string) => {
     updateStatus(id, 'complete');
  };



   // --- TICKET GENERATION LOGIC REMOVED (Customer Driven) ---


  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // derived state
  // Mapping notes: 
  // 'waiting' -> Waiting List
  // 'calling' -> Waiting for Arrival
  // 'serving' -> Being Served
  // 'complete' -> Served
  // 'missed'/'expired' -> Missed
  
  // Filter by selectedEventId if one is selected, otherwise show all (or could force selection)
  const filteredQueues = selectedEventId 
      ? queues.filter(q => q.event_id === selectedEventId) 
      : queues;

  const waitingTickets = filteredQueues.filter(q => q.status === 'waiting' || (q.status as string) === 'queued').sort((a,b) => a.queue_number - b.queue_number);
  const readyTickets = filteredQueues.filter(q => q.status === 'calling'); 
  const pendingTickets = filteredQueues.filter(q => q.status === 'serving'); 

  const expiredTickets = filteredQueues.filter(q => q.status === 'missed' || q.status === 'expired');

  const nextTicket = waitingTickets[0];
  const totalInQueue = waitingTickets.length + readyTickets.length + pendingTickets.length;

  // -- Analytics Logic --
  const getAnalyticsData = () => {
      let served = 0;
      let missed = 0;
      let waitTimes: number[] = [];

      // Filter based on Analytics Mode (Today vs Total)
      const targetQueues = analyticsMode === 'today' 
          ? queues.filter(q => {
                const date = q.created_at ? new Date(q.created_at).toDateString() : '';
                return date === new Date().toDateString();
            })
          : queues;

      targetQueues.forEach(q => {
          if (q.status === 'complete') served++;
          if (q.status === 'missed' || q.status === 'expired') missed++;
          
          // Calculate wait time rough estimate (Processing time essentially)
          if ((q.status === 'complete' || q.status === 'serving') && q.created_at) {
              const start = new Date(q.created_at).getTime();
              const end = new Date(q.last_updated_at).getTime();
              waitTimes.push((end - start) / 60000); // in minutes
          }
      });

      const avgWaitVal = waitTimes.length > 0 ? waitTimes.reduce((a,b) => a+b, 0) / waitTimes.length : 0;
      return { served, missed, avgWait: Math.round(avgWaitVal) };
  };

  const analytics = getAnalyticsData();

  if (loading) return <div className="p-8 text-center text-gray-500">Loading dashboard...</div>;

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
      
      {/* Header Navigation */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-10 px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between shadow-sm">
         <div className="flex items-center gap-2">
            <div className="bg-pink-500 text-white p-1.5 rounded-lg font-bold">K</div>
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-pink-500 to-violet-600">Kongzas</span>
         </div>
         
         <div className="flex items-center gap-6">

            {/* Active Event Display (Auto-Selected) */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${selectedEventId ? 'bg-pink-50 border-pink-200 text-pink-700' : 'bg-gray-100 border-gray-200 text-gray-500'}`}>
               <Ticket size={16} className={selectedEventId ? "text-pink-500" : "text-gray-400"} />
               <span className="text-xs font-bold max-w-[200px] truncate">
                  {selectedEventId 
                     ? events.find(e => e.id === selectedEventId)?.event_name 
                     : activeEventStatusMessage}
               </span>
            </div>

            <div className="h-6 w-px bg-gray-200"></div>

            <Link to="/artist/manage" className={`transition-colors flex flex-col items-center text-xs font-medium gap-1 ${location.pathname === '/artist/manage' ? 'text-pink-500' : 'text-gray-500 hover:text-pink-500'}`}>
               <LayoutDashboard size={20} />
               <span>Home</span>
            </Link>
            <Link to="/manage-products" className="text-gray-500 hover:text-pink-500 transition-colors flex flex-col items-center text-xs font-medium gap-1">
               <List size={20} />
               <span>Menu</span>
            </Link>
            <div className="text-pink-600 flex flex-col items-center text-xs font-medium gap-1">
               <History size={20} />
               <span>Queue</span>
            </div>
            <div className="h-6 w-px bg-gray-200 mx-2"></div>
             <Button onClick={handleLogout} variant="ghost" className="text-gray-500 hover:text-red-500">
                Log Out
             </Button>
         </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
         <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* LEFT COLUMN (2/3) */}
            <div className="lg:col-span-2 space-y-6">
               
                {/* Queue Control Card */}
               <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-6">
                     <div className="flex justify-between items-center mb-6">
                        <h2 className="text-lg font-bold flex items-center gap-2 text-gray-800">
                           <LayoutDashboard className="text-pink-500" size={20} />
                           Queue Control
                        </h2>
                        
                        {/* Booth Status Toggle */}
                        <div className="flex items-center gap-3">
                           <span className={`text-xs font-bold uppercase tracking-wider ${isBoothActive ? 'text-green-600' : 'text-gray-400'}`}>
                              {isBoothActive ? 'Booth Open' : 'Booth Closed'}
                           </span>
                           <button 
                              onClick={handleToggleBooth}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-pink-500 focus:ring-offset-2 ${
                                 isBoothActive ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-gray-300'
                              }`}
                           >
                              <span
                                 className={`${
                                    isBoothActive ? 'translate-x-6' : 'translate-x-1'
                                 } inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200`}
                              />
                           </button>
                        </div>
                     </div>

                     {/* Active Event Display */}
                     {selectedEventId && (
                        <div className="mb-6 bg-pink-50/50 border border-pink-100 rounded-lg p-3 text-center">
                           <div className="text-xs font-bold text-pink-400 uppercase tracking-wider mb-1">Active Event</div>
                           <div className="font-bold text-gray-900">{events.find(e => e.id === selectedEventId)?.event_name}</div>
                        </div>
                     )}

                     <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 text-center divide-y md:divide-y-0 md:divide-x divide-gray-100">
                        <div className="py-2">
                           <div className="text-sm font-medium text-gray-500">Total in Queue</div>
                           <div className="mt-1 text-3xl font-extrabold text-gray-900">{totalInQueue}</div>
                        </div>
                        <div className="py-2">
                           <div className="text-sm font-medium text-gray-500">Next Ticket</div>
                           <div className="mt-1 text-3xl font-extrabold text-pink-500">#{nextTicket ? nextTicket.queue_number : '-'}</div>
                        </div>
                        <div className="py-2">
                           <div className="text-sm font-medium text-gray-500">Waiting</div>
                           <div className="mt-1 text-3xl font-extrabold text-gray-900">{waitingTickets.length}</div>
                        </div>
                     </div>

                        <div className="w-full">
                           <Button
                              onClick={handleCallNext}
                              disabled={!nextTicket}
                              className={`w-full py-5 text-xl rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-3 ${
                                 !nextTicket ? 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none' : 'bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white shadow-pink-200'
                              }`}
                           >
                              <Play size={28} fill="currentColor" />
                              <span className="font-black">Call Next {nextTicket ? `(#${nextTicket.queue_number})` : ''}</span>
                           </Button>
                        </div>
                  </div>
               </div>

               {/* Status Grid */}
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  
                  {/* Waiting for Arrival */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col h-full">
                     <div className="p-6 flex-1 flex flex-col">
                        <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                           <Bell className="text-yellow-500" size={18} />
                           Waiting for Arrival ({readyTickets.length})
                        </h3>
                        {readyTickets.length > 0 ? (
                           <div className="space-y-3">
                              {readyTickets.map(ticket => (
                                 <div key={ticket.id} className="bg-yellow-50 border border-yellow-100 rounded-lg p-4 flex flex-col items-center text-center animate-fade-in">
                                    <span className="inline-block px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded-full font-bold mb-2">
                                       Called
                                    </span>
                                    <div className="text-4xl font-black text-gray-900 mb-1">#{ticket.queue_number}</div>
                                    <div className="text-xs text-gray-500 mb-4">
                                       Called {formatElapsedTime(ticket.last_updated_at)} ago
                                    </div>
                                    <Button 
                                       onClick={() => handleConfirmArrival(ticket.id)}
                                       className="w-full bg-pink-500 hover:bg-pink-600 text-white border-none shadow-sm"
                                    >
                                       Confirm Arrival
                                    </Button>
                                 </div>
                              ))}
                           </div>
                        ) : (
                           <div className="flex-1 flex items-center justify-center text-gray-300 text-sm py-8 italic border-2 border-dashed border-gray-100 rounded-lg">
                              No tickets waiting
                           </div>
                        )}
                     </div>
                  </div>

                  {/* Being Served */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col h-full">
                     <div className="p-6 flex-1 flex flex-col">
                        <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                           <CheckCircle className="text-green-500" size={18} />
                           Being Served ({pendingTickets.length})
                        </h3>
                        {pendingTickets.length > 0 ? (
                           <div className="space-y-3">
                              {pendingTickets.map(ticket => (
                                 <div key={ticket.id} className="bg-green-50 border border-green-100 rounded-lg p-4 flex flex-col items-center text-center animate-fade-in">
                                    <span className="inline-block px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-bold mb-2">
                                       Serving
                                    </span>
                                    <div className="text-4xl font-black text-gray-900 mb-1">#{ticket.queue_number}</div>
                                    <div className="text-xs text-gray-500 mb-4">Active</div>
                                    <Button 
                                       onClick={() => handleComplete(ticket.id)}
                                       variant="outline"
                                       className="w-full border-green-200 text-green-700 hover:bg-green-100 hover:text-green-800"
                                    >
                                       Mark Complete
                                    </Button>
                                 </div>
                              ))}
                           </div>
                        ) : (
                           <div className="flex-1 flex items-center justify-center text-gray-300 text-sm py-8 italic border-2 border-dashed border-gray-100 rounded-lg">
                              No tickets served
                           </div>
                        )}
                     </div>
                  </div>

               </div>
            </div>

            {/* RIGHT COLUMN (1/3) - Sidebar */}
            <div className="space-y-6">
               
               {/* Waiting List */}
               <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                     <h3 className="font-semibold text-gray-900">Waiting List</h3>
                     <span className="bg-gray-200 text-gray-600 text-xs px-2 py-0.5 rounded-full font-bold">{waitingTickets.length}</span>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto">
                     {waitingTickets.length > 0 ? (
                        <ul className="divide-y divide-gray-50">
                           {waitingTickets.map((t, idx) => (
                              <li key={t.id} className="px-4 py-3 hover:bg-gray-50 transition-colors flex items-center justify-between group">
                                 <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center text-xs font-bold">
                                       #{t.queue_number}
                                    </div>
                                    <div>
                                       <p className="text-sm font-bold text-gray-800">
                                          {idx === 0 ? 'Next in Line' : 'Waiting'}
                                       </p>
                                       <p className="text-xs text-gray-400">
                                          {t.created_at ? formatElapsedTime(t.created_at) + ' wait' : 'Queued'}
                                       </p>
                                    </div>
                                 </div>
                              </li>
                           ))}
                        </ul>
                     ) : (
                        <div className="p-8 text-center text-gray-400 text-sm">Queue is empty</div>
                     )}
                  </div>
               </div>

               {/* Missed Card */}
               <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden opacity-90 hover:opacity-100 transition-opacity">
                   <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center bg-red-50/30">
                     <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                        <RotateCcw size={16} className="text-red-400" />
                        Missed
                     </h3>
                     <span className="bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded-full font-bold">{expiredTickets.length}</span>
                  </div>
                  <div className="max-h-[200px] overflow-y-auto">
                     {expiredTickets.length > 0 ? (
                        <ul className="divide-y divide-gray-50">
                           {expiredTickets.map(t => (
                              <li key={t.id} className="px-4 py-3 flex items-center justify-between">
                                 <div className="flex items-center gap-3">
                                    <span className="text-xs font-bold text-red-400">#{t.queue_number}</span>
                                    <span className="text-xs text-gray-400">
                                       {t.status === 'expired' ? 'Expired' : 'Cancelled'}
                                    </span>
                                 </div>
                                 <button 
                                    onClick={() => handleCallNext()} // Simplified re-call logic, ideally handleConfirmArrival(t.id) if we want to restore specifically
                                    className="text-xs text-pink-500 font-medium hover:underline"
                                 >
                                    Recall
                                 </button>
                              </li>
                           ))}
                        </ul>
                     ) : (
                        <div className="p-4 text-center text-gray-400 text-xs">No missed tickets</div>
                     )}
                  </div>
               </div>

               {/* Analytics Card */}
               <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                  <div className="flex justify-between items-start mb-4">
                     <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                        <BarChart2 size={18} className="text-gray-400" />
                        Analytics
                     </h3>
                     
                     {/* Toggle Switch */}
                     <div className="relative flex bg-gray-100 rounded-lg p-0.5">
                        <button 
                            onClick={() => setAnalyticsMode('today')}
                            className={`text-[10px] font-bold px-3 py-1 rounded-md transition-all ${analyticsMode === 'today' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                        >
                            Today
                        </button>
                        <button 
                            onClick={() => setAnalyticsMode('total')}
                            className={`text-[10px] font-bold px-3 py-1 rounded-md transition-all ${analyticsMode === 'total' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                        >
                            Total
                        </button>
                     </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                     <div className="bg-gray-50 rounded-lg p-3 text-center">
                        <div className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Served</div>
                        <div className="text-2xl font-black text-gray-900">{analytics.served}</div>
                     </div>
                     <div className="bg-gray-50 rounded-lg p-3 text-center">
                        <div className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Missed</div>
                        <div className="text-2xl font-black text-gray-900">{analytics.missed}</div>
                     </div>
                     <div className="col-span-2 bg-gray-50 rounded-lg p-3 flex justify-between items-center px-4">
                        <div className="text-left">
                           <div className="text-xs text-gray-500 uppercase font-bold tracking-wider">Avg Wait</div>
                           <div className="text-lg font-black text-gray-900">{analytics.avgWait}m</div>
                        </div>
                        <History size={24} className="text-gray-300" />
                     </div>
                  </div>
               </div>

            </div>
         </div>
      </main>
    </div>
  );
};

export default SupabaseDashboard;
