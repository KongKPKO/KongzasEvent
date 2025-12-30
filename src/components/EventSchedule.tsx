// import React from 'react';

export const EventSchedule = () => {
  const events = [
    { 
      id: 1,
      name: 'Comic Square 9', 
      date: '7-8 March 2026',
      location: 'Union Hall 1-2, Union Mall, Bangkok',
      transport: ['MRT Phahon Yothin (BL14)', 'BTS Ha Yaek Lat Phrao (N9)'],
      ticket: '120 THB',
      isNextUp: true
    },
    { 
      id: 2,
      name: 'Japan Expo Thailand 2026', 
      date: 'Fri-Sun, 6-8 Feb',
      location: 'CentralWorld',
      transport: ['Siam', 'Chidlom'], // Adjusted to array for mapping pill styles if needed, or just display
      ticket: 'Free Entry'
    }
  ];

  return (
    <>
      {events.map((e, index) => (
        <div key={e.id} className={`group relative bg-surface-light dark:bg-surface-dark rounded-2xl shadow-lg border border-border-light dark:border-border-dark overflow-hidden hover:shadow-xl transition-all duration-300 ${index !== 0 ? 'opacity-90 hover:opacity-100 transition-opacity' : ''}`}>
           {index === 0 && <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>}
           <div className="p-6 sm:p-8">
              <div className="flex items-start justify-between mb-4">
                 <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <span className={`material-icons-round ${index === 0 ? 'text-primary' : 'text-slate-400'}`}>
                      {index === 0 ? 'event_seat' : 'event'}
                    </span>
                    {e.name}
                 </h2>
                 {index === 0 && (
                    <span className="bg-primary/10 text-primary text-xs font-bold px-2 py-1 rounded uppercase tracking-wider">Next Up</span>
                 )}
              </div>

              <div className="space-y-3 text-sm sm:text-base text-slate-600 dark:text-slate-300">
                 <div className="flex items-center gap-3">
                    <span className="material-icons-round text-slate-400">calendar_today</span>
                    <span>{e.date}</span>
                 </div>
                 <div className="flex items-start gap-3">
                    <span className="material-icons-round text-slate-400 mt-0.5">place</span>
                    <span>{e.location}</span>
                 </div>
                 <div className="flex items-start gap-3">
                    <span className="material-icons-round text-slate-400 mt-0.5">
                      {index === 0 ? 'directions_subway' : 'train'}
                    </span>
                    <div className={Array.isArray(e.transport) && index === 1 ? "flex gap-2" : "flex flex-col"}>
                       {Array.isArray(e.transport) ? (
                            e.transport.map((t, tIdx) => (
                                <span key={tIdx} className={index === 1 ? "bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded text-xs" : ""}>{t}</span>
                            ))
                       ) : (
                           <span>{e.transport}</span>
                       )}
                    </div>
                 </div>
                 <div className="flex items-center gap-3">
                    <span className="material-icons-round text-slate-400">confirmation_number</span>
                    <span className={e.ticket.includes('Free') ? "text-green-600 dark:text-green-400 font-medium" : "font-semibold text-slate-900 dark:text-white"}>{e.ticket}</span>
                 </div>
              </div>
           </div>
        </div>
      ))}
      <div className="mt-4 text-xs text-slate-400 italic text-center">
         * Schedule subject to change
      </div>
    </>
  );
};
