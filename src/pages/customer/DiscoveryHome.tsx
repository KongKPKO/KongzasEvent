import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, CalendarDays, MapPin, Search, Sparkles, Ticket, ShoppingBag, X, Heart, Users, Zap, Store, Star } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { resolveAvatarUrl } from '../../utils/avatarUrl';
import { useI18n } from '../../i18n';
import PublicShell from '../../components/PublicShell';
import './discovery-landing.css';

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

interface DiscoveryProduct { id: string; artist_id: string; name: string; image_url: string | null; category: string | null; }

interface DiscoveryRow {
  accepts_queue?: boolean;
  products?: DiscoveryProduct[];
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

export default function DiscoveryHome() {
  const { t, language } = useI18n();
  const th = language === 'th';
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const searchQuery = searchParams.get('q') || '';
  const queueOnly = searchParams.get('queue') === '1';
  const productsOnly = searchParams.get('products') === '1';
  const [productError, setProductError] = useState(false);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const openOnly = searchParams.get('open') === '1';
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next, { replace: true });
  };
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [creators, setCreators] = useState<DiscoveryRow[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true); setLoadError(false); setProductError(false);
      try {
        const today = new Date().toISOString();
        const [{ data: artists, error: artistsError }, { data: events, error: eventsError }] = await Promise.all([
          supabase
            .from('artists')
            .select('id, slug, display_name, bio, image_url, published_at, is_queue_open')
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

        const publicIds = (artists || []).map(artist => artist.id);
        const productResult = publicIds.length ? await supabase.from('products')
          .select('id, artist_id, name, image_url, category').in('artist_id', publicIds)
          .is('deleted_at', null).in('status', ['enable', 'soldout']).order('created_at', { ascending: false }) : { data: [], error: null };
        if (active) setProductError(Boolean(productResult.error));
        const products = (productResult.data || []) as DiscoveryProduct[];
        const byArtist = new Map<string, DiscoveryEventRecord>();
        for (const event of (events || []) as DiscoveryEventRecord[]) {
          if (!byArtist.has(event.artist_id)) byArtist.set(event.artist_id, event);
        }

        const nextRows = (artists || [])
          .map((artist) => {
            const event = byArtist.get(artist.id);
            return {
              artist_id: artist.id,
              accepts_queue: Boolean(event && artist.is_queue_open),
              products: products.filter(product => product.artist_id === artist.id),
              slug: artist.slug,
              display_name: artist.display_name,
              bio: artist.bio,
              image_url: resolveAvatarUrl(artist.image_url),
              event_id: event?.id || `artist-${artist.id}`,
              event_name: event?.event_name || '',
              location: normalizeEventLocation(event),
              booth_detail: normalizeEventBooth(event),
              is_booth_open: !!event?.is_booth_open,
              start_date: event?.start_date || null,
              published_at: artist.published_at,
            };
          })
          .filter(isPublicCreator)
          .sort((left, right) => Number(right.is_booth_open) - Number(left.is_booth_open)) as DiscoveryRow[];

        if (active) setCreators(nextRows);
      } catch (error) {
        console.error('[DiscoveryHome] load failed:', error);
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => { active = false; };
  }, [retry]);

  const filteredCreators = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return creators.filter((creator) => {
      const matchesSearch =
        query.length === 0 ||
        creator.display_name.toLowerCase().includes(query) ||
        creator.event_name.toLowerCase().includes(query) ||
        (creator.location || '').toLowerCase().includes(query) ||
        `${creator.slug} ${creator.bio || ''} ${creator.booth_detail || ''}`.toLowerCase().includes(query);
      const matchesOpen = !openOnly || creator.is_booth_open;
      return matchesSearch && matchesOpen && (!queueOnly || creator.accepts_queue) && (!productsOnly || productError || Boolean(creator.products?.length));
    });
  }, [creators, searchQuery, openOnly, queueOnly, productsOnly, productError]);

  return <PublicShell discovery>
    <main>
      <section className="discovery-intro public-width">
        <div className="discovery-intro-copy"><p className="public-kicker">{t('discoveryEyebrow')}</p>
          <h1>{t('discoveryTitle')}<span>{t('discoveryTitleAccent')}</span></h1>
          <p>{t('discoverySubtitle')}</p>
          <div className="discovery-hero-actions"><a className="public-button public-primary" href="#discover"><Search size={20} />{t('discoveryFindBooth')}</a><Link className="public-button" to="/creator/register"><Store size={20} />{t('discoveryOwnBooth')}</Link></div>
          <ul className="discovery-benefits"><li><Zap size={18} />{t('discoveryBenefitQueue')}</li><li><Heart size={18} />{t('discoveryBenefitCreators')}</li><li><Users size={18} />{t('discoveryBenefitPlan')}</li></ul>
        </div>
        <CreatorPass />
      </section>
      <section id="discover" data-testid="public-discovery" className="discovery-directory public-width">
        <div className="discovery-heading"><span className="discovery-scribble" aria-hidden="true">Find your<br />favorites!</span><div><h2>{t('discoveryHeading')}</h2><p>{t('discoverySearchHint')}</p></div></div>
        <form className="discovery-searchbar" onSubmit={event => { event.preventDefault(); document.getElementById('discovery-results')?.focus(); }}><label className="discovery-search"><span className="sr-only">{th ? 'ค้นหาครีเอเตอร์' : 'Search creators'}</span><Search size={21} aria-hidden="true" /><input id="public-creator-search" name="creator-search" data-testid="public-creator-search" value={searchQuery} onChange={event => setFilter('q', event.target.value)} placeholder={t('discoveryPlaceholder')} autoComplete="off" />{searchQuery && <button type="button" onClick={() => setFilter('q', '')} aria-label={th ? 'ล้างคำค้น' : 'Clear search'}><X size={18} /></button>}</label><button type="submit" className="public-button public-primary">{t('discoverySearch')}</button></form>
        <div className="discovery-chips"><button type="button" className="public-button" aria-pressed={!openOnly && !queueOnly && !productsOnly} onClick={() => { const next = new URLSearchParams(searchParams); ['open', 'queue', 'products'].forEach(key => next.delete(key)); setSearchParams(next, { replace: true }); }}><CalendarDays size={17} />{t('discoveryAll')}</button><button type="button" data-testid="public-open-now-filter" aria-pressed={openOnly} onClick={() => setFilter('open', openOnly ? '' : '1')} className="public-button discovery-filter"><span className="discovery-open-dot" />{t('homeOpenNow')}</button><button type="button" className="public-button" aria-pressed={queueOnly} onClick={() => setFilter('queue', queueOnly ? '' : '1')}><Users size={17} />{t('discoveryQueue')}</button><button type="button" className="public-button" disabled={productError} aria-pressed={productsOnly} onClick={() => setFilter('products', productsOnly ? '' : '1')}><ShoppingBag size={17} />{t('discoveryProducts')}</button></div>
        {queueOnly && <p className="discovery-filter-note">{t('discoveryQueueHint')}</p>}
        {productError && <p role="status" className="discovery-filter-note">{t('discoveryProductError')}</p>}
        <div id="discovery-results" tabIndex={-1}>
        {loading ? <p className="discovery-feedback" role="status">{t('homeLoadingCreators')}</p> : loadError ? <div className="discovery-feedback" role="alert"><h3>{th ? 'โหลดรายชื่อครีเอเตอร์ไม่ได้' : 'Could not load creators'}</h3><p>{th ? 'ลองโหลดใหม่อีกครั้งเพื่อดูร้านที่เปิดให้เข้าชม' : 'Try again to see the available shops.'}</p><button className="public-button" onClick={() => setRetry(value => value + 1)}>{th ? 'ลองใหม่' : 'Retry'}</button></div> : <>
          <p className="discovery-result-count" role="status">{th ? `พบ ${filteredCreators.length} ครีเอเตอร์${openOnly ? 'ที่เปิดบูธอยู่' : ''}` : `${filteredCreators.length} creators${openOnly ? ' with open booths' : ''}`}</p>
          {filteredCreators.length ? <div className="discovery-grid">{filteredCreators.map(creator => <CreatorCard key={creator.artist_id} creator={creator} liked={liked.has(creator.artist_id)} onLike={() => setLiked(current => { const next = new Set(current); if (next.has(creator.artist_id)) next.delete(creator.artist_id); else next.add(creator.artist_id); return next; })} />)}</div> : <div className="discovery-feedback"><Search size={28} aria-hidden="true" /><h3>{th ? 'ยังไม่พบครีเอเตอร์ที่ค้นหา' : 'No creators found yet'}</h3><p>{th ? 'ลองชื่ออื่น หรือดูร้านทั้งหมด บางร้านอาจยังไม่ได้เผยแพร่หน้าร้าน' : 'Try another name or browse all shops. Some creators may not have published their shop yet.'}</p>{(searchQuery || openOnly || queueOnly || productsOnly) && <button className="public-button" onClick={() => setSearchParams({}, { replace: true })}>{th ? 'ดูครีเอเตอร์ทั้งหมด' : 'Show all creators'}</button>}</div>}
        </>}
        </div>
      </section>
      <section className="discovery-finale"><div className="public-width"><span className="discovery-mini-ticket" aria-hidden="true">MORE<br />CREATORS<br />BRIGHTER<br />EVENTS <Heart size={18} /></span><div><p className="public-kicker">{t('discoveryBottomEyebrow')}</p><h2>{t('discoveryBottomTitle')}</h2><p>{t('discoveryBottomBody')}</p></div><a className="public-button public-primary" href="#discover">{t('discoveryBottomButton')}<ArrowRight size={18} /></a><div className="discovery-mascot" aria-hidden="true"><span>• ᴗ •</span><Heart size={19} fill="currentColor" /></div></div></section>
    </main>
  </PublicShell>;
}

