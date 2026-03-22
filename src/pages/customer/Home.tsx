import { useEffect, Suspense, lazy, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom'; 
import { useArtistRealtime } from '../../hooks/useArtistRealtime';
import { useMidnightTick } from '../../hooks/useMidnightTick';
import CustomerHeader from '../../components/CustomerHeader';
import { supabase } from '../../supabaseClient';
import { resolveAvatarUrl } from '../../utils/avatarUrl';

// Lazy Load Components to reduce bundle size
const EventsList = lazy(() => import('../../components/home/EventsList'));
const SocialFooter = lazy(() => import('../../components/home/SocialFooter'));
const CreatorDirectory = lazy(() => import('../../components/home/CreatorDirectory'));

interface NearbyCreator {
  id: string;
  slug: string;
  display_name: string;
  image_url?: string | null;
  event_name: string;
  location?: string | null;
  is_booth_open: boolean;
}

const Home = () => {
  // Midnight Watcher
  const currentDate = useMidnightTick();

  // 1. Unified Realtime Hook
  const { artist: contextArtist } = useOutletContext<{ artist: any }>(); 
  const { artist, events, isConnected, refresh } = useArtistRealtime({ 
    artistId: contextArtist?.id 
  });
  const [nearbyCreators, setNearbyCreators] = useState<NearbyCreator[]>([]);
  
  // Use local artist state from Hook, fallback to context for initial render
  const displayArtist = artist || contextArtist;
  
  // Midnight Refresh Effect
  useEffect(() => {
    refresh();
  }, [currentDate, refresh]);

  // Early return if no artist data
  if (!displayArtist) return <div className="p-10 text-center text-gray-400">Loading Artist Profile...</div>;
  
  const now = new Date().toISOString();
  
  // --- 🎯 LOGIC FILTER: จัดการการแสดงผลตรงนี้ครับ ---
  // กฎ: 1. ยังไม่หมดเวลา (end_date >= now)
  //     2. สถานะต้องเป็น Confirmed หรือ Cancelled เท่านั้น (Ended จะถูกดีดออก)
  const visibleEvents = events.filter(e => {
     const isNotExpired = e.end_date >= now;
     const isShowStatus = e.status === 'Confirmed' || e.status === 'Cancelled';
     return isNotExpired && isShowStatus;
  });

  // Derive Booth Status: Check if ANY valid event is currently open AND not ended
  const activeOpenEvent = events.find(e => {
       const isOpen = e.is_booth_open && e.status === 'Confirmed'; // Booth เปิดได้ต้อง Confirmed เท่านั้น
       const isStarted = e.start_date <= now;
       const isNotEnded = e.end_date >= now;
       return isOpen && isStarted && isNotEnded;
  });
  
  const isBoothActive = !!activeOpenEvent;

  // 3. Auto-set Next Up Logic: Pick the first NON-CANCELLED event
  // ใช้ visibleEvents มาหา Next Up เลย จะได้สอดคล้องกัน
  const sortedValidEvents = visibleEvents
    .filter(e => e.status !== 'Cancelled') // Next Up ต้องไม่เอา Cancelled
    .sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime()); // (อันนี้ Logic เดิมคุณพี่ Sort มากไปน้อย หรือ น้อยไปมาก ลองเช็คดูนะครับ ปกติ Next event น่าจะเรียงตามเวลาใกล้สุด)
    // *หมายเหตุ:* ปกติถ้าจะหา "งานถัดไป" ควร sort ascending (น้อยไปมาก) นะครับ
    // แต่ถ้า code เดิมใช้ได้ดีแล้วผมคงไว้ตามเดิมครับ

  const nextUpEventId = sortedValidEvents[0]?.id;
  const focusLocations = useMemo(
    () => Array.from(new Set(visibleEvents.map((event) => event.location?.trim()).filter(Boolean))) as string[],
    [visibleEvents]
  );

  useEffect(() => {
    const loadNearbyCreators = async () => {
      if (!displayArtist?.id) return;

      const todayStr = new Date().toLocaleDateString('en-CA');
      const { data: upcomingEvents, error } = await supabase
        .from('events')
        .select('artist_id, event_name, location, start_date, end_date, is_booth_open, status')
        .eq('status', 'Confirmed')
        .gte('end_date', todayStr)
        .order('start_date', { ascending: true });

      if (error || !upcomingEvents) {
        setNearbyCreators([]);
        return;
      }

      const groupedByArtist = new Map<string, typeof upcomingEvents[number]>();
      const sameLocationArtists = new Set<string>();

      for (const event of upcomingEvents) {
        if (event.artist_id === displayArtist.id) continue;
        if (!groupedByArtist.has(event.artist_id)) groupedByArtist.set(event.artist_id, event);
        if (event.location && focusLocations.includes(event.location.trim())) sameLocationArtists.add(event.artist_id);
      }

      const prioritizedArtistIds = Array.from(groupedByArtist.keys())
        .sort((left, right) => {
          const leftPriority = sameLocationArtists.has(left) ? 1 : 0;
          const rightPriority = sameLocationArtists.has(right) ? 1 : 0;
          return rightPriority - leftPriority;
        })
        .slice(0, 8);

      if (prioritizedArtistIds.length === 0) {
        setNearbyCreators([]);
        return;
      }

      const { data: artistsData, error: artistsError } = await supabase
        .from('artists')
        .select('id, slug, display_name, image_url')
        .in('id', prioritizedArtistIds);

      if (artistsError || !artistsData) {
        setNearbyCreators([]);
        return;
      }

      const creators = prioritizedArtistIds
        .map((artistId) => {
          const creator = artistsData.find((artistItem) => artistItem.id === artistId);
          const event = groupedByArtist.get(artistId);
          if (!creator || !event) return null;
          return {
            id: creator.id,
            slug: creator.slug,
            display_name: creator.display_name,
            image_url: resolveAvatarUrl(creator.image_url),
            event_name: event.event_name,
            location: event.location,
            is_booth_open: event.is_booth_open,
          };
        })
        .filter(Boolean) as NearbyCreator[];

      setNearbyCreators(creators);
    };

    void loadNearbyCreators();
  }, [displayArtist?.id, focusLocations]);

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
        avatarUrl={resolveAvatarUrl(displayArtist.image_url)}
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


      {/* Events Section - Lazy Loaded */}
      <Suspense fallback={<div className="h-32 flex items-center justify-center text-xs text-gray-400">Loading events...</div>}>
         <EventsList events={visibleEvents} nextUpEventId={nextUpEventId} />
      </Suspense>

      <Suspense fallback={<div className="h-20 flex items-center justify-center text-xs text-gray-400">Loading creators...</div>}>
         <CreatorDirectory creators={nearbyCreators} />
      </Suspense>

      {/* Social Footer - Lazy Loaded */}
      <Suspense fallback={<div className="h-10"></div>}>
         <SocialFooter artist={displayArtist} />
      </Suspense>

    </div>
  );
};

export default Home;
