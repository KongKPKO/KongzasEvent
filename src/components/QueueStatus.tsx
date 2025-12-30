// import React from 'react';
import { useState } from 'react';

interface QueueStatusProps {
   currentPosition: number;
   myPosition: number | null;
   myStatus?: 'waiting' | 'ready' | 'pending' | 'complete' | 'expired';
   averageWaitTimeMins: number;
   onLeaveQueue?: () => void;
}

export const QueueStatus = ({
   currentPosition,
   myPosition,
   myStatus,
   // averageWaitTimeMins, // Not explicitly used in the visual design provided, but calculated logic was there. Stitch design focuses on status.
   onLeaveQueue
}: QueueStatusProps) => {

   const [isRefreshing, setIsRefreshing] = useState(false);

   const handleRefresh = () => {
      setIsRefreshing(true);
      // Simulate refresh or force update
      setTimeout(() => {
         setIsRefreshing(false);
         window.location.reload();
      }, 1000);
   };

   return (
      <div className="w-full space-y-4 animate-fade-in-down">

         {/* Current Status Card */}
         <div className="bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-zinc-700 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
            <div className="absolute -right-4 -top-4 w-24 h-24 bg-green-500/10 dark:bg-green-500/20 rounded-full blur-2xl group-hover:bg-green-500/20 transition-all"></div>
            <div className="relative z-10 flex flex-col items-center text-center space-y-2">
               <span className="text-xs font-bold uppercase tracking-widest text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-3 py-1 rounded-full">
                  Current Status
               </span>
               <h2 className="text-lg font-medium text-slate-600 dark:text-slate-300">Now Serving</h2>
               <div className="text-5xl font-bold text-slate-900 dark:text-white font-display tabular-nums tracking-tighter">
                  #{currentPosition > 0 ? currentPosition : '-'}
               </div>
            </div>
         </div>

         {/* My Ticket Card */}
         {myPosition !== null && (
            <div className="bg-surface-light dark:bg-surface-dark border-2 border-primary/50 dark:border-primary/40 rounded-2xl p-8 shadow-lg shadow-primary/5 relative overflow-hidden">

               {/* Status Badge */}
               {(myStatus === 'ready' || myStatus === 'pending' || myStatus === 'complete') && (
                  <div className="absolute top-4 right-4">
                     <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${myStatus === 'complete'
                           ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300 border-green-200 dark:border-green-800'
                           : 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                        }`}>
                        {myStatus !== 'complete' && <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>}
                        {myStatus === 'pending' ? 'SERVING' : myStatus === 'complete' ? 'COMPLETE' : 'READY'}
                     </span>
                  </div>
               )}

               <div className="flex flex-col items-center text-center space-y-4">
                  <div className="space-y-1">
                     <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Your Ticket</h3>
                     <div className="text-7xl font-black text-primary font-display tabular-nums tracking-tighter drop-shadow-sm">
                        #{myPosition}
                     </div>
                  </div>

                  <div className="w-full h-px bg-slate-100 dark:bg-zinc-700 my-2"></div>

                  <div className="space-y-2">
                     {myStatus === 'ready' ? (
                        <>
                           <p className="text-lg font-medium text-slate-900 dark:text-white">It's your turn!</p>
                           <p className="text-sm text-slate-500 dark:text-slate-400 max-w-[200px] mx-auto leading-relaxed">
                              Please proceed to the booth immediately. This ticket has been called.
                           </p>
                        </>
                     ) : myStatus === 'pending' ? (
                        <>
                           <p className="text-lg font-medium text-slate-900 dark:text-white">You are being served</p>
                           <p className="text-sm text-slate-500 dark:text-slate-400 max-w-[200px] mx-auto leading-relaxed">
                              Thank you for waiting!
                           </p>
                        </>
                     ) : myStatus === 'expired' ? (
                        <>
                           <p className="text-lg font-medium text-red-600">Ticket Expired</p>
                           <p className="text-sm text-slate-500 dark:text-slate-400 max-w-[200px] mx-auto leading-relaxed">
                              Your turn was missed. Please join the queue again.
                           </p>
                        </>
                     ) : myStatus === 'complete' ? (
                        <>
                           <p className="text-lg font-medium text-green-600 dark:text-green-400">Thank you for your support</p>
                           <p className="text-sm text-slate-500 dark:text-slate-400 max-w-[200px] mx-auto leading-relaxed">
                              Your visit is complete. Have a great day!
                           </p>
                        </>
                     ) : (
                        <>
                           <p className="text-lg font-medium text-slate-900 dark:text-white">Please Wait</p>
                           <p className="text-sm text-slate-500 dark:text-slate-400 max-w-[200px] mx-auto leading-relaxed">
                              We will notify you when it's your turn.
                           </p>
                        </>
                     )}
                  </div>
               </div>
            </div>
         )}

         {/* Actions */}
         <div className="w-full space-y-4 pt-2">
            <button
               onClick={handleRefresh}
               className="w-full group relative flex items-center justify-center space-x-2 bg-accent-blue hover:bg-indigo-600 text-white font-semibold py-4 px-6 rounded-xl shadow-lg shadow-indigo-500/20 transition-all transform active:scale-95 focus:outline-none focus:ring-4 focus:ring-indigo-500/30"
            >
               <span className={`material-icons-round transition-transform duration-500 ${isRefreshing ? 'animate-spin' : 'group-hover:rotate-180'}`}>refresh</span>
               <span>Refresh Status</span>
            </button>

            {myPosition !== null && onLeaveQueue && (
               <button
                  onClick={onLeaveQueue}
                  className="w-full flex items-center justify-center space-x-2 text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 font-medium py-3 px-6 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors focus:outline-none"
               >
                  <span className="material-icons-round text-xl">logout</span>
                  <span>Leave Queue</span>
               </button>
            )}
         </div>

      </div>
   );
};

