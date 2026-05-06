import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Mail,
  RefreshCw,
  ShieldCheck,
  UserRound,
  XCircle,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { ConfirmDialog, Toast } from '../components/ui/Feedback';
import { LanguageToggle, useI18n } from '../i18n';

type ApplicationStatus = 'pending' | 'approved' | 'rejected';

type CreatorApplication = {
  id: string;
  auth_user_id: string | null;
  email: string;
  contact_name: string;
  creator_name: string;
  desired_slug: string;
  primary_social_url: string;
  website_url: string | null;
  instagram_url: string | null;
  x_url: string | null;
  facebook_url: string | null;
  tiktok_url: string | null;
  application_note: string;
  status: ApplicationStatus;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
};

type ToastMessage = {
  tone?: 'info' | 'success' | 'warning' | 'error';
  title: string;
  detail?: string;
};

type PendingAction =
  | { type: 'approve'; application: CreatorApplication }
  | { type: 'reject'; application: CreatorApplication }
  | null;

const statusClasses: Record<ApplicationStatus, string> = {
  pending: 'border-amber-200 bg-amber-50 text-amber-800',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  rejected: 'border-red-200 bg-red-50 text-red-700',
};

const formatDate = (value: string | null, locale: string) => {
  if (!value) return '-';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
};

const linkItems = (application: CreatorApplication) => [
  ['Primary', application.primary_social_url],
  ['Website', application.website_url],
  ['Instagram', application.instagram_url],
  ['X', application.x_url],
  ['Facebook', application.facebook_url],
  ['TikTok', application.tiktok_url],
].filter(([, url]) => Boolean(url));

