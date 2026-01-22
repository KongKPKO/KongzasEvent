import { Outlet, useParams, useLocation, Link } from 'react-router-dom';
import { Home, ShoppingBag, Users } from 'lucide-react';
import { useArtist } from '../../hooks/useArtist';

const CustomerLayout = () => {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const { artist, loading, error } = useArtist(slug);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-pink-500 font-bold">Loading...</div>;
  if (error || !artist) return (
     <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-gray-50">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Artist Not Found</h1>
        <p className="text-gray-500">The URL you entered might be incorrect.</p>
     </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-20 md:pb-0 font-sans">
       {/* Mobile-first wrapper */}
       <div className="max-w-md mx-auto min-h-screen bg-white shadow-xl overflow-hidden relative">
          <Outlet context={{ artist }} />
          
          {/* Bottom Nav for Mobile */}
          {/* Bottom Nav for Mobile */}
          {/* Bottom Nav for Mobile */}
          <nav className="fixed bottom-0 w-full max-w-md bg-white border-t border-gray-100 flex justify-around items-end pb-6 h-20 z-50 text-[11px] font-bold tracking-tight">
             <Link 
               to={`/${slug}/home`} 
               className={`flex flex-col items-center gap-1 transition-colors ${location.pathname.endsWith('/home') ? 'text-[#ff4d94]' : 'text-slate-400'}`}
             >
                <Home size={22} strokeWidth={location.pathname.endsWith('/home') ? 2.5 : 2} />
                Home
             </Link>
             <Link 
               to={`/${slug}/menu`} 
               className={`flex flex-col items-center gap-1 transition-colors ${location.pathname.endsWith('/menu') ? 'text-[#ff4d94]' : 'text-slate-400'}`}
             >
                <ShoppingBag size={22} strokeWidth={location.pathname.endsWith('/menu') ? 2.5 : 2} />
                Merchandise
             </Link>
             <Link 
               to={`/${slug}/queue`} 
               className={`flex flex-col items-center gap-1 transition-colors ${location.pathname.endsWith('/queue') ? 'text-[#ff4d94]' : 'text-slate-400'}`}
             >
                <Users size={22} strokeWidth={location.pathname.endsWith('/queue') ? 2.5 : 2} />
                Queue
             </Link>
          </nav>
       </div>
    </div>
  );
};

export default CustomerLayout;
