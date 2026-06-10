import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BarChart2,
  Calendar,
  CheckCircle2,
  Clock,
  Coffee,
  FileText,
  PackageCheck,
  ReceiptText,
  Settings,
  ShoppingCart,
  Ticket,
  Users,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';
import AdminHeader from '../../components/AdminHeader';
import { supabase } from '../../supabaseClient';
import type { ActorContext } from '../../types/access';
import { canAccessManagementPages, canAccessQueuePages, canUsePos } from '../../types/access';
import type { EventSellingMode, OrderType, PickupStatus } from '../../types/preorder';
import { normalizeEventRecord } from '../../utils/schemaCompat';
import {
  formatDateTimeForInput,
  getBrowserTimeZone,
  getEventTimeZoneOptions,
  parseDateTimeInputInTimeZone,
} from '../../utils/timezone';

interface EventWorkspaceProps {
  actorContext: ActorContext;
}

interface WorkspaceEvent {
  id: string;
  artist_id: string;
  event_name: string;
  start_date: string;
  end_date: string;
  event_timezone?: string | null;
  selling_mode?: EventSellingMode | null;
  preorder_opens_at?: string | null;
  preorder_closes_at?: string | null;
  preorder_pickup_instructions?: string | null;
  status?: string | null;
  is_booth_open?: boolean | null;
  location?: string | null;
  booth_detail?: string | null;
  location_name?: string | null;
  location_detail?: string | null;
  booth_number?: string | null;
  queueing_area?: string | null;
  entrance_fee?: string | null;
  transit_info?: string | null;
}

interface WorkspaceOrder {
  id: string;
  event_id: string;
  status: string | null;
  total_price: number | null;
  currency: string | null;
  order_type: OrderType | null;
  pickup_status: PickupStatus | null;
}

interface WorkspaceQueue {
  id: string;
  event_id: string;
  status: string | null;
}

interface WorkspaceProduct {
  id: string;
  status?: string | null;
  stock_total?: number | null;
  stock_reserved?: number | null;
  stock_sold?: number | null;
  is_unlimited?: boolean | null;
}

interface WorkspaceMetrics {
  awaitingPickup: number;
  completedOrders: number;
  queueWaiting: number;
  revenue: number;
  currency: string;
  productCount: number;
  sellingProductCount: number;
}

type ModulePriority = 'P' | 'S' | 'M';
type ModuleTone = 'pink' | 'slate' | 'emerald' | 'amber' | 'teal' | 'indigo' | 'cyan';

interface ModuleCardConfig {
  id: string;
  title: string;
  metric: string;
  detail: string;
  cta: string;
  href: string;
  action?: 'edit-event';
  priority: ModulePriority;
  tone: ModuleTone;
  icon: LucideIcon;
}

const emptyMetrics: WorkspaceMetrics = {
  awaitingPickup: 0,
  completedOrders: 0,
  queueWaiting: 0,
  revenue: 0,
  currency: 'THB',
  productCount: 0,
  sellingProductCount: 0,
};

const priorityRank: Record<ModulePriority, number> = { P: 0, S: 1, M: 2 };

