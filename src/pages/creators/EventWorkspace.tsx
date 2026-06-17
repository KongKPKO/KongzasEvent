import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BarChart2,
  Calendar,
  CheckCircle2,
  Clock,
  Coffee,
  FileText,
  MapPin,
  PackageCheck,
  ReceiptText,
  Settings,
  ShoppingCart,
  Sparkles,
  Ticket,
  Truck,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import AdminHeader from '../../components/AdminHeader';
import EventNavTabs from '../../components/EventNavTabs';
import { supabase } from '../../supabaseClient';
import type { ActorContext } from '../../types/access';
import { canAccessManagementPages, canAccessQueuePages, canUsePos } from '../../types/access';
import type { EventSalesPhase, EventSellingMode, OrderType, PickupStatus } from '../../types/preorder';
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
  preorder_enabled?: boolean | null;
  preorder_opens_at?: string | null;
  preorder_closes_at?: string | null;
  postorder_enabled?: boolean | null;
  postorder_opens_at?: string | null;
  postorder_closes_at?: string | null;
  sales_status_override?: 'auto' | 'closed' | null;
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

type LifecycleContext = 'prep' | 'preorderOpen' | 'postorderOpen' | 'liveOpen' | 'liveClosed' | 'ended';
type OverviewTone = 'pink' | 'slate' | 'emerald' | 'amber' | 'teal' | 'indigo' | 'cyan';
type TimelineStatus = 'done' | 'active' | 'todo' | 'attention';

interface OverviewAction {
  eyebrow: string;
  title: string;
  detail: string;
  cta: string;
  href?: string;
  action?: 'edit-event';
  tone: OverviewTone;
  icon: LucideIcon;
}

interface TimelineStep {
  id: string;
  title: string;
  detail: string;
  status: TimelineStatus;
  href?: string;
  visible: boolean;
  icon: LucideIcon;
}

interface AttentionItem {
  id: string;
  title: string;
  detail: string;
  href?: string;
  action?: 'edit-event';
  tone: OverviewTone;
}

interface SetupItem {
  id: string;
  title: string;
  detail: string;
  href?: string;
  action?: 'edit-event';
  status: TimelineStatus;
  icon: LucideIcon;
}

