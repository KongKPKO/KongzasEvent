export type ActorRole = 'owner' | 'queue_only' | 'queue_pos';

export interface ActorContext {
  artist_id: string;
  role: ActorRole;
  is_owner: boolean;
  member_email: string | null;
}

export const OWNER_ONLY_ROLES: ActorRole[] = ['owner'];
export const QUEUE_ROLES: ActorRole[] = ['owner', 'queue_only', 'queue_pos'];
export const POS_ROLES: ActorRole[] = ['owner', 'queue_pos'];

export const canAccessOwnerPages = (role?: ActorRole | null) => role === 'owner';
export const canAccessQueuePages = (role?: ActorRole | null) => !!role && QUEUE_ROLES.includes(role);
export const canUsePos = (role?: ActorRole | null) => !!role && POS_ROLES.includes(role);
