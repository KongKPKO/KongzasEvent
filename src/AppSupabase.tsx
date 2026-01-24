import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
// import SupabaseLogin from './pages/SupabaseLogin'; // Removed unused
import SupabaseDashboard from './pages/creators/SupabaseDashboard';
import { Navigate } from 'react-router-dom';
import './index.css'; 

/**
 * AppSupabase
 */
function AppSupabase() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      // @ts-ignore
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // @ts-ignore
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (!session) {
    return <Navigate to="/manage-login" replace />;
  } else {
    // The Dashboard now includes the Header/Nav self-contained as per request "App.jsx and... css"
    return <SupabaseDashboard />;
  }
}

export default AppSupabase;
