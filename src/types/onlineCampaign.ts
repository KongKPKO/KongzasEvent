import type { PromotionChoice } from './promotion';

export type CampaignPublicationStatus = 'draft' | 'published' | 'cancelled' | 'archived';
export type CampaignState = CampaignPublicationStatus | 'scheduled' | 'open' | 'sold_out' | 'closed';
export type CampaignPaymentStatus =
  | 'awaiting_payment'
  | 'payment_submitted'
  | 'payment_confirmed'
  | 'payment_rejected'
  | 'payment_expired'
  | 'payment_cancelled'
  | 'payment_submitted_late'
  | 'refund_pending'
  | 'refunded';
export type CampaignFulfillmentMethod = 'shipping' | 'pickup';
export type CampaignFulfillmentStatus =
  | 'not_required'
  | 'awaiting_shipment'
  | 'shipped'
  | 'awaiting_pickup'
  | 'picked_up'
  | 'cancelled'
  | 'expired';

export interface CampaignProduct {
  id?: string;
  campaign_product_id?: string;
  product_id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  tags?: string[];
  image_url?: string | null;
  sku?: string | null;
  variant_group_name?: string | null;
  variant_name?: string | null;
  price: number;
  price_override?: number | null;
  currency?: string;
  is_unlimited: boolean;
  is_enabled?: boolean;
  stock_total?: number | null;
  stock_reserved?: number;
  stock_sold?: number;
  max_quantity_per_order?: number | null;
  available_quantity?: number | null;
}

export interface CampaignPickupPoint {
  id: string;
  name: string;
  address: string;
  starts_at: string;
  ends_at: string;
  instructions?: string | null;
  is_enabled?: boolean;
}

export interface CampaignPaymentMethod {
  id: string;
  method_type: 'promptpay' | 'bank_transfer' | 'qr_image' | 'other';
  display_name?: string | null;
  account_name?: string | null;
  account_number?: string | null;
  bank_name?: string | null;
  promptpay_id?: string | null;
  qr_image_url?: string | null;
  instructions?: string | null;
  is_enabled?: boolean;
}

export interface OnlineCampaignSummary {
  id: string;
  artist_id: string;
  name: string;
  slug: string;
  description: string;
  opens_at: string;
  closes_at: string;
  campaign_timezone: string;
  currency: string;
  shipping_enabled: boolean;
  flat_shipping_fee: number;
  pickup_enabled: boolean;
  publication_status: CampaignPublicationStatus;
  state: CampaignState;
  action_count: number;
  confirmed_revenue: number;
}

export interface PublicOnlineCampaign extends OnlineCampaignSummary {
  artist_slug: string;
  artist_name: string;
  artist_image_url?: string | null;
  products: CampaignProduct[];
  pickup_points: CampaignPickupPoint[];
  payment_methods: CampaignPaymentMethod[];
}

export interface CampaignOrderItem {
  product_id?: string;
  name: string;
  sku?: string | null;
  quantity: number;
  price_per_unit: number;
  currency?: string;
  line_type?: 'purchase' | 'promotion_reward';
  promotion_name?: string | null;
}

export interface CampaignOrder {
  id: string;
  order_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  campaign_slug?: string;
  artist_slug?: string;
  artist_name?: string;
  order_code: string;
  created_at: string;
  status: string;
  customer_name: string;
  customer_email?: string;
  customer_email_masked?: string;
  customer_phone?: string;
  shipping_address?: string | null;
  fulfillment_method: CampaignFulfillmentMethod;
  fulfillment_status: CampaignFulfillmentStatus;
  pickup_point?: CampaignPickupPoint | null;
  subtotal_price: number;
  discount_total: number;
  shipping_fee: number;
  total_price: number;
  currency: string;
  payment_status: CampaignPaymentStatus;
  payment_methods?: CampaignPaymentMethod[];
  slip_url?: string | null;
  submitted_at?: string | null;
  review_note?: string | null;
  stock_hold_expires_at?: string | null;
  upload_grace_expires_at?: string | null;
  late_payment_reported_at?: string | null;
  tracking_number?: string | null;
  shipping_carrier?: string | null;
  shipped_at?: string | null;
  picked_up_at?: string | null;
  refunded_at?: string | null;
  items: CampaignOrderItem[];
  pricing_breakdown?: Array<{ promotion_name?: string; discount_amount?: number }>;
}

export interface CampaignWorkspace {
  campaign: OnlineCampaignSummary;
  products: CampaignProduct[];
  catalog: CampaignProduct[];
  pickup_points: CampaignPickupPoint[];
  payment_methods: CampaignPaymentMethod[];
  orders: CampaignOrder[];
}

export interface CreateCampaignOrderInput {
  campaignId: string;
  items: Array<{ product_id: string; quantity: number }>;
  fulfillmentMethod: CampaignFulfillmentMethod;
  pickupPointId?: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress?: string;
  customerNote?: string;
  clientRequestId: string;
  rewardChoices?: PromotionChoice[];
  promotionChoices?: PromotionChoice[];
  expectedPricingHash?: string | null;
  acceptExhaustedRewards?: boolean;
}

export interface CreatedCampaignOrder {
  order_id: string;
  order_code: string;
  subtotal_price: number;
  shipping_fee: number;
  total_price: number;
  currency: string;
  payment_status: CampaignPaymentStatus;
  payment_methods: CampaignPaymentMethod[];
  stock_hold_expires_at: string;
  pickup_point_snapshot?: CampaignPickupPoint | null;
}
