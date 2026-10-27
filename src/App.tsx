import { offlineAuthorization } from './lib/offlineOperations';
import { Suspense, lazy, useState, useEffect, useRef, type ReactNode } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';

/** Redirects to /live/queue while keeping the current search string (e.g. ?eventId=). */
function LiveQueueRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/live/queue${search}`} replace />;
}
import { supabase } from './supabaseClient';
import PlatformAdminGate from './components/PlatformAdminGate';
import type { Session } from '@supabase/supabase-js';
import { completePendingVerifiedCreatorSignup, fetchActorContext, WorkspaceSelectionRequiredError } from './utils/access';
import type { ActorContext, ActorRole, ActorWorkspace } from './types/access';
import {
  MANAGEMENT_ROLES,
  POS_ROLES,
  QUEUE_ROLES,
  canAccessManagementPages,
  canAccessQueuePages,
  canUsePos,
} from './types/access';

const CustomerLayout = lazy(() => import('./pages/customer/CustomerLayout'));
const CustomerHome = lazy(() => import('./pages/customer/Home'));
const DiscoveryHome = lazy(() => import('./pages/customer/DiscoveryHome'));
const MenuView = lazy(() => import('./pages/customer/MenuView'));
const CampaignAwareOrderStatus = lazy(() => import('./pages/customer/CampaignAwareOrderStatus'));
const OnlineCampaignStorefront = lazy(() => import('./pages/customer/OnlineCampaignStorefront'));
const QueueView = lazy(() => import('./pages/customer/QueueView'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const CreatorRegister = lazy(() => import('./pages/CreatorRegister'));
const AdminApplications = lazy(() => import('./pages/AdminApplications'));
const LegalPage = lazy(() => import('./pages/LegalPage'));

const ManageProducts = lazy(() => import('./pages/creators/ManageProducts'));
const HelpPage = lazy(() => import('./pages/HelpPage'));
const AdminSupport = lazy(() => import('./pages/AdminSupport'));
const OrderProblems = lazy(() => import('./pages/creators/OrderProblems'));
const PlatformAdminConsole = lazy(() => import('./pages/PlatformAdminConsole'));
const Feedback = lazy(() => import('./pages/Feedback'));
const ManageArtist = lazy(() => import('./pages/creators/ManageArtist'));
const ManageTeam = lazy(() => import('./pages/creators/ManageTeam'));
const OrderHistory = lazy(() => import('./pages/creators/OrderHistory'));
const EventDashboard = lazy(() => import('./pages/creators/EventDashboard'));
const EventWorkspace = lazy(() => import('./pages/creators/EventWorkspace'));
const PreorderSettings = lazy(() => import('./pages/creators/PreorderSettings'));
const PreorderPickup = lazy(() => import('./pages/creators/PreorderPickup'));
const PreorderDashboard = lazy(() => import('./pages/creators/PreorderDashboard'));
const OnlineCampaigns = lazy(() => import('./pages/creators/OnlineCampaigns'));
const OnlineCampaignWorkspace = lazy(() => import('./pages/creators/OnlineCampaignWorkspace'));
const OfflineWorkspace = lazy(() => import('./pages/OfflineWorkspace'));
const ManageCombined = lazy(() => import('./pages/ManageCombined'));
const StaffSignup = lazy(() => import('./pages/StaffSignup'));

const ManageLogin = lazy(() => import('./pages/ManageLogin'));
import { useI18n, uiText } from './i18n';
import PendingInvitationBanner, { type PendingInvite } from './components/PendingInvitationBanner';
const InvitationsPage = lazy(() => import('./pages/InvitationsPage'));
import { clearObservabilityUser, identifyObservabilityUser } from './lib/observability';
import WorkspaceChooser from './components/WorkspaceChooser';
import { clearOperationalWorkspaceState, signOutLocally } from './utils/workspaceSession';

function ConnectingScreen() {
  const { language } = useI18n();
  return <div className="connecting-screen" role="status">
    <span className="connecting-star" aria-hidden="true" />
    <span>{language === 'th' ? 'กำลังเชื่อมต่อกับ Paimon…' : 'Connecting to Paimon…'}</span>
  </div>;
}

function EventAccessRoute({
  allowedRoles,
  fallbackPath,
  selectedArtistId,
  children,
}: {
  allowedRoles: ActorRole[];
  fallbackPath: string;
  selectedArtistId: string;
  children: ReactNode;
}) {
  const { language } = useI18n();
  const { eventId } = useParams();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const allowedRoleKey = allowedRoles.join(',');

  useEffect(() => {
    let active = true;
    setAllowed(null);

    if (!eventId || !selectedArtistId) {
      setAllowed(false);
      return () => { active = false; };
    }

    void supabase.rpc('has_event_role_for_workspace', {
      p_event_id: eventId,
      p_artist_id: selectedArtistId,
      p_allowed_roles: allowedRoleKey.split(','),
    }).then(({ data, error }) => {
      if (active) setAllowed(!error && data === true);
    });

    return () => { active = false; };
  }, [allowedRoleKey, eventId, selectedArtistId]);

  if (allowed === null) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">{uiText(language, 'Checking event access…')}</div>;
  }

  return allowed ? children : <Navigate to={fallbackPath} replace />;
}

function isManagementLocation(path: string) {
  if (path === '/offline' || /^\/(admin|live)(?:\/|$)/.test(path)) return true;
  // Store slugs may start with "manage-"; their customer pages stay public.
  if (/^\/[^/]+\/(home|join|queue-position|queue|menu|pos|order|campaign)(?:\/|$)/.test(path)) return false;
  return /^\/manage(?:[-/]|$)/.test(path) || ['/invitations', '/creator/register', '/staff-signup'].includes(path);
}

function App() {
  const { t, language } = useI18n();
  const [session, setSession] = useState<Session | null>(null);
  const [actorContext, setActorContext] = useState<ActorContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionLoadFailed, setSessionLoadFailed] = useState(false);
  const [sessionLoadAttempt, setSessionLoadAttempt] = useState(0);
  const [contextLoadFailed, setContextLoadFailed] = useState(false);
  const [contextSyncing, setContextSyncing] = useState(false);
  const contextRequest = useRef(0);
  const sessionIdentity = useRef<string | null>(null);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvite[]>([]);
  const [workspaceChoices, setWorkspaceChoices] = useState<ActorWorkspace[]>([]);
  const [workspaceChoiceMessage, setWorkspaceChoiceMessage] = useState('');
  const [signOutError, setSignOutError] = useState('');
  const [managementSuspended, setManagementSuspended] = useState(false);
  const suspensionDetected = useRef(false);

  const clearSuspendedManagement = async () => {
    localStorage.removeItem('nireq-offline-authorized');
    suspensionDetected.current = true;
    setManagementSuspended(true);
    setActorContext(null);
    setPendingInvitations([]);
    setWorkspaceChoices([]);
    setContextLoadFailed(false);
    clearObservabilityUser();
    await clearOperationalWorkspaceState();
  };

  const syncSessionContext = async (nextSession: Session | null) => {
    const request = ++contextRequest.current;
    setSessionLoadFailed(false);
    try {
      const identity = nextSession?.user.id || null;
      const identityChanged = identity !== sessionIdentity.current;
      if (identityChanged) {
        if (offlineAuthorization() && offlineAuthorization() !== identity) localStorage.removeItem('nireq-offline-authorized');
        setActorContext(null);
        setPendingInvitations([]);
        setWorkspaceChoices([]);
      }
      sessionIdentity.current = identity;
      setSession(nextSession);
      setContextLoadFailed(false);
      setWorkspaceChoiceMessage('');
      setContextSyncing(!!nextSession);
      if (identityChanged) {
        clearObservabilityUser();
        await clearOperationalWorkspaceState();
        if (request !== contextRequest.current) return;
      }

      if (!nextSession) {
        suspensionDetected.current = false;
        setManagementSuspended(false);
        setActorContext(null);
        setPendingInvitations([]);
        setWorkspaceChoices([]);
        clearObservabilityUser();
        return;
      }

      const activeAccount = await supabase.rpc('is_account_management_active');
      if (request !== contextRequest.current) return;
      if (activeAccount.error) throw activeAccount.error;
      if (activeAccount.data !== true) {
        await clearSuspendedManagement();
        return;
      }
      suspensionDetected.current = false;
      setManagementSuspended(false);
      const signupStatus = await completePendingVerifiedCreatorSignup();

      const [ctx, invitations] = await Promise.all([
        fetchActorContext(),
        supabase.rpc('list_my_pending_invitations'),
      ]);
      if (request !== contextRequest.current) return;
      if (!ctx && !(invitations.data || []).length && signupStatus === 'error') throw new Error('Could not complete creator signup');
      if (invitations.error) {
        console.error('[App] Failed to load invitations:', invitations.error);
        if (!ctx) throw invitations.error;
      } else {
        setPendingInvitations((invitations.data || []) as PendingInvite[]);
      }
      setActorContext(ctx);
      setWorkspaceChoices([]);
      identifyObservabilityUser(nextSession, ctx);
    } catch (error) {
      console.error('[App] Failed to sync session context:', error);
      if (request !== contextRequest.current) return;
      setActorContext(null);
      setPendingInvitations([]);
      if (error instanceof WorkspaceSelectionRequiredError) {
        setWorkspaceChoices(error.workspaces);
        setWorkspaceChoiceMessage(error.message);
        setContextLoadFailed(false);
      } else {
        setWorkspaceChoices([]);
        setContextLoadFailed(true);
      }
    } finally {
      if (request === contextRequest.current) {
        setContextSyncing(false);
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    let isMounted = true;

    const loadInitialSession = async () => {
      setSessionLoadFailed(false);
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!isMounted) return;
        await syncSessionContext(data.session);
      } catch (error) {
        console.error('[App] getSession failed:', error);
        if (!isMounted) return;
        setSessionLoadFailed(true);
        setLoading(false);
      }
    };

    void loadInitialSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_OUT' && offlineAuthorization()) localStorage.removeItem('nireq-offline-authorized');
      if (event === 'PASSWORD_RECOVERY') {
        window.location.replace('/reset-password');
        return;
      }

      if (event === 'INITIAL_SESSION') return;

      window.setTimeout(() => {
        if (isMounted) void syncSessionContext(nextSession);
      }, 0);
    });

    return () => {
      isMounted = false;
      contextRequest.current++;
      subscription.unsubscribe();
    };
  }, [sessionLoadAttempt]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    let checking = false;
    const check = async () => {
      const path = window.location.pathname;
      if (checking || suspensionDetected.current || !isManagementLocation(path)) return;
      checking = true;
      try {
        const result = await supabase.rpc('is_account_management_active');
        if (!active || result.error || result.data !== false) return;
        ++contextRequest.current;
        setContextSyncing(false);
        setLoading(false);
        await clearSuspendedManagement();
      } finally { checking = false; }
    };
    const interval = window.setInterval(() => { void check(); }, 5000);
    window.addEventListener('focus', check);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', check);
    };
  }, [session?.user.id, session?.access_token]);

  const canUseManagement = canAccessManagementPages(actorContext?.role);
  const canUseQueueWorkspace = canAccessQueuePages(actorContext?.role);
  const canSell = canUsePos(actorContext?.role);

  const getDefaultPath = () => {
    if (!session) return '/';
    if (canUseManagement) return '/manage-events';
    if (canUseQueueWorkspace) return '/manage-pos-queues';
    return '/';
  };

  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
  const isCustomerRoute = typeof window !== 'undefined'
    ? /^\/[^/]+\/(home|join|queue-position|queue|menu|pos|order|campaign)/.test(window.location.pathname)
    : false;
  const isWorkspaceOptionalPath = currentPath === '/admin' || currentPath.startsWith('/admin/') || currentPath === '/help' || ['/', '/offline', '/help/guide', '/discover', '/manage-login', '/manage-workspaces', '/creator/register', '/staff-signup', '/reset-password', '/admin/applications', '/admin/support', '/invitations', '/privacy', '/terms', '/cookies'].includes(currentPath);

  const isManagementPath = isManagementLocation(currentPath);
  if (session && managementSuspended && isManagementPath) {
    const th = language === 'th';
    return <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md space-y-4 rounded-xl border border-gray-200 bg-white p-6 text-center">
        <h1 className="text-lg font-bold text-gray-900">{th ? 'บัญชีถูกระงับสิทธิ์จัดการ' : 'Management access suspended'}</h1>
        <p className="text-sm text-gray-700">{th ? 'คุณยังเข้าหน้าร้านสาธารณะได้ ทีมคนอื่นยังดูแลร้านและออเดอร์เดิมได้ ติดต่อผู้ดูแลหากต้องการตรวจสอบสิทธิ์' : 'You can still visit public storefronts. Other team members can continue managing the store and existing orders. Contact support to review your access.'}</p>
        {signOutError && <p role="alert" className="text-sm font-bold text-red-700">{signOutError}</p>}
        {contextLoadFailed && <p role="alert" className="text-sm font-bold text-red-700">{t('workspaceLoadFailed')}</p>}
        <div className="flex flex-wrap justify-center gap-3">
          <a href="/help" className="inline-flex min-h-11 items-center rounded-lg border px-4 font-bold">{th ? 'ติดต่อผู้ดูแล' : 'Contact support'}</a>
          <a href="/" className="inline-flex min-h-11 items-center rounded-lg border px-4 font-bold">{th ? 'ดูหน้าร้าน' : 'Browse stores'}</a>
          <button disabled={contextSyncing} className="min-h-11 rounded-lg border px-4 font-bold disabled:opacity-50" onClick={() => { void syncSessionContext(session); }}>{contextSyncing ? t('loading') : th ? 'ตรวจสอบสิทธิ์อีกครั้ง' : 'Check access again'}</button>
          <button className="min-h-11 rounded-lg bg-pink-600 px-4 font-bold text-white" onClick={async () => {
            setSignOutError('');
            try {
              await signOutLocally(session.user.id);
              window.location.replace('/manage-login');
            } catch (error) { setSignOutError(error instanceof Error ? error.message : t('workspaceLoadFailed')); }
          }}>{t('signOut')}</button>
        </div>
      </div>
    </main>;
  }

  if (currentPath !== '/offline' && (loading || (session && contextSyncing && !actorContext && !isWorkspaceOptionalPath && !isCustomerRoute))) {
    return <ConnectingScreen />;
  }

  const needsSession = currentPath.startsWith('/manage') || currentPath.startsWith('/admin') || ['/invitations', '/creator/register', '/staff-signup', '/reset-password'].includes(currentPath);
  if ((sessionLoadFailed && needsSession) || (session && contextLoadFailed && !isWorkspaceOptionalPath && !isCustomerRoute)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div role="alert" className="max-w-md space-y-4 text-center">
          <p className="font-bold text-red-700">{t('workspaceLoadFailed')}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              if (sessionLoadFailed) setSessionLoadAttempt((attempt) => attempt + 1);
              else void syncSessionContext(session);
            }}
            className="min-h-11 rounded-xl bg-pink-600 px-4 py-2 font-bold text-white"
          >
            {t('workspaceRetryLoad')}
          </button>
        </div>
      </div>
    );
  }

  if (session && !actorContext && pendingInvitations.length > 0 && !isWorkspaceOptionalPath && !isCustomerRoute) {
    window.location.replace('/invitations');
    return <div className="min-h-screen flex items-center justify-center text-gray-500">{t('loading')}</div>;
  }

  if (session && !actorContext && workspaceChoices.length > 0 && !isWorkspaceOptionalPath && !isCustomerRoute) {
    return <WorkspaceChooser workspaces={workspaceChoices} message={workspaceChoiceMessage} />;
  }

  if (session && !actorContext && !isWorkspaceOptionalPath && !isCustomerRoute) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-md text-center">
          <h1 className="text-lg font-bold text-gray-800 mb-2">{t('workspaceNotAssigned')}</h1>
          <p className="text-sm text-gray-600 mb-4">{t('workspaceNotAssignedBody')}</p>
          {signOutError && <p role="alert" className="mb-4 text-sm font-bold text-red-700">{signOutError}</p>}
          <button
            onClick={async () => {
              setSignOutError('');
              try {
                await signOutLocally(session.user.id);
                window.location.replace('/manage-login');
              } catch (error) {
                setSignOutError(error instanceof Error ? error.message : t('workspaceLoadFailed'));
              }
            }}
            className="px-4 py-2 rounded-lg bg-pink-600 text-white text-sm font-bold hover:bg-pink-700"
          >
            {t('signOut')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="app-container">
        <Suspense fallback={<ConnectingScreen />}>
          <Routes>
            <Route path="/offline" element={<OfflineWorkspace />} />
            <Route path="/manage-login" element={<ManageLogin refreshWorkspace={() => syncSessionContext(session)} />} />
            <Route
              path="/manage-workspaces"
              element={session
                ? workspaceChoices.length > 0
                  ? <WorkspaceChooser workspaces={workspaceChoices} message={workspaceChoiceMessage} />
                  : actorContext
                    ? <Navigate to={getDefaultPath()} replace />
                    : <Navigate to="/manage-login" replace />
                : <Navigate to="/manage-login" replace />}
            />
            <Route path="/creator/register" element={<CreatorRegister />} />
            <Route path="/staff-signup" element={<StaffSignup />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/help/guide" element={<HelpPage />} />
            <Route path="/privacy" element={<LegalPage kind="privacy" />} />
            <Route path="/terms" element={<LegalPage kind="terms" />} />
            <Route path="/cookies" element={<LegalPage kind="cookies" />} />
            <Route
              path="/admin/applications"
              element={session ? <PlatformAdminGate key={session.user.id} userId={session.user.id} accessToken={session.access_token}><AdminApplications /></PlatformAdminGate> : <Navigate to="/manage-login?redirect=/admin/applications" replace />}
            />
            <Route path="/help" element={<Feedback />} />
            <Route path="/admin/*" element={session ? <PlatformAdminGate key={session.user.id} userId={session.user.id} accessToken={session.access_token}><PlatformAdminConsole /></PlatformAdminGate> : <Navigate to="/manage-login?redirect=/admin" replace />} />
            <Route path="/admin/support" element={session ? <PlatformAdminGate key={session.user.id} userId={session.user.id} accessToken={session.access_token}><AdminSupport /></PlatformAdminGate> : <Navigate to="/manage-login?redirect=/admin/support" replace />} />
            <Route
              path="/invitations"
              element={session ? <InvitationsPage /> : <Navigate to="/manage-login?redirect=/invitations" replace />}
            />

            <Route
              path="/manage-products"
              element={session ? (canUseManagement ? <ManageProducts /> : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-promotions"
              element={session ? (canUseManagement ? <ManageProducts initialTab="promotions" /> : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route path="/manage-order-problems" element={session && canUseManagement && actorContext ? <OrderProblems actorContext={actorContext} /> : <Navigate to={getDefaultPath()} replace />} />
            <Route
              path="/manage-events"
              element={session ? (canUseManagement ? <ManageArtist /> : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-online-sales"
              element={session ? (canSell ? <OnlineCampaigns /> : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-online-sales/:campaignId"
              element={session ? (canSell ? <OnlineCampaignWorkspace /> : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-team"
              element={session ? (canUseManagement && actorContext ? <ManageTeam actorContext={actorContext} /> : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId"
              element={session ? (canUseManagement ? <Navigate to="/manage-events" replace /> : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/workspace"
              element={session && actorContext && canUseQueueWorkspace ? (
                <EventAccessRoute allowedRoles={QUEUE_ROLES} fallbackPath="/manage-pos-queues" selectedArtistId={actorContext.artist_id}>
                  <EventWorkspace actorContext={actorContext} />
                </EventAccessRoute>
              ) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/history"
              element={session ? (canUseManagement ? (
                <EventAccessRoute allowedRoles={MANAGEMENT_ROLES} fallbackPath="/manage-events" selectedArtistId={actorContext!.artist_id}>
                  <OrderHistory />
                </EventAccessRoute>
              ) : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/dashboard"
              element={session ? (canUseManagement ? (
                <EventAccessRoute allowedRoles={MANAGEMENT_ROLES} fallbackPath="/manage-events" selectedArtistId={actorContext!.artist_id}>
                  <EventDashboard />
                </EventAccessRoute>
              ) : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/catalog"
              element={session ? (canUseManagement ? (
                <EventAccessRoute allowedRoles={MANAGEMENT_ROLES} fallbackPath="/manage-events" selectedArtistId={actorContext!.artist_id}>
                  <ManageProducts initialTab="event-catalog" />
                </EventAccessRoute>
              ) : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/promotion"
              element={session ? (canUseManagement ? (
                <EventAccessRoute allowedRoles={MANAGEMENT_ROLES} fallbackPath="/manage-events" selectedArtistId={actorContext!.artist_id}>
                  <ManageProducts initialTab="promotions" />
                </EventAccessRoute>
              ) : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/preorder"
              element={session ? (canUseManagement ? (
                <EventAccessRoute allowedRoles={MANAGEMENT_ROLES} fallbackPath="/manage-events" selectedArtistId={actorContext!.artist_id}>
                  <PreorderSettings />
                </EventAccessRoute>
              ) : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/preorder-dashboard"
              element={session && actorContext ? (canSell ? (
                <EventAccessRoute allowedRoles={POS_ROLES} fallbackPath="/manage-pos-queues" selectedArtistId={actorContext.artist_id}>
                  <PreorderDashboard actorContext={actorContext} scope="preorder" />
                </EventAccessRoute>
              ) : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/postorder-dashboard"
              element={session && actorContext ? (canSell ? (
                <EventAccessRoute allowedRoles={POS_ROLES} fallbackPath="/manage-pos-queues" selectedArtistId={actorContext.artist_id}>
                  <PreorderDashboard actorContext={actorContext} scope="post_event" />
                </EventAccessRoute>
              ) : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/pickup"
              element={session && actorContext && canUseQueueWorkspace ? (
                <EventAccessRoute allowedRoles={QUEUE_ROLES} fallbackPath="/manage-pos-queues" selectedArtistId={actorContext.artist_id}>
                  <PreorderPickup actorContext={actorContext} />
                </EventAccessRoute>
              ) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-pos-queues"
              element={session && actorContext && canUseQueueWorkspace ? <ManageCombined actorContext={actorContext} /> : <Navigate to="/manage-login" replace />}
            />
            {/* Live Operation Mode — focused per-tab routes (Queue vs POS).
                Both render the same ManageCombined with the correct initial tab.
                The legacy /manage-pos-queues URL above is preserved for backward compatibility. */}
            <Route
              path="/live/queue"
              element={session && actorContext && canUseQueueWorkspace ? <ManageCombined actorContext={actorContext} initialTab="queue" /> : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/live/pos"
              element={
                session && actorContext
                  ? canSell
                    ? <ManageCombined actorContext={actorContext} initialTab="pos" />
                    : canUseQueueWorkspace
                      ? <LiveQueueRedirect />
                      : <Navigate to="/manage-login" replace />
                  : <Navigate to="/manage-login" replace />
              }
            />
            <Route path="/live" element={<Navigate to="/live/queue" replace />} />

            <Route path="/" element={<DiscoveryHome />} />
            <Route path="/discover" element={<DiscoveryHome />} />

            <Route path="/:slug/order/:code" element={<CampaignAwareOrderStatus />} />
            <Route path="/:slug/campaign/:campaignSlug" element={<OnlineCampaignStorefront />} />
            <Route path="/:slug" element={<CustomerLayout />}>
              <Route path="home" element={<CustomerHome />} />
              <Route path="menu" element={<MenuView />} />
              <Route path="queue" element={<QueueView />} />
              <Route index element={<CustomerHome />} />
            </Route>
            <Route path="*" element={<Navigate to={getDefaultPath()} replace />} />
          </Routes>
        </Suspense>
      </div>
      {session && !isCustomerRoute && (
        <PendingInvitationBanner
          invitations={pendingInvitations}
          onAccepted={async () => {
            await syncSessionContext(session);
          }}
        />
      )}
    </Router>
  );
}

export default App;
