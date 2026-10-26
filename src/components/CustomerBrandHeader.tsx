import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LanguageToggle, useI18n } from '../i18n';
import { BrandWordmark } from './BrandMark';

export default function CustomerBrandHeader({ children }: { children?: ReactNode }) {
  const { language } = useI18n();
  return (
    <header className="customer-brand-header">
      <div className="customer-brand-inner">
        <Link to="/discover" className="customer-brand-logo" aria-label={language === 'th' ? 'Paimon — สำรวจร้านค้า' : 'Paimon — Discover shops'}>
          <BrandWordmark className="customer-brand-wordmark" size={19} />
        </Link>
        <div className="flex min-w-0 items-center gap-3">{children}<LanguageToggle className="customer-brand-language shrink-0" /></div>
      </div>
    </header>
  );
}
