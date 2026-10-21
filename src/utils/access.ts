import { supabase } from '../supabaseClient';
import type { ActorContext, ActorRole, ActorWorkspace } from '../types/access';
import { getAuthUserSafe } from './auth';
import {
  getSelectedWorkspaceId,
  getWorkspaceGeneration,
  finishWorkspaceSwitch,
  setSelectedWorkspaceId,
} from './workspaceSession';

const withTimeout = async <T,>(promise: PromiseLike<T>, ms = 12000): Promise<T> => {
  const wrapped = Promise.resolve(promise);
  return await Promise.race([
    wrapped,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('Request timed out')), ms);
    }),
  ]);
};

export class WorkspaceSelectionRequiredError extends Error {
  constructor(public readonly workspaces: ActorWorkspace[], message = 'Choose a workspace to continue.') {
    super(message);
    this.name = 'WorkspaceSelectionRequiredError';
  }
}

export class WorkspaceRequestStaleError extends Error {
  constructor() {
    super('Workspace changed before this request completed.');
    this.name = 'WorkspaceRequestStaleError';
  }
}

const isActorRole = (value: unknown): value is ActorRole =>
  value === 'owner' || value === 'manager' || value === 'seller' || value === 'queue_staff';

export const listActorWorkspaces = async (): Promise<ActorWorkspace[]> => {
  const { data, error } = await withTimeout(supabase.rpc('list_actor_workspaces'), 8000);
  if (error) throw error;

  return ((data || []) as Record<string, unknown>[]).flatMap((row) => {
    if (typeof row.artist_id !== 'string' || !isActorRole(row.role)) return [];
    return [{
      artist_id: row.artist_id,
      artist_name: typeof row.artist_name === 'string' ? row.artist_name : 'Workspace',
      artist_slug: typeof row.artist_slug === 'string' ? row.artist_slug : '',
      role: row.role,
      is_owner: row.is_owner === true,
      member_email: typeof row.member_email === 'string' ? row.member_email : null,
    }];
  });
};

export const resolveActorWorkspace = async (artistId: string): Promise<ActorContext> => {
  const { data, error } = await withTimeout(supabase.rpc('resolve_actor_workspace', {
    p_artist_id: artistId,
  }), 8000);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.artist_id || !isActorRole(row.role)) throw new Error('Workspace access is no longer available.');
  return {
    artist_id: row.artist_id,
    role: row.role,
    is_owner: row.is_owner === true,
    member_email: typeof row.member_email === 'string' ? row.member_email : null,
  };
};

export const selectActorWorkspace = async (artistId: string): Promise<ActorContext> => {
  const user = await getAuthUserSafe();
  if (!user) throw new Error('Sign in again to choose a workspace.');
  const context = await resolveActorWorkspace(artistId);
  await finishWorkspaceSwitch(user.id, artistId);
  return context;
};

type CreatorSignupCompletionStatus = 'created' | 'exists' | 'not_pending' | 'email_unconfirmed' | 'error';

export const completePendingVerifiedCreatorSignup = async (): Promise<CreatorSignupCompletionStatus> => {
  try {
    const { data, error } = await withTimeout(supabase.rpc('complete_verified_creator_signup'), 8000);
    if (error) {
      console.error('[Access] complete_verified_creator_signup failed:', error);
      return 'error';
    }

    const status = typeof data === 'object' && data && 'status' in data
      ? String((data as { status?: unknown }).status)
      : 'not_pending';

    if (status === 'created' || status === 'exists' || status === 'not_pending' || status === 'email_unconfirmed') {
      return status;
    }

    return 'error';
  } catch (error) {
    console.error('[Access] complete_verified_creator_signup request failed:', error);
    return 'error';
  }
};

export const fetchActorContext = async (): Promise<ActorContext | null> => {
  const requestGeneration = getWorkspaceGeneration();
  const user = await getAuthUserSafe();
  if (!user) return null;
  const workspaces = await listActorWorkspaces();
  if (requestGeneration !== getWorkspaceGeneration()) throw new WorkspaceRequestStaleError();
  if (workspaces.length === 0) return null;

  const selectedId = getSelectedWorkspaceId(user.id);
  if (!selectedId) {
    if (workspaces.length > 1) throw new WorkspaceSelectionRequiredError(workspaces);
    const onlyWorkspace = workspaces[0];
    const context = await resolveActorWorkspace(onlyWorkspace.artist_id);
    if (requestGeneration !== getWorkspaceGeneration()) throw new WorkspaceRequestStaleError();
    setSelectedWorkspaceId(user.id, onlyWorkspace.artist_id);
    return context;
  }

  if (!workspaces.some((workspace) => workspace.artist_id === selectedId)) {
    throw new WorkspaceSelectionRequiredError(workspaces, 'Your previous workspace access changed. Choose another workspace.');
  }

  const context = await resolveActorWorkspace(selectedId);
  if (requestGeneration !== getWorkspaceGeneration()) throw new WorkspaceRequestStaleError();
  return context;
};
