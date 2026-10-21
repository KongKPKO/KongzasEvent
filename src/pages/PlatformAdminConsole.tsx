import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  ListOrdered,
  MessageSquareText,
  Search,
  ShieldAlert,
  Store,
  TicketCheck,
  Users,
} from 'lucide-react';
import AdminFeedback from './AdminFeedback';
import AdminConsoleShell from '../components/platform-admin/AdminConsoleShell';
import { AdminEmptyState, AdminErrorState, AdminLoadingState } from '../components/platform-admin/AdminConsoleStates';
import { ConfirmDialog, Toast } from '../components/ui/Feedback';
import { useI18n } from '../i18n';
import {
  PLATFORM_ADMIN_PAGE_SIZE,
  changePlatformAdmin,
  fetchPlatformAdmin,
  setAccountManagementSuspension,
  type PlatformAdminAction,
  type PlatformAdminAuditItem,
  type PlatformAdminCampaign,
  type PlatformAdminCreator,
  type PlatformAdminCreatorDetail,
  type PlatformAdminEnvelope,
  type PlatformAdminEvent,
  type PlatformAdminOrder,
  type PlatformAdminQueueEntry,
  type PlatformAdminUser,
  type PlatformAdminUserDetail,
} from '../lib/platformAdmin';

type Copy = readonly [thai: string, english: string];
type FilterOption = { value: string; label: Copy };
type Column<T> = { label: Copy; className?: string; render: (item: T) => ReactNode };

const listFilters: Record<'users' | 'creators' | 'events' | 'campaigns' | 'orders' | 'queue', FilterOption[]> = {
  users: [
    { value: '', label: ['ทุกสถานะ', 'All statuses'] },
    { value: 'active', label: ['ใช้งานอยู่', 'Active'] },
    { value: 'suspended', label: ['ระงับแล้ว', 'Suspended'] },
  ],
  creators: [
    { value: '', label: ['ทุกสถานะ', 'All statuses'] },
    { value: 'published', label: ['เผยแพร่แล้ว', 'Published'] },
    { value: 'private', label: ['ส่วนตัว', 'Private'] },
  ],
  events: [
    { value: '', label: ['ทุกสถานะ', 'All statuses'] },
    { value: 'confirmed', label: ['ยืนยันแล้ว', 'Confirmed'] },
    { value: 'cancelled', label: ['ยกเลิก', 'Cancelled'] },
    { value: 'ended', label: ['จบแล้ว', 'Ended'] },
  ],
  campaigns: [
    { value: '', label: ['ทุกสถานะ', 'All statuses'] },
    { value: 'draft', label: ['ฉบับร่าง', 'Draft'] },
    { value: 'published', label: ['เผยแพร่แล้ว', 'Published'] },
    { value: 'cancelled', label: ['ยกเลิก', 'Cancelled'] },
    { value: 'archived', label: ['เก็บถาวร', 'Archived'] },
  ],
  orders: [
    { value: '', label: ['ทุกสถานะ', 'All statuses'] },
    { value: 'draft', label: ['ฉบับร่าง', 'Draft'] },
    { value: 'completed', label: ['เสร็จสิ้น', 'Completed'] },
    { value: 'cancelled', label: ['ยกเลิก', 'Cancelled'] },
  ],
  queue: [
    { value: '', label: ['ทุกสถานะ', 'All statuses'] },
    { value: 'waiting', label: ['กำลังรอ', 'Waiting'] },
    { value: 'calling', label: ['กำลังเรียก', 'Calling'] },
    { value: 'serving', label: ['กำลังให้บริการ', 'Serving'] },
    { value: 'complete', label: ['เสร็จสิ้น', 'Completed'] },
  ],
};

const normalizeStatus = (value: string | null | undefined) => value?.trim() || '—';

function statusTone(value: string | null | undefined) {
  const status = value?.toLowerCase() || '';
  if (['active', 'published', 'complete', 'completed', 'paid', 'confirmed', 'serving', 'open'].includes(status)) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  }
  if (['pending', 'waiting', 'calling', 'called', 'upcoming', 'draft', 'awaiting_payment'].includes(status)) {
    return 'border-amber-200 bg-amber-50 text-amber-900';
  }
  if (['suspended', 'hidden', 'cancelled', 'rejected', 'failed'].includes(status)) {
    return 'border-red-200 bg-red-50 text-red-800';
  }
  return 'border-slate-200 bg-slate-100 text-slate-700';
}

