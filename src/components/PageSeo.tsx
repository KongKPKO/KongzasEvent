import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useI18n } from '../i18n';
import { applySeoDetails, getSeoDetails } from '../lib/seo';

export default function PageSeo() {
  const { pathname } = useLocation();
  const { language } = useI18n();
  useEffect(() => { applySeoDetails(getSeoDetails(pathname, language, window.location.hostname)); }, [pathname, language]);
  return null;
}
