import { useEffect, useMemo, useState } from 'react';
import { Outlet, useParams, useLocation, Link } from 'react-router-dom';
import { CalendarDays, ChevronDown, Compass, Home, MapPin, Search, ShoppingBag, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useArtist } from '../../hooks/useArtist';
import { useArtistRealtime } from '../../hooks/useArtistRealtime';
import CallingNotification from '../../components/CallingNotification';
import { LanguageToggle, useI18n } from '../../i18n';
import { supabase } from '../../supabaseClient';
import { customerEventStorageKey, getCurrentCustomerEvents, getStoredTicketId, isPostEventStoreOpen } from '../../utils/customerEvents';

const CustomerLayout = () => {
   const { t } = useI18n();
   const { slug } = useParams<{ slug: string }>();
   const location = useLocation();
   const { artist, loading, error } = useArtist(slug);
   const { artist: realtimeArtist, events, isConnected, refresh } = useArtistRealtime({
      artistId: artist?.id || '',
      initialArtist: artist
         ? {
            id: artist.id,
            display_name: artist.display_name || '',
            bio: artist.bio || '',
            image_url: (artist as any).image_url,
            broadcast_message: artist.broadcast_message,
            x_url: artist.x_url || null,
            facebook_url: artist.facebook_url || null,
            ig_url: artist.ig_url || null,
            tiktok_url: artist.tiktok_url || null,
            email: artist.email || null,
         }
         : undefined,
   });
   const displayArtist = artist && realtimeArtist ? { ...artist, ...realtimeArtist, slug: artist.slug } : artist;
   const [selectedEventId, setSelectedEventIdState] = useState<string | null>(null);
   const availableEvents = useMemo(() => getCurrentCustomerEvents(events), [events]);
   const selectedEvent = availableEvents.find((event) => event.id === selectedEventId) || availableEvents[0] || null;

   const setSelectedEventId = (eventId: string) => {
      if (!displayArtist?.id) return;
      setSelectedEventIdState(eventId);
      localStorage.setItem(customerEventStorageKey(displayArtist.id), eventId);
   };

   useEffect(() => {
      if (!displayArtist?.id || availableEvents.length === 0) {
         setSelectedEventIdState(null);
         return;
      }

      let isMounted = true;
      const eventIds = new Set(availableEvents.map((event) => event.id));
      const storageKey = customerEventStorageKey(displayArtist.id);
      const storedEventId = localStorage.getItem(storageKey);

      if (storedEventId && eventIds.has(storedEventId)) {
         setSelectedEventIdState(storedEventId);
         return;
      }

      const chooseInitialEvent = async () => {
         const localQueueId = getStoredTicketId(displayArtist.id);
         if (localQueueId) {
            const { data } = await supabase
               .from('queues')
               .select('event_id, status')
               .eq('id', localQueueId)
               .maybeSingle();
            if (
               isMounted &&
               data?.event_id &&
               eventIds.has(data.event_id) &&
               ['waiting', 'calling', 'serving'].includes(data.status)
            ) {
               setSelectedEventIdState(data.event_id);
               localStorage.setItem(storageKey, data.event_id);
               return;
            }
         }

         if (isMounted) {
            setSelectedEventIdState(availableEvents[0].id);
            localStorage.setItem(storageKey, availableEvents[0].id);
         }
      };

      void chooseInitialEvent();

      return () => {
         isMounted = false;
      };
   }, [displayArtist?.id, availableEvents.map((event) => event.id).join('|')]);

   if (loading) return <div className="min-h-screen flex items-center justify-center text-pink-500 font-bold">{t('loading')}</div>;
   if (error || !artist) return (
      <div className="min-h-screen bg-pink-50/40 px-5 py-8 font-sans">
         <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center">
            <div className="rounded-3xl border border-pink-100 bg-white p-7 text-center shadow-xl shadow-pink-100/60">
               <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-pink-50 text-pink-500">
                  <Search size={30} aria-hidden="true" />
               </div>
               <h1 className="text-2xl font-black tracking-tight text-gray-900">{t('customerArtistNotFound')}</h1>
               <p className="mt-3 text-sm font-semibold leading-6 text-gray-500">
                  {t('customerArtistNotFoundBody', { slug: slug || '' })}
               </p>
               <div className="mt-7 grid gap-3 sm:grid-cols-2">
                  <Link
                     to="/discover"
                     className="inline-flex items-center justify-center gap-2 rounded-xl bg-pink-500 px-4 py-3 text-sm font-black text-white shadow-lg shadow-pink-200 transition-colors hover:bg-pink-600"
                  >
                     <Compass size={17} aria-hidden="true" />
                     {t('customerArtistNotFoundDiscover')}
                  </Link>
                  <Link
                     to="/"
                     className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-black text-gray-700 transition-colors hover:bg-gray-50"
                  >
                     <Home size={17} aria-hidden="true" />
                     {t('customerArtistNotFoundHome')}
                  </Link>
               </div>
            </div>
         </div>
      </div>
   );

   return (
      <div className="min-h-screen bg-gray-50 pb-20 font-sans lg:pb-0">
         {/* Mobile keeps the phone shell; desktop opens into a full workspace-like canvas. */}
         <div className="relative mx-auto min-h-screen max-w-md overflow-hidden bg-white shadow-xl lg:max-w-none lg:overflow-visible lg:bg-transparent lg:shadow-none">
            {availableEvents.length === 0 && (
               <div className="fixed right-3 top-3 z-[120]">
                  <LanguageToggle className="min-h-11 min-w-11 px-3 py-2 text-[11px]" />
               </div>
            )}

            {displayArtist && (
               <CallingNotification
                  artistId={displayArtist.id}
                  slug={displayArtist.slug}
                  broadcastMessage={displayArtist.broadcast_message}
               />
            )}

            {availableEvents.length > 0 && (
               <div className="sticky top-0 z-[45] border-b border-gray-100 bg-white/90 px-3 py-2 backdrop-blur-xl lg:px-6">
                  <div className="mx-auto flex max-w-md items-center gap-2 lg:max-w-6xl">
                     <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-pink-700 text-white shadow-sm shadow-pink-100">
                        <CalendarDays size={17} aria-hidden="true" />
                     </div>
                     <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                           <span className={`text-[11px] font-black uppercase tracking-[0.16em] ${selectedEvent && isPostEventStoreOpen(selectedEvent) ? 'text-violet-700' : 'text-gray-600'}`}>
                              {selectedEvent && isPostEventStoreOpen(selectedEvent) ? t('customerPostEventStore') : t('customerSelectedEvent')}
                           </span>
                           <span className={`h-1.5 w-1.5 rounded-full ${selectedEvent?.is_booth_open ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                           <span className={`text-[11px] font-black uppercase tracking-[0.12em] ${selectedEvent?.is_booth_open ? 'text-emerald-700' : 'text-gray-600'}`}>
                              {selectedEvent?.is_booth_open ? t('customerBoothOpen') : t('customerBoothClosed')}
                           </span>
                        </div>
                        {availableEvents.length === 1 ? (
                           <div className="mt-0.5 truncate text-sm font-black leading-5 text-gray-900">{selectedEvent?.event_name}</div>
                        ) : (
                           <div className="relative">
                              <select
                                 value={selectedEvent?.id || ''}
                                 onChange={(event) => setSelectedEventId(event.target.value)}
                                 className="mt-0.5 min-h-11 w-full appearance-none bg-transparent pr-7 text-sm font-black leading-5 text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-pink-300"
                                 aria-label={t('customerSelectedEvent')}
                              >
                                 {availableEvents.map((event) => (
                                    <option key={event.id} value={event.id}>
                                       {event.event_name}{isPostEventStoreOpen(event) ? ` — ${t('customerPostEventStore')}` : ''}
                                    </option>
                                 ))}
                              </select>
                              <ChevronDown className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-pink-400" size={16} />
                           </div>
                        )}
                        {selectedEvent && (
                           <div className="flex min-w-0 items-center gap-1 text-[11px] font-bold text-gray-600">
                              <MapPin size={11} className="shrink-0 text-pink-400" aria-hidden="true" />
                              <span className="truncate">{[selectedEvent.location, selectedEvent.booth_detail].filter(Boolean).join(' · ') || t('customerBoothOpen')}</span>
                           </div>
                        )}
                     </div>
                     <nav className="hidden shrink-0 items-center gap-1 lg:flex" aria-label="Main navigation">
                        {[
                           { to: `/${slug}/home`, label: t('customerNavHome'), Icon: Home, match: '/home' },
                           { to: `/${slug}/menu`, label: t('customerNavMerch'), Icon: ShoppingBag, match: '/menu' },
                           { to: `/${slug}/queue`, label: t('customerNavQueue'), Icon: Users, match: '/queue' },
                        ].map(({ to, label, Icon, match }) => (
                           <Link
                              key={to}
                              to={to}
                              aria-current={location.pathname.endsWith(match) ? 'page' : undefined}
                              className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-black transition-colors ${
                                 location.pathname.endsWith(match)
                                     ? 'bg-pink-600 text-white shadow-sm'
                                    : 'text-pink-900 hover:bg-pink-50 hover:text-pink-800'
                              }`}
                           >
                              <Icon size={15} aria-hidden="true" /> {label}
                           </Link>
                        ))}
                     </nav>
                     <LanguageToggle className="min-h-11 min-w-11 shrink-0 px-3 py-2 text-[11px]" />
                  </div>
               </div>
            )}

            <AnimatePresence mode="wait">
               <motion.div
                  key={location.pathname}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
               >
                  <Outlet
                     context={{
                        artist: displayArtist,
                        realtimeArtist,
                        events,
                        isConnected,
                        refresh,
                        selectedEvent,
                        availableEvents,
                        setSelectedEventId,
                     }}
                  />
               </motion.div>
            </AnimatePresence>

            {/* Bottom Nav for Mobile */}
            <nav className="fixed bottom-0 z-50 flex h-20 w-full max-w-md justify-around border-t border-gray-100 bg-white/90 pb-5 text-[11px] font-bold tracking-tight backdrop-blur-md lg:hidden" aria-label="Main navigation">
               <motion.div className="h-full flex-1" whileTap={{ scale: 0.94 }}>
                  <Link
                     to={`/${slug}/home`}
                     className={`flex h-full min-h-14 flex-col items-center justify-center gap-1 transition-colors ${location.pathname.endsWith('/home') ? 'text-pink-700' : 'text-slate-600'}`}
                     aria-label={t('customerNavHome')}
                  >
                     <Home size={22} strokeWidth={location.pathname.endsWith('/home') ? 2.5 : 2} aria-hidden="true" />
                     {t('customerNavHome')}
                  </Link>
               </motion.div>

               <motion.div className="h-full flex-1" whileTap={{ scale: 0.94 }}>
                  <Link
                     to={`/${slug}/menu`}
                     className={`flex h-full min-h-14 flex-col items-center justify-center gap-1 transition-colors ${location.pathname.endsWith('/menu') ? 'text-pink-700' : 'text-slate-600'}`}
                     aria-label={t('customerNavMerch')}
                  >
                     <ShoppingBag size={22} strokeWidth={location.pathname.endsWith('/menu') ? 2.5 : 2} aria-hidden="true" />
                     {t('customerNavMerch')}
                  </Link>
               </motion.div>

               <motion.div className="h-full flex-1" whileTap={{ scale: 0.94 }}>
                  <Link
                     to={`/${slug}/queue`}
                     className={`flex h-full min-h-14 flex-col items-center justify-center gap-1 transition-colors ${location.pathname.endsWith('/queue') ? 'text-pink-700' : 'text-slate-600'}`}
                     aria-label={t('customerNavQueue')}
                  >
                     <Users size={22} strokeWidth={location.pathname.endsWith('/queue') ? 2.5 : 2} aria-hidden="true" />
                     {t('customerNavQueue')}
                  </Link>
               </motion.div>

               <motion.div className="h-full flex-1" whileTap={{ scale: 0.94 }}>
                  <Link
                     to="/discover"
                     className={`flex h-full min-h-14 flex-col items-center justify-center gap-1 transition-colors ${location.pathname.startsWith('/discover') ? 'text-pink-700' : 'text-slate-600'}`}
                     aria-label={t('customerNavDiscover')}
                  >
                     <Compass size={22} strokeWidth={location.pathname.startsWith('/discover') ? 2.5 : 2} aria-hidden="true" />
                     {t('customerNavDiscover')}
                  </Link>
               </motion.div>
            </nav>
         </div>
      </div>
   );
};

export default CustomerLayout;
