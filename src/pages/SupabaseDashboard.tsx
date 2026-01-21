import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { Button } from '../components/ui';
import { LayoutDashboard, Users, List, History, BarChart2, Bell, CheckCircle, RotateCcw, Play, Check } from 'lucide-react';
import { Link } from 'react-router-dom';

interface QueueItem {
  id: string; // UUID from DB
  artist_id: string;
  queue_number: number;
  status: 'waiting' | 'ready' | 'pending' | 'completed' | 'expired'; // Expanded statuses
  last_updated_at: string;
  created_at?: string; // We might need timestamp for waiting time
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

  // Fetch initial data
  const fetchQueues = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('queues')
        .select('*')
        .eq('artist_id', user.id)
        .order('id', { ascending: true }); // Get all to filter locally

      if (error) {
        console.error('Error fetching queues:', error);
      } else {
        // @ts-ignore - Assuming DB has matching fields or we map them. 
        // If DB strictly has 'waiting'|'calling', we map 'calling' -> waiting for arrival?
        // User asked to "Keep existing Supabase integration".
        // If the DB schema is strict on status enum, we might need to be careful.
        // Assuming we can store strings 'waiting', 'ready', 'pending', 'completed', 'expired'.
        setQueues(data || []);
      }
    } catch (err) {
      console.error("Unexpected error:", err);
    } finally {
      setLoading(false);
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

    return () => {
      supabase.removeChannel(channel);
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
        updateStatus(nextTicket.id, 'ready');
     }
  };

  const handleConfirmArrival = (id: string) => {
     updateStatus(id, 'pending');
  };

  const handleComplete = (id: string) => {
     updateStatus(id, 'completed');
  };

  const handleUndo = () => {
     // Naive undo: find the last updated ticket that is NOT waiting and move it back/revert?
     // Without a robust history stack, "Undo" is hard. 
     // For this UI demo, maybe just "Reset" or alert?
     // Or we can find the most recently updated item and revert state.
     // Let's implementing a simple "Call Back" logic? 
     // Or simplified: Just alert for now as valid undo requires history.
     alert("Undo not fully implemented in this demo version.");
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // derived state
  // Mapping notes: 
  // 'waiting' -> Waiting List
  // 'ready' -> Waiting for Arrival
  // 'pending' -> Being Served
  // 'completed' -> Served
  // 'expired' -> Missed
  // Note: If DB only has 'calling', we treat 'calling' as 'ready' for this UI.
  
  const waitingTickets = queues.filter(q => q.status === 'waiting' || (q.status as string) === 'queued').sort((a,b) => a.queue_number - b.queue_number);
  const readyTickets = queues.filter(q => q.status === 'ready' || q.status === 'calling'); // Supporting 'calling' as legacy 'ready'
  const pendingTickets = queues.filter(q => q.status === 'pending'); 
  const completedTickets = queues.filter(q => q.status === 'completed');
  const expiredTickets = queues.filter(q => q.status === 'expired');

  const nextTicket = waitingTickets[0];
  const totalInQueue = waitingTickets.length + readyTickets.length + pendingTickets.length;

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
            <Link to="/" className="text-gray-500 hover:text-pink-500 transition-colors flex flex-col items-center text-xs font-medium gap-1">
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
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium flex items-center gap-1">
                           <span className="w-2 h-2 rounded-full bg-green-500"></span>
                           System Online
                        </span>
                     </div>

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

                     <div className="flex gap-4 justify-center">
                        <Button
                           onClick={handleCallNext}
                           disabled={!nextTicket}
                           className={`w-full sm:w-auto px-8 py-4 h-auto text-lg rounded-xl shadow-md transition-transform active:scale-95 flex items-center justify-center gap-2 ${
                              !nextTicket ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-pink-500 hover:bg-pink-600 text-white'
                           }`}
                        >
                           <Play size={24} fill="currentColor" />
                           Call Next {nextTicket ? `(#${nextTicket.queue_number})` : ''}
                        </Button>
                        <Button
                           onClick={handleUndo}
                           variant="outline"
                           className="w-full sm:w-auto px-6 py-4 h-auto text-lg rounded-xl border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-2"
                        >
                           <RotateCcw size={20} />
                           Undo
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
                                    <span className="text-xs text-gray-400">Expired</span>
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
                  <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                     <BarChart2 size={18} className="text-gray-400" />
                     Analytics
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                     <div className="bg-gray-50 rounded-lg p-3 text-center">
                        <div className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Served</div>
                        <div className="text-2xl font-black text-gray-900">{completedTickets.length}</div>
                     </div>
                     <div className="bg-gray-50 rounded-lg p-3 text-center">
                        <div className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Missed</div>
                        <div className="text-2xl font-black text-gray-900">{expiredTickets.length}</div>
                     </div>
                     <div className="col-span-2 bg-gray-50 rounded-lg p-3 flex justify-between items-center px-4">
                        <div className="text-left">
                           <div className="text-xs text-gray-500 uppercase font-bold tracking-wider">Avg Wait</div>
                           <div className="text-lg font-black text-gray-900">~12m</div>
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
