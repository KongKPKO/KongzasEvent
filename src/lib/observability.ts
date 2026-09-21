export type ReplayConsent = 'accepted' | 'rejected';
export const REPLAY_CONSENT_KEY = 'nireq-replay-consent-v1';
export const REPLAY_CONSENT_EVENT = 'nireq-replay-consent-change';

let loading = false;
let initialized = false;
let allowed = false;

export const getReplayConsent = (): ReplayConsent | null => {
  try {
    const value = window.localStorage.getItem(REPLAY_CONSENT_KEY);
    return value === 'accepted' || value === 'rejected' ? value : null;
  } catch {
    return null;
  }
};

export const setReplayConsent = (consent: ReplayConsent) => {
  // Persist before starting recording; unavailable storage must fail closed.
  window.localStorage.setItem(REPLAY_CONSENT_KEY, consent);
  allowed = consent === 'accepted';
  window.dispatchEvent(new Event(REPLAY_CONSENT_EVENT));
  if (!allowed && initialized) {
    // The installed SDK has no supported stop API. Reload unloads its recorder.
    window.location.reload();
  } else if (allowed) {
    initObservability();
  }
};

export const initObservability = () => {
  const appId = import.meta.env.VITE_LOGROCKET_APP_ID;
  if (!appId || import.meta.env.VITE_LOGROCKET_DISABLED === 'true' ||
      typeof window === 'undefined' || initialized || loading || getReplayConsent() !== 'accepted') return;
  allowed = true;
  loading = true;
  void import('logrocket').then(({ default: client }) => {
    if (!allowed || getReplayConsent() !== 'accepted') return;
    const options = {
      release: import.meta.env.VITE_RELEASE_SHA || import.meta.env.VITE_APP_VERSION,
      shouldCaptureIP: false,
      forceCleanStart: true,
      shouldDetectExceptions: false,
      shouldSendData: () => allowed && getReplayConsent() === 'accepted',
      console: { isEnabled: false, shouldAggregateConsoleErrors: false },
      network: { requestSanitizer: () => null, responseSanitizer: () => null },
      browser: { urlSanitizer: () => window.location.origin + '/[private]' },
      dom: {
        imageSanitizer: true,
        inputSanitizer: true,
        textSanitizer: true,
        disablePageTitles: true,
        // Protect evidence, customer content and URL-bearing attributes by default.
        privateAttributeBlocklist: ['data-private', 'data-sensitive'],
        privateClassNameBlocklist: ['lr-private', 'private', 'sensitive'],
        hiddenAttributes: ['href', 'src', 'srcset', 'style', 'value', 'title', 'alt', 'id', 'data-testid'],
      },
    };
    client.init(appId, options);
    initialized = true;
  }).catch(() => {
    console.warn('[Observability] Session replay could not start.');
  }).finally(() => { loading = false; });
};

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== REPLAY_CONSENT_KEY && event.key !== null) return;
    allowed = getReplayConsent() === 'accepted';
    window.dispatchEvent(new Event(REPLAY_CONSENT_EVENT));
    if (!allowed && initialized) window.location.reload();
    else if (allowed) initObservability();
  });
}
