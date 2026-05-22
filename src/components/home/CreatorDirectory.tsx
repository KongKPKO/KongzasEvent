import { Link } from 'react-router-dom';
import { Compass, MapPin, Sparkles } from 'lucide-react';
import { resolveAvatarUrl } from '../../utils/avatarUrl';
import { useI18n } from '../../i18n';

interface CreatorCard {
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

interface CreatorDirectoryProps {
  creators: CreatorCard[];
}

const CreatorDirectory = ({ creators }: CreatorDirectoryProps) => {
  const { t } = useI18n();
  if (creators.length === 0) return null;

  return (
    <div className="px-4 mt-2 mb-4">
      <div className="flex items-center gap-2 px-1 mb-3">
        <Compass size={16} className="text-[#d63384]" />
        <h3 className="font-bold text-gray-900 text-sm">{t('creatorsExplore')}</h3>
        <Link to="/discover" className="ml-auto inline-flex min-h-9 items-center rounded-full px-3 text-[11px] font-black text-[#d63384] hover:bg-pink-50">
          {t('creatorsViewAll')}
        </Link>
      </div>

      <div className="space-y-3">
        {creators.map((creator) => (
          <Link
            key={creator.id}
            to={`/${creator.slug}`}
            className="rounded-[28px] border border-gray-100 bg-white px-4 py-3 shadow-sm hover:shadow-md transition-shadow block"
          >
            <div className="flex items-start gap-3">
              {creator.image_url ? (
                <img
                  src={resolveAvatarUrl(creator.image_url)}
                  alt={creator.display_name}
                  width="88"
                  height="88"
                  loading="lazy"
                  decoding="async"
                  className="w-[88px] h-[88px] rounded-[26px] object-cover bg-gray-100 shrink-0"
                />
              ) : (
                <div className="w-[88px] h-[88px] rounded-[26px] bg-pink-100 text-pink-600 flex items-center justify-center font-black text-2xl shrink-0">
                  {creator.display_name.charAt(0)}
                </div>
              )}
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[15px] font-black leading-tight text-gray-900 truncate">{creator.display_name}</div>
                    {creator.bio && (
                      <div className="mt-1 text-[11px] leading-[1.35] text-gray-500 line-clamp-2">{creator.bio}</div>
                    )}
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold shrink-0 ${
                    creator.is_booth_open ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-gray-100 text-gray-600 border border-gray-200'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${creator.is_booth_open ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                    {creator.is_booth_open ? t('creatorsOpenNow') : t('creatorsClosed')}
                  </span>
                </div>
                <div className="mt-1.5 text-[13px] font-semibold leading-tight text-gray-800">{creator.event_name}</div>
                <div className="flex items-center gap-1.5 text-[11px] leading-tight text-gray-500 mt-1.5">
                  <MapPin size={12} className="text-[#d63384] shrink-0" />
                  <span className="line-clamp-1">{creator.location || t('creatorsLocationSoon')}</span>
                </div>
                {creator.booth_detail && (
                  <div className="mt-1 text-[11px] leading-tight text-gray-500">
                    <span className="font-semibold text-gray-700">{t('eventsBooth')}</span> {creator.booth_detail}
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end mt-2">
              <span className="inline-flex min-h-9 items-center gap-1 rounded-full bg-pink-50 px-3 text-[10px] font-black text-[#d63384]">
                <Sparkles size={11} />
                {t('creatorsViewBooth')}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default CreatorDirectory;
