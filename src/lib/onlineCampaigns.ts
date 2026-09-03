import { supabase } from '../supabaseClient';
import type {
  CampaignOrder,
  CampaignProduct,
  CampaignWorkspace,
  CreateCampaignOrderInput,
  CreatedCampaignOrder,
  OnlineCampaignSummary,
  PublicOnlineCampaign,
} from '../types/onlineCampaign';

const knownCodes = new Set([
  'campaign_not_found',
  'campaign_not_open',
  'artist_not_public',
  'empty_items',
  'invalid_product',
  'invalid_quantity',
  'duplicate_product',
  'insufficient_stock',
  'invalid_fulfillment',
  'shipping_not_available',
  'pickup_not_available',
  'invalid_pickup_point',
  'customer_name_required',
  'customer_email_required',
  'customer_email_invalid',
  'customer_phone_required',
  'customer_contact_required',
  'shipping_address_required',
  'payment_method_required',
  'stock_hold_expired',
  'payment_not_awaiting',
  'payment_submission_not_allowed',
  'order_not_found',
  'forbidden',
]);

const rpcErrorText = (error: { message?: string; code?: string } | null) =>
  [error?.code, error?.message].filter(Boolean).join(' ');

export class OnlineCampaignError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'OnlineCampaignError';
  }
}

const throwRpcError = (error: { message?: string; code?: string } | null) => {
  if (!error) return;
  const text = rpcErrorText(error);
  const code = Array.from(knownCodes).find((candidate) => text.includes(candidate));
  throw new OnlineCampaignError(code || 'campaign_request_failed');
};

export async function listMyOnlineCampaigns() {
  const { data, error } = await supabase.rpc('list_my_online_campaigns');
  throwRpcError(error);
  return (data || []) as OnlineCampaignSummary[];
}

export async function getCampaignWorkspace(campaignId: string) {
  const { data, error } = await supabase.rpc('get_online_campaign_workspace', {
    p_campaign_id: campaignId,
  });
  throwRpcError(error);
  return data as CampaignWorkspace;
}

export async function getPublicOnlineCampaign(artistSlug: string, campaignSlug: string) {
  const { data, error } = await supabase.rpc('get_public_online_campaign', {
    p_artist_slug: artistSlug,
    p_campaign_slug: campaignSlug,
  });
  throwRpcError(error);
  return (data || null) as PublicOnlineCampaign | null;
}

export async function createCampaignOrder(input: CreateCampaignOrderInput) {
  const { data, error } = await supabase.rpc('create_online_campaign_order', {
    p_campaign_id: input.campaignId,
    p_items: input.items,
    p_fulfillment_method: input.fulfillmentMethod,
    p_pickup_point_id: input.pickupPointId || null,
    p_customer_name: input.customerName,
    p_customer_email: input.customerEmail,
    p_customer_phone: input.customerPhone,
    p_shipping_address: input.shippingAddress || '',
    p_customer_note: input.customerNote || '',
    p_client_request_id: input.clientRequestId,
  });
  throwRpcError(error);
  return (data?.[0] || null) as CreatedCampaignOrder | null;
}

export async function beginCampaignPaymentUpload(artistSlug: string, orderCode: string) {
  const { data, error } = await supabase.rpc('begin_online_payment_upload', {
    p_artist_slug: artistSlug,
    p_order_code: orderCode,
  });
  throwRpcError(error);
  return data?.[0] as { order_id: string; upload_grace_expires_at: string };
}

export async function submitCampaignPaymentEvidence(
  artistSlug: string,
  orderCode: string,
  slipUrl: string,
  clientRequestId: string,
) {
  const { data, error } = await supabase.rpc('submit_online_payment_evidence', {
    p_artist_slug: artistSlug,
    p_order_code: orderCode,
    p_slip_url: slipUrl,
    p_client_request_id: clientRequestId,
  });
  throwRpcError(error);
  return data?.[0] as {
    order_id: string;
    payment_status: string;
    submitted_at: string;
    stock_remains_reserved: boolean;
  };
}

export async function getPublicCampaignOrder(artistSlug: string, orderCode: string) {
  const { data, error } = await supabase.rpc('get_public_online_order_by_code', {
    p_artist_slug: artistSlug,
    p_order_code: orderCode,
  });
  throwRpcError(error);
  return data ? ({ ...data, id: data.order_id } as CampaignOrder) : null;
}

export async function uploadCampaignPaymentEvidence(
  campaignId: string,
  orderId: string,
  orderCode: string,
  file: File,
) {
  const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const nonce = crypto.randomUUID();
  const path = `campaign/${campaignId}/${orderId}/${orderCode}-${nonce}.${extension}`;
  const { error } = await supabase.storage.from('PaymentEvidence').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  throwRpcError(error);
  return path;
}

export async function saveCampaignProducts(
  campaignId: string,
  items: Array<Pick<CampaignProduct, 'product_id' | 'is_enabled' | 'is_unlimited' | 'stock_total' | 'price_override'>>,
) {
  const { error } = await supabase.rpc('save_online_campaign_products', {
    p_campaign_id: campaignId,
    p_items: items,
  });
  throwRpcError(error);
}

export async function publishCampaign(campaignId: string) {
  const { data, error } = await supabase.rpc('publish_online_campaign', {
    p_campaign_id: campaignId,
  });
  throwRpcError(error);
  return data as string;
}

export async function runCampaignOrderAction(
  action:
    | 'confirm_online_payment'
    | 'reject_online_payment'
    | 'accept_late_online_payment'
    | 'mark_online_refund_required',
  orderId: string,
  note: string,
) {
  const { data, error } = await supabase.rpc(action, {
    p_order_id: orderId,
    p_note: note,
  });
  throwRpcError(error);
  return data;
}

export async function markCampaignOrderRefunded(
  orderId: string,
  note: string,
  reference = '',
) {
  const { data, error } = await supabase.rpc('mark_online_refunded', {
    p_order_id: orderId,
    p_note: note,
    p_refund_reference: reference || null,
    p_refund_evidence_url: null,
  });
  throwRpcError(error);
  return data;
}

export async function markCampaignOrderShipped(
  orderId: string,
  carrier: string,
  trackingNumber: string,
) {
  const { data, error } = await supabase.rpc('mark_online_order_shipped', {
    p_order_id: orderId,
    p_carrier: carrier,
    p_tracking_number: trackingNumber,
  });
  throwRpcError(error);
  return data;
}

export async function markCampaignOrderPickedUp(orderId: string) {
  const { data, error } = await supabase.rpc('mark_online_order_picked_up', {
    p_order_id: orderId,
  });
  throwRpcError(error);
  return data;
}