export default function AdminApplications() {
  const { t, dateLocale } = useI18n();
  const navigate = useNavigate();
  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [applications, setApplications] = useState<CreatorApplication[]>([]);
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | 'all'>('pending');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const filteredApplications = useMemo(() => {
    if (statusFilter === 'all') return applications;
    return applications.filter((application) => application.status === statusFilter);
  }, [applications, statusFilter]);

  const pendingCount = applications.filter((application) => application.status === 'pending').length;

  const loadApplications = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('creator_applications')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      setToast({ tone: 'error', title: 'Could not load applications', detail: error.message });
    } else {
      setApplications((data || []) as CreatorApplication[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    let alive = true;

    const boot = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        navigate('/manage-login?redirect=/admin/applications', { replace: true });
        return;
      }

      const { data, error } = await supabase.rpc('is_platform_admin');
      if (!alive) return;

      const allowed = Boolean(data) && !error;
      setIsAdmin(allowed);
      setCheckingAdmin(false);

      if (allowed) {
        await loadApplications();
      } else {
        setLoading(false);
      }
    };

    void boot();

    return () => {
      alive = false;
    };
  }, [navigate]);

  const sendDecisionEmail = async (applicationId: string, event: 'approved' | 'rejected') => {
    const { error } = await supabase.functions.invoke('notify-creator-application', {
      body: { applicationId, event },
    });

    if (error) {
      setToast({
        tone: 'warning',
        title: 'Decision saved, email failed',
        detail: error.message,
      });
    }
  };

  const handleApprove = async () => {
    if (!pendingAction || pendingAction.type !== 'approve') return;
    setActionLoading(true);

    const { error } = await supabase.rpc('approve_creator_application', {
      p_application_id: pendingAction.application.id,
      p_review_note: reviewNote.trim() || null,
    });

    if (error) {
      setToast({ tone: 'error', title: 'Could not approve application', detail: error.message });
    } else {
      await sendDecisionEmail(pendingAction.application.id, 'approved');
      setToast({
        tone: 'success',
        title: t('adminApprove'),
        detail: `${pendingAction.application.email} can now sign in to the workspace.`,
      });
      await loadApplications();
    }

    setActionLoading(false);
    setPendingAction(null);
    setReviewNote('');
  };

  const handleReject = async () => {
    if (!pendingAction || pendingAction.type !== 'reject') return;
    if (!reviewNote.trim()) {
      setToast({ tone: 'warning', title: 'Reject note required', detail: t('adminRejectBody') });
      return;
    }

    setActionLoading(true);
    const { error } = await supabase.rpc('reject_creator_application', {
      p_application_id: pendingAction.application.id,
      p_review_note: reviewNote.trim(),
    });

    if (error) {
      setToast({ tone: 'error', title: 'Could not reject application', detail: error.message });
    } else {
      await sendDecisionEmail(pendingAction.application.id, 'rejected');
      setToast({ tone: 'success', title: 'Application rejected' });
      await loadApplications();
    }

    setActionLoading(false);
    setPendingAction(null);
    setReviewNote('');
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate('/manage-login', { replace: true });
  };

  if (checkingAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-500">
        <Loader2 className="mr-2 animate-spin" size={18} />
        {t('adminChecking')}
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-lg">
          <ShieldCheck className="mx-auto mb-4 text-gray-400" size={36} />
          <h1 className="text-xl font-black text-gray-900">{t('adminAccessRequired')}</h1>
          <p className="mt-2 text-sm text-gray-600">{t('adminAccessBody')}</p>
          <button
            type="button"
            onClick={signOut}
            className="mt-6 rounded-xl bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-black"
          >
            {t('signOut')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f4ef] text-gray-900">
      <Toast message={toast} onClose={() => setToast(null)} />
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-6 flex flex-col gap-4 border-b border-gray-200 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <Link to="/manage-login" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-gray-900">
              <ArrowLeft size={16} />
              {t('adminBack')}
            </Link>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-900 text-white">
                <ShieldCheck size={24} />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight">{t('adminTitle')}</h1>
                <p className="mt-1 text-sm text-gray-600">{t('adminPendingReview', { count: pendingCount })}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(['pending', 'approved', 'rejected', 'all'] as const).map((status) => (
              <button
                key={status}
                type="button"
                data-testid={`admin-applications-filter-${status}`}
                onClick={() => setStatusFilter(status)}
                className={`rounded-xl border px-3 py-2 text-sm font-black capitalize ${
                  statusFilter === status ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }`}
              >
                {t(status === 'pending' ? 'adminPending' : status === 'approved' ? 'adminApproved' : status === 'rejected' ? 'adminRejected' : 'adminAll')}
              </button>
            ))}
            <button
              type="button"
              data-testid="admin-applications-refresh"
              onClick={loadApplications}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-black text-gray-700 hover:border-gray-300"
              disabled={loading}
            >
              <RefreshCw className={loading ? 'animate-spin' : ''} size={16} />
              {t('adminRefresh')}
            </button>
            <LanguageToggle />
          </div>
        </header>

        {loading ? (
          <div className="flex min-h-64 items-center justify-center rounded-2xl border border-gray-200 bg-white text-gray-500">
            <Loader2 className="mr-2 animate-spin" size={18} />
            {t('adminLoading')}
          </div>
        ) : filteredApplications.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-500">
            {t('adminEmpty')}
          </div>
        ) : (
          <div className="grid gap-4" data-testid="admin-applications-list">
            {filteredApplications.map((application) => (
              <article key={application.id} data-testid="admin-application-card" className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase ${statusClasses[application.status]}`}>
                        {application.status}
                      </span>
                      <span className="text-xs font-bold text-gray-500">{t('adminApplied', { date: formatDate(application.created_at, dateLocale) })}</span>
                      {application.reviewed_at && <span className="text-xs font-bold text-gray-500">{t('adminReviewed', { date: formatDate(application.reviewed_at, dateLocale) })}</span>}
                    </div>

                    <h2 className="text-2xl font-black text-gray-950">{application.creator_name}</h2>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-600">
                      <span className="inline-flex items-center gap-2">
                        <Mail size={15} />
                        {application.email}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <UserRound size={15} />
                        {application.contact_name}
                      </span>
                      <span className="font-black text-gray-900">/{application.desired_slug}</span>
                    </div>
                  </div>

                  {application.status === 'pending' && (
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        data-testid="admin-application-reject"
                        onClick={() => setPendingAction({ type: 'reject', application })}
                        className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-black text-red-700 hover:bg-red-50"
                      >
                        <XCircle size={17} />
                        {t('adminReject')}
                      </button>
                      <button
                        type="button"
                        data-testid="admin-application-approve"
                        onClick={() => setPendingAction({ type: 'approve', application })}
                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white hover:bg-emerald-800"
                      >
                        <CheckCircle2 size={17} />
                        {t('adminApprove')}
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.8fr]">
                  <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                    <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-gray-400">{t('adminNote')}</div>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">{application.application_note}</p>
                    {application.review_note && (
                      <p className="mt-4 rounded-xl border border-gray-200 bg-white p-3 text-sm font-medium text-gray-600">
                        <span className="font-black text-gray-900">{t('adminReviewNote')}</span> {application.review_note}
                      </p>
                    )}
                  </div>

                  <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                    <div className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-gray-400">{t('adminLinks')}</div>
                    <div className="grid gap-2">
                      {linkItems(application).map(([label, url]) => (
                        <a
                          key={`${application.id}-${label}`}
                          href={url || '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:border-emerald-200 hover:text-emerald-800"
                        >
                          <span>{label}</span>
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate">{url}</span>
                            <ExternalLink className="shrink-0" size={14} />
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingAction?.type === 'approve'}
        title={t('adminApproveTitle')}
        detail={pendingAction ? t('adminApproveDetail', { email: pendingAction.application.email }) : undefined}
        confirmLabel={t('adminApprove')}
        cancelLabel={t('adminCancel')}
        loading={actionLoading}
        onCancel={() => {
          setPendingAction(null);
          setReviewNote('');
        }}
        onConfirm={handleApprove}
      />

      {pendingAction?.type === 'reject' && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-gray-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-black text-gray-900">{t('adminRejectTitle')}</h2>
            <p className="mt-2 text-sm font-medium text-gray-600">{t('adminRejectBody')}</p>
            <textarea
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              rows={4}
              className="mt-4 w-full rounded-xl border border-gray-200 p-3 text-sm font-medium outline-none focus:border-red-300 focus:ring-4 focus:ring-red-50"
              placeholder={t('adminRejectPlaceholder')}
            />
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingAction(null);
                  setReviewNote('');
                }}
                disabled={actionLoading}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                {t('adminCancel')}
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={actionLoading}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? t('adminWorking') : t('adminReject')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
