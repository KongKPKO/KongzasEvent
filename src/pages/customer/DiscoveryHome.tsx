import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, CalendarDays, MapPin, Search, Sparkles, Ticket, ShoppingBag, X, Heart, Users, Zap, Store, Star } from 'lucide-react';
import { listPublicOnlineCampaigns } from '../../lib/onlineCampaigns';
import { supabase } from '../../supabaseClient';
import { resolveAvatarUrl } from '../../utils/avatarUrl';
import { useI18n } from '../../i18n';
import { ProductMedia } from '../../components/menu/ProductPresentation';
import { getProductImages } from '../../utils/productPresentation';
import { getMenuImageUrl } from '../../utils/imageUtils';
import type { PresentableProduct } from '../../types/productPresentation';
import { getSellerLabels, type SellerType } from '../../utils/sellerType';
import PublicShell from '../../components/PublicShell';
import './discovery-landing.css';

interface DiscoveryEventRecord {
  id: string;
  artist_id: string;
  event_name: string;
  status?: string | null;
  is_booth_open?: boolean | null;
  queue_enabled?: boolean | null;
  start_date?: string | null;
  end_date?: string | null;
  location?: string | null;
  booth_detail?: string | null;
  location_name?: string | null;
  location_detail?: string | null;
  booth_number?: string | null;
}

interface DiscoveryProduct extends PresentableProduct { artist_id: string; }

