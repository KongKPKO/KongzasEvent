# Source Code Summary
Generated on Fri Jan 23 01:57:21 +07 2026

## src/App.tsx
```tsx
// import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

// Pages
// Pages
import Home from './pages/customer/Home';
import Admin from './pages/Admin';
import Queue from './pages/Queue';
import Menu from './pages/Menu';
import Login from './pages/Login';
import MainLayout from './components/MainLayout';
import { RequireAuth } from './components/RequireAuth';
import AppSupabase from './AppSupabase';

// Customer Pages
import CustomerLayout from './pages/customer/CustomerLayout';
import CustomerHome from './pages/customer/Home';
import MenuView from './pages/customer/MenuView';
import QueueView from './pages/customer/QueueView';
import ManageProducts from './pages/ManageProducts';
import ManageArtist from './pages/artist/ManageArtist';

function App() {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="app-container">
        <Routes>
          <Route element={<MainLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/menu" element={<Menu />} />
            <Route path="/queue" element={<Queue />} />
            
            {/* Protected Admin Routes - now inside MainLayout for uniform nav */}
            <Route element={<RequireAuth />}>
               <Route path="/admin" element={<Admin />} />
            </Route>
          </Route>

          {/* Login Page */}
          <Route path="/login" element={<Login />} />
          
          {/* Supabase Demo Integration */}
          <Route path="/artist/manage-queues" element={<AppSupabase />} />
          <Route path="/manage-products" element={<ManageProducts />} />
          <Route path="/artist/manage-events" element={<ManageArtist />} />

          {/* Customer Facing App (Slug-Based) */}
          <Route path="/:slug" element={<CustomerLayout />}>
             <Route path="home" element={<CustomerHome />} />
             <Route path="menu" element={<MenuView />} />
             <Route path="queue" element={<QueueView />} />
             {/* Default redirect to home if just slug is entered? Or maybe show home */}
             <Route index element={<CustomerHome />} />
          </Route>
        </Routes>
      </div>
    </Router>
  );
}

export default App;
```

## src/main.tsx
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

## src/supabaseClient.ts
```ts
import { createClient } from '@supabase/supabase-js';

// Retrieve credentials from environment variables
// Make sure to create a .env file with VITE_SUPABASE_URL and VITE_SUPABASE_KEY
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn("Supabase credentials missing! Please check your .env file.");
}

const isValidUrl = (url: string) => {
  try { return Boolean(new URL(url)); } catch (e) { return false; }
};

const finalUrl = isValidUrl(supabaseUrl || '') ? supabaseUrl! : 'https://placeholder.supabase.co';
const finalKey = supabaseKey || 'placeholder';

export const supabase = createClient(finalUrl, finalKey);
```

## src/hooks/useArtistRealtime.ts
```ts
import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { RealtimeChannel } from '@supabase/supabase-js';

// Optimized Interfaces (Only essential fields)
export interface RealtimeArtist {
  id: string;
  display_name: string;
  bio: string;
  is_active: boolean;
  broadcast_message?: string;
}

export interface RealtimeEvent {
  id: string;
  event_name: string;
  start_date: string;
  end_date: string;
  location_name: string;
  booth_number?: string;
  entrance_fee?: string;
  transit_info?: string;
  status: 'Confirmed' | 'Cancelled';
  is_booth_open: boolean;
}

interface UseArtistRealtimeProps {
  artistId: string;
  initialArtist?: RealtimeArtist; 
}

export const useArtistRealtime = ({ artistId, initialArtist }: UseArtistRealtimeProps) => {
  const [artist, setArtist] = useState<RealtimeArtist | null>(initialArtist || null);
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [isConnected, setIsConnected] = useState(true); // Assumption: Starts connected
  
  // Fetch Initial Data logic (Optimized)
  const fetchInitialData = async () => {
     try {
        const [artistRes, eventsRes] = await Promise.all([
           supabase.from('artists').select('id, display_name, bio, is_active, broadcast_message').eq('id', artistId).single(),
           supabase.from('events').select('id, event_name, start_date, end_date, location_name, booth_number, entrance_fee, transit_info, status, is_booth_open')
             .eq('artist_id', artistId)
             .gte('end_date', new Date().toISOString())
             .order('start_date', { ascending: true })
        ]);

        if (artistRes.data) setArtist(artistRes.data);
        if (eventsRes.data) setEvents(eventsRes.data);
     } catch (err) {
        console.error("Initial Fetch Error", err);
     }
  };

  useEffect(() => {
    if (!artistId) return;

    fetchInitialData();

    // SETUP REALTIME
    const channel: RealtimeChannel = supabase
      .channel(`artist-realtime-${artistId}`)
      .on(
         'postgres_changes',
         { event: 'UPDATE', schema: 'public', table: 'artists', filter: `id=eq.${artistId}` },
         (payload) => {
             // Full Refresh on Artist Update (Syncs everything)
             console.log("Realtime: Artist updated, refetching...");
             fetchInitialData();
         }
      )
      .on(
         'postgres_changes',
         { event: '*', schema: 'public', table: 'events', filter: `artist_id=eq.${artistId}` },
         () => {
             // Re-fetch events on ANY change (Insert/Update/Delete)
             console.log("Realtime: Events updated, refetching...");
             fetchInitialData();
         }
      )
      .subscribe((status) => {
         if (status === 'SUBSCRIBED') setIsConnected(true);
         if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setIsConnected(false);
      });

    // Connection Status Listener (Global)
    supabase.channel('system').on('system', { event: '*' }, (payload) => {
        if (payload.event === 'disconnect') setIsConnected(false);
        if (payload.event === 'connect') setIsConnected(true);
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [artistId]);

  return { artist, events, isConnected, refresh: fetchInitialData };
};
```

## src/components/CustomerHeader.tsx
```tsx
import { ReactNode } from 'react';
import StickyBanner from './StickyBanner';

interface CustomerHeaderProps {
  artistId: string;
  title: string;
  children?: ReactNode; // For Bio, Status Badge, or Subtitle
  className?: string; // For additional styling if needed
}

const CustomerHeader = ({ artistId, title, children, className = "" }: CustomerHeaderProps) => {
  return (
    <div className={`sticky top-0 z-30 bg-white/95 backdrop-blur-sm transition-all shadow-sm ${className}`}>
      <StickyBanner artistId={artistId} />
      {/* Added pt-8 for "Move Down" fix (12-16px more breathing room), pb-3 for spacing */}
      <div className="pt-8 pb-3 px-6 text-center w-full max-w-md mx-auto">
         {/* Standardized Title: Pink, Black Font, Centered, Hight-aligned */}
         <h1 className="text-2xl font-black text-[#ff4d94] mb-1 tracking-tight drop-shadow-sm flex items-center justify-center leading-none">
            {title}
         </h1>
         {/* Sub-content (Bio, Badges, etc) */}
         {children && (
            <div className="mt-1">
               {children}
            </div>
         )}
      </div>
    </div>
  );
};

export default CustomerHeader;
```

## src/components/StickyBanner.tsx
```tsx
import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { Coffee, AlertCircle, UserCheck } from 'lucide-react';

interface StickyBannerProps {
  artistId: string;
  initialMessage?: string | null;
  isPreview?: boolean; // For Admin Preview if needed, though we rely on real data
}

const StickyBanner = ({ artistId, initialMessage }: StickyBannerProps) => {
  const [message, setMessage] = useState<string | null>(initialMessage || null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (initialMessage) {
        setMessage(initialMessage);
        setIsVisible(true);
    }
  }, [initialMessage]);

  useEffect(() => {
    if (!artistId) return;

    // 1. Initial Fetch (if not provided or to ensure fresh)
    const fetchMessage = async () => {
      const { data } = await supabase
        .from('artists')
        .select('broadcast_message')
        .eq('id', artistId)
        .single();
      
      if (data && data.broadcast_message) {
        setMessage(data.broadcast_message);
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    };

    fetchMessage();

    // 2. Realtime Subscription
    const channel = supabase
      .channel(`sticky-banner-${artistId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'artists', filter: `id=eq.${artistId}` },
        (payload) => {
          const newMsg = payload.new.broadcast_message;
          setMessage(newMsg);
          setIsVisible(!!newMsg);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [artistId]);

  if (!isVisible || !message) return null;

  // Determine Icon and Color based on message content
  // "พักเบรค" -> Coffee, Pink
  // "ติดธุระด่วน" -> Alert, Orange/Red
  // "พร้อมเรียกคิว" -> UserCheck, Green
  // Default -> Info, Gray/Pink

  let icon = <AlertCircle size={20} />;
  let bgColor = "bg-[#ff4d94]"; // Default Pink

  if (message === "พักเบรค") {
      icon = <Coffee size={20} />;
      bgColor = "bg-[#ff4d94]";
  } else if (message === "ติดธุระด่วน") {
      icon = <AlertCircle size={20} />;
      bgColor = "bg-orange-500";
  } else if (message === "พร้อมเรียกคิว") {
      icon = <UserCheck size={20} />;
      bgColor = "bg-green-500";
  }

  return (
    <div className={`w-full ${bgColor} text-white px-4 py-3 shadow-md animate-slide-down sticky top-0 z-50 flex items-center justify-center gap-3 transition-colors duration-300`}>
       {icon}
       <span className="font-bold text-sm md:text-base tracking-wide flex items-center gap-2">
          {message}
       </span>
    </div>
  );
};

