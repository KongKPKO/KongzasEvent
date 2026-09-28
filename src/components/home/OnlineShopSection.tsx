import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronRight } from 'lucide-react';
import { listPublicOnlineCampaigns } from '../../lib/onlineCampaigns';
import type { DiscoverableOnlineCampaign } from '../../types/onlineCampaign';
import { useI18n } from '../../i18n';
import { ShopImage } from '../menu/StorefrontHeader';

export default function OnlineShopSection({ artistSlug }: { artistSlug: string }) {
  const { t, dateLocale } = useI18n();
  const [campaigns, setCampaigns] = useState<DiscoverableOnlineCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    listPublicOnlineCampaigns(artistSlug).then(data => {
      if (active) setCampaigns(data);
    }).catch(error => {
      console.error('[OnlineShopSection] load failed:', error);
      if (active) setFailed(true);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [artistSlug, retry]);

  if (!loading && !failed && !campaigns.length) return null;
  return <section aria-labelledby="online-shop-heading" className="px-4 py-6 sm:px-8" data-testid="online-shop-section">
    <div className="mb-4 flex items-center justify-between gap-3">
      <div><h2 id="online-shop-heading" className="text-xl font-black text-gray-950">{t('onlineShop')}</h2><p className="mt-1 text-sm text-gray-600">{t('onlineShopSubtitle')}</p></div>
      {!loading && !failed && campaigns.length > 2 && <button type="button" className="min-h-11 shrink-0 rounded-full px-3 text-sm font-bold text-pink-700 hover:bg-pink-50" aria-expanded={expanded} aria-controls="online-shop-cards" onClick={() => setExpanded(value => !value)}>{t(expanded ? 'onlineShopShowLess' : 'onlineShopViewAll')}</button>}
    </div>
    {loading ? <div className="min-h-36 rounded-3xl bg-pink-50 p-5 text-sm text-gray-600" role="status">{t('onlineShopLoading')}</div> : failed ? <div role="alert" className="rounded-3xl border border-pink-100 p-4 text-sm"><p>{t('onlineShopError')}</p><button className="mt-2 min-h-11 rounded-full px-4 font-bold text-pink-700 hover:bg-pink-50" onClick={() => setRetry(value => value + 1)}>{t('onlineShopRetry')}</button></div> : <div id="online-shop-cards" className="grid gap-3 md:grid-cols-2">
      {(expanded ? campaigns : campaigns.slice(0, 2)).map(campaign => {
        const scheduled = campaign.state === 'scheduled';
        const date = new Intl.DateTimeFormat(dateLocale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: campaign.campaign_timezone }).format(new Date(scheduled ? campaign.opens_at : campaign.closes_at));
        return <Link key={campaign.id} to={`/${campaign.artist_slug}/campaign/${campaign.slug}`} className="flex min-h-36 items-center gap-3 rounded-3xl border border-pink-100 bg-white p-3 shadow-sm transition hover:border-pink-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pink-600">
          <div className="h-24 w-20 shrink-0 overflow-hidden rounded-2xl bg-pink-50"><ShopImage name={campaign.name} src={campaign.image_url} className="h-full w-full object-cover" /></div>
          <div className="min-w-0 flex-1"><span className="inline-block rounded-full bg-pink-50 px-2 py-1 text-xs font-bold text-pink-700">{t(campaign.state === 'sold_out' ? 'campaignState_sold_out' : scheduled ? 'campaignState_scheduled' : 'campaignState_open')}</span><h3 className="mt-1 break-words font-bold text-gray-950">{campaign.name}</h3>{campaign.description && <p className="mt-1 line-clamp-2 text-sm text-gray-600">{campaign.description}</p>}<p className="mt-2 flex items-start gap-1 text-xs text-gray-600"><CalendarDays size={14} className="shrink-0" aria-hidden="true" /><span>{t(scheduled ? 'onlineShopOpens' : 'onlineShopCloses')} <time dateTime={scheduled ? campaign.opens_at : campaign.closes_at}>{date}</time></span></p></div>
          <ChevronRight size={18} className="shrink-0 text-pink-700" aria-hidden="true" />
        </Link>;
      })}
    </div>}
  </section>;
}