const toneClasses: Record<ModuleTone, { card: string; icon: string; cta: string; badge: string }> = {
  pink: {
    card: 'border-pink-100 bg-pink-50/40',
    icon: 'bg-pink-100 text-pink-700',
    cta: 'bg-pink-600 text-white hover:bg-pink-700',
    badge: 'text-pink-700 bg-pink-100',
  },
  slate: {
    card: 'border-gray-200 bg-white',
    icon: 'bg-gray-100 text-gray-700',
    cta: 'bg-slate-900 text-white hover:bg-slate-800',
    badge: 'text-gray-700 bg-gray-100',
  },
  emerald: {
    card: 'border-emerald-100 bg-emerald-50/40',
    icon: 'bg-emerald-100 text-emerald-700',
    cta: 'bg-emerald-700 text-white hover:bg-emerald-800',
    badge: 'text-emerald-700 bg-emerald-100',
  },
  amber: {
    card: 'border-amber-100 bg-amber-50/50',
    icon: 'bg-amber-100 text-amber-800',
    cta: 'bg-amber-700 text-white hover:bg-amber-800',
    badge: 'text-amber-800 bg-amber-100',
  },
  teal: {
    card: 'border-teal-100 bg-teal-50/40',
    icon: 'bg-teal-100 text-teal-700',
    cta: 'bg-teal-700 text-white hover:bg-teal-800',
    badge: 'text-teal-700 bg-teal-100',
  },
  indigo: {
    card: 'border-indigo-100 bg-indigo-50/40',
    icon: 'bg-indigo-100 text-indigo-900',
    cta: 'bg-indigo-800 text-white hover:bg-indigo-900',
    badge: 'text-indigo-900 bg-indigo-100',
  },
  cyan: {
    card: 'border-cyan-100 bg-cyan-50/40',
    icon: 'bg-cyan-100 text-cyan-800',
    cta: 'bg-cyan-700 text-white hover:bg-cyan-800',
    badge: 'text-cyan-800 bg-cyan-100',
  },
};

const formatMoney = (amount: number, currency: string) =>
  new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'THB' ? 0 : 2,
  }).format(amount || 0);

const formatEventDate = (event: WorkspaceEvent) => {
  const date = new Date(event.start_date);
  if (Number.isNaN(date.getTime())) return '-';

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: event.event_timezone || getBrowserTimeZone(),
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
};

const getLifecycleContext = (event: WorkspaceEvent) => {
  const now = new Date();
  const start = new Date(event.start_date);
  const end = new Date(event.end_date);
  const sellingMode = event.selling_mode || 'live';

  if (
    sellingMode === 'closed' ||
    event.status === 'Ended' ||
    event.status === 'Cancelled' ||
    (!Number.isNaN(end.getTime()) && end < now)
  ) {
    return 'ended';
  }

  if (sellingMode === 'preorder') {
    const opens = event.preorder_opens_at ? new Date(event.preorder_opens_at) : null;
    const closes = event.preorder_closes_at ? new Date(event.preorder_closes_at) : null;
    if (
      opens &&
      closes &&
      !Number.isNaN(opens.getTime()) &&
      !Number.isNaN(closes.getTime()) &&
      opens <= now &&
      closes >= now
    ) {
      return 'preorderOpen';
    }
    return 'prep';
  }

  if (!Number.isNaN(start.getTime()) && start > now) {
    return 'prep';
  }

  return event.is_booth_open ? 'liveOpen' : 'liveClosed';
};

const getContextLabel = (event: WorkspaceEvent, metrics: WorkspaceMetrics) => {
  const context = getLifecycleContext(event);
  if (metrics.awaitingPickup > 0) return `${metrics.awaitingPickup} awaiting pickup`;
  if (context === 'ended') return 'Ended / records';
  if (context === 'preorderOpen') return 'Pre-order open';
  if (context === 'prep') return 'Prep';
  return event.is_booth_open ? 'Booth open' : 'Booth closed';
};

