
import { MapPin, Ticket, Train, Calendar } from 'lucide-react';
import { Card } from '../ui';
import { motion } from 'framer-motion';
import { useI18n } from '../../i18n';

interface Event {
  id: string;
  event_name: string;
  start_date: string;
  end_date: string;
  location?: string | null;
  booth_detail?: string | null;
  entrance_fee?: string;
  transit_info?: string;
  status: string;
}

interface EventsListProps {
  events: Event[];
  nextUpEventId?: string;
}

const EventsList = ({ events, nextUpEventId }: EventsListProps) => {
  const { t, dateLocale } = useI18n();

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
    <div className="flex-1 px-4 mt-2">
      <h3 className="font-bold text-gray-900 text-sm mb-3 flex items-center gap-2 px-1">{t('eventsNext')}</h3>
      <motion.div
        className="space-y-3 mb-4"
        initial="hidden"
        animate="visible"
        variants={{
          hidden: { opacity: 0 },
          visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
        }}
      >
        {events.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm font-medium">{t('eventsEmpty')}</div>
        ) : (
          events.map((event) => {
            const { month, day } = getBoxDate(event.start_date);
            const isNextUp = event.id === nextUpEventId;
            const isCancelled = event.status === 'Cancelled';

            return (
              <motion.div
                key={event.id}
                variants={{
                  hidden: { opacity: 0, x: -20 },
                  visible: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } }
                }}
                whileHover={!isCancelled ? { scale: 1.02 } : {}}
              >
                <Card
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
                        {t('eventsCancelled')}
                      </div>
                    </div>
                  )}

                  {/* Next Up Badge */}
                  {isNextUp && !isCancelled && (
                    <div className="absolute top-0 right-0 bg-[#d63384] text-white text-[10px] font-bold px-3 py-1 rounded-bl-2xl z-10">
                      {t('eventsNextUp')}
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
                        <div className="flex items-start gap-2">
                          <MapPin size={14} className={isCancelled ? 'text-gray-400' : 'text-[#d63384]'} />
                          <span>{event.location || '-'}</span>
                        </div>
                        {event.booth_detail && (
                          <div className="flex items-start gap-2">
                            <MapPin size={14} className={isCancelled ? 'text-gray-400' : 'text-[#d63384]'} />
                            <span>{t('eventsBooth')} {event.booth_detail}</span>
                          </div>
                        )}

                        {event.entrance_fee && <div className="flex items-center gap-2"><Ticket size={14} className={isCancelled ? 'text-gray-400' : 'text-[#d63384]'} /><span>{event.entrance_fee}</span></div>}
                        {event.transit_info && <div className="flex items-start gap-2"><Train size={14} className={isCancelled ? 'text-gray-400' : 'text-[#d63384]'} /><div className="whitespace-pre-line">{event.transit_info}</div></div>}
                        <div className="flex items-center gap-2"><Calendar size={14} className={isCancelled ? 'text-gray-400' : 'text-[#d63384]'} /><span>{formatDateRange(event.start_date, event.end_date)}</span></div>
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })
        )}
      </motion.div>
    </div>
  );
};

export default EventsList;