export default StickyBanner;
```

## src/pages/customer/Home.tsx
```tsx
import { useOutletContext } from 'react-router-dom'; 
import { useArtistRealtime } from '../../hooks/useArtistRealtime';
import { Instagram, Facebook, Music2, Mail, MapPin, Ticket, Train, Calendar, Store } from 'lucide-react';
import { Card } from '../../components/ui';
import CustomerHeader from '../../components/CustomerHeader';

const XIcon = ({ size = 20, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231h0.001zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644z" />
  </svg>
);

const Home = () => {
  // 1. Unified Realtime Hook
  const { artist: contextArtist } = useOutletContext<{ artist: any }>(); // Keep basic context for ID
  const { artist, events, isConnected } = useArtistRealtime({ 
    artistId: contextArtist?.id 
  });
  
  // Use local artist state from Hook, fallback to context for initial render to prevent flash
  const displayArtist = artist || contextArtist;
  
  // Early return if no artist data
  if (!displayArtist) return <div className="p-10 text-center text-gray-400">Loading Artist Profile...</div>;
  
  // Derive Booth Status: Check if ANY valid event is currently open
  // Priority: Event-based toggle (New System)
  const activeOpenEvent = events.find(e => e.is_booth_open && e.status === 'Confirmed');
  const isBoothActive = !!activeOpenEvent || displayArtist?.is_active || false;

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
    return `${startDate.toLocaleDateString('en-GB', options)} - ${endDate.toLocaleDateString('en-GB', options)}, ${endDate.getFullYear()}`;
  };



  const socialLinks = [
    { icon: <XIcon size={20} />, url: displayArtist.x_url, label: 'X', hoverClass: 'hover:bg-black' },
    { icon: <Instagram size={20} />, url: displayArtist.ig_url, label: 'Instagram', hoverClass: 'hover:bg-[#d62976]' },
    { icon: <Facebook size={20} />, url: displayArtist.facebook_url, label: 'Facebook', hoverClass: 'hover:bg-[#1877f2]' },
    { icon: <Music2 size={20} />, url: displayArtist.tiktok_url, label: 'TikTok', hoverClass: 'hover:bg-black' },
    { icon: <Mail size={20} />, url: displayArtist.email ? `mailto:${displayArtist.email}` : '', label: 'Email', hoverClass: 'hover:bg-[#ea4335]' },
  ].filter(link => link.url);

  // 3. Auto-set Next Up Logic
  const nextUpEventId = events.find(e => e.status !== 'Cancelled')?.id;

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
                     <div className="absolute top-0 right-0 bg-[#ff4d94] text-white text-[10px] font-bold px-3 py-1 rounded-bl-2xl z-10">
                        NEXT UP
                     </div>
                   )}

                   <div className={`flex items-start gap-4 ${isCancelled ? 'opacity-50' : ''}`}>
                      <div className={`w-14 h-14 rounded-2xl flex flex-col items-center justify-center border shrink-0
                        ${isNextUp && !isCancelled ? 'bg-pink-50 border-pink-100' : 'bg-white border-gray-100'}`}>
                         <span className={`text-[10px] font-bold uppercase ${isNextUp && !isCancelled ? 'text-[#ff4d94]' : 'text-gray-400'}`}>{month}</span>
                         <span className="text-2xl font-black text-gray-900 leading-none">{day}</span>
                      </div>

                      <div className="flex-1 space-y-2 pt-0.5">
                         <h4 className="font-bold text-gray-900 text-lg leading-tight">{event.event_name}</h4>
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
        <div className="flex items-center gap-4 mb-4">
           <div className="h-px bg-gray-200 flex-1"></div>
           <span className="text-xs font-bold text-black uppercase tracking-widest">Follow Me</span>
           <div className="h-px bg-gray-200 flex-1"></div>
        </div>
        <div className="flex justify-center items-center gap-6 mb-4">
           {socialLinks.map((link, i) => (
              <a key={i} href={link.url} target="_blank" rel="noreferrer" className="text-black hover:text-[#ff4d94] hover:scale-110 transition-all">
                 {link.icon}
              </a>
           ))}
        </div>
      </div>
    </div>
  );
};

export default Home;```

## src/pages/customer/MenuView.tsx
```tsx
import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useArtistRealtime } from '../../hooks/useArtistRealtime';
import { Card } from '../../components/ui';
import { ShoppingBag, Plus, Minus } from 'lucide-react';
import CustomerHeader from '../../components/CustomerHeader';

interface Product {
  id: string;
  name: string;
  price: number;
  image_url: string;
  description?: string;
  category?: string;
}