interface DiscoveryRow {
  accepts_queue?: boolean;
  has_online_shop: boolean;
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
  seller_type?: SellerType;
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
  const onlineOnly = searchParams.get('online') === '1';
  const [onlineError, setOnlineError] = useState(false);
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
      setLoading(true); setLoadError(false); setProductError(false); setOnlineError(false);
      try {
        const today = new Date().toISOString();
        const [{ data: artists, error: artistsError }, { data: events, error: eventsError }, campaigns] = await Promise.all([
          supabase
            .from('artists')
            .select('id, slug, display_name, bio, image_url, published_at, is_queue_open, seller_type')
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
          listPublicOnlineCampaigns().catch(error => {
            console.error('[DiscoveryHome] online shops failed:', error);
            if (active) setOnlineError(true);
            return [];
          }),
        ]);

        if (artistsError) throw artistsError;
        if (eventsError) throw eventsError;

        const onlineArtistIds = new Set(campaigns.map(campaign => campaign.artist_id));
        const publicIds = (artists || []).map(artist => artist.id);
        const productResult = publicIds.length ? await supabase.from('products')
          .select('id, artist_id, name, price, image_url, category, parent_product_id, product_kind, gallery_images, variant_gallery_images').in('artist_id', publicIds)
          .is('deleted_at', null).eq('gift_only', false).in('status', ['enable', 'soldout']).order('created_at', { ascending: false }) : { data: [], error: null };
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
              has_online_shop: onlineArtistIds.has(artist.id),
              accepts_queue: Boolean(event && event.queue_enabled !== false && artist.is_queue_open),
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
              seller_type: artist.seller_type,
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
      return matchesSearch && matchesOpen && (!onlineOnly || creator.has_online_shop) && (!queueOnly || creator.accepts_queue) && (!productsOnly || productError || Boolean(creator.products?.length));
    });
  }, [creators, searchQuery, openOnly, queueOnly, productsOnly, productError, onlineOnly]);

  return <PublicShell discovery>
    <main>
      <section className="discovery-intro public-width">
        <div className="discovery-stars" aria-hidden="true"><span>✦</span><span>✧</span><span>✦</span><span>✧</span><span>✦</span><span>✧</span></div>
        <div className="discovery-intro-copy"><p className="discovery-welcome"><span className="discovery-welcome-star" aria-hidden="true" />{th ? 'ไพม่อนยินดีต้อนรับคุณ' : 'Paimon welcomes you'}</p><p className="public-kicker">{t('discoveryEyebrow')}</p>
          <h1>{t('discoveryTitle')}<span>{t('discoveryTitleAccent')}</span></h1>
          <p>{t('discoverySubtitle')}</p>
          <div className="discovery-hero-actions"><a className="public-button public-primary" href="#discover"><Search size={20} />{t('discoveryFindBooth')}</a><Link className="public-button" to="/for-sellers"><Store size={20} />{t('discoveryOwnBooth')}</Link></div>
          <ul className="discovery-benefits"><li><Zap size={18} />{t('discoveryBenefitQueue')}</li><li><Heart size={18} />{t('discoveryBenefitCreators')}</li><li><Users size={18} />{t('discoveryBenefitPlan')}</li></ul>
        </div>
        <CreatorPass />
      </section>
      <section className="discovery-showcase" aria-labelledby="showcase-title">
        <div className="public-width">
          <div className="showcase-heading"><p className="public-kicker">{th ? 'ทำความรู้จัก PAIMON' : 'MEET PAIMON'}</p><h2 id="showcase-title">{th ? 'จัดการบูธง่ายขึ้น ให้ลูกค้าใช้เวลาสนุกกับงาน' : 'A smoother booth day for you and your visitors'}</h2><p>{th ? 'ตั้งแต่เตรียมสินค้า เรียกคิว จนถึงรับออเดอร์ ทุกคนเห็นสิ่งที่ต้องทำในที่เดียว' : 'From preparing products to calling queues and receiving orders, everyone can see what comes next.'}</p></div>
          <div className="showcase-grid">
            <article className="showcase-card"><div className="showcase-copy"><span className="showcase-tag">01 · {th ? 'สำหรับร้านค้า' : 'FOR SELLERS'}</span><h3>{th ? 'ขายไป เรียกคิวไป ในหน้าเดียว' : 'Sell and manage queues in one place'}</h3><p>{th ? 'เตรียมสินค้าและสต็อก เปิด POS แล้วกดจัดการคิวได้ระหว่างขาย พร้อมติดตามออเดอร์ของแต่ละช่วงงาน' : 'Prepare products and stock, manage queues from your POS, and follow orders across each event phase.'}</p></div><div className="showcase-image showcase-desktop"><img src="/landing/booth-queue.png" alt={th ? 'ตัวอย่างหน้า POS พร้อมแผงจัดการคิวของร้านจำลอง' : 'Example POS with the queue management panel for a demo shop'} loading="lazy" width="1280" height="900" /><span>{th ? 'ภาพจากร้านตัวอย่าง' : 'Demo shop'}</span></div></article>
            <article className="showcase-card showcase-customer"><div className="showcase-copy"><span className="showcase-tag">02 · {th ? 'สำหรับลูกค้าบูธ' : 'FOR VISITORS'}</span><h3>{th ? 'ดูคิวและเลือกสินค้าได้จากมือถือ' : 'Check your queue and browse on your phone'}</h3><p>{th ? 'ลูกค้าดูสถานะคิว เปิดดูสินค้าของร้าน และติดตามออเดอร์ได้ โดยไม่ต้องคอยถามหน้าบูธ' : 'Visitors can check their queue status, browse products, and follow their order from their phone.'}</p></div><div className="showcase-image showcase-phone"><img src="/landing/customer-queue.png" alt={th ? 'ตัวอย่างหน้าสถานะคิวบนมือถือของลูกค้า' : 'Example customer queue status on a phone'} loading="lazy" width="390" height="1319" /><span>{th ? 'ภาพตัวอย่าง' : 'Example screen'}</span></div></article>
          </div>
          <article className="showcase-orders"><div><p className="showcase-tag">{th ? 'ก่อนงาน · วันงาน · หลังงาน' : 'BEFORE · DURING · AFTER'}</p><h3>{th ? 'รับพรีออเดอร์ ผลิต และขายต่อหลังงาน' : 'Take pre-orders, produce, and keep selling'}</h3><p>{th ? 'เปิดรับสั่งผลิต ติดตามการรับที่งาน และนำสต็อกที่พร้อมขายไปใช้ต่อได้ในแต่ละช่วง' : 'Accept made-to-order purchases, track event pickups, and allocate available stock across each stage.'}</p><Link className="public-button" to="/for-sellers">{th ? 'ดูตัวอย่างทั้งสามช่วง' : 'Explore the three stages'} <ArrowRight size={18} /></Link></div><img src="/landing/preorders.png" alt={th ? 'ตัวอย่างหน้าจัดการออเดอร์ก่อนงานของร้านจำลอง' : 'Example pre-order dashboard for a demo shop'} loading="lazy" width="1280" height="900" /></article>
          <article className="showcase-orders"><div><p className="showcase-tag">{th ? 'รอบขายออนไลน์' : 'ONLINE CAMPAIGNS'}</p><h3>{th ? 'ไม่มีงานอีเวนต์ ก็เปิดขายได้' : 'Sell online between events'}</h3><p>{th ? 'สร้างแคมเปญแยกสำหรับสินค้าใหม่ สินค้าพิเศษ หรือสินค้าเดิม เลือกช่วงขายและวิธีส่งมอบได้ตามรอบของร้าน' : 'Create a separate campaign for new, limited-run or existing products, with its own sales window and fulfillment options.'}</p><Link className="public-button" to="/for-sellers">{th ? 'ดูวิธีใช้งานสำหรับร้านค้า' : 'See how it works for sellers'} <ArrowRight size={18} /></Link></div><img src="/landing/campaign.png" alt={th ? 'ตัวอย่างหน้าจัดการแคมเปญออนไลน์ของร้านจำลอง' : 'Example online campaign workspace for a demo shop'} loading="lazy" width="1280" height="900" /></article>
          <div className="showcase-actions"><Link className="public-button public-primary" to="/for-sellers">{th ? 'เริ่มต้นสำหรับร้านค้า' : 'Get started as a seller'}<ArrowRight size={18} /></Link><a className="public-button" href="/landing/paimon-user-manual.pdf" target="_blank" rel="noopener noreferrer">{th ? 'เปิดคู่มือร้านค้า (PDF)' : 'Open seller guide (Thai PDF)'}</a></div>
        </div>
      </section>
      <section id="discover" data-testid="public-discovery" className="discovery-directory public-width">
        <div className="discovery-heading"><span className="discovery-scribble" aria-hidden="true">Find your<br />favorites!</span><div><h2>{t('discoveryHeading')}</h2><p>{t('discoverySearchHint')}</p></div></div>
        <form className="discovery-searchbar" onSubmit={event => { event.preventDefault(); document.getElementById('discovery-results')?.focus(); }}><label className="discovery-search"><span className="sr-only">{th ? 'ค้นหาร้านค้า' : 'Search shops'}</span><Search size={21} aria-hidden="true" /><input id="public-creator-search" name="creator-search" data-testid="public-creator-search" value={searchQuery} onChange={event => setFilter('q', event.target.value)} placeholder={t('discoveryPlaceholder')} autoComplete="off" />{searchQuery && <button type="button" onClick={() => setFilter('q', '')} aria-label={th ? 'ล้างคำค้น' : 'Clear search'}><X size={18} /></button>}</label><button type="submit" className="public-button public-primary">{t('discoverySearch')}</button></form>
        <div className="discovery-chips"><button type="button" className="public-button" aria-pressed={!openOnly && !queueOnly && !productsOnly && !onlineOnly} onClick={() => { const next = new URLSearchParams(searchParams); ['open', 'queue', 'products', 'online'].forEach(key => next.delete(key)); setSearchParams(next, { replace: true }); }}><CalendarDays size={17} />{t('discoveryAll')}</button><button type="button" data-testid="public-open-now-filter" aria-pressed={openOnly} onClick={() => setFilter('open', openOnly ? '' : '1')} className="public-button discovery-filter"><span className="discovery-open-dot" />{t('homeOpenNow')}</button><button type="button" className="public-button" aria-pressed={queueOnly} onClick={() => setFilter('queue', queueOnly ? '' : '1')}><Users size={17} />{t('discoveryQueue')}</button><button type="button" className="public-button" disabled={productError} aria-pressed={productsOnly} onClick={() => setFilter('products', productsOnly ? '' : '1')}><ShoppingBag size={17} />{t('discoveryProducts')}</button><button type="button" className="public-button" aria-pressed={onlineOnly} onClick={() => setFilter('online', onlineOnly ? '' : '1')}><Store size={17} />{t('onlineShop')}</button></div>
        {onlineError && !onlineOnly && <p role="alert" className="discovery-filter-note">{t('onlineShopError')} <button type="button" className="public-button" onClick={() => setRetry(value => value + 1)}>{t('onlineShopRetry')}</button></p>}
        {queueOnly && <p className="discovery-filter-note">{t('discoveryQueueHint')}</p>}
        {productError && <p role="status" className="discovery-filter-note">{t('discoveryProductError')}</p>}
        <div id="discovery-results" tabIndex={-1}>
        {loading ? <p className="discovery-feedback" role="status">{t('homeLoadingCreators')}</p> : (loadError || (onlineOnly && onlineError)) ? <div className="discovery-feedback" role="alert"><h3>{th ? 'โหลดรายชื่อร้านค้าไม่ได้' : 'Could not load shops'}</h3><p>{th ? 'ลองโหลดใหม่อีกครั้งเพื่อดูร้านที่เปิดให้เข้าชม' : 'Try again to see the available shops.'}</p><button className="public-button" onClick={() => setRetry(value => value + 1)}>{th ? 'ลองใหม่' : 'Retry'}</button></div> : <>
          <p className="discovery-result-count" role="status">{th ? `พบ ${filteredCreators.length} ร้าน${openOnly ? 'ที่เปิดบูธอยู่' : ''}` : `${filteredCreators.length} shops${openOnly ? ' with open booths' : ''}`}</p>
          {filteredCreators.length ? <div className="discovery-grid">{filteredCreators.map(creator => <CreatorCard key={creator.artist_id} creator={creator} liked={liked.has(creator.artist_id)} onLike={() => setLiked(current => { const next = new Set(current); if (next.has(creator.artist_id)) next.delete(creator.artist_id); else next.add(creator.artist_id); return next; })} />)}</div> : <div className="discovery-feedback"><Search size={28} aria-hidden="true" /><h3>{th ? 'ยังไม่พบร้านที่ค้นหา' : 'No shops found yet'}</h3><p>{th ? 'ลองชื่ออื่น หรือดูร้านทั้งหมด บางร้านอาจยังไม่ได้เผยแพร่หน้าร้าน' : 'Try another name or browse all shops. Some sellers may not have published their shop yet.'}</p>{(searchQuery || openOnly || queueOnly || productsOnly || onlineOnly) && <button className="public-button" onClick={() => setSearchParams({}, { replace: true })}>{th ? 'ดูร้านทั้งหมด' : 'Show all shops'}</button>}</div>}
        </>}
        </div>
      </section>
      <section className="discovery-finale"><div className="public-width"><span className="discovery-mini-ticket" aria-hidden="true">MORE<br />SHOPS<br />BRIGHTER<br />EVENTS <Star size={18} /></span><div><p className="public-kicker">{t('discoveryBottomEyebrow')}</p><h2>{t('discoveryBottomTitle')}</h2><p>{t('discoveryBottomBody')}</p></div><a className="public-button public-primary" href="#discover">{t('discoveryBottomButton')}<ArrowRight size={18} /></a><div className="discovery-mascot" aria-hidden="true"><span>• ᴗ •</span><Star size={19} fill="currentColor" /></div></div></section>
    </main>
  </PublicShell>;
}