interface SetupGroup {
  id: string;
  title: string;
  detail: string;
  items: SetupItem[];
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

const toneClasses: Record<OverviewTone, { panel: string; icon: string; cta: string; badge: string; text: string }> = {
  pink: {
    panel: 'border-pink-100 bg-pink-50/60',
    icon: 'bg-pink-100 text-pink-700',
    cta: 'bg-pink-600 text-white hover:bg-pink-700',
    badge: 'text-pink-700 bg-pink-100',
    text: 'text-pink-800',
  },
  slate: {
    panel: 'border-gray-200 bg-white',
    icon: 'bg-gray-100 text-gray-700',
    cta: 'bg-slate-900 text-white hover:bg-slate-800',
    badge: 'text-gray-700 bg-gray-100',
    text: 'text-gray-800',
  },
  emerald: {
    panel: 'border-emerald-100 bg-emerald-50/60',
    icon: 'bg-emerald-100 text-emerald-700',
    cta: 'bg-emerald-700 text-white hover:bg-emerald-800',
    badge: 'text-emerald-700 bg-emerald-100',
    text: 'text-emerald-800',
  },
  amber: {
    panel: 'border-amber-100 bg-amber-50/70',
    icon: 'bg-amber-100 text-amber-800',
    cta: 'bg-amber-700 text-white hover:bg-amber-800',
    badge: 'text-amber-800 bg-amber-100',
    text: 'text-amber-900',
  },
  teal: {
    panel: 'border-teal-100 bg-teal-50/60',
    icon: 'bg-teal-100 text-teal-700',
    cta: 'bg-teal-700 text-white hover:bg-teal-800',
    badge: 'text-teal-700 bg-teal-100',
    text: 'text-teal-800',
  },
  indigo: {
    panel: 'border-indigo-100 bg-indigo-50/60',
    icon: 'bg-indigo-100 text-indigo-900',
    cta: 'bg-indigo-800 text-white hover:bg-indigo-900',
    badge: 'text-indigo-900 bg-indigo-100',
    text: 'text-indigo-900',
  },
  cyan: {
    panel: 'border-cyan-100 bg-cyan-50/60',
    icon: 'bg-cyan-100 text-cyan-800',
    cta: 'bg-cyan-700 text-white hover:bg-cyan-800',
    badge: 'text-cyan-800 bg-cyan-100',
    text: 'text-cyan-900',
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

const isWithinScheduleWindow = (opensAt: string | null | undefined, closesAt: string | null | undefined, now: Date) => {
  const opens = opensAt ? new Date(opensAt) : null;
  const closes = closesAt ? new Date(closesAt) : null;
  if (opens && !Number.isNaN(opens.getTime()) && opens > now) return false;
  if (closes && !Number.isNaN(closes.getTime()) && closes <= now) return false;
  return true;
};

const getDerivedSalesPhase = (event: WorkspaceEvent, now = new Date()): EventSalesPhase => {
  if (event.sales_status_override === 'closed' || event.status === 'Cancelled') return 'closed';

  const start = new Date(event.start_date);
  const end = new Date(event.end_date);
  const status = event.status || 'Confirmed';
  const preorderEnabled = Boolean(event.preorder_enabled) || event.selling_mode === 'preorder';
  const postorderEnabled = Boolean(event.postorder_enabled) || event.selling_mode === 'post_event';
  const postorderOpensAt = event.postorder_opens_at || (event.selling_mode === 'post_event' ? event.preorder_opens_at : null);
  const postorderClosesAt = event.postorder_closes_at || (event.selling_mode === 'post_event' ? event.preorder_closes_at : null);

  if (
    status === 'Confirmed' &&
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime()) &&
    start <= now &&
    now < end
  ) {
    return 'live';
  }

  if (status === 'Confirmed' && preorderEnabled && isWithinScheduleWindow(event.preorder_opens_at, event.preorder_closes_at, now)) {
    return 'preorder';
  }

  if ((status === 'Confirmed' || status === 'Ended') && postorderEnabled && isWithinScheduleWindow(postorderOpensAt, postorderClosesAt, now)) {
    return 'post_event';
  }

  return 'closed';
};

const getLifecycleContext = (event: WorkspaceEvent): LifecycleContext => {
  const now = new Date();
  const start = new Date(event.start_date);
  const end = new Date(event.end_date);
  const phase = getDerivedSalesPhase(event, now);

  if (phase === 'preorder') return 'preorderOpen';
  if (phase === 'post_event') return 'postorderOpen';
  if (phase === 'live') return event.is_booth_open ? 'liveOpen' : 'liveClosed';
  if (event.status === 'Ended' || event.status === 'Cancelled' || event.sales_status_override === 'closed') return 'ended';
  if (!Number.isNaN(start.getTime()) && start > now) return 'prep';
  if (!Number.isNaN(end.getTime()) && end < now) return 'ended';
  if (phase === 'closed') return 'prep';
  return event.is_booth_open ? 'liveOpen' : 'liveClosed';
};

const getContextLabel = (event: WorkspaceEvent, metrics: WorkspaceMetrics) => {
  const context = getLifecycleContext(event);
  if (metrics.awaitingPickup > 0) return `${metrics.awaitingPickup} awaiting pickup`;
  if (context === 'ended') return 'Ended / records';
  if (context === 'preorderOpen') return 'Pre-order open';
  if (context === 'postorderOpen') return 'Post-order open';
  if (context === 'prep') return 'Prep';
  return event.is_booth_open ? 'Booth open' : 'Booth closed';
};

const getPrimaryAction = (
  event: WorkspaceEvent,
  metrics: WorkspaceMetrics,
  actorContext: ActorContext
): OverviewAction | null => {
  const context = getLifecycleContext(event);
  const management = canAccessManagementPages(actorContext.role);
  const queueAccess = canAccessQueuePages(actorContext.role);
  const posAccess = canUsePos(actorContext.role);

  if (metrics.awaitingPickup > 0 && queueAccess) {
    return {
      eyebrow: 'Needs staff attention',
      title: `${metrics.awaitingPickup} order${metrics.awaitingPickup === 1 ? '' : 's'} waiting for pickup`,
      detail: 'Clear pickup confirmations first so customer handoff stays accurate.',
      cta: 'Open pickup',
      href: `/manage-events/${event.id}/pickup`,
      tone: 'teal',
      icon: PackageCheck,
    };
  }

  if (metrics.sellingProductCount === 0 && management) {
    return {
      eyebrow: 'Setup required',
      title: 'Choose products for this event',
      detail: 'No event catalog is selling yet. Add products and event stock before opening sales.',
      cta: 'Set up Event Catalog',
      href: `/manage-events/${event.id}/catalog`,
      tone: 'amber',
      icon: Coffee,
    };
  }

  if (context === 'preorderOpen' && posAccess) {
    return {
      eyebrow: 'Pre-order is open',
      title: 'Monitor pre-order payments and pickup demand',
      detail: 'Use the order dashboard to confirm transfers, export totals, and prepare fulfillment.',
      cta: 'Open Pre-order',
      href: `/manage-events/${event.id}/preorder-dashboard`,
      tone: 'pink',
      icon: ReceiptText,
    };
  }

  if (context === 'postorderOpen' && posAccess) {
    return {
      eyebrow: 'Post-order is open',
      title: 'Monitor post-event orders and fulfillment',
      detail: 'Use the post-order dashboard to confirm payments, collect shipping details, and prepare fulfillment.',
      cta: 'Open Post-order',
      href: `/manage-events/${event.id}/postorder-dashboard`,
      tone: 'indigo',
      icon: Truck,
    };
  }

  if (context === 'liveOpen' && posAccess) {
    return {
      eyebrow: 'Booth is live',
      title: 'Keep checkout moving',
      detail: metrics.queueWaiting > 0
        ? `${metrics.queueWaiting} queue ticket${metrics.queueWaiting === 1 ? '' : 's'} need live attention.`
        : 'POS is ready for walk-in sales. Queue is currently clear.',
      cta: 'Open Live POS',
      href: `/live/pos?eventId=${event.id}`,
      tone: 'cyan',
      icon: ShoppingCart,
    };
  }

  if (context === 'liveClosed' && queueAccess) {
    return {
      eyebrow: 'Event day',
      title: 'Open the live workspace when staff is ready',
      detail: 'Queue and POS are available for booth operations. Open the booth from Live Queue when sales begin.',
      cta: 'Open Live Queue',
      href: `/live/queue?eventId=${event.id}`,
      tone: 'indigo',
      icon: Users,
    };
  }

  if (context === 'ended' && management) {
    return {
      eyebrow: 'Review mode',
      title: 'Review revenue and order records',
      detail: `${metrics.completedOrders} completed order${metrics.completedOrders === 1 ? '' : 's'} · ${formatMoney(metrics.revenue, metrics.currency)} revenue.`,
      cta: 'Open Dashboard',
      href: `/manage-events/${event.id}/dashboard`,
      tone: 'emerald',
      icon: BarChart2,
    };
  }

  if (management) {
    return {
      eyebrow: 'Preparation',
      title: 'Review setup before sales open',
      detail: 'Confirm the event details, catalog, promotions, and pre-order settings before customers arrive.',
      cta: 'Edit Event',
      action: 'edit-event',
      tone: 'slate',
      icon: Settings,
    };
  }

  return null;
};

const buildTimeline = (
  event: WorkspaceEvent,
  metrics: WorkspaceMetrics,
  actorContext: ActorContext
): TimelineStep[] => {
  const context = getLifecycleContext(event);
  const management = canAccessManagementPages(actorContext.role);
  const queueAccess = canAccessQueuePages(actorContext.role);
  const posAccess = canUsePos(actorContext.role);
  const catalogReady = metrics.sellingProductCount > 0;
  const preorderEnabled = Boolean(event.preorder_enabled) || event.selling_mode === 'preorder';
  const postorderEnabled = Boolean(event.postorder_enabled) || event.selling_mode === 'post_event';
  const ended = context === 'ended';

  const steps: TimelineStep[] = [
    {
      id: 'setup',
      title: 'Setup',
      detail: catalogReady ? `${metrics.sellingProductCount} product${metrics.sellingProductCount === 1 ? '' : 's'} selling` : 'Event catalog still needs products',
      status: catalogReady ? (context === 'prep' ? 'active' : 'done') : 'attention',
      href: management ? `/manage-events/${event.id}/catalog` : undefined,
      visible: management,
      icon: Coffee,
    },
    {
      id: 'preorder',
      title: 'Pre-order',
      detail: preorderEnabled ? 'Pre-order window is configured' : 'Optional for this event',
      status: context === 'preorderOpen' ? 'active' : preorderEnabled && !['prep', 'preorderOpen'].includes(context) ? 'done' : 'todo',
      href: posAccess ? `/manage-events/${event.id}/preorder-dashboard` : undefined,
      visible: posAccess,
      icon: Ticket,
    },
    {
      id: 'live',
      title: 'Live Booth',
      detail: event.is_booth_open ? 'Booth is open' : metrics.queueWaiting > 0 ? `${metrics.queueWaiting} waiting` : 'Queue and POS standby',
      status: context === 'liveOpen' || context === 'liveClosed' ? 'active' : ended ? 'done' : 'todo',
      href: queueAccess ? `/live/queue?eventId=${event.id}` : undefined,
      visible: queueAccess,
      icon: Users,
    },
    {
      id: 'fulfillment',
      title: 'Pickup / Post-order',
      detail: metrics.awaitingPickup > 0
        ? `${metrics.awaitingPickup} awaiting pickup`
        : postorderEnabled
          ? 'Post-order window is configured'
          : 'No pickup action waiting',
      status: metrics.awaitingPickup > 0 ? 'attention' : context === 'postorderOpen' ? 'active' : ended ? 'done' : 'todo',
      href: queueAccess ? (context === 'postorderOpen' ? `/manage-events/${event.id}/postorder-dashboard` : `/manage-events/${event.id}/pickup`) : undefined,
      visible: queueAccess,
      icon: PackageCheck,
    },
    {
      id: 'review',
      title: 'Review',
      detail: `${metrics.completedOrders} completed · ${formatMoney(metrics.revenue, metrics.currency)}`,
      status: ended ? 'active' : 'todo',
      href: management ? `/manage-events/${event.id}/history` : undefined,
      visible: management,
      icon: FileText,
    },
  ];

  return steps.filter((step) => step.visible);
};

const buildAttentionItems = (
  event: WorkspaceEvent,
  metrics: WorkspaceMetrics,
  actorContext: ActorContext
): AttentionItem[] => {
  const context = getLifecycleContext(event);
  const management = canAccessManagementPages(actorContext.role);
  const queueAccess = canAccessQueuePages(actorContext.role);
  const items: AttentionItem[] = [];

  if (event.status === 'Cancelled') {
    items.push({
      id: 'cancelled',
      title: 'Event is marked cancelled',
      detail: 'Review settings before sharing links or opening sales.',
      action: 'edit-event',
      tone: 'slate',
    });
  }

  if (management && metrics.sellingProductCount === 0) {
    items.push({
      id: 'catalog-empty',
      title: 'Event Catalog is empty',
      detail: 'Add products to this event before customers can buy.',
      href: `/manage-events/${event.id}/catalog`,
      tone: 'amber',
    });
  }

  if (management && (Boolean(event.preorder_enabled) || event.selling_mode === 'preorder') && (!event.preorder_opens_at || !event.preorder_closes_at)) {
    items.push({
      id: 'preorder-window',
      title: 'Pre-order window is incomplete',
      detail: 'Set open and close times so customer ordering follows the intended schedule.',
      href: `/manage-events/${event.id}/preorder`,
      tone: 'pink',
    });
  }

  if (management && (Boolean(event.postorder_enabled) || event.selling_mode === 'post_event') && (!event.postorder_opens_at || !event.postorder_closes_at)) {
    items.push({
      id: 'postorder-window',
      title: 'Post-order window is incomplete',
      detail: 'Set open and close times so post-event customer ordering follows the intended schedule.',
      href: `/manage-events/${event.id}/preorder`,
      tone: 'indigo',
    });
  }

  if (queueAccess && metrics.awaitingPickup > 0) {
    items.push({
      id: 'pickup-waiting',
      title: 'Pickup confirmations are waiting',
      detail: `${metrics.awaitingPickup} order${metrics.awaitingPickup === 1 ? '' : 's'} need staff confirmation.`,
      href: `/manage-events/${event.id}/pickup`,
      tone: 'teal',
    });
  }

  if (queueAccess && context === 'liveClosed' && !event.is_booth_open) {
    items.push({
      id: 'booth-closed',
      title: 'Booth is closed',
      detail: 'Open the booth from Live Queue when staff starts accepting walk-ins.',
      href: `/live/queue?eventId=${event.id}`,
      tone: 'indigo',
    });
  }

  return items;
};

const buildSetupGroups = (
  event: WorkspaceEvent,
  metrics: WorkspaceMetrics,
  actorContext: ActorContext
): SetupGroup[] => {
  if (!canAccessManagementPages(actorContext.role)) return [];

  const hasEventTiming = Boolean(event.start_date && event.end_date);
  const hasEventPlace = Boolean((event.location || event.location_name || '').trim());
  const preorderEnabled = Boolean(event.preorder_enabled) || event.selling_mode === 'preorder';
  const postorderEnabled = Boolean(event.postorder_enabled) || event.selling_mode === 'post_event';
  const usesTimedOrderWindow = preorderEnabled || postorderEnabled;
  const hasPreorderWindow = !preorderEnabled || Boolean(event.preorder_opens_at && event.preorder_closes_at);
  const hasPostorderWindow = !postorderEnabled || Boolean(event.postorder_opens_at && event.postorder_closes_at);
  const hasOrderWindow = hasPreorderWindow && hasPostorderWindow;
  const hasPickupInstructions = Boolean((event.preorder_pickup_instructions || '').trim());
  const catalogReady = metrics.sellingProductCount > 0;
  const orderDetail = usesTimedOrderWindow
    ? hasOrderWindow
      ? [
        preorderEnabled ? 'Pre-order' : null,
        postorderEnabled ? 'Post-order' : null,
      ].filter(Boolean).join(' + ') + ' schedule is set'
      : 'Set open and close times'
    : 'Live event-day sales are automatic';

  return [
    {
      id: 'event',
      title: 'Setup Event',
      detail: 'Event details and order timing.',
      items: [
        {
          id: 'event-details',
          title: 'Event details',
          detail: hasEventTiming && hasEventPlace ? 'Date and location are set' : 'Confirm date, location, and booth detail',
          action: 'edit-event',
          status: hasEventTiming && hasEventPlace ? 'done' : 'attention',
          icon: Settings,
        },
        {
          id: 'order-settings',
          title: 'Order Settings',
          detail: orderDetail,
          href: `/manage-events/${event.id}/preorder`,
          status: usesTimedOrderWindow && !hasOrderWindow ? 'attention' : 'done',
          icon: Ticket,
        },
        {
          id: 'pickup-instructions',
          title: 'Pickup instructions',
          detail: hasPickupInstructions ? 'Customer handoff notes are set' : 'Add pickup notes when this event needs pickup flow',
          href: `/manage-events/${event.id}/preorder`,
          status: hasPickupInstructions || !usesTimedOrderWindow ? 'done' : 'todo',
          icon: PackageCheck,
        },
      ],
    },
    {
      id: 'product',
      title: 'Setup Product',
      detail: 'Products, event stock, and event-only offers.',
      items: [
        {
          id: 'event-catalog',
          title: 'Event Catalog',
          detail: catalogReady ? `${metrics.sellingProductCount} product${metrics.sellingProductCount === 1 ? '' : 's'} selling` : 'Choose products and event stock',
          href: `/manage-events/${event.id}/catalog`,
          status: catalogReady ? 'done' : 'attention',
          icon: Coffee,
        },
        {
          id: 'event-promotion',
          title: 'Event Promotion',
          detail: 'Optional event-only price rules',
          href: `/manage-events/${event.id}/promotion`,
          status: 'todo',
          icon: Sparkles,
        },
      ],
    },
  ];
};

export default function EventWorkspace({ actorContext }: EventWorkspaceProps) {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<WorkspaceEvent | null>(null);
  const [metrics, setMetrics] = useState<WorkspaceMetrics>(emptyMetrics);
  const [loading, setLoading] = useState(true);
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
        awaitingPickup: orders.filter((order) => ['preorder', 'post_event'].includes(order.order_type || '') && order.pickup_status === 'awaiting_pickup').length,
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

  const primaryAction = useMemo(() => {
    if (!event) return null;
    return getPrimaryAction(event, metrics, actorContext);
  }, [actorContext, event, metrics]);

  const timelineSteps = useMemo(() => {
    if (!event) return [];
    return buildTimeline(event, metrics, actorContext);
  }, [actorContext, event, metrics]);

  const attentionItems = useMemo(() => {
    if (!event) return [];
    return buildAttentionItems(event, metrics, actorContext);
  }, [actorContext, event, metrics]);

  const setupGroups = useMemo(() => {
    if (!event) return [];
    return buildSetupGroups(event, metrics, actorContext);
  }, [actorContext, event, metrics]);


  const goToAllEvents = () => {
    window.sessionStorage.setItem('forceEventGrid', 'true');
    navigate('/manage-events?view=all');
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

  const handleOverviewAction = (target?: { href?: string; action?: 'edit-event' }) => {
    if (!target) return;
    if (target.action === 'edit-event') {
      openEventEditor();
      return;
    }
    if (target.href) {
      navigate(target.href);
    }
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
  const salesPhase = getDerivedSalesPhase(event);
  const salesPhaseLabel: Record<EventSalesPhase, string> = {
    preorder: 'Pre-order',
    live: 'Live event day',
    post_event: 'Post-order',
    closed: 'Closed',
  };
  let contextBadgeClass = 'bg-pink-100 text-pink-700';
  if (ended) contextBadgeClass = 'bg-gray-100 text-gray-600';
  let boothBadgeClass = 'bg-gray-100 text-gray-600';
  if (event.is_booth_open) boothBadgeClass = 'bg-emerald-100 text-emerald-700';
  const primaryActionClasses = primaryAction ? toneClasses[primaryAction.tone] : toneClasses.slate;

  return (
    <div className="min-h-screen bg-gray-50 text-slate-800">
      <AdminHeader
        activePage="events"
        activeEvent={{ id: event.id, event_name: event.event_name }}
        actorRole={actorContext.role}
        userEmail={actorContext.member_email}
      />

      <main className="mx-auto max-w-6xl px-4 pb-12 pt-5 md:px-6">
        <EventNavTabs eventId={event.id} active="overview" actorRole={actorContext.role} sellingMode={event.selling_mode} />
        <section className="mb-5 border-b border-gray-200 pb-5">
          <button onClick={goToAllEvents} className="workspace-action mb-4 inline-flex items-center gap-2 border border-gray-200 bg-white px-3 text-xs font-black text-gray-700 hover:bg-gray-50">
            <ArrowLeft size={15} aria-hidden="true" />
            ดู event ทั้งหมด
          </button>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-black ${contextBadgeClass}`}>
                  {contextLabel}
                </span>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-black text-gray-600">
                  {salesPhaseLabel[salesPhase]}
                </span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-black ${boothBadgeClass}`}>
                  {event.is_booth_open ? 'Booth open' : 'Booth closed'}
                </span>
              </div>
              <h1 className="mt-3 truncate text-2xl font-black tracking-tight text-gray-900 md:text-3xl">{event.event_name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm font-semibold text-gray-600">
                <span className="inline-flex items-center gap-1.5"><Calendar size={15} aria-hidden="true" />{formatEventDate(event)}</span>
                {event.location && <span className="inline-flex items-center gap-1.5"><MapPin size={15} aria-hidden="true" />{event.location}</span>}
                {event.booth_detail && <span>Booth {event.booth_detail}</span>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-right sm:grid-cols-4 lg:min-w-[520px]">
              <MetricTile label="Selling" value={`${metrics.sellingProductCount}/${metrics.productCount}`} />
              <MetricTile label="Queue" value={String(metrics.queueWaiting)} />
              <MetricTile label="Orders" value={String(metrics.completedOrders)} />
              <MetricTile label="Revenue" value={formatMoney(metrics.revenue, metrics.currency)} />
            </div>
          </div>
        </section>

        {primaryAction ? (
          <section className={`mb-5 rounded-xl border p-4 shadow-sm md:p-5 ${primaryActionClasses.panel}`} aria-label="Current event status">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 gap-3">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${primaryActionClasses.icon}`}>
                  <primaryAction.icon size={22} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className={`text-xs font-black uppercase tracking-wide ${primaryActionClasses.text}`}>{primaryAction.eyebrow}</p>
                  <h2 className="mt-1 text-xl font-black tracking-tight text-gray-950 md:text-2xl">{primaryAction.title}</h2>
                  <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-gray-700">{primaryAction.detail}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleOverviewAction(primaryAction)}
                className={`workspace-action inline-flex shrink-0 items-center justify-center gap-2 px-4 text-sm font-black ${primaryActionClasses.cta}`}
              >
                {primaryAction.cta}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </section>
        ) : (
          <section className="mb-5 rounded-xl border border-gray-200 bg-white p-5 text-center shadow-sm">
            <Clock className="mx-auto mb-3 text-gray-300" size={34} aria-hidden="true" />
            <p className="text-sm font-bold text-gray-600">No workspace actions are available for your role.</p>
          </section>
        )}

        {setupGroups.length > 0 && (
          <section className="mb-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:p-5" aria-label="Event setup checklist">
            <div className="mb-4">
              <p className="text-xs font-black uppercase tracking-wide text-gray-400">Setup</p>
              <h2 className="text-lg font-black text-gray-900">Before sales open</h2>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {setupGroups.map((group) => (
                <SetupGroupPanel key={group.id} group={group} onOpen={handleOverviewAction} />
              ))}
            </div>
          </section>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.9fr)]">
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:p-5" aria-label="Event timeline">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-gray-400">Event timeline</p>
                <h2 className="text-lg font-black text-gray-900">Progress at a glance</h2>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-5">
              {timelineSteps.map((step) => (
                <TimelineStepCard key={step.id} step={step} onOpen={() => handleOverviewAction({ href: step.href })} />
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:p-5" aria-label="Attention items">
            <div className="mb-4">
              <p className="text-xs font-black uppercase tracking-wide text-gray-400">Attention</p>
              <h2 className="text-lg font-black text-gray-900">Needs action</h2>
            </div>
            {attentionItems.length > 0 ? (
              <div className="space-y-3">
                {attentionItems.map((item) => (
                  <AttentionRow key={item.id} item={item} onOpen={() => handleOverviewAction(item)} />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-700" size={18} aria-hidden="true" />
                  <div>
                    <p className="text-sm font-black text-emerald-900">No urgent items</p>
                    <p className="mt-1 text-sm font-semibold leading-5 text-emerald-800/80">Use the event tabs when you need deeper setup, sales, or order details.</p>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
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

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-left shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 truncate text-base font-black text-gray-900">{value}</p>
    </div>
  );
}

function TimelineStepCard({ step, onOpen }: { step: TimelineStep; onOpen: () => void }) {
  const Icon = step.icon;
  const statusStyles: Record<TimelineStatus, { shell: string; dot: string; label: string; icon: typeof CheckCircle2 }> = {
    done: {
      shell: 'border-emerald-100 bg-emerald-50',
      dot: 'bg-emerald-600 text-white',
      label: 'Done',
      icon: CheckCircle2,
    },
    active: {
      shell: 'border-pink-200 bg-pink-50',
      dot: 'bg-pink-600 text-white',
      label: 'Now',
      icon: Clock,
    },
    attention: {
      shell: 'border-amber-200 bg-amber-50',
      dot: 'bg-amber-500 text-white',
      label: 'Needs action',
      icon: AlertCircle,
    },
    todo: {
      shell: 'border-gray-200 bg-gray-50',
      dot: 'bg-white text-gray-400 ring-1 ring-gray-200',
      label: 'Later',
      icon: Clock,
    },
  };
  const styles = statusStyles[step.status];
  const StatusIcon = styles.icon;
  const content = (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${styles.dot}`}>
          <StatusIcon size={15} aria-hidden="true" />
        </div>
        <span className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-gray-600">
          {styles.label}
        </span>
      </div>
      <Icon size={18} className="mb-2 text-gray-500" aria-hidden="true" />
      <h3 className="text-sm font-black text-gray-900">{step.title}</h3>
      <p className="mt-1 min-h-[40px] text-xs font-semibold leading-5 text-gray-600">{step.detail}</p>
    </>
  );

  if (!step.href) {
    return <div className={`rounded-lg border p-3 ${styles.shell}`}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`rounded-lg border p-3 text-left transition-colors hover:border-pink-200 hover:bg-pink-50/60 ${styles.shell}`}
    >
      {content}
    </button>
  );
}

function SetupGroupPanel({ group, onOpen }: { group: SetupGroup; onOpen: (target?: { href?: string; action?: 'edit-event' }) => void }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="mb-3">
        <h3 className="text-sm font-black text-gray-900">{group.title}</h3>
        <p className="mt-1 text-xs font-semibold text-gray-500">{group.detail}</p>
      </div>
      <div className="space-y-2">
        {group.items.map((item) => (
          <SetupItemRow key={item.id} item={item} onOpen={() => onOpen(item)} />
        ))}
      </div>
    </div>
  );
}

function SetupItemRow({ item, onOpen }: { item: SetupItem; onOpen: () => void }) {
  const Icon = item.icon;
  const statusClasses: Record<TimelineStatus, { pill: string; label: string; icon: typeof CheckCircle2 }> = {
    done: {
      pill: 'bg-emerald-100 text-emerald-800',
      label: 'Ready',
      icon: CheckCircle2,
    },
    active: {
      pill: 'bg-pink-100 text-pink-800',
      label: 'Now',
      icon: Clock,
    },
    attention: {
      pill: 'bg-amber-100 text-amber-900',
      label: 'Needs setup',
      icon: AlertCircle,
    },
    todo: {
      pill: 'bg-gray-100 text-gray-600',
      label: 'Optional',
      icon: Clock,
    },
  };
  const status = statusClasses[item.status];
  const StatusIcon = status.icon;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-lg border border-gray-200 bg-white p-3 text-left transition-colors hover:border-pink-200 hover:bg-pink-50/60"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700">
          <Icon size={17} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-black text-gray-900">{item.title}</p>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${status.pill}`}>
              <StatusIcon size={11} aria-hidden="true" />
              {status.label}
            </span>
          </div>
          <p className="mt-1 text-xs font-semibold leading-5 text-gray-600">{item.detail}</p>
        </div>
        <ArrowRight className="mt-2 shrink-0 text-gray-400" size={15} aria-hidden="true" />
      </div>
    </button>
  );
}

function AttentionRow({ item, onOpen }: { item: AttentionItem; onOpen: () => void }) {
  const classes = toneClasses[item.tone];

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-white ${classes.panel}`}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className={`mt-0.5 shrink-0 ${classes.text}`} size={18} aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-black text-gray-900">{item.title}</p>
          <p className="mt-1 text-sm font-semibold leading-5 text-gray-700">{item.detail}</p>
        </div>
        <ArrowRight className="ml-auto mt-1 shrink-0 text-gray-400" size={15} aria-hidden="true" />
      </div>
    </button>
  );
}