const MenuView = () => {
    // 1. Unified Realtime Hook
  const { artist: contextArtist } = useOutletContext<{ artist: any }>();
  const { artist, isConnected } = useArtistRealtime({ 
    artistId: contextArtist?.id 
  });
  
  const displayArtist = artist || contextArtist;
  
  const [products, setProducts] = useState<Product[]>([]);
  // Loading now derived from products + artist
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const fetchProducts = async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('artist_id', displayArtist.id)
        .order('created_at', { ascending: false });

      if (!error && data) {
         setProducts(data);
      }
      setLoading(false);
    };

    if (displayArtist?.id) fetchProducts();
  }, [displayArtist?.id]);

  const getProductImageUrl = (dbValue: string) => {
    if (!dbValue) return '';
    let path = dbValue;
    if (dbValue.includes('http') && dbValue.includes('Menu/')) {
       const parts = dbValue.split('Menu/');
       if (parts.length > 1) path = parts[1];
    }
    const { data } = supabase.storage.from('Menu').getPublicUrl(path);
    return data.publicUrl;
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(prev => {
      const current = prev[productId] || 0;
      const next = Math.max(0, current + delta);
      const newCart = { ...prev, [productId]: next };
      if (next === 0) delete newCart[productId];
      return newCart;
    });
  };

  const totalItems = Object.values(cart).reduce((sum, qty) => sum + qty, 0);
  const totalPrice = products.reduce((sum, p) => sum + (p.price * (cart[p.id] || 0)), 0);

  // Early return if no artist data
  if (!displayArtist) return <div className="p-8 text-center text-gray-400">Loading...</div>;

  if (loading) return <div className="p-8 text-center text-gray-400">Loading menu...</div>;

  return (
    <div className="min-h-screen bg-gray-50 pb-24 animate-fade-in relative max-w-md mx-auto shadow-xl">
       {/* Offline Indicator */}
       {!isConnected && (
         <div className="bg-red-500 text-white text-[10px] uppercase font-bold text-center py-1 tracking-widest sticky top-0 z-[60]">
            Offline - Reconnecting...
         </div>
       )}

       {/* Header Section with Floating Summary & Broadcast Banner */}
       <CustomerHeader 
          artistId={displayArtist.id} 
          title={displayArtist?.display_name || 'Menu'}
          className=""
       >
             
             <div 
                onClick={() => totalItems > 0 && setIsExpanded(!isExpanded)}
                className={`mx-auto max-w-sm bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden transition-all duration-300 mt-2 ${totalItems > 0 ? 'cursor-pointer active:scale-95' : 'opacity-80'}`}
             >
                <div className="flex items-center justify-between px-4 py-2.5">
                   <div className="flex flex-col text-left">
                      <span className="text-[9px] uppercase font-bold text-gray-400 tracking-wider">Total</span>
                      <span className="text-pink-600 font-black text-lg leading-none">฿{totalPrice.toLocaleString()}</span>
                   </div>
                   <div className="flex items-center gap-2 pl-4 border-l border-gray-100">
                      <span className="font-bold text-gray-800 text-xs">{totalItems} items</span>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white shadow-md transition-colors ${totalItems > 0 ? 'bg-pink-500 shadow-pink-200' : 'bg-gray-300'}`}>
                         <ShoppingBag size={12} strokeWidth={3} />
                      </div>
                   </div>
                </div>

                 {/* Expanded Cart Details */}
                 {isExpanded && totalItems > 0 && (
                    <div className="px-4 pb-3 pt-0 bg-white animate-fade-in text-left">
                       <div className="h-px w-full bg-gray-100 mb-2"></div>
                       <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                          {Object.entries(cart).map(([id, qty]) => {
                             const product = products.find(p => p.id === id);
                             if (!product || qty === 0) return null;
                             return (
                                <div key={id} className="flex justify-between items-center text-xs">
                                   <span className="text-gray-600 font-medium truncate pr-4">{product.name}</span>
                                   <span className="font-bold text-pink-600 shrink-0">x {qty}</span>
                                </div>
                             );
                          })}
                       </div>
                    </div>
                 )}
             </div>
       </CustomerHeader>

       {/* Menu Grid */}
       <div className="px-3 mt-2 grid grid-cols-2 gap-2 pb-safe">
          {products.map(product => {
            const qty = cart[product.id] || 0;
            return (
               <Card key={product.id} className={`overflow-hidden border-none shadow-sm flex flex-col h-full transition-all duration-300 ${qty > 0 ? 'ring-2 ring-pink-500' : ''}`}>
                  {/* Image Section - Full Width */}
                  <div className="aspect-square bg-gray-100 relative w-full overflow-hidden group">
                     {product.image_url ? (
                        <img 
                           src={getProductImageUrl(product.image_url)} 
                           alt={product.name} 
                           className="w-full h-full object-cover transform transition-transform duration-500 group-hover:scale-105" 
                           onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/400x400?text=No+Image'; }}
                        />
                     ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300">
                           <span className="material-icons-outlined text-4xl">image</span>
                        </div>
                     )}
                     
                     {/* Category Badge */}
                     {product.category && (
                        <div className="absolute top-1.5 left-1.5 bg-black/60 backdrop-blur-md text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm uppercase tracking-wide">
                           {product.category}
                        </div>
                     )}
                  </div>

                  {/* Content Section */}
                  <div className="p-2 flex flex-col flex-1 bg-white">
                     {/* Locked Height Text Container for Alignment */}
                     <div className="min-h-[60px]">
                        <h3 className="font-bold text-gray-900 text-xs leading-snug line-clamp-2 mb-0.5">{product.name}</h3>
                        {product.description && (
                           <p className="text-[10px] text-gray-400 line-clamp-2 leading-relaxed">{product.description}</p>
                        )}
                     </div>
                     
                     <div className="mt-auto pt-2 flex flex-col gap-1.5">
                        <div className="flex items-baseline justify-between">
                           <span className="text-pink-600 font-black text-sm">฿{product.price}</span>
                        </div>

                        {qty === 0 ? (
                           <button 
                              onClick={() => updateQuantity(product.id, 1)}
                              className="w-full bg-gray-900 text-white rounded-lg py-1.5 flex items-center justify-center gap-1.5 hover:bg-black active:scale-95 transition-all shadow-sm"
                           >
                              <ShoppingBag size={12} />
                              <span className="text-[10px] font-bold uppercase tracking-wide">Add</span>
                           </button>
                        ) : (
                           <div className="flex items-center justify-between bg-pink-50 rounded-lg p-0.5 border border-pink-100">
                              <button 
                                 onClick={() => updateQuantity(product.id, -1)}
                                 className="w-6 h-6 rounded bg-white text-pink-600 shadow-sm flex items-center justify-center hover:bg-pink-100 active:scale-90 transition-all border border-pink-100"
                              >
                                 <Minus size={12} strokeWidth={2.5} />
                              </button>
                              <span className="font-black text-gray-900 text-xs">{qty}</span>
                              <button 
                                 onClick={() => updateQuantity(product.id, 1)}
                                 className="w-6 h-6 rounded bg-pink-500 text-white shadow-md shadow-pink-200 flex items-center justify-center hover:bg-pink-600 active:scale-90 transition-all"
                              >
                                 <Plus size={12} strokeWidth={2.5} />
                              </button>
                           </div>
                        )}
                     </div>
                  </div>
               </Card>
            );
          })}
          
          {/* Placeholder Card */}
          <Card className="border border-dashed border-gray-300 shadow-none bg-transparent flex flex-col items-center justify-center h-full min-h-[220px] p-3 text-center opacity-60">
             <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 mb-2">
                <span className="material-icons-outlined">more_horiz</span>
             </div>
             <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">More items<br/>soon</p>
          </Card>
       </div>
    </div>
  );
};

export default MenuView;
```

## src/pages/customer/QueueView.tsx
```tsx
import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useArtistRealtime } from '../../hooks/useArtistRealtime'; // Import Hook
import { Button, Card } from '../../components/ui';
import { RefreshCcw, LogOut } from 'lucide-react';
import CustomerHeader from '../../components/CustomerHeader';

interface Ticket {
  id: string;
  event_id?: string;
  queue_number: number;
  status: 'waiting' | 'calling' | 'serving' | 'complete' | 'missed' | 'expired';
  created_at: string;
}

const QueueView = () => {
    // 1. Unified Realtime Hook
  const { artist: contextArtist } = useOutletContext<{ artist: any }>();
  const { artist, events, isConnected, refresh } = useArtistRealtime({ 
    artistId: contextArtist?.id 
  });
  const displayArtist = artist || contextArtist;



  // Early return if no artist data
  if (!displayArtist) return <div className="p-12 text-center text-gray-400 font-medium">Loading...</div>;

  const [myTicket, setMyTicket] = useState<Ticket | null>(null);
  const [nowServingNumber, setNowServingNumber] = useState<number | null>(null);
  const [activeEvent, setActiveEvent] = useState<any | null>(null); // Store the actual active event
  const [eventStatusMessage, setEventStatusMessage] = useState<string>("Booth Closed"); // Default message
  const [loading, setLoading] = useState(true);

  // Helper to fetch the "Now Serving" number for a specific EVENT
  const fetchNowServing = async (eventId: string) => {
      const { data } = await supabase
         .from('queues')
         .select('queue_number')
         .eq('artist_id', displayArtist.id)
         .eq('event_id', eventId) // Filter by Event ID
         .in('status', ['calling', 'serving']) // "Calling" or "Serving" implies active service
         .order('last_updated_at', { ascending: false }) // Most recently updated
         .limit(1)
         .single();
      
      setNowServingNumber(data ? data.queue_number : null);
  };

  // 1. EFFECT: Derive Active Event from Realtime List (Updates instantly on DB change)
  useEffect(() => {
      if (!events || events.length === 0) {
          setActiveEvent(null);
          setEventStatusMessage("Booth Closed");
          return;
      }

      // Timezone-safe date check (YYYY-MM-DD)
      const todayStr = new Date().toLocaleDateString('en-CA');
      
      const todaysEvents = events.filter(event => {
          const start = event.start_date.substring(0, 10);
          const end = event.end_date.substring(0, 10);
          return todayStr >= start && todayStr <= end;
      });

      todaysEvents.sort((a,b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());

      if (todaysEvents.length > 0) {
          const confirmedEvent = todaysEvents.find(e => e.status === 'Confirmed');
          if (confirmedEvent && confirmedEvent.is_booth_open) {
              setActiveEvent(confirmedEvent);
              setEventStatusMessage("");
              console.log("Real-time Update - Active Event Is Open:", true);
          } else if (confirmedEvent) {
             // Confirmed but Closed
             setActiveEvent(null);
             setEventStatusMessage("Booth Closed");
             console.log("Real-time Update - Active Event Is Open:", false);
          } else {
             // Check Cancelled
             const cancelled = todaysEvents.find(e => e.status === 'Cancelled');
             setActiveEvent(null);
             setEventStatusMessage(cancelled ? "Today's event has been cancelled." : "Booth Closed");
          }
      } else {
          setActiveEvent(null);
          setEventStatusMessage("Booth Closed");
      }
  }, [events]);

  // 2. EFFECT: Fetch Queue Data when Active Event Changes (or on Mount/Refresh)
  useEffect(() => {
      if (!activeEvent) {
          setNowServingNumber(null);
          setLoading(false);
          // Optional: Clear ticket if strictly tied to event existence? 
          // Keeping it loosely allows viewing old tickets if needed, but per requirements usually we clear active state.
          // We will check ticket validity below.
          return;
      }

      const initQueueData = async () => {
         await fetchNowServing(activeEvent.id);

         // Ticket Verification
         const storedTicketId = localStorage.getItem(`ticket_id_${displayArtist.id}`);
         if (storedTicketId) {
             const { data: ticket } = await supabase.from('queues').select('*').eq('id', storedTicketId).single();
             
             if (ticket) {
                 // Check Mismatch
                 if (ticket.event_id !== activeEvent.id) {
                     console.warn("Ticket Event Mismatch. Clearing.");
                     localStorage.removeItem(`ticket_id_${displayArtist.id}`);
                     setMyTicket(null);
                 } else {
                     setMyTicket(ticket);
                 }
             } else {
                 localStorage.removeItem(`ticket_id_${displayArtist.id}`);
                 setMyTicket(null);
             }
         }
         
         setLoading(false);
      };

      initQueueData();
      
      // Realtime Queue Updates (Keep local subscription for Queue data)
      const channel = supabase
        .channel(`public:queues:${activeEvent.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'queues', filter: `event_id=eq.${activeEvent.id}` }, (payload) => {
             // If "Now Serving" updates or "My Ticket" updates
             fetchNowServing(activeEvent.id);
             
             setMyTicket((prev) => {
                 if (prev && (payload.new as Ticket)?.id === prev.id) {
                     return payload.new as Ticket;
                 }
                 return prev;
             });
        })
        .subscribe();

      return () => {
          supabase.removeChannel(channel);
      };

  }, [activeEvent?.id, displayArtist.id]);

  // EOD Check Loop (Global)
  useEffect(() => {
      const timer = setInterval(() => {
          const today = new Date().toDateString();
          const lastDate = localStorage.getItem('last_queue_session');
          if (lastDate && lastDate !== today) {
              window.location.reload(); 
          } else {
              localStorage.setItem('last_queue_session', today);
          }
      }, 60000); 
      localStorage.setItem('last_queue_session', new Date().toDateString());
      return () => clearInterval(timer);
  }, []);

  const handleGetTicket = async () => {
     if (!activeEvent) return; // UI should disable button, but safety check

     setLoading(true);
     try {
        // 2. Auto-Sequence Logic: Calculate Next Ticket Number
        const startOfDay = new Date();
        startOfDay.setHours(0,0,0,0);

        // Query for the latest ticket for this event TODAY
        const { data: maxData, error: maxError } = await supabase
           .from('queues')
           .select('queue_number')
           .eq('event_id', activeEvent.id)
           .gte('created_at', startOfDay.toISOString())
           .order('queue_number', { ascending: false })
           .limit(1)
           .single();

        if (maxError && maxError.code !== 'PGRST116') {
             console.error("Error fetching max ticket number:", maxError);
        }

        const nextNum = (maxData?.queue_number || 0) + 1;

        console.log(`Generating Ticket | Event ID: ${activeEvent.id} | Next Number: ${nextNum}`);

        const { data, error: insertError } = await supabase
           .from('queues')
           .insert([{
               artist_id: displayArtist.id,
               event_id: activeEvent.id,
               queue_number: nextNum,
               status: 'waiting'
           }])
           .select()
           .single();

        if (insertError) {
             console.error("Supabase Insert Error:", insertError);
             throw insertError;
        }

        if (data) {
           localStorage.setItem(`ticket_id_${displayArtist.id}`, data.id);
           setMyTicket(data);
        }

     } catch (err) {
        console.error("handleGetTicket Exception:", err);
        alert('Failed to get ticket. Please try again.');
     } finally {
        setLoading(false);
     }
  };

  const handleRefresh = async () => {
    setLoading(true);
    // Refresh Realtime Data (Artist + Events)
    await refresh(); 
    
    // Refresh Queue Data (Now Serving + My Ticket)
    if (activeEvent) {
       await fetchNowServing(activeEvent.id);
       if (myTicket) {
           const { data } = await supabase.from('queues').select('*').eq('id', myTicket.id).single();
           if (data) setMyTicket(data);
       }
    }
    setLoading(false);
  };

  const handleLeaveQueue = async () => {
    if (!myTicket) return;

    const status = myTicket.status.toLowerCase();
    const activeStatuses = ['waiting', 'calling', 'serving']; // Active service
    const endedStatuses = ['complete', 'missed', 'expired']; // Final states

    // SCENARIO B: Ended Statuses -> Just clear local
    if (endedStatuses.includes(status)) {
         localStorage.removeItem(`ticket_id_${displayArtist.id}`);
         setMyTicket(null);
         return;
    }

    // SCENARIO A: Active (Waiting, Calling, Serving) -> Confirm + Update DB + Clear
    if (activeStatuses.includes(status) || !endedStatuses.includes(status)) {
        if (confirm("Are you sure you want to leave the queue? This action cannot be undone.")) {
           console.log(`Attempting to leave queue for ticket ${myTicket.id} with status ${status}`);
           
           const { error } = await supabase
               .from('queues')
               .update({ status: 'missed' }) // Set to 'missed' to satisfy constraint & logic
               .eq('id', myTicket.id);
           
           if (error) {
               console.error("Error leaving queue (DB Update Failed):", error, "Ticket ID:", myTicket.id);
               alert("Failed to leave queue. Please try again.");
               return; // DO NOT clear local state if DB update fails
           }
           
           // ONLY Clear local storage after successful DB update
           localStorage.removeItem(`ticket_id_${displayArtist.id}`);
           setMyTicket(null);
        }
    }
  };

  // UI State Components
  const renderTicketStatus = () => {
      if (!myTicket) return null;

      // Status: WAITING
      if (myTicket.status === 'waiting') {
         return (
            <Card className="w-full p-6 text-center border-2 border-yellow-200 bg-white shadow-lg animate-fade-in">
               <div className="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase mb-4 bg-yellow-100 text-yellow-700">
                  Waiting
               </div>
               <div className="text-6xl font-black text-gray-900 mb-2">#{myTicket.queue_number}</div>
               <p className="text-gray-500 text-sm mb-6">
                  You are in the queue. Please wait for your number.
               </p>
            </Card>
         );
      }

      // Status: CALLING / SERVING (Active Service)
      if (myTicket.status === 'calling' || myTicket.status === 'serving') {
         return (
            <Card className="w-full p-8 text-center border-4 border-green-500 bg-green-50 shadow-xl animate-pulse-slow">
               <div className="inline-block px-4 py-1.5 rounded-full text-sm font-black uppercase mb-6 bg-green-500 text-white shadow-md">
                  It's Your Turn!
               </div>
               <div className="text-7xl font-black text-gray-900 mb-4">#{myTicket.queue_number}</div>
               <p className="text-green-800 font-bold text-lg mb-8">
                  Please proceed to the artist!
               </p>
               <div className="text-xs text-green-600 uppercase tracking-widest font-semibold">
                  {myTicket.status === 'serving' ? 'Being Served Now' : 'Calling...'}
               </div>
            </Card>
         );
      }

      // Status: COMPLETE
      if (myTicket.status === 'complete') {
         return (
            <Card className="w-full p-8 text-center border-2 border-gray-100 bg-white shadow-sm">
               <div className="w-16 h-16 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="material-icons-outlined text-4xl">check</span>
               </div>
               <h3 className="text-2xl font-bold text-gray-900 mb-2">Thank You!</h3>
               <p className="text-gray-500 mb-6">Your order has been completed.</p>
               <div className="text-4xl font-bold text-gray-300 mb-8">#{myTicket.queue_number}</div>
            </Card>
         );
      }
      
      // Status: MISSED / EXPIRED
      return (
         <Card className="w-full p-6 text-center border-2 border-red-100 bg-red-50">
            <h3 className="text-xl font-bold text-red-600 mb-2">Ticket Ended</h3>
            <p className="text-red-400 text-sm mb-4">Status: {myTicket.status}</p>
         </Card>
      );
  };

  if (loading) return <div className="p-12 text-center text-gray-400 font-medium">Loading status...</div>;

  return (
    <div className="px-4 py-2 flex flex-col items-center min-h-screen pb-24 w-full max-w-md mx-auto relative bg-gray-50/50">
       {/* Offline Indicator */}
       {!isConnected && (
         <div className="bg-red-500 text-white text-[10px] uppercase font-bold text-center py-1 tracking-widest sticky top-0 z-[60]">
            Offline - Reconnecting...
         </div>
       )}

       <CustomerHeader 
          artistId={displayArtist.id} 
          title={displayArtist.display_name || 'Queue'}
       >
          {activeEvent && (
              <div className="inline-block bg-pink-50 text-pink-700 px-2 py-0.5 rounded-full text-[10px] font-bold border border-pink-100">
                 {activeEvent.event_name}
              </div>
          )}
       </CustomerHeader>

       {/* NOW SERVING INDICATOR (Compact) */}
       <div className="w-full bg-slate-900 rounded-2xl p-4 shadow-xl shadow-slate-200 mb-4 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-pink-500 rounded-full blur-[40px] opacity-20 -mr-8 -mt-8 animate-pulse-slow"></div>
          
          <div className="relative flex flex-row items-center justify-between px-2">
             <div className="flex flex-col items-start gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse mb-1"></span>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-tight">Now<br/>Serving</span>
             </div>
             
             <div className={`text-4xl font-black tracking-tighter ${nowServingNumber ? 'text-white' : 'text-gray-700'}`}>
                {nowServingNumber ? (
                   <span><span className="text-pink-500 text-2xl align-top mr-0.5">#</span>{nowServingNumber}</span>
                ) : (
                   <span className="text-2xl text-gray-600">--</span>
                )}
             </div>
          </div>
       </div>

       {/* MAIN TICKET AREA */}
       {myTicket ? (
          <div className="w-full flex-1 flex flex-col gap-4">
             {renderTicketStatus()}

             {/* ACTION BUTTONS (Outside Card) */}
             <div className="flex flex-col gap-2 w-full animate-fade-in-up delay-100 mt-auto">
                 <Button 
                    onClick={handleRefresh} 
                    className="w-full bg-[#ff4d94] hover:bg-pink-600 text-white font-bold flex items-center justify-center gap-2 py-3 rounded-xl shadow-md shadow-pink-200 transition-all active:scale-95 text-sm"
                 >
                    <RefreshCcw size={16} /> Refresh Status
                 </Button>
                 
                 <button 
                    onClick={handleLeaveQueue} 
                    className="flex items-center justify-center gap-1 text-gray-400 hover:text-red-500 font-medium text-xs transition-colors py-2"
                 >
                    <LogOut size={14} /> 
                    {['complete', 'missed', 'expired'].includes(myTicket.status.toLowerCase()) ? 'Close Ticket' : 'Leave Queue'}
                 </button>
              </div>
          </div>
       ) : (
          <div className="w-full flex-1 flex flex-col justify-center">
             <div className="bg-white p-6 rounded-3xl shadow-lg border border-white text-center mb-4">
                <div className="w-16 h-16 bg-pink-50 text-pink-500 rounded-full flex items-center justify-center mx-auto mb-4">
                   <span className="material-icons-outlined text-3xl">confirmation_number</span>
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-1">
                   {activeEvent ? "Join the Queue" : (eventStatusMessage || "Booth Closed")}
                </h3>
                <p className="text-gray-500 text-xs leading-relaxed px-4">
                   {activeEvent 
                      ? "Get a number and wait for your turn." 
                      : (eventStatusMessage === "Today's event has been cancelled." 
                            ? "This event has been cancelled."
                            : "Queue is currently closed.")}
                </p>
             </div>
             <Button 
                onClick={handleGetTicket} 
                disabled={!activeEvent || loading}
                className={`w-full py-4 text-base shadow-lg font-bold rounded-xl transition-transform active:scale-95 ${
                   activeEvent 
                    ? 'bg-pink-500 hover:bg-pink-600 shadow-pink-200 text-white' 
                    : 'bg-gray-300 text-gray-500 shadow-none cursor-not-allowed'
                }`}
             >
                {activeEvent ? "Get Ticket" : (eventStatusMessage || "Booth Closed")}
             </Button>
          </div>
       )}
    </div>
  );
};