function ArtTile({ variant = 0 }: { variant?: number }) {
  return <div className={`discovery-art discovery-art-${variant % 4}`} aria-hidden="true"><Star className="art-star" size={18} /><span className="art-face">{variant % 2 ? '• ω •' : '• ᴗ •'}</span><Heart className="art-heart" size={15} /></div>;
}

function CreatorPass() {
  const { t } = useI18n();
  return <div className="discovery-visual">
    <Star className="discovery-doodle-star" size={40} fill="currentColor" aria-hidden="true" />
    <span className="discovery-visual-note" aria-hidden="true">Good creators,<br />better days!</span>
    <div className="discovery-preview-paper"><strong>{t('discoveryPreview')}</strong><div>{[0, 1, 2, 3].map(i => <ArtTile key={i} variant={i} />)}</div></div>
    <div className="discovery-pass"><div className="discovery-pass-label">CREATOR PASS <Ticket size={18} /></div><p className="discovery-example">{t('discoveryExample')}</p><div className="discovery-pass-identity"><ArtTile /><div><h2>Sora’s Atelier</h2><p><span>Example Event</span><span>B-12</span></p><small>Illust · Goods · Stationery</small></div><Heart size={20} fill="currentColor" aria-hidden="true" /></div><div className="discovery-pass-queue"><div><span>{t('discoveryNowServing')}</span><strong>A032</strong></div><div><span>{t('discoveryWaiting')}</span><b>{t('discoveryPeople')}</b><Users size={28} aria-hidden="true" /></div></div><div className="discovery-pass-open"><span className="discovery-open-dot" />{t('discoveryServing')}</div></div>
    <span className="discovery-see-you" aria-hidden="true">See you<br />at the event! ♡</span><div className="discovery-mini-ticket" aria-hidden="true">MEET<br />SUPPORT<br />COLLECT<br />ENJOY <Heart size={14} /></div>
  </div>;
}

