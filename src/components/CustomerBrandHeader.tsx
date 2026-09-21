import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import { LanguageToggle, useI18n } from '../i18n';

export default function CustomerBrandHeader({ children }: { children?: ReactNode }) {
  const { language } = useI18n();
  return (
    <header className="customer-brand-header">
      <div className="customer-brand-inner">
        <Link to="/discover" className="customer-brand-logo" aria-label={language === 'th' ? 'NireQ — สำรวจร้านครีเอเตอร์' : 'NireQ — Discover creator shops'}>
          <span>Nire<span className="customer-brand-q">Q</span></span>
          <Star size={19} className="customer-brand-star" fill="currentColor" aria-hidden="true" />
        </Link>
        <div className="flex min-w-0 items-center gap-3">{children}<LanguageToggle className="min-h-11 min-w-11 px-3 py-2 text-sm" /></div>
      </div>
    </header>
  );
}