export default QueueView;
```

## src/pages/customer/CustomerLayout.tsx
```tsx
import { Outlet, useParams, useLocation, Link } from 'react-router-dom';
import { Home, ShoppingBag, Users } from 'lucide-react';
import { useArtist } from '../../hooks/useArtist';

const CustomerLayout = () => {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const { artist, loading, error } = useArtist(slug);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-pink-500 font-bold">Loading...</div>;
  if (error || !artist) return (
     <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-gray-50">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Artist Not Found</h1>
        <p className="text-gray-500">The URL you entered might be incorrect.</p>
     </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-20 md:pb-0 font-sans">
       {/* Mobile-first wrapper */}
       <div className="max-w-md mx-auto min-h-screen bg-white shadow-xl overflow-hidden relative">
          <Outlet context={{ artist }} />
          
          {/* Bottom Nav for Mobile */}
          {/* Bottom Nav for Mobile */}
          {/* Bottom Nav for Mobile */}
          <nav className="fixed bottom-0 w-full max-w-md bg-white border-t border-gray-100 flex justify-around items-end pb-6 h-20 z-50 text-[11px] font-bold tracking-tight">
             <Link 
               to={`/${slug}/home`} 
               className={`flex flex-col items-center gap-1 transition-colors ${location.pathname.endsWith('/home') ? 'text-[#ff4d94]' : 'text-slate-400'}`}
             >
                <Home size={22} strokeWidth={location.pathname.endsWith('/home') ? 2.5 : 2} />
                Home
             </Link>
             <Link 
               to={`/${slug}/menu`} 
               className={`flex flex-col items-center gap-1 transition-colors ${location.pathname.endsWith('/menu') ? 'text-[#ff4d94]' : 'text-slate-400'}`}
             >
                <ShoppingBag size={22} strokeWidth={location.pathname.endsWith('/menu') ? 2.5 : 2} />
                Merchandise
             </Link>
             <Link 
               to={`/${slug}/queue`} 
               className={`flex flex-col items-center gap-1 transition-colors ${location.pathname.endsWith('/queue') ? 'text-[#ff4d94]' : 'text-slate-400'}`}
             >
                <Users size={22} strokeWidth={location.pathname.endsWith('/queue') ? 2.5 : 2} />
                Queue
             </Link>
          </nav>
       </div>
    </div>
  );
};

