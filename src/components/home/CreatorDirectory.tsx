import { Link } from 'react-router-dom';
import { Compass, MapPin, Sparkles } from 'lucide-react';
import { resolveAvatarUrl } from '../../utils/avatarUrl';

interface CreatorCard {
  id: string;
  slug: string;
  display_name: string;
  image_url?: string | null;
  event_name: string;
  location?: string | null;
  is_booth_open: boolean;
}

interface CreatorDirectoryProps {
  creators: CreatorCard[];
}

const CreatorDirectory = ({ creators }: CreatorDirectoryProps) => {
  if (creators.length === 0) return null;

  return (
    <div className="px-4 mt-2 mb-4">
      <div className="flex items-center gap-2 px-1 mb-3">
        <Compass size={16} className="text-[#d63384]" />
        <h3 className="font-bold text-gray-900 text-sm">Explore Creators</h3>
        <Link to="/discover" className="ml-auto text-[11px] font-bold text-[#d63384]">
          View all
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {creators.map((creator) => (
          <Link
            key={creator.id}
            to={`/${creator.slug}`}
            className="rounded-3xl border border-gray-100 bg-white p-3 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-start gap-3 mb-2">
              {creator.image_url ? (
                <img
                  src={resolveAvatarUrl(creator.image_url)}
                  alt={creator.display_name}
                  className="w-12 h-12 rounded-2xl object-cover bg-gray-100 shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-2xl bg-pink-100 text-pink-600 flex items-center justify-center font-black text-lg shrink-0">
                  {creator.display_name.charAt(0)}
                </div>
              )}
              <div className="min-w-0">
                <div className="text-sm font-black text-gray-900 truncate">{creator.display_name}</div>
                <div className="text-[11px] text-gray-500 line-clamp-2">{creator.event_name}</div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-[11px] text-gray-500 mb-3 min-h-[32px]">
              <MapPin size={12} className="text-[#d63384] shrink-0" />
              <span className="line-clamp-2">{creator.location || 'Location updates soon'}</span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold ${
                creator.is_booth_open ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-gray-100 text-gray-600 border border-gray-200'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${creator.is_booth_open ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                {creator.is_booth_open ? 'Open now' : 'Closed'}
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#d63384]">
                <Sparkles size={11} />
                View booth
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default CreatorDirectory;