const buildModules = (
  event: WorkspaceEvent,
  metrics: WorkspaceMetrics,
  actorContext: ActorContext
): ModuleCardConfig[] => {
  const context = getLifecycleContext(event);
  const management = canAccessManagementPages(actorContext.role);
  const queueAccess = canAccessQueuePages(actorContext.role);
  const posAccess = canUsePos(actorContext.role);
  const ended = context === 'ended';
  const awaiting = metrics.awaitingPickup > 0;
  const modules: ModuleCardConfig[] = [];

  const add = (card: ModuleCardConfig, allowed: boolean) => {
    if (allowed) modules.push(card);
  };

  add({
    id: 'settings',
    title: 'Event Settings',
    metric: formatEventDate(event),
    detail: ended ? 'Review event details after the booth closes.' : 'Update time, place, booth detail, and operating status.',
    cta: ended ? 'View settings' : 'Edit event',
    href: '',
    action: 'edit-event',
    priority: context === 'prep' ? 'P' : ended ? 'M' : 'S',
    tone: 'slate',
    icon: Settings,
  }, management);

  add({
    id: 'catalog',
    title: 'Catalog / Stock',
    metric: `${metrics.sellingProductCount}/${metrics.productCount} selling`,
    detail: metrics.sellingProductCount > 0 ? 'Products are available for this event.' : 'Set event products before opening sales.',
    cta: metrics.sellingProductCount > 0 ? 'Manage stock' : 'Set up catalog',
    href: `/manage-products?tab=event-catalog&eventId=${event.id}`,
    priority: context === 'prep' || context === 'preorderOpen' ? 'P' : ended ? 'M' : 'S',
    tone: 'amber',
    icon: Coffee,
  }, management);

  add({
    id: 'preorder',
    title: 'Pre-order Settings',
    metric: event.selling_mode === 'preorder' ? 'Enabled' : 'Live mode',
    detail: event.selling_mode === 'preorder' ? 'Pickup window and instructions are configured here.' : 'Switch selling mode or set pre-order windows.',
    cta: 'Configure pre-order',
    href: `/manage-events/${event.id}/preorder`,
    priority: context === 'prep' || context === 'preorderOpen' ? 'P' : 'M',
    tone: 'pink',
    icon: Ticket,
  }, management && !ended);

  add({
    id: 'preorder-dashboard',
    title: 'Pre-order Dashboard',
    metric: `${metrics.awaitingPickup} pickup-ready`,
    detail: 'Review transfers and export product totals before ordering from the factory.',
    cta: 'Open dashboard',
    href: `/manage-events/${event.id}/preorder-dashboard`,
    priority: context === 'prep' || context === 'preorderOpen' ? 'P' : 'M',
    tone: 'emerald',
    icon: ReceiptText,
  }, management && event.selling_mode === 'preorder');

  add({
    id: 'pickup',
    title: 'Pickup Orders',
    metric: `${metrics.awaitingPickup} awaiting`,
    detail: awaiting ? 'Pre-orders are waiting for staff pickup confirmation.' : ended ? 'Review pickup records and expire no-shows.' : 'No pre-order pickups are currently waiting.',
    cta: awaiting ? 'Open pickup list' : ended ? 'Review pickups' : 'View pickups',
    href: `/manage-events/${event.id}/pickup`,
    priority: awaiting || ended ? 'P' : 'S',
    tone: 'teal',
    icon: PackageCheck,
  }, queueAccess);

  add({
    id: 'queue',
    title: 'Live Queue',
    metric: `${metrics.queueWaiting} waiting`,
    detail: event.is_booth_open ? 'Call, serve, and complete live queue tickets.' : 'Open the booth or prepare queue operations.',
    cta: event.is_booth_open ? 'Open queue' : 'Open queue setup',
    href: `/live/queue?eventId=${event.id}`,
    priority: context === 'liveOpen' || context === 'liveClosed' ? 'P' : 'M',
    tone: 'indigo',
    icon: Users,
  }, queueAccess && !ended);

  add({
    id: 'pos',
    title: 'Live POS',
    metric: event.is_booth_open ? 'Ready' : 'Standby',
    detail: event.is_booth_open ? 'Create walk-in orders and take payment.' : 'POS is available when staff needs checkout.',
    cta: 'Open POS',
    href: `/live/pos?eventId=${event.id}`,
    priority: context === 'liveOpen' ? 'P' : 'S',
    tone: 'cyan',
    icon: ShoppingCart,
  }, posAccess && !ended);

  add({
    id: 'dashboard',
    title: 'Dashboard',
    metric: formatMoney(metrics.revenue, metrics.currency),
    detail: `${metrics.completedOrders} completed order${metrics.completedOrders === 1 ? '' : 's'} for this event.`,
    cta: 'View dashboard',
    href: `/manage-events/${event.id}/dashboard`,
    priority: ended ? 'P' : 'S',
    tone: 'emerald',
    icon: BarChart2,
  }, management);

  add({
    id: 'history',
    title: 'Order History',
    metric: `${metrics.completedOrders} completed`,
    detail: 'Audit payments, order type, pickup status, and item details.',
    cta: 'Open orders',
    href: `/manage-events/${event.id}/history`,
    priority: ended ? 'P' : 'S',
    tone: 'slate',
    icon: FileText,
  }, management);

  return modules.sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority]);
};

