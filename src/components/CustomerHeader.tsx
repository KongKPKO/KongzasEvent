import { ReactNode } from 'react';
import StickyBanner from './StickyBanner';

interface CustomerHeaderProps {
  artistId: string;
  title: string;
  children?: ReactNode; // For Bio, Status Badge, or Subtitle
  className?: string; // For additional styling if needed
}

const CustomerHeader = ({ artistId, title, children, className = "", transparent = false }: CustomerHeaderProps & { transparent?: boolean }) => {
  return (
    <div className={`sticky top-0 z-30 transition-all ${transparent ? '' : 'bg-white/95 backdrop-blur-sm shadow-sm'} ${className}`}>
      <StickyBanner artistId={artistId} />
      {/* Added pt-8 for "Move Down" fix (12-16px more breathing room), pb-3 for spacing */}
      <div className="pt-8 pb-3 px-6 text-center w-full max-w-md mx-auto">
         {/* Standardized Title: Pink, Black Font, Centered, Hight-aligned */}
         <h1 className="text-2xl font-black text-[#ff4d94] mb-1 tracking-tight drop-shadow-sm flex items-center justify-center leading-none">
            {title}
         </h1>
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
