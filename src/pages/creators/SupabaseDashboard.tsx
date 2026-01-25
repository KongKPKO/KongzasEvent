import { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Button } from '../../components/ui';
import { LayoutDashboard, List, History, BarChart2, Bell, CheckCircle, RotateCcw, Play, Ticket, Coffee, AlertCircle, UserCheck, X, PauseCircle } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

interface QueueItem {
  id: string; // UUID from DB
  artist_id: string;
  event_id?: string;
  queue_number: number;
  status: 'waiting' | 'calling' | 'serving' | 'complete' | 'missed' | 'expired' | 'queued'; // Standardized statuses
  last_updated_at: string;
  created_at?: string; // We might need timestamp for waiting time
  served_at?: string; // Timestamp when status changed to 'serving'
  completed_at?: string; // Timestamp when status changed to 'complete'
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
  const navigate = useNavigate();
  const [queues, setQueues] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isBoothActive, setIsBoothActive] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(true); // Default true


  const handleLogout = async () => {
      await supabase.auth.signOut();
      navigate('/manage-login');
  };
  
  // Event & Ticket State
  // Event & Ticket State
  const [events, setEvents] = useState<DashboardEvent[]>([]); 
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [activeEventStatusMessage, setActiveEventStatusMessage] = useState<string>('No Active Event Today');
  const [analyticsMode, setAnalyticsMode] = useState<'today' | 'total'>('today'); // New state for Analytics Toggle

  const [broadcastMessage, setBroadcastMessage] = useState<string | null>(null);
  const [artistName, setArtistName] = useState<string>('');
  const [artistAvatar, setArtistAvatar] = useState<string>('');
  
  const location = useLocation();

  // Helper: Date Range Format


  // Fetch initial data
  const fetchQueues = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
         navigate('/manage-login');
         return;
      }

      // Fetch artist status
      const { data: artistData } = await supabase
        .from('artists')
        .select('broadcast_message, display_name, image_url, is_queue_open')
        .eq('id', user.id)
        .single();
      
      if (artistData) {
         setBroadcastMessage(artistData.broadcast_message || null);
         // @ts-ignore
         if (artistData.display_name) setArtistName(artistData.display_name);
         if (artistData.image_url) setArtistAvatar(artistData.image_url);
         setIsQueueOpen(artistData.is_queue_open ?? true);
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
         // FIXED: Timezone-safe local date (YYYY-MM-DD)
         const todayStr = new Date().toLocaleDateString('en-CA'); 
         console.log("System Today:", todayStr, "Events Found:", eventsData.length);

         // 1. Find ALL events overlapping with today
         const todaysEvents = eventsData.filter(event => {
            // Assume dates from DB are YYYY-MM-DD strings (or ISO). substring(0,10) is safe for ISO.
            const start = event.start_date.substring(0, 10);
            const end = event.end_date.substring(0, 10);
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

  const handleSetBroadcast = async (msg: string | null) => {
      // Toggle logic: if clicking active button, turn it off
      const newMessage = (msg === broadcastMessage && msg !== null) ? null : msg;
      
      setBroadcastMessage(newMessage); // Optimistic UI

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('artists')
        .update({ broadcast_message: newMessage })
        .eq('id', user.id);

      if (error) {
          console.error('Error updating broadcast message:', error);
          alert('Failed to update status');
          setBroadcastMessage(broadcastMessage); // Revert
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

  const handleToggleQueue = async () => {
      const newStatus = !isQueueOpen;
      setIsQueueOpen(newStatus); // Optimistic

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
         .from('artists')
         .update({ is_queue_open: newStatus })
         .eq('id', user.id);

      if (error) {
          console.error('Error updating queue status:', error);
          setIsQueueOpen(!newStatus); // Revert
          alert('Failed to update queue status');
      }
  };

  useEffect(() => {
    let activeChannel: RealtimeChannel | null = null;
    let systemChannel: RealtimeChannel | null = null;
    let timerId: ReturnType<typeof setInterval>;

    const setupDashboard = async () => {
       // 1. Get User for RLS filtering
       const { data: { user } } = await supabase.auth.getUser();
       if (!user) return; // Should redirect to login if no user, but handled elsewhere
       
       // 2. Initial Fetch
       fetchQueues();

       // 3. UNIQUE CHANNEL NAME - Force fresh connection (bypass zombie channels)
       const channelName = `dashboard-${user.id}-${Date.now()}`;
       console.log('🔌 Setting up Realtime subscription:', channelName);
       
       // 4. System Channel for Connection Diagnostics
       systemChannel = supabase.channel('system-diagnostics-' + Date.now())
         .on('system', { event: '*' }, (payload) => {
            console.log('🔌 System Event:', payload);
         })
         .subscribe((status) => {
            console.log('🔌 System Channel Status:', status);
         });

       // 5. Main Realtime Subscription
       // แก้ไข: เพิ่ม filter เพื่อระบุ Scope ให้ชัดเจน ป้องกันปัญหา Unable to subscribe
       activeChannel = supabase
         .channel(channelName)
         // QUEUE CHANGES
         .on(
            'postgres_changes', 
            { 
               event: '*', 
               schema: 'public', 
               table: 'queues',
               filter: `artist_id=eq.${user.id}` // ✅ จุดที่เพิ่ม: กรองเฉพาะคิวของ Artist คนนี้
            }, 
            (payload) => {
               console.log('⚡ RT Event Received:', payload.eventType, payload);
            
               if (payload.eventType === 'INSERT') {
                  const newTicket = payload.new as QueueItem;
                  console.log('⚡ New Ticket INBOUND:', newTicket);
                  
                  setQueues((prev) => {
                     if (prev.find(q => q.id === newTicket.id)) {
                        return prev;
                     }
                     return [newTicket, ...prev];
                  });
               } 
               else if (payload.eventType === 'UPDATE') {
                  const updatedTicket = payload.new as QueueItem;
                  console.log('✏️ UPDATE detected', updatedTicket);
                  setQueues((prev) => prev.map(q => q.id === updatedTicket.id ? { ...q, ...updatedTicket } : q));
               }
               else if (payload.eventType === 'DELETE') {
                  const deletedId = (payload.old as QueueItem).id;
                  console.log('🗑️ DELETE detected', deletedId);
                  setQueues((prev) => prev.filter(q => q.id !== deletedId));
               }
            }
         )
         // EVENT CHANGES - (ส่วนนี้เหมือนเดิม)
         .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `artist_id=eq.${user.id}` }, (payload) => {
            console.log('📅 Event Change:', payload.eventType);
            fetchQueues();
         })
         // ARTIST CHANGES - (ส่วนนี้เหมือนเดิม)
         .on('postgres_changes', { event: '*', schema: 'public', table: 'artists', filter: `id=eq.${user.id}` }, (payload) => {
            console.log('👤 Artist Change:', payload.eventType);
            fetchQueues(); 
         })
         .subscribe((status, err) => {
            console.log('📡 Realtime Status:', status);
            if (status === 'SUBSCRIBED') {
               console.log('✅ Connected!');
            } else if (status === 'CHANNEL_ERROR') {
               console.error('❌ Error:', err);
            }
         });

       // 6. EOD Check
       timerId = setInterval(() => {
          const today = new Date().toDateString();
          const storedDate = localStorage.getItem('last_session_date');
          if (storedDate && storedDate !== today) {
              window.location.reload(); 
          } else {
              localStorage.setItem('last_session_date', today);
          }
       }, 60000);
       
       localStorage.setItem('last_session_date', new Date().toDateString());
    };

    setupDashboard();

    return () => {
      console.log('🧹 Cleaning up Realtime channels...');
      if (activeChannel) supabase.removeChannel(activeChannel);
      if (systemChannel) supabase.removeChannel(systemChannel);
      if (timerId) clearInterval(timerId);
    };
  }, []);

  // AUTO-EXPIRATION: Expire tickets in 'calling' status for > 30 minutes
  // NOTE: Only applies to 'calling' status, NOT 'waiting'
  useEffect(() => {
    const EXPIRATION_TIME_MS = 30 * 60 * 1000; // 30 minutes
    
    const expirationCheck = () => {
      const now = Date.now();
      queues.forEach((ticket) => {
        // Use updated_at from DB (fallback to last_updated_at for backwards compatibility)
        const updatedAt = (ticket as any).updated_at || ticket.last_updated_at;
        
        if (
          ticket.status === 'calling' && 
          updatedAt && 
          (now - new Date(updatedAt).getTime()) > EXPIRATION_TIME_MS
        ) {
          console.log('⏰ Auto-expiring CALLING ticket:', ticket.queue_number, 
            '| Calling for:', Math.round((now - new Date(updatedAt).getTime()) / 60000), 'mins');
          updateStatus(ticket.id, 'expired');
        }
      });
    };

    // Run immediately on mount
    expirationCheck();
    
    // Then check every 1 minute
    const expirationTimer = setInterval(expirationCheck, 60000);
    console.log('⏰ Auto-expiration timer started (checks every 1 min for calling > 30 mins)');
    
    return () => clearInterval(expirationTimer);
  }, [queues]);


  const updateStatus = async (id: string, newStatus: string) => {
    // 1. OPTIMISTIC UPDATE: Update local state immediately for instant UI feedback
    const previousQueues = [...queues]; // Store previous state for rollback
    setQueues(prev => prev.map(q => 
       q.id === id 
          ? { ...q, status: newStatus as QueueItem['status'], last_updated_at: new Date().toISOString() } 
          : q
    ));

     // 2. SEND REQUEST: Then send the actual update to Supabase
    const updates: any = { status: newStatus, last_updated_at: new Date().toISOString() };
    if (newStatus === 'serving') {
       updates.served_at = new Date().toISOString();
    }
    if (newStatus === 'complete') {
       updates.completed_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('queues')
      .update(updates)
      .eq('id', id);

    // 3. ROLLBACK ON ERROR: If request fails, revert to previous state
    if (error) {
      console.error(`Error updating status to ${newStatus}:`, error);
      setQueues(previousQueues); // Revert
      alert('Failed to update status. Please try again.');
    }
  };

  const handleCallNext = () => {
     if (nextTicket) {
        updateStatus(nextTicket.id, 'calling');
     }
  };

  const handleConfirmArrival = (id: string) => {
     // Also sets served_at via the modified updateStatus logic logic
     updateStatus(id, 'serving');
  };

  const handleComplete = (id: string) => {
     updateStatus(id, 'complete');
  };






   // --- TICKET GENERATION LOGIC REMOVED (Customer Driven) ---




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
  const totalInQueue = filteredQueues.length; // All tickets for this event

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
              // Use served_at for accurate Wait Time (Created -> Arrived at Booth)
              // Fallback to last_updated_at if served_at missing (legacy)
              const end = q.served_at 
                 ? new Date(q.served_at).getTime() 
                 : new Date(q.last_updated_at).getTime();

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

            <Link to="/manage-events" className={`transition-colors flex flex-col items-center text-xs font-medium gap-1 ${location.pathname === '/manage-events' ? 'text-pink-500' : 'text-gray-500 hover:text-pink-500'}`}>
               <LayoutDashboard size={20} />
               <span>Home</span>
            </Link>
            <Link to="/manage-products" className={`transition-colors flex flex-col items-center text-xs font-medium gap-1 ${location.pathname === '/manage-products' ? 'text-pink-500' : 'text-gray-500 hover:text-pink-500'}`}>
               <List size={20} />
               <span>Menu</span>
            </Link>
            <Link to="/manage-queues" className={`transition-colors flex flex-col items-center text-xs font-medium gap-1 ${location.pathname === '/manage-queues' ? 'text-pink-500' : 'text-gray-500 hover:text-pink-500'}`}>
               <History size={20} />
               <span>Queue</span>
            </Link>
            <div className="h-6 w-px bg-gray-200 mx-2"></div>
 
             {/* Avatar in Header */}
             <div className="flex items-center gap-3">
                {artistAvatar ? (
                   <img src={artistAvatar} alt={artistName} className="w-9 h-9 rounded-full border-2 border-white shadow-sm object-cover bg-gray-100" />
                ) : (
                   <div className="w-9 h-9 rounded-full bg-pink-100 flex items-center justify-center text-xs font-bold text-pink-500 border-2 border-white shadow-sm">
                      {artistName ? artistName.charAt(0) : <UserCheck size={16} />}
                   </div>
                )}
                <Button onClick={handleLogout} variant="ghost" className="text-gray-500 hover:text-red-500 text-xs">
                   Log Out
                </Button>
             </div>
         </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-2">
         <h1 className="text-xl font-black text-gray-800 tracking-tight">Manage Queues</h1>
         <p className="text-sm text-pink-600 font-bold">{artistName}</p>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            
            {/* LEFT COLUMN (2/3) */}
            <div className="lg:col-span-2 space-y-4">
               
                {/* Queue Control Card */}
               <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-4">
                     <div className="flex justify-between items-center mb-4">
                        <h2 className="text-base font-bold flex items-center gap-2 text-gray-800">
                           <LayoutDashboard className="text-pink-500" size={18} />
                           Queue Control
                        </h2>
                        
                        {/* Broadcast Controls - PRESETS */}
                        <div className="flex items-center gap-2 mr-4 border-r border-gray-100 pr-4">
{/* Preset Buttons */}
                           <div className="flex gap-1.5">
                              {/* 1. Break (Pink) */}
                              <button
                                 onClick={() => handleSetBroadcast("Break time")}
                                 className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-all ${
                                    broadcastMessage === "Break time" 
                                    ? "bg-pink-100 text-pink-700 border-pink-200 ring-2 ring-pink-500 ring-offset-1" 
                                    : "bg-pink-50 text-pink-700 hover:bg-pink-100 border-pink-200"
                                 }`}
                                 title="พักเบรค"
                              >
                                 <Coffee size={14} />
                                 <span className="hidden xl:inline">พักเบรค</span>
                              </button>

                              {/* 2. Urgent (Orange) */}
                              <button
                                 onClick={() => handleSetBroadcast("Urgent matter, sorry for the inconvenience")}
                                 className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-all ${
                                    broadcastMessage === "Urgent matter, sorry for the inconvenience" 
                                    ? "bg-orange-100 text-orange-700 border-orange-200 ring-2 ring-orange-500 ring-offset-1" 
                                    : "bg-orange-50 text-orange-700 hover:bg-orange-100 border-orange-200"
                                 }`}
                                 title="ติดธุระ"
                              >
                                 <AlertCircle size={14} />
                                 <span className="hidden xl:inline">ติดธุระ</span>
                              </button>

                              {/* 3. Stop Queue (Gray) - แก้ข้อความให้มีคำว่า Closed/Stop */}
                              <button
                                 onClick={() => handleSetBroadcast("Queue closed temporarily")}
                                 className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-all ${
                                    broadcastMessage === "Queue closed temporarily" 
                                    ? "bg-gray-100 text-gray-700 border-gray-200 ring-2 ring-gray-400 ring-offset-1" 
                                    : "bg-gray-50 text-gray-700 hover:bg-gray-100 border-gray-200"
                                 }`}
                                 title="หยุดรับคิว"
                              >
                                 {/* ใช้ PauseCircle แทน RotateCcw */}
                                 <PauseCircle size={14} /> 
                                 <span className="hidden xl:inline">หยุดรับคิว</span>
                              </button>
                           </div>
                           
                           {/* Clear Button */}
                           {broadcastMessage && (
                              <button 
                                 onClick={() => handleSetBroadcast(null)}
                                 className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 text-gray-400 transition-colors"
                                 title="Clear Message"
                              >
                                 <X size={14} />
                              </button>
                           )}
                        </div>

                        {/* Queue Status Toggle (Global) */}
                        <div className="flex items-center gap-2 mr-4 border-r border-gray-100 pr-4">
                           <span className={`text-[10px] font-bold uppercase tracking-wider ${isQueueOpen ? 'text-green-600' : 'text-red-500'}`}>
                              {isQueueOpen ? 'RECEIVING QUEUE' : 'QUEUE PAUSED'}
                           </span>
                           <button 
                              onClick={handleToggleQueue}
                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                                 isQueueOpen ? 'bg-green-500 focus:ring-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500 focus:ring-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
                              }`}
                           >
                              <span
                                 className={`${
                                    isQueueOpen ? 'translate-x-4' : 'translate-x-1'
                                 } inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform duration-200`}
                              />
                           </button>
                        </div>

                        {/* Booth Status Toggle */}
                        <div className="flex items-center gap-2">
                           <span className={`text-[10px] font-bold uppercase tracking-wider ${isBoothActive ? 'text-green-600' : 'text-gray-400'}`}>
                              {isBoothActive ? 'Booth Open' : 'Booth Closed'}
                           </span>
                           <button 
                              onClick={handleToggleBooth}
                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-pink-500 focus:ring-offset-2 ${
                                 isBoothActive ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-gray-300'
                              }`}
                           >
                              <span
                                 className={`${
                                    isBoothActive ? 'translate-x-4' : 'translate-x-1'
                                 } inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform duration-200`}
                              />
                           </button>
                        </div>
                     </div>

                     {/* Active Event Display */}
                     {selectedEventId && (
                        <div className="mb-3 bg-pink-50/50 border border-pink-100 rounded p-1.5 text-center">
                           <div className="text-[9px] font-bold text-pink-400 uppercase tracking-wider mb-0.5">Active Event</div>
                           <div className="font-bold text-xs text-gray-900 leading-tight">{events.find(e => e.id === selectedEventId)?.event_name}</div>
                        </div>
                     )}

                     <div className="grid grid-cols-3 gap-2 mb-4 text-center divide-x divide-gray-100">
                        <div className="py-0.5">
                           <div className="text-[10px] font-medium text-gray-400 uppercase">Total</div>
                           <div className="mt-0.5 text-xl font-black text-gray-900">{totalInQueue}</div>
                        </div>
                        <div className="py-0.5">
                           <div className="text-[10px] font-medium text-gray-400 uppercase">Next</div>
                           <div className="mt-0.5 text-xl font-black text-pink-500">#{nextTicket ? nextTicket.queue_number : '-'}</div>
                        </div>
                        <div className="py-0.5">
                           <div className="text-[10px] font-medium text-gray-400 uppercase">Waiting</div>
                           <div className="mt-0.5 text-xl font-black text-gray-900">{waitingTickets.length}</div>
                        </div>
                     </div>

                        <div className="w-full">
                           <Button
                              onClick={handleCallNext}
                              disabled={!nextTicket}
                              className={`w-full py-3 text-base rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 ${
                                 !nextTicket ? 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none' : 'bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white shadow-pink-200'
                              }`}
                           >
                              <Play size={18} fill="currentColor" />
                              <span className="font-black">Call Next {nextTicket ? `(#${nextTicket.queue_number})` : ''}</span>
                           </Button>
                        </div>
                  </div>
               </div>

               {/* Status Grid */}
               <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  
                  {/* Waiting for Arrival */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col h-full">
                     <div className="p-3 flex-1 flex flex-col">
                        <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                           <Bell className="text-yellow-500" size={14} />
                           Calling ({readyTickets.length})
                        </h3>
                        {readyTickets.length > 0 ? (
                           <div className="space-y-1.5">
                              {readyTickets.map(ticket => (
                                 <div key={ticket.id} className="bg-yellow-50 border border-yellow-100 rounded-md p-2 flex flex-col items-center text-center animate-fade-in">
                                    <div className="text-2xl font-black text-gray-900 leading-none">#{ticket.queue_number}</div>
                                    <div className="text-[9px] text-gray-500 mb-1.5">
                                       {formatElapsedTime(ticket.last_updated_at)} ago
                                    </div>
                                    <Button 
                                       onClick={() => handleConfirmArrival(ticket.id)}
                                       className="w-full bg-pink-500 hover:bg-pink-600 text-white border-none shadow-sm h-7 text-[10px] font-bold tracking-wide rounded"
                                    >
                                       ARRIVED
                                    </Button>
                                 </div>
                              ))}
                           </div>
                        ) : (
                           <div className="flex-1 flex items-center justify-center text-gray-300 text-[10px] py-4 italic border border-dashed border-gray-100 rounded-md">
                              Empty
                           </div>
                        )}
                     </div>
                  </div>

                  {/* Being Served */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col h-full">
                     <div className="p-3 flex-1 flex flex-col">
                        <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                           <CheckCircle className="text-green-500" size={14} />
                           Serving ({pendingTickets.length})
                        </h3>
                        {pendingTickets.length > 0 ? (
                           <div className="space-y-1.5">
                              {pendingTickets.map(ticket => (
                                 <div key={ticket.id} className="bg-green-50 border border-green-100 rounded-md p-2 flex flex-col items-center text-center animate-fade-in">
                                    <div className="text-2xl font-black text-gray-900 leading-none">#{ticket.queue_number}</div>
                                    <div className="text-[9px] text-gray-500 mb-1.5">Active</div>
                                    <Button 
                                       onClick={() => handleComplete(ticket.id)}
                                       variant="outline"
                                       className="w-full border-green-200 text-green-700 hover:bg-green-100 hover:text-green-800 h-7 text-[10px] font-bold tracking-wide rounded"
                                    >
                                       COMPLETE
                                    </Button>
                                 </div>
                              ))}
                           </div>
                        ) : (
                           <div className="flex-1 flex items-center justify-center text-gray-300 text-[10px] py-4 italic border border-dashed border-gray-100 rounded-md">
                              Empty
                           </div>
                        )}
                     </div>
                  </div>

               </div>
            </div>

            {/* RIGHT COLUMN (1/3) - Sidebar */}
            <div className="space-y-3">
               
               {/* Waiting List */}
               <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-3 py-2 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                     <h3 className="font-bold text-xs text-gray-900">Waiting List</h3>
                     <span className="bg-gray-200 text-gray-600 text-[10px] px-1.5 py-0.5 rounded-full font-bold">{waitingTickets.length}</span>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto">
                     {waitingTickets.length > 0 ? (
                        <ul className="divide-y divide-gray-50">
                           {waitingTickets.map((t, idx) => (
                              <li key={t.id} className="px-3 py-1 hover:bg-gray-50 transition-colors flex items-center justify-between group">
                                 <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center text-[10px] font-bold">
                                       #{t.queue_number}
                                    </div>
                                    <div>
                                       <p className="text-[11px] font-bold text-gray-800 leading-none">
                                          {idx === 0 ? 'Next' : 'Wait'}
                                       </p>
                                       <p className="text-[9px] text-gray-400 leading-none mt-0.5">
                                          {t.created_at ? formatElapsedTime(t.created_at) : 'Queued'}
                                       </p>
                                    </div>
                                 </div>
                              </li>
                           ))}
                        </ul>
                     ) : (
                        <div className="p-4 text-center text-gray-400 text-[10px]">Queue is empty</div>
                     )}
                  </div>
               </div>

               {/* Missed Card */}
               <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden opacity-90 hover:opacity-100 transition-opacity">
                   <div className="px-3 py-1.5 border-b border-gray-100 flex justify-between items-center bg-red-50/30">
                     <h3 className="font-bold text-xs text-gray-900 flex items-center gap-1.5">
                        <RotateCcw size={12} className="text-red-400" />
                        Missed
                     </h3>
                     <span className="bg-red-100 text-red-600 text-[9px] px-1.5 py-0.5 rounded-full font-bold">{expiredTickets.length}</span>
                  </div>
                  <div className="max-h-[120px] overflow-y-auto">
                     {expiredTickets.length > 0 ? (
                        <ul className="divide-y divide-gray-50">
                           {expiredTickets.map(t => (
                              <li key={t.id} className="px-3 py-1 flex items-center justify-between">
                                 <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold text-red-400">#{t.queue_number}</span>
                                    <span className="text-[9px] text-gray-400">
                                       {t.status === 'expired' ? 'Expired' : 'Cancelled'}
                                    </span>
                                 </div>
                                 <button 
                                    onClick={() => updateStatus(t.id, 'waiting')}
                                    className="text-[9px] text-pink-500 font-bold hover:underline"
                                 >
                                    Recall
                                 </button>
                              </li>
                           ))}
                        </ul>
                     ) : (
                        <div className="p-2 text-center text-gray-400 text-[9px]">No missed tickets</div>
                     )}
                  </div>
               </div>

               {/* Analytics Card */}
               <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3">
                  <div className="flex justify-between items-center mb-2">
                     <h3 className="font-bold text-xs text-gray-900 flex items-center gap-1.5">
                        <BarChart2 size={14} className="text-gray-400" />
                        Analytics
                     </h3>
                     
                     <div className="relative flex bg-gray-100 rounded p-0.5">
                        <button 
                            onClick={() => setAnalyticsMode('today')}
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded transition-all ${analyticsMode === 'today' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                        >
                            Today
                        </button>
                        <button 
                            onClick={() => setAnalyticsMode('total')}
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded transition-all ${analyticsMode === 'total' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                        >
                            Total
                        </button>
                     </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                     <div className="bg-gray-50 rounded p-1.5 text-center">
                        <div className="text-[9px] text-gray-500 uppercase font-bold tracking-wider mb-0.5">Served</div>
                        <div className="text-lg font-black text-gray-900 leading-none">{analytics.served}</div>
                     </div>
                     <div className="bg-gray-50 rounded p-1.5 text-center">
                        <div className="text-[9px] text-gray-500 uppercase font-bold tracking-wider mb-0.5">Missed</div>
                        <div className="text-lg font-black text-gray-900 leading-none">{analytics.missed}</div>
                     </div>
                     <div className="col-span-2 bg-gray-50 rounded p-1.5 flex justify-between items-center px-3">
                        <div className="text-left">
                           <div className="text-[9px] text-gray-500 uppercase font-bold tracking-wider">Avg Wait</div>
                           <div className="text-sm font-black text-gray-900 leading-none">{analytics.avgWait}m</div>
                        </div>
                        <History size={16} className="text-gray-300" />
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
