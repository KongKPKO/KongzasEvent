import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, MapPin, Search, Sparkles, Ticket, UsersRound } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { resolveAvatarUrl } from '../../utils/avatarUrl';
import { LanguageToggle, useI18n } from '../../i18n';

interface DiscoveryEventRecord {
  id: string;
  artist_id: string;
  event_name: string;
  status?: string | null;
  is_booth_open?: boolean | null;
  start_date?: string | null;
  end_date?: string | null;
  location?: string | null;
  booth_detail?: string | null;
  location_name?: string | null;
  location_detail?: string | null;
  booth_number?: string | null;
}

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
  start_date?: string | null;
  published_at?: string | null;
}

const normalizeEventLocation = (event?: DiscoveryEventRecord | null) => {
  if (!event) return null;
  if (event.location && event.location.trim().length > 0) return event.location;
  return [event.location_name, event.location_detail]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(', ') || null;
};

const normalizeEventBooth = (event?: DiscoveryEventRecord | null) => {
  if (!event) return null;
  if (event.booth_detail && event.booth_detail.trim().length > 0) return event.booth_detail;
  return event.booth_number || null;
};

const formatEventDate = (value: string | null | undefined, locale: string, fallback: string) => {
  if (!value) return fallback;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
};

const demoNamePattern = /(test|demo|performance|security|resilience|accessibility|network|mobile)/i;

const isPublicCreator = (creator: Pick<DiscoveryRow, 'slug' | 'display_name' | 'bio'>) => {
  if (demoNamePattern.test(creator.display_name) || demoNamePattern.test(creator.slug)) return false;
  if (creator.bio && demoNamePattern.test(creator.bio)) return false;
  return true;
};

function NireqWordmark() {
  return (
    <div className="flex items-center gap-2" aria-label="Nireq">
      <div className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-pink-600 text-white shadow-lg shadow-pink-200">
        <span className="text-lg font-black">N</span>
        <span className="absolute -right-1.5 bottom-2 h-2.5 w-2.5 rounded-full border-2 border-white bg-rose-200" />
      </div>
      <div className="text-2xl font-black tracking-normal text-gray-950">
        Nire<span className="text-pink-600">q</span>
      </div>
    </div>
  );
}

