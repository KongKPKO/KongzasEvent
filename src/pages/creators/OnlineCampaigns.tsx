import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Loader2, Plus, ShoppingBag } from 'lucide-react';
import AdminHeader from '../../components/AdminHeader';
import { useI18n } from '../../i18n';
import { listMyOnlineCampaigns } from '../../lib/onlineCampaigns';
import { supabase } from '../../supabaseClient';
import type { ActorContext } from '../../types/access';
import type { OnlineCampaignSummary } from '../../types/onlineCampaign';
import { fetchActorContext } from '../../utils/access';
import { formatPrice } from '../../utils/currency';

const toLocalInput = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

export default function OnlineCampaigns() {
  const navigate = useNavigate();
  const { t, dateLocale } = useI18n();
  const [actor, setActor] = useState<ActorContext | null>(null);
  const [campaigns, setCampaigns] = useState<OnlineCampaignSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [opensAt, setOpensAt] = useState(() => toLocalInput(new Date(Date.now() + 60 * 60_000)));
  const [closesAt, setClosesAt] = useState(() => toLocalInput(new Date(Date.now() + 7 * 24 * 60 * 60_000)));
  const [shippingEnabled, setShippingEnabled] = useState(true);
  const [pickupEnabled, setPickupEnabled] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [context, rows] = await Promise.all([fetchActorContext(), listMyOnlineCampaigns()]);
      setActor(context);
      setCampaigns(rows);
    } catch (loadError) {
      console.error(loadError);
      setError(t('campaignLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const groups = useMemo(() => ({
    active: campaigns.filter((campaign) => ['open', 'sold_out'].includes(campaign.state)),
    scheduled: campaigns.filter((campaign) => ['draft', 'scheduled'].includes(campaign.state)),
    past: campaigns.filter((campaign) => ['closed', 'cancelled', 'archived'].includes(campaign.state)),
  }), [campaigns]);
  const canManage = actor?.role === 'owner' || actor?.role === 'manager';

  const createCampaign = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!actor?.artist_id || !name.trim() || (!shippingEnabled && !pickupEnabled)) return;
    setCreating(true);
    setError('');
    try {
      const slugBase = name.trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'campaign-' + Date.now();
      const { data, error: createError } = await supabase
        .from('online_campaigns')
        .insert({
          artist_id: actor.artist_id,
          name: name.trim(),
          slug: slugBase + '-' + Date.now().toString(36),
          opens_at: new Date(opensAt).toISOString(),
          closes_at: new Date(closesAt).toISOString(),
          campaign_timezone: 'Asia/Bangkok',
          currency: 'THB',
          shipping_enabled: shippingEnabled,
          pickup_enabled: pickupEnabled,
          flat_shipping_fee: 0,
          publication_status: 'draft',
        })
        .select('id')
        .single();
      if (createError) throw createError;
      navigate('/manage-online-sales/' + data.id);
    } catch (createError) {
      console.error(createError);
      setError(t('campaignCreateFailed'));
    } finally {
      setCreating(false);
    }
  };

  const renderGroup = (title: string, items: OnlineCampaignSummary[]) => (
    <section className="space-y-3">
      <h2 className="text-sm font-black uppercase tracking-wide text-gray-500">{title}</h2>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-6 text-sm font-semibold text-gray-400">
          {t('campaignEmptyGroup')}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map((campaign) => (
            <button
              key={campaign.id}
              type="button"
              onClick={() => navigate('/manage-online-sales/' + campaign.id)}
              className="rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-pink-200 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-base font-black text-gray-950">{campaign.name}</div>
                  <div className="mt-1 text-xs font-semibold text-gray-500">
                    {new Date(campaign.opens_at).toLocaleString(dateLocale)} – {new Date(campaign.closes_at).toLocaleString(dateLocale)}
                  </div>
                </div>
                <span className="rounded-full bg-pink-50 px-2.5 py-1 text-xs font-black text-pink-700">
                  {t(('campaignState_' + campaign.state) as Parameters<typeof t>[0])}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl bg-gray-50 p-3">
                  <div className="text-xs font-bold text-gray-500">{t('campaignRevenue')}</div>
                  <div className="mt-1 font-black text-gray-950">{formatPrice(Number(campaign.confirmed_revenue || 0), campaign.currency)}</div>
                </div>
                <div className="rounded-xl bg-amber-50 p-3">
                  <div className="text-xs font-bold text-amber-700">{t('campaignNeedsAction')}</div>
                  <div className="mt-1 text-lg font-black text-amber-900">{campaign.action_count || 0}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="min-h-screen bg-gray-50 text-slate-800">
      <AdminHeader activePage="online-sales" actorRole={actor?.role} userEmail={actor?.member_email} />
      <main className="mx-auto w-full max-w-[1140px] space-y-6 px-4 py-6 md:px-6">
        <header className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-pink-100 text-pink-700"><ShoppingBag size={22} /></span>
          <div>
            <h1 className="text-xl font-black text-gray-950">{t('campaignOnlineSales')}</h1>
            <p className="text-sm font-semibold text-gray-500">{t('campaignOnlineSalesBody')}</p>
          </div>
        </header>

        {canManage && <form onSubmit={createCampaign} className="rounded-2xl border border-pink-100 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Plus size={18} className="text-pink-600" />
            <h2 className="font-black text-gray-950">{t('campaignCreateTitle')}</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="md:col-span-3">
              <span className="text-xs font-black text-gray-600">{t('campaignName')}</span>
              <input value={name} onChange={(event) => setName(event.target.value)} required className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3" />
            </label>
            <label>
              <span className="text-xs font-black text-gray-600">{t('campaignOpensAt')}</span>
              <input type="datetime-local" value={opensAt} onChange={(event) => setOpensAt(event.target.value)} required className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3" />
            </label>
            <label>
              <span className="text-xs font-black text-gray-600">{t('campaignClosesAt')}</span>
              <input type="datetime-local" value={closesAt} onChange={(event) => setClosesAt(event.target.value)} required className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3" />
            </label>
            <div className="flex min-h-11 items-end gap-3">
              <label className="flex min-h-11 items-center gap-2 text-sm font-bold"><input type="checkbox" checked={shippingEnabled} onChange={(event) => setShippingEnabled(event.target.checked)} />{t('campaignShipping')}</label>
              <label className="flex min-h-11 items-center gap-2 text-sm font-bold"><input type="checkbox" checked={pickupEnabled} onChange={(event) => setPickupEnabled(event.target.checked)} />{t('campaignPickup')}</label>
            </div>
          </div>
          {error && <p className="mt-3 text-sm font-bold text-red-700">{error}</p>}
          <button disabled={creating || !name.trim() || (!shippingEnabled && !pickupEnabled)} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-pink-600 px-4 text-sm font-black text-white disabled:opacity-50">
            {creating ? <Loader2 className="animate-spin" size={16} /> : <CalendarClock size={16} />}
            {creating ? t('campaignCreating') : t('campaignCreate')}
          </button>
        </form>}

        {loading ? (
          <div className="flex items-center gap-2 text-sm font-bold text-gray-500"><Loader2 className="animate-spin" size={16} />{t('loading')}</div>
        ) : (
          <>
            {renderGroup(t('campaignGroupActive'), groups.active)}
            {renderGroup(t('campaignGroupScheduled'), groups.scheduled)}
            {renderGroup(t('campaignGroupPast'), groups.past)}
          </>
        )}
      </main>
    </div>
  );
}
