import { useEffect } from 'react';
import { useOutletContext } from 'react-router-dom'; 
import { useArtistRealtime } from '../../hooks/useArtistRealtime';
import { useMidnightTick } from '../../hooks/useMidnightTick';
import { Instagram, Facebook, Music2, Mail, MapPin, Ticket, Train, Calendar } from 'lucide-react';
import { Card } from '../../components/ui';
import CustomerHeader from '../../components/CustomerHeader';

const XIcon = ({ size = 20, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231h0.001zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644z" />
  </svg>
);

const Home = () => {
  // Midnight Watcher
  const currentDate = useMidnightTick();

  // 1. Unified Realtime Hook
  const { artist: contextArtist } = useOutletContext<{ artist: any }>(); // Keep basic context for ID
  const { artist, events, isConnected, refresh } = useArtistRealtime({ 
    artistId: contextArtist?.id 
  });
  
  // Use local artist state from Hook, fallback to context for initial render to prevent flash
  const displayArtist = artist || contextArtist;
  
  // Midnight Refresh Effect
  useEffect(() => {
    refresh();
  }, [currentDate, refresh]);

  // Early return if no artist data
  if (!displayArtist) return <div className="p-10 text-center text-gray-400">Loading Artist Profile...</div>;
  
  // ✅ FIX: Match Admin Panel logic - filter by end_date >= now
  const now = new Date().toISOString();
  
  // Derive Booth Status: Check if ANY valid event is currently open AND not ended
  const activeOpenEvent = events.find(e => {
       const isOpen = e.is_booth_open && e.status === 'Confirmed';
       const isNotEnded = e.end_date >= now;
       return isOpen && isNotEnded;
  });
  // Strict Event-Based Logic: Only Open if a specific Event is Open.
  // Legacy "Artist Active" switch is ignored for Booth Status to prevent desync.
  const isBoothActive = !!activeOpenEvent;

  // 2. Helper Functions
  const getBoxDate = (dateString: string) => {
    const date = new Date(dateString);
    return {
      month: date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
      day: date.getDate().toString().padStart(2, '0')
    };
  };

  const formatDateRange = (start: string, end: string) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    
    // Fix: If same day, show only one date
    if (startDate.toDateString() === endDate.toDateString()) {
       return `${startDate.toLocaleDateString('en-GB', options)}, ${startDate.getFullYear()}`;
    }

    return `${startDate.toLocaleDateString('en-GB', options)} - ${endDate.toLocaleDateString('en-GB', options)}, ${endDate.getFullYear()}`;
  };



  const socialLinks = [
    { icon: <XIcon size={20} />, url: displayArtist.x_url, label: 'X', hoverClass: 'hover:bg-black' },
    { icon: <Instagram size={20} />, url: displayArtist.ig_url, label: 'Instagram', hoverClass: 'hover:bg-[#d62976]' },
    { icon: <Facebook size={20} />, url: displayArtist.facebook_url, label: 'Facebook', hoverClass: 'hover:bg-[#1877f2]' },
    { icon: <Music2 size={20} />, url: displayArtist.tiktok_url, label: 'TikTok', hoverClass: 'hover:bg-black' },
    { icon: <Mail size={20} />, url: displayArtist.email ? `mailto:${displayArtist.email}` : '', label: 'Email', hoverClass: 'hover:bg-[#ea4335]' },
  ].filter(link => link.url);

  // 3. Auto-set Next Up Logic: Pick the first NON-CANCELLED event that hasn't ended
  // Sort by start_date descending to get the LATEST started event (matches admin)
  const sortedValidEvents = events
    .filter(e => e.status !== 'Cancelled' && e.end_date >= now)
    .sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());
  const nextUpEventId = sortedValidEvents[0]?.id;

  return (
    <div className="min-h-screen bg-white w-full max-w-md mx-auto flex flex-col pb-24 animate-fade-in shadow-2xl relative">
      
      {/* Offline Indicator */}
      {!isConnected && (
         <div className="bg-red-500 text-white text-[10px] uppercase font-bold text-center py-1 tracking-widest sticky top-0 z-[60]">
            Offline - Reconnecting...
         </div>
      )}

      <CustomerHeader 
        artistId={displayArtist.id} 
        title={displayArtist.display_name || 'Artist Name'}
        avatarUrl={displayArtist.image_url}
        avatarDisplay="stacked"
      >
        {displayArtist.bio && (
          <div className="text-gray-500 font-medium text-xs leading-relaxed max-w-[280px] mx-auto mb-3 whitespace-pre-line">
            {displayArtist.bio}
          </div>
        )}

        {/* Status Badge */}
        <div className="flex justify-center mb-1">
          {isBoothActive ? (
            <div className="inline-flex items-center px-2.5 py-0.5 bg-green-50 border border-green-100 rounded-full animate-fade-in">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
              <span className="text-green-700 text-[9px] font-bold uppercase tracking-wider">
                  {activeOpenEvent ? 'Booth Open' : 'Booth Open'}
              </span>
            </div>
          ) : (
            <div className="inline-flex items-center px-2.5 py-0.5 bg-red-50 border border-red-100 rounded-full animate-fade-in">
               <div className="w-1.5 h-1.5 rounded-full bg-red-500 mr-1.5 shadow-[0_0_8px_rgba(239,68,68,0.4)]"></div>
               <span className="text-red-700 text-[9px] font-bold uppercase tracking-wider">Booth Closed</span>
            </div>
          )}
        </div>
      </CustomerHeader>


      {/* Events Section */}
      <div className="flex-1 px-4 mt-2">
        <h3 className="font-bold text-gray-900 text-sm mb-3 flex items-center gap-2 px-1">Next Events</h3>
        <div className="space-y-3 mb-4">
          {events.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm font-medium">No upcoming events</div>
          ) : (
            events.map((event) => {
              const { month, day } = getBoxDate(event.start_date);
              const isNextUp = event.id === nextUpEventId;
              const isCancelled = event.status === 'Cancelled';
              
              return (
                <Card 
                  key={event.id} 
                  className={`border-none shadow-sm p-4 rounded-3xl relative overflow-hidden ring-1 ring-gray-100 transition-all duration-300
                    ${isCancelled 
                       ? 'bg-gray-50 opacity-100 grayscale-[0.8] ring-gray-200'
                       : isNextUp 
                         ? 'bg-white shadow-md' 
                         : 'bg-gray-50/50 opacity-90 grayscale-[0.3]'
                    }`}
                >
                   {/* Cancelled Overlay */}
                   {isCancelled && (
                      <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                         <div className="border-[2px] border-red-500 text-red-500 text-xl font-black uppercase tracking-widest -rotate-12 px-4 py-2 rounded-lg bg-white/10 backdrop-blur-[1px]">
                            Cancelled
                         </div>
                      </div>
                   )}

                   {/* Next Up Badge */}
                   {isNextUp && !isCancelled && (
                     <div className="absolute top-0 right-0 bg-[#d63384] text-white text-[10px] font-bold px-3 py-1 rounded-bl-2xl z-10">
                        NEXT UP
                     </div>
                   )}

                   <div className={`flex items-start gap-4 ${isCancelled ? 'opacity-50' : ''}`}>
                      <div className={`w-14 h-14 rounded-2xl flex flex-col items-center justify-center border shrink-0
                        ${isNextUp && !isCancelled ? 'bg-pink-50 border-pink-100' : 'bg-white border-gray-100'}`}>
                         <span className={`text-[10px] font-bold uppercase ${isNextUp && !isCancelled ? 'text-[#d63384]' : 'text-gray-400'}`}>{month}</span>
                         <span className="text-2xl font-black text-gray-900 leading-none">{day}</span>
                      </div>

                      <div className="flex-1 space-y-2 pt-0.5">
                         <h4 className="font-bold text-gray-900 text-lg leading-tight">{event.event_name}</h4>
                         <div className="space-y-1.5 text-gray-500 text-xs font-medium">
                            <div className="flex items-start gap-2"><MapPin size={14} className={isCancelled ? 'text-gray-400' : 'text-[#d63384]'} /><span>{event.location_name}</span></div>

                            {event.entrance_fee && <div className="flex items-center gap-2"><Ticket size={14} className={isCancelled ? 'text-gray-400' : 'text-[#d63384]'} /><span>{event.entrance_fee}</span></div>}
                            {event.transit_info && <div className="flex items-start gap-2"><Train size={14} className={isCancelled ? 'text-gray-400' : 'text-[#d63384]'} /><div className="whitespace-pre-line">{event.transit_info}</div></div>}
                            <div className="flex items-center gap-2"><Calendar size={14} className={isCancelled ? 'text-gray-400' : 'text-[#d63384]'} /><span>{formatDateRange(event.start_date, event.end_date)}</span></div>
                         </div>
                      </div>
                   </div>
                </Card>
              );
            })
          )}
        </div>
      </div>

      {/* Social Footer */}
      <div className="px-8 mt-6">
        <div className="flex items-center gap-4 mb-4">
           <div className="h-px bg-gray-200 flex-1"></div>
           <span className="text-xs font-bold text-black uppercase tracking-widest">Follow Me</span>
           <div className="h-px bg-gray-200 flex-1"></div>
        </div>
        <div className="flex justify-center items-center gap-6 mb-4">
           {socialLinks.map((link, i) => (
              <a key={i} href={link.url} target="_blank" rel="noreferrer" className="text-black hover:text-[#d63384] hover:scale-110 transition-all">
                 {link.icon}
              </a>
           ))}
        </div>
      </div>
    </div>
  );
};

export default Home;