function CreatorCard({ creator, liked, onLike }: { creator: DiscoveryRow; liked: boolean; onLike: () => void }) {
  const { t, dateLocale } = useI18n();
  const [failed, setFailed] = useState(false);
  const products = creator.products || [];
  const categories = [...new Set(products.map(product => product.category).filter(Boolean))].slice(0, 3).join(' · ');
  const images = products.filter(product => product.image_url).slice(0, 4);
  return <article data-testid="creator-card" className="discovery-card">
    <div className="discovery-cover">{creator.image_url && !failed ? <img src={creator.image_url} alt="" loading="lazy" onError={() => setFailed(true)} /> : <div className="discovery-cover-art" aria-hidden="true"><Star /><Heart /><Sparkles /></div>}<button type="button" className="discovery-heart" aria-label={`${t('discoveryLike')}: ${creator.display_name}`} aria-pressed={liked} onClick={onLike}><Heart size={19} fill={liked ? 'currentColor' : 'none'} /></button></div>
    <div className="discovery-compact-body"><div className="discovery-identity"><div className="discovery-avatar">{creator.image_url && !failed ? <img src={creator.image_url} alt="" loading="lazy" onError={() => setFailed(true)} /> : creator.display_name.charAt(0)}</div><div><div className="discovery-name-row"><h3>{creator.display_name}</h3><span className={`discovery-status ${creator.is_booth_open ? 'is-open' : ''}`}>{creator.is_booth_open && <span className="discovery-open-dot" />}{t(creator.is_booth_open ? 'creatorCardOpen' : 'creatorCardClosed')}</span></div><p className="discovery-event-name">{creator.event_name || t('creatorCardNoUpcoming')}{creator.booth_detail && <span>{t('creatorCardBooth')} {creator.booth_detail}</span>}</p>{(categories || creator.bio) && <p className="discovery-bio">{categories || creator.bio}</p>}</div></div>
    <div className="discovery-card-bottom"><div className="discovery-card-artwork">{images.length ? images.map(product => <div className="discovery-work" key={product.id}><img src={product.image_url!} alt={product.name} loading="lazy" onError={event => { event.currentTarget.style.display = 'none'; }} /><ShoppingBag aria-hidden="true" size={20} /></div>) : <span className="discovery-work-placeholder"><Sparkles size={19} />{t('discoveryWorkSoon')}</span>}</div><div className="discovery-card-visit"><span><Users size={18} />{t(creator.accepts_queue ? 'discoveryCheckQueue' : 'discoveryNoQueue')}</span><Link to={`/${creator.slug}/home`} className="public-button public-primary">{t('creatorCardView')}<ArrowRight size={17} /></Link></div></div>
    <div className="discovery-card-meta">{creator.location && <span><MapPin size={13} />{creator.location}</span>}{creator.start_date && <span><CalendarDays size={13} />{formatEventDate(creator.start_date, dateLocale, t('creatorCardScheduleSoon'))}</span>}</div></div>
  </article>;
}
