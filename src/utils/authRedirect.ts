export const getAuthRedirectError = () => {
  if (typeof window === 'undefined') return null;

  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const raw = query.get('error_description')
    || hash.get('error_description')
    || query.get('error')
    || hash.get('error');

  return raw ? raw.replace(/\+/g, ' ') : null;
};
