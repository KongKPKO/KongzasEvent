import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom'; // ต้องใช้เพื่อรับข้อมูล Artist จาก Parent Route
import { supabase } from '../../supabaseClient';
import { Instagram, Facebook, Music2, Mail, MapPin, Ticket, Train, Calendar, Store } from 'lucide-react';
import { Card } from '../../components/ui';

// 1. Interfaces
interface Event {
  id: string;
  artist_id: string;
  event_name: string;
  start_date: string;
  end_date: string;
  location_name: string;
  location_detail: string;
  transit_info: string;
  booth_number: string;
  entrance_fee?: string;
  status?: 'Confirmed' | 'Cancelled';
}

interface Artist {
  id: string;
  display_name: string;
  bio: string;
  is_active: boolean;
  x_url?: string;
  ig_url?: string;
  facebook_url?: string;
  tiktok_url?: string;
  email?: string;
}

const XIcon = ({ size = 20, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231h0.001zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644z" />
  </svg>
);

const Home = () => {
  // 2. State Management (กู้คืนส่วนที่หายไป)
  const { artist: contextArtist } = useOutletContext<{ artist: Artist }>();
  const [artist, setArtist] = useState<Artist | null>(contextArtist || null);
  const [events, setEvents] = useState<Event[]>([]);
  const [isBoothActive, setIsBoothActive] = useState<boolean>(contextArtist?.is_active || false);
  const [isLoading, setIsLoading] = useState(true);

  // 3. Helper Functions
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
    return `${startDate.toLocaleDateString('en-GB', options)} - ${endDate.toLocaleDateString('en-GB', options)}, ${endDate.getFullYear()}`;
  };

  // 4. Data Fetching & Realtime
  useEffect(() => {
    let isMounted = true;
    if (!contextArtist?.id) return;

    const fetchData = async () => {
      try {
        setIsLoading(true);
        // Fetch Events (Sort by date to support Auto-Next Up logic)
        const { data: eventsData, error } = await supabase
          .from('events')
          .select('*')
          .eq('artist_id', contextArtist.id)
          .gte('end_date', new Date().toISOString())
          .order('start_date', { ascending: true });

        if (error) throw error;
        if (isMounted) setEvents(eventsData || []);
      } catch (err) {
        console.error("Fetch Error:", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchData();

    const channel = supabase
      .channel(`artist-status-${contextArtist.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'artists', filter: `id=eq.${contextArtist.id}` },
        (payload) => { setIsBoothActive(payload.new.is_active); }
      ).subscribe();

    return () => { isMounted = false; supabase.removeChannel(channel); };
  }, [contextArtist?.id]);

  if (!contextArtist || !artist) return <div className="p-10 text-center">Loading Artist Profile...</div>;

  const socialLinks = [
    { icon: <XIcon size={20} />, url: artist.x_url, label: 'X', hoverClass: 'hover:bg-black' },
    { icon: <Instagram size={20} />, url: artist.ig_url, label: 'Instagram', hoverClass: 'hover:bg-[#d62976]' },
    { icon: <Facebook size={20} />, url: artist.facebook_url, label: 'Facebook', hoverClass: 'hover:bg-[#1877f2]' },
    { icon: <Music2 size={20} />, url: artist.tiktok_url, label: 'TikTok', hoverClass: 'hover:bg-black' },
    { icon: <Mail size={20} />, url: artist.email ? `mailto:${artist.email}` : '', label: 'Email', hoverClass: 'hover:bg-[#ea4335]' },
  ].filter(link => link.url);

  // 5. Auto-set Next Up Logic
  // เลือกงานแรกที่สถานะไม่ใช่ Cancelled
  const nextUpEventId = events.find(e => e.status !== 'Cancelled')?.id;

  return (
    <div className="min-h-screen bg-white w-full max-w-md mx-auto flex flex-col pb-20 animate-fade-in">
      {/* Header Section */}
      <div className="pt-12 pb-2 px-6 text-center">
        <h1 className="text-3xl font-black text-[#ff4d94] mb-2 tracking-tight drop-shadow-sm">
          {artist.display_name || 'Artist Name'}
        </h1>
        {artist.bio && (
          <div className="text-gray-500 font-medium text-sm leading-relaxed max-w-[280px] mx-auto mb-5 whitespace-pre-line">
            {artist.bio}
          </div>
        )}

        {/* Status Badge */}
        <div className="flex justify-center">
          {isBoothActive ? (
            <div className="inline-flex items-center px-3 py-1 bg-green-50 border border-green-100 rounded-full">
              <div className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
              <span className="text-green-700 text-[10px] font-bold uppercase tracking-wider">Booth Open</span>
            </div>
          ) : (
            <div className="inline-flex items-center px-3 py-1 bg-red-50 border border-red-100 rounded-full">
               <div className="w-2 h-2 rounded-full bg-red-500 mr-2 shadow-[0_0_8px_rgba(239,68,68,0.4)]"></div>
               <span className="text-red-700 text-[10px] font-bold uppercase tracking-wider">Booth Closed</span>
            </div>
          )}
        </div>
      </div>

      {/* Events Section */}
      <div className="flex-1 px-5 mt-1">
        <h3 className="font-bold text-gray-900 text-lg mb-4 flex items-center gap-2">Next Events</h3>
        <div className="space-y-4 mb-4">
          {isLoading ? (
            <div className="text-center py-10 text-gray-400">Loading events...</div>
          ) : events.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm font-medium">No upcoming events</div>
          ) : (
            events.map((event) => {
              const { month, day } = getBoxDate(event.start_date);
              const isNextUp = event.id === nextUpEventId;
              const isCancelled = event.status === 'Cancelled';
              
              return (
                <Card 
                  key={event.id} 
                  className={`border-none shadow-md p-5 rounded-2xl relative overflow-hidden ring-1 ring-gray-100 transition-all duration-300
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
                         <div className="border-[3px] border-red-500 text-red-500 text-2xl font-black uppercase tracking-widest -rotate-12 px-4 py-2 rounded-lg bg-white/10 backdrop-blur-[1px]">
                            Cancelled
                         </div>
                      </div>
                   )}

                   {/* Next Up Badge */}
                   {isNextUp && !isCancelled && (
                     <div className="absolute top-0 right-0 bg-[#ff4d94] text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl z-10">
                        NEXT UP
                     </div>
                   )}

                   <div className={`flex items-start gap-4 ${isCancelled ? 'opacity-50' : ''}`}>
                      <div className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center border shrink-0
                        ${isNextUp && !isCancelled ? 'bg-pink-50 border-pink-100' : 'bg-white border-gray-100'}`}>
                         <span className={`text-[10px] font-bold uppercase ${isNextUp && !isCancelled ? 'text-[#ff4d94]' : 'text-gray-400'}`}>{month}</span>
                         <span className="text-2xl font-black text-gray-900 leading-none">{day}</span>
                      </div>

                      <div className="flex-1 space-y-2 pt-0.5">
                         <h4 className="font-bold text-gray-900 text-lg leading-none">{event.event_name}</h4>
                         <div className="space-y-1.5 text-gray-500 text-xs font-medium">
                            <div className="flex items-start gap-2"><MapPin size={14} className={isCancelled ? 'text-gray-400' : 'text-[#ff4d94]'} /><span>{event.location_name}</span></div>
                            {event.booth_number && <div className="flex items-center gap-2"><Store size={14} className={isCancelled ? 'text-gray-400' : 'text-[#ff4d94]'} /><span>{event.booth_number}</span></div>}
                            {event.entrance_fee && <div className="flex items-center gap-2"><Ticket size={14} className={isCancelled ? 'text-gray-400' : 'text-[#ff4d94]'} /><span>{event.entrance_fee}</span></div>}
                            {event.transit_info && <div className="flex items-start gap-2"><Train size={14} className={isCancelled ? 'text-gray-400' : 'text-[#ff4d94]'} /><div className="whitespace-pre-line">{event.transit_info}</div></div>}
                            <div className="flex items-center gap-2"><Calendar size={14} className={isCancelled ? 'text-gray-400' : 'text-[#ff4d94]'} /><span>{formatDateRange(event.start_date, event.end_date)}</span></div>
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
        <div className="flex items-center gap-4 mb-2">
           <div className="h-px bg-gray-200 flex-1"></div>
           <span className="text-xs font-bold text-black uppercase tracking-widest">Follow Me</span>
           <div className="h-px bg-gray-200 flex-1"></div>
        </div>
        <div className="flex justify-center items-center gap-4 mb-4">
           {socialLinks.map((link, i) => (
              <a key={i} href={link.url} target="_blank" rel="noreferrer" className={`p-3 rounded-full transition-all text-black ${link.hoverClass} hover:text-white`}>
                 {link.icon}
              </a>
           ))}
        </div>
      </div>
    </div>
  );
};

export default Home;