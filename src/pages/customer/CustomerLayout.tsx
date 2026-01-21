import { Outlet, useParams } from 'react-router-dom';
import { useArtist } from '../../hooks/useArtist';

const CustomerLayout = () => {
  const { slug } = useParams<{ slug: string }>();
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
          <nav className="fixed bottom-0 w-full max-w-md bg-white border-t border-gray-100 flex justify-around items-center py-3 z-50 text-xs font-medium text-gray-400">
             <a href={`/${slug}/home`} className="flex flex-col items-center gap-1 hover:text-pink-500 transition-colors">
                <span className="material-icons-outlined text-xl">home</span>
                Home
             </a>
             <a href={`/${slug}/menu`} className="flex flex-col items-center gap-1 hover:text-pink-500 transition-colors">
                 <span className="material-icons-outlined text-xl">restaurant_menu</span>
                Menu
             </a>
             <a href={`/${slug}/queue`} className="flex flex-col items-center gap-1 text-pink-500 transition-colors">
                 <div className="w-10 h-10 bg-pink-500 rounded-full flex items-center justify-center -mt-6 shadow-lg border-4 border-white text-white">
                    <span className="material-icons-outlined text-xl">confirmation_number</span>
                 </div>
                 Queue
             </a>
          </nav>
       </div>
    </div>
  );
};

export default CustomerLayout;
