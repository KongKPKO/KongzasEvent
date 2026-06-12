export type EventSellingMode = 'preorder' | 'live' | 'post_event' | 'closed';

export type OrderType = 'live_queue' | 'pos_walkin' | 'preorder' | 'post_event';

export type PickupStatus = 'not_required' | 'awaiting_pickup' | 'picked_up' | 'cancelled' | 'expired';

export type PaymentStatus =
  | 'awaiting_payment'
  | 'payment_submitted'
  | 'payment_confirmed'
  | 'payment_rejected'
  | 'payment_expired'
  | 'payment_cancelled';

export interface CreatePreorderItem {
  product_id: string;
  quantity: number;
  notes?: string;
}

export interface CreatePreorderInput {
  eventId: string;
  items: CreatePreorderItem[];
  customerName: string;
  customerContact: string;
  customerPhone?: string;
  customerSocial?: string;
  customerEmail?: string;
  customerNote: string;
  clientRequestId?: string | null;
}

export interface PreorderPaymentMethod {
  id: string;
  event_id: string;
  artist_id?: string;
  method_type: string;
  display_name: string | null;
  account_name: string | null;
  account_number: string | null;
  bank_name?: string | null;
  promptpay_id: string | null;
  qr_image_url: string | null;
  instructions: string | null;
  payment_deadline_at: string | null;
  is_enabled: boolean;
}

export interface CreatePreorderResult {
  order_id: string;
  pickup_code: string;
  total_price: number;
  currency: string;
  pickup_instructions: string;
  payment_status: PaymentStatus;
  payment_methods: PreorderPaymentMethod[];
  payment_deadline_at: string | null;
}

export interface SubmitPaymentEvidenceResult {
  order_id: string;
  payment_status: 'payment_submitted';
  stock_reserved: number;
  submitted_at: string;
}

export interface ReviewPreorderPaymentResult {
  order_id: string;
  payment_status: 'payment_confirmed' | 'payment_rejected';
  pickup_status: PickupStatus;
  confirmed_at?: string;
  rejected_at?: string;
}

export interface MarkPreorderPickedUpResult {
  order_id: string;
  pickup_status: 'picked_up';
  status: 'completed';
  picked_up_at: string;
}

export interface CancelPreorderResult {
  order_id: string;
  pickup_status: 'cancelled';
  status: 'cancelled';
  cancelled_at: string;
}

export type PreorderNotificationEvent = 'submitted' | 'confirmed' | 'rejected';

export interface ExpirePreordersResult {
  expired_count: number;
}

export interface PublicOrderReceipt {
  status: string;
  pickup_status: PickupStatus;
  pickup_code: string;
  customer_name: string;
  total_price: number;
  currency: string;
  pickup_instructions: string;
  payment_status: PaymentStatus | null;
  slip_url: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  payment_deadline_at: string | null;
}

export interface PublicPreorderItem {
  product_id: string;
  name: string;
  quantity: number;
  price_per_unit: number;
  currency: string;
}

export interface PublicPreorderDetail {
  order_id: string;
  event_id: string;
  event_name: string;
  artist_name: string;
  artist_facebook_url: string | null;
  status: string;
  pickup_status: PickupStatus;
  pickup_code: string;
  customer_name: string;
  customer_email_masked: string;
  total_price: number;
  currency: string;
  pickup_instructions: string;
  payment_status: PaymentStatus;
  slip_url: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  rejected_at: string | null;
  review_note: string | null;
  payment_methods: PreorderPaymentMethod[];
  payment_deadline_at: string | null;
  created_at: string;
  picked_up_at: string | null;
  items: PublicPreorderItem[];
}

export interface PreorderProductionSummaryRow {
  product_id: string;
  product_name: string;
  category: string | null;
  image_url: string | null;
  submitted_quantity: number;
  confirmed_quantity: number;
  rejected_quantity: number;
  total_to_prepare: number;
  expected_amount: number;
  confirmed_amount: number;
}

export interface PreorderPaymentReviewItem {
  product_id: string;
  name: string;
  quantity: number;
  price_per_unit: number;
  currency: string;
}

export interface PreorderPaymentReviewRow {
  order_id: string;
  pickup_code: string;
  customer_name: string;
  customer_contact: string | null;
  customer_phone: string | null;
  customer_social: string | null;
  customer_email: string | null;
  customer_note: string | null;
  total_price: number;
  currency: string;
  payment_status: PaymentStatus;
  slip_url: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  rejected_at: string | null;
  expired_at: string | null;
  review_note: string | null;
  items: PreorderPaymentReviewItem[];
}
