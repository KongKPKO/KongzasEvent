import { uploadImage } from './imageUploads';
import { supabase } from '../supabaseClient';
import type {
  DiscoverableOnlineCampaign,
  CampaignOrder,
  CampaignProduct,
  CampaignWorkspace,
  CreateCampaignOrderInput,
  CreatedCampaignOrder,
  OnlineCampaignSummary,
  PublicOnlineCampaign,
} from '../types/onlineCampaign';

const knownCodes = new Set([
  'production_limit_exceeded',
  'supply_policy_changed_reload',
  'production_stock_not_ready',
  'store_suspended',
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
  'invalid_campaign_stock',
  'campaign_stock_below_used_stock',
  'campaign_stock_exceeds_catalog_stock',
  'invalid_price_override',
  'campaign_product_order_limit_exceeded',
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
  'promotion_changed',
  'promotion_choice_required',
  'promotion_reward_unavailable',
  'promotion_rewards_exhausted',
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

export type CampaignNotificationEvent =
  | 'created'
  | 'ready_for_pickup'
  | 'shipped'
  | 'payment_rejected'
  | 'refund_required';

const throwRpcError = (error: { message?: string; code?: string } | null) => {
  if (!error) return;
  const text = rpcErrorText(error);
  const code = Array.from(knownCodes).find((candidate) => text.includes(candidate));
  throw new OnlineCampaignError(code || 'campaign_request_failed');
};

export async function listMyOnlineCampaigns(artistId?: string) {
  const { data, error } = artistId
    ? await supabase.rpc('list_my_online_campaigns', { p_artist_id: artistId })
    : await supabase.rpc('list_my_online_campaigns');
  throwRpcError(error);
  return (data || []) as OnlineCampaignSummary[];
}

export async function getCampaignWorkspace(campaignId: string, artistId?: string) {
  const { data, error } = artistId
    ? await supabase.rpc('get_online_campaign_workspace', {
      p_campaign_id: campaignId,
      p_artist_id: artistId,
    })
    : await supabase.rpc('get_online_campaign_workspace', { p_campaign_id: campaignId });
  throwRpcError(error);
  const workspace = data as CampaignWorkspace;
  // The workspace RPC predates item galleries. Read only its authorized catalog
  // IDs through RLS, in bounded batches to avoid oversized PostgREST URLs.
  const missing = workspace.catalog.filter(product => product.gallery_images === undefined || product.variant_gallery_images === undefined);
  const batches = [];
  for (let index = 0; index < missing.length; index += 100) {
    batches.push(missing.slice(index, index + 100));
  }
  const results = await Promise.all(batches.map(products => supabase.from('products')
    .select('id, product_kind, gallery_images, variant_gallery_images')
    .eq('artist_id', workspace.campaign.artist_id)
    .in('id', products.map(product => product.product_id || product.id || ''))));
  results.forEach(result => throwRpcError(result.error));
  const media = new Map(results.flatMap(result => result.data || []).map(product => [product.id, product]));
  return {
    ...workspace,
    catalog: workspace.catalog.map(product => ({ ...product, ...media.get(product.product_id || product.id || '') })),
  };
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
    p_reward_choices: input.rewardChoices || [],
    p_promotion_choices: input.promotionChoices || [],
    p_expected_pricing_hash: input.expectedPricingHash || null,
    p_accept_exhausted_rewards: input.acceptExhaustedRewards || false,
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
  _campaignId: string,
  orderId: string,
  orderCode: string,
  file: File,
) {
  return uploadImage(file, 'evidence', { orderId, code: orderCode });
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

export const notifyOnlineCampaignOrder = (input: {
  orderId: string;
  orderCode?: string;
  event: CampaignNotificationEvent;
}) => supabase.functions.invoke('notify-online-campaign-order', {
  body: {
    order_id: input.orderId,
    order_code: input.orderCode || null,
    event: input.event,
  },
});

export async function listPublicOnlineCampaigns(artistSlug?: string) {
  const { data, error } = await supabase.rpc('list_public_online_campaigns', {
    p_artist_slug: artistSlug || null,
  });
  if (error) throwRpcError(error);
  return (data || []) as DiscoverableOnlineCampaign[];
}
