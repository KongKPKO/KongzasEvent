import OrderPromotionDetails from '../reports/OrderPromotionDetails';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock3, ReceiptText, Search, X } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { formatPrice } from '../../utils/currency';
import { formatDateInTimeZone, parseDateTimeInputInTimeZone } from '../../utils/timezone';
import { useI18n } from '../../i18n';
import ActivityRewardsCard from '../promotions/ActivityRewardsCard';
import { activityRewardStateForOrder } from '../../utils/activityRewards';

const PAGE_SIZE = 20;

type HistoryOrder = {
  id: string;
  order_number: string;
  created_at: string;
  status: string;
  payment_status: string;
  payment_method: string | null;
  total_price: number;
  currency: string;
  customer_type: 'queue' | 'walk_in';
  queue_id: string | null;
  queue_number: number | null;
  item_count: number;
};

type HistoryPage = {
  orders: HistoryOrder[];
  total: number;
  page: number;
  page_size: number;
};

type HistoryItem = {
  id: string;
  product_id: string;
  name: string;
  variant_name: string | null;
  sku: string | null;
  quantity: number;
  price_per_unit: number;
  line_total: number;
  currency: string;
  line_type: string | null;
  promotion_name: string | null;
  note: string | null;
  components?: Array<{
    product_id: string;
    name: string;
    quantity: number;
  }>;
  discount_amount: number | null;
};

type StatusHistoryEntry = {
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  actor_role: string | null;
  created_at: string;
};

type SaleDetail = HistoryOrder & {
  subtotal_price: number;
  discount_total: number;
  note: string | null;
  pricing_breakdown: unknown[];
  items: HistoryItem[];
  payment: {
    amount_expected: number;
    status: string;
    method: string | null;
    submitted_at: string | null;
    confirmed_at: string | null;
    refunded_at: string | null;
    refund_note: string | null;
    refund_reference: string | null;
  };
  status_history: StatusHistoryEntry[];
};

type Props = {
  open: boolean;
  eventId: string;
  eventName: string;
  eventTimeZone?: string | null;
  onClose: () => void;
};

const nextCalendarDay = (value: string): string => {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return '';
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
};

const dateBoundary = (value: string, timeZone: string, endExclusive: boolean): string | null => {
  if (!value) return null;
  const date = parseDateTimeInputInTimeZone(`${endExclusive ? nextCalendarDay(value) : value}T00:00`, timeZone);
  return date?.toISOString() || null;
};

const normalizePage = (value: unknown): HistoryPage => {
  const page = (value && typeof value === 'object' ? value : {}) as Partial<HistoryPage>;
  return {
    orders: Array.isArray(page.orders) ? page.orders : [],
    total: Number(page.total || 0),
    page: Number(page.page || 1),
    page_size: Number(page.page_size || PAGE_SIZE),
  };
};

