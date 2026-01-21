import { useOutletContext } from 'react-router-dom';
import { Artist } from '../../hooks/useArtist';
import { Twitter, Instagram, Facebook, Music2, Mail, Calendar, MapPin, Ticket, Train } from 'lucide-react';
import { Card } from '../../components/ui';

const Home = () => {
  const { artist } = useOutletContext<{ artist: Artist }>();

  if (!artist) return null;

  const socialLinks = [
    { icon: <Twitter size={20} />, url: artist.x_url, label: 'Twitter' },
    { icon: <Instagram size={20} />, url: artist.ig_url, label: 'Instagram' },
    { icon: <Facebook size={20} />, url: artist.facebook_url, label: 'Facebook' },
    { icon: <Music2 size={20} />, url: artist.tiktok_url, label: 'TikTok' },
    { icon: <Mail size={20} />, url: artist.email ? `mailto:${artist.email}` : '', label: 'Email' },
  ].filter(link => link.url);

  return (
    <div className="min-h-screen bg-white w-full max-w-md mx-auto flex flex-col pb-32 animate-fade-in">
      {/* Header Section */}
      <div className="pt-12 pb-6 px-6 text-center">
        <h1 className="text-3xl font-black text-[#ff4d94] mb-2 tracking-tight drop-shadow-sm">
          {artist.display_name || 'Artist Name'}
        </h1>
        
        {artist.bio && (
          <p className="text-gray-500 font-medium text-sm leading-relaxed max-w-[280px] mx-auto mb-5 whitespace-pre-line">
            {artist.bio}
          </p>
        )}

        {/* Status Badge */}
        <div className="flex justify-center">
          {artist.is_active ? (
            <div className="inline-flex items-center px-3 py-1 bg-green-50 border border-green-100 rounded-full shadow-sm transition-all hover:shadow-md hover:scale-105 cursor-default">
              <div className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
              <span className="text-green-700 text-[10px] font-bold uppercase tracking-wider">Booth Open</span>
            </div>
          ) : (
            <div className="inline-flex items-center px-3 py-1 bg-red-50 border border-red-100 rounded-full shadow-sm transition-all hover:shadow-md hover:scale-105 cursor-default">
               <div className="w-2 h-2 rounded-full bg-red-500 mr-2 shadow-[0_0_8px_rgba(239,68,68,0.4)]"></div>
               <span className="text-red-700 text-[10px] font-bold uppercase tracking-wider">Booth Closed</span>
            </div>
          )}
        </div>
      </div>

      {/* Events Section */}
      <div className="flex-1 px-5 mt-4">
        <h3 className="font-bold text-gray-900 text-lg mb-4 flex items-center gap-2 tracking-tight">
          Next Events
        </h3>

        <div className="space-y-4">
           {/* Event 1: Comic Square 9 */}
           <Card className="border-none shadow-md bg-white p-5 rounded-2xl relative overflow-hidden ring-1 ring-gray-100 group hover:shadow-lg transition-all duration-300">
              {/* Next Up Badge */}
              <div className="absolute top-0 right-0 bg-[#ff4d94] text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl shadow-sm z-10 shadow-pink-200">
                 NEXT UP
              </div>

              <div className="flex items-start gap-4">
                 {/* Date Box */}
                 <div className="w-16 h-16 bg-gray-50 rounded-2xl flex flex-col items-center justify-center border border-gray-100 shrink-0 group-hover:bg-pink-50 group-hover:border-pink-100 transition-colors">
                    <span className="text-[10px] font-bold text-[#ff4d94] uppercase tracking-wider">MAR</span>
                    <span className="text-2xl font-black text-gray-900 leading-none">09</span>
                 </div>

                 {/* Event Details */}
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

           {/* Event 2: Japan Expo */}
           <Card className="border-none shadow-sm bg-gray-50/50 p-5 rounded-2xl relative overflow-hidden ring-1 ring-gray-100 opacity-90 grayscale-[0.3] hover:grayscale-0 hover:bg-white hover:shadow-md transition-all duration-300 group">
               <div className="flex items-start gap-4">
                 {/* Date Box */}
                 <div className="w-16 h-16 bg-white rounded-2xl flex flex-col items-center justify-center border border-gray-100 shrink-0 group-hover:border-blue-100">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider group-hover:text-blue-500">JAN</span>
                    <span className="text-2xl font-black text-gray-900 leading-none">24</span>
                 </div>

                 {/* Event Details */}
                 <div className="flex-1 space-y-2 pt-0.5">
                    <h4 className="font-bold text-gray-900 text-lg leading-none">Japan Expo 2026</h4>
                    
                    <div className="space-y-1.5">
                       <div className="flex items-center gap-2 text-gray-500 text-xs font-medium">
                          <MapPin size={14} className="text-gray-400 group-hover:text-blue-500 transition-colors" />
                          <span>Central World</span>
                       </div>
                       <div className="flex items-center gap-2 text-gray-500 text-xs font-medium">
                          <Ticket size={14} className="text-gray-400 group-hover:text-blue-500 transition-colors" />
                          <span>Zone A</span>
                       </div>
                    </div>
                 </div>
              </div>
           </Card>
        </div>
      </div>

      {/* Social Footer */}
      <div className="mt-12 px-8">
        <div className="flex items-center gap-4 mb-6">
           <div className="h-px bg-gray-200 flex-1"></div>
           <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Follow Me</span>
           <div className="h-px bg-gray-200 flex-1"></div>
        </div>

        <div className="flex justify-center items-center gap-6 mb-8">
           {socialLinks.map((link, i) => (
              <a
                 key={i}
                 href={link.url}
                 target="_blank"
                 rel="noreferrer"
                 className="text-gray-400 hover:text-[#ff4d94] hover:scale-125 transition-all duration-300 p-2"
              >
                 {link.icon}
              </a>
           ))}
        </div>
        <p className="text-center text-[10px] text-gray-300 font-medium uppercase tracking-widest mt-2">
           Click to connect
        </p>
      </div>
    </div>
  );
};

export default Home;
