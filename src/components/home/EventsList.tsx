
import { MapPin, Ticket, Train, Calendar } from 'lucide-react';
import { Card } from '../ui';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { uiText, useI18n } from '../../i18n';
import type { RealtimeEvent } from '../../hooks/useArtistRealtime';
import type { EventAppearance } from '../../types/eventAppearance';
import { getEventSalesPhase } from '../../utils/customerEvents';
import EventAppearancePreview from './EventAppearancePreview';

interface EventsListProps {
  events: RealtimeEvent[];
  artistSlug: string;
  onSelectEvent: (eventId: string) => void;
  nextUpEventId?: string;
  appearances?: EventAppearance[];
  nowIso?: string;
}

const EventsList = ({ events, artistSlug, onSelectEvent, nextUpEventId, appearances = [], nowIso }: EventsListProps) => {
  const { t, language, dateLocale } = useI18n();

  const getBoxDate = (dateString: string) => {
    const date = new Date(dateString);
    return {
      month: date.toLocaleDateString(dateLocale, { month: 'short' }).toUpperCase(),
      day: date.getDate().toString().padStart(2, '0')
    };
  };

  const formatDateRange = (start: string, end: string) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };

    if (startDate.toDateString() === endDate.toDateString()) {
      return `${startDate.toLocaleDateString(dateLocale, options)}, ${startDate.getFullYear()}`;
    }

    return `${startDate.toLocaleDateString(dateLocale, options)} - ${endDate.toLocaleDateString(dateLocale, options)}, ${endDate.getFullYear()}`;
  };

  return (
    <div className="px-4 mt-2 lg:px-6">
      <h2 className="font-bold text-gray-900 text-xl mb-4 flex items-center gap-2 px-1">{t('eventsNext')}</h2>
      <motion.div
        className="grid gap-4 mb-6 md:grid-cols-2"
        initial="hidden"
        animate="visible"
        variants={{
          hidden: { opacity: 0 },
          visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
        }}
      >
        {events.length === 0 ? (
          <div className="col-span-full text-center py-8 text-gray-600 text-sm font-medium">{t('eventsEmpty')}</div>
        ) : (
          events.map((event) => {
            const { month, day } = getBoxDate(event.start_date);
            const isNextUp = event.id === nextUpEventId;
            const isCancelled = event.status === 'Cancelled';
            const salesPhase = getEventSalesPhase(event, nowIso);
            const orderPhaseLabel = salesPhase === 'preorder'
              ? uiText(language, 'Pre-order open')
              : salesPhase === 'post_event'
                ? uiText(language, 'Post-order open')
                : null;
            const canBrowseEventProducts = !isCancelled && salesPhase !== 'closed';

            const eventCard = (
              <Card
                className={`border-none shadow-sm p-4 rounded-3xl relative overflow-hidden ring-1 ring-gray-100 transition-all duration-300
                    ${isCancelled
                    ? 'bg-gray-50 opacity-100 grayscale-[0.8] ring-gray-200'
                    : isNextUp
                      ? 'bg-white shadow-md'
                      : 'bg-gray-50/50 opacity-90 grayscale-[0.3]'
                  }
                  ${(isNextUp || orderPhaseLabel) && !isCancelled ? 'pt-10' : ''}
                  ${canBrowseEventProducts ? 'group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-pink-500' : ''}`}
              >
                {/* Cancelled Overlay */}
                {isCancelled && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                    <div className="border-[2px] border-red-500 text-red-500 text-xl font-black uppercase tracking-widest -rotate-12 px-4 py-2 rounded-lg bg-white/10 backdrop-blur-[1px]">
                      {t('eventsCancelled')}
                    </div>
                  </div>
                )}

                {!isCancelled && (isNextUp || orderPhaseLabel) && (
                  <div className="absolute right-0 top-0 z-10 flex flex-wrap justify-end gap-1 pl-4">
                    {orderPhaseLabel && (
                      <span className={`rounded-bl-2xl px-3 py-1 text-xs font-bold text-white ${salesPhase === 'post_event' ? 'bg-violet-700' : 'bg-pink-600'}`}>
                        {orderPhaseLabel}
                      </span>
                    )}
                    {isNextUp && (
                      <span className="rounded-bl-2xl bg-pink-700 px-3 py-1 text-xs font-bold text-white">
                        {t('eventsNextUp')}
                      </span>
                    )}
                  </div>
                )}

                <div className={`flex items-start gap-4 ${isCancelled ? 'opacity-50' : ''}`}>
                  <div className={`w-14 h-14 rounded-2xl flex flex-col items-center justify-center border shrink-0
                      ${!isCancelled ? 'bg-pink-50 border-pink-100' : 'bg-white border-gray-100'}`}>
                    <span className={`text-xs font-bold uppercase ${!isCancelled ? 'text-pink-700' : 'text-gray-400'}`}>{month}</span>
                    <span className="text-2xl font-black text-gray-900 leading-none">{day}</span>
                  </div>

                  <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                    <h3 className="break-words font-bold text-gray-900 text-lg leading-tight">{event.event_name}</h3>
                    <div className="space-y-1.5 text-gray-600 text-sm font-medium">
                      {event.location && (
                        <div className="flex items-start gap-2">
                          <MapPin size={14} className={isCancelled ? 'text-gray-400' : 'text-pink-700'} />
                          <span>{event.location}</span>
                        </div>
                      )}
                      {event.booth_detail && (
                        <div className="flex items-start gap-2">
                          <MapPin size={14} className={isCancelled ? 'text-gray-400' : 'text-pink-700'} />
                          <span>{t('eventsBooth')} {event.booth_detail}</span>
                        </div>
                      )}

                      {event.entrance_fee && <div className="flex items-center gap-2"><Ticket size={14} className={isCancelled ? 'text-gray-400' : 'text-pink-700'} /><span>{event.entrance_fee}</span></div>}
                      {event.transit_info && <div className="flex items-start gap-2"><Train size={14} className={isCancelled ? 'text-gray-400' : 'text-pink-700'} /><div className="whitespace-pre-line">{event.transit_info}</div></div>}
                      <div className="flex items-center gap-2"><Calendar size={14} className={isCancelled ? 'text-gray-400' : 'text-pink-700'} /><span>{formatDateRange(event.start_date, event.end_date)}</span></div>
                    </div>
                  </div>
                </div>
                {!isCancelled && (
                  <EventAppearancePreview appearances={appearances.filter((appearance) => appearance.event_id === event.id)} />
                )}
              </Card>
            );

            return (
              <motion.div
                key={event.id}
                variants={{
                  hidden: { opacity: 0, x: -20 },
                  visible: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } }
                }}
              >
                {canBrowseEventProducts ? (
                  <Link
                    to={`/${artistSlug}/menu`}
                    onClick={() => onSelectEvent(event.id)}
                    className="group block rounded-3xl focus-visible:outline-none"
                    aria-label={`${t('customerNavMerch')}: ${event.event_name}${orderPhaseLabel ? ` — ${orderPhaseLabel}` : ''}`}
                  >
                    {eventCard}
                  </Link>
                ) : eventCard}
              </motion.div>
            );
          })
        )}
      </motion.div>
    </div>
  );
};

export default EventsList;
