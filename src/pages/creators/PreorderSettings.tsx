import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, Clock3, PackageCheck, Save, Settings, ShoppingCart, Store, Truck, type LucideIcon } from 'lucide-react';
import AdminHeader from '../../components/AdminHeader';
import EventNavTabs from '../../components/EventNavTabs';
import { Toast } from '../../components/ui/Feedback';
import { supabase } from '../../supabaseClient';
import type { EventSellingMode } from '../../types/preorder';
import { formatDateTimeForInput, parseDateTimeInputInTimeZone } from '../../utils/timezone';

interface EventSettingsRow {
  id: string;
  artist_id: string;
  event_name: string;
  start_date: string;
  end_date: string;
  event_timezone: string | null;
  location: string | null;
  location_name: string | null;
  location_detail: string | null;
  booth_detail: string | null;
  booth_number: string | null;
  queueing_area: string | null;
  entrance_fee: string | null;
  transit_info: string | null;
  selling_mode: EventSellingMode;
  preorder_enabled: boolean;
  preorder_opens_at: string | null;
  preorder_closes_at: string | null;
  postorder_enabled: boolean;
  postorder_opens_at: string | null;
  postorder_closes_at: string | null;
  sales_status_override: 'auto' | 'closed';
  preorder_pickup_instructions: string | null;
}

interface PaymentMethodDraft {
  id: string | null;
  method_type: 'promptpay' | 'bank_transfer' | 'qr_image' | 'other';
  display_name: string;
  account_name: string;
  account_number: string;
  bank_name: string;
  promptpay_id: string;
  qr_image_url: string;
  instructions: string;
  payment_deadline_at: string | null;
  is_enabled: boolean;
}

interface EventProductRow {
  id: string;
  name: string;
  stock_total: number | null;
  stock_reserved: number;
  stock_sold: number;
  is_unlimited: boolean;
}

const DEFAULT_TIME_ZONE = 'Asia/Bangkok';

const emptyPaymentMethod: PaymentMethodDraft = {
  id: null,
  method_type: 'promptpay',
  display_name: 'PromptPay / Bank transfer',
  account_name: '',
  account_number: '',
  bank_name: '',
  promptpay_id: '',
  qr_image_url: '',
  instructions: '',
  payment_deadline_at: null,
  is_enabled: true,
};

const toInputValue = (value: string | null, timeZone: string) => formatDateTimeForInput(value, timeZone);

const fromInputValue = (value: string, timeZone: string) => {
  if (!value) return null;
  const parsed = parseDateTimeInputInTimeZone(value, timeZone);
  return parsed ? parsed.toISOString() : null;
};

const addDaysIso = (value: string | null, days: number) => {
  const base = value ? new Date(value) : new Date();
  if (Number.isNaN(base.getTime())) return null;
  base.setDate(base.getDate() + days);
  return base.toISOString();
};

const getFiniteAvailable = (product: EventProductRow) => {
  if (product.is_unlimited) return Number.POSITIVE_INFINITY;
  return Math.max(0, Number(product.stock_total || 0) - Number(product.stock_reserved || 0) - Number(product.stock_sold || 0));
};

