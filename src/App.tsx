import { Suspense, lazy, useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { fetchActorContext } from './utils/access';
import type { ActorContext } from './types/access';
import { canAccessOwnerPages, canAccessQueuePages } from './types/access';

import CustomerLayout from './pages/customer/CustomerLayout';
import CustomerHome from './pages/customer/Home';
const MenuView = lazy(() => import('./pages/customer/MenuView'));
import QueueView from './pages/customer/QueueView';

const ManageProducts = lazy(() => import('./pages/creators/ManageProducts'));
const ManageArtist = lazy(() => import('./pages/creators/ManageArtist'));
const ManageTeam = lazy(() => import('./pages/creators/ManageTeam'));
const OrderHistory = lazy(() => import('./pages/creators/OrderHistory'));
const ManageCombined = lazy(() => import('./pages/ManageCombined'));

import ManageLogin from './pages/ManageLogin';

function App() {
  const [session, setSession] = useState<any>(null);
  const [actorContext, setActorContext] = useState<ActorContext | null>(null);
  const [loading, setLoading] = useState(true);

  const syncSessionContext = async (nextSession: any) => {
    try {
      setSession(nextSession);

      if (!nextSession) {
        setActorContext(null);
        return;
      }

      const ctx = await fetchActorContext();
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
      void syncSessionContext(nextSession);

      if (event === 'PASSWORD_RECOVERY') {
        void (async () => {
          const newPassword = window.prompt('Security Alert: Please set your new password immediately.');

          if (newPassword && newPassword.trim().length > 0) {
            try {
              const { error } = await supabase.auth.updateUser({ password: newPassword });
              if (error) throw error;

              alert('Success! Your password has been changed.');
              window.location.href = '/';
            } catch (error: any) {
              alert('Error changing password: ' + error.message);
            }
          } else {
            alert('Password change cancelled. Please try reset again when ready.');
            await supabase.auth.signOut();
          }
        })();
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const isOwner = canAccessOwnerPages(actorContext?.role);
  const canUseQueueWorkspace = canAccessQueuePages(actorContext?.role);

  const getDefaultPath = () => {
    if (!session) return '/manage-login';
    if (isOwner) return '/manage-events';
    if (canUseQueueWorkspace) return '/manage-pos-queues';
    return '/manage-login';
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>;
  }

  if (session && !actorContext) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-md text-center">
          <h1 className="text-lg font-bold text-gray-800 mb-2">Workspace Not Assigned</h1>
          <p className="text-sm text-gray-600 mb-4">This account is signed in but has no artist workspace role.</p>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = '/manage-login';
            }}
            className="px-4 py-2 rounded-lg bg-pink-600 text-white text-sm font-bold hover:bg-pink-700"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="app-container">
        <Suspense fallback={<div className="flex justify-center items-center h-screen">Loading application...</div>}>
          <Routes>
            <Route path="/manage-login" element={<ManageLogin />} />

            <Route
              path="/manage-products"
              element={session ? (isOwner ? <ManageProducts /> : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events"
              element={session ? (isOwner ? <ManageArtist /> : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-team"
              element={session ? (isOwner && actorContext ? <ManageTeam actorContext={actorContext} /> : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-events/:eventId/history"
              element={session ? (isOwner ? <OrderHistory /> : <Navigate to="/manage-pos-queues" replace />) : <Navigate to="/manage-login" replace />}
            />
            <Route
              path="/manage-pos-queues"
              element={session && actorContext && canUseQueueWorkspace ? <ManageCombined actorContext={actorContext} /> : <Navigate to="/manage-login" replace />}
            />

            <Route path="/" element={<Navigate to={getDefaultPath()} replace />} />

            <Route path="/:slug" element={<CustomerLayout />}>
              <Route path="home" element={<CustomerHome />} />
              <Route path="menu" element={<MenuView />} />
              <Route path="queue" element={<QueueView />} />
              <Route index element={<CustomerHome />} />
            </Route>
          </Routes>
        </Suspense>
      </div>
    </Router>
  );
}

export default App;
