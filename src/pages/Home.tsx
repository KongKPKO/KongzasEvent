import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient'; // ตรวจสอบ path ให้ถูกนะครับ (ปกติจะเป็น ../lib/supabase หรือ ../supabaseClient)
import { useOutletContext } from 'react-router-dom';
import { RealtimeArtist } from '../hooks/useArtistRealtime';
import { Twitter, Instagram, Facebook, Music2, Mail, MapPin, Ticket, Train } from 'lucide-react';
import { Card } from '../components/ui';

interface EventData {
  id: string;
  is_booth_open: boolean;
  event_name: string;
}

const Home = () => {
   const { artist } = useOutletContext<{ artist: RealtimeArtist }>();
   const [activeEvent, setActiveEvent] = useState<EventData | null>(null);
 useEffect(() => {
    if (!artist?.id) return;

    const fetchActiveEvent = async () => {
      const { data } = await supabase
        .from('events')
        .select('id, is_booth_open, event_name')
        .eq('artist_id', artist.id)
        .eq('is_booth_open', true) 
        .order('start_date', { ascending: false })
        .limit(1)
        .single();

      if (data) {
        setActiveEvent(data);
      } else {
        setActiveEvent(null);
      }
    };

    fetchActiveEvent();
  }, [artist?.id]);

  if (!artist) return null;

  const socialLinks = [
    { icon: <Twitter size={20} />, url: artist.x_url, label: 'Twitter' },
    { icon: <Instagram size={20} />, url: artist.ig_url, label: 'Instagram' },
    { icon: <Facebook size={20} />, url: artist.facebook_url, label: 'Facebook' },
    { icon: <Music2 size={20} />, url: artist.tiktok_url, label: 'TikTok' },
    { icon: <Mail size={20} />, url: artist.email ? `mailto:${artist.email}` : '', label: 'Email' },
  ].filter(link => link.url);

  return (
    <div className="min-h-screen bg-white w-full max-w-md mx-auto flex flex-col pb-20">
      <div className="pt-12 pb-6 px-6 text-center">
        <h1 className="text-3xl font-black text-[#ff4d94] mb-2 tracking-tight">
          {artist.display_name || 'Artist Name'}
        </h1>
        
        {artist.bio && (
          <div className="text-gray-500 font-medium text-sm leading-relaxed max-w-[280px] mx-auto mb-5">
            {artist.bio.split('\n').map((line, i) => (
              <div key={i} className="min-h-[1.5em]">{line}</div>
            ))}
          </div>
        )}

        <div className="flex justify-center">
          {activeEvent?.is_booth_open ? (
            <div className="inline-flex items-center px-3 py-1 bg-green-50 border border-green-100 rounded-full shadow-sm">
              <div className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse"></div>
              <span className="text-green-700 text-[10px] font-bold uppercase tracking-wider">
                Booth Open @ {activeEvent.event_name}
              </span>
            </div>
          ) : (
            <div className="inline-flex items-center px-3 py-1 bg-red-50 border border-red-100 rounded-full shadow-sm">
               <div className="w-2 h-2 rounded-full bg-red-500 mr-2"></div>
               <span className="text-red-700 text-[10px] font-bold uppercase tracking-wider">Booth Closed</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 px-5 mt-4">
        <h3 className="font-bold text-gray-900 text-lg mb-4 flex items-center gap-2">
          Next Events
        </h3>

        <div className="space-y-4">
           <Card className="border-none shadow-md bg-white p-5 rounded-2xl relative overflow-hidden ring-1 ring-gray-100">
              <div className="absolute top-0 right-0 bg-[#ff4d94] text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl shadow-sm z-10">
                 NEXT UP
              </div>
              <div className="flex items-start gap-4">
                 <div className="w-16 h-16 bg-gray-50 rounded-2xl flex flex-col items-center justify-center border border-gray-100 shrink-0">
                    <span className="text-[10px] font-bold text-[#ff4d94] uppercase tracking-wider">MAR</span>
                    <span className="text-2xl font-black text-gray-900 leading-none">09</span>
                 </div>
                 <div className="flex-1 space-y-2 pt-0.5">
                    <h4 className="font-bold text-gray-900 text-lg leading-none">Comic Square 9</h4>
                    <div className="space-y-1.5">
                       <div className="flex items-center gap-2 text-gray-500 text-xs font-medium">
                          <MapPin size={14} className="text-[#ff4d94]" />
                          <span>Seacon Square Srinakarin</span>
                       </div>
                       <div className="flex items-center gap-2 text-gray-500 text-xs font-medium">
                          <Ticket size={14} className="text-[#ff4d94]" />
                          <span>Booth B12</span>
                       </div>
                       <div className="flex items-center gap-2 text-gray-500 text-xs font-medium">
                          <Train size={14} className="text-[#ff4d94]" />
                          <span>MRT Suan Luang Rama IX</span>
                       </div>
                    </div>
                 </div>
              </div>
           </Card>
        </div>
      </div>

      <div className="px-8">
        <div className="flex items-center gap-4 mb-6">
           <div className="h-px bg-gray-200 flex-1"></div>
           <span className="text-xs font-bold text-black uppercase tracking-widest">Follow Me</span>
           <div className="h-px bg-gray-200 flex-1"></div>
        </div>

        <div className="flex justify-center items-center gap-6">
           {socialLinks.map((link, i) => (
              <a
                 key={i}
                 href={link.url || ''} 
                 target="_blank"
                 rel="noreferrer"
                 className="text-black hover:scale-110 transition-all duration-300"
              >
                 {link.icon}
              </a>
           ))}
        </div>
      </div>
    </div>
  );
};

export default Home;