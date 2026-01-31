import { Suspense, lazy, useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './supabaseClient';

// Customer Pages (Keep these eager or lazy? Request implies focusing on "heavy" pages, usually Admin)
// But to separate bundles effectively, lazy loading everything is often best practice or at least the heavy customer ones.
// The prompt says: "Identify heavy 'backend' or admin-facing routes... Change the static imports for these pages to use React.lazy()"
// Let's lazy load the heavy Admin pages first as requested.

import CustomerLayout from './pages/customer/CustomerLayout';
import CustomerHome from './pages/customer/Home';
const MenuView = lazy(() => import('./pages/customer/MenuView'));
import QueueView from './pages/customer/QueueView';

// Creator Pages - Lazy Load
const ManageProducts = lazy(() => import('./pages/creators/ManageProducts'));
const ManageArtist = lazy(() => import('./pages/creators/ManageArtist'));
const OrderHistory = lazy(() => import('./pages/creators/OrderHistory'));
const ManageCombined = lazy(() => import('./pages/ManageCombined'));

// Auth & Layout
import ManageLogin from './pages/ManageLogin';

function App() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);

      if (event === "PASSWORD_RECOVERY") {
        console.log("Recovery session detected. Prompting for new password.");

        // Use native prompt for a quick fix UI
        const newPassword = window.prompt("Security Alert: Please set your new password immediately.");

        if (newPassword && newPassword.trim().length > 0) {
            try {
              const { error } = await supabase.auth.updateUser({ password: newPassword });
              if (error) throw error;

              alert("Success! Your password has been changed. You are now logged in.");
              window.location.href = "/"; // Ensure they are on a safe page

            } catch (error: any) {
              alert("Error changing password: " + error.message);
              // Optional: sign them out if it failed for security
              // supabase.auth.signOut();
            }
        } else {
           // Handle case where user cancelled prompt
           alert("Password change cancelled. For security, please try the reset link again when ready.");
           await supabase.auth.signOut();
        }
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>; 
  }

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="app-container">
        <Suspense fallback={<div className="flex justify-center items-center h-screen">Loading application...</div>}>
        <Routes>
          {/* Login Page */}
          <Route path="/manage-login" element={<ManageLogin />} />
          
          {/* Creator Dashboard Routes (Protected) */}
          <Route 
            path="/manage-products" 
            element={session ? <ManageProducts /> : <Navigate to="/manage-login" replace />} 
          />
          <Route 
            path="/manage-events" 
            element={session ? <ManageArtist /> : <Navigate to="/manage-login" replace />} 
          />
          <Route 
            path="/manage-events/:eventId/history" 
            element={session ? <OrderHistory /> : <Navigate to="/manage-login" replace />} 
          />
          <Route 
            path="/manage-pos-queues" 
            element={session ? <ManageCombined /> : <Navigate to="/manage-login" replace />} 
          />
      
          {/* Root Redirect */}
          <Route path="/" element={<Navigate to="/manage-login" replace />} />

          {/* Customer Facing App */}
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