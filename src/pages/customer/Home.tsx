import { useEffect, Suspense, lazy, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { ShoppingBag, Users } from 'lucide-react';
import { useMidnightTick } from '../../hooks/useMidnightTick';
import OnlineShopSection from '../../components/home/OnlineShopSection';
import StorefrontHeader from '../../components/menu/StorefrontHeader';
import { supabase } from '../../supabaseClient';
import { resolveAvatarUrl } from '../../utils/avatarUrl';
import { uiText, useI18n } from '../../i18n';
import type { CustomerOutletContext } from '../../types/customerContext';
import type { EventAppearance } from '../../types/eventAppearance';
import type { RealtimeEvent } from '../../hooks/useArtistRealtime';
import { getEventSalesPhase, getStoredTicketId } from '../../utils/customerEvents';

// Lazy Load Components to reduce bundle size
const EventsList = lazy(() => import('../../components/home/EventsList'));
const SocialFooter = lazy(() => import('../../components/home/SocialFooter'));

const getVisibleHomeEvents = (events: RealtimeEvent[], nowIso = new Date().toISOString()) => events.filter((event) => {
  const isUpcomingOrLive = event.end_date >= nowIso && (event.status === 'Confirmed' || event.status === 'Cancelled');
  const isOpenPostOrder = getEventSalesPhase(event, nowIso) === 'post_event';
  return isUpcomingOrLive || isOpenPostOrder;
});

const Home = () => {
  const { t, language } = useI18n();
  // Midnight Watcher
  const currentDate = useMidnightTick();

  // 1. Shared realtime customer context from CustomerLayout.
  const {
    artist: contextArtist,
    events,
    selectedEvent,
    isConnected,
    refresh,
    setSelectedEventId,
  } = useOutletContext<CustomerOutletContext>();
  const [eventAppearances, setEventAppearances] = useState<EventAppearance[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  
  const displayArtist = contextArtist;
  
  // Midnight Refresh Effect
  useEffect(() => {
    refresh();
  }, [currentDate, refresh]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => window.clearInterval(intervalId);
  }, []);

  const now = new Date(nowMs).toISOString();
  
  // Upcoming events stay discoverable; ended events remain visible only while
  // their event-scoped post-order window is open.
  const visibleEvents = getVisibleHomeEvents(events, now);

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
    .filter(e => e.status !== 'Cancelled' && e.end_date >= now)
    .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());

  const nextUpEventId = sortedValidEvents[0]?.id;
  const visibleEventIdsKey = visibleEvents.map((event) => event.id).join(',');

  useEffect(() => {
    let cancelled = false;
    setEventAppearances([]);
    const loadEventAppearances = async () => {
      const visibleEventIds = visibleEventIdsKey ? visibleEventIdsKey.split(',') : [];
      if (!displayArtist?.id || visibleEventIds.length === 0) {
        setEventAppearances([]);
        return;
      }

      const { data, error } = await supabase
        .from('event_appearances')
        .select('id, artist_id, event_id, character_name, series_name, image_url, appearance_date, day_label, start_time, end_time, note, booth, zone, is_public, sort_order, created_at')
        .eq('artist_id', displayArtist.id)
        .eq('is_public', true)
        .in('event_id', visibleEventIds)
        .order('appearance_date', { ascending: true })
        .order('sort_order', { ascending: true });

      if (cancelled) return;
      if (error) {
        console.error('[Home] event appearance load failed:', error);
        setEventAppearances([]);
        return;
      }
      setEventAppearances((data || []) as EventAppearance[]);
    };

    void loadEventAppearances();
    return () => { cancelled = true; };
  }, [displayArtist?.id, visibleEventIdsKey]);

  // Early return after hooks so React receives the same hook order every render.
  if (!displayArtist) return <div className="p-10 text-center text-gray-400">{t('customerLoadingArtist')}</div>;

  return (
    <main className="creator-home min-h-screen w-full max-w-6xl mx-auto flex flex-col pb-24 relative">
      
      {/* Offline Indicator */}
      {!isConnected && (
         <div className="bg-red-500 text-white text-[10px] uppercase font-bold text-center py-1 tracking-widest sticky top-0 z-[60]">
            {t('customerOffline')}
         </div>
      )}

      <StorefrontHeader name={displayArtist.display_name || uiText(language, 'Shop')} bio={displayArtist.bio} avatar={resolveAvatarUrl(displayArtist.image_url)} sellerType={displayArtist.seller_type} homeHref={`/${displayArtist.slug}/home`}>
        {/* Status Badge */}
        <div className="flex justify-center mb-1">
          {isBoothActive ? (
            <div className="inline-flex items-center px-2.5 py-0.5 bg-green-50 border border-green-100 rounded-full animate-fade-in">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
              <span className="text-green-700 text-xs font-bold uppercase tracking-wider">
                  {t('customerBoothOpen')}
              </span>
            </div>
          ) : (
            <div className="inline-flex items-center px-2.5 py-0.5 bg-red-50 border border-red-100 rounded-full animate-fade-in">
               <div className="w-1.5 h-1.5 rounded-full bg-red-500 mr-1.5 shadow-[0_0_8px_rgba(239,68,68,0.4)]"></div>
               <span className="text-red-700 text-xs font-bold uppercase tracking-wider">{t('customerBoothClosed')}</span>
            </div>
          )}
        </div>

        <div className={`mt-3 grid w-full gap-3 ${selectedEvent?.queue_enabled !== false || getStoredTicketId(displayArtist?.id) ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <Link
            to={`/${displayArtist.slug}/menu`}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-pink-600 px-4 text-sm font-black text-white shadow-lg shadow-pink-100 transition active:scale-95"
          >
            <ShoppingBag size={17} aria-hidden="true" />
            {t('customerNavMerch')}
          </Link>
          {(selectedEvent?.queue_enabled !== false || Boolean(getStoredTicketId(displayArtist?.id))) && <Link
            to={`/${displayArtist.slug}/queue`}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-pink-200 bg-white px-4 text-sm font-black text-pink-700 shadow-sm transition active:scale-95"
          >
            <Users size={17} aria-hidden="true" />
            {t('customerNavQueue')}
          </Link>}
        </div>
        {selectedEvent?.queue_enabled === false && <p className="mt-3 text-center text-sm text-slate-600">{language === 'th' ? 'อีเวนต์นี้ไม่ใช้คิวออนไลน์ เลือกชมสินค้าและซื้อได้ที่หน้าบูธ' : 'This event does not use online queues. Browse products and purchase at the booth.'}</p>}
      </StorefrontHeader>


      <OnlineShopSection key={displayArtist.slug} artistSlug={displayArtist.slug} />

      {/* Events Section - Lazy Loaded */}
      <Suspense fallback={<div className="h-32 flex items-center justify-center text-xs text-gray-400">{t('homeLoadingCreators')}</div>}>
         <EventsList
           events={visibleEvents}
           artistSlug={displayArtist.slug}
           onSelectEvent={setSelectedEventId}
           nextUpEventId={nextUpEventId}
           appearances={eventAppearances}
           nowIso={now}
         />
      </Suspense>

      {/* Social Footer - Lazy Loaded */}
      <Suspense fallback={<div className="h-10"></div>}>
         <SocialFooter artist={displayArtist} />
      </Suspense>


    </main>
  );
};

export default Home;
