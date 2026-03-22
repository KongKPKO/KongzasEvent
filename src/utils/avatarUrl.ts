import { supabase } from '../supabaseClient';

const localHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', 'host.docker.internal']);
const isPrivateIp = (host: string) =>
  /^10\./.test(host) ||
  /^192\.168\./.test(host) ||
  /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);

const rewriteUrlToCurrentHost = (rawUrl: string) => {
  if (!rawUrl || typeof window === 'undefined') return rawUrl;

  try {
    const url = new URL(rawUrl);
    const currentHost = window.location.hostname;
    const shouldRewrite =
      url.hostname === 'host.docker.internal' ||
      localHosts.has(url.hostname) ||
      isPrivateIp(url.hostname);

    if (shouldRewrite && currentHost && currentHost !== url.hostname) {
      url.hostname = currentHost;
      return url.toString();
    }
  } catch {
    return rawUrl;
  }

  return rawUrl;
};

export const resolveAvatarUrl = (value?: string | null) => {
  if (!value) return '';

  if (value.startsWith('blob:')) return value;

  if (value.startsWith('http://') || value.startsWith('https://')) {
    return rewriteUrlToCurrentHost(value);
  }

  const normalizedPath = value.replace(/^\/+/, '');
  const { data } = supabase.storage.from('Avatar').getPublicUrl(normalizedPath);
  return rewriteUrlToCurrentHost(data.publicUrl);
};
