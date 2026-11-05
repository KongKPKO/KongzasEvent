import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useI18n } from '../i18n';
import { applySeoDetails, getSeoDetails } from '../lib/seo';

export default function PageSeo() {
  const { pathname } = useLocation();
  const { language } = useI18n();
  useEffect(() => {
    const details = getSeoDetails(pathname, language, window.location.hostname);
    applySeoDetails(details);
    const schema = document.createElement('script');
    if (details.canonical === 'https://paimonq.com/') {
      schema.type = 'application/ld+json';
      schema.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Paimon', url: details.canonical });
      document.head.appendChild(schema);
    }
    return () => schema.remove();
  }, [pathname, language]);
  return null;
}
