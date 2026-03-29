import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Compass, MapPin, Search } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { resolveAvatarUrl } from '../../utils/avatarUrl';

interface DiscoveryRow {
  artist_id: string;
  slug: string;
  display_name: string;
  bio?: string | null;
  image_url?: string | null;
  event_id: string;
  event_name: string;
  location?: string | null;
  booth_detail?: string | null;
  is_booth_open: boolean;
}

export default function DiscoveryHome() {
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [creators, setCreators] = useState<DiscoveryRow[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const today = new Date().toISOString();
        const [{ data: artists, error: artistsError }, { data: events, error: eventsError }] = await Promise.all([
          supabase
            .from('artists')
            .select('id, slug, display_name, bio, image_url'),
          supabase
          .from('events')
          .select('id, artist_id, event_name, location, booth_detail, is_booth_open, start_date, end_date, status')
          .eq('status', 'Confirmed')
          .gte('end_date', today)
          .order('is_booth_open', { ascending: false })
          .order('start_date', { ascending: true })
        ]);

        if (artistsError) throw artistsError;
        if (eventsError) throw eventsError;

        const byArtist = new Map<string, any>();
        for (const event of events || []) {
          if (!byArtist.has(event.artist_id)) byArtist.set(event.artist_id, event);
        }

        const nextRows = (artists || [])
          .map((artist) => {
            const event = byArtist.get(artist.id);
            return {
              artist_id: artist.id,
              slug: artist.slug,
              display_name: artist.display_name,
              bio: artist.bio,
              image_url: resolveAvatarUrl(artist.image_url),
              event_id: event?.id || `artist-${artist.id}`,
              event_name: event?.event_name || 'No upcoming event',
              location: event?.location || null,
              booth_detail: event?.booth_detail || null,
              is_booth_open: event?.is_booth_open || false,
            };
          })
          .sort((left, right) => Number(right.is_booth_open) - Number(left.is_booth_open)) as DiscoveryRow[];

        setCreators(nextRows);
      } catch (error) {
        console.error('[DiscoveryHome] load failed:', error);
        setCreators([]);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const filteredCreators = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return creators.filter((creator) => {
      const matchesSearch =
        query.length === 0 ||
        creator.display_name.toLowerCase().includes(query) ||
        creator.event_name.toLowerCase().includes(query) ||
        (creator.location || '').toLowerCase().includes(query);
      const matchesOpen = !openOnly || creator.is_booth_open;
      return matchesSearch && matchesOpen;
    });
  }, [creators, searchQuery, openOnly]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto min-h-screen bg-white shadow-xl px-4 pb-8">
        <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-md pt-4 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2 mb-3">
            <Compass className="text-[#d63384]" size={18} />
            <div>
              <h1 className="text-lg font-black text-gray-900">Discovery Home</h1>
              <p className="text-xs text-gray-500">Browse active and upcoming booths across creators.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search creator or event..."
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
              />
            </div>
            <button
              onClick={() => setOpenOnly((prev) => !prev)}
              className={`px-3 py-2 rounded-xl text-xs font-bold border ${openOnly ? 'bg-green-50 border-green-200 text-green-700' : 'bg-white border-gray-200 text-gray-600'}`}
            >
              Open now
            </button>
          </div>
        </div>

        <div className="pt-4 space-y-3">
          {loading ? (
            <div className="text-center py-16 text-sm text-gray-400">Loading creators...</div>
          ) : filteredCreators.length === 0 ? (
            <div className="text-center py-16 text-sm text-gray-400">No creators found.</div>
          ) : filteredCreators.map((creator) => (
            <Link
              key={`${creator.artist_id}-${creator.event_id}`}
              to={`/${creator.slug}/home`}
              className="block rounded-[28px] border border-gray-100 bg-white px-4 py-3 shadow-sm"
            >
              <div className="flex items-start gap-3">
                {creator.image_url ? (
                  <img src={creator.image_url} alt={creator.display_name} className="w-[88px] h-[88px] rounded-[26px] object-cover bg-gray-100 shrink-0" />
                ) : (
                  <div className="w-[88px] h-[88px] rounded-[26px] bg-pink-100 text-pink-600 flex items-center justify-center font-black text-2xl shrink-0">
                    {creator.display_name.charAt(0)}
                  </div>
                )}
                <div className="min-w-0 flex-1 -mt-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-black text-gray-900 truncate">{creator.display_name}</div>
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold ${creator.is_booth_open ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-gray-100 text-gray-600 border border-gray-200'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${creator.is_booth_open ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                      {creator.is_booth_open ? 'Open' : 'Closed'}
                    </span>
                  </div>
                  {creator.bio && (
                    <div className="text-[11px] leading-[1.25] text-gray-500 mt-0.5 line-clamp-2">{creator.bio}</div>
                  )}
                  <div className="mt-1 text-[13px] font-semibold leading-tight text-gray-800">{creator.event_name}</div>
                  <div className="flex items-start gap-1.5 mt-1 text-[11px] leading-tight text-gray-500">
                    <MapPin size={12} className="text-[#d63384] shrink-0 mt-0.5" />
                    <span>{creator.location || 'Location updates soon'}</span>
                  </div>
                  {creator.booth_detail && (
                    <div className="mt-0.5 text-[11px] leading-tight text-gray-500">
                      <span className="font-semibold text-gray-700">Booth:</span> {creator.booth_detail}
                    </div>
                  )}
                  <div className="mt-1.5 text-[11px] font-bold text-[#d63384]">View booth</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
