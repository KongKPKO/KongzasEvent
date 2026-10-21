import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronLeft, FileImage, HelpCircle, Loader2, MessageSquareText, Send, ShieldCheck } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { LanguageToggle, useI18n } from '../i18n';
import { supabase } from '../supabaseClient';
import {
  FeedbackRequestError,
  listOwnFeedback,
  submitFeedback,
  type FeedbackCategory,
  type FeedbackSubmission,
  type FeedbackTicket,
} from '../lib/feedback';

const categories: Array<{ value: FeedbackCategory; th: string; en: string; descriptionTh: string; descriptionEn: string }> = [
  { value: 'bug', th: 'แจ้งข้อผิดพลาด', en: 'Report a bug', descriptionTh: 'บางอย่างไม่ทำงานหรือแสดงผลผิด', descriptionEn: 'Something is broken or behaves incorrectly' },
  { value: 'support', th: 'ขอความช่วยเหลือ', en: 'Get help', descriptionTh: 'ติดขัดในการใช้งานหรือต้องการคำแนะนำ', descriptionEn: 'You are stuck or need guidance' },
  { value: 'suggestion', th: 'เสนอแนะ', en: 'Share an idea', descriptionTh: 'บอกสิ่งที่อยากให้ Nireq ทำได้ดีขึ้น', descriptionEn: 'Tell us how Nireq could improve' },
];

