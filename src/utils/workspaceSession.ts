import { supabase } from '../supabaseClient';
import { clearObservabilityUser } from '../lib/observability';

const WORKSPACE_KEY_PREFIX = 'nireq:active-workspace:';
const OPERATIONAL_EXACT_KEYS = new Set([
  'dismissed_invitations',
  'forceEventGrid',
  'posPinnedProducts',
  'queue_timer_end',
]);
// Payment attempt IDs are scoped to the event/cart and must survive an uncertain
// payment result. Clearing them could turn a safe retry into another charge.
const OPERATIONAL_KEY_PREFIXES = ['posSelectedEventId:'];

let workspaceGeneration = 0;

const storageKey = (userId: string) => `${WORKSPACE_KEY_PREFIX}${userId}`;

const safeStorage = (kind: 'local' | 'session'): Storage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
};

const removeOperationalKeys = (storage: Storage | null) => {
  if (!storage) return;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && (OPERATIONAL_EXACT_KEYS.has(key) || OPERATIONAL_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)))) {
      keys.push(key);
    }
  }
  keys.forEach((key) => storage.removeItem(key));
};

export const getWorkspaceGeneration = () => workspaceGeneration;

export const invalidateWorkspaceRequests = () => {
  workspaceGeneration += 1;
};

export const getSelectedWorkspaceId = (userId: string): string | null => {
  try {
    return safeStorage('local')?.getItem(storageKey(userId)) || null;
  } catch {
    return null;
  }
};

export const setSelectedWorkspaceId = (userId: string, artistId: string) => {
  const storage = safeStorage('local');
  if (!storage) throw new Error('Workspace selection cannot be saved in this browser.');
  storage.setItem(storageKey(userId), artistId);
};

export const clearSelectedWorkspaceId = (userId?: string | null) => {
  const storage = safeStorage('local');
  if (!storage) return;
  if (userId) {
    storage.removeItem(storageKey(userId));
    return;
  }
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(WORKSPACE_KEY_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
};

export const clearOperationalWorkspaceState = async () => {
  invalidateWorkspaceRequests();
  removeOperationalKeys(safeStorage('local'));
  removeOperationalKeys(safeStorage('session'));
  await supabase.removeAllChannels();
};

export const finishWorkspaceSwitch = async (userId: string, artistId: string) => {
  await clearOperationalWorkspaceState();
  setSelectedWorkspaceId(userId, artistId);
};

export const signOutLocally = async (userId?: string | null) => {
  let signOutError: Error | null = null;
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) signOutError = error;
  } catch (error) {
    signOutError = error instanceof Error ? error : new Error('Could not sign out.');
  } finally {
    await clearOperationalWorkspaceState();
    clearObservabilityUser();
  }

  if (signOutError) throw new Error('Could not sign out. Please try again.');
  clearSelectedWorkspaceId(userId);
};

export const getDefaultWorkspacePath = (role: string) => {
  if (role === 'owner' || role === 'manager') return '/manage-events';
  if (role === 'seller') return '/live/pos';
  return '/live/queue';
};
