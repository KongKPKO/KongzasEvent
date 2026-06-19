import type { Session } from '@supabase/supabase-js';
import type { ActorContext } from '../types/access';

type LogRocketClient = {
  init: (appId: string, options?: Record<string, unknown>) => void;
  identify: (userId: string, traits?: Record<string, string | boolean>) => void;
  startNewSession: () => void;
  debug: (message: string, extra?: Record<string, unknown>) => void;
  info: (message: string, extra?: Record<string, unknown>) => void;
  warn: (message: string, extra?: Record<string, unknown>) => void;
  error: (message: string, extra?: Record<string, unknown>) => void;
};

const SENSITIVE_HEADERS = new Set([
  'apikey',
  'authorization',
  'cookie',
  'set-cookie',
  'x-client-info',
  'x-supabase-api-version',
]);

const SENSITIVE_QUERY_PARAMS = [
  'access_token',
  'refresh_token',
  'token',
  'code',
  'apikey',
  'password',
];

let initialized = false;
let identifiedUserId: string | null = null;
let logRocket: LogRocketClient | null = null;
let pendingIdentity: { session: Session; actorContext: ActorContext | null } | null = null;

const sanitizeUrl = (rawUrl?: string | null) => {
  if (!rawUrl) return rawUrl || '';
  try {
    const url = new URL(rawUrl, window.location.origin);
    SENSITIVE_QUERY_PARAMS.forEach((param) => {
      if (url.searchParams.has(param)) url.searchParams.set(param, '[redacted]');
    });
    return url.toString();
  } catch {
    return rawUrl;
  }
};

const sanitizeHeaders = (headers: Record<string, string | null | undefined>) => {
  const next: Record<string, string | null | undefined> = {};
  Object.entries(headers || {}).forEach(([key, value]) => {
    next[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '[redacted]' : value;
  });
  return next;
};

export const initObservability = () => {
  const appId = import.meta.env.VITE_LOGROCKET_APP_ID;
  const disabled = import.meta.env.VITE_LOGROCKET_DISABLED === 'true';

  if (!appId || disabled || initialized || typeof window === 'undefined') return;

  void import('logrocket').then((module) => {
    const client = (module.default || module) as LogRocketClient;
    client.init(appId, {
      release: import.meta.env.VITE_RELEASE_SHA || import.meta.env.VITE_APP_VERSION,
      shouldCaptureIP: false,
      dom: {
        inputSanitizer: true,
        hiddenAttributes: ['data-private', 'data-sensitive'],
        privateAttributeBlocklist: ['data-private', 'data-sensitive'],
        privateClassNameBlocklist: ['lr-private', 'private', 'sensitive'],
      },
      network: {
        requestSanitizer: (request: {
          url: string;
          headers: Record<string, string | null | undefined>;
        }) => ({
          ...request,
          url: sanitizeUrl(request.url),
          headers: sanitizeHeaders(request.headers),
          body: null,
        }),
        responseSanitizer: (response: {
          url?: string;
          headers: Record<string, string | null | undefined>;
        }) => ({
          ...response,
          url: sanitizeUrl(response.url),
          headers: sanitizeHeaders(response.headers),
          body: null,
        }),
      },
      browser: {
        urlSanitizer: sanitizeUrl,
      },
    });

    logRocket = client;
    initialized = true;
    if (pendingIdentity) {
      identifyObservabilityUser(pendingIdentity.session, pendingIdentity.actorContext);
      pendingIdentity = null;
    }
  }).catch((error) => {
    console.warn('[Observability] LogRocket failed to load:', error);
  });
};

export const identifyObservabilityUser = (session: Session | null, actorContext: ActorContext | null) => {
  if (!session?.user?.id) return;
  if (!initialized || !logRocket) {
    pendingIdentity = { session, actorContext };
    return;
  }

  const nextUserId = session.user.id;
  const traits: Record<string, string | boolean> = {
    authProvider: session.user.app_metadata?.provider || 'unknown',
  };

  if (actorContext?.role) traits.role = actorContext.role;
  if (actorContext?.artist_id) traits.artistId = actorContext.artist_id;
  if (actorContext?.is_owner) traits.owner = true;

  if (import.meta.env.VITE_LOGROCKET_CAPTURE_EMAIL === 'true' && session.user.email) {
    traits.email = session.user.email;
  }

  logRocket.identify(nextUserId, traits);
  identifiedUserId = nextUserId;
};

export const clearObservabilityUser = () => {
  if (!initialized || !logRocket || !identifiedUserId) return;
  logRocket.startNewSession();
  identifiedUserId = null;
};

export const captureObservabilityMessage = (
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  extra?: Record<string, unknown>
) => {
  if (!initialized || !logRocket) return;
  logRocket[level](message, extra || {});
};