export default CustomerLayout;
```

## src/pages/SupabaseDashboard.tsx
```tsx
import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Button } from '../components/ui';
import { LayoutDashboard, List, History, BarChart2, Bell, CheckCircle, RotateCcw, Play, Ticket, Coffee, AlertCircle, UserCheck, X } from 'lucide-react';
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
  const [broadcastMessage, setBroadcastMessage] = useState<string | null>(null);
  
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
        .select('is_active, broadcast_message')
        .eq('id', user.id)
        .single();
      
      if (artistData) {
         setIsBoothActive(artistData.is_active);
         setBroadcastMessage(artistData.broadcast_message || null);
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

  useEffect(() => {
    let activeChannel: RealtimeChannel | null = null;
    let timerId: ReturnType<typeof setInterval>;

    const setupDashboard = async () => {
       // 1. Get User for RLS filtering
       const { data: { user } } = await supabase.auth.getUser();
       if (!user) return; // Should redirect to login if no user, but handled elsewhere
       
       // 2. Initial Fetch
       fetchQueues();

       // 3. Setup Realtime Subscription (Filtered by Artist ID)
       activeChannel = supabase
         .channel(`dashboard-${user.id}`)
         .on('postgres_changes', { event: '*', schema: 'public', table: 'queues', filter: `artist_id=eq.${user.id}` }, (payload) => {
            console.log('Queue Change:', payload);
            fetchQueues();
         })
         .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `artist_id=eq.${user.id}` }, (payload) => {
            console.log('Event Change:', payload);
            fetchQueues();
         })
         .on('postgres_changes', { event: '*', schema: 'public', table: 'artists', filter: `id=eq.${user.id}` }, (payload) => {
            console.log('Artist Change:', payload);
            fetchQueues(); 
         })
         .subscribe();

       // 4. EOD Check
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
      if (activeChannel) supabase.removeChannel(activeChannel);
      if (timerId) clearInterval(timerId);
    };
  }, []);


  const updateStatus = async (id: string, newStatus: string) => {
    // 1. OPTIMISTIC UPDATE: Update local state immediately for instant UI feedback
    const previousQueues = [...queues]; // Store previous state for rollback
    setQueues(prev => prev.map(q => 
       q.id === id 
          ? { ...q, status: newStatus as QueueItem['status'], last_updated_at: new Date().toISOString() } 
          : q
    ));

    // 2. SEND REQUEST: Then send the actual update to Supabase
    const { error } = await supabase
      .from('queues')
      .update({ status: newStatus, last_updated_at: new Date().toISOString() })
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
     updateStatus(id, 'serving');
  };

  const handleComplete = (id: string) => {
     updateStatus(id, 'complete');
  };

  const handleSkipTicket = (id: string) => {
     updateStatus(id, 'missed');
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

            <Link to="/artist/manage-events" className={`transition-colors flex flex-col items-center text-xs font-medium gap-1 ${location.pathname === '/artist/manage-events' ? 'text-pink-500' : 'text-gray-500 hover:text-pink-500'}`}>
               <LayoutDashboard size={20} />
               <span>Home</span>
            </Link>
            <Link to="/manage-products" className={`transition-colors flex flex-col items-center text-xs font-medium gap-1 ${location.pathname === '/manage-products' ? 'text-pink-500' : 'text-gray-500 hover:text-pink-500'}`}>
               <List size={20} />
               <span>Menu</span>
            </Link>
            <Link to="/artist/manage-queues" className={`transition-colors flex flex-col items-center text-xs font-medium gap-1 ${location.pathname === '/artist/manage-queues' ? 'text-pink-500' : 'text-gray-500 hover:text-pink-500'}`}>
               <History size={20} />
               <span>Queue</span>
            </Link>
            <div className="h-6 w-px bg-gray-200 mx-2"></div>
             <Button onClick={handleLogout} variant="ghost" className="text-gray-500 hover:text-red-500">
                Log Out
             </Button>
         </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
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
                        
                        {/* Broadcast Controls - DROPDOWN */}
                        <div className="flex items-center gap-2 mr-4 border-r border-gray-100 pr-4">
                           <div className="relative">
                              <select
                                 value={broadcastMessage || ''}
                                 onChange={(e) => handleSetBroadcast(e.target.value || null)}
                                 className={`appearance-none pl-8 pr-8 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-pink-500 ${
                                    broadcastMessage === 'พักเบรค' ? 'bg-pink-50 text-pink-600 border-pink-200' :
                                    broadcastMessage === 'ติดธุระด่วน' ? 'bg-orange-50 text-orange-600 border-orange-200' :
                                    broadcastMessage === 'พร้อมเรียกคิว' ? 'bg-green-50 text-green-600 border-green-200' :
                                    'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                                 }`}
                              >
                                 <option value="">Status: Normal</option>
                                 <option value="พักเบรค">Status: Break</option>
                                 <option value="ติดธุระด่วน">Status: Busy</option>
                                 <option value="พร้อมเรียกคิว">Status: Ready</option>
                              </select>
                              
                              <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                                 {broadcastMessage === 'พักเบรค' ? <Coffee size={14} className="text-pink-500" /> :
                                  broadcastMessage === 'ติดธุระด่วน' ? <AlertCircle size={14} className="text-orange-500" /> :
                                  broadcastMessage === 'พร้อมเรียกคิว' ? <UserCheck size={14} className="text-green-500" /> :
                                  <Bell size={14} className="text-gray-400" />}
                              </div>
                           </div>
                        </div>

                        {/* Booth Status Toggle */}
                        <div className="flex items-center gap-2">
                           <span className={`text-[10px] font-bold uppercase tracking-wider ${isBoothActive ? 'text-green-600' : 'text-gray-400'}`}>
                              {isBoothActive ? 'Open' : 'Closed'}
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
                           Waiting ({readyTickets.length})
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
                                       {t.status === 'expired' ? 'Exp' : 'Can'}
                                    </span>
                                 </div>
                                 <button 
                                    onClick={() => handleCallNext()} 
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
```

## src/pages/artist/ManageArtist.tsx
```tsx
import { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { Calendar, User, MapPin, Store, Ticket, Trash2, Plus, X, BarChart2, LayoutDashboard, List, History } from 'lucide-react';
import { Button } from '../../components/ui';
import { Link, useLocation } from 'react-router-dom';

interface Artist {
  id: string;
  display_name: string;
  bio: string;
  is_active: boolean;
  x_url: string;
  ig_url: string;
  facebook_url: string;
  tiktok_url: string;
  email: string;
}

interface Event {
  id: string;
  artist_id: string;
  event_name: string;
  location_name: string;
  location_detail: string;
  booth_number: string;
  entrance_fee: string;
  transit_info: string;
  start_date: string;
  end_date: string;
  status: 'Confirmed' | 'Cancelled';
}

const ManageArtist = () => {
  const [artist, setArtist] = useState<Artist | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentEvent, setCurrentEvent] = useState<Partial<Event>>({});
  const [isEditingEvent, setIsEditingEvent] = useState(false);

  // Stats Modal State
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [summaryStats, setSummaryStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      try {
        if (isMounted) setIsLoading(true);

        // 1. Fetch Artist (slug='test1' for currrent user context)
        const { data: artistData, error: artistError } = await supabase
          .from('artists')
          .select('*')
          .eq('slug', 'test1')
          .single();

        if (artistError) throw artistError;

        if (isMounted && artistData) {
          setArtist(artistData);

          // 2. Fetch Events
          const { data: eventData, error: eventError } = await supabase
            .from('events')
            .select('*')
            .eq('artist_id', artistData.id)
            .order('start_date', { ascending: true });

          if (eventError) throw eventError;

          if (isMounted) {
            setEvents(eventData || []);
          }
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };



    fetchData();

    return () => { isMounted = false; };
  }, []);

  const location = useLocation();

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // --- Profile Actions ---

  const handleProfileChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!artist) return;
    setArtist({ ...artist, [e.target.name]: e.target.value });
  };

  const handleProfileSave = async () => {
    if (!artist) return;
    try {
      setIsSaving(true);
      const { error } = await supabase
        .from('artists')
        .update({
          display_name: artist.display_name,
          bio: artist.bio,
          x_url: artist.x_url,
          ig_url: artist.ig_url,
          facebook_url: artist.facebook_url,
          tiktok_url: artist.tiktok_url,
          email: artist.email
        })
        .eq('id', artist.id);

      if (error) throw error;
      alert("Profile updated successfully!");
    } catch (error) {
      console.error("Error updating profile:", error);
      alert("Failed to update profile.");
    } finally {
      setIsSaving(false);
    }
  };

  // --- Event Actions ---

  const handleOpenModal = (event?: Event) => {
    if (event) {
      setCurrentEvent(event);
      setIsEditingEvent(true);
    } else {
      setCurrentEvent({
        event_name: '',
        location_name: '',
        location_detail: '',
        booth_number: '',
        entrance_fee: '',
        transit_info: '',
        start_date: '',
        end_date: '',
        status: 'Confirmed'
      });
      setIsEditingEvent(false);
    }
    setIsModalOpen(true);
  };

  const handleFunctionChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setCurrentEvent({ ...currentEvent, [e.target.name]: e.target.value });
  };

  const handleEventSave = async () => {
    if (!artist || !currentEvent.event_name || !currentEvent.start_date || !currentEvent.end_date) {
      alert("Please fill in required fields (Name, Start Date, End Date)");
      return;
    }

    try {
      setIsSaving(true);
      
      const eventPayload = {
        ...currentEvent,
        artist_id: artist.id,
      };
      // Remove id if it's undefined (new event) to let DB generate it
      if (!isEditingEvent) delete eventPayload.id;

      const { data, error } = await supabase
        .from('events')
        .upsert(eventPayload)
        .select()
        .single();

      if (error) throw error;

      if (data) {
        if (isEditingEvent) {
          setEvents(events.map(e => e.id === data.id ? data : e));
        } else {
          setEvents([...events, data].sort((a,b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime()));
        }
        setIsModalOpen(false);
      }
    } catch (error) {
      console.error("Error saving event:", error);
      alert("Failed to save event.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEventDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this event?")) return;
    try {
      const { error } = await supabase.from('events').delete().eq('id', id);
      if (error) throw error;
      setEvents(events.filter(e => e.id !== id));
    } catch (error) {
       console.error("Error deleting event:", error);
       alert("Failed to delete event.");
    }
  };

  // --- STATS LOGIC ---
  const handleOpenStats = async (event: Event) => {
      setCurrentEvent(event);
      setIsStatsModalOpen(true);
      setLoadingStats(true);
      setSummaryStats(null);

      try {
         const { data: queues, error } = await supabase
            .from('queues')
            .select('*')
            .eq('event_id', event.id);

         if (error) throw error;

         if (queues) {
            // 1. Count Statuses
            const total = queues.length;
            const served = queues.filter(q => q.status === 'complete').length;
            const cancelled = queues.filter(q => q.status === 'missed').length; // User Cancelled
            const expired = queues.filter(q => q.status === 'expired').length;   // System Expired
            
            // 2. Calc Averages (Only for Served/Relevant tickets to avoid skew)
            let totalWaitTime = 0;
            let waitCount = 0;
            let totalServiceTime = 0;
            let serviceCount = 0;

            queues.forEach(q => {
               // Wait Time: Created -> Called
               if (q.called_at && q.created_at) {
                  const wait = (new Date(q.called_at).getTime() - new Date(q.created_at).getTime()) / 60000;
                  if (wait > 0 && wait < 600) { // Filter outliers > 10 hours
                     totalWaitTime += wait;
                     waitCount++;
                  }
               }

               // Service Time: Called -> Completed (Only for completed tickets)
               if (q.status === 'complete' && q.completed_at && q.called_at) {
                   const service = (new Date(q.completed_at).getTime() - new Date(q.called_at).getTime()) / 60000;
                   if (service > 0 && service < 300) { // Filter outliers > 5 hours
                       totalServiceTime += service;
                       serviceCount++;
                   }
               }
            });

            setSummaryStats({
               total,
               served,
               cancelled,
               expired,
               avgWait: waitCount > 0 ? Math.round(totalWaitTime / waitCount) : 0,
               avgService: serviceCount > 0 ? Math.round(totalServiceTime / serviceCount) : 0
            });
         }

      } catch (err) {
         console.error("Error fetching stats:", err);
      } finally {
         setLoadingStats(false);
      }
  };


  if (isLoading) return <div className="flex h-screen items-center justify-center text-pink-500 font-bold">Loading Artist Center...</div>;
  if (!artist) return <div className="flex h-screen items-center justify-center text-gray-500">Artist not found.</div>;

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-slate-800">
       
       {/* New Unified Header */}
       <nav className="bg-white border-b border-gray-200 sticky top-0 z-10 px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
             <div className="bg-pink-500 text-white p-1.5 rounded-lg font-bold">K</div>
             <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-pink-500 to-violet-600">Kongzas</span>
          </div>
          
          <div className="flex items-center gap-6">

             <Link to="/artist/manage-events" className={`transition-colors flex flex-col items-center text-xs font-medium gap-1 ${location.pathname === '/artist/manage-events' ? 'text-pink-500' : 'text-gray-500 hover:text-pink-500'}`}>
                <LayoutDashboard size={20} />
                <span>Home</span>
             </Link>
             <Link to="/manage-products" className={`transition-colors flex flex-col items-center text-xs font-medium gap-1 ${location.pathname === '/manage-products' ? 'text-pink-500' : 'text-gray-500 hover:text-pink-500'}`}>
                <List size={20} />
                <span>Menu</span>
             </Link>
             <Link to="/artist/manage-queues" className={`transition-colors flex flex-col items-center text-xs font-medium gap-1 ${location.pathname === '/artist/manage-queues' ? 'text-pink-500' : 'text-gray-500 hover:text-pink-500'}`}>
                <History size={20} />
                <span>Queue</span>
             </Link>
             <div className="h-6 w-px bg-gray-200 mx-2"></div>
              <Button onClick={handleLogout} variant="ghost" className="text-gray-500 hover:text-red-500">
                 Log Out
              </Button>
          </div>
       </nav>

      {/* Main Content - iPad Optimized (1180px Fit) */}
      <div className="w-full max-w-[1140px] mx-auto px-4 md:px-6 pb-12 pt-2 overflow-x-hidden">
        
        {/* Header */}
        <header className="mb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
           <div>
              <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight mb-1">Artist Admin Center</h1>
              <p className="text-sm md:text-base text-slate-500">Manage your profile and upcoming events</p>
           </div>
           
           <div className="flex items-center gap-3">
              <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border ${artist.is_active ? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-100 border-gray-200 text-gray-500'}`}>
                {artist.is_active ? 'Online' : 'Offline'}
              </span>
           </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* --- LEFT COL: Profile Settings --- */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 h-auto self-start">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
               <User className="text-[#ff4d94]" size={16} />
               <h2 className="font-bold text-sm text-slate-800">Profile Settings</h2>
            </div>
            
            <div className="p-4 space-y-3">
               {/* Display Name */}
               <div className="space-y-0.5">
                  <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Display Name</label>
                  <input 
                    name="display_name"
                    value={artist.display_name}
                    onChange={handleProfileChange}
                    className="w-full bg-gray-50 border border-gray-200 rounded px-3 py-1.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-pink-500/50 focus:border-pink-500 transition-all"
                  />
               </div>

               {/* Bio */}
               <div className="space-y-0.5">
                  <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Bio</label>
                  <textarea 
                    name="bio"
                    value={artist.bio}
                    onChange={handleProfileChange}
                    rows={3}
                    className="w-full bg-gray-50 border border-gray-200 rounded px-3 py-1.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-pink-500/50 focus:border-pink-500 transition-all resize-none leading-relaxed"
                  />
               </div>

               <div className="h-px bg-gray-100 my-0.5"></div>

               {/* Socials - Single Column Compact */}
               <div className="space-y-1">
                  <h3 className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-0.5">Social Links</h3>
                  <div className="flex flex-col gap-1">
                     {['x_url', 'ig_url', 'facebook_url', 'tiktok_url', 'email'].map((field) => (
                       <div key={field} className="relative group">
                          <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                             <span className="text-[9px] font-bold text-gray-400 uppercase w-16 truncate">
                                {field.replace('_url', '').replace('email', 'Email')}
                             </span>
                          </div>
                          <input 
                             name={field}
                             value={(artist as any)[field] || ''}
                             onChange={handleProfileChange}
                             placeholder={field === 'email' ? 'contact@email.com' : '...'}
                             className="w-full bg-white border border-gray-200 rounded pl-16 pr-2 py-1 text-xs font-medium text-slate-600 focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all"
                          />
                       </div>
                     ))}
                  </div>
               </div>

               <Button 
                 onClick={handleProfileSave} 
                 disabled={isSaving}
                 className="w-full mt-1 bg-[#ff4d94] hover:bg-[#e63e80] text-white font-bold h-9 text-xs rounded shadow-md shadow-pink-200 active:scale-95 transition-all"
               >
                 {isSaving ? 'Saving...' : 'Save Updates'}
               </Button>
            </div>
          </div>


          {/* --- RIGHT COL: Event Management --- */}
          <div className="lg:col-span-2 space-y-6">
             
             <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden min-h-[600px] flex flex-col">
                <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                   <div className="flex items-center gap-2">
                     <Calendar className="text-[#ff4d94]" size={20} />
                     <h2 className="font-bold text-lg text-slate-800">Event Management</h2>
                     <span className="bg-pink-100 text-pink-600 px-2 py-0.5 rounded-full text-xs font-bold">{events.length}</span>
                   </div>
                   <Button onClick={() => handleOpenModal()} className="bg-slate-900 text-white hover:bg-slate-800 rounded-lg text-xs font-bold px-4 h-9 shadow-sm flex items-center gap-2">
                      <Plus size={14} /> Add Event
                   </Button>
                </div>

                <div className="p-0 flex-1 overflow-x-auto">
                   {events.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-gray-300 py-20">
                         <Calendar size={48} className="mb-4 opacity-20" />
                         <p className="font-medium">No events scheduled.</p>
                      </div>
                   ) : (
                      <table className="w-full text-left border-collapse">
                         <thead>
                            <tr className="bg-gray-50/50 text-xs text-gray-400 uppercase tracking-wider border-b border-gray-100">
                               <th className="px-6 py-4 font-bold">Date</th>
                               <th className="px-6 py-4 font-bold">Event</th>
                               <th className="px-6 py-4 font-bold">Location</th>
                               <th className="px-6 py-4 font-bold text-right">Actions</th>
                            </tr>
                         </thead>
                         <tbody className="divide-y divide-gray-50">
                            {events.map((evt, idx) => (
                               <tr key={evt.id} className="hover:bg-pink-50/30 transition-colors group">
                                  <td className="px-6 py-4">
                                     <div className="flex flex-col">
                                        <span className="text-sm font-bold text-slate-800">
                                           {new Date(evt.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                        </span>
                                        <span className="text-[10px] text-gray-400 font-medium">
                                           {new Date(evt.start_date).getFullYear()}
                                        </span>
                                        {idx === 0 && <span className="text-[9px] font-bold text-[#ff4d94] mt-1 uppercase tracking-wider">Next Up</span>}
                                     </div>
                                  </td>
                                  <td className="px-6 py-4">
                                     <div className="font-bold text-slate-900 text-sm">{evt.event_name}</div>
                                     <div className="flex items-center gap-3 mt-1">
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${evt.status === 'Cancelled' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                                           {evt.status}
                                        </span>
                                        {evt.booth_number && (
                                           <span className="flex items-center gap-1 text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                                              <Store size={10} /> {evt.booth_number}
                                           </span>
                                        )}
                                        {evt.entrance_fee && (
                                           <span className="flex items-center gap-1 text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                                              <Ticket size={10} /> {evt.entrance_fee}
                                           </span>
                                        )}
                                     </div>
                                  </td>
                                  <td className="px-6 py-4 text-xs text-gray-500 font-medium">
                                     <div className="flex items-start gap-1.5">
                                        <MapPin size={12} className="shrink-0 mt-0.5 text-pink-400" />
                                        <span>
                                           {evt.location_name}
                                           {evt.location_detail && <span className="block text-gray-400 text-[10px]">{evt.location_detail}</span>}
                                        </span>
                                     </div>
                                  </td>
                                  <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button 
                                          onClick={() => handleOpenStats(evt)}
                                          className="text-gray-400 hover:text-pink-600 hover:bg-pink-50 p-1.5 rounded-md transition-colors"
                                          title="View Stats"
                                        >
                                           <BarChart2 size={16} />
                                        </button>
                                        <button 
                                          onClick={() => handleOpenModal(evt)}
                                          className="text-xs font-semibold text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-md transition-colors"
                                        >
                                           Edit
                                        </button>
                                        <button 
                                          onClick={() => handleEventDelete(evt.id)}
                                          className="text-gray-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-md transition-colors"
                                        >
                                           <Trash2 size={16} />
                                        </button>
                                      </div>
                                   </td>
                                </tr>
                            ))}
                         </tbody>
                      </table>
                   )}
                </div>
             </div>

          </div>
        </div>
        
      </div>
      
      {/* --- ADD/EDIT MODAL --- */}
      {isModalOpen && (
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
               <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                  <h3 className="font-bold text-lg text-slate-800">{isEditingEvent ? 'Edit Event' : 'New Event'}</h3>
                  <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                     <X size={20} />
                  </button>
               </div>
               
               <div className="p-6 overflow-y-auto space-y-4 text-sm">
                  <div className="flex items-center justify-between gap-4 bg-gray-50 p-3 rounded-lg border border-gray-100">
                     <div className="space-y-1 flex-1">
                        <label className="font-bold text-xs uppercase text-gray-400">Status</label>
                        <select name="status" value={currentEvent.status || 'Confirmed'} onChange={handleFunctionChange} className="w-full bg-white border border-gray-200 rounded-md p-2 text-sm font-semibold focus:border-pink-500 outline-none">
                           <option value="Confirmed">Confirmed</option>
                           <option value="Cancelled">Cancelled</option>
                        </select>
                     </div>
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-400">Event Name *</label>
                     <input name="event_name" value={currentEvent.event_name} onChange={handleFunctionChange} className="input-field w-full border border-gray-200 rounded-lg p-3 font-semibold focus:ring-pink-500 focus:border-pink-500 outline-none" placeholder="e.g. Cosplay Festival 2026" />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                     <div className="space-y-1">
                        <label className="font-bold text-xs uppercase text-gray-400">Start Date *</label>
                        <input type="datetime-local" name="start_date" value={currentEvent.start_date} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500" />
                     </div>
                     <div className="space-y-1">
                        <label className="font-bold text-xs uppercase text-gray-400">End Date *</label>
                        <input type="datetime-local" name="end_date" value={currentEvent.end_date} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500" />
                     </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                     <div className="space-y-1">
                        <label className="font-bold text-xs uppercase text-gray-400">Location Name</label>
                        <input name="location_name" value={currentEvent.location_name || ''} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500" placeholder="e.g. BITEC Bangna" />
                     </div>
                     <div className="space-y-1">
                        <label className="font-bold text-xs uppercase text-gray-400">Booth No.</label>
                        <input name="booth_number" value={currentEvent.booth_number || ''} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500" placeholder="e.g. A-12" />
                     </div>
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-400">Location Detail</label>
                     <input name="location_detail" value={currentEvent.location_detail || ''} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500" placeholder="e.g. Hall 98, Near Entrance 2" />
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-400">Entrance Fee</label>
                     <input name="entrance_fee" value={currentEvent.entrance_fee || ''} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500" placeholder="e.g. 300 THB / Free" />
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-400">Transit Info</label>
                     <textarea name="transit_info" rows={3} value={currentEvent.transit_info || ''} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500 resize-none" placeholder="BTS Bangna..." />
                  </div>
               </div>

               <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                  <Button variant="ghost" onClick={() => setIsModalOpen(false)} className="text-gray-500">Cancel</Button>
                  <Button onClick={handleEventSave} className="bg-pink-500 hover:bg-pink-600 text-white font-bold px-6 shadow-md shadow-pink-200">
                     {isSaving ? 'Saving...' : 'Save Event'}
                  </Button>
               </div>
            </div>
         </div>
      )}

      {/* --- STATS MODAL --- */}
      {isStatsModalOpen && (
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col">
               <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                  <div className="flex items-center gap-2">
                     <BarChart2 className="text-[#ff4d94]" size={20} />
                     <div>
                        <h3 className="font-bold text-lg text-slate-800">Performance Summary</h3>
                        <p className="text-xs text-gray-400 font-medium">{currentEvent.event_name}</p>
                     </div>
                  </div>
                  <button onClick={() => setIsStatsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                     <X size={20} />
                  </button>
               </div>
               
               <div className="p-8">
                  {loadingStats ? (
                     <div className="py-12 text-center text-gray-400 font-medium animate-pulse">Calculating metrics...</div>
                  ) : summaryStats ? (
                     <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {/* Total Tickets */}
                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 text-center">
                           <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Total Limit</div>
                           <div className="text-3xl font-black text-slate-800">{summaryStats.total}</div>
                           <div className="text-[10px] text-gray-400 mt-1">Tickets Issued</div>
                        </div>

                        {/* Served */}
                        <div className="bg-green-50 p-4 rounded-xl border border-green-100 text-center">
                           <div className="text-xs font-bold text-green-600 uppercase tracking-wider mb-1">Served</div>
                           <div className="text-3xl font-black text-green-700">{summaryStats.served}</div>
                           <div className="text-[10px] text-green-600/70 mt-1">
                              {summaryStats.total > 0 ? Math.round((summaryStats.served / summaryStats.total) * 100) : 0}% Rate
                           </div>
                        </div>

                        {/* Avg Wait */}
                        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 text-center">
                           <div className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">Avg Wait</div>
                           <div className="text-3xl font-black text-blue-700">{summaryStats.avgWait}<span className="text-sm font-bold text-blue-400 ml-1">m</span></div>
                           <div className="text-[10px] text-blue-600/70 mt-1">To Get Called</div>
                        </div>

                        {/* Avg Service */}
                        <div className="bg-purple-50 p-4 rounded-xl border border-purple-100 text-center">
                           <div className="text-xs font-bold text-purple-600 uppercase tracking-wider mb-1">Avg Service</div>
                           <div className="text-3xl font-black text-purple-700">{summaryStats.avgService}<span className="text-sm font-bold text-purple-400 ml-1">m</span></div>
                           <div className="text-[10px] text-purple-600/70 mt-1">At Counter</div>
                        </div>

                        {/* Missed / Cancelled Split */}
                         <div className="bg-red-50 p-4 rounded-xl border border-red-100 text-center col-span-2 mt-2 flex items-center justify-between px-6">
                           <div className="text-left">
                              <div className="text-red-700 font-bold text-sm">Cancelled</div>
                              <div className="text-red-400 text-[10px]">By User</div>
                           </div>
                           <div className="text-3xl font-black text-red-600">{summaryStats.cancelled}</div>
                        </div>

                         <div className="bg-gray-100 p-4 rounded-xl border border-gray-200 text-center col-span-2 mt-2 flex items-center justify-between px-6">
                           <div className="text-left">
                              <div className="text-gray-700 font-bold text-sm">Expired</div>
                              <div className="text-gray-400 text-[10px]">System Removal</div>
                           </div>
                           <div className="text-3xl font-black text-gray-600">{summaryStats.expired}</div>
                        </div>

                     </div>
                  ) : (
                     <div className="text-center text-gray-400">No data available.</div>
                  )}
               </div>

               <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
                  <Button onClick={() => setIsStatsModalOpen(false)} variant="ghost" className="text-gray-500 hover:text-gray-700">Close</Button>
               </div>
            </div>
         </div>
      )}

    </div>
  );
};

export default ManageArtist;
```