export default function PreorderSettings() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventSettingsRow | null>(null);
  const [catalogProducts, setCatalogProducts] = useState<EventProductRow[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodDraft>(emptyPaymentMethod);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [qrUploading, setQrUploading] = useState(false);
  const [toast, setToast] = useState<{ tone?: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string } | null>(null);

  const handleQrUpload = async (file: File | null) => {
    if (!file || !event?.artist_id) return;
    setQrUploading(true);
    try {
      const extension = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      const path = `${event.artist_id}/payment-qr-${eventId}-${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from('Avatar').upload(path, file, {
        contentType: file.type || 'image/png',
        upsert: true,
      });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('Avatar').getPublicUrl(path);
      updatePaymentMethod('qr_image_url', publicUrl);
      setToast({ tone: 'success', title: 'QR image uploaded', detail: 'Remember to save payment settings.' });
    } catch (error) {
      setToast({ tone: 'error', title: 'QR upload failed', detail: error instanceof Error ? error.message : 'Could not upload the image.' });
    } finally {
      setQrUploading(false);
    }
  };

  const loadSettings = async () => {
    if (!eventId) return;
    setLoading(true);

    try {
      const [{ data: eventData, error: eventError }, { data: catalogData, error: catalogError }, { data: paymentData, error: paymentError }] = await Promise.all([
        supabase
          .from('events')
          .select('id, artist_id, event_name, start_date, end_date, event_timezone, location, location_name, location_detail, booth_detail, booth_number, queueing_area, entrance_fee, transit_info, selling_mode, preorder_enabled, preorder_opens_at, preorder_closes_at, postorder_enabled, postorder_opens_at, postorder_closes_at, sales_status_override, preorder_pickup_instructions')
          .eq('id', eventId)
          .single(),
        supabase.rpc('list_event_products', { p_event_id: eventId }),
        supabase
          .from('event_payment_methods')
          .select('id, method_type, display_name, account_name, account_number, bank_name, promptpay_id, qr_image_url, instructions, payment_deadline_at, is_enabled')
          .eq('event_id', eventId)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);

      if (eventError) throw eventError;
      if (catalogError) throw catalogError;
      if (paymentError) throw paymentError;

      setEvent(eventData as EventSettingsRow);
      setCatalogProducts((catalogData || []) as EventProductRow[]);
      const payment = paymentData as Partial<PaymentMethodDraft> | null;
      setPaymentMethod(payment ? {
        ...emptyPaymentMethod,
        id: payment.id || null,
        method_type: (payment.method_type as PaymentMethodDraft['method_type']) || 'promptpay',
        display_name: payment.display_name || '',
        account_name: payment.account_name || '',
        account_number: payment.account_number || '',
        bank_name: payment.bank_name || '',
        promptpay_id: payment.promptpay_id || '',
        qr_image_url: payment.qr_image_url || '',
        instructions: payment.instructions || '',
        payment_deadline_at: payment.payment_deadline_at || null,
        is_enabled: payment.is_enabled ?? true,
      } : emptyPaymentMethod);
    } catch (error: any) {
      setToast({ tone: 'error', title: 'Could not load order settings', detail: error.message });
      setEvent(null);
      setCatalogProducts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, [eventId]);

  const eventTimeZone = event?.event_timezone || DEFAULT_TIME_ZONE;
  const preorderEnabled = Boolean(event?.preorder_enabled);
  const postorderEnabled = Boolean(event?.postorder_enabled);
  const orderingClosed = event?.sales_status_override === 'closed';
  const isAdvanceOrderMode = preorderEnabled || postorderEnabled;
  const readinessScope = isAdvanceOrderMode ? 'customer order pages' : 'live selling flow';
  const hasPickupInstructions = (event?.preorder_pickup_instructions || '').trim().length > 0;
  const hasPaymentInstructions =
    paymentMethod.is_enabled &&
    (
      paymentMethod.promptpay_id.trim().length > 0 ||
      paymentMethod.account_number.trim().length > 0 ||
      paymentMethod.qr_image_url.trim().length > 0 ||
      paymentMethod.instructions.trim().length > 0
    );
  const hasCatalogProducts = catalogProducts.length > 0;
  const finiteProducts = catalogProducts.filter((product) => !product.is_unlimited);
  const finiteProductsWithStock = finiteProducts.filter((product) => getFiniteAvailable(product) > 0).length;
  const finiteStockReady = finiteProducts.length === 0 || finiteProductsWithStock > 0;
  const preorderWindowOrderReady =
    !event?.preorder_opens_at ||
    !event?.preorder_closes_at ||
    new Date(event.preorder_opens_at).getTime() < new Date(event.preorder_closes_at).getTime();
  const preorderClosesBeforeEventStarts =
    !event?.preorder_closes_at ||
    !event?.start_date ||
    new Date(event.preorder_closes_at).getTime() <= new Date(event.start_date).getTime();
  const preorderWindowReady =
    !preorderEnabled ||
    (Boolean(event?.preorder_opens_at && event?.preorder_closes_at) &&
      preorderWindowOrderReady &&
      preorderClosesBeforeEventStarts);
  const postorderWindowOrderReady =
    !event?.postorder_opens_at ||
    !event?.postorder_closes_at ||
    new Date(event.postorder_opens_at).getTime() < new Date(event.postorder_closes_at).getTime();
  const postOrderStartsAfterEvent =
    !event?.postorder_opens_at ||
    !event?.end_date ||
    new Date(event.postorder_opens_at).getTime() >= new Date(event.end_date).getTime();
  const postorderWindowReady =
    !postorderEnabled ||
    (Boolean(event?.postorder_opens_at && event?.postorder_closes_at) &&
      postorderWindowOrderReady &&
      postOrderStartsAfterEvent);

  const readinessItems = useMemo(
    () => {
      const baseItems: Array<{ icon: LucideIcon; label: string; detail: string; ready: boolean }> = [
        {
        icon: PackageCheck,
        label: 'Event catalog has products',
        detail: hasCatalogProducts
          ? `${catalogProducts.length} product${catalogProducts.length === 1 ? '' : 's'} available for this event.`
          : 'Add products to this event catalog before opening customer orders.',
        ready: hasCatalogProducts,
        },
        {
        icon: Store,
        label: 'Finite stock is available',
        detail: finiteProducts.length === 0
          ? 'All event products are unlimited.'
          : `${finiteProductsWithStock}/${finiteProducts.length} finite product${finiteProducts.length === 1 ? '' : 's'} have available stock.`,
        ready: finiteStockReady,
        },
      ];

      if (orderingClosed) {
        baseItems.push({
          icon: AlertTriangle,
          label: 'Emergency close is on',
          detail: 'Customer ordering is manually closed until you turn this off.',
          ready: false,
        });
      }

      if (preorderEnabled) {
        baseItems.push({
        icon: Clock3,
        label: 'Pre-order window is valid',
        detail: preorderWindowReady
          ? 'Open and close times are ready.'
          : 'Set a pre-order window that closes before the event starts.',
        ready: preorderWindowReady,
        });
        baseItems.push({
        icon: CalendarClock,
        label: 'Pre-order closes before event',
        detail: preorderClosesBeforeEventStarts ? 'Pre-order ends before event-day live sales begin.' : 'Move the pre-order close time before the event starts.',
        ready: preorderClosesBeforeEventStarts,
        });
      }

      if (postorderEnabled) {
        baseItems.push({
          icon: Clock3,
          label: 'Post-order window is valid',
          detail: postorderWindowReady ? 'Open and close times are ready.' : 'Set a post-order window that starts after the event ends.',
          ready: postorderWindowReady,
        });
        baseItems.push({
          icon: CalendarClock,
          label: 'Post-order starts after event',
          detail: postOrderStartsAfterEvent ? 'Post-order starts after the event ends.' : 'Move the post-order open time after the event end.',
          ready: postOrderStartsAfterEvent,
        });
      }

      if (isAdvanceOrderMode) {
        baseItems.push({
        icon: CheckCircle2,
        label: 'Pickup instructions added',
        detail: hasPickupInstructions ? 'Customers will see pickup instructions after ordering.' : 'Tell customers where and when to show their pickup code.',
        ready: hasPickupInstructions,
        });
        baseItems.push({
        icon: CheckCircle2,
        label: 'Payment instructions added',
        detail: hasPaymentInstructions ? 'Customers can see how to transfer before uploading a slip.' : 'Add PromptPay, bank account, QR image, or clear payment instructions.',
        ready: hasPaymentInstructions,
        });
      }

      return baseItems;
    },
    [catalogProducts.length, finiteProducts.length, finiteProductsWithStock, finiteStockReady, hasCatalogProducts, hasPaymentInstructions, hasPickupInstructions, isAdvanceOrderMode, orderingClosed, postOrderStartsAfterEvent, postorderEnabled, postorderWindowReady, preorderClosesBeforeEventStarts, preorderEnabled, preorderWindowReady]
  );

  const readyCount = readinessItems.filter((item) => item.ready).length;

  const updateEvent = <K extends keyof EventSettingsRow>(key: K, value: EventSettingsRow[K]) => {
    setEvent((current) => current ? { ...current, [key]: value } : current);
  };

  const updatePaymentMethod = <K extends keyof PaymentMethodDraft>(key: K, value: PaymentMethodDraft[K]) => {
    setPaymentMethod((current) => ({ ...current, [key]: value }));
  };

  const togglePreorder = () => {
    setEvent((current) => {
      if (!current) return current;
      const enabled = !current.preorder_enabled;
      const next = { ...current, preorder_enabled: enabled };
      if (enabled && (!current.preorder_opens_at || !current.preorder_closes_at)) {
        const now = new Date();
        const eventStart = new Date(current.start_date);
        const defaultClose = !Number.isNaN(eventStart.getTime()) && eventStart > now ? eventStart : new Date(current.end_date);
        next.preorder_opens_at = now.toISOString();
        next.preorder_closes_at = Number.isNaN(defaultClose.getTime()) ? addDaysIso(null, 7) : defaultClose.toISOString();
      }
      return next;
    });
  };

  const togglePostorder = () => {
    setEvent((current) => {
      if (!current) return current;
      const enabled = !current.postorder_enabled;
      const next = { ...current, postorder_enabled: enabled };
      if (enabled && (!current.postorder_opens_at || !current.postorder_closes_at)) {
        next.postorder_opens_at = current.end_date || new Date().toISOString();
        next.postorder_closes_at = addDaysIso(current.end_date, 14);
      }
      return next;
    });
  };

  const toggleEmergencyClose = () => {
    setEvent((current) => {
      if (!current) return current;
      return {
        ...current,
        sales_status_override: current.sales_status_override === 'closed' ? 'auto' : 'closed',
      };
    });
  };

  const saveSettings = async () => {
    if (!event) return;
    setSaving(true);

    try {
      const compatibilitySellingMode: EventSellingMode = event.sales_status_override === 'closed'
        ? 'closed'
        : event.preorder_enabled
          ? 'preorder'
          : event.postorder_enabled
            ? 'post_event'
            : 'live';
      const { error } = await supabase
        .from('events')
        .update({
          event_name: event.event_name,
          start_date: event.start_date,
          end_date: event.end_date,
          location: event.location || '',
          location_name: event.location || '',
          location_detail: null,
          booth_detail: event.booth_detail || null,
          booth_number: event.booth_detail || null,
          queueing_area: event.queueing_area || '',
          entrance_fee: event.entrance_fee || '',
          transit_info: event.transit_info || '',
          selling_mode: compatibilitySellingMode,
          preorder_enabled: event.preorder_enabled,
          preorder_opens_at: event.preorder_opens_at,
          preorder_closes_at: event.preorder_closes_at,
          postorder_enabled: event.postorder_enabled,
          postorder_opens_at: event.postorder_opens_at,
          postorder_closes_at: event.postorder_closes_at,
          sales_status_override: event.sales_status_override || 'auto',
          preorder_pickup_instructions: event.preorder_pickup_instructions?.trim() || null,
        })
        .eq('id', event.id);

      if (error) throw error;
      const paymentPayload = {
        event_id: event.id,
        artist_id: event.artist_id,
        method_type: paymentMethod.method_type,
        display_name: paymentMethod.display_name.trim() || null,
        account_name: paymentMethod.account_name.trim() || null,
        account_number: paymentMethod.account_number.trim() || null,
        bank_name: paymentMethod.bank_name.trim() || null,
        promptpay_id: paymentMethod.promptpay_id.trim() || null,
        qr_image_url: paymentMethod.qr_image_url.trim() || null,
        instructions: paymentMethod.instructions.trim() || null,
        payment_deadline_at: paymentMethod.payment_deadline_at,
        is_enabled: paymentMethod.is_enabled,
      };
      const { error: paymentError } = paymentMethod.id
        ? await supabase.from('event_payment_methods').update(paymentPayload).eq('id', paymentMethod.id)
        : await supabase.from('event_payment_methods').insert(paymentPayload);

      if (paymentError) throw paymentError;
      setToast({ tone: 'success', title: 'Order settings saved' });
      await loadSettings();
    } catch (error: any) {
      setToast({ tone: 'error', title: 'Order settings failed', detail: error.message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader activePage="events" />
        <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center text-sm font-bold text-gray-400">
          Loading order settings...
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader activePage="events" />
        <main className="mx-auto max-w-3xl p-4 md:p-6">
          <button onClick={() => navigate('/manage-events')} className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-black text-gray-700 hover:bg-gray-50">
            <ArrowLeft size={18} /> Back to events
          </button>
          <div className="rounded-2xl border border-red-100 bg-white p-6 text-sm font-bold text-red-700">
            Event not found or unavailable.
          </div>
        </main>
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader activePage="events" />
      <main className="mx-auto max-w-5xl p-4 md:p-6">
        {eventId && <EventNavTabs eventId={eventId} sellingMode={event.selling_mode} />}

        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-pink-600">Order Settings</div>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-gray-950 md:text-3xl">{event.event_name}</h1>
            <p className="mt-1 text-sm font-semibold text-gray-500">
              Set event details, sales schedule, pickup notes, and payment instructions in one place.
            </p>
          </div>
          <div className="rounded-xl border border-pink-100 bg-white px-4 py-3 text-sm font-black text-gray-800 shadow-sm">
            {readyCount}/{readinessItems.length} ready
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="grid gap-5">
              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                <div className="mb-4 flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-gray-700">
                    <Settings size={20} aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-base font-black text-gray-950">Event details</h2>
                    <p className="mt-1 text-xs font-semibold text-gray-500">Basic information used across the customer page, queue, POS, and order flows.</p>
                  </div>
                </div>
                <div className="grid gap-4">
                  <label className="grid gap-2">
                    <span className="text-sm font-black text-gray-700">Event name</span>
                    <input
                      value={event.event_name}
                      onChange={(e) => updateEvent('event_name', e.target.value)}
                      className="min-h-12 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-pink-300"
                    />
                  </label>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2">
                      <span className="text-sm font-black text-gray-700">Event starts</span>
                      <input
                        type="datetime-local"
                        value={toInputValue(event.start_date, eventTimeZone)}
                        onChange={(e) => updateEvent('start_date', fromInputValue(e.target.value, eventTimeZone) || event.start_date)}
                        className="min-h-12 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-pink-300"
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-black text-gray-700">Event ends</span>
                      <input
                        type="datetime-local"
                        value={toInputValue(event.end_date, eventTimeZone)}
                        onChange={(e) => updateEvent('end_date', fromInputValue(e.target.value, eventTimeZone) || event.end_date)}
                        className="min-h-12 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-pink-300"
                      />
                    </label>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2">
                      <span className="text-sm font-black text-gray-700">Location</span>
                      <input
                        value={event.location || event.location_name || ''}
                        onChange={(e) => updateEvent('location', e.target.value)}
                        className="min-h-12 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-pink-300"
                        placeholder="e.g. Siam Paragon"
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-black text-gray-700">Booth detail</span>
                      <input
                        value={event.booth_detail || event.booth_number || ''}
                        onChange={(e) => updateEvent('booth_detail', e.target.value)}
                        className="min-h-12 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-pink-300"
                        placeholder="e.g. A12, Creator Hall"
                      />
                    </label>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2">
                      <span className="text-sm font-black text-gray-700">Queueing area</span>
                      <input
                        value={event.queueing_area || ''}
                        onChange={(e) => updateEvent('queueing_area', e.target.value)}
                        className="min-h-12 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-pink-300"
                        placeholder="e.g. Queue lane beside booth A12"
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-black text-gray-700">Entrance fee</span>
                      <input
                        value={event.entrance_fee || ''}
                        onChange={(e) => updateEvent('entrance_fee', e.target.value)}
                        className="min-h-12 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-pink-300"
                        placeholder="e.g. Free / 300 THB"
                      />
                    </label>
                  </div>
                  <label className="grid gap-2">
                    <span className="text-sm font-black text-gray-700">Transit info</span>
                    <textarea
                      value={event.transit_info || ''}
                      onChange={(e) => updateEvent('transit_info', e.target.value)}
                      rows={3}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-semibold outline-none focus:border-pink-300"
                      placeholder="How customers should get to the venue."
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-pink-100 bg-pink-50/50 p-4">
                <div className="mb-4">
                  <h2 className="text-base font-black text-gray-950">Sales schedule</h2>
                  <p className="mt-1 text-xs font-semibold text-gray-500">Live queue / POS is automatic during the event day. Turn on pre-order or post-order when this event needs customer orders outside the live booth.</p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <SalesModeCard
                    icon={ShoppingCart}
                    title="Live event day"
                    detail="Auto-active from event start to end."
                    active={!orderingClosed}
                    locked
                  />
                  <SalesModeCard
                    icon={PackageCheck}
                    title="Pre-order"
                    detail="Reserve before event, pickup at booth."
                    active={preorderEnabled}
                    onClick={togglePreorder}
                  />
                  <SalesModeCard
                    icon={Truck}
                    title="Post-order"
                    detail="Order after event, fulfill later."
                    active={postorderEnabled}
                    onClick={togglePostorder}
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleEmergencyClose}
                    className={`rounded-full px-3 py-1.5 text-xs font-black transition-colors ${
                      orderingClosed
                        ? 'bg-slate-900 text-white'
                        : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Emergency close customer ordering
                  </button>
                  <span className="text-xs font-semibold text-gray-500">Use only when customers should not place new orders even if a schedule window is open.</span>
                </div>
              </div>

              {preorderEnabled && (
                <div className="rounded-2xl border border-gray-100 bg-white p-4">
                  <div className="mb-4">
                    <h2 className="text-base font-black text-gray-950">Pre-order window</h2>
                    <p className="mt-1 text-xs font-semibold text-gray-500">Customers can reserve items before the event, then pick them up at the booth.</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2">
                      <span className="text-sm font-black text-gray-700">Pre-order opens</span>
                      <input
                        type="datetime-local"
                        value={toInputValue(event.preorder_opens_at, eventTimeZone)}
                        onChange={(e) => updateEvent('preorder_opens_at', fromInputValue(e.target.value, eventTimeZone))}
                        className="min-h-12 rounded-xl border border-gray-200 px-3 text-sm font-bold outline-none focus:border-pink-300"
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-black text-gray-700">Pre-order closes</span>
                      <input
                        type="datetime-local"
                        value={toInputValue(event.preorder_closes_at, eventTimeZone)}
                        onChange={(e) => updateEvent('preorder_closes_at', fromInputValue(e.target.value, eventTimeZone))}
                        className="min-h-12 rounded-xl border border-gray-200 px-3 text-sm font-bold outline-none focus:border-pink-300"
                      />
                    </label>
                  </div>
                  <div className="mt-4 rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sm font-semibold text-sky-800">
                    Times are saved using the event timezone: <span className="font-black">{eventTimeZone}</span>.
                  </div>
                </div>
              )}

              {postorderEnabled && (
                <div className="rounded-2xl border border-gray-100 bg-white p-4">
                  <div className="mb-4">
                    <h2 className="text-base font-black text-gray-950">Post-order window</h2>
                    <p className="mt-1 text-xs font-semibold text-gray-500">Customers can order after the event, then you fulfill by shipping or post-event handling.</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2">
                      <span className="text-sm font-black text-gray-700">Post-order opens</span>
                      <input
                        type="datetime-local"
                        value={toInputValue(event.postorder_opens_at, eventTimeZone)}
                        onChange={(e) => updateEvent('postorder_opens_at', fromInputValue(e.target.value, eventTimeZone))}
                        className="min-h-12 rounded-xl border border-gray-200 px-3 text-sm font-bold outline-none focus:border-pink-300"
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-black text-gray-700">Post-order closes</span>
                      <input
                        type="datetime-local"
                        value={toInputValue(event.postorder_closes_at, eventTimeZone)}
                        onChange={(e) => updateEvent('postorder_closes_at', fromInputValue(e.target.value, eventTimeZone))}
                        className="min-h-12 rounded-xl border border-gray-200 px-3 text-sm font-bold outline-none focus:border-pink-300"
                      />
                    </label>
                  </div>
                  <div className="mt-4 rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sm font-semibold text-sky-800">
                    Times are saved using the event timezone: <span className="font-black">{eventTimeZone}</span>.
                  </div>
                </div>
              )}

              {isAdvanceOrderMode && (
                <label className="grid gap-2">
                  <span className="text-sm font-black text-gray-700">Pickup instructions</span>
                  <textarea
                    value={event.preorder_pickup_instructions || ''}
                    onChange={(e) => updateEvent('preorder_pickup_instructions', e.target.value)}
                    rows={5}
                    className="rounded-xl border border-gray-200 px-3 py-3 text-sm font-semibold outline-none focus:border-pink-300"
                    placeholder="Example: Show your pickup code at booth A12 between 12:00-17:00."
                  />
                </label>
              )}

              {isAdvanceOrderMode && (
              <div className="rounded-2xl border border-pink-100 bg-pink-50/60 p-4">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-base font-black text-gray-950">Payment instructions</h2>
                    <p className="mt-1 text-xs font-semibold text-gray-500">Money goes directly to your account. NireQ only stores the instruction and slip workflow.</p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs font-black text-gray-700">
                    <input
                      type="checkbox"
                      checked={paymentMethod.is_enabled}
                      onChange={(e) => updatePaymentMethod('is_enabled', e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-pink-600 focus:ring-pink-200"
                    />
                    Enabled
                  </label>
                </div>

                <div className="grid gap-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2">
                      <span className="text-sm font-black text-gray-700">Method type</span>
                      <select
                        value={paymentMethod.method_type}
                        onChange={(e) => updatePaymentMethod('method_type', e.target.value as PaymentMethodDraft['method_type'])}
                        className="min-h-12 rounded-xl border border-pink-100 bg-white px-3 text-sm font-bold outline-none focus:border-pink-300"
                      >
                        <option value="promptpay">PromptPay</option>
                        <option value="bank_transfer">Bank transfer</option>
                        <option value="qr_image">QR image</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-black text-gray-700">Display name</span>
                      <input
                        value={paymentMethod.display_name}
                        onChange={(e) => updatePaymentMethod('display_name', e.target.value)}
                        placeholder="PromptPay / Bank transfer"
                        className="min-h-12 rounded-xl border border-pink-100 bg-white px-3 text-sm font-bold outline-none focus:border-pink-300"
                      />
                    </label>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2">
                      <span className="text-sm font-black text-gray-700">PromptPay ID</span>
                      <input
                        value={paymentMethod.promptpay_id}
                        onChange={(e) => updatePaymentMethod('promptpay_id', e.target.value)}
                        placeholder="Phone / national ID / e-wallet ID"
                        className="min-h-12 rounded-xl border border-pink-100 bg-white px-3 text-sm font-bold outline-none focus:border-pink-300"
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-black text-gray-700">Payment deadline</span>
                      <input
                        type="datetime-local"
                        value={toInputValue(paymentMethod.payment_deadline_at, eventTimeZone)}
                        onChange={(e) => updatePaymentMethod('payment_deadline_at', fromInputValue(e.target.value, eventTimeZone))}
                        className="min-h-12 rounded-xl border border-pink-100 bg-white px-3 text-sm font-bold outline-none focus:border-pink-300"
                      />
                    </label>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <label className="grid gap-2 md:col-span-1">
                      <span className="text-sm font-black text-gray-700">Bank name</span>
                      <input
                        value={paymentMethod.bank_name}
                        onChange={(e) => updatePaymentMethod('bank_name', e.target.value)}
                        placeholder="KBank, SCB, etc."
                        className="min-h-12 rounded-xl border border-pink-100 bg-white px-3 text-sm font-bold outline-none focus:border-pink-300"
                      />
                    </label>
                    <label className="grid gap-2 md:col-span-1">
                      <span className="text-sm font-black text-gray-700">Account name</span>
                      <input
                        value={paymentMethod.account_name}
                        onChange={(e) => updatePaymentMethod('account_name', e.target.value)}
                        placeholder="Account holder"
                        className="min-h-12 rounded-xl border border-pink-100 bg-white px-3 text-sm font-bold outline-none focus:border-pink-300"
                      />
                    </label>
                    <label className="grid gap-2 md:col-span-1">
                      <span className="text-sm font-black text-gray-700">Account number</span>
                      <input
                        value={paymentMethod.account_number}
                        onChange={(e) => updatePaymentMethod('account_number', e.target.value)}
                        placeholder="000-0-00000-0"
                        className="min-h-12 rounded-xl border border-pink-100 bg-white px-3 text-sm font-bold outline-none focus:border-pink-300"
                      />
                    </label>
                  </div>

                  <div className="grid gap-2">
                    <span className="text-sm font-black text-gray-700">Payment QR image</span>
                    {paymentMethod.qr_image_url ? (
                      <div className="flex items-center gap-3">
                        <img
                          src={paymentMethod.qr_image_url}
                          alt="Payment QR preview"
                          className="h-28 w-28 rounded-xl border border-pink-100 bg-white object-contain"
                        />
                        <div className="grid gap-2">
                          <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-pink-200 bg-pink-50 px-4 text-sm font-black text-pink-700 hover:bg-pink-100">
                            {qrUploading ? 'Uploading…' : 'Replace image'}
                            <input type="file" accept="image/*" className="sr-only" disabled={qrUploading} onChange={(e) => void handleQrUpload(e.target.files?.[0] || null)} />
                          </label>
                          <button
                            type="button"
                            onClick={() => updatePaymentMethod('qr_image_url', '')}
                            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-bold text-gray-600 hover:bg-gray-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ) : (
                      <label className="flex min-h-14 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-pink-200 bg-pink-50/40 px-3 text-sm font-bold text-pink-700 hover:bg-pink-50">
                        {qrUploading ? 'Uploading…' : 'Upload PromptPay / transfer QR image'}
                        <input type="file" accept="image/*" className="sr-only" disabled={qrUploading} onChange={(e) => void handleQrUpload(e.target.files?.[0] || null)} />
                      </label>
                    )}
                  </div>

                  <label className="grid gap-2">
                    <span className="text-sm font-black text-gray-700">Extra instructions</span>
                    <textarea
                      value={paymentMethod.instructions}
                      onChange={(e) => updatePaymentMethod('instructions', e.target.value)}
                      rows={3}
                      placeholder="Example: Transfer exact amount, upload slip, then wait for confirmation."
                      className="rounded-xl border border-pink-100 bg-white px-3 py-3 text-sm font-semibold outline-none focus:border-pink-300"
                    />
                  </label>
                </div>
              </div>
              )}

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => navigate(`/manage-events/${event.id}/catalog`)}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-5 text-sm font-black text-gray-700 hover:bg-gray-50"
                >
                  <PackageCheck size={17} /> Event catalog
                </button>
                <button
                  type="button"
                  onClick={saveSettings}
                  disabled={saving}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-pink-600 px-5 text-sm font-black text-white shadow-sm hover:bg-pink-700 disabled:opacity-60"
                >
                  <Save size={17} /> {saving ? 'Saving...' : 'Save settings'}
                </button>
              </div>
            </div>
          </section>

          <aside className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-pink-50 text-pink-600">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h2 className="text-base font-black text-gray-900">Readiness checklist</h2>
                <p className="mt-1 text-xs font-semibold leading-5 text-gray-500">
                  Use this to catch setup gaps before customers see the {readinessScope}.
                </p>
              </div>
            </div>

            <div className="grid gap-3">
              {readinessItems.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                    <div className="flex items-start gap-3">
                      <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${item.ready ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                        <Icon size={17} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-black text-gray-800">{item.label}</div>
                          <span className={`shrink-0 text-[11px] font-black uppercase tracking-[0.12em] ${item.ready ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {item.ready ? 'Ready' : 'Check'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-semibold leading-5 text-gray-500">{item.detail}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      </main>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

function SalesModeCard({
  icon: Icon,
  title,
  detail,
  active,
  onClick,
  locked = false,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  active: boolean;
  onClick?: () => void;
  locked?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={locked}
      className={`rounded-xl border p-4 text-left transition-colors ${
        active
          ? 'border-pink-300 bg-white shadow-sm ring-2 ring-pink-100'
          : 'border-pink-100 bg-white/70 hover:border-pink-200 hover:bg-white'
      } ${locked ? 'cursor-default disabled:opacity-100' : ''}`}
    >
      <div className="flex items-start gap-3">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${active ? 'bg-pink-100 text-pink-700' : 'bg-gray-100 text-gray-600'}`}>
          <Icon size={19} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-black text-gray-950">{title}</h3>
            {active && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-800">{locked ? 'Auto' : 'Enabled'}</span>}
          </div>
          <p className="mt-1 text-xs font-semibold leading-5 text-gray-600">{detail}</p>
        </div>
      </div>
    </button>
  );
}
