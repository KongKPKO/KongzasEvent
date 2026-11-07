import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, CalendarDays, MapPin, Search, Sparkles, Ticket, ShoppingBag, X, Heart, Users, Zap, Store, Star } from 'lucide-react';
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

interface DiscoveryProduct extends PresentableProduct { artist_id: string; }

interface DiscoveryRow {
  accepts_queue?: boolean;
  has_online_shop: boolean;
  products?: DiscoveryProduct[];
  categories?: string;
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

const formatEventDate = (value: string | null | undefined, locale: string, fallback: string) => {
  if (!value) return fallback;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
};

export default function DiscoveryHome() {
  const { t, language } = useI18n();
  const th = language === 'th';
  const directory = useLocation().pathname === '/discover/shops';
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const searchQuery = searchParams.get('q') || '';
  const [searchInput, setSearchInput] = useState(searchQuery);
  const openOnly = searchParams.get('open') === '1';
  const queueOnly = searchParams.get('queue') === '1';
  const productsOnly = searchParams.get('products') === '1';
  const onlineOnly = searchParams.get('online') === '1';
  const rawPage = Number(searchParams.get('page') || 1);
  const page = Number.isSafeInteger(rawPage) ? Math.max(1, Math.min(rawPage, 100000)) : 1;
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [creators, setCreators] = useState<DiscoveryRow[]>([]);
  const [total, setTotal] = useState(0);
  const legacyQuery = !directory && ['q', 'open', 'queue', 'products', 'online'].some(key => searchParams.has(key));
  useEffect(() => { if (legacyQuery) navigate(`/discover/shops?${searchParams}`, { replace: true }); }, [legacyQuery, navigate, searchParams]);
  useEffect(() => setSearchInput(searchQuery), [searchQuery]);
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    next.delete('page');
    if (directory) setSearchParams(next); else navigate(`/discover/shops?${next}`);
  };
  useEffect(() => {
    if (legacyQuery) return;
    let active = true;
    setLoading(true); setLoadError(false);
    void Promise.resolve(supabase.rpc('get_public_shop_directory', {
      p_query: directory ? searchQuery : '', p_open: directory && openOnly,
      p_queue: directory && queueOnly, p_products: directory && productsOnly,
      p_online: directory && onlineOnly, p_page: directory ? page : 1, p_featured: !directory,
    })).then(({ data, error }) => {
      if (!active) return;
      if (error || !data || !Array.isArray(data.rows) || typeof data.total !== 'number') throw error || new Error('Invalid discovery response');
      setCreators(data.rows.map((row: DiscoveryRow) => ({ ...row, image_url: resolveAvatarUrl(row.image_url) })));
      setTotal(data.total);
    }).catch(error => { if (active) { console.error('[DiscoveryHome] load failed:', error); setLoadError(true); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [directory, searchQuery, openOnly, queueOnly, productsOnly, onlineOnly, page, retry, legacyQuery]);
  const pageUrl = (nextPage: number) => { const next = new URLSearchParams(searchParams); if (nextPage <= 1) next.delete('page'); else next.set('page', String(nextPage)); const query = next.toString(); return `/discover/shops${query ? `?${query}` : ''}`; };
  const changePage = (nextPage: number) => { navigate(pageUrl(nextPage)); document.getElementById('discovery-results')?.focus(); };
  const pages = Math.ceil(total / 10);

  return <PublicShell discovery>
    <main>
      {!directory && <><section className="discovery-intro public-width">
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
      </>}
      <section id="discover" data-testid="public-discovery" className="discovery-directory public-width">
        {directory && <Link to="/discover" className="public-text-link">← {th ? 'กลับหน้าแรก' : 'Back to home'}</Link>}
        <div className="discovery-heading"><span className="discovery-scribble" aria-hidden="true">Find your<br />favorites!</span><div><h2>{directory ? (th ? 'ค้นหาร้านค้า' : 'Explore shops') : t('discoveryHeading')}</h2><p>{t('discoverySearchHint')}</p></div></div>
        <form className="discovery-searchbar" onSubmit={event => { event.preventDefault(); setFilter('q', searchInput.trim()); }}><label className="discovery-search"><span className="sr-only">{th ? 'ค้นหาร้านค้า' : 'Search shops'}</span><Search size={21} aria-hidden="true" /><input id="public-creator-search" data-testid="public-creator-search" value={searchInput} maxLength={200} onChange={event => setSearchInput(event.target.value)} placeholder={t('discoveryPlaceholder')} autoComplete="off" />{searchInput && <button type="button" onClick={() => { setSearchInput(''); if (directory && searchQuery) setFilter('q', ''); }} aria-label={th ? 'ล้างคำค้น' : 'Clear search'}><X size={18} /></button>}</label><button type="submit" className="public-button public-primary">{t('discoverySearch')}</button></form>
        <div className="discovery-chips"><button type="button" className="public-button" aria-pressed={!openOnly && !queueOnly && !productsOnly && !onlineOnly} onClick={() => { if (directory) { const next = new URLSearchParams(searchParams); ['open', 'queue', 'products', 'online', 'page'].forEach(key => next.delete(key)); setSearchParams(next); } else navigate('/discover/shops'); }}><CalendarDays size={17} />{t('discoveryAll')}</button><button type="button" data-testid="public-open-now-filter" aria-pressed={openOnly} onClick={() => setFilter('open', openOnly ? '' : '1')} className="public-button discovery-filter"><span className="discovery-open-dot" />{t('homeOpenNow')}</button><button type="button" className="public-button" aria-pressed={queueOnly} onClick={() => setFilter('queue', queueOnly ? '' : '1')}><Users size={17} />{t('discoveryQueue')}</button><button type="button" className="public-button" aria-pressed={productsOnly} onClick={() => setFilter('products', productsOnly ? '' : '1')}><ShoppingBag size={17} />{t('discoveryProducts')}</button><button type="button" className="public-button" aria-pressed={onlineOnly} onClick={() => setFilter('online', onlineOnly ? '' : '1')}><Store size={17} />{t('onlineShop')}</button></div>
        {queueOnly && <p className="discovery-filter-note">{t('discoveryQueueHint')}</p>}
        <div id="discovery-results" tabIndex={-1}>
        {loading ? <p className="discovery-feedback" role="status">{t('homeLoadingCreators')}</p> : loadError ? <div className="discovery-feedback" role="alert"><h3>{th ? 'โหลดรายชื่อร้านค้าไม่ได้' : 'Could not load shops'}</h3><button className="public-button" onClick={() => setRetry(value => value + 1)}>{th ? 'ลองใหม่' : 'Retry'}</button></div> : <>
          <p className="discovery-result-count" role="status">{directory ? (th ? `พบ ${total} ร้าน` : `${total} shops`) : (th ? 'ร้านแนะนำ · สลับทุก 30 นาที' : 'Featured shops · changes every 30 minutes')}</p>
          {creators.length ? <div className="discovery-grid">{creators.map(creator => <CreatorCard key={creator.artist_id} creator={creator} liked={liked.has(creator.artist_id)} onLike={() => setLiked(current => { const next = new Set(current); if (next.has(creator.artist_id)) next.delete(creator.artist_id); else next.add(creator.artist_id); return next; })} />)}</div> : <div className="discovery-feedback"><Search size={28} aria-hidden="true" /><h3>{th ? 'ยังไม่พบร้านที่ค้นหา' : 'No shops found yet'}</h3><p>{th ? 'ลองชื่ออื่น หรือดูร้านทั้งหมด บางร้านอาจยังไม่ได้เผยแพร่หน้าร้าน' : 'Try another name or browse all shops. Some sellers may not have published their shop yet.'}</p>{directory && <button className="public-button" onClick={() => setSearchParams({})}>{th ? 'ดูร้านทั้งหมด' : 'Show all shops'}</button>}</div>}
          {!directory && <div className="discovery-pagination"><Link className="public-button public-primary" to="/discover/shops">{th ? 'ดูร้านเพิ่มเติม' : 'Explore more shops'} <ArrowRight size={18} /></Link></div>}
          {directory && pages > 1 && <nav className="discovery-pagination" aria-label={th ? 'หน้ารายชื่อร้าน' : 'Shop result pages'}>{page > 1 ? <Link className="public-button" to={pageUrl(page - 1)} onClick={() => document.getElementById('discovery-results')?.focus()}>{th ? 'ก่อนหน้า' : 'Previous'}</Link> : <span className="public-button" aria-disabled="true">{th ? 'ก่อนหน้า' : 'Previous'}</span>}<span>{th ? 'หน้า' : 'Page'} {page} / {pages}</span>{page < pages ? <Link className="public-button" to={pageUrl(page + 1)} onClick={() => document.getElementById('discovery-results')?.focus()}>{th ? 'ถัดไป' : 'Next'}</Link> : <span className="public-button" aria-disabled="true">{th ? 'ถัดไป' : 'Next'}</span>}</nav>}
          {directory && page > pages && pages > 0 && <button className="public-button" onClick={() => changePage(pages)}>{th ? 'ไปหน้าสุดท้าย' : 'Go to last page'}</button>}
        </>}
        </div>
      </section>
      {!directory && <section className="discovery-finale"><div className="public-width"><span className="discovery-mini-ticket" aria-hidden="true">MORE<br />SHOPS<br />BRIGHTER<br />EVENTS <Star size={18} /></span><div><p className="public-kicker">{t('discoveryBottomEyebrow')}</p><h2>{t('discoveryBottomTitle')}</h2><p>{t('discoveryBottomBody')}</p></div><a className="public-button public-primary" href="#discover">{t('discoveryBottomButton')}<ArrowRight size={18} /></a><div className="discovery-mascot" aria-hidden="true"><span>• ᴗ •</span><Star size={19} fill="currentColor" /></div></div></section>}
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
  const categories = creator.categories || [...new Set(products.map(product => product.category).filter(Boolean))].slice(0, 3).join(' · ');
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