function ArtTile({ variant = 0 }: { variant?: number }) {
  return <div className={`discovery-art discovery-art-${variant % 4}`} aria-hidden="true"><Star className="art-star" size={18} /><span className="art-face">{variant % 2 ? '• ω •' : '• ᴗ •'}</span><Sparkles className="art-heart" size={15} /></div>;
}

function CreatorPass() {
  const { t } = useI18n();
  return <div className="discovery-visual">
    <Star className="discovery-doodle-star" size={40} fill="currentColor" aria-hidden="true" />
    <span className="discovery-visual-note" aria-hidden="true">Great shops,<br />better days!</span>
    <div className="discovery-preview-paper"><strong>{t('discoveryPreview')}</strong><div>{[0, 1, 2, 3].map(i => <ArtTile key={i} variant={i} />)}</div></div>
    <div className="discovery-pass"><div className="discovery-pass-label">SHOP PASS <Ticket size={18} /></div><p className="discovery-example">{t('discoveryExample')}</p><div className="discovery-pass-identity"><ArtTile /><div><h2>Sora’s Atelier</h2><p><span>Example Event</span><span>B-12</span></p><small>Illust · Goods · Stationery</small></div><Star size={20} fill="currentColor" aria-hidden="true" /></div><div className="discovery-pass-queue"><div><span>{t('discoveryNowServing')}</span><strong>A032</strong></div><div><span>{t('discoveryWaiting')}</span><b>{t('discoveryPeople')}</b><Users size={28} aria-hidden="true" /></div></div><div className="discovery-pass-open"><span className="discovery-open-dot" />{t('discoveryServing')}</div></div>
    <span className="discovery-see-you" aria-hidden="true">See you<br />at the event! ✧</span><div className="discovery-mini-ticket" aria-hidden="true">MEET<br />SUPPORT<br />COLLECT<br />ENJOY <Star size={14} /></div>
  </div>;
}