export default function DiscoveryHome() {
  const { t } = useI18n();
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
            .select('id, slug, display_name, bio, image_url, published_at')
            .eq('is_public', true)
            .eq('is_verified', true)
            .not('published_at', 'is', null)
            .order('published_at', { ascending: false }),
          supabase
            .from('events')
            .select('*')
            .in('status', ['Confirmed', 'confirmed'])
            .gte('end_date', today)
            .order('is_booth_open', { ascending: false })
            .order('start_date', { ascending: true }),
        ]);

        if (artistsError) throw artistsError;
        if (eventsError) throw eventsError;

        const byArtist = new Map<string, DiscoveryEventRecord>();
        for (const event of (events || []) as DiscoveryEventRecord[]) {
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
              location: normalizeEventLocation(event),
              booth_detail: normalizeEventBooth(event),
              is_booth_open: !!event?.is_booth_open,
              start_date: event?.start_date || null,
              published_at: artist.published_at,
            };
          })
          .filter(isPublicCreator)
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

  const openCount = creators.filter((creator) => creator.is_booth_open).length;
  const previewCreators = filteredCreators.slice(0, 3);

  return (
    <div className="min-h-screen bg-[#fff7fb] text-gray-950">
      <header className="sticky top-0 z-30 border-b border-pink-100 bg-white/88 backdrop-blur-xl" data-testid="public-topbar">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/" aria-label="Nireq home" className="inline-flex min-h-11 items-center">
            <NireqWordmark />
          </Link>
          <nav className="flex items-center gap-2">
            <a href="#discover" className="hidden min-h-11 items-center rounded-full px-4 text-sm font-black text-gray-600 hover:bg-pink-50 hover:text-pink-700 sm:inline-flex">
              {t('navDiscover')}
            </a>
            <Link to="/manage-login" className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-black text-gray-600 hover:bg-pink-50 hover:text-pink-700">
              {t('navCreatorLogin')}
            </Link>
            <Link to="/creator/register" className="hidden min-h-11 items-center rounded-full bg-pink-600 px-4 text-sm font-black text-white shadow-lg shadow-pink-200 hover:bg-pink-700 sm:inline-flex">
              {t('navApply')}
            </Link>
            <LanguageToggle className="min-h-11 min-w-11" />
          </nav>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-pink-100 bg-[radial-gradient(circle_at_20%_20%,#ffe4f1_0,#fff7fb_36%,#ffffff_100%)]">
          <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl grid-cols-1 items-center gap-10 px-4 py-10 lg:grid-cols-[1.02fr_0.98fr] lg:py-14">
            <div className="max-w-2xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-pink-200 bg-white/80 px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-pink-700 shadow-sm">
                <Sparkles size={14} />
                {t('homeEyebrow')}
              </div>
              <h1 className="text-5xl font-black leading-[0.92] tracking-normal text-gray-950 md:text-7xl">
                {t('homeTitle')}
              </h1>
              <p className="mt-6 max-w-xl text-base font-semibold leading-7 text-gray-600 md:text-lg">
                {t('homeSubtitle')}
              </p>

              <div className="mt-8 rounded-[1.75rem] border border-pink-100 bg-white p-3 shadow-2xl shadow-pink-100/70">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <label className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-pink-400" size={18} />
                    <input
                      id="public-creator-search"
                      name="creator-search"
                      data-testid="public-creator-search"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={t('homeSearchPlaceholder')}
                      className="h-[3.25rem] w-full rounded-2xl border border-pink-100 bg-pink-50/55 py-3 pl-12 pr-4 text-sm font-bold text-gray-900 outline-none transition focus:border-pink-300 focus:bg-white focus:ring-4 focus:ring-pink-100"
                    />
                  </label>
                  <button
                    type="button"
                    data-testid="public-open-now-filter"
                    onClick={() => setOpenOnly((current) => !current)}
                    className={`h-[3.25rem] rounded-2xl border px-5 py-3 text-sm font-black transition ${
                      openOnly
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-pink-100 bg-white text-gray-700 hover:border-pink-200 hover:bg-pink-50'
                    }`}
                  >
                    {t('homeOpenNow')}
                  </button>
                </div>
              </div>

              <div className="mt-6 grid max-w-lg grid-cols-3 gap-3">
                <div className="rounded-2xl border border-pink-100 bg-white/80 p-4">
                  <div className="text-2xl font-black text-pink-600">{creators.length}</div>
                  <div className="text-xs font-bold text-gray-500">{t('homeCreators')}</div>
                </div>
                <div className="rounded-2xl border border-pink-100 bg-white/80 p-4">
                  <div className="text-2xl font-black text-pink-600">{openCount}</div>
                  <div className="text-xs font-bold text-gray-500">{t('homeOpenNow')}</div>
                </div>
                <div className="rounded-2xl border border-pink-100 bg-white/80 p-4">
                  <div className="text-2xl font-black text-pink-600">Q</div>
                  <div className="text-xs font-bold text-gray-500">{t('homeLiveQueue')}</div>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="relative rounded-[2rem] border border-pink-100 bg-white p-4 shadow-2xl shadow-pink-100">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.16em] text-pink-500">{t('homeFeaturedEyebrow')}</div>
                    <div className="text-lg font-black text-gray-950">{t('homeFeaturedTitle')}</div>
                  </div>
                  <Ticket className="text-pink-500" size={24} />
                </div>
                <div className="grid gap-3">
                  {loading ? (
                    <div className="rounded-2xl bg-pink-50 p-6 text-center text-sm font-bold text-pink-500">{t('homeLoadingCreators')}</div>
                  ) : previewCreators.length === 0 ? (
                    <div className="rounded-2xl bg-pink-50 p-6 text-center text-sm font-bold text-pink-500">{t('homeNoCreators')}</div>
                  ) : previewCreators.map((creator) => (
                    <CreatorCard key={`${creator.artist_id}-${creator.event_id}-hero`} creator={creator} compact />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-pink-100 bg-white">
          <div className="mx-auto grid max-w-6xl gap-3 px-4 py-6 md:grid-cols-4">
            {[
              { icon: Search, title: t('homeDiscoverTitle'), body: t('homeDiscoverBody') },
              { icon: CalendarDays, title: t('homePlanTitle'), body: t('homePlanBody') },
              { icon: UsersRound, title: t('homeQueueTitle'), body: t('homeQueueBody') },
              { icon: Ticket, title: t('homeEnjoyTitle'), body: t('homeEnjoyBody') },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="rounded-2xl border border-pink-100 bg-[#fff7fb] p-4">
                  <Icon className="mb-3 text-pink-600" size={22} />
                  <div className="text-base font-black text-gray-950">{item.title}</div>
                  <p className="mt-1 text-sm font-medium leading-5 text-gray-600">{item.body}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section id="discover" data-testid="public-discovery" className="mx-auto max-w-6xl px-4 py-10 md:py-14">
          <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-pink-500">{t('homeBrowseEyebrow')}</div>
              <h2 className="mt-2 text-3xl font-black tracking-normal text-gray-950 md:text-4xl">{t('homeBrowseTitle')}</h2>
            </div>
            <Link to="/creator/register" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-pink-200 bg-white px-4 text-sm font-black text-pink-700 hover:bg-pink-50">
              {t('navApplyCreator')}
              <ArrowRight size={16} />
            </Link>
          </div>

          {loading ? (
            <div className="rounded-[2rem] border border-pink-100 bg-white p-12 text-center text-sm font-bold text-pink-500 shadow-sm">{t('homeLoadingCreators')}</div>
          ) : filteredCreators.length === 0 ? (
            <div className="rounded-[2rem] border border-pink-100 bg-white p-12 text-center text-sm font-bold text-pink-500 shadow-sm">{t('homeNoCreators')}</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredCreators.map((creator) => (
                <CreatorCard key={`${creator.artist_id}-${creator.event_id}`} creator={creator} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function CreatorCard({ creator, compact = false }: { creator: DiscoveryRow; compact?: boolean }) {
  const { t, dateLocale } = useI18n();
  return (
    <Link
      to={`/${creator.slug}/home`}
      data-testid="creator-card"
      className={`group block rounded-[1.75rem] border border-pink-100 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-pink-200 hover:shadow-xl hover:shadow-pink-100 ${
        compact ? '' : 'min-h-[220px]'
      }`}
    >
      <div className="flex items-start gap-4">
        <CreatorAvatar creator={creator} compact={compact} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-lg font-black text-gray-950">{creator.display_name}</h3>
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-black ${
              creator.is_booth_open ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-gray-50 text-gray-500'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${creator.is_booth_open ? 'bg-emerald-500' : 'bg-gray-400'}`} />
              {creator.is_booth_open ? t('creatorCardOpen') : t('creatorCardClosed')}
            </span>
          </div>
          {creator.bio && <p className="mt-1 line-clamp-2 text-sm font-medium leading-5 text-gray-500">{creator.bio}</p>}
          <div className="mt-3 rounded-2xl bg-[#fff7fb] p-3">
            <div className="text-sm font-black leading-5 text-gray-900">{creator.event_name || t('creatorCardNoUpcoming')}</div>
            <div className="mt-2 flex items-start gap-2 text-xs font-bold leading-4 text-gray-500">
              <MapPin className="mt-0.5 shrink-0 text-pink-500" size={13} />
              <span>{creator.location || t('creatorCardLocationSoon')}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-black text-pink-700">
              <span>{formatEventDate(creator.start_date, dateLocale, t('creatorCardScheduleSoon'))}</span>
              {creator.booth_detail && <span className="rounded-full bg-white px-2 py-1">{t('creatorCardBooth')} {creator.booth_detail}</span>}
            </div>
          </div>
          <div className="mt-3 inline-flex items-center gap-2 text-sm font-black text-pink-600">
            {t('creatorCardView')}
            <ArrowRight className="transition group-hover:translate-x-0.5" size={15} />
          </div>
        </div>
      </div>
    </Link>
  );
}

function CreatorAvatar({ creator, compact }: { creator: DiscoveryRow; compact: boolean }) {
  const [failed, setFailed] = useState(false);
  const sizeClass = compact ? 'h-20 w-20 rounded-2xl text-2xl' : 'h-24 w-24 rounded-[1.5rem] text-3xl';

  if (creator.image_url && !failed) {
    return (
      <img
        src={creator.image_url}
        alt={creator.display_name}
        width={compact ? 80 : 96}
        height={compact ? 80 : 96}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`${sizeClass} shrink-0 object-cover bg-pink-50`}
      />
    );
  }

  return (
    <div className={`${sizeClass} flex shrink-0 items-center justify-center bg-pink-100 font-black text-pink-600`}>
      {creator.display_name.charAt(0)}
    </div>
  );
}