export default function EventWorkspace({ actorContext }: EventWorkspaceProps) {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<WorkspaceEvent | null>(null);
  const [metrics, setMetrics] = useState<WorkspaceMetrics>(emptyMetrics);
  const [loading, setLoading] = useState(true);
  const [toggleLoading, setToggleLoading] = useState(false);
  const [error, setError] = useState('');
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [eventDraft, setEventDraft] = useState<Partial<WorkspaceEvent>>({});
  const [eventSaving, setEventSaving] = useState(false);
  const browserTimeZone = getBrowserTimeZone();
  const timeZoneOptions = useMemo(
    () => getEventTimeZoneOptions(eventDraft.event_timezone || browserTimeZone),
    [eventDraft.event_timezone, browserTimeZone]
  );

  const fetchWorkspace = useCallback(async () => {
    if (!eventId) return;

    try {
      setLoading(true);
      setError('');

      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .select('*')
        .eq('id', eventId)
        .maybeSingle();

      if (eventError) throw eventError;
      if (!eventData) throw new Error('Event not found.');

      const normalizedEvent = normalizeEventRecord(eventData, getBrowserTimeZone()) as WorkspaceEvent;
      const [ordersResult, queuesResult, productsResult] = await Promise.all([
        supabase
          .from('orders')
          .select('id, event_id, status, total_price, currency, order_type, pickup_status')
          .eq('event_id', eventId),
        supabase
          .from('queues')
          .select('id, event_id, status')
          .eq('event_id', eventId),
        canAccessManagementPages(actorContext.role)
          ? supabase.rpc('list_event_products', { p_event_id: eventId })
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (ordersResult.error) throw ordersResult.error;
      if (queuesResult.error) throw queuesResult.error;
      if (productsResult.error) throw productsResult.error;

      const orders = (ordersResult.data || []) as WorkspaceOrder[];
      const queues = (queuesResult.data || []) as WorkspaceQueue[];
      const products = (productsResult.data || []) as WorkspaceProduct[];
      const completedOrders = orders.filter((order) => order.status === 'completed');
      const currency = completedOrders[0]?.currency || orders[0]?.currency || 'THB';

      setEvent(normalizedEvent);
      setMetrics({
        awaitingPickup: orders.filter((order) => order.order_type === 'preorder' && order.pickup_status === 'awaiting_pickup').length,
        completedOrders: completedOrders.length,
        queueWaiting: queues.filter((queue) => ['waiting', 'calling', 'serving', 'queued'].includes(queue.status || '')).length,
        revenue: completedOrders.reduce((sum, order) => sum + Number(order.total_price || 0), 0),
        currency,
        productCount: products.length,
        sellingProductCount: products.filter((product) => product.status !== 'disable').length,
      });
    } catch (err) {
      console.error('[EventWorkspace] fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Could not load event workspace.');
    } finally {
      setLoading(false);
    }
  }, [actorContext.role, eventId]);

  useEffect(() => {
    void fetchWorkspace();
  }, [fetchWorkspace]);

  const modules = useMemo(() => {
    if (!event) return [];
    return buildModules(event, metrics, actorContext);
  }, [actorContext, event, metrics]);

  const canToggleBooth = event && canAccessManagementPages(actorContext.role) && getLifecycleContext(event) !== 'ended';
  const canOpenQueue = event && canAccessQueuePages(actorContext.role) && getLifecycleContext(event) !== 'ended';
  const canOpenPos = event && canUsePos(actorContext.role) && getLifecycleContext(event) !== 'ended';

  const goToAllEvents = () => {
    window.sessionStorage.setItem('forceEventGrid', 'true');
    navigate('/manage-events?view=all');
  };

  const goToProfile = () => {
    window.sessionStorage.setItem('forceEventGrid', 'true');
    navigate('/manage-events?view=all&tab=profile');
  };

  const handleBoothToggle = async () => {
    if (!event || !canToggleBooth || toggleLoading) return;
    const nextOpen = !event.is_booth_open;

    try {
      setToggleLoading(true);
      const { error: updateError } = await supabase
        .from('events')
        .update({ is_booth_open: nextOpen })
        .eq('id', event.id)
        .eq('artist_id', actorContext.artist_id);

      if (updateError) throw updateError;
      setEvent({ ...event, is_booth_open: nextOpen });
    } catch (err) {
      console.error('[EventWorkspace] booth toggle failed:', err);
      alert('Failed to update booth status.');
    } finally {
      setToggleLoading(false);
    }
  };

  const openEventEditor = () => {
    if (!event) return;

    const eventTimeZone = event.event_timezone || browserTimeZone;
    const fallbackLocation = [event.location_name, event.location_detail]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(', ');

    setEventDraft({
      ...event,
      event_timezone: eventTimeZone,
      start_date: formatDateTimeForInput(event.start_date, eventTimeZone),
      end_date: formatDateTimeForInput(event.end_date, eventTimeZone),
      location: event.location && event.location.trim().length > 0 ? event.location : fallbackLocation,
      booth_detail: event.booth_detail && event.booth_detail.trim().length > 0 ? event.booth_detail : event.booth_number,
    });
    setIsEventModalOpen(true);
  };

  const handleEventDraftChange = (changeEvent: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = changeEvent.target;

    if (name === 'event_timezone') {
      const previousTimeZone = eventDraft.event_timezone || browserTimeZone;
      const nextTimeZone = value || browserTimeZone;
      const nextDraft = { ...eventDraft, event_timezone: nextTimeZone };

      if (eventDraft.start_date) {
        const parsedStart = parseDateTimeInputInTimeZone(eventDraft.start_date, previousTimeZone);
        if (parsedStart) {
          nextDraft.start_date = formatDateTimeForInput(parsedStart, nextTimeZone);
        }
      }

      if (eventDraft.end_date) {
        const parsedEnd = parseDateTimeInputInTimeZone(eventDraft.end_date, previousTimeZone);
        if (parsedEnd) {
          nextDraft.end_date = formatDateTimeForInput(parsedEnd, nextTimeZone);
        }
      }

      setEventDraft(nextDraft);
      return;
    }

    setEventDraft((current) => ({ ...current, [name]: value }));
  };

  const handleEventSave = async () => {
    if (!event || !eventDraft.event_name || !eventDraft.start_date) {
      alert('Please fill in required fields (Name, Start Date).');
      return;
    }

    try {
      setEventSaving(true);
      const eventTimeZone = eventDraft.event_timezone || browserTimeZone;
      const parsedStart = parseDateTimeInputInTimeZone(eventDraft.start_date || '', eventTimeZone);

      if (!parsedStart) {
        alert('Invalid start date/time. Please check the selected timezone and date.');
        return;
      }

      let parsedEnd = eventDraft.end_date
        ? parseDateTimeInputInTimeZone(eventDraft.end_date, eventTimeZone)
        : null;

      if (!parsedEnd || parsedEnd.getTime() <= parsedStart.getTime()) {
        const startDatePart = (eventDraft.start_date || '').split('T')[0];
        parsedEnd = parseDateTimeInputInTimeZone(`${startDatePart}T23:59`, eventTimeZone);
      }

      if (!parsedEnd) {
        parsedEnd = new Date(parsedStart.getTime() + 60 * 60 * 1000);
      }

      const updatePayload = {
        event_name: eventDraft.event_name,
        status: eventDraft.status || 'Confirmed',
        event_timezone: eventTimeZone,
        start_date: parsedStart.toISOString(),
        end_date: parsedEnd.toISOString(),
        location: eventDraft.location || '',
        location_name: eventDraft.location || '',
        location_detail: null,
        booth_detail: eventDraft.booth_detail || null,
        booth_number: eventDraft.booth_detail || null,
        queueing_area: eventDraft.queueing_area || '',
        entrance_fee: eventDraft.entrance_fee || '',
        transit_info: eventDraft.transit_info || '',
      };

      const { data, error: updateError } = await supabase
        .from('events')
        .update(updatePayload)
        .eq('id', event.id)
        .eq('artist_id', actorContext.artist_id)
        .select()
        .single();

      if (updateError) throw updateError;

      const normalizedEvent = normalizeEventRecord(data, browserTimeZone) as WorkspaceEvent;
      setEvent(normalizedEvent);
      setIsEventModalOpen(false);
      void fetchWorkspace();
    } catch (err) {
      console.error('[EventWorkspace] event save failed:', err);
      alert('Failed to save event.');
    } finally {
      setEventSaving(false);
    }
  };

  const handleModuleOpen = (module: ModuleCardConfig) => {
    if (module.action === 'edit-event') {
      openEventEditor();
      return;
    }
    navigate(module.href);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 text-slate-800">
        <AdminHeader activePage="events" actorRole={actorContext.role} userEmail={actorContext.member_email} />
        <main className="mx-auto max-w-6xl px-4 py-12 text-center text-sm font-bold text-gray-600">Loading event workspace...</main>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="min-h-screen bg-gray-50 text-slate-800">
        <AdminHeader activePage="events" actorRole={actorContext.role} userEmail={actorContext.member_email} />
        <main className="mx-auto max-w-3xl px-4 py-12">
          <button onClick={goToAllEvents} className="workspace-action mb-5 inline-flex items-center gap-2 border border-gray-200 bg-white px-4 text-sm font-black text-gray-700 hover:bg-gray-50">
            <ArrowLeft size={16} aria-hidden="true" />
            ดู event ทั้งหมด
          </button>
          <div className="workspace-card p-8 text-center">
            <h1 className="text-xl font-black text-gray-900">Event workspace unavailable</h1>
            <p className="mt-2 text-sm font-semibold text-gray-500">{error || 'Event not found.'}</p>
          </div>
        </main>
      </div>
    );
  }

  const contextLabel = getContextLabel(event, metrics);
  const ended = getLifecycleContext(event) === 'ended';
  let contextBadgeClass = 'bg-pink-100 text-pink-700';
  if (ended) contextBadgeClass = 'bg-gray-100 text-gray-600';
  let boothBadgeClass = 'bg-gray-100 text-gray-600';
  if (event.is_booth_open) boothBadgeClass = 'bg-emerald-100 text-emerald-700';

  return (
    <div className="min-h-screen bg-gray-50 text-slate-800">
      <AdminHeader
        activePage="events"
        activeEvent={{ id: event.id, event_name: event.event_name }}
        actorRole={actorContext.role}
        userEmail={actorContext.member_email}
      />

      <main className="mx-auto max-w-6xl px-4 pb-12 pt-5 md:px-6">
        <section className="mb-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm md:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <button onClick={goToAllEvents} className="workspace-action mb-4 inline-flex items-center gap-2 border border-gray-200 bg-white px-3 text-xs font-black text-gray-700 hover:bg-gray-50">
                <ArrowLeft size={15} aria-hidden="true" />
                ดู event ทั้งหมด
              </button>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-black ${contextBadgeClass}`}>
                  {contextLabel}
                </span>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-black text-gray-600">
                  {event.selling_mode || 'live'}
                </span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-black ${boothBadgeClass}`}>
                  {event.is_booth_open ? 'Booth open' : 'Booth closed'}
                </span>
              </div>
              <h1 className="mt-3 truncate text-2xl font-black tracking-tight text-gray-900 md:text-3xl">{event.event_name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm font-semibold text-gray-600">
                <span className="inline-flex items-center gap-1.5"><Calendar size={15} aria-hidden="true" />{formatEventDate(event)}</span>
                {event.location && <span>{event.location}</span>}
                {event.booth_detail && <span>Booth {event.booth_detail}</span>}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <button onClick={goToProfile} className="workspace-action inline-flex items-center gap-2 border border-gray-200 bg-white px-3 text-xs font-black text-gray-700 hover:bg-gray-50">
                <User size={15} aria-hidden="true" />
                Creator Profile
              </button>
              {canToggleBooth && (
                <button
                  onClick={handleBoothToggle}
                  disabled={toggleLoading}
                  className={`workspace-action inline-flex items-center gap-2 border px-3 text-xs font-black ${
                    event.is_booth_open
                      ? 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      : 'border-pink-200 bg-pink-50 text-pink-700 hover:bg-pink-100'
                  }`}
                >
                  <CheckCircle2 size={15} aria-hidden="true" />
                  {toggleLoading ? 'Saving...' : event.is_booth_open ? 'Close booth' : 'Open booth'}
                </button>
              )}
              {canOpenQueue && (
                <button onClick={() => navigate(`/live/queue?eventId=${event.id}`)} className="workspace-action inline-flex items-center gap-2 border border-indigo-100 bg-indigo-50 px-3 text-xs font-black text-indigo-800 hover:bg-indigo-100">
                  <Users size={15} aria-hidden="true" />
                  Live Queue
                </button>
              )}
              {canOpenPos && (
                <button onClick={() => navigate(`/live/pos?eventId=${event.id}`)} className="workspace-action inline-flex items-center gap-2 border border-slate-200 bg-slate-900 px-3 text-xs font-black text-white hover:bg-slate-800">
                  <ShoppingCart size={15} aria-hidden="true" />
                  Live POS
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Event workspace modules">
          {modules.map((module) => (
            <ModuleCard key={module.id} module={module} onOpen={() => handleModuleOpen(module)} />
          ))}
        </section>

        {modules.length === 0 && (
          <div className="workspace-card p-8 text-center">
            <Clock className="mx-auto mb-3 text-gray-300" size={34} aria-hidden="true" />
            <p className="text-sm font-bold text-gray-600">No workspace actions are available for your role.</p>
          </div>
        )}
      </main>

      {isEventModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-event-form-title"
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-6 py-4">
              <h3 id="workspace-event-form-title" className="text-lg font-bold text-slate-800">Edit Event</h3>
              <button
                onClick={() => setIsEventModalOpen(false)}
                className="icon-touch inline-flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-800"
                aria-label="Close event form"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto p-6 text-sm">
              <div className="rounded-xl border border-pink-100 bg-pink-50 p-3">
                <p className="text-xs font-black uppercase tracking-wide text-pink-700">Event timing</p>
                <p className="mt-1 text-xs font-semibold text-pink-800/80">Queue days reset using this event timezone, so choose the timezone where the booth is actually running.</p>
              </div>

              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <label className="text-xs font-bold uppercase text-gray-600" htmlFor="workspace-event-status">Status</label>
                <select
                  id="workspace-event-status"
                  name="status"
                  value={eventDraft.status || 'Confirmed'}
                  onChange={handleEventDraftChange}
                  className="mt-1 min-h-11 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-pink-500"
                >
                  <option value="Confirmed">Confirmed</option>
                  <option value="Cancelled">Cancelled</option>
                  <option value="Ended">Ended</option>
                </select>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-bold uppercase text-gray-600">Event Name *</span>
                <input
                  name="event_name"
                  value={eventDraft.event_name || ''}
                  onChange={handleEventDraftChange}
                  className="w-full rounded-lg border border-gray-200 p-3 font-semibold outline-none focus:border-pink-500 focus:ring-pink-500"
                  placeholder="e.g. Cosplay Festival 2026"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-bold uppercase text-gray-600">Time Zone *</span>
                <select
                  name="event_timezone"
                  value={eventDraft.event_timezone || browserTimeZone}
                  onChange={handleEventDraftChange}
                  className="min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 outline-none focus:border-pink-500"
                >
                  {timeZoneOptions.map((timeZone) => (
                    <option key={timeZone.value} value={timeZone.value}>
                      {timeZone.label}
                    </option>
                  ))}
                </select>
                <span className="block text-xs font-semibold text-gray-500">Used for end-of-day and daily queue reset.</span>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-xs font-bold uppercase text-gray-600">Start Date *</span>
                  <input
                    type="datetime-local"
                    name="start_date"
                    value={eventDraft.start_date || ''}
                    onChange={handleEventDraftChange}
                    className="min-h-11 w-full rounded-lg border border-gray-200 px-3 py-2.5 outline-none focus:border-pink-500"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-bold uppercase text-gray-600">End Date *</span>
                  <input
                    type="datetime-local"
                    name="end_date"
                    value={eventDraft.end_date || ''}
                    onChange={handleEventDraftChange}
                    className="min-h-11 w-full rounded-lg border border-gray-200 px-3 py-2.5 outline-none focus:border-pink-500"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-bold uppercase text-gray-600">Location</span>
                <input
                  name="location"
                  value={eventDraft.location || ''}
                  onChange={handleEventDraftChange}
                  className="min-h-11 w-full rounded-lg border border-gray-200 px-3 py-2.5 outline-none focus:border-pink-500"
                  placeholder="e.g. 5th Floor, Siam Paragon"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-bold uppercase text-gray-600">Booth Detail</span>
                <input
                  name="booth_detail"
                  value={eventDraft.booth_detail || ''}
                  onChange={handleEventDraftChange}
                  className="min-h-11 w-full rounded-lg border border-gray-200 px-3 py-2.5 outline-none focus:border-pink-500"
                  placeholder="e.g. Booth A12, Zone Creator Hall"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-bold uppercase text-gray-600">Queueing Area</span>
                <input
                  name="queueing_area"
                  value={eventDraft.queueing_area || ''}
                  onChange={handleEventDraftChange}
                  className="min-h-11 w-full rounded-lg border border-gray-200 px-3 py-2.5 outline-none focus:border-pink-500"
                  placeholder="e.g. Queue lane beside Booth A12"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-bold uppercase text-gray-600">Entrance Fee</span>
                <input
                  name="entrance_fee"
                  value={eventDraft.entrance_fee || ''}
                  onChange={handleEventDraftChange}
                  className="min-h-11 w-full rounded-lg border border-gray-200 px-3 py-2.5 outline-none focus:border-pink-500"
                  placeholder="e.g. 300 THB / Free"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-bold uppercase text-gray-600">Transit Info</span>
                <textarea
                  name="transit_info"
                  rows={3}
                  value={eventDraft.transit_info || ''}
                  onChange={handleEventDraftChange}
                  className="w-full resize-none rounded-lg border border-gray-200 p-2.5 outline-none focus:border-pink-500"
                  placeholder="BTS Bangna..."
                />
              </label>
            </div>

            <div className="flex justify-end gap-3 border-t border-gray-100 bg-gray-50 p-6">
              <button
                onClick={() => setIsEventModalOpen(false)}
                className="workspace-action inline-flex items-center justify-center px-4 text-sm font-black text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={handleEventSave}
                disabled={eventSaving}
                className="workspace-action inline-flex items-center justify-center bg-pink-600 px-6 text-sm font-black text-white shadow-md shadow-pink-200 hover:bg-pink-700 disabled:opacity-60"
              >
                {eventSaving ? 'Saving...' : 'Save Event'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModuleCard({ module, onOpen }: { module: ModuleCardConfig; onOpen: () => void }) {
  const Icon = module.icon;
  const classes = toneClasses[module.tone];
  const isPrimary = module.priority === 'P';
  const isMuted = module.priority === 'M';

  return (
    <article className={`rounded-2xl border p-4 shadow-sm ${classes.card} ${isPrimary ? 'md:col-span-1 xl:col-span-1' : ''} ${isMuted ? 'opacity-75' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${classes.icon}`}>
          <Icon size={20} aria-hidden={true} />
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wide ${classes.badge}`}>
          {module.priority === 'P' ? 'Primary' : module.priority === 'S' ? 'Standard' : 'Muted'}
        </span>
      </div>
      <h2 className="mt-4 text-base font-black text-gray-900">{module.title}</h2>
      <p className="mt-1 text-2xl font-black tracking-tight text-gray-900">{module.metric}</p>
      <p className="mt-2 min-h-[40px] text-sm font-semibold leading-5 text-gray-700">{module.detail}</p>
      <button onClick={onOpen} className={`workspace-action mt-4 inline-flex w-full items-center justify-center px-4 text-sm font-black ${classes.cta}`}>
        {module.cta}
      </button>
    </article>
  );
}
