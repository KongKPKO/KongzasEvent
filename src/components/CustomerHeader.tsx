import { ReactNode } from 'react';
import { User } from 'lucide-react';

interface CustomerHeaderProps {
  artistId: string;
  title: string;
  avatarUrl?: string; // New prop for avatar
  avatarDisplay?: 'stacked' | 'inline'; // New prop for layout
  children?: ReactNode; // For Bio, Status Badge, or Subtitle
  className?: string; // For additional styling if needed
}

const CustomerHeader = ({ title, avatarUrl, avatarDisplay, children, className = "", transparent = false }: CustomerHeaderProps & { transparent?: boolean }) => {
  return (
    <div className={`sticky top-0 z-30 transition-all ${transparent ? '' : 'bg-white/95 backdrop-blur-sm shadow-sm'} ${className}`}>
      {/* Added pt-8 for "Move Down" fix (12-16px more breathing room), pb-3 for spacing */}
      <div className="pt-8 pb-3 px-6 text-center w-full max-w-md mx-auto">
         
         {/* Avatar rendering: STACKED */}
         {avatarDisplay === 'stacked' && (
            <div className="flex justify-center mb-3">
               {avatarUrl ? (
                  <img 
                     src={avatarUrl} 
                     alt={title} 
                     className="w-32 h-32 rounded-full object-cover border-4 border-white shadow-md bg-gray-100"
                  />
               ) : (
                  <div className="w-32 h-32 rounded-full bg-pink-100 flex items-center justify-center border-4 border-white shadow-md">
                     <span className="text-5xl font-black text-pink-500">{title.charAt(0)}</span>
                  </div>
               )}
            </div>
         )}

         {/* Standardized Title: Pink, Black Font, Centered, Hight-aligned */}
         <div className="flex items-center justify-center gap-3 mb-1">
             {/* Avatar rendering: INLINE */}
             {avatarDisplay === 'inline' && (
                avatarUrl ? (
                   <img 
                     src={avatarUrl} 
                     alt={title} 
                     className="w-10 h-10 rounded-full object-cover border-2 border-white shadow-sm bg-gray-100 shrink-0"
                   />
                ) : (
                   <div className="w-10 h-10 rounded-full bg-pink-100 flex items-center justify-center border-2 border-white shadow-sm shrink-0">
                      {title ? <span className="text-base font-bold text-pink-500">{title.charAt(0)}</span> : <User size={20} className="text-pink-400" />}
                   </div>
                )
             )}
            
             <h1 className="text-2xl font-black text-[#ff4d94] tracking-tight drop-shadow-sm leading-none">
                {title}
             </h1>
         </div>

         {/* Sub-content (Bio, Badges, etc) */}
         {children && (
            <div className="mt-1">
               {children}
            </div>
         )}
      </div>
    </div>
  );
};

export default CustomerHeader;
