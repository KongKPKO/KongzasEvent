import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Monitor, Users } from 'lucide-react';
import { canAccessManagementPages, canAccessQueuePages, canUsePos } from '../types/access';
import type { ActorRole } from '../types/access';
import { supabase } from '../supabaseClient';

export type EventTabKey = 'overview' | 'dashboard' | 'catalog' | 'promotion' | 'preorder' | 'pickup' | 'history';

interface EventNavTabsProps {
  eventId: string;
  active?: EventTabKey;
  actorRole?: ActorRole | null;
  // Pages that already hold the event can pass its mode to skip the lookup.
  sellingMode?: string | null;
}

// Persistent second-layer navigation: every event-scoped page shows the same
// tab bar, so staff never leave the event context to reach another module.
export default function EventNavTabs({ eventId, active, actorRole, sellingMode }: EventNavTabsProps) {
  const navigate = useNavigate();
  // Pages that render this without an actorContext are management-only routes.
  const role = actorRole ?? 'manager';

  // An event runs in one mode at a time (pre-order -> live -> post-event), so the
  // order tab is named for the mode it actually serves. Look it up when the host
  // page didn't supply it, so the label stays consistent across every event page.
  const [resolvedMode, setResolvedMode] = useState<string | null>(sellingMode ?? null);
  useEffect(() => {
    if (sellingMode !== undefined && sellingMode !== null) {
      setResolvedMode(sellingMode);
      return;
    }
    let active = true;
    supabase
      .from('events')
      .select('selling_mode')
      .eq('id', eventId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setResolvedMode((data?.selling_mode as string | undefined) ?? null);
      });
    return () => { active = false; };
  }, [eventId, sellingMode]);

  const isPostEvent = resolvedMode === 'post_event';
  const orderTabLabel = isPostEvent ? 'Post-order' : 'Pre-order';

  const tabs: Array<{ key: EventTabKey; label: string; path: string; visible: boolean }> = [
    { key: 'overview', label: 'Overview', path: `/manage-events/${eventId}/workspace`, visible: canAccessQueuePages(role) },
    { key: 'dashboard', label: 'Dashboard', path: `/manage-events/${eventId}/dashboard`, visible: canAccessManagementPages(role) },
    { key: 'catalog', label: 'Event Catalog', path: `/manage-events/${eventId}/catalog`, visible: canAccessManagementPages(role) },
    { key: 'promotion', label: 'Event Promotion', path: `/manage-events/${eventId}/promotion`, visible: canAccessManagementPages(role) },
    { key: 'preorder', label: orderTabLabel, path: `/manage-events/${eventId}/preorder-dashboard`, visible: canUsePos(role) },
    { key: 'pickup', label: isPostEvent ? 'Shipping' : 'Pickup', path: `/manage-events/${eventId}/pickup`, visible: canAccessQueuePages(role) },
    { key: 'history', label: 'History', path: `/manage-events/${eventId}/history`, visible: canAccessManagementPages(role) },
  ];

  const liveActions: Array<{ label: string; path: string; icon: typeof Users; visible: boolean }> = [
    { label: 'Live Queue', path: `/live/queue?eventId=${eventId}`, icon: Users, visible: canAccessQueuePages(role) },
    { label: 'Live POS', path: `/live/pos?eventId=${eventId}`, icon: Monitor, visible: canUsePos(role) },
  ];

  return (
    <nav aria-label="Event sections" className="mb-5 flex flex-wrap items-center gap-2">
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-2xl border border-gray-200 bg-white p-1 shadow-sm">
        {tabs.filter((tab) => tab.visible).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => navigate(tab.path)}
            aria-current={active === tab.key ? 'page' : undefined}
            className={`min-h-10 shrink-0 rounded-xl px-3.5 text-sm font-black transition-colors ${
              active === tab.key
                ? 'bg-pink-600 text-white shadow-sm'
                : 'text-gray-600 hover:bg-pink-50 hover:text-pink-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {liveActions.filter((action) => action.visible).map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => navigate(action.path)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-indigo-100 bg-indigo-50 px-3 text-sm font-black text-indigo-800 hover:bg-indigo-100"
          >
            <action.icon size={15} /> {action.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
