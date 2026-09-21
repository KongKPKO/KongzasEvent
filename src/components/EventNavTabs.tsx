import { useEffect } from 'react';
import { useI18n } from '../i18n';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Monitor, Users } from 'lucide-react';
import { canAccessManagementPages, canAccessQueuePages, canUsePos } from '../types/access';
import type { ActorRole } from '../types/access';

export type EventTabKey = 'settings' | 'overview' | 'dashboard' | 'catalog' | 'promotion' | 'preorder' | 'postorder' | 'pickup' | 'history';

interface EventNavTabsProps {
  eventId: string;
  active?: EventTabKey;
  actorRole?: ActorRole | null;
  // Accepted for call-site compatibility; tabs no longer vary by mode.
  sellingMode?: string | null;
}

// Persistent second-layer navigation: every event-scoped page shows the same
// tab bar, so staff never leave the event context to reach another module.
// Pre-order and post-event are separate timelines of one event, so both order
// tabs are always shown — a finished pre-order phase stays viewable after the
// post-event store opens.
export default function EventNavTabs({ eventId, active, actorRole }: EventNavTabsProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { language, setLanguage } = useI18n();
  const th = language === 'th';
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }); }, [eventId, active]);
  // Pages that render this without an actorContext are management-only routes.
  const role = actorRole ?? 'manager';

  const tabs: Array<{ key: EventTabKey; label: string; path: string; visible: boolean }> = [
    { key: 'overview', label: th ? 'เตรียมงาน' : 'Prepare event', path: `/manage-events/${eventId}/workspace`, visible: canAccessQueuePages(role) },
    { key: 'catalog', label: th ? 'สินค้าและสต็อก' : 'Products & stock', path: `/manage-events/${eventId}/catalog`, visible: canAccessManagementPages(role) },
    { key: 'settings', label: th ? 'ช่วงขายและรับเงิน' : 'Schedule & payment', path: `/manage-events/${eventId}/preorder`, visible: canAccessManagementPages(role) },
    { key: 'promotion', label: th ? 'โปรโมชัน' : 'Promotions', path: `/manage-events/${eventId}/promotion`, visible: canAccessManagementPages(role) },
    { key: 'preorder', label: th ? 'ออเดอร์ก่อนงาน' : 'Pre-orders', path: `/manage-events/${eventId}/preorder-dashboard`, visible: canUsePos(role) },
    { key: 'postorder', label: th ? 'ออเดอร์หลังงาน' : 'Post-orders', path: `/manage-events/${eventId}/postorder-dashboard`, visible: canUsePos(role) },
    { key: 'pickup', label: th ? 'รับสินค้า' : 'Pickup', path: `/manage-events/${eventId}/pickup`, visible: canAccessQueuePages(role) },
    { key: 'dashboard', label: th ? 'ยอดขาย' : 'Sales', path: `/manage-events/${eventId}/dashboard`, visible: canAccessManagementPages(role) },
    { key: 'history', label: th ? 'ประวัติ' : 'History', path: `/manage-events/${eventId}/history`, visible: canAccessManagementPages(role) },
  ];

  const liveActions: Array<{ label: string; path: string; icon: typeof Users; visible: boolean }> = [
    { label: th ? 'จัดการคิว' : 'Live Queue', path: `/live/queue?eventId=${eventId}`, icon: Users, visible: canAccessQueuePages(role) },
    { label: th ? 'ขายหน้าบูธ' : 'Live POS', path: `/live/pos?eventId=${eventId}`, icon: Monitor, visible: canUsePos(role) },
  ];

  const openTab = (key: string) => {
    const tab = tabs.find(item => item.key === key && item.visible);
    if (!tab) return;
    const dates = new URLSearchParams();
    if (tab.key === 'dashboard' || tab.key === 'history') {
      for (const name of ['from', 'to']) { const value = searchParams.get(name); if (value) dates.set(name, value); }
    }
    navigate(tab.path + (dates.size ? `?${dates}` : ''));
  };

  return (
    <nav aria-label={th ? "เมนูอีเวนต์" : "Event sections"} className="mb-5 flex flex-wrap items-center gap-2">
      <label className="grid w-full min-w-0 gap-1 text-xs font-bold text-gray-600 sm:hidden">
        {th ? 'หน้าของอีเวนต์' : 'Event page'}
        <select value={active || ''} onChange={event => openTab(event.target.value)} className="min-h-11 w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-pink-900">
          <option value="" disabled>{th ? 'เลือกหน้า' : 'Choose a page'}</option>
          {tabs.filter(tab => tab.visible).map(tab => <option key={tab.key} value={tab.key}>{tab.label}</option>)}
        </select>
      </label>
      <div className="hidden w-full min-w-0 flex-wrap sm:flex items-center gap-1 rounded-2xl border border-gray-200 bg-white p-1 shadow-sm">
        {tabs.filter((tab) => tab.visible).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => openTab(tab.key)}
            aria-current={active === tab.key ? 'page' : undefined}
            className={`min-h-11 whitespace-nowrap shrink-0 rounded-xl px-3.5 text-sm font-black transition-colors ${
              active === tab.key
                ? 'bg-pink-600 text-white shadow-sm'
                : 'text-pink-900 hover:bg-pink-50 hover:text-pink-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1" aria-label="Language">
          {(['th', 'en'] as const).map(value => <button key={value} type="button" aria-pressed={language === value} onClick={() => setLanguage(value)} className={`min-h-11 rounded-lg px-3 text-sm font-bold ${language === value ? 'bg-pink-50 text-pink-700' : 'text-gray-500'}`}>{value.toUpperCase()}</button>)}
        </div>
        {liveActions.filter((action) => action.visible).map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => navigate(action.path)}
            className="inline-flex min-h-11 whitespace-nowrap items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-900 px-3 text-sm font-black text-white hover:bg-slate-800"
          >
            <action.icon size={15} /> {action.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