export default function Feedback() {
  const { language } = useI18n();
  const th = language === 'th';
  const tr = (thai: string, english: string) => th ? thai : english;
  const [user, setUser] = useState<User | null>(null);
  const [category, setCategory] = useState<FeedbackCategory>('support');
  const [subject, setSubject] = useState('');
  const [details, setDetails] = useState('');
  const [module, setModule] = useState('');
  const [contact, setContact] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [tickets, setTickets] = useState<FeedbackTicket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<FeedbackSubmission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ticketError, setTicketError] = useState(false);

  useEffect(() => {
    let alive = true;
    void supabase.auth.getUser().then(({ data }) => { if (alive) setUser(data.user); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) setUser(session?.user || null);
    });
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!user) { setTickets([]); return; }
    let alive = true;
    setTickets([]);
    setLoadingTickets(true);
    setTicketError(false);
    void listOwnFeedback()
      .then(rows => { if (alive) setTickets(rows); })
      .catch(() => { if (alive) setTicketError(true); })
      .finally(() => { if (alive) setLoadingTickets(false); });
    return () => { alive = false; };
  }, [user, success]);

  // Editing after an unsuccessful attempt is a new request; unchanged retries
  // retain the same ID so a network interruption cannot duplicate the ticket.
  useEffect(() => { setRequestId(crypto.randomUUID()); }, [category, subject, details, module, contact, attachment]);

  const validation = useMemo(() => {
    if (subject.trim().length < 5) return tr('หัวข้อต้องมีอย่างน้อย 5 ตัวอักษร', 'Subject must be at least 5 characters.');
    if (details.trim().length < 10) return tr('รายละเอียดต้องมีอย่างน้อย 10 ตัวอักษร', 'Details must be at least 10 characters.');
    if (attachment && attachment.size > 5 * 1024 * 1024) return tr('รูปต้องมีขนาดไม่เกิน 5 MB', 'Image must be 5 MB or smaller.');
    if (attachment && !['image/jpeg', 'image/png', 'image/webp'].includes(attachment.type)) {
      return tr('รองรับเฉพาะ JPG, PNG หรือ WebP', 'Use a JPG, PNG, or WebP image.');
    }
    return null;
  }, [attachment, details, subject, th]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (validation) { setError(validation); return; }
    setSubmitting(true);
    try {
      const result = await submitFeedback({
        category,
        subject,
        details,
        module,
        guestContact: user ? undefined : contact,
        attachment,
        requestId,
      });
      setSuccess(result);
      setSubject(''); setDetails(''); setModule(''); setContact(''); setAttachment(null);
      setRequestId(crypto.randomUUID());
    } catch (failure) {
      const code = failure instanceof FeedbackRequestError ? failure.code : 'request_failed';
      setError(errorMessage(code, th));
    } finally { setSubmitting(false); }
  };

  return (
    <main className="min-h-screen bg-[#fffaf7] text-gray-950">
      <header className="border-b border-rose-100 bg-white/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 font-semibold text-gray-700 hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-pink-500">
            <ChevronLeft className="h-5 w-5" /> {tr('กลับหน้าแรก', 'Back to home')}
          </Link>
          <LanguageToggle />
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:py-12">
        <section>
          <div className="mb-7 max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-pink-100 px-3 py-1 text-sm font-bold text-pink-800">
              <HelpCircle className="h-4 w-4" /> {tr('ศูนย์ช่วยเหลือ', 'Help center')}
            </div>
            <Link to="/help/guide" className="mb-3 inline-flex min-h-11 items-center text-sm font-bold underline">{tr('คู่มือและคำถามที่พบบ่อย', 'Guides and common questions')}</Link>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">{tr('ให้เราช่วยคุณ', 'How can we help?')}</h1>
            <p className="mt-3 text-base leading-7 text-gray-600">
              {tr('แจ้งปัญหา ขอความช่วยเหลือ หรือส่งไอเดียให้ทีม Nireq แบบสั้น ๆ เราจะให้เลขอ้างอิงทันทีหลังส่ง', 'Report a problem, ask for help, or share an idea. You will receive a reference number as soon as it is sent.')}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="rounded-3xl border border-rose-100 bg-white p-5 shadow-sm sm:p-7" noValidate>
            <fieldset disabled={submitting}>
              <legend className="mb-3 text-sm font-bold text-gray-800">{tr('เรื่องที่ต้องการติดต่อ', 'What is this about?')}</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                {categories.map(item => (
                  <label key={item.value} className={`cursor-pointer rounded-2xl border p-4 transition ${category === item.value ? 'border-pink-500 bg-pink-50 ring-1 ring-pink-500' : 'border-gray-200 hover:border-pink-200'}`}>
                    <input className="mr-2 h-4 w-4 accent-pink-600" type="radio" name="category" value={item.value} checked={category === item.value} onChange={() => setCategory(item.value)} />
                    <span className="block font-bold text-gray-900">{th ? item.th : item.en}</span>
                    <span className="mt-1 block text-sm leading-5 text-gray-600">{th ? item.descriptionTh : item.descriptionEn}</span>
                  </label>
                ))}
              </div>

              <div className="mt-6 grid gap-5">
                <label className="grid gap-2 text-sm font-bold text-gray-800">
                  {tr('หัวข้อ', 'Subject')} <span className="font-normal text-gray-500">{subject.length}/160</span>
                  <input value={subject} onChange={event => setSubject(event.target.value)} maxLength={160} required className="min-h-12 rounded-xl border border-gray-300 px-4 text-base font-normal outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100" placeholder={tr('สรุปสิ่งที่เกิดขึ้น', 'Briefly describe what happened')} />
                </label>
                <label className="grid gap-2 text-sm font-bold text-gray-800">
                  {tr('รายละเอียด', 'Details')} <span className="font-normal text-gray-500">{details.length}/5000</span>
                  <textarea value={details} onChange={event => setDetails(event.target.value)} maxLength={5000} required rows={7} className="rounded-xl border border-gray-300 px-4 py-3 text-base font-normal leading-6 outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100" placeholder={tr('บอกขั้นตอนที่ทำ สิ่งที่คาดหวัง และสิ่งที่เห็นจริง โดยไม่ใส่รหัสผ่านหรือข้อมูลการชำระเงิน', 'Tell us the steps, what you expected, and what you saw. Do not include passwords or payment information.')} />
                </label>
                <label className="grid gap-2 text-sm font-bold text-gray-800">
                  {tr('ส่วนของระบบ (ไม่บังคับ)', 'Area of Nireq (optional)')}
                  <input value={module} onChange={event => setModule(event.target.value)} maxLength={80} className="min-h-12 rounded-xl border border-gray-300 px-4 text-base font-normal outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100" placeholder={tr('เช่น คิว, POS, แคมเปญออนไลน์', 'For example: Queue, POS, Online Campaign')} />
                </label>
                {!user && (
                  <label className="grid gap-2 text-sm font-bold text-gray-800">
                    {tr('ช่องทางติดต่อกลับ (ไม่บังคับ)', 'Contact details (optional)')}
                    <input value={contact} onChange={event => setContact(event.target.value)} maxLength={255} className="min-h-12 rounded-xl border border-gray-300 px-4 text-base font-normal outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100" placeholder={tr('อีเมลหรือเบอร์โทรที่สะดวก', 'Email or phone number')} />
                  </label>
                )}
                <label className="grid gap-2 text-sm font-bold text-gray-800">
                  {tr('ภาพหน้าจอ (ไม่บังคับ)', 'Screenshot (optional)')}
                  <span className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-gray-300 px-4 text-sm font-normal text-gray-600 hover:border-pink-400 hover:bg-pink-50">
                    <FileImage className="h-5 w-5 text-pink-600" />
                    <span className="min-w-0 truncate">{attachment?.name || tr('เลือก JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB', 'Choose JPG, PNG, or WebP up to 5 MB')}</span>
                    <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setAttachment(event.target.files?.[0] || null)} />
                  </span>
                </label>
              </div>
            </fieldset>

            {error && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{error}</div>}
            {success && (
              <div role="status" className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                <div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-bold">{tr('ส่งเรียบร้อยแล้ว', 'Sent successfully')}</p><p className="mt-1 text-sm">{tr('เลขอ้างอิง', 'Reference')}: <strong className="select-all">{success.reference}</strong></p></div></div>
              </div>
            )}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-2 text-xs leading-5 text-gray-500"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />{tr('เก็บเฉพาะข้อมูลที่จำเป็น และไม่นำรหัสผ่านหรือโทเคนจาก URL ไปบันทึก', 'We collect only necessary context and never store passwords or URL tokens.')}</p>
              <button type="submit" disabled={submitting} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-pink-600 px-5 font-bold text-white shadow-sm hover:bg-pink-700 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
                {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                {submitting ? tr('กำลังส่ง…', 'Sending…') : tr('ส่งข้อความ', 'Send message')}
              </button>
            </div>
          </form>
        </section>

        <aside className="space-y-5">
          <div className="rounded-3xl border border-rose-100 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2"><MessageSquareText className="h-5 w-5 text-pink-600" /><h2 className="font-black">{tr('รายการของฉัน', 'My requests')}</h2></div>
            {!user && <p className="mt-3 text-sm leading-6 text-gray-600">{tr('เข้าสู่ระบบเพื่อดูสถานะคำขอที่เคยส่งจากบัญชีของคุณ', 'Sign in to track requests sent from your account.')}</p>}
            {user && loadingTickets && <div className="mt-4 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />{tr('กำลังโหลด…', 'Loading…')}</div>}
            {user && ticketError && <p role="alert" className="mt-4 text-sm font-semibold text-red-700">{tr('โหลดรายการไม่สำเร็จ กรุณาลองใหม่', 'Could not load your requests. Please try again.')}</p>}
            {user && !loadingTickets && !ticketError && tickets.length === 0 && <p className="mt-3 text-sm text-gray-600">{tr('ยังไม่มีคำขอจากบัญชีนี้', 'No requests from this account yet.')}</p>}
            {user && !loadingTickets && tickets.length > 0 && (
              <ul className="mt-4 divide-y divide-gray-100">
                {tickets.map(ticket => <li key={ticket.id} className="py-4 first:pt-0 last:pb-0"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-bold">{ticket.subject}</p><p className="mt-1 text-xs text-gray-500">{ticket.reference}</p></div><StatusBadge status={ticket.status} th={th} /></div></li>)}
              </ul>
            )}
          </div>
          <div className="rounded-3xl bg-gray-950 p-5 text-white">
            <h2 className="font-black">{tr('เพื่อให้ช่วยได้เร็วขึ้น', 'Help us resolve it faster')}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-300">{tr('บอกขั้นตอนที่ทำและข้อความผิดพลาดที่เห็น พร้อมภาพหน้าจอถ้ามี อย่าส่งรหัสผ่าน โทเคน หรือข้อมูลการชำระเงิน', 'Include the steps you took and any error message. Add a screenshot if useful, but never send passwords, tokens, or payment details.')}</p>
          </div>
        </aside>
      </div>
    </main>
  );
}

function StatusBadge({ status, th }: { status: FeedbackTicket['status']; th: boolean }) {
  const labels = {
    new: th ? 'ใหม่' : 'New',
    in_progress: th ? 'กำลังดำเนินการ' : 'In progress',
    resolved: th ? 'แก้ไขแล้ว' : 'Resolved',
    closed: th ? 'ปิดแล้ว' : 'Closed',
  };
  const colors = status === 'new' ? 'bg-blue-100 text-blue-800' : status === 'in_progress' ? 'bg-amber-100 text-amber-800' : status === 'resolved' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-700';
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${colors}`}>{labels[status]}</span>;
}

function errorMessage(code: string, th: boolean) {
  const messages: Record<string, [string, string]> = {
    rate_limited: ['ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่', 'Too many requests. Please wait and try again.'],
    attachment_too_large: ['รูปมีขนาดเกิน 5 MB', 'The image is larger than 5 MB.'],
    attachment_type: ['รองรับเฉพาะ JPG, PNG หรือ WebP', 'Use a JPG, PNG, or WebP image.'],
    attachment_content: ['ไฟล์ภาพไม่ถูกต้อง กรุณาเลือกไฟล์ใหม่', 'The image file is invalid. Please choose another file.'],
    attachment_failed: ['อัปโหลดภาพไม่สำเร็จและยังไม่ได้สร้างคำขอ กรุณาลองใหม่', 'The image upload failed and no request was created. Please try again.'],
    account_inactive: ['บัญชีนี้ไม่สามารถส่งคำขอได้', 'This account cannot submit requests.'],
    attachment_processing: ['คำขอกำลังบันทึกภาพอยู่ กรุณารอสักครู่แล้วลองใหม่', 'The request is still saving its image. Please wait and try again.'],
  };
  const pair = messages[code] || ['ส่งไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่', 'Could not send your request. Check your connection and try again.'];
  return th ? pair[0] : pair[1];
}
