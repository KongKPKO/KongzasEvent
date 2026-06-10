import { Suspense, lazy, useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';

/** Redirects to /live/queue while keeping the current search string (e.g. ?eventId=). */
function LiveQueueRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/live/queue${search}`} replace />;
}
import { supabase } from './supabaseClient';
import { fetchActorContext } from './utils/access';
import type { ActorContext } from './types/access';
import { canAccessManagementPages, canAccessOwnerPages, canAccessQueuePages, canUsePos } from './types/access';

import CustomerLayout from './pages/customer/CustomerLayout';
import CustomerHome from './pages/customer/Home';
const DiscoveryHome = lazy(() => import('./pages/customer/DiscoveryHome'));
const MenuView = lazy(() => import('./pages/customer/MenuView'));
const OrderStatus = lazy(() => import('./pages/customer/OrderStatus'));
import QueueView from './pages/customer/QueueView';
import ResetPassword from './pages/ResetPassword';
import CreatorRegister from './pages/CreatorRegister';
import AdminApplications from './pages/AdminApplications';

const ManageProducts = lazy(() => import('./pages/creators/ManageProducts'));
const ManageArtist = lazy(() => import('./pages/creators/ManageArtist'));
const ManageTeam = lazy(() => import('./pages/creators/ManageTeam'));
const OrderHistory = lazy(() => import('./pages/creators/OrderHistory'));
const EventDashboard = lazy(() => import('./pages/creators/EventDashboard'));
const EventWorkspace = lazy(() => import('./pages/creators/EventWorkspace'));
const PreorderSettings = lazy(() => import('./pages/creators/PreorderSettings'));
const PreorderPickup = lazy(() => import('./pages/creators/PreorderPickup'));
const PreorderDashboard = lazy(() => import('./pages/creators/PreorderDashboard'));
const ManageCombined = lazy(() => import('./pages/ManageCombined'));
const StaffSignup = lazy(() => import('./pages/StaffSignup'));

import ManageLogin from './pages/ManageLogin';
import { useI18n } from './i18n';
import PendingInvitationBanner, { type PendingInvite } from './components/PendingInvitationBanner';
import InvitationsPage from './pages/InvitationsPage';

function App() {
  const { t } = useI18n();
  const [session, setSession] = useState<any>(null);
  const [actorContext, setActorContext] = useState<ActorContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvite[]>([]);

  const loadPendingInvitations = async () => {
    try {
      const { data } = await supabase.rpc('list_my_pending_invitations');
      setPendingInvitations((data || []) as PendingInvite[]);
    } catch {
      setPendingInvitations([]);
    }
  };

  const syncSessionContext = async (nextSession: any) => {
    try {
      setSession(nextSession);

      if (!nextSession) {
        setActorContext(null);
        setPendingInvitations([]);
        return;
      }

      const [ctx] = await Promise.all([
        fetchActorContext(),
        loadPendingInvitations(),
      ]);
      setActorContext(ctx);
    } catch (error) {
      console.error('[App] Failed to sync session context:', error);
      setActorContext(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const loadInitialSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!isMounted) return;
        await syncSessionContext(data.session);
      } catch (error) {
        console.error('[App] getSession failed:', error);
        if (!isMounted) return;
        setSession(null);
        setActorContext(null);
        setLoading(false);
      }
    };

    void loadInitialSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
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
      subscription.unsubscribe();
    };
  }, []);

  const isOwner = canAccessOwnerPages(actorContext?.role);
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
    ? /^\/[^/]+\/(home|join|queue-position|queue|menu|pos|order)/.test(window.location.pathname)
    : false;
  const isWorkspaceOptionalPath = ['/', '/discover', '/manage-login', '/creator/register', '/staff-signup', '/reset-password', '/admin/applications', '/invitations'].includes(currentPath);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">{t('loading')}</div>;
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
        <Suspense fallback={<div className="flex justify-center items-center h-screen">{t('loading')}</div>}>
          <Routes>
            <Route path="/manage-login" element={<ManageLogin />} />
            <Route path="/creator/register" element={<CreatorRegister />} />
            <Route path="/staff-signup" element={<StaffSignup />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route
              path="/admin/applications"
              element={session ? <AdminApplications /> : <Navigate to="/manage-login?redirect=/admin/applications" replace />}
            />
            <Route
              path="/invitations"
              element={session ? <InvitationsPage /> : <Navigate to="/manage-login?redirect=/invitations" replace />}
            />

            <Route
              path="/manage-products"
              element={session ? (canUseManagement ? <ManageProducts /> : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events"
              element={session ? (canUseManagement ? <ManageArtist /> : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-team"
              element={session ? (isOwner && actorContext ? <ManageTeam actorContext={actorContext} /> : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId"
              element={session ? (canUseManagement ? <Navigate to="/manage-events" replace /> : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/workspace"
              element={session && actorContext && canUseQueueWorkspace ? <EventWorkspace actorContext={actorContext} /> : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/history"
              element={session ? (canUseManagement ? <OrderHistory /> : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/dashboard"
              element={session ? (canUseManagement ? <EventDashboard /> : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/preorder"
              element={session ? (canUseManagement ? <PreorderSettings /> : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/preorder-dashboard"
              element={session && actorContext ? (canSell ? <PreorderDashboard actorContext={actorContext} /> : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/pickup"
              element={session && actorContext && canUseQueueWorkspace ? <PreorderPickup actorContext={actorContext} /> : <Navigate to="/manage-login" replace />}
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

            <Route path="/:slug/order/:code" element={<OrderStatus />} />
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