function CreatorCard({ creator, liked, onLike }: { creator: DiscoveryRow; liked: boolean; onLike: () => void }) {
  const { t, dateLocale, language } = useI18n();
  const sellerLabels = getSellerLabels(creator.seller_type, language);
  const [failed, setFailed] = useState(false);
  const products = creator.products || [];
  const categories = [...new Set(products.map(product => product.category).filter(Boolean))].slice(0, 3).join(' · ');
  const seenParents = new Set<string>();
  const images = products.filter(product => {
    const key = product.parent_product_id || product.id;
    if (!getProductImages(product).length || seenParents.has(key)) return false;
    seenParents.add(key);
    return true;
  }).slice(0, 4);
  return <article data-testid="creator-card" className="discovery-card">
    <div className="discovery-cover">{creator.image_url && !failed ? <img src={creator.image_url} alt="" loading="lazy" onError={() => setFailed(true)} /> : <div className="discovery-cover-art" aria-hidden="true"><Star /><Sparkles /><Star /></div>}<button type="button" className="discovery-heart" aria-label={`${language === 'th' ? `ถูกใจ${sellerLabels.shop}` : `Like this ${sellerLabels.shop.toLowerCase()}`}: ${creator.display_name}`} aria-pressed={liked} onClick={onLike}><Heart size={19} fill={liked ? 'currentColor' : 'none'} /></button></div>
    <div className="discovery-compact-body"><div className="discovery-identity"><div className="discovery-avatar">{creator.image_url && !failed ? <img src={creator.image_url} alt="" loading="lazy" onError={() => setFailed(true)} /> : creator.display_name.charAt(0)}</div><div><div className="discovery-name-row"><h3>{creator.display_name}</h3><span className="discovery-status">{sellerLabels.shop}</span>{creator.has_online_shop && <span className="discovery-status text-pink-700"><Store size={12} aria-hidden="true" />{t('onlineShop')}</span>}<span className={`discovery-status ${creator.is_booth_open ? 'is-open' : ''}`}>{creator.is_booth_open && <span className="discovery-open-dot" />}{t(creator.is_booth_open ? 'creatorCardOpen' : 'creatorCardClosed')}</span></div><p className="discovery-event-name">{creator.event_name || t('creatorCardNoUpcoming')}{creator.booth_detail && <span>{t('creatorCardBooth')} {creator.booth_detail}</span>}</p>{(categories || creator.bio) && <p className="discovery-bio">{categories || creator.bio}</p>}</div></div>
    <div className="discovery-card-bottom"><div className="discovery-card-artwork">{images.length ? images.map(product => <div className="discovery-work" key={product.id}><ProductMedia product={product} getImageUrl={getMenuImageUrl} /></div>) : <span className="discovery-work-placeholder"><Sparkles size={19} />{t('discoveryWorkSoon')}</span>}</div><div className="discovery-card-visit"><span><Users size={18} />{t(creator.accepts_queue ? 'discoveryCheckQueue' : 'discoveryNoQueue')}</span><Link to={`/${creator.slug}/home`} className="public-button public-primary">{t('creatorCardView')}<ArrowRight size={17} /></Link></div></div>
    <div className="discovery-card-meta">{creator.location && <span><MapPin size={13} />{creator.location}</span>}{creator.start_date && <span><CalendarDays size={13} />{formatEventDate(creator.start_date, dateLocale, t('creatorCardScheduleSoon'))}</span>}</div></div>
  </article>;
}
