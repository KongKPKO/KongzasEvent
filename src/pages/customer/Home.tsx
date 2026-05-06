import { useEffect, Suspense, lazy, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { ShoppingBag, Users } from 'lucide-react';
import { useMidnightTick } from '../../hooks/useMidnightTick';
import CustomerHeader from '../../components/CustomerHeader';
import { supabase } from '../../supabaseClient';
import { resolveAvatarUrl } from '../../utils/avatarUrl';
import { useI18n } from '../../i18n';
import type { CustomerOutletContext } from '../../types/customerContext';

// Lazy Load Components to reduce bundle size
const EventsList = lazy(() => import('../../components/home/EventsList'));
const SocialFooter = lazy(() => import('../../components/home/SocialFooter'));
const CreatorDirectory = lazy(() => import('../../components/home/CreatorDirectory'));

interface NearbyCreatorEventRecord {
  artist_id: string;
  event_name: string;
  location?: string | null;
  booth_detail?: string | null;
  location_name?: string | null;
  location_detail?: string | null;
  booth_number?: string | null;
  start_date: string;
  end_date: string;
  is_booth_open: boolean;
  status: string;
}

interface NearbyCreator {
  id: string;
  slug: string;
  display_name: string;
  bio?: string | null;
  image_url?: string | null;
  event_name: string;
  location?: string | null;
  booth_detail?: string | null;
  is_booth_open: boolean;
}

const normalizeEventLocation = (event?: NearbyCreatorEventRecord | null) => {
  if (!event) return null;
  if (event.location && event.location.trim().length > 0) return event.location;
  return [event.location_name, event.location_detail]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(', ') || null;
};

const normalizeEventBooth = (event?: NearbyCreatorEventRecord | null) => {
  if (!event) return null;
  if (event.booth_detail && event.booth_detail.trim().length > 0) return event.booth_detail;
  return event.booth_number || null;
};

const Home = () => {
  const { t } = useI18n();
  // Midnight Watcher
  const currentDate = useMidnightTick();

  // 1. Shared realtime customer context from CustomerLayout.
  const {
    artist: contextArtist,
    events,
    isConnected,
    refresh,
    selectedEvent,
  } = useOutletContext<CustomerOutletContext>();
  const [nearbyCreators, setNearbyCreators] = useState<NearbyCreator[]>([]);
  
  const displayArtist = contextArtist;
  
  // Midnight Refresh Effect
  useEffect(() => {
    refresh();
  }, [currentDate, refresh]);

  // Early return if no artist data
  if (!displayArtist) return <div className="p-10 text-center text-gray-400">{t('customerLoadingArtist')}</div>;
  
  const now = new Date().toISOString();
  
  // Show only non-expired events that should remain visible to customers.
  const visibleEvents = events.filter(e => {
     const isNotExpired = e.end_date >= now;
     const isShowStatus = e.status === 'Confirmed' || e.status === 'Cancelled';
     return isNotExpired && isShowStatus;
  });

  // Derive Booth Status: Check if ANY valid event is currently open AND not ended
  const activeOpenEvent = events.find(e => {
       const isOpen = e.is_booth_open && e.status === 'Confirmed';
       const isStarted = e.start_date <= now;
       const isNotEnded = e.end_date >= now;
       return isOpen && isStarted && isNotEnded;
  });
  
  const isBoothActive = !!activeOpenEvent;

  // Pick the first non-cancelled event from the visible list.
  const sortedValidEvents = visibleEvents
    .filter(e => e.status !== 'Cancelled')
    .sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());

  const nextUpEventId = selectedEvent?.id || sortedValidEvents[0]?.id;
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
        .select('*')
        .in('status', ['Confirmed', 'confirmed'])
        .gte('end_date', todayStr)
        .order('start_date', { ascending: true });

      if (error || !upcomingEvents) {
        setNearbyCreators([]);
        return;
      }

      const groupedByArtist = new Map<string, NearbyCreatorEventRecord>();
      const sameLocationArtists = new Set<string>();

      for (const event of upcomingEvents as NearbyCreatorEventRecord[]) {
        if (event.artist_id === displayArtist.id) continue;
        if (!groupedByArtist.has(event.artist_id)) groupedByArtist.set(event.artist_id, event);
        const eventLocation = normalizeEventLocation(event);
        if (eventLocation && focusLocations.includes(eventLocation.trim())) sameLocationArtists.add(event.artist_id);
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
        .select('id, slug, display_name, bio, image_url')
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
            bio: creator.bio,
            image_url: resolveAvatarUrl(creator.image_url),
            event_name: event.event_name,
            location: normalizeEventLocation(event),
            booth_detail: normalizeEventBooth(event),
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
            {t('customerOffline')}
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
                  {t('customerBoothOpen')}
              </span>
            </div>
          ) : (
            <div className="inline-flex items-center px-2.5 py-0.5 bg-red-50 border border-red-100 rounded-full animate-fade-in">
               <div className="w-1.5 h-1.5 rounded-full bg-red-500 mr-1.5 shadow-[0_0_8px_rgba(239,68,68,0.4)]"></div>
               <span className="text-red-700 text-[9px] font-bold uppercase tracking-wider">{t('customerBoothClosed')}</span>
            </div>
          )}
        </div>

        <div className="mx-auto mt-4 grid max-w-[320px] grid-cols-2 gap-2">
          <Link
            to={`/${displayArtist.slug}/menu`}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-pink-600 px-4 text-sm font-black text-white shadow-lg shadow-pink-100 transition active:scale-95"
          >
            <ShoppingBag size={17} aria-hidden="true" />
            {t('customerNavMerch')}
          </Link>
          <Link
            to={`/${displayArtist.slug}/queue`}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-pink-200 bg-white px-4 text-sm font-black text-pink-700 shadow-sm transition active:scale-95"
          >
            <Users size={17} aria-hidden="true" />
            {t('customerNavQueue')}
          </Link>
        </div>
      </CustomerHeader>


      {/* Events Section - Lazy Loaded */}
      <Suspense fallback={<div className="h-32 flex items-center justify-center text-xs text-gray-400">{t('homeLoadingCreators')}</div>}>
         <EventsList events={visibleEvents} nextUpEventId={nextUpEventId} />
      </Suspense>

      <Suspense fallback={<div className="h-20 flex items-center justify-center text-xs text-gray-400">{t('homeLoadingCreators')}</div>}>
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
