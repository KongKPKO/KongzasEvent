export type ActorRole = 'owner' | 'manager' | 'seller' | 'queue_staff';

export interface ActorContext {
  artist_id: string;
  role: ActorRole;
  is_owner: boolean;
  member_email: string | null;
}

export const OWNER_ONLY_ROLES: ActorRole[] = ['owner'];
export const MANAGEMENT_ROLES: ActorRole[] = ['owner', 'manager'];
export const QUEUE_ROLES: ActorRole[] = ['owner', 'manager', 'seller', 'queue_staff'];
export const POS_ROLES: ActorRole[] = ['owner', 'manager', 'seller'];

export const canAccessOwnerPages = (role?: ActorRole | null) => role === 'owner';
export const canAccessManagementPages = (role?: ActorRole | null) => !!role && MANAGEMENT_ROLES.includes(role);
export const canAccessQueuePages = (role?: ActorRole | null) => !!role && QUEUE_ROLES.includes(role);
export const canUsePos = (role?: ActorRole | null) => !!role && POS_ROLES.includes(role);
