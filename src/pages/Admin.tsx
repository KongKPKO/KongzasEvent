import { useState, useEffect } from 'react';
import { getQueueService } from '../services/ServiceFactory';
import { QueueState } from '../services/QueueInterfaces';


const queueService = getQueueService();

const formatElapsedTime = (ms: number) => {
   const seconds = Math.floor(ms / 1000);
   const h = Math.floor(seconds / 3600);
   const m = Math.floor((seconds % 3600) / 60);
   const s = seconds % 60;

   if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
   }
   return `${m}:${s.toString().padStart(2, '0')}`;
};

const Admin = () => {
   // Real-time State
   const [queueState, setQueueState] = useState<QueueState>({
      currentServing: 0,
      lastTicketIssued: 0,
      lastUpdated: Date.now(),
      isAccepting: true,
      tickets: {}
   });

   // Init Subscription and Cleanup Interval
   useEffect(() => {
      const unsubscribe = queueService.subscribeToQueue((newState: QueueState) => {
         setQueueState(newState);
      });

      // Run expiration cleanup every 5 seconds
      const cleanupInterval = setInterval(() => {
         queueService.cleanupExpired().catch(console.error);
      }, 5000);

      return () => {
         unsubscribe();
         clearInterval(cleanupInterval);
      };
   }, []);

   const handleCallNext = () => {
      queueService.callNext();
   };

   const handleUndo = () => {
      if (confirm("Undo last action?")) {
         queueService.undoLastAction();
      }
   };

   const handleConfirm = (id: number) => {
      queueService.confirmTicket(id);
   };

   const handleReset = () => {
      if (confirm('Are you sure you want to reset the queue?')) {
         queueService.resetQueue();
      }
   };

   // Derive State (Same as before)
   const allTickets = Object.values(queueState.tickets || {});
   const pendingTickets = allTickets.filter(t => t.status === 'pending'); // On Lane
   const readyTickets = allTickets.filter(t => t.status === 'ready').sort((a, b) => a.calledAt! - b.calledAt!); // Called/Ready (Ascending)
   const waitingTickets = allTickets.filter(t => t.status === 'waiting').sort((a, b) => a.id - b.id); // Waiting
   const expiredTickets = allTickets.filter(t => t.status === 'expired').sort((a, b) => b.calledAt! - a.calledAt!); // Expired (Recent first)
   const completedTickets = allTickets.filter(t => t.status === 'complete');

   const nextTicketId = waitingTickets.length > 0 ? waitingTickets[0].id : null;
   const totalInQueue = pendingTickets.length + readyTickets.length + waitingTickets.length;

   const handleMarkComplete = (id: number) => {
      queueService.completeTicket(id);
   };



   return (
      <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in-down">
         <div className="md:flex md:items-center md:justify-between mb-8">
            <div className="flex-1 min-w-0">
               <h2 className="text-2xl font-bold leading-7 text-gray-900 dark:text-white sm:text-3xl sm:truncate">
                  Admin Dashboard
               </h2>
               <div className="mt-1 flex flex-col sm:flex-row sm:flex-wrap sm:mt-0 sm:space-x-6">
                  <div className={`mt-2 flex items-center text-sm font-medium ${queueState.isAccepting ? 'text-green-500 dark:text-green-400' : 'text-red-500'}`}>
                     <span className="material-icons-outlined text-sm mr-1.5">fiber_manual_record</span>
                     System {queueState.isAccepting ? "Online" : "Offline"}
                  </div>
                  <div className="mt-2 flex items-center text-sm text-gray-500 dark:text-gray-400">
                     <span className="material-icons-outlined text-lg mr-1.5">event</span>
                     Comic Square 9
                  </div>
               </div>
            </div>
            <div className="mt-4 flex md:mt-0 md:ml-4">
               {/* Settings button placeholder */}
               <button className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-surface-light dark:bg-surface-dark hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-secondary" type="button">
                  <span className="material-icons-outlined mr-2 text-sm">settings</span>
                  Settings
               </button>
            </div>
         </div>

         <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Queue Control Panel */}
            <div className="lg:col-span-2 space-y-6">
               <div className="bg-surface-light dark:bg-surface-dark overflow-hidden shadow rounded-lg border border-border-light dark:border-border-dark">
                  <div className="px-4 py-5 sm:p-6">
                     <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-white flex items-center">
                           <span className="material-icons-outlined mr-2 text-primary">confirmation_number</span>
                           Queue Control
                        </h3>
                        <button onClick={handleReset} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex items-center transition-colors">
                           <span className="material-icons-outlined mr-1 text-sm">refresh</span> Reset Queue
                        </button>
                     </div>

                     <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 text-center divide-y md:divide-y-0 md:divide-x divide-gray-200 dark:divide-gray-700">
                        <div className="py-2">
                           <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Total in Queue</dt>
                           <dd className="mt-1 text-3xl font-semibold text-gray-900 dark:text-white">{totalInQueue}</dd>
                        </div>
                        <div className="py-2">
                           <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Next Ticket</dt>
                           <dd className="mt-1 text-3xl font-semibold text-primary">#{nextTicketId || '-'}</dd>
                        </div>
                        <div className="py-2">
                           <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Waiting</dt>
                           <dd className="mt-1 text-3xl font-semibold text-gray-900 dark:text-white">{waitingTickets.length}</dd>
                        </div>
                     </div>

                     <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <button
                           onClick={handleCallNext}
                           disabled={!nextTicketId}
                           className={`w-full sm:w-auto inline-flex justify-center items-center px-6 py-4 border border-transparent text-base font-medium rounded-md shadow-sm text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-all transform active:scale-95 ${!nextTicketId ? 'bg-gray-400 cursor-not-allowed' : 'bg-primary hover:bg-indigo-600'}`}
                        >
                           <span className="material-icons-outlined mr-2">play_arrow</span>
                           Call Next Ticket {nextTicketId ? `(#${nextTicketId})` : ''}
                        </button>
                        <button
                           onClick={handleUndo}
                           className="w-full sm:w-auto inline-flex justify-center items-center px-6 py-4 border border-gray-300 dark:border-gray-600 shadow-sm text-base font-medium rounded-md text-gray-700 dark:text-gray-200 bg-surface-light dark:bg-surface-dark hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all"
                           type="button"
                        >
                           <span className="material-icons-outlined mr-2">undo</span>
                           Undo Last
                        </button>
                     </div>
                  </div>
               </div>

               {/* Active Tickets Grid */}
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Waiting for Arrival */}
                  <div className="bg-surface-light dark:bg-surface-dark shadow rounded-lg border border-border-light dark:border-border-dark flex flex-col">
                     <div className="px-4 py-5 sm:p-6 flex-1">
                        <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4 flex items-center">
                           <span className="material-icons-outlined mr-2 text-yellow-500">notifications_active</span>
                           Waiting for Arrival ({readyTickets.length})
                        </h4>
                        {readyTickets.length > 0 ? (
                           <div className="space-y-4">
                              {readyTickets.map(t => (
                                 <div key={t.id} className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-4 flex flex-col items-center justify-center space-y-3">
                                    <div className="text-center">
                                       <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100 mb-2">Ready</span>
                                       <div className="text-4xl font-bold text-gray-900 dark:text-white mb-1">#{t.id}</div>
                                       <div className="text-xs text-gray-500 dark:text-gray-400">Called {formatElapsedTime(Date.now() - (t.calledAt || 0))} ago</div>
                                    </div>
                                    <button onClick={() => handleConfirm(t.id)} className="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors">
                                       Confirm Arrival
                                    </button>
                                 </div>
                              ))}
                           </div>
                        ) : (
                           <div className="text-center py-8 text-gray-400 text-sm">No tickets ready</div>
                        )}
                     </div>
                  </div>

                  {/* Being Served */}
                  <div className="bg-surface-light dark:bg-surface-dark shadow rounded-lg border border-border-light dark:border-border-dark flex flex-col">
                     <div className="px-4 py-5 sm:p-6 flex-1">
                        <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4 flex items-center">
                           <span className="material-icons-outlined mr-2 text-green-500">check_circle</span>
                           Being Served ({pendingTickets.length})
                        </h4>
                        {pendingTickets.length > 0 ? (
                           <div className="space-y-4">
                              {pendingTickets.map(t => (
                                 <div key={t.id} className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md p-4 flex flex-col items-center justify-center h-full">
                                    <div className="text-center py-4">
                                       <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100 mb-2">Serving</span>
                                       <div className="text-4xl font-bold text-gray-900 dark:text-white mb-1">#{t.id}</div>
                                       <div className="text-xs text-gray-500 dark:text-gray-400">Active</div>
                                    </div>
                                    <div className="w-full flex justify-center pt-2">
                                       <button onClick={() => handleMarkComplete(t.id)} className="text-sm text-green-700 dark:text-green-400 hover:text-green-900 dark:hover:text-green-300 font-medium">Mark Complete</button>
                                    </div>
                                 </div>
                              ))}
                           </div>
                        ) : (
                           <div className="text-center py-8 text-gray-400 text-sm">No tickets being served</div>
                        )}
                     </div>
                  </div>
               </div>
            </div>

            {/* Sidebar Lists */}
            <div className="space-y-6">
               {/* Waiting List */}
               <div className="bg-surface-light dark:bg-surface-dark shadow rounded-lg border border-border-light dark:border-border-dark">
                  <div className="px-4 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                     <h3 className="text-lg font-medium text-gray-900 dark:text-white">Waiting List</h3>
                     <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                        {waitingTickets.length}
                     </span>
                  </div>
                  <ul className="divide-y divide-gray-200 dark:divide-gray-700 max-h-[300px] overflow-y-auto custom-scrollbar">
                     {waitingTickets.map(t => (
                        <li key={t.id} className="px-4 py-4 sm:px-6 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group">
                           <div className="flex items-center justify-between">
                              <div className="flex items-center">
                                 <div className="flex-shrink-0">
                                    <span className="h-10 w-10 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-primary font-bold">#{t.id}</span>
                                 </div>
                                 <div className="ml-4">
                                    <div className="text-sm font-medium text-gray-900 dark:text-white">Next in Line</div>
                                    <div className="text-sm text-gray-500 dark:text-gray-400">Waited {formatElapsedTime(Date.now() - t.timestamp)}</div>
                                 </div>
                              </div>
                              <span className="material-icons-outlined text-gray-400 group-hover:text-gray-500">chevron_right</span>
                           </div>
                        </li>
                     ))}
                     {waitingTickets.length === 0 && <li className="px-4 py-8 text-center text-sm text-gray-500">Queue is empty</li>}
                  </ul>
               </div>

               {/* Missed */}
               <div className="bg-surface-light dark:bg-surface-dark shadow rounded-lg border border-border-light dark:border-border-dark opacity-75 hover:opacity-100 transition-opacity">
                  <div className="px-4 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                     <h3 className="text-lg font-medium text-gray-900 dark:text-white flex items-center">
                        <span className="material-icons-outlined text-red-500 mr-2 text-base">error_outline</span>
                        Missed ({expiredTickets.length})
                     </h3>
                  </div>
                  <ul className="divide-y divide-gray-200 dark:divide-gray-700 max-h-[300px] overflow-y-auto">
                     {expiredTickets.map(t => (
                        <li key={t.id} className="px-4 py-4 sm:px-6 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                           <div className="flex items-center justify-between">
                              <div className="flex items-center">
                                 <div className="flex-shrink-0">
                                    <span className="h-8 w-8 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center text-red-600 dark:text-red-400 text-xs font-bold">#{t.id}</span>
                                 </div>
                                 <div className="ml-4">
                                    <div className="text-sm font-medium text-gray-900 dark:text-white">Ticket Expired</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">Called {formatElapsedTime(Date.now() - (t.calledAt || 0))} ago</div>
                                 </div>
                              </div>
                              <button
                                 onClick={() => handleConfirm(t.id)}
                                 className="ml-4 inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded text-white bg-primary hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 shadow-sm"
                              >
                                 Confirm Arrival
                              </button>
                           </div>
                        </li>
                     ))}
                     {expiredTickets.length === 0 && <li className="px-4 py-8 text-center text-sm text-gray-500">No missed tickets</li>}
                  </ul>
               </div>

               {/* Analytics */}
               <div className="bg-surface-light dark:bg-surface-dark shadow rounded-lg border border-border-light dark:border-border-dark p-6">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Analytics</h3>
                  <div className="grid grid-cols-2 gap-4">
                     <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg text-center">
                        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Served Total</dt>
                        <dd className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{completedTickets.length}</dd>
                     </div>
                     <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg text-center">
                        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Expired Total</dt>
                        <dd className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{expiredTickets.length}</dd>
                     </div>
                     <div className="col-span-2 bg-gray-50 dark:bg-gray-800 p-4 rounded-lg flex justify-between items-center">
                        <div>
                           <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Avg Wait Time</dt>
                           {/* This is a placeholder as calculating real avg wait needs historical data logic */}
                           <dd className="mt-1 text-lg font-bold text-gray-900 dark:text-white">~12m</dd>
                        </div>
                        <span className="material-icons-outlined text-gray-400 text-2xl">timer</span>
                     </div>
                  </div>
               </div>
            </div>
         </div>
      </div>
   );
};

export default Admin;
