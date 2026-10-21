import { FormEvent, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileImage, Inbox, Loader2, RefreshCw, Search, Send, X } from 'lucide-react';
import { useI18n } from '../i18n';
import {
  downloadAdminFeedbackAttachment,
  getAdminFeedback,
  listAdminFeedback,
  updateAdminFeedback,
  type AdminFeedbackDetail,
  type AdminFeedbackList,
  type AdminFeedbackListItem,
  type FeedbackCategory,
  type FeedbackStatus,
} from '../lib/feedback';

const pageSize = 20;

export default function AdminFeedback() {
  const { language, dateLocale } = useI18n();
  const th = language === 'th';
  const tr = (thai: string, english: string) => th ? thai : english;
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<FeedbackStatus | ''>('');
  const [category, setCategory] = useState<FeedbackCategory | ''>('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<AdminFeedbackList | null>(null);
  const [detail, setDetail] = useState<AdminFeedbackDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [note, setNote] = useState('');
  const [nextStatus, setNextStatus] = useState<FeedbackStatus>('new');
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const listSequence = useRef(0);
  const detailSequence = useRef(0);
  const pendingAction = useRef<{ key: string; id: string } | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const dialogOpen = loadingDetail || !!detail || detailError;
  const closeDetailRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!dialogOpen) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeDetailRef.current(); }
      if (event.key !== 'Tab' || !dialog) return;
      const nodes = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')).filter(node => node.getClientRects().length > 0);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); opener?.focus(); };
  }, [dialogOpen]);

  const loadList = async (nextPage = page) => {
    const sequence = ++listSequence.current;
    setLoading(true); setError(false);
    try {
      const result = await listAdminFeedback({ query, status, category, page: nextPage, pageSize });
      if (sequence === listSequence.current) { setList(result); setPage(nextPage); }
    } catch { if (sequence === listSequence.current) setError(true); }
    finally { if (sequence === listSequence.current) setLoading(false); }
  };

  useEffect(() => { void loadList(1); return () => { listSequence.current++; }; }, []);
  useEffect(() => () => { if (attachmentUrl) URL.revokeObjectURL(attachmentUrl); }, [attachmentUrl]);

  const openDetail = async (item: AdminFeedbackListItem) => {
    const sequence = ++detailSequence.current;
    setLoadingDetail(true); setDetailError(false); setDetail(null); setNote('');
    setNextStatus(item.status);
    if (attachmentUrl) { URL.revokeObjectURL(attachmentUrl); setAttachmentUrl(null); }
    try {
      const result = await getAdminFeedback(item.id);
      if (sequence === detailSequence.current) { setDetail(result); setNextStatus(result.ticket.status); }
    } catch { if (sequence === detailSequence.current) setDetailError(true); }
    finally { if (sequence === detailSequence.current) setLoadingDetail(false); }
  };

  const closeDetail = () => {
    detailSequence.current++; setDetail(null); setDetailError(false); setLoadingDetail(false); setNote('');
    if (attachmentUrl) { URL.revokeObjectURL(attachmentUrl); setAttachmentUrl(null); }
  };

  closeDetailRef.current = closeDetail;

  const submitSearch = (event: FormEvent) => { event.preventDefault(); void loadList(1); };

  const save = async (mode: 'status' | 'note') => {
    if (!detail || saving) return;
    if (mode === 'note' && note.trim().length < 2) return;
    const sequence = detailSequence.current;
    const actionKey = JSON.stringify([detail.ticket.id, mode, mode === 'status' ? nextStatus : null, detail.ticket.status, mode === 'note' ? note.trim() : null]);
    if (pendingAction.current?.key !== actionKey) pendingAction.current = { key: actionKey, id: crypto.randomUUID() };
    const requestId = pendingAction.current.id;
    setSaving(true); setDetailError(false);
    try {
      const result = await updateAdminFeedback({
        ticketId: detail.ticket.id,
        status: mode === 'status' ? nextStatus : undefined,
        expectedStatus: detail.ticket.status,
        requestId,
        note: mode === 'note' ? note : undefined,
      });
      if (pendingAction.current?.id === requestId) pendingAction.current = null;
      if (sequence !== detailSequence.current) return;
      setDetail(result); setNextStatus(result.ticket.status); setNote('');
      await loadList(page);
    } catch { if (sequence === detailSequence.current) setDetailError(true); }
    finally { setSaving(false); }
  };

  const showAttachment = async () => {
    if (!detail || attachmentLoading) return;
    if (attachmentUrl) { URL.revokeObjectURL(attachmentUrl); setAttachmentUrl(null); return; }
    const sequence = detailSequence.current;
    setAttachmentLoading(true); setDetailError(false);
    try {
      const blob = await downloadAdminFeedbackAttachment(detail.ticket.id);
      if (sequence === detailSequence.current) setAttachmentUrl(URL.createObjectURL(blob));
    } catch { if (sequence === detailSequence.current) setDetailError(true); }
    finally { setAttachmentLoading(false); }
  };

  const totalPages = Math.max(1, Math.ceil((list?.total || 0) / pageSize));

  return (
    <section className="min-w-0" aria-labelledby="feedback-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-sm font-bold text-pink-700">{tr('ฝ่ายดูแลแพลตฟอร์ม', 'Platform support')}</p><h1 id="feedback-heading" className="mt-1 text-2xl font-black tracking-tight text-gray-950 sm:text-3xl">{tr('ข้อความและคำขอช่วยเหลือ', 'Feedback inbox')}</h1><p className="mt-2 text-sm leading-6 text-gray-600">{tr('ค้นหา ตรวจสอบ และติดตามคำขอจากผู้ใช้ในที่เดียว', 'Search, review, and track user requests in one place.')}</p></div>
        <button type="button" onClick={() => void loadList(page)} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 text-sm font-bold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-pink-500 disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />{tr('รีเฟรช', 'Refresh')}</button>
      </div>

      <form onSubmit={submitSearch} className="mt-6 grid gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm md:grid-cols-[minmax(220px,1fr)_180px_180px_auto]">
        <label className="relative"><span className="sr-only">{tr('ค้นหา', 'Search')}</span><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-gray-400" /><input value={query} onChange={event => setQuery(event.target.value)} maxLength={160} className="min-h-11 w-full rounded-xl border border-gray-300 pl-10 pr-3 text-sm outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100" placeholder={tr('เลขอ้างอิง หัวข้อ ช่องทางติดต่อ', 'Reference, subject, or contact')} /></label>
        <label><span className="sr-only">{tr('สถานะ', 'Status')}</span><select value={status} onChange={event => setStatus(event.target.value as FeedbackStatus | '')} className="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100"><option value="">{tr('ทุกสถานะ', 'All statuses')}</option><StatusOptions th={th} /></select></label>
        <label><span className="sr-only">{tr('ประเภท', 'Category')}</span><select value={category} onChange={event => setCategory(event.target.value as FeedbackCategory | '')} className="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100"><option value="">{tr('ทุกประเภท', 'All categories')}</option><option value="bug">{tr('ข้อผิดพลาด', 'Bug')}</option><option value="support">{tr('ขอความช่วยเหลือ', 'Support')}</option><option value="suggestion">{tr('ข้อเสนอแนะ', 'Suggestion')}</option></select></label>
        <button type="submit" disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gray-950 px-5 text-sm font-bold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-500 disabled:opacity-60"><Search className="h-4 w-4" />{tr('ค้นหา', 'Search')}</button>
      </form>

      <div className="mt-5 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {loading && <State icon={<Loader2 className="h-7 w-7 animate-spin" />} text={tr('กำลังโหลดข้อความ…', 'Loading feedback…')} />}
        {!loading && error && <State icon={<Inbox className="h-7 w-7" />} text={tr('โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่', 'Could not load feedback. Please try again.')} alert />}
        {!loading && !error && list?.items.length === 0 && <State icon={<Inbox className="h-7 w-7" />} text={tr('ไม่พบข้อความที่ตรงกับตัวกรอง', 'No feedback matches these filters.')} />}
        {!loading && !error && !!list?.items.length && (
          <ul className="divide-y divide-gray-100" aria-label={tr('รายการข้อความ', 'Feedback list')}>
            {list.items.map(item => (
              <li key={item.id}><button type="button" onClick={() => void openDetail(item)} className="grid min-h-[88px] w-full gap-2 px-4 py-4 text-left hover:bg-pink-50/60 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-pink-500 sm:grid-cols-[minmax(0,1fr)_140px_130px] sm:items-center sm:px-5"><div className="min-w-0"><div className="flex items-center gap-2"><span className="text-xs font-bold text-pink-700">{item.reference}</span>{item.has_attachment && <FileImage className="h-4 w-4 text-gray-400" aria-label={tr('มีไฟล์แนบ', 'Has attachment')} />}</div><p className="mt-1 truncate font-bold text-gray-950">{item.subject}</p><p className="mt-1 truncate text-sm text-gray-500">{categoryLabel(item.category, th)}{item.module ? ` · ${item.module}` : ''}</p></div><StatusBadge status={item.status} th={th} /><time className="text-sm text-gray-500 sm:text-right" dateTime={item.created_at}>{formatDate(item.created_at, dateLocale)}</time></button></li>
            ))}
          </ul>
        )}
        {!loading && !error && (list?.total || 0) > 0 && <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm text-gray-600"><span>{tr(`ทั้งหมด ${list?.total || 0} รายการ`, `${list?.total || 0} total`)}</span><div className="flex items-center gap-2"><button type="button" disabled={page <= 1 || loading} onClick={() => void loadList(page - 1)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 disabled:opacity-40" aria-label={tr('หน้าก่อน', 'Previous page')}><ChevronLeft className="h-4 w-4" /></button><span>{page}/{totalPages}</span><button type="button" disabled={page >= totalPages || loading} onClick={() => void loadList(page + 1)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 disabled:opacity-40" aria-label={tr('หน้าถัดไป', 'Next page')}><ChevronRight className="h-4 w-4" /></button></div></div>}
      </div>

      {(loadingDetail || detail || detailError) && (
        <div className="fixed inset-0 z-50 flex justify-end bg-gray-950/35" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeDetail(); }}>
          <aside ref={dialogRef} className="h-full w-full max-w-2xl overflow-y-auto bg-[#fffaf7] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="feedback-detail-heading">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white/95 px-4 py-4 backdrop-blur sm:px-6"><h2 id="feedback-detail-heading" className="font-black">{detail?.ticket.reference || tr('รายละเอียดข้อความ', 'Feedback detail')}</h2><button type="button" onClick={closeDetail} className="inline-flex h-11 w-11 items-center justify-center rounded-xl hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-pink-500" aria-label={tr('ปิด', 'Close')}><X className="h-5 w-5" /></button></div>
            {loadingDetail && <State icon={<Loader2 className="h-7 w-7 animate-spin" />} text={tr('กำลังโหลดรายละเอียด…', 'Loading detail…')} />}
            {!loadingDetail && detailError && !detail && <State icon={<Inbox className="h-7 w-7" />} text={tr('โหลดรายละเอียดไม่สำเร็จ', 'Could not load this request.')} alert />}
            {detail && <div className="space-y-5 p-4 sm:p-6">
              {detailError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{tr('บันทึกหรือโหลดไฟล์ไม่สำเร็จ กรุณาลองใหม่', 'Could not save or load the attachment. Please try again.')}</div>}
              <div className="rounded-2xl border border-gray-200 bg-white p-5"><div className="flex flex-wrap items-center gap-2"><StatusBadge status={detail.ticket.status} th={th} /><span className="text-sm font-bold text-gray-500">{categoryLabel(detail.ticket.category, th)}</span></div><h3 className="mt-4 text-xl font-black text-gray-950">{detail.ticket.subject}</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-gray-700">{detail.ticket.details}</p><dl className="mt-5 grid gap-3 border-t border-gray-100 pt-4 text-sm sm:grid-cols-2"><Meta label={tr('ส่วนของระบบ', 'Area')} value={detail.ticket.module || '—'} /><Meta label={tr('ผู้ส่ง', 'Sender')} value={detail.ticket.user_id ? tr('ผู้ใช้ที่เข้าสู่ระบบ', 'Authenticated user') : tr('ผู้ใช้ทั่วไป', 'Guest')} /><Meta label={tr('ช่องทางติดต่อ', 'Contact')} value={detail.ticket.guest_contact || '—'} /><Meta label={tr('สร้างเมื่อ', 'Created')} value={formatDate(detail.ticket.created_at, dateLocale)} /></dl></div>

              {detail.metadata && <div className="rounded-2xl border border-gray-200 bg-white p-5"><h3 className="font-black">{tr('ข้อมูลประกอบ', 'Request context')}</h3><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><Meta label="URL" value={detail.metadata.current_url || '—'} /><Meta label={tr('เวอร์ชัน', 'Version')} value={detail.metadata.app_version || '—'} /><Meta label={tr('เบราว์เซอร์ / อุปกรณ์', 'Browser / device')} value={detail.metadata.browser_device || '—'} /></dl></div>}

              {detail.attachment && <div className="rounded-2xl border border-gray-200 bg-white p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><h3 className="font-black">{tr('ภาพหน้าจอ', 'Screenshot')}</h3><p className="mt-1 truncate text-sm text-gray-500">{detail.attachment.original_name} · {formatBytes(detail.attachment.size_bytes)}</p></div><button type="button" onClick={() => void showAttachment()} disabled={attachmentLoading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-300 px-4 text-sm font-bold hover:bg-gray-50 disabled:opacity-60">{attachmentLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{attachmentUrl ? tr('ซ่อนภาพ', 'Hide image') : tr('ดูภาพ', 'View image')}</button></div>{attachmentUrl && <img src={attachmentUrl} alt={tr('ภาพหน้าจอจากผู้ใช้', 'User-submitted screenshot')} className="mt-4 max-h-[520px] w-full rounded-xl border border-gray-200 object-contain" />}</div>}

              <div className="rounded-2xl border border-gray-200 bg-white p-5"><h3 className="font-black">{tr('อัปเดตสถานะ', 'Update status')}</h3><div className="mt-3 flex flex-col gap-3 sm:flex-row"><select disabled={saving} aria-label={tr('สถานะคำขอ', 'Request status')} value={nextStatus} onChange={event => setNextStatus(event.target.value as FeedbackStatus)} className="min-h-11 flex-1 rounded-xl border border-gray-300 bg-white px-3 text-sm"><StatusOptions th={th} /></select><button type="button" onClick={() => void save('status')} disabled={saving || nextStatus === detail.ticket.status} className="min-h-11 rounded-xl bg-gray-950 px-5 text-sm font-bold text-white disabled:opacity-50">{saving ? tr('กำลังบันทึก…', 'Saving…') : tr('บันทึกสถานะ', 'Save status')}</button></div></div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5"><h3 className="font-black">{tr('บันทึกภายใน', 'Internal notes')}</h3><p className="mt-1 text-xs text-gray-500">{tr('ผู้ใช้จะไม่เห็นข้อความในส่วนนี้', 'These notes are not visible to users.')}</p><textarea disabled={saving} aria-label={tr('บันทึกภายใน', 'Internal note')} value={note} onChange={event => setNote(event.target.value)} maxLength={3000} rows={4} className="mt-3 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" placeholder={tr('เพิ่มข้อมูลสำหรับทีมดูแล…', 'Add context for the support team…')} /><button type="button" onClick={() => void save('note')} disabled={saving || note.trim().length < 2} className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-pink-600 px-5 text-sm font-bold text-white disabled:opacity-50"><Send className="h-4 w-4" />{tr('เพิ่มบันทึก', 'Add note')}</button>{detail.notes.length > 0 && <ul className="mt-5 space-y-3">{detail.notes.map(item => <li key={item.id} className="rounded-xl bg-gray-50 p-3"><p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-700">{item.body}</p><time className="mt-2 block text-xs text-gray-500" dateTime={item.created_at}>{formatDate(item.created_at, dateLocale)}</time></li>)}</ul>}</div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5"><h3 className="font-black">{tr('ประวัติ', 'Audit history')}</h3><ol className="mt-4 space-y-4 border-l-2 border-rose-100 pl-4">{detail.audit.map(item => <li key={item.id}><p className="text-sm font-bold text-gray-800">{auditLabel(item.action, item.previous_status, item.next_status, th)}</p><time className="mt-1 block text-xs text-gray-500" dateTime={item.created_at}>{formatDate(item.created_at, dateLocale)}</time></li>)}</ol></div>
            </div>}
          </aside>
        </div>
      )}
    </section>
  );
}

function State({ icon, text, alert = false }: { icon: React.ReactNode; text: string; alert?: boolean }) { return <div className="flex min-h-52 flex-col items-center justify-center gap-3 p-8 text-center text-gray-500" role={alert ? 'alert' : 'status'}>{icon}<p className={alert ? 'font-semibold text-red-700' : 'text-sm'}>{text}</p></div>; }
function StatusOptions({ th }: { th: boolean }) { return <><option value="new">{th ? 'ใหม่' : 'New'}</option><option value="in_progress">{th ? 'กำลังดำเนินการ' : 'In progress'}</option><option value="resolved">{th ? 'แก้ไขแล้ว' : 'Resolved'}</option><option value="closed">{th ? 'ปิดแล้ว' : 'Closed'}</option></>; }
function StatusBadge({ status, th }: { status: FeedbackStatus; th: boolean }) { const color = status === 'new' ? 'bg-blue-100 text-blue-800' : status === 'in_progress' ? 'bg-amber-100 text-amber-800' : status === 'resolved' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-700'; const label = status === 'new' ? (th ? 'ใหม่' : 'New') : status === 'in_progress' ? (th ? 'กำลังดำเนินการ' : 'In progress') : status === 'resolved' ? (th ? 'แก้ไขแล้ว' : 'Resolved') : (th ? 'ปิดแล้ว' : 'Closed'); return <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-bold ${color}`}>{label}</span>; }
function Meta({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><dt className="text-xs font-bold uppercase tracking-wide text-gray-500">{label}</dt><dd className="mt-1 break-words text-gray-800">{value}</dd></div>; }
function categoryLabel(category: FeedbackCategory, th: boolean) { return category === 'bug' ? (th ? 'ข้อผิดพลาด' : 'Bug') : category === 'support' ? (th ? 'ขอความช่วยเหลือ' : 'Support') : (th ? 'ข้อเสนอแนะ' : 'Suggestion'); }
function formatDate(value: string, locale: string) { return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function formatBytes(value: number) { return value >= 1024 * 1024 ? `${(value / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`; }
function auditLabel(action: string, previous: FeedbackStatus | null, next: FeedbackStatus | null, th: boolean) { if (action === 'created') return th ? 'สร้างคำขอ' : 'Request created'; if (action === 'attachment_added') return th ? 'เพิ่มไฟล์แนบ' : 'Attachment added'; if (action === 'internal_note_added') return th ? 'เพิ่มบันทึกภายใน' : 'Internal note added'; return th ? `เปลี่ยนสถานะ ${previous || '—'} → ${next || '—'}` : `Status changed ${previous || '—'} → ${next || '—'}`; }
