import { CalendarDays, Clock3, MapPin, Sparkles } from 'lucide-react';
import { useI18n } from '../../i18n';
import { formatAppearanceTimeRange, sortEventAppearances } from '../../lib/eventAppearances';
import type { EventAppearance } from '../../types/eventAppearance';
import { getMenuImageUrl } from '../../utils/imageUtils';

interface EventAppearancePreviewProps {
  appearances: EventAppearance[];
}

const EventAppearancePreview = ({ appearances }: EventAppearancePreviewProps) => {
  const { t, dateLocale } = useI18n();
  if (appearances.length === 0) return null;

  return (
    <div className="mt-4 border-t border-fuchsia-100 pt-3" data-testid="public-event-appearances">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-fuchsia-700">
        <Sparkles size={13} aria-hidden="true" />
        {t('eventsCosplan')}
      </div>
      <div className="flex snap-x gap-2 overflow-x-auto pb-1">
        {sortEventAppearances(appearances).map((appearance) => {
          const date = new Date(`${appearance.appearance_date}T00:00:00`);
          const dateLabel = Number.isNaN(date.getTime())
            ? appearance.appearance_date
            : date.toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' });
          const timeLabel = formatAppearanceTimeRange(appearance);
          const placeLabel = [appearance.zone, appearance.booth].filter(Boolean).join(' · ');

          return (
            <article key={appearance.id} className="flex w-[248px] shrink-0 snap-start gap-3 rounded-2xl border border-fuchsia-100 bg-gradient-to-br from-fuchsia-50 to-white p-2.5">
              <div className="h-24 w-[72px] shrink-0 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-fuchsia-100">
                {appearance.image_url ? (
                  <img src={getMenuImageUrl(appearance.image_url)} alt={`${appearance.character_name} cosplay`} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-fuchsia-300"><Sparkles size={25} aria-hidden="true" /></div>
                )}
              </div>
              <div className="min-w-0 flex-1 py-0.5">
                <h5 className="line-clamp-2 text-sm font-black leading-4 text-gray-900">{appearance.character_name}</h5>
                {appearance.series_name && <p className="mt-1 truncate text-[11px] font-bold text-fuchsia-700">{appearance.series_name}</p>}
                <div className="mt-2 space-y-1 text-[10px] font-bold text-gray-600">
                  <p className="flex items-center gap-1"><CalendarDays size={11} aria-hidden="true" />{dateLabel}{appearance.day_label ? ` · ${appearance.day_label}` : ''}</p>
                  {timeLabel && <p className="flex items-center gap-1"><Clock3 size={11} aria-hidden="true" />{timeLabel}</p>}
                  {placeLabel && <p className="flex items-center gap-1 truncate"><MapPin size={11} className="shrink-0" aria-hidden="true" /><span className="truncate">{placeLabel}</span></p>}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {appearances.some((appearance) => appearance.note) && (
        <div className="mt-2 space-y-1">
          {sortEventAppearances(appearances).filter((appearance) => appearance.note).map((appearance) => (
            <p key={appearance.id} className="text-xs font-semibold leading-5 text-gray-600">
              <span className="font-black text-gray-800">{appearance.character_name}:</span> {appearance.note}
            </p>
          ))}
        </div>
      )}
    </div>
  );
};

export default EventAppearancePreview;
