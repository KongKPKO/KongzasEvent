import { supabase } from '../supabaseClient';

export const PLATFORM_ADMIN_PAGE_SIZE = 20;

export type PlatformAdminAction =
  | 'overview'
  | 'users'
  | 'user'
  | 'creators'
  | 'creator'
  | 'events'
  | 'event'
  | 'campaigns'
  | 'campaign'
  | 'operations_orders'
  | 'operations_queue'
  | 'audit';

export type AdminStatus = string | null;

export type PlatformAdminEnvelope<T> = {
  ok: true;
  action: PlatformAdminAction;
  page?: number;
  page_size?: number;
  total?: number;
  items?: T[];
  detail?: T;
  counts?: PlatformAdminOverviewCounts;
  recent_audit?: PlatformAdminAuditItem[];
  generated_at: string;
};

export type PlatformAdminOverviewCounts = {
  users: number;
  creators: number;
  events: number;
  campaigns: number;
  active_events: number;
  active_campaigns: number;
  open_orders: number;
  active_queue_entries: number;
  pending_applications: number;
  open_feedback: number;
};

export type PlatformAdminUser = {
  id: string;
  email_masked: string | null;
  display_name: string | null;
  status: 'active' | 'suspended';
  suspended: boolean;
  suspended_reason: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  membership_count: number;
  creator_count: number;
  is_platform_admin: boolean;
};

export type PlatformAdminMembership = {
  store_id: string;
  store_name: string;
  role: string;
  status: string | null;
  created_at: string;
};

export type PlatformAdminUserDetail = PlatformAdminUser & {
  memberships: PlatformAdminMembership[];
};

export type PlatformAdminCreator = {
  id: string;
  display_name: string;
  slug: string;
  owner_email_masked: string | null;
  status: AdminStatus;
  created_at: string;
  event_count: number;
  campaign_count: number;
};

export type PlatformAdminCreatorDetail = PlatformAdminCreator & {
  memberships: PlatformAdminMembership[];
};

export type PlatformAdminEvent = {
  id: string;
  event_name: string;
  store_id: string;
  store_name: string;
  start_at: string | null;
  end_at: string | null;
  status: AdminStatus;
  is_booth_open: boolean;
  hidden: boolean;
  moderation_reason: string | null;
  queue_count: number;
  order_count: number;
};

export type PlatformAdminCampaign = {
  id: string;
  name: string;
  slug: string;
  store_id: string;
  store_name: string;
  status: AdminStatus;
  starts_at: string | null;
  ends_at: string | null;
  hidden: boolean;
  moderation_reason: string | null;
  order_count: number;
};

export type PlatformAdminOrder = {
  id: string;
  code: string | null;
  store_name: string;
  channel_name: string | null;
  order_type: string;
  status: AdminStatus;
  payment_status: AdminStatus;
  fulfillment_status: AdminStatus;
  created_at: string;
};

export type PlatformAdminQueueEntry = {
  id: string;
  event_id: string;
  event_name: string;
  store_name: string;
  queue_number: string | number | null;
  status: AdminStatus;
  customer_name_masked: string | null;
  joined_at: string;
  called_at: string | null;
};

export type PlatformAdminAuditItem = {
  id: string;
  actor_email_masked: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  summary: string | null;
  created_at: string;
};

type PlatformAdminRequest = {
  query?: string;
  target?: string;
  page?: number;
  filter?: string;
};

export class PlatformAdminResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformAdminResponseError';
  }
}

export async function fetchPlatformAdmin<T>(
  action: PlatformAdminAction,
  request: PlatformAdminRequest = {},
): Promise<PlatformAdminEnvelope<T>> {
  const { data, error } = await supabase.rpc('platform_admin_console', {
    p_action: action,
    p_query: request.query?.trim() || null,
    p_target: request.target || null,
    p_page: request.page || 1,
    p_filter: request.filter || null,
  });

  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new PlatformAdminResponseError('The admin console returned an invalid response.');
  }

  const envelope = data as Partial<PlatformAdminEnvelope<T>>;
  if (envelope.ok !== true || envelope.action !== action || typeof envelope.generated_at !== 'string') {
    throw new PlatformAdminResponseError('The admin console returned an unexpected response.');
  }

  const invalid = () => { throw new PlatformAdminResponseError('The admin console returned incomplete data.'); };
  if (action === 'overview') {
    const keys: Array<keyof PlatformAdminOverviewCounts> = ['users', 'creators', 'events', 'campaigns', 'active_events', 'active_campaigns', 'open_orders', 'active_queue_entries', 'pending_applications', 'open_feedback'];
    if (!envelope.counts || keys.some(key => !Number.isFinite(envelope.counts?.[key]))) invalid();
  } else if (['user', 'creator', 'event', 'campaign'].includes(action)) {
    if (!envelope.detail || typeof envelope.detail !== 'object' || Array.isArray(envelope.detail)) invalid();
  } else if (!Array.isArray(envelope.items) || !Number.isInteger(envelope.total) || (envelope.total ?? -1) < 0 || envelope.page_size !== PLATFORM_ADMIN_PAGE_SIZE) {
    invalid();
  }

  return envelope as PlatformAdminEnvelope<T>;
}

export async function changePlatformAdmin(userId: string, grant: boolean, reason: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('change_platform_admin', {
    p_user_id: userId,
    p_grant: grant,
    p_reason: reason.trim(),
  });
  if (error) throw error;
  if (data !== true) throw new PlatformAdminResponseError('The administrator change was not confirmed.');
  return true;
}

export async function setAccountManagementSuspension(
  userId: string,
  suspended: boolean,
  reason: string,
  expectedSuspended: boolean,
): Promise<boolean> {
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 5 || normalizedReason.length > 500) {
    throw new PlatformAdminResponseError('A reason between 5 and 500 characters is required.');
  }

  const { data, error } = await supabase.rpc('set_account_management_suspension', {
    p_user_id: userId,
    p_suspended: suspended,
    p_reason: normalizedReason,
    p_expected_suspended: expectedSuspended,
  });
  if (error) throw error;
  if (data !== true) throw new PlatformAdminResponseError('The account management change was not confirmed.');
  return true;
}
