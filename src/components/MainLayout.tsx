import React from 'react';
import { Link, useLocation, Outlet } from 'react-router-dom';

const MainLayout: React.FC = () => {
  const location = useLocation();

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  const NavLink = ({ to, icon, label }: { to: string; icon: string; label: string }) => {
    const active = isActive(to);
    return (
      <Link
        to={to}
        className={`flex flex-col items-center justify-center group transition-colors px-2 ${
          active
            ? 'text-primary dark:text-primary'
            : 'text-slate-400 dark:text-slate-500 hover:text-primary dark:hover:text-primary'
        }`}
      >
        <span className={`material-icons-round text-2xl mb-0.5 ${active ? '' : 'group-hover:scale-110 transition-transform'}`}>
            {icon}
        </span>
        <span className="text-xs font-medium">{label}</span>
      </Link>
    );
  };

  return (
    <div className="flex flex-col min-h-screen">
      {/* Top Desktop Navigation */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-surface-light/80 dark:bg-background-dark/80 border-b border-border-light dark:border-border-dark hidden md:block">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex-shrink-0 flex items-center">
              <Link to="/" className="text-primary font-bold text-xl tracking-tight">
                Kongzas
              </Link>
            </div>
            <div className="flex space-x-8 items-center ml-auto">
              <NavLink to="/" icon="home" label="Home" />
              <NavLink to="/menu" icon="coffee" label="Menu" />
              <NavLink to="/queue" icon="people" label="Queue" />
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-grow w-full">
        <Outlet />
      </main>

       {/* Safe padding for bottom nav on mobile */}
       <div className="pb-20 md:pb-0"></div>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 w-full bg-surface-light dark:bg-surface-dark border-t border-border-light dark:border-border-dark pb-safe z-50">
        <div className="grid grid-cols-3 h-16">
            <Link to="/" className={`flex flex-col items-center justify-center ${isActive('/') ? 'text-primary' : 'text-slate-400 dark:text-slate-500'}`}>
                <span className="material-icons-round">home</span>
                <span className="text-xs font-medium mt-1">Home</span>
            </Link>
             <Link to="/menu" className={`flex flex-col items-center justify-center ${isActive('/menu') ? 'text-primary' : 'text-slate-400 dark:text-slate-500'}`}>
                <span className="material-icons-round">coffee</span>
                <span className="text-xs font-medium mt-1">Menu</span>
            </Link>
             <Link to="/queue" className={`flex flex-col items-center justify-center ${isActive('/queue') ? 'text-primary' : 'text-slate-400 dark:text-slate-500'}`}>
                <span className="material-icons-round">people</span>
                <span className="text-xs font-medium mt-1">Queue</span>
            </Link>
        </div>
      </div>
    </div>
  );
};

export default MainLayout;