export default function PosSalesHistory({ open, eventId, eventName, eventTimeZone, onClose }: Props) {
  const { language } = useI18n();
  const th = language === 'th';
  const text = (en: string, thai: string) => th ? thai : en;
  const timeZone = eventTimeZone || 'Asia/Bangkok';
  const locale = th ? 'th-TH' : 'en-GB';
  const drawerRef = useRef<HTMLDivElement>(null);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [orderStatus, setOrderStatus] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [dateMode, setDateMode] = useState<'latest' | 'today' | 'custom'>('latest');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<HistoryPage>({ orders: [], total: 0, page: 1, page_size: PAGE_SIZE });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    drawerRef.current?.focus();
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const controls = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex="0"]'
      )).filter(node => node.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) {
        event.preventDefault();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === drawerRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleDialogKeys);
    return () => {
      document.removeEventListener('keydown', handleDialogKeys);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose, open]);

  const effectiveDates = useMemo(() => {
    if (dateMode === 'latest') return { from: '', to: '' };
    if (dateMode === 'today') {
      const today = formatDateInTimeZone(new Date(), timeZone);
      return { from: today, to: today };
    }
    return { from: fromDate, to: toDate };
  }, [dateMode, fromDate, timeZone, toDate]);

  const fetchHistory = useCallback(async () => {
    if (!open || !eventId) return;
    const request = ++listRequestRef.current;
    setLoading(true);
    setLoadError(false);
    const { data, error } = await supabase.rpc('list_pos_sales_history', {
      p_event_id: eventId,
      p_search: search || null,
      p_order_status: orderStatus || null,
      p_payment_method: paymentMethod || null,
      p_payment_status: paymentStatus || null,
      p_from: dateBoundary(effectiveDates.from, timeZone, false),
      p_to: dateBoundary(effectiveDates.to, timeZone, true),
      p_page: page,
      p_page_size: PAGE_SIZE,
    });
    if (request !== listRequestRef.current) return;
    if (error) {
      console.error('[PosSalesHistory] Could not load sales history:', error);
      setLoadError(true);
      setHistory({ orders: [], total: 0, page, page_size: PAGE_SIZE });
    } else {
      setHistory(normalizePage(data));
    }
    setLoading(false);
  }, [effectiveDates.from, effectiveDates.to, eventId, open, orderStatus, page, paymentMethod, paymentStatus, search, timeZone]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  const fetchDetail = useCallback(async (orderId: string) => {
    const request = ++detailRequestRef.current;
    setSelectedOrderId(orderId);
    setDetail(null);
    setDetailLoading(true);
    setDetailError(false);
    const { data, error } = await supabase.rpc('get_pos_sale_detail', {
      p_event_id: eventId,
      p_order_id: orderId,
    });
    if (request !== detailRequestRef.current) return;
    if (error || !data) {
      console.error('[PosSalesHistory] Could not load sale detail:', error);
      setDetailError(true);
    } else {
      setDetail(data as SaleDetail);
    }
    setDetailLoading(false);
  }, [eventId]);

  useEffect(() => {
    if (!open) {
      listRequestRef.current += 1;
      detailRequestRef.current += 1;
      setSelectedOrderId(null);
      setDetail(null);
    }
  }, [open]);

  useEffect(() => {
    detailRequestRef.current += 1;
    setSelectedOrderId(null);
    setDetail(null);
    setPage(1);
  }, [eventId]);

  const pageCount = Math.max(1, Math.ceil(history.total / PAGE_SIZE));
  const formatDateTime = (value: string) => new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));

  const orderStatusLabel = (status: string) => ({
    draft: text('Draft', 'ร่าง'),
    confirmed: text('In progress', 'กำลังดำเนินการ'),
    completed: text('Completed', 'สำเร็จ'),
    cancelled: text('Cancelled', 'ยกเลิก'),
  }[status] || status.replace(/_/g, ' '));

  const paymentStatusLabel = (status: string) => ({
    awaiting_payment: text('Awaiting payment', 'รอชำระเงิน'),
    payment_submitted: text('Payment submitted', 'แจ้งชำระแล้ว'),
    payment_confirmed: text('Paid', 'ชำระสำเร็จ'),
    payment_rejected: text('Payment rejected', 'ปฏิเสธการชำระ'),
    payment_expired: text('Payment expired', 'หมดเวลาชำระ'),
    payment_cancelled: text('Payment cancelled', 'ยกเลิกการชำระ'),
    payment_submitted_late: text('Late payment submitted', 'แจ้งชำระล่าช้า'),
    refund_pending: text('Refund pending', 'รอคืนเงิน'),
    refunded: text('Refunded', 'คืนเงินแล้ว'),
  }[status] || status.replace(/_/g, ' '));

  const paymentMethodLabel = (method: string | null) => method === 'cash'
    ? text('Cash', 'เงินสด')
    : method === 'transfer'
      ? text('Bank transfer', 'โอนเงิน')
      : text('Not recorded', 'ยังไม่บันทึก');

  const resetFilters = () => {
    setSearchInput('');
    setSearch('');
    setOrderStatus('');
    setPaymentMethod('');
    setPaymentStatus('');
    setDateMode('latest');
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]" data-testid="pos-sales-history">
      <button
        type="button"
        className="absolute inset-0 bg-gray-950/45 backdrop-blur-[1px]"
        aria-label={text('Close sales history', 'ปิดประวัติการขาย')}
        onClick={onClose}
      />
      <div
        ref={drawerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pos-sales-history-title"
        className="absolute inset-y-0 right-0 flex w-full max-w-5xl flex-col overflow-hidden bg-gray-50 shadow-2xl outline-none"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ReceiptText className="shrink-0 text-pink-600" size={22} aria-hidden="true" />
              <h2 id="pos-sales-history-title" className="text-xl font-black text-gray-900">{text('Sales history', 'ประวัติการขาย')}</h2>
            </div>
            <p className="mt-1 truncate text-sm text-gray-500">{eventName} · {timeZone}</p>
          </div>
          <button type="button" onClick={onClose} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50" aria-label={text('Close sales history', 'ปิดประวัติการขาย')}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="shrink-0 space-y-3 border-b border-gray-200 bg-white px-4 py-3 sm:px-6">
          <div className="flex flex-wrap gap-2" aria-label={text('Date shortcuts', 'ตัวเลือกช่วงวันที่')}>
            <button type="button" onClick={() => { setDateMode('latest'); setPage(1); }} aria-pressed={dateMode === 'latest'} className={`min-h-10 rounded-xl border px-4 text-sm font-bold ${dateMode === 'latest' ? 'border-pink-600 bg-pink-600 text-white' : 'border-gray-200 text-gray-700'}`}>{text('Latest', 'ล่าสุด')}</button>
            <button type="button" onClick={() => { setDateMode('today'); setPage(1); }} aria-pressed={dateMode === 'today'} className={`min-h-10 rounded-xl border px-4 text-sm font-bold ${dateMode === 'today' ? 'border-pink-600 bg-pink-600 text-white' : 'border-gray-200 text-gray-700'}`}>{text('Today', 'วันนี้')}</button>
            <button type="button" onClick={() => { setDateMode('custom'); setPage(1); }} aria-pressed={dateMode === 'custom'} className={`min-h-10 rounded-xl border px-4 text-sm font-bold ${dateMode === 'custom' ? 'border-pink-600 bg-pink-600 text-white' : 'border-gray-200 text-gray-700'}`}>{text('Date range', 'กำหนดช่วงวันที่')}</button>
          </div>
          {dateMode === 'custom' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-xs font-bold text-gray-600">{text('From', 'ตั้งแต่')}<input type="date" value={fromDate} max={toDate || undefined} onChange={event => { setFromDate(event.target.value); setPage(1); }} className="min-h-10 min-w-0 rounded-xl border border-gray-200 px-3 text-sm" /></label>
              <label className="grid gap-1 text-xs font-bold text-gray-600">{text('To', 'ถึง')}<input type="date" value={toDate} min={fromDate || undefined} onChange={event => { setToDate(event.target.value); setPage(1); }} className="min-h-10 min-w-0 rounded-xl border border-gray-200 px-3 text-sm" /></label>
            </div>
          )}
          <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_repeat(3,minmax(130px,auto))_auto]">
            <label className="relative min-w-0">
              <span className="sr-only">{text('Search order or queue number', 'ค้นหาเลขออเดอร์หรือเลขคิว')}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={17} aria-hidden="true" />
              <input type="search" value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder={text('Order number or queue number', 'เลขออเดอร์หรือเลขคิว')} className="min-h-11 w-full rounded-xl border border-gray-200 py-2 pl-10 pr-3 text-sm" />
            </label>
            <select aria-label={text('Order status', 'สถานะออเดอร์')} value={orderStatus} onChange={event => { setOrderStatus(event.target.value); setPage(1); }} className="min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold">
              <option value="">{text('All order statuses', 'ทุกสถานะออเดอร์')}</option>
              <option value="draft">{text('Draft', 'ร่าง')}</option>
              <option value="confirmed">{text('In progress', 'กำลังดำเนินการ')}</option>
              <option value="completed">{text('Completed', 'สำเร็จ')}</option>
              <option value="cancelled">{text('Cancelled', 'ยกเลิก')}</option>
            </select>
            <select aria-label={text('Payment method', 'ช่องทางรับเงิน')} value={paymentMethod} onChange={event => { setPaymentMethod(event.target.value); setPage(1); }} className="min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold">
              <option value="">{text('All payment methods', 'ทุกช่องทางรับเงิน')}</option>
              <option value="cash">{text('Cash', 'เงินสด')}</option>
              <option value="transfer">{text('Bank transfer', 'โอนเงิน')}</option>
            </select>
            <select aria-label={text('Payment status', 'สถานะการชำระเงิน')} value={paymentStatus} onChange={event => { setPaymentStatus(event.target.value); setPage(1); }} className="min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold">
              <option value="">{text('All payment statuses', 'ทุกสถานะการชำระ')}</option>
              <option value="awaiting_payment">{text('Awaiting payment', 'รอชำระเงิน')}</option>
              <option value="payment_confirmed">{text('Paid', 'ชำระสำเร็จ')}</option>
              <option value="refund_pending">{text('Refund pending', 'รอคืนเงิน')}</option>
              <option value="refunded">{text('Refunded', 'คืนเงินแล้ว')}</option>
            </select>
            <button type="button" onClick={resetFilters} className="min-h-11 rounded-xl border border-gray-200 px-3 text-sm font-bold text-gray-600 hover:bg-gray-50">{text('Clear', 'ล้างตัวกรอง')}</button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(320px,0.9fr)_minmax(380px,1.1fr)]">
          <section className={`${selectedOrderId ? 'hidden md:flex' : 'flex'} min-h-0 flex-col border-r border-gray-200 bg-white`} aria-label={text('Sales orders', 'รายการขาย')}>
            <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-4 text-sm text-gray-500">
              <span>{loading ? text('Loading...', 'กำลังโหลด...') : text(`${history.total} orders`, `${history.total} ออเดอร์`)}</span>
              <span>{text(`Page ${history.page} of ${pageCount}`, `หน้า ${history.page} จาก ${pageCount}`)}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3" aria-busy={loading}>
              {loadError ? (
                <div role="alert" className="rounded-2xl border border-red-100 bg-red-50 p-5 text-center text-sm text-red-700">
                  <p>{text('Could not load sales history.', 'โหลดประวัติการขายไม่สำเร็จ')}</p>
                  <button type="button" onClick={() => void fetchHistory()} className="mt-3 min-h-10 rounded-xl border border-red-200 bg-white px-4 font-bold">{text('Try again', 'ลองอีกครั้ง')}</button>
                </div>
              ) : !loading && history.orders.length === 0 ? (
                <div className="flex h-full min-h-48 flex-col items-center justify-center text-center text-gray-500">
                  <ReceiptText size={36} className="mb-3 text-gray-300" aria-hidden="true" />
                  <p className="font-bold">{text('No sales found', 'ไม่พบประวัติการขาย')}</p>
                  <p className="mt-1 text-xs">{text('Try another search or filter.', 'ลองเปลี่ยนคำค้นหาหรือตัวกรอง')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {history.orders.map(order => (
                    <button
                      type="button"
                      key={order.id}
                      onClick={() => void fetchDetail(order.id)}
                      aria-pressed={selectedOrderId === order.id}
                      className={`w-full rounded-2xl border p-4 text-left transition-colors ${selectedOrderId === order.id ? 'border-pink-300 bg-pink-50' : 'border-gray-100 bg-white hover:border-pink-200 hover:bg-pink-50/40'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-black text-gray-900">#{order.order_number}</div>
                          <div className="mt-1 flex items-center gap-1 text-xs text-gray-500"><Clock3 size={13} aria-hidden="true" />{formatDateTime(order.created_at)}</div>
                        </div>
                        <div className="shrink-0 text-right font-black text-gray-900">{formatPrice(Number(order.total_price), order.currency)}</div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                        <span className="rounded-full bg-gray-100 px-2.5 py-1 font-bold text-gray-700">{order.customer_type === 'queue' && order.queue_number != null ? text(`Queue #${order.queue_number}`, `คิว #${order.queue_number}`) : text('Walk-in', 'หน้าบูธ')}</span>
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 font-bold text-blue-700">{paymentMethodLabel(order.payment_method)}</span>
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-bold text-emerald-700">{paymentStatusLabel(order.payment_status)}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-gray-500"><span>{orderStatusLabel(order.status)}</span><span>{text(`${order.item_count} items`, `${order.item_count} ชิ้น`)}</span></div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-between border-t border-gray-100 p-3">
              <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(current => Math.max(1, current - 1))} className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-gray-200 px-3 text-sm font-bold disabled:opacity-40"><ChevronLeft size={16} aria-hidden="true" />{text('Previous', 'ก่อนหน้า')}</button>
              <button type="button" disabled={page >= pageCount || loading} onClick={() => setPage(current => current + 1)} className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-gray-200 px-3 text-sm font-bold disabled:opacity-40">{text('Next', 'ถัดไป')}<ChevronRight size={16} aria-hidden="true" /></button>
            </div>
          </section>

          <section className={`${selectedOrderId ? 'flex' : 'hidden md:flex'} min-h-0 flex-col bg-gray-50`} aria-label={text('Order detail', 'รายละเอียดออเดอร์')}>
            {selectedOrderId && (
              <div className="shrink-0 border-b border-gray-200 bg-white p-3 md:hidden">
                <button type="button" onClick={() => { setSelectedOrderId(null); setDetail(null); }} className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-gray-200 px-3 text-sm font-bold"><ChevronLeft size={16} aria-hidden="true" />{text('Back to orders', 'กลับไปรายการ')}</button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
              {!selectedOrderId ? (
                <div className="flex h-full items-center justify-center text-center text-sm text-gray-500">{text('Select an order to inspect its recorded details.', 'เลือกออเดอร์เพื่อตรวจสอบรายละเอียดที่บันทึกไว้')}</div>
              ) : detailLoading ? (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">{text('Loading order detail...', 'กำลังโหลดรายละเอียดออเดอร์...')}</div>
              ) : detailError || !detail ? (
                <div role="alert" className="rounded-2xl border border-red-100 bg-red-50 p-5 text-center text-sm text-red-700">
                  <p>{text('Could not load this order.', 'โหลดออเดอร์นี้ไม่สำเร็จ')}</p>
                  <button type="button" onClick={() => void fetchDetail(selectedOrderId)} className="mt-3 min-h-10 rounded-xl border border-red-200 bg-white px-4 font-bold">{text('Try again', 'ลองอีกครั้ง')}</button>
                </div>
              ) : (
                <div className="space-y-4" data-testid="pos-sale-detail">
                  <div className="rounded-2xl border border-gray-200 bg-white p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div><div className="text-xs font-bold uppercase tracking-wider text-gray-400">{text('Order', 'ออเดอร์')}</div><h3 className="mt-1 text-xl font-black text-gray-900">#{detail.order_number}</h3><p className="mt-1 text-sm text-gray-500">{formatDateTime(detail.created_at)}</p></div>
                      <div className="text-right"><div className="text-xl font-black text-pink-700">{formatPrice(Number(detail.total_price), detail.currency)}</div><p className="mt-1 text-xs font-bold text-emerald-700">{paymentStatusLabel(detail.payment_status)}</p></div>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div><dt className="text-xs text-gray-500">{text('Customer', 'ลูกค้า')}</dt><dd className="mt-1 font-bold">{detail.customer_type === 'queue' && detail.queue_number != null ? text(`Queue #${detail.queue_number}`, `คิว #${detail.queue_number}`) : text('Walk-in', 'หน้าบูธ')}</dd></div>
                      <div><dt className="text-xs text-gray-500">{text('Order status', 'สถานะออเดอร์')}</dt><dd className="mt-1 font-bold">{orderStatusLabel(detail.status)}</dd></div>
                      <div><dt className="text-xs text-gray-500">{text('Payment method', 'ช่องทางรับเงิน')}</dt><dd className="mt-1 font-bold">{paymentMethodLabel(detail.payment_method)}</dd></div>
                      <div><dt className="text-xs text-gray-500">{text('Payment status', 'สถานะการชำระ')}</dt><dd className="mt-1 font-bold">{paymentStatusLabel(detail.payment_status)}</dd></div>
                    </dl>
                  </div>

                  <OrderPromotionDetails pricingBreakdown={detail.pricing_breakdown} currency={detail.currency} />
                  <ActivityRewardsCard
                    pricingBreakdown={detail.pricing_breakdown}
                    state={activityRewardStateForOrder(detail.status, detail.payment_status)}
                    language={language}
                    orderReference={detail.order_number}
                  />

                  <div className="rounded-2xl border border-gray-200 bg-white p-5">
                    <h4 className="font-black text-gray-900">{text('Items', 'รายการสินค้า')}</h4>
                    <div className="mt-3 divide-y divide-gray-100">
                      {detail.items.map(item => (
                        <div key={item.id} className="py-3 first:pt-0 last:pb-0">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-bold text-gray-900">{item.name}</div>
                              {(item.variant_name || item.sku) && <div className="mt-0.5 text-xs text-gray-500">{[item.variant_name, item.sku].filter(Boolean).join(' · ')}</div>}
                              {item.promotion_name && <div className="mt-1 text-xs font-bold text-pink-700">{item.promotion_name}</div>}
                              {item.note && <div className="mt-1 text-xs text-gray-600">{item.note}</div>}
                              {item.components && item.components.length > 0 && (
                                <ul className="mt-2 space-y-1 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600" aria-label={text('Recorded bundle components', 'ส่วนประกอบชุดที่บันทึกไว้')}>
                                  {item.components.map(component => (
                                    <li key={component.product_id} className="flex justify-between gap-3">
                                      <span>{component.name}</span>
                                      <span className="shrink-0 font-bold">× {component.quantity}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <div className="shrink-0 text-right"><div className="font-bold text-gray-900">{formatPrice(Number(item.line_total), item.currency)}</div><div className="text-xs text-gray-500">{item.quantity} × {formatPrice(Number(item.price_per_unit), item.currency)}</div></div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {Number(detail.discount_total) > 0 && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{text('The recorded discount is stored at order level and is not allocated to individual items.', 'ส่วนลดที่บันทึกไว้เป็นยอดระดับออเดอร์ ระบบไม่ได้จัดสรรแยกรายสินค้า')}</p>}
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-5">
                    <h4 className="font-black text-gray-900">{text('Payment summary', 'สรุปการชำระเงิน')}</h4>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex justify-between gap-4"><dt className="text-gray-500">{text('Subtotal', 'ยอดก่อนส่วนลด')}</dt><dd className="font-bold">{formatPrice(Number(detail.subtotal_price), detail.currency)}</dd></div>
                      <div className="flex justify-between gap-4"><dt className="text-gray-500">{text('Discount', 'ส่วนลด')}</dt><dd className="font-bold text-emerald-700">− {formatPrice(Number(detail.discount_total), detail.currency)}</dd></div>
                      <div className="flex justify-between gap-4 border-t border-gray-100 pt-2"><dt className="font-black">{text('Net total', 'ยอดชำระสุทธิ')}</dt><dd className="font-black text-pink-700">{formatPrice(Number(detail.total_price), detail.currency)}</dd></div>
                    </dl>
                    {detail.payment.refunded_at && (
                      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        <div className="font-black">{text('Refund recorded', 'บันทึกการคืนเงินแล้ว')}</div>
                        <div className="mt-1 text-xs">{formatDateTime(detail.payment.refunded_at)}{detail.payment.refund_reference ? ` · ${detail.payment.refund_reference}` : ''}</div>
                        {detail.payment.refund_note && <p className="mt-2 text-xs">{detail.payment.refund_note}</p>}
                      </div>
                    )}
                    {detail.note && <div className="mt-4 rounded-xl bg-gray-50 p-3 text-sm text-gray-700"><span className="font-bold">{text('Order note', 'หมายเหตุออเดอร์')}:</span> {detail.note}</div>}
                  </div>

                  {detail.status_history.length > 0 && (
                    <div className="rounded-2xl border border-gray-200 bg-white p-5">
                      <h4 className="font-black text-gray-900">{text('Recorded status history', 'ประวัติสถานะที่บันทึกไว้')}</h4>
                      <ol className="mt-3 space-y-3">
                        {detail.status_history.map((entry, index) => <li key={`${entry.created_at}-${index}`} className="border-l-2 border-pink-200 pl-3 text-sm"><div className="font-bold text-gray-800">{entry.event_type.replace(/_/g, ' ')}</div><div className="mt-0.5 text-xs text-gray-500">{formatDateTime(entry.created_at)}{entry.actor_role ? ` · ${entry.actor_role}` : ''}</div></li>)}
                      </ol>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