function StatusBadge({ value }: { value: string | null | undefined }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${statusTone(value)}`}>{normalizeStatus(value)}</span>;
}

function usePlatformAdminData<T>(
  action: PlatformAdminAction,
  options: { query?: string; target?: string; page?: number; filter?: string },
) {
  const [data, setData] = useState<PlatformAdminEnvelope<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const requestSequence = useRef(0);

  useEffect(() => {
    let active = true;
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    setData(null);

    void fetchPlatformAdmin<T>(action, options)
      .then((response) => {
        if (active && requestId === requestSequence.current) setData(response);
      })
      .catch((failure: unknown) => {
        if (!active || requestId !== requestSequence.current) return;
        setError(failure instanceof Error ? failure.message : 'Unknown request error');
      })
      .finally(() => {
        if (active && requestId === requestSequence.current) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [action, options.filter, options.page, options.query, options.target, revision]);

  return { data, error, loading, retry: () => setRevision((current) => current + 1) };
}

function formatDate(value: string | null | undefined, locale: string) {
  if (!value || Number.isNaN(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function DateValue({ value, locale }: { value: string | null | undefined; locale: string }) {
  if (!value || Number.isNaN(Date.parse(value))) return <span>—</span>;
  return <time dateTime={value}>{formatDate(value, locale)}</time>;
}

function ErrorOrLoading({
  loading,
  error,
  retry,
  th,
}: {
  loading: boolean;
  error: string | null;
  retry: () => void;
  th: boolean;
}) {
  if (loading) return <AdminLoadingState label={th ? 'กำลังโหลดข้อมูล…' : 'Loading data…'} />;
  if (!error) return null;
  const denied = /forbidden|permission|not authorized|jwt|aal2/i.test(error);
  return (
    <AdminErrorState
      title={denied ? (th ? 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้' : 'Permission required') : (th ? 'โหลดข้อมูลไม่สำเร็จ' : 'Could not load data')}
      detail={denied
        ? (th ? 'เซสชันผู้ดูแลอาจหมดอายุหรือยังยืนยัน MFA ไม่ครบ กรุณาเข้าสู่ระบบใหม่' : 'Your admin session may have expired or require MFA verification. Sign in again and retry.')
        : (th ? 'ระบบไม่สามารถดึงข้อมูลล่าสุดได้ กรุณาลองอีกครั้ง' : 'The latest data is unavailable. Please try again.')}
      retry={retry}
      retryLabel={th ? 'ลองอีกครั้ง' : 'Retry'}
    />
  );
}

function ListView<T extends { id: string }>({
  action,
  columns,
  filters,
  detailBase,
  empty,
}: {
  action: PlatformAdminAction;
  columns: Column<T>[];
  filters?: FilterOption[];
  detailBase?: string;
  empty: Copy;
}) {
  const { language } = useI18n();
  const th = language === 'th';
  const pick = (copy: Copy) => copy[th ? 0 : 1];
  const [draftQuery, setDraftQuery] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const request = usePlatformAdminData<T>(action, { query, filter, page });
  const items = request.data?.items || [];
  const total = request.data?.total ?? items.length;
  const totalPages = Math.max(1, Math.ceil(total / PLATFORM_ADMIN_PAGE_SIZE));

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setQuery(draftQuery.trim());
  };

  return (
    <section className="space-y-4">
      <form className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row" onSubmit={submitSearch} role="search">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{th ? 'ค้นหา' : 'Search'}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden="true" />
          <input
            type="search"
            className="min-h-11 w-full rounded-xl border border-slate-300 bg-white py-2 pl-10 pr-3 text-sm font-semibold outline-none focus:border-pink-700 focus:ring-2 focus:ring-pink-100"
            placeholder={th ? 'ค้นหาด้วยชื่อ อีเมล หรือรหัส…' : 'Search by name, email, or ID…'}
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
          />
        </label>
        {filters && (
          <label>
            <span className="sr-only">{th ? 'กรองสถานะ' : 'Filter by status'}</span>
            <select
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold outline-none focus:border-pink-700 focus:ring-2 focus:ring-pink-100 sm:w-48"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setPage(1);
              }}
            >
              {filters.map((option) => <option key={option.value} value={option.value}>{pick(option.label)}</option>)}
            </select>
          </label>
        )}
        <button type="submit" className="min-h-11 rounded-xl bg-slate-950 px-5 text-sm font-black text-white hover:bg-pink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-700">
          {th ? 'ค้นหา' : 'Search'}
        </button>
      </form>

      <ErrorOrLoading loading={request.loading} error={request.error} retry={request.retry} th={th} />

      {!request.loading && !request.error && items.length === 0 && (
        <AdminEmptyState title={pick(empty)} detail={th ? 'ลองเปลี่ยนคำค้นหาหรือตัวกรอง' : 'Try changing the search or filter.'} />
      )}

      {!request.loading && !request.error && items.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-black uppercase tracking-wide text-slate-500">
                <tr>
                  {columns.map((column) => <th key={pick(column.label)} scope="col" className={`px-4 py-3 ${column.className || ''}`}>{pick(column.label)}</th>)}
                  {detailBase && <th scope="col" className="w-20 px-4 py-3"><span className="sr-only">{th ? 'ดูรายละเอียด' : 'View details'}</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id} className="align-top hover:bg-slate-50/70">
                    {columns.map((column) => <td key={pick(column.label)} className={`px-4 py-3 font-medium text-slate-700 ${column.className || ''}`}>{column.render(item)}</td>)}
                    {detailBase && (
                      <td className="px-4 py-2 text-right">
                        <Link
                          to={`${detailBase}/${encodeURIComponent(item.id)}`}
                          className="inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm font-black text-pink-700 hover:bg-pink-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pink-700"
                          aria-label={th ? `ดูรายละเอียด ${item.id}` : `View details ${item.id}`}
                        >
                          {th ? 'ดู' : 'View'} <ChevronRight size={16} aria-hidden="true" />
                        </Link>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-bold text-slate-500">
              {th ? `ทั้งหมด ${total.toLocaleString('th-TH')} รายการ` : `${total.toLocaleString('en-US')} total`}
            </p>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40">
                {th ? 'ก่อนหน้า' : 'Previous'}
              </button>
              <span className="px-2 text-sm font-black text-slate-700">{page} / {totalPages}</span>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40">
                {th ? 'ถัดไป' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-bold text-slate-900">{children || '—'}</dd>
    </div>
  );
}

function DetailCard({ children }: { children: ReactNode }) {
  return <dl className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2">{children}</dl>;
}

function Memberships({ memberships }: { memberships: PlatformAdminUserDetail['memberships'] }) {
  const { language, dateLocale } = useI18n();
  const th = language === 'th';
  if (!memberships.length) {
    return <AdminEmptyState title={th ? 'ไม่พบสมาชิกภาพ' : 'No memberships'} detail={th ? 'บัญชีนี้ยังไม่มีบทบาทในร้าน' : 'This account has no store roles.'} />;
  }
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-labelledby="memberships-title">
      <h2 id="memberships-title" className="border-b border-slate-200 px-5 py-4 font-black">{th ? 'สมาชิกภาพและบทบาท' : 'Memberships & roles'}</h2>
      <ul className="divide-y divide-slate-100">
        {memberships.map((membership) => (
          <li key={`${membership.store_id}:${membership.role}`} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-black text-slate-900">{membership.store_name}</p>
              <p className="mt-0.5 text-xs font-medium text-slate-500"><DateValue value={membership.created_at} locale={dateLocale} /></p>
            </div>
            <div className="flex items-center gap-2"><StatusBadge value={membership.role} />{membership.status && <StatusBadge value={membership.status} />}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function UserDetail({ id }: { id: string }) {
  const { language, dateLocale } = useI18n();
  const th = language === 'th';
  const request = usePlatformAdminData<PlatformAdminUserDetail>('user', { target: id });
  const loadedUser = request.data?.detail;
  const loadedUserIsStale = !!loadedUser && loadedUser.id !== id;
  const user = loadedUserIsStale ? undefined : loadedUser;
  const [adminDialogOpen, setAdminDialogOpen] = useState(false);
  const [adminReason, setAdminReason] = useState('');
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [managementDialogTarget, setManagementDialogTarget] = useState<{ userId: string; expectedSuspended: boolean } | null>(null);
  const [managementReason, setManagementReason] = useState('');
  const [managementBusy, setManagementBusy] = useState(false);
  const [managementError, setManagementError] = useState('');
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; title: string; detail?: string } | null>(null);
  const reasonValid = adminReason.trim().length >= 5 && adminReason.trim().length <= 500;
  const managementReasonValid = managementReason.trim().length >= 5 && managementReason.trim().length <= 500;
  const managementMutationSequence = useRef(0);

  useEffect(() => {
    managementMutationSequence.current += 1;
    setManagementDialogTarget(null);
    setManagementReason('');
    setManagementError('');
    setManagementBusy(false);
  }, [id]);

  const closeAdminDialog = () => {
    if (adminBusy) return;
    setAdminDialogOpen(false);
    setAdminReason('');
    setAdminError('');
  };

  const submitAdminChange = async () => {
    if (!user || !reasonValid || adminBusy) return;
    const grant = !user.is_platform_admin;
    setAdminBusy(true);
    setAdminError('');
    try {
      await changePlatformAdmin(user.id, grant, adminReason);
      setAdminDialogOpen(false);
      setAdminReason('');
      setToast({
        tone: 'success',
        title: grant ? (th ? 'ให้สิทธิ์ผู้ดูแลแล้ว' : 'Administrator access granted') : (th ? 'ถอนสิทธิ์ผู้ดูแลแล้ว' : 'Administrator access revoked'),
      });
      request.retry();
    } catch (failure) {
      setAdminError(failure instanceof Error ? failure.message : (th ? 'เปลี่ยนสิทธิ์ไม่สำเร็จ' : 'Could not change administrator access.'));
    } finally {
      setAdminBusy(false);
    }
  };

  const closeManagementDialog = () => {
    if (managementBusy) return;
    setManagementDialogTarget(null);
    setManagementReason('');
    setManagementError('');
  };

  const showStaleManagementStatus = () => {
    setManagementDialogTarget(null);
    setManagementReason('');
    setManagementError('');
    setToast({
      tone: 'error',
      title: th ? 'สถานะสิทธิ์จัดการเปลี่ยนแล้ว' : 'Management access changed',
      detail: th ? 'กำลังโหลดสถานะล่าสุด กรุณาตรวจสอบก่อนลองอีกครั้ง' : 'Refreshing the latest status. Review it before trying again.',
    });
    request.retry();
  };

  const submitManagementChange = async () => {
    const target = managementDialogTarget;
    if (!user || !target || !managementReasonValid || managementBusy) return;
    if (user.id !== target.userId || user.suspended !== target.expectedSuspended) {
      showStaleManagementStatus();
      return;
    }

    const suspended = !target.expectedSuspended;
    if (suspended && user.is_platform_admin) {
      setManagementError(th ? 'ต้องถอนสิทธิ์ผู้ดูแลแพลตฟอร์มก่อนระงับสิทธิ์จัดการบัญชี' : 'Revoke platform administrator access before suspending account management access.');
      return;
    }
    const mutationId = ++managementMutationSequence.current;
    setManagementBusy(true);
    setManagementError('');
    try {
      await setAccountManagementSuspension(target.userId, suspended, managementReason, target.expectedSuspended);
      if (mutationId !== managementMutationSequence.current) return;
      setManagementDialogTarget(null);
      setManagementReason('');
      setToast({
        tone: 'success',
        title: suspended
          ? (th ? 'ระงับสิทธิ์จัดการบัญชีแล้ว' : 'Account management access suspended')
          : (th ? 'คืนสิทธิ์จัดการบัญชีแล้ว' : 'Account management access restored'),
        detail: th ? 'ร้าน ทีม และออเดอร์เดิมไม่เปลี่ยนแปลง' : 'Existing stores, team access, and orders are unchanged.',
      });
      request.retry();
    } catch (failure) {
      if (mutationId !== managementMutationSequence.current) return;
      const message = failure && typeof failure === 'object' && 'message' in failure && typeof failure.message === 'string' ? failure.message : '';
      if (/state.?changed|management status changed|reload before retrying/i.test(message)) {
        showStaleManagementStatus();
        return;
      }
      if (/platform.?admin|administrator.*revoke|revoke.*administrator/i.test(message)) {
        setManagementError(th ? 'บัญชียังเป็นผู้ดูแลแพลตฟอร์ม กรุณาถอนสิทธิ์ผู้ดูแลก่อน' : 'This account is still a platform administrator. Revoke administrator access first.');
        return;
      }
      setManagementError(message || (th ? 'เปลี่ยนสิทธิ์จัดการบัญชีไม่สำเร็จ' : 'Could not change account management access.'));
    } finally {
      if (mutationId === managementMutationSequence.current) setManagementBusy(false);
    }
  };

  if (request.loading || request.error || loadedUserIsStale) return <ErrorOrLoading loading={request.loading || loadedUserIsStale} error={request.error} retry={request.retry} th={th} />;
  if (!user) return <AdminEmptyState title={th ? 'ไม่พบผู้ใช้' : 'User not found'} detail={th ? 'ผู้ใช้อาจถูกลบหรือรหัสไม่ถูกต้อง' : 'The user may have been removed or the ID is invalid.'} />;
  return (
    <div className="space-y-4">
      <Toast message={toast} onClose={() => setToast(null)} />
      {user.suspended && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-900" role="status">
          <div className="flex items-center gap-2"><ShieldAlert size={18} aria-hidden="true" />{th ? 'บัญชีนี้ถูกระงับสิทธิ์จัดการ' : 'Management access is suspended for this account'}</div>
          {user.suspended_reason && <p className="mt-1 font-medium text-red-800">{user.suspended_reason}</p>}
        </div>
      )}
      <DetailCard>
        <Field label={th ? 'ชื่อ' : 'Name'}>{user.display_name}</Field>
        <Field label={th ? 'อีเมล' : 'Email'}>{user.email_masked}</Field>
        <Field label={th ? 'สถานะ' : 'Status'}><StatusBadge value={user.status} /></Field>
        <Field label={th ? 'สร้างเมื่อ' : 'Created'}><DateValue value={user.created_at} locale={dateLocale} /></Field>
        <Field label={th ? 'เข้าสู่ระบบล่าสุด' : 'Last sign-in'}><DateValue value={user.last_sign_in_at} locale={dateLocale} /></Field>
        <Field label={th ? 'จำนวนร้าน / สมาชิกภาพ' : 'Creators / memberships'}>{user.creator_count} / {user.membership_count}</Field>
        <Field label="User ID" wide>{user.id}</Field>
      </DetailCard>
      <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby="account-management-access-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="account-management-access-title" className="font-black text-slate-950">{th ? 'สิทธิ์จัดการบัญชี' : 'Account management access'}</h2>
            <p className="mt-1 text-sm font-medium text-slate-600">
              {user.suspended
                ? (th ? 'ผู้ใช้นี้ถูกระงับการจัดการร้านทันทีจนกว่าจะได้รับการคืนสิทธิ์' : 'This user is blocked from managing stores until access is restored.')
                : (th ? 'ผู้ใช้นี้จัดการร้านตามบทบาทสมาชิกภาพของตนได้' : 'This user can manage stores according to their membership roles.')}
            </p>
            <p className="mt-2 text-sm font-semibold text-slate-700">
              {th
                ? 'สมาชิกทีมคนอื่นยังจัดการร้าน คิว การขาย และออเดอร์เดิมต่อได้ ร้านและออเดอร์จะไม่ถูกระงับ ลบ หรือเปลี่ยนสถานะ'
                : 'Other team members can continue managing the same stores, queues, sales, and existing orders. Stores and orders are not suspended, deleted, or changed.'}
            </p>
            {!user.suspended && user.is_platform_admin && (
              <p id="management-admin-blocked" className="mt-2 text-sm font-bold text-amber-800">
                {th ? 'ต้องถอนสิทธิ์ผู้ดูแลแพลตฟอร์มของบัญชีนี้ก่อน จึงจะระงับสิทธิ์จัดการบัญชีได้' : 'Revoke this account’s platform administrator access before suspending its management access.'}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <StatusBadge value={user.suspended ? (th ? 'ระงับสิทธิ์จัดการ' : 'Management suspended') : (th ? 'ใช้งานได้' : 'Active')} />
            <button
              type="button"
              className={`min-h-11 rounded-xl px-4 text-sm font-black text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${user.suspended ? 'bg-emerald-700 hover:bg-emerald-800 focus-visible:outline-emerald-800' : 'bg-red-700 hover:bg-red-800 focus-visible:outline-red-800'}`}
              disabled={managementBusy || (!user.suspended && user.is_platform_admin)}
              aria-describedby={!user.suspended && user.is_platform_admin ? 'management-admin-blocked' : undefined}
              onClick={() => {
                if (!user.suspended && user.is_platform_admin) return;
                setManagementError('');
                setManagementDialogTarget({ userId: user.id, expectedSuspended: user.suspended });
              }}
            >
              {user.suspended ? (th ? 'คืนสิทธิ์จัดการ' : 'Restore management access') : (th ? 'ระงับสิทธิ์จัดการ' : 'Suspend management access')}
            </button>
          </div>
        </div>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby="platform-admin-access-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="platform-admin-access-title" className="font-black text-slate-950">{th ? 'สิทธิ์ผู้ดูแลแพลตฟอร์ม' : 'Platform administrator access'}</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {user.is_platform_admin
                ? (th ? 'บัญชีนี้เข้าถึงข้อมูลผู้ดูแลหลังยืนยัน MFA ได้' : 'This account can access admin data after MFA verification.')
                : (th ? 'บัญชีนี้ยังไม่มีสิทธิ์ผู้ดูแลแพลตฟอร์ม' : 'This account does not have platform administrator access.')}
            </p>
            {user.suspended && !user.is_platform_admin && <p id="admin-restore-required" className="mt-2 text-sm font-bold text-amber-800">{th ? 'คืนสิทธิ์จัดการบัญชีก่อนให้สิทธิ์ผู้ดูแลแพลตฟอร์ม' : 'Restore management access before granting platform administrator access.'}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <StatusBadge value={user.is_platform_admin ? (th ? 'ผู้ดูแล' : 'Administrator') : (th ? 'ผู้ใช้ทั่วไป' : 'Standard user')} />
            <button
              type="button"
              className={`min-h-11 rounded-xl px-4 text-sm font-black text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${user.is_platform_admin ? 'bg-red-700 hover:bg-red-800 focus-visible:outline-red-800' : 'bg-pink-700 hover:bg-pink-800 focus-visible:outline-pink-800'}`}
              disabled={adminBusy || (user.suspended && !user.is_platform_admin)}
              aria-describedby={user.suspended && !user.is_platform_admin ? 'admin-restore-required' : undefined}
              onClick={() => {
                setAdminError('');
                setAdminDialogOpen(true);
              }}
            >
              {user.is_platform_admin ? (th ? 'ถอนสิทธิ์ผู้ดูแล' : 'Revoke admin access') : (th ? 'ให้สิทธิ์ผู้ดูแล' : 'Grant admin access')}
            </button>
          </div>
        </div>
      </section>
      <Memberships memberships={user.memberships || []} />
      <ConfirmDialog
        open={managementDialogTarget !== null}
        title={managementDialogTarget?.expectedSuspended
          ? (th ? 'คืนสิทธิ์จัดการบัญชี' : 'Restore account management access')
          : (th ? 'ระงับสิทธิ์จัดการบัญชี' : 'Suspend account management access')}
        detail={managementDialogTarget?.expectedSuspended
          ? (th ? 'ผู้ใช้นี้จะกลับมาจัดการร้านตามบทบาทสมาชิกภาพของตนได้ ร้าน ทีม และออเดอร์เดิมจะไม่เปลี่ยนแปลง' : 'This user will be able to manage stores according to their membership roles. Existing stores, team access, and orders remain unchanged.')
          : (th ? 'ผู้ใช้นี้จะเสียสิทธิ์จัดการร้านทันที สมาชิกทีมคนอื่นยังทำงานกับร้าน คิว การขาย และออเดอร์เดิมได้ตามปกติ' : 'This user will immediately lose store management access. Other team members can keep working with the stores, queues, sales, and existing orders.')}
        confirmLabel={managementDialogTarget?.expectedSuspended
          ? (th ? 'ยืนยันการคืนสิทธิ์' : 'Confirm restoration')
          : (th ? 'ยืนยันการระงับ' : 'Confirm suspension')}
        tone={managementDialogTarget?.expectedSuspended ? 'default' : 'danger'}
        loading={managementBusy}
        confirmDisabled={!managementReasonValid}
        onConfirm={() => void submitManagementChange()}
        onCancel={closeManagementDialog}
      >
        <label className="mt-4 block text-sm font-bold text-slate-700">
          {th ? 'เหตุผล (5–500 ตัวอักษร)' : 'Reason (5–500 characters)'}
          <textarea
            value={managementReason}
            onChange={(event) => setManagementReason(event.target.value)}
            minLength={5}
            maxLength={500}
            rows={4}
            className="mt-1 w-full resize-y rounded-xl border border-slate-300 p-3 text-sm font-semibold outline-none focus:border-pink-700 focus:ring-2 focus:ring-pink-100"
            disabled={managementBusy}
            required
          />
        </label>
        <p className="mt-1 text-right text-xs font-bold text-slate-500">{managementReason.length} / 500</p>
        {managementError && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700" role="alert">{managementError}</p>}
      </ConfirmDialog>
      <ConfirmDialog
        open={adminDialogOpen}
        title={user.is_platform_admin ? (th ? 'ถอนสิทธิ์ผู้ดูแลแพลตฟอร์ม' : 'Revoke platform administrator access') : (th ? 'ให้สิทธิ์ผู้ดูแลแพลตฟอร์ม' : 'Grant platform administrator access')}
        detail={user.is_platform_admin
          ? (th ? 'บัญชีนี้จะไม่สามารถเปิดคอนโซลผู้ดูแลหลังเซสชันปัจจุบันหมดอายุ ระบบไม่อนุญาตให้ถอนสิทธิ์ของตนเองหรือผู้ดูแลคนสุดท้าย' : 'This account will lose console access after its current session expires. You cannot revoke yourself or the last administrator.')
          : (th ? 'บัญชีนี้จะเข้าถึงข้อมูลแพลตฟอร์มได้หลังตั้งค่าและยืนยัน MFA' : 'This account will be able to access platform data after setting up and verifying MFA.')}
        confirmLabel={user.is_platform_admin ? (th ? 'ยืนยันการถอนสิทธิ์' : 'Confirm revoke') : (th ? 'ยืนยันการให้สิทธิ์' : 'Confirm grant')}
        tone={user.is_platform_admin ? 'danger' : 'default'}
        loading={adminBusy}
        confirmDisabled={!reasonValid}
        onConfirm={() => void submitAdminChange()}
        onCancel={closeAdminDialog}
      >
        <label className="mt-4 block text-sm font-bold text-slate-700">
          {th ? 'เหตุผล (5–500 ตัวอักษร)' : 'Reason (5–500 characters)'}
          <textarea
            value={adminReason}
            onChange={(event) => setAdminReason(event.target.value)}
            minLength={5}
            maxLength={500}
            rows={4}
            className="mt-1 w-full resize-y rounded-xl border border-slate-300 p-3 text-sm font-semibold outline-none focus:border-pink-700 focus:ring-2 focus:ring-pink-100"
            disabled={adminBusy}
            required
          />
        </label>
        <p className="mt-1 text-right text-xs font-bold text-slate-500">{adminReason.length} / 500</p>
        {adminError && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700" role="alert">{adminError}</p>}
      </ConfirmDialog>
    </div>
  );
}

function CreatorDetail({ id }: { id: string }) {
  const { language, dateLocale } = useI18n();
  const th = language === 'th';
  const request = usePlatformAdminData<PlatformAdminCreatorDetail>('creator', { target: id });
  const creator = request.data?.detail;
  if (request.loading || request.error) return <ErrorOrLoading loading={request.loading} error={request.error} retry={request.retry} th={th} />;
  if (!creator) return <AdminEmptyState title={th ? 'ไม่พบครีเอเตอร์' : 'Creator not found'} detail={th ? 'ร้านอาจถูกลบหรือรหัสไม่ถูกต้อง' : 'The creator may have been removed or the ID is invalid.'} />;
  return (
    <div className="space-y-4">
      <DetailCard>
        <Field label={th ? 'ชื่อร้าน' : 'Creator'}>{creator.display_name}</Field>
        <Field label="Slug">{creator.slug}</Field>
        <Field label={th ? 'อีเมลเจ้าของ' : 'Owner email'}>{creator.owner_email_masked}</Field>
        <Field label={th ? 'สถานะ' : 'Status'}><StatusBadge value={creator.status} /></Field>
        <Field label={th ? 'สร้างเมื่อ' : 'Created'}><DateValue value={creator.created_at} locale={dateLocale} /></Field>
        <Field label={th ? 'อีเวนต์ / แคมเปญ' : 'Events / campaigns'}>{creator.event_count} / {creator.campaign_count}</Field>
        <Field label="Creator ID" wide>{creator.id}</Field>
      </DetailCard>
      <Memberships memberships={creator.memberships || []} />
    </div>
  );
}

function EventDetail({ id }: { id: string }) {
  const { language, dateLocale } = useI18n();
  const th = language === 'th';
  const request = usePlatformAdminData<PlatformAdminEvent>('event', { target: id });
  const event = request.data?.detail;
  if (request.loading || request.error) return <ErrorOrLoading loading={request.loading} error={request.error} retry={request.retry} th={th} />;
  if (!event) return <AdminEmptyState title={th ? 'ไม่พบอีเวนต์' : 'Event not found'} detail={th ? 'อีเวนต์อาจถูกลบหรือรหัสไม่ถูกต้อง' : 'The event may have been removed or the ID is invalid.'} />;
  return (
    <div className="space-y-4">
      {event.hidden && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-900" role="status">
          {th ? 'อีเวนต์นี้ถูกซ่อนจากหน้าสาธารณะ' : 'This event is hidden from public surfaces.'}
          {event.moderation_reason && <p className="mt-1 font-medium text-red-800">{event.moderation_reason}</p>}
        </div>
      )}
      <DetailCard>
        <Field label={th ? 'ชื่ออีเวนต์' : 'Event'}>{event.event_name}</Field>
        <Field label={th ? 'ร้าน' : 'Creator'}>{event.store_name}</Field>
        <Field label={th ? 'สถานะ' : 'Status'}><StatusBadge value={event.status} /></Field>
        <Field label={th ? 'บูธเปิดอยู่' : 'Booth open'}><StatusBadge value={event.is_booth_open ? (th ? 'เปิด' : 'Open') : (th ? 'ปิด' : 'Closed')} /></Field>
        <Field label={th ? 'เริ่ม' : 'Starts'}><DateValue value={event.start_at} locale={dateLocale} /></Field>
        <Field label={th ? 'สิ้นสุด' : 'Ends'}><DateValue value={event.end_at} locale={dateLocale} /></Field>
        <Field label={th ? 'คิว / ออเดอร์' : 'Queue / orders'}>{event.queue_count} / {event.order_count}</Field>
        <Field label="Event ID">{event.id}</Field>
        <Field label="Creator ID" wide>{event.store_id}</Field>
      </DetailCard>
    </div>
  );
}

function CampaignDetail({ id }: { id: string }) {
  const { language, dateLocale } = useI18n();
  const th = language === 'th';
  const request = usePlatformAdminData<PlatformAdminCampaign>('campaign', { target: id });
  const campaign = request.data?.detail;
  if (request.loading || request.error) return <ErrorOrLoading loading={request.loading} error={request.error} retry={request.retry} th={th} />;
  if (!campaign) return <AdminEmptyState title={th ? 'ไม่พบแคมเปญ' : 'Campaign not found'} detail={th ? 'แคมเปญอาจถูกลบหรือรหัสไม่ถูกต้อง' : 'The campaign may have been removed or the ID is invalid.'} />;
  return (
    <div className="space-y-4">
      {campaign.hidden && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-900" role="status">
          {th ? 'แคมเปญนี้ถูกซ่อนจากหน้าสาธารณะ' : 'This campaign is hidden from public surfaces.'}
          {campaign.moderation_reason && <p className="mt-1 font-medium text-red-800">{campaign.moderation_reason}</p>}
        </div>
      )}
      <DetailCard>
        <Field label={th ? 'ชื่อแคมเปญ' : 'Campaign'}>{campaign.name}</Field>
        <Field label={th ? 'ร้าน' : 'Creator'}>{campaign.store_name}</Field>
        <Field label="Slug">{campaign.slug}</Field>
        <Field label={th ? 'สถานะ' : 'Status'}><StatusBadge value={campaign.status} /></Field>
        <Field label={th ? 'เริ่ม' : 'Starts'}><DateValue value={campaign.starts_at} locale={dateLocale} /></Field>
        <Field label={th ? 'สิ้นสุด' : 'Ends'}><DateValue value={campaign.ends_at} locale={dateLocale} /></Field>
        <Field label={th ? 'จำนวนออเดอร์' : 'Orders'}>{campaign.order_count}</Field>
        <Field label="Campaign ID">{campaign.id}</Field>
        <Field label="Creator ID" wide>{campaign.store_id}</Field>
      </DetailCard>
    </div>
  );
}

function Overview() {
  const { language, dateLocale } = useI18n();
  const th = language === 'th';
  const request = usePlatformAdminData<never>('overview', {});
  const counts = request.data?.counts;
  const metrics = counts ? [
    { label: ["ผู้ใช้", 'Users'] as Copy, value: counts.users, icon: Users, path: '/admin/users' },
    { label: ['ครีเอเตอร์', 'Creators'] as Copy, value: counts.creators, icon: Store, path: '/admin/creators' },
    { label: ['อีเวนต์ที่กำลังดำเนินงาน', 'Active events'] as Copy, value: counts.active_events, icon: CalendarDays, path: '/admin/events' },
    { label: ['แคมเปญในช่วงขาย', 'Active campaigns'] as Copy, value: counts.active_campaigns, icon: TicketCheck, path: '/admin/campaigns' },
    { label: ['ออเดอร์ที่เปิดอยู่', 'Open orders'] as Copy, value: counts.open_orders, icon: ClipboardCheck, path: '/admin/operations' },
    { label: ['คิวที่กำลังดำเนินการ', 'Active queue'] as Copy, value: counts.active_queue_entries, icon: ListOrdered, path: '/admin/operations/queue' },
    { label: ['คำขอที่รอตรวจ', 'Pending applications'] as Copy, value: counts.pending_applications, icon: Clock3, path: '/admin/applications' },
    { label: ['ข้อเสนอแนะที่เปิดอยู่', 'Open feedback'] as Copy, value: counts.open_feedback, icon: MessageSquareText, path: '/admin/feedback' },
  ] : [];
  if (request.loading || request.error) return <ErrorOrLoading loading={request.loading} error={request.error} retry={request.retry} th={th} />;
  if (!counts) return <AdminEmptyState title={th ? 'ไม่มีข้อมูลภาพรวม' : 'Overview unavailable'} detail={th ? 'ยังไม่มีข้อมูลสรุปจากระบบ' : 'No summary data was returned.'} />;
  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-labelledby="overview-counts-title">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 id="overview-counts-title" className="font-black">{th ? 'สถานะแพลตฟอร์ม' : 'Platform status'}</h2>
          <p className="mt-1 text-xs font-medium text-slate-500">{th ? 'ข้อมูลแบบอ่านอย่างเดียวจากระบบล่าสุด' : 'Read-only snapshot from the latest system data.'}</p>
        </div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map(({ label, value, icon: Icon, path }) => (
            <Link key={path + label[1]} to={path} className="flex min-h-24 items-center gap-4 border-b border-slate-100 px-5 py-4 hover:bg-slate-50 sm:border-r xl:[&:nth-child(4n)]:border-r-0">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-pink-50 text-pink-700"><Icon size={19} aria-hidden="true" /></span>
              <span className="min-w-0"><span className="block text-2xl font-black tracking-tight text-slate-950">{value.toLocaleString(th ? 'th-TH' : 'en-US')}</span><span className="block text-xs font-bold text-slate-500">{label[th ? 0 : 1]}</span></span>
            </Link>
          ))}
        </div>
      </section>
      <AuditList items={request.data?.recent_audit || []} locale={dateLocale} compact />
    </div>
  );
}

function AuditList({ items, locale, compact = false }: { items: PlatformAdminAuditItem[]; locale: string; compact?: boolean }) {
  const { language } = useI18n();
  const th = language === 'th';
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-labelledby={compact ? 'recent-audit-title' : 'audit-title'}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div><h2 id={compact ? 'recent-audit-title' : 'audit-title'} className="font-black">{compact ? (th ? 'กิจกรรมผู้ดูแลล่าสุด' : 'Recent admin activity') : (th ? 'บันทึกการตรวจสอบ' : 'Audit logs')}</h2>{compact && <p className="mt-1 text-xs font-medium text-slate-500">{th ? 'การเข้าถึงและการดำเนินการล่าสุด' : 'Latest access and administrative actions.'}</p>}</div>
        {compact && <Link to="/admin/audit" className="inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm font-black text-pink-700 hover:bg-pink-50">{th ? 'ดูทั้งหมด' : 'View all'}<ChevronRight size={16} /></Link>}
      </div>
      {items.length === 0 ? <div className="p-6 text-center text-sm font-bold text-slate-500">{th ? 'ยังไม่มีกิจกรรม' : 'No activity yet.'}</div> : (
        <ol className="divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
              <div className="min-w-0"><p className="font-black text-slate-900">{item.action}</p><p className="mt-1 break-words text-sm font-medium text-slate-600">{item.summary || `${item.target_type || 'record'} ${item.target_id || ''}`}</p><p className="mt-1 text-xs font-bold text-slate-500">{item.actor_email_masked || (th ? 'ระบบ' : 'System')}</p></div>
              <time className="text-xs font-bold text-slate-500" dateTime={item.created_at}>{formatDate(item.created_at, locale)}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AuditPage() {
  const { language, dateLocale } = useI18n();
  const th = language === 'th';
  const [draftQuery, setDraftQuery] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const request = usePlatformAdminData<PlatformAdminAuditItem>('audit', { query, page });
  const items = request.data?.items || [];
  const total = request.data?.total ?? items.length;
  const pages = Math.max(1, Math.ceil(total / PLATFORM_ADMIN_PAGE_SIZE));
  const submit = (event: FormEvent) => { event.preventDefault(); setPage(1); setQuery(draftQuery.trim()); };
  return <div className="space-y-4">
    <form onSubmit={submit} role="search" className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-3">
      <label className="relative min-w-0 flex-1"><span className="sr-only">{th ? 'ค้นหาบันทึก' : 'Search logs'}</span><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><input type="search" value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} placeholder={th ? 'ค้นหาการดำเนินการ ผู้ดูแล หรือเป้าหมาย…' : 'Search action, admin, or target…'} className="min-h-11 w-full rounded-xl border border-slate-300 py-2 pl-10 pr-3 text-sm font-semibold outline-none focus:border-pink-700 focus:ring-2 focus:ring-pink-100" /></label>
      <button className="min-h-11 rounded-xl bg-slate-950 px-5 text-sm font-black text-white">{th ? 'ค้นหา' : 'Search'}</button>
    </form>
    <ErrorOrLoading loading={request.loading} error={request.error} retry={request.retry} th={th} />
    {!request.loading && !request.error && <AuditList items={items} locale={dateLocale} />}
    {!request.loading && !request.error && items.length > 0 && <div className="flex items-center justify-end gap-2"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="min-h-11 rounded-xl border px-4 text-sm font-bold disabled:opacity-40">{th ? 'ก่อนหน้า' : 'Previous'}</button><span className="px-2 text-sm font-black">{page} / {pages}</span><button disabled={page >= pages} onClick={() => setPage((value) => value + 1)} className="min-h-11 rounded-xl border px-4 text-sm font-bold disabled:opacity-40">{th ? 'ถัดไป' : 'Next'}</button></div>}
  </div>;
}

function EventsCampaigns({ initialTab }: { initialTab: 'events' | 'campaigns' }) {
  const { language, dateLocale } = useI18n();
  const th = language === 'th';
  return <div className="space-y-4">
    <nav className="inline-flex rounded-xl border border-slate-200 bg-white p-1" aria-label={th ? 'เลือกอีเวนต์หรือแคมเปญ' : 'Choose events or campaigns'}>
      <Link to="/admin/events" className={`flex min-h-11 items-center rounded-lg px-4 text-sm font-black ${initialTab === 'events' ? 'bg-slate-950 text-white' : 'text-slate-600'}`}>{th ? 'อีเวนต์' : 'Events'}</Link>
      <Link to="/admin/campaigns" className={`flex min-h-11 items-center rounded-lg px-4 text-sm font-black ${initialTab === 'campaigns' ? 'bg-slate-950 text-white' : 'text-slate-600'}`}>{th ? 'แคมเปญ' : 'Campaigns'}</Link>
    </nav>
    {initialTab === 'events' ? <ListView<PlatformAdminEvent> action="events" filters={listFilters.events} detailBase="/admin/events" empty={['ไม่พบอีเวนต์', 'No events found']} columns={[
      { label: ['อีเวนต์', 'Event'], render: (item) => <div><p className="font-black text-slate-950">{item.event_name}</p><p className="mt-0.5 text-xs text-slate-500">{item.store_name}</p></div> },
      { label: ['ช่วงเวลา', 'Schedule'], render: (item) => <div><DateValue value={item.start_at} locale={dateLocale} /><span className="block text-xs text-slate-500"><DateValue value={item.end_at} locale={dateLocale} /></span></div> },
      { label: ['สถานะ', 'Status'], render: (item) => <div className="flex flex-wrap gap-1"><StatusBadge value={item.status} />{item.hidden && <StatusBadge value={th ? 'ซ่อน' : 'Hidden'} />}</div> },
      { label: ['คิว / ออเดอร์', 'Queue / orders'], render: (item) => `${item.queue_count} / ${item.order_count}` },
    ]} /> : <ListView<PlatformAdminCampaign> action="campaigns" filters={listFilters.campaigns} detailBase="/admin/campaigns" empty={['ไม่พบแคมเปญ', 'No campaigns found']} columns={[
      { label: ['แคมเปญ', 'Campaign'], render: (item) => <div><p className="font-black text-slate-950">{item.name}</p><p className="mt-0.5 text-xs text-slate-500">{item.store_name} · {item.slug}</p></div> },
      { label: ['ช่วงเวลา', 'Schedule'], render: (item) => <div><DateValue value={item.starts_at} locale={dateLocale} /><span className="block text-xs text-slate-500"><DateValue value={item.ends_at} locale={dateLocale} /></span></div> },
      { label: ['สถานะ', 'Status'], render: (item) => <div className="flex flex-wrap gap-1"><StatusBadge value={item.status} />{item.hidden && <StatusBadge value={th ? 'ซ่อน' : 'Hidden'} />}</div> },
      { label: ['ออเดอร์', 'Orders'], render: (item) => item.order_count },
    ]} />}
  </div>;
}

function Operations({ initialTab }: { initialTab: 'orders' | 'queue' }) {
  const { language, dateLocale } = useI18n();
  const th = language === 'th';
  return <div className="space-y-4">
    <nav className="inline-flex rounded-xl border border-slate-200 bg-white p-1" aria-label={th ? 'เลือกข้อมูลการดำเนินงาน' : 'Choose operations data'}>
      <Link to="/admin/operations" className={`flex min-h-11 items-center rounded-lg px-4 text-sm font-black ${initialTab === 'orders' ? 'bg-slate-950 text-white' : 'text-slate-600'}`}>{th ? 'ออเดอร์' : 'Orders'}</Link>
      <Link to="/admin/operations/queue" className={`flex min-h-11 items-center rounded-lg px-4 text-sm font-black ${initialTab === 'queue' ? 'bg-slate-950 text-white' : 'text-slate-600'}`}>{th ? 'กิจกรรมคิว' : 'Queue activity'}</Link>
    </nav>
    {initialTab === 'orders' ? <ListView<PlatformAdminOrder> action="operations_orders" filters={listFilters.orders} empty={['ไม่พบออเดอร์', 'No orders found']} columns={[
      { label: ['ออเดอร์', 'Order'], render: (item) => <div><p className="font-black text-slate-950">{item.code || item.id}</p><p className="mt-0.5 text-xs text-slate-500">{item.store_name}</p></div> },
      { label: ['ช่องทาง', 'Channel'], render: (item) => <div>{item.channel_name || '—'}<span className="block text-xs text-slate-500">{item.order_type}</span></div> },
      { label: ['สถานะออเดอร์', 'Order status'], render: (item) => <StatusBadge value={item.status} /> },
      { label: ['การชำระ / ส่งมอบ', 'Payment / fulfillment'], render: (item) => <div className="flex flex-wrap gap-1"><StatusBadge value={item.payment_status} /><StatusBadge value={item.fulfillment_status} /></div> },
      { label: ['สร้างเมื่อ', 'Created'], render: (item) => <DateValue value={item.created_at} locale={dateLocale} /> },
    ]} /> : <ListView<PlatformAdminQueueEntry> action="operations_queue" filters={listFilters.queue} empty={['ไม่พบกิจกรรมคิว', 'No queue activity found']} columns={[
      { label: ['คิว', 'Queue'], render: (item) => <div><p className="font-black text-slate-950">#{item.queue_number ?? '—'} · {item.customer_name_masked || (th ? 'ไม่ระบุชื่อ' : 'Unnamed')}</p><p className="mt-0.5 text-xs text-slate-500">{item.event_name} · {item.store_name}</p></div> },
      { label: ['สถานะ', 'Status'], render: (item) => <StatusBadge value={item.status} /> },
      { label: ['เข้าคิว', 'Joined'], render: (item) => <DateValue value={item.joined_at} locale={dateLocale} /> },
      { label: ['เรียกเมื่อ', 'Called'], render: (item) => <DateValue value={item.called_at} locale={dateLocale} /> },
    ]} />}
  </div>;
}

function pageMeta(section: string, detail: boolean, th: boolean) {
  const meta: Record<string, { title: Copy; description: Copy }> = {
    overview: { title: ['ภาพรวม', 'Overview'], description: ['สถานะและกิจกรรมล่าสุดของแพลตฟอร์ม', 'Platform status and recent activity'] },
    users: { title: [detail ? 'รายละเอียดผู้ใช้' : 'ผู้ใช้', detail ? 'User details' : 'Users'], description: ['บัญชีและสมาชิกภาพของผู้ใช้', 'User accounts and store memberships'] },
    creators: { title: [detail ? 'รายละเอียดครีเอเตอร์' : 'ครีเอเตอร์', detail ? 'Creator details' : 'Creators'], description: ['ร้าน บทบาท และกิจกรรมบนแพลตฟอร์ม', 'Stores, roles, and platform activity'] },
    events: { title: [detail ? 'รายละเอียดอีเวนต์' : 'อีเวนต์และแคมเปญ', detail ? 'Event details' : 'Events & campaigns'], description: ['กำหนดการ สถานะ และปริมาณงาน', 'Schedules, status, and activity'] },
    campaigns: { title: [detail ? 'รายละเอียดแคมเปญ' : 'อีเวนต์และแคมเปญ', detail ? 'Campaign details' : 'Events & campaigns'], description: ['กำหนดการ สถานะ และปริมาณงาน', 'Schedules, status, and activity'] },
    operations: { title: ['การดำเนินงาน', 'Operations'], description: ['ติดตามออเดอร์และคิวแบบอ่านอย่างเดียว', 'Read-only order and queue monitoring'] },
    feedback: { title: ['ข้อความและคำขอช่วยเหลือ', 'Feedback inbox'], description: ['ติดตามปัญหาและข้อเสนอแนะ', 'Track requests and suggestions'] },
    audit: { title: ['บันทึกการตรวจสอบ', 'Audit logs'], description: ['ประวัติการเข้าถึงและการดำเนินการของผู้ดูแล', 'Administrative access and action history'] },
  };
  const current = meta[section] || meta.overview;
  return { title: current.title[th ? 0 : 1], description: current.description[th ? 0 : 1] };
}

export default function PlatformAdminConsole() {
  const { language, dateLocale } = useI18n();
  const th = language === 'th';
  const location = useLocation();
  const segments = useMemo(() => location.pathname.replace(/^\/admin\/?/, '').split('/').filter(Boolean).map(decodeURIComponent), [location.pathname]);
  const section = segments[0] || 'overview';
  const detailId = ['users', 'creators', 'events', 'campaigns'].includes(section) ? segments[1] : undefined;
  const meta = pageMeta(section, Boolean(detailId), th);
  const backTo = detailId ? `/admin/${section}` : undefined;

  let content: ReactNode;
  if (section === 'overview') content = <Overview />;
  else if (section === 'users' && detailId) content = <UserDetail id={detailId} />;
  else if (section === 'users') content = <ListView<PlatformAdminUser> action="users" filters={listFilters.users} detailBase="/admin/users" empty={['ไม่พบผู้ใช้', 'No users found']} columns={[
    { label: ['ผู้ใช้', 'User'], render: (item) => <div><p className="font-black text-slate-950">{item.display_name || (th ? 'ไม่ระบุชื่อ' : 'Unnamed')}</p><p className="mt-0.5 text-xs text-slate-500">{item.email_masked || '—'}</p></div> },
    { label: ['สถานะ', 'Status'], render: (item) => <div className="flex flex-wrap gap-1"><StatusBadge value={item.status} />{item.is_platform_admin && <StatusBadge value={th ? 'ผู้ดูแล' : 'Admin'} />}</div> },
    { label: ['ร้าน / สมาชิกภาพ', 'Creators / memberships'], render: (item) => `${item.creator_count} / ${item.membership_count}` },
    { label: ['เข้าสู่ระบบล่าสุด', 'Last sign-in'], render: (item) => <DateValue value={item.last_sign_in_at} locale={dateLocale} /> },
  ]} />;
  else if (section === 'creators' && detailId) content = <CreatorDetail id={detailId} />;
  else if (section === 'creators') content = <ListView<PlatformAdminCreator> action="creators" filters={listFilters.creators} detailBase="/admin/creators" empty={['ไม่พบครีเอเตอร์', 'No creators found']} columns={[
    { label: ['ครีเอเตอร์', 'Creator'], render: (item) => <div><p className="font-black text-slate-950">{item.display_name}</p><p className="mt-0.5 text-xs text-slate-500">/{item.slug}</p></div> },
    { label: ['เจ้าของ', 'Owner'], render: (item) => item.owner_email_masked || '—' },
    { label: ['สถานะ', 'Status'], render: (item) => <StatusBadge value={item.status} /> },
    { label: ['อีเวนต์ / แคมเปญ', 'Events / campaigns'], render: (item) => `${item.event_count} / ${item.campaign_count}` },
    { label: ['สร้างเมื่อ', 'Created'], render: (item) => <DateValue value={item.created_at} locale={dateLocale} /> },
  ]} />;
  else if (section === 'events' && detailId) content = <EventDetail id={detailId} />;
  else if (section === 'campaigns' && detailId) content = <CampaignDetail id={detailId} />;
  else if (section === 'events' || section === 'campaigns') content = <EventsCampaigns initialTab={section} />;
  else if (section === 'operations') content = <Operations initialTab={segments[1] === 'queue' ? 'queue' : 'orders'} />;
  else if (section === 'audit') content = <AuditPage />;
  else if (section === 'feedback') content = <AdminFeedback />;
  else content = <AdminEmptyState title={th ? 'ไม่พบหน้านี้' : 'Page not found'} detail={th ? 'เลือกโมดูลจากเมนูผู้ดูแล' : 'Choose an admin module from the navigation.'} />;

  return <AdminConsoleShell title={meta.title} description={meta.description} backTo={backTo}>{content}</AdminConsoleShell>;
}
