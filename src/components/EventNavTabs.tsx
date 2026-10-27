import { useEffect, useRef, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Monitor, Users } from 'lucide-react';
import { canAccessManagementPages, canAccessQueuePages, canUsePos } from '../types/access';
import type { ActorRole } from '../types/access';
import { uiText, useI18n } from '../i18n';

export type EventTabKey = 'settings' | 'overview' | 'dashboard' | 'catalog' | 'promotion' | 'preorder' | 'postorder' | 'pickup' | 'history';

interface EventNavTabsProps {
  eventId: string;
  eventName: string;
  children?: ReactNode;
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
export default function EventNavTabs({ eventId, eventName, active, actorRole, children }: EventNavTabsProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { language } = useI18n();
  const tabsRef = useRef<HTMLDivElement>(null);
  const th = language === 'th';
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }); }, [eventId, active]);
  useEffect(() => {
    const list = tabsRef.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !current) return;
    const bounds = list.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    if (item.right > bounds.right) list.scrollLeft += item.right - bounds.right;
    else if (item.left < bounds.left) list.scrollLeft -= bounds.left - item.left;
  }, [active, eventId, language]);
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
    <section className="mb-5" aria-label={th ? 'อีเวนต์ที่กำลังจัดการ' : 'Current event'} data-event-context={eventId}>
      <header className="mb-3 rounded-2xl border border-pink-100 bg-gradient-to-r from-pink-50 to-white px-4 py-4 sm:px-5">
        <button type="button" onClick={() => navigate('/manage-events?view=all')} className="mb-2 inline-flex min-h-11 items-center gap-2 rounded-lg text-xs font-bold text-pink-800 hover:text-pink-600">
          <ArrowLeft size={15} aria-hidden="true" />{th ? 'ดูอีเวนต์ทั้งหมด' : 'All events'}
        </button>
        <p className="text-xs font-bold text-pink-700">{th ? 'กำลังจัดการอีเวนต์' : 'Event workspace'}</p>
        <h1 className="mt-1 break-words text-2xl font-black tracking-tight text-gray-950 sm:text-3xl">{eventName}</h1>
        {children}
        <p className="mt-2 text-sm font-bold text-gray-700">{th ? 'หน้าปัจจุบัน' : 'Current page'} · {tabs.find(tab => tab.key === active)?.label}</p>
      </header>
      <nav aria-label={th ? "เมนูอีเวนต์" : "Event sections"} className="flex flex-wrap items-center gap-2">
        <p className="w-full text-xs font-bold text-gray-600 sm:hidden">{th ? 'เมนูอีเวนต์ · เลื่อนดูเพิ่มเติม' : 'Event sections · swipe for more'}</p>
        <div ref={tabsRef} className="flex w-full min-w-0 flex-nowrap overflow-x-auto sm:flex-wrap items-center gap-1 rounded-2xl border border-gray-200 bg-white p-1 shadow-sm">
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
              {uiText(language, tab.label)}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {liveActions.filter((action) => action.visible).map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => navigate(action.path)}
              className="inline-flex min-h-11 whitespace-nowrap items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-900 px-3 text-sm font-black text-white hover:bg-slate-800"
            >
              <action.icon size={15} /> {uiText(language, action.label)}
            </button>
          ))}
        </div>
      </nav>
    </section>
  );
}
