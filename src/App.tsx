import { offlineAuthorization } from './lib/offlineOperations';
import { Suspense, lazy, useState, useEffect, useRef, type ReactNode } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';

/** Redirects to /live/queue while keeping the current search string (e.g. ?eventId=). */
function LiveQueueRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/live/queue${search}`} replace />;
}
import { supabase } from './supabaseClient';
import type { Session } from '@supabase/supabase-js';
import { completePendingVerifiedCreatorSignup, fetchActorContext } from './utils/access';
import type { ActorContext, ActorRole } from './types/access';
import {
  MANAGEMENT_ROLES,
  POS_ROLES,
  QUEUE_ROLES,
  canAccessManagementPages,
  canAccessQueuePages,
  canUsePos,
} from './types/access';

import CustomerLayout from './pages/customer/CustomerLayout';
import CustomerHome from './pages/customer/Home';
const DiscoveryHome = lazy(() => import('./pages/customer/DiscoveryHome'));
const MenuView = lazy(() => import('./pages/customer/MenuView'));
const CampaignAwareOrderStatus = lazy(() => import('./pages/customer/CampaignAwareOrderStatus'));
const OnlineCampaignStorefront = lazy(() => import('./pages/customer/OnlineCampaignStorefront'));
import QueueView from './pages/customer/QueueView';
import ResetPassword from './pages/ResetPassword';
import CreatorRegister from './pages/CreatorRegister';
import AdminApplications from './pages/AdminApplications';
import LegalPage from './pages/LegalPage';

const ManageProducts = lazy(() => import('./pages/creators/ManageProducts'));
const HelpPage = lazy(() => import('./pages/HelpPage'));
const AdminSupport = lazy(() => import('./pages/AdminSupport'));
const OrderProblems = lazy(() => import('./pages/creators/OrderProblems'));
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

import ManageLogin from './pages/ManageLogin';
import { useI18n, uiText } from './i18n';
import PendingInvitationBanner, { type PendingInvite } from './components/PendingInvitationBanner';
import InvitationsPage from './pages/InvitationsPage';

function EventAccessRoute({
  allowedRoles,
  fallbackPath,
  children,
}: {
  allowedRoles: ActorRole[];
  fallbackPath: string;
  children: ReactNode;
}) {
  const { language } = useI18n();
  const { eventId } = useParams();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const allowedRoleKey = allowedRoles.join(',');

  useEffect(() => {
    let active = true;
    setAllowed(null);

    if (!eventId) {
      setAllowed(false);
      return () => { active = false; };
    }

    void supabase.rpc('has_event_role', {
      p_event_id: eventId,
      p_allowed_roles: allowedRoleKey.split(','),
    }).then(({ data, error }) => {
      if (active) setAllowed(!error && data === true);
    });

    return () => { active = false; };
  }, [allowedRoleKey, eventId]);

  if (allowed === null) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">{uiText(language, 'Checking event access…')}</div>;
  }

  return allowed ? children : <Navigate to={fallbackPath} replace />;
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

  const syncSessionContext = async (nextSession: Session | null) => {
    const request = ++contextRequest.current;
    setSessionLoadFailed(false);
    try {
      const identity = nextSession?.user.id || null;
      if (identity !== sessionIdentity.current) {
        setActorContext(null);
        setPendingInvitations([]);
      }
      sessionIdentity.current = identity;
      setSession(nextSession);
      setContextLoadFailed(false);
      setContextSyncing(!!nextSession);

      if (!nextSession) {
        setActorContext(null);
        setPendingInvitations([]);
        return;
      }

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
    } catch (error) {
      console.error('[App] Failed to sync session context:', error);
      if (request !== contextRequest.current) return;
      setActorContext(null);
      setPendingInvitations([]);
      setContextLoadFailed(true);
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
  const isWorkspaceOptionalPath = ['/', '/help', '/offline', '/discover', '/manage-login', '/creator/register', '/staff-signup', '/reset-password', '/admin/applications', '/admin/support', '/invitations', '/privacy', '/terms', '/cookies'].includes(currentPath);

  if (currentPath !== '/offline' && (loading || (session && contextSyncing && !actorContext && !isWorkspaceOptionalPath && !isCustomerRoute))) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">{t('loading')}</div>;
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

  if (session && !actorContext && !isWorkspaceOptionalPath && !isCustomerRoute) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-md text-center">
          <h1 className="text-lg font-bold text-gray-800 mb-2">{t('workspaceNotAssigned')}</h1>
          <p className="text-sm text-gray-600 mb-4">{t('workspaceNotAssignedBody')}</p>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = '/manage-login';
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
        {currentPath !== '/offline' && offlineAuthorization() && <a href="/offline" className="block bg-amber-50 p-3 text-center text-sm font-semibold text-amber-900">{language === 'th' ? 'เปิดพื้นที่ขายที่เตรียมไว้เมื่อเน็ตขาด' : 'Open prepared offline workspace'}</a>}
        <Suspense fallback={<div className="flex justify-center items-center h-screen">{t('loading')}</div>}>
          <Routes>
            <Route path="/offline" element={<OfflineWorkspace />} />
            <Route path="/manage-login" element={<ManageLogin refreshWorkspace={() => syncSessionContext(session)} />} />
            <Route path="/creator/register" element={<CreatorRegister />} />
            <Route path="/staff-signup" element={<StaffSignup />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/privacy" element={<LegalPage kind="privacy" />} />
            <Route path="/terms" element={<LegalPage kind="terms" />} />
            <Route path="/cookies" element={<LegalPage kind="cookies" />} />
            <Route
              path="/admin/applications"
              element={session ? <AdminApplications /> : <Navigate to="/manage-login?redirect=/admin/applications" replace />}
            />
            <Route path="/admin/support" element={session ? <AdminSupport /> : <Navigate to="/manage-login?redirect=/admin/support" replace />} />
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
                <EventAccessRoute allowedRoles={QUEUE_ROLES} fallbackPath="/manage-pos-queues">
                  <EventWorkspace actorContext={actorContext} />
                </EventAccessRoute>
              ) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/history"
              element={session ? (canUseManagement ? (
                <EventAccessRoute allowedRoles={MANAGEMENT_ROLES} fallbackPath="/manage-events">
                  <OrderHistory />
                </EventAccessRoute>
              ) : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/dashboard"
              element={session ? (canUseManagement ? (
                <EventAccessRoute allowedRoles={MANAGEMENT_ROLES} fallbackPath="/manage-events">
                  <EventDashboard />
                </EventAccessRoute>
              ) : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/catalog"
              element={session ? (canUseManagement ? (
                <EventAccessRoute allowedRoles={MANAGEMENT_ROLES} fallbackPath="/manage-events">
                  <ManageProducts initialTab="event-catalog" />
                </EventAccessRoute>
              ) : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/promotion"
              element={session ? (canUseManagement ? (
                <EventAccessRoute allowedRoles={MANAGEMENT_ROLES} fallbackPath="/manage-events">
                  <ManageProducts initialTab="promotions" />
                </EventAccessRoute>
              ) : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/preorder"
              element={session ? (canUseManagement ? (
                <EventAccessRoute allowedRoles={MANAGEMENT_ROLES} fallbackPath="/manage-events">
                  <PreorderSettings />
                </EventAccessRoute>
              ) : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/preorder-dashboard"
              element={session && actorContext ? (canSell ? (
                <EventAccessRoute allowedRoles={POS_ROLES} fallbackPath="/manage-pos-queues">
                  <PreorderDashboard actorContext={actorContext} scope="preorder" />
                </EventAccessRoute>
              ) : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/postorder-dashboard"
              element={session && actorContext ? (canSell ? (
                <EventAccessRoute allowedRoles={POS_ROLES} fallbackPath="/manage-pos-queues">
                  <PreorderDashboard actorContext={actorContext} scope="post_event" />
                </EventAccessRoute>
              ) : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/pickup"
              element={session && actorContext && canUseQueueWorkspace ? (
                <EventAccessRoute allowedRoles={QUEUE_ROLES} fallbackPath="/manage-pos-queues">
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
