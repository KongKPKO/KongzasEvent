import { Outlet, useParams, useLocation, Link } from 'react-router-dom';
import { Home, ShoppingBag, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useArtist } from '../../hooks/useArtist';
import CallingNotification from '../../components/CallingNotification';

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

            {/* ✅ แปะ component นี้ไว้ตรงไหนก็ได้ (เพราะมัน position fixed) */}
            {artist && (
               <CallingNotification
                  artistId={artist.id}
                  slug={artist.slug}
                  broadcastMessage={artist.broadcast_message}
               />
            )}

            <AnimatePresence mode="wait">
               <motion.div
                  key={location.pathname}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
               >
                  <Outlet context={{ artist }} />
               </motion.div>
            </AnimatePresence>

            {/* Bottom Nav for Mobile */}
            <nav className="fixed bottom-0 w-full max-w-md bg-white/90 backdrop-blur-md border-t border-gray-100 flex justify-around items-end pb-6 h-20 z-50 text-[11px] font-bold tracking-tight" aria-label="Main navigation">
               <motion.div whileTap={{ scale: 0.9 }}>
                  <Link
                     to={`/${slug}/home`}
                     className={`flex flex-col items-center gap-1 transition-colors ${location.pathname.endsWith('/home') ? 'text-[#d63384]' : 'text-slate-600'}`}
                     aria-label="Home"
                  >
                     <Home size={22} strokeWidth={location.pathname.endsWith('/home') ? 2.5 : 2} aria-hidden="true" />
                     Home
                  </Link>
               </motion.div>

               <motion.div whileTap={{ scale: 0.9 }}>
                  <Link
                     to={`/${slug}/menu`}
                     className={`flex flex-col items-center gap-1 transition-colors ${location.pathname.endsWith('/menu') ? 'text-[#d63384]' : 'text-slate-600'}`}
                     aria-label="Merchandise"
                  >
                     <ShoppingBag size={22} strokeWidth={location.pathname.endsWith('/menu') ? 2.5 : 2} aria-hidden="true" />
                     Merchandise
                  </Link>
               </motion.div>

               <motion.div whileTap={{ scale: 0.9 }}>
                  <Link
                     to={`/${slug}/queue`}
                     className={`flex flex-col items-center gap-1 transition-colors ${location.pathname.endsWith('/queue') ? 'text-[#d63384]' : 'text-slate-600'}`}
                     aria-label="Queue"
                  >
                     <Users size={22} strokeWidth={location.pathname.endsWith('/queue') ? 2.5 : 2} aria-hidden="true" />
                     Queue
                  </Link>
               </motion.div>
            </nav>
         </div>
      </div>
   );
};

export default CustomerLayout;
