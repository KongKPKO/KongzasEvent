import { supabase } from '../supabaseClient';

export type FeedbackCategory = 'bug' | 'support' | 'suggestion';
export type FeedbackStatus = 'new' | 'in_progress' | 'resolved' | 'closed';

export interface FeedbackTicket {
  id: string;
  reference: string;
  category: FeedbackCategory;
  subject: string;
  details: string;
  module: string | null;
  status: FeedbackStatus;
  has_attachment: boolean;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface SubmitFeedbackInput {
  category: FeedbackCategory;
  subject: string;
  details: string;
  module?: string;
  guestContact?: string;
  attachment?: File | null;
  context?: { workspace_type?: string; workspace_id?: string };
  requestId: string;
}

export interface FeedbackSubmission {
  reference: string;
  status: FeedbackStatus;
  duplicate: boolean;
}

export interface AdminFeedbackListItem {
  id: string;
  reference: string;
  category: FeedbackCategory;
  subject: string;
  module: string | null;
  status: FeedbackStatus;
  has_attachment: boolean;
  authenticated: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminFeedbackNote {
  id: string;
  ticket_id: string;
  actor_id: string;
  body: string;
  created_at: string;
}

export interface AdminFeedbackAuditEvent {
  id: number;
  ticket_id: string;
  actor_id: string | null;
  action: 'created' | 'attachment_added' | 'status_changed' | 'internal_note_added';
  previous_status: FeedbackStatus | null;
  next_status: FeedbackStatus | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface AdminFeedbackDetail {
  ticket: FeedbackTicket & { user_id: string | null; guest_contact: string | null };
  metadata: {
    current_url: string | null;
    app_version: string | null;
    browser_device: string | null;
    context: Record<string, string>;
  } | null;
  attachment: {
    id: string;
    ticket_id: string;
    original_name: string;
    content_type: string;
    size_bytes: number;
    created_at: string;
  } | null;
  notes: AdminFeedbackNote[];
  audit: AdminFeedbackAuditEvent[];
}

export interface AdminFeedbackList {
  items: AdminFeedbackListItem[];
  total: number;
  page: number;
  page_size: number;
}

export class FeedbackRequestError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'FeedbackRequestError';
  }
}

export async function submitFeedback(input: SubmitFeedbackInput): Promise<FeedbackSubmission> {
  const form = new FormData();
  form.set('category', input.category);
  form.set('subject', input.subject.trim());
  form.set('details', input.details.trim());
  form.set('module', input.module?.trim() || '');
  form.set('guest_contact', input.guestContact?.trim() || '');
  form.set('current_url', safeCurrentUrl());
  form.set('app_version', String(import.meta.env.VITE_APP_VERSION || import.meta.env.VITE_APP_COMMIT || 'web').slice(0, 100));
  form.set('browser_device', browserDeviceSummary());
  form.set('context', JSON.stringify(input.context || {}));
  form.set('client_request_id', input.requestId);
  if (input.attachment) form.set('attachment', input.attachment, input.attachment.name);

  const result = await supabase.functions.invoke<FeedbackSubmission & { ok: boolean; error?: string }>('feedback-submit', {
    body: form,
  });
  if (result.error || !result.data?.ok) throw new FeedbackRequestError(await responseErrorCode(result.error, result.data?.error));
  return {
    reference: result.data.reference,
    status: result.data.status,
    duplicate: result.data.duplicate,
  };
}

export async function listOwnFeedback(): Promise<FeedbackTicket[]> {
  const { data, error } = await supabase
    .from('feedback_tickets')
    .select('id, reference, category, subject, details, module, status, has_attachment, created_at, updated_at, resolved_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data || []) as FeedbackTicket[];
}

export async function listAdminFeedback(input: {
  query?: string;
  status?: FeedbackStatus | '';
  category?: FeedbackCategory | '';
  page: number;
  pageSize?: number;
}): Promise<AdminFeedbackList> {
  return invokeAdmin<AdminFeedbackList>({
    action: 'list',
    query: input.query?.trim() || null,
    status: input.status || null,
    category: input.category || null,
    page: input.page,
    page_size: input.pageSize || 20,
  });
}

export async function getAdminFeedback(ticketId: string): Promise<AdminFeedbackDetail> {
  return invokeAdmin<AdminFeedbackDetail>({ action: 'detail', ticket_id: ticketId });
}

export async function updateAdminFeedback(input: {
  ticketId: string;
  status?: FeedbackStatus;
  note?: string;
  expectedStatus: FeedbackStatus;
  requestId: string;
}): Promise<AdminFeedbackDetail> {
  return invokeAdmin<AdminFeedbackDetail>({
    action: 'update',
    ticket_id: input.ticketId,
    status: input.status || null,
    note: input.note?.trim() || null,
    expected_status: input.expectedStatus,
    request_id: input.requestId,
  });
}

export async function downloadAdminFeedbackAttachment(ticketId: string): Promise<Blob> {
  const result = await supabase.functions.invoke<Blob>('feedback-admin', {
    body: { action: 'attachment', ticket_id: ticketId },
  });
  if (result.error || !(result.data instanceof Blob)) throw new FeedbackRequestError(await responseErrorCode(result.error));
  const type = result.response?.headers.get('X-Feedback-Content-Type') || '';
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) throw new FeedbackRequestError('attachment_type');
  return new Blob([result.data], { type });
}

async function invokeAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const result = await supabase.functions.invoke<T & { ok?: boolean; error?: string }>('feedback-admin', { body });
  if (result.error || !result.data || result.data.ok !== true) {
    throw new FeedbackRequestError(await responseErrorCode(result.error, result.data?.error));
  }
  const { ok: _ok, ...payload } = result.data;
  return payload as T;
}

async function responseErrorCode(error: unknown, fallback?: string) {
  if (fallback) return fallback;
  const context = error && typeof error === 'object' && 'context' in error
    ? (error as { context?: Response }).context
    : null;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { error?: string };
      if (payload.error) return payload.error;
    } catch { /* The caller still gets a stable generic code below. */ }
  }
  return 'request_failed';
}

function safeCurrentUrl() {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${window.location.pathname.replace(/(\/order\/)[^/]+/gi, "$1[redacted]")}`.slice(0, 500);
}

function browserDeviceSummary() {
  if (typeof navigator === 'undefined') return 'Unknown browser';
  const agent = navigator.userAgent;
  const browser = agent.includes('Edg/') ? 'Edge'
    : agent.includes('Firefox/') ? 'Firefox'
      : agent.includes('Chrome/') ? 'Chrome'
        : agent.includes('Safari/') ? 'Safari' : 'Other';
  const platform = agent.includes('Android') ? 'Android'
    : /iPhone|iPad|iPod/.test(agent) ? 'iOS'
      : agent.includes('Windows') ? 'Windows'
        : agent.includes('Mac OS') ? 'macOS'
          : agent.includes('Linux') ? 'Linux' : 'Other';
  const device = /Android|iPhone|iPad|iPod|Mobile/.test(agent) ? 'mobile' : 'desktop';
  return `${browser} · ${platform} · ${device}`;
}
