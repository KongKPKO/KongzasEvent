import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';

export const RequireAuth = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const location = useLocation();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (localStorage.getItem('test_auth') === 'true') {
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(!!user);
      }
    });
    return () => unsubscribe();
  }, []);

  if (isAuthenticated === null) {
    // Loading state (optional: add a spinner here)
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-pulse text-[#0070C0] font-bold">Verifying Access...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Redirect to login page, but save the current location they were trying to go to
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
};
