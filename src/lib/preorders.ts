import { supabase } from '../supabaseClient';
import type {
  CancelPreorderResult,
  CreatePreorderInput,
  CreatePreorderResult,
  ExpirePreordersResult,
  MarkOrderShippedResult,
  PaymentStatus,
  PreorderPaymentReviewRow,
  PreorderProductionSummaryRow,
  ReviewPreorderPaymentResult,
  MarkPreorderPickedUpResult,
  PreorderNotificationEvent,
  PublicOrderReceipt,
  PublicPreorderDetail,
  SubmitPaymentEvidenceResult,
} from '../types/preorder';

const firstRow = <T>(rows: T[] | T | null, error: unknown, fallbackError: string): T => {
  if (error) throw error;
  if (Array.isArray(rows)) {
    if (!rows[0]) throw new Error(fallbackError);
    return rows[0];
  }
  if (!rows) throw new Error(fallbackError);
  return rows;
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message?: unknown }).message || '');
  }
  return String(error || '');
};

export const getPreorderErrorMessage = (error: unknown) => {
  const message = getErrorMessage(error);
  if (message.includes('customer_name_required')) return 'Please enter a pickup name.';
  if (message.includes('customer_email_required')) return 'Please enter an email address for pre-order updates.';
  if (message.includes('customer_email_invalid')) return 'Please enter a valid email address.';
  if (message.includes('customer_phone_required')) return 'Please enter a phone number for shipping.';
  if (message.includes('shipping_address_required')) return 'Please enter a shipping address.';
  if (message.includes('customer_contact_required')) return 'Please enter at least one contact channel.';
  if (message.includes('empty_items')) return 'Select at least one item before submitting.';
  if (message.includes('event_not_confirmed')) return 'This event is not confirmed yet.';
  if (message.includes('event_ended')) return 'This event has already ended.';
  if (message.includes('artist_not_public')) return 'This creator page is not ready for public pre-orders yet.';
  if (message.includes('preorder_not_open_yet')) return 'Pre-order has not opened yet.';
  if (message.includes('preorder_closed')) return 'Pre-order is already closed.';
  if (message.includes('preorder_not_open')) return 'This event is not accepting pre-orders right now.';
  if (message.includes('insufficient_stock')) return 'One or more items just sold out.';
  if (message.includes('order_not_cancellable')) return 'This pre-order cannot be cancelled.';
  if (message.includes('order_not_pickup_ready')) return 'This pre-order is not ready for pickup.';
  if (message.includes('payment_evidence_required')) return 'Please upload payment evidence before submitting.';
  if (message.includes('payment_already_submitted')) return 'Payment evidence has already been submitted.';
  if (message.includes('payment_already_confirmed')) return 'This payment is already confirmed.';
  if (message.includes('payment_not_submitted')) return 'Payment evidence has not been submitted yet.';
  if (message.includes('tracking_required')) return 'Please enter a tracking number.';
  if (message.includes('not_post_order')) return 'Only post-event orders can be marked as shipped.';
  if (message.includes('payment_not_confirmed')) return 'Payment must be confirmed before pickup or shipment.';
  if (message.includes('payment_not_submittable')) return 'This payment cannot be submitted right now.';
  if (message.includes('reject_note_required')) return 'Please add a reason before rejecting this payment.';
  if (message.includes('event_not_ready_to_expire_preorders')) return 'Pre-orders can only be expired after the event ends or after the event is closed.';
  if (message.includes('mixed_currency_not_allowed')) return 'Items with different currencies cannot be checked out together.';
  if (message.includes('invalid_product')) return 'One or more items are no longer available.';
  if (message.includes('forbidden')) return 'Permission denied.';
  return message || 'Pre-order failed. Please check your items and try again.';
};

export const createPreorder = async (input: CreatePreorderInput) => {
  const { data, error } = await supabase.rpc('create_preorder_with_stock', {
    p_event_id: input.eventId,
    p_items: input.items,
    p_customer_name: input.customerName,
    p_customer_contact: input.customerContact,
    p_customer_note: input.customerNote,
    p_client_request_id: input.clientRequestId || null,
    p_customer_phone: input.customerPhone || '',
    p_customer_social: input.customerSocial || '',
    p_customer_email: input.customerEmail || '',
    p_shipping_address: input.shippingAddress || '',
  });

  return firstRow<CreatePreorderResult>(
    data as CreatePreorderResult[] | CreatePreorderResult | null,
    error,
    'preorder_response_missing'
  );
};

export const uploadPaymentEvidence = async (input: {
  eventId: string;
  orderId: string;
  pickupCode: string;
  file: File;
}) => {
  const extension = input.file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const nonce = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : String(Date.now());
  const path = `${input.eventId}/${input.orderId}/${input.pickupCode}-${nonce}.${extension}`;
  const { error } = await supabase.storage.from('PaymentEvidence').upload(path, input.file, {
    cacheControl: '3600',
    upsert: false,
  });

  if (error) throw error;
  return path;
};

export const submitPaymentEvidence = async (input: {
  orderId: string;
  pickupCode: string;
  slipUrl: string;
  clientRequestId?: string | null;
}) => {
  const { data, error } = await supabase.rpc('submit_preorder_payment_evidence', {
    p_order_id: input.orderId,
    p_pickup_code: input.pickupCode,
    p_slip_url: input.slipUrl,
    p_client_request_id: input.clientRequestId || null,
  });

  return firstRow<SubmitPaymentEvidenceResult>(
    data as SubmitPaymentEvidenceResult[] | SubmitPaymentEvidenceResult | null,
    error,
    'preorder_payment_submit_response_missing'
  );
};

export const confirmPreorderPayment = async (orderId: string, note = '') => {
  const { data, error } = await supabase.rpc('confirm_preorder_payment', {
    p_order_id: orderId,
    p_note: note,
  });

  return firstRow<ReviewPreorderPaymentResult>(
    data as ReviewPreorderPaymentResult[] | ReviewPreorderPaymentResult | null,
    error,
    'preorder_payment_confirm_response_missing'
  );
};

export const rejectPreorderPayment = async (orderId: string, note = '') => {
  const { data, error } = await supabase.rpc('reject_preorder_payment', {
    p_order_id: orderId,
    p_note: note,
  });

  return firstRow<ReviewPreorderPaymentResult>(
    data as ReviewPreorderPaymentResult[] | ReviewPreorderPaymentResult | null,
    error,
    'preorder_payment_reject_response_missing'
  );
};

export const notifyPreorderPayment = async (input: {
  orderId: string;
  event: PreorderNotificationEvent;
  pickupCode?: string | null;
}) => supabase.functions.invoke('notify-preorder-payment', {
  body: {
    order_id: input.orderId,
    pickup_code: input.pickupCode || null,
    event: input.event,
  },
});

export const listPreorderProductionSummary = async (eventId: string) => {
  const { data, error } = await supabase.rpc('list_preorder_production_summary', {
    p_event_id: eventId,
  });

  if (error) throw error;
  return (data || []) as PreorderProductionSummaryRow[];
};

export const listPreorderPaymentReview = async (eventId: string, status?: PaymentStatus | null) => {
  const { data, error } = await supabase.rpc('list_preorder_payment_review', {
    p_event_id: eventId,
    p_payment_status: status || null,
  });

  if (error) throw error;
  return (data || []) as PreorderPaymentReviewRow[];
};

export const createPaymentEvidenceSignedUrl = async (path: string) => {
  const { data, error } = await supabase.storage.from('PaymentEvidence').createSignedUrl(path, 60 * 30);
  if (error) throw error;
  return data.signedUrl;
};

export const markPreorderPickedUp = async (orderId: string) => {
  const { data, error } = await supabase.rpc('mark_preorder_picked_up', {
    p_order_id: orderId,
  });

  return firstRow<MarkPreorderPickedUpResult>(
    data as MarkPreorderPickedUpResult[] | MarkPreorderPickedUpResult | null,
    error,
    'preorder_pickup_response_missing'
  );
};

export const markOrderShipped = async (orderId: string, trackingNumber: string, carrier = '') => {
  const { data, error } = await supabase.rpc('mark_order_shipped', {
    p_order_id: orderId,
    p_tracking_number: trackingNumber,
    p_carrier: carrier,
  });

  return firstRow<MarkOrderShippedResult>(
    data as MarkOrderShippedResult[] | MarkOrderShippedResult | null,
    error,
    'order_shipped_response_missing'
  );
};

export const cancelPreorder = async (orderId: string, reason: string) => {
  const { data, error } = await supabase.rpc('cancel_preorder_with_stock', {
    p_order_id: orderId,
    p_reason: reason,
  });

  return firstRow<CancelPreorderResult>(
    data as CancelPreorderResult[] | CancelPreorderResult | null,
    error,
    'preorder_cancel_response_missing'
  );
};

export const cancelCustomerPreorderBeforePayment = async (orderId: string, pickupCode: string) => {
  const { data, error } = await supabase.rpc('cancel_public_preorder_before_payment', {
    p_order_id: orderId,
    p_pickup_code: pickupCode,
  });

  return firstRow<CancelPreorderResult>(
    data as CancelPreorderResult[] | CancelPreorderResult | null,
    error,
    'preorder_cancel_response_missing'
  );
};

export const expirePreordersForEvent = async (eventId: string) => {
  const { data, error } = await supabase.rpc('expire_preorders_for_event', {
    p_event_id: eventId,
  });

  return firstRow<ExpirePreordersResult>(
    data as ExpirePreordersResult[] | ExpirePreordersResult | null,
    error,
    'preorder_expire_response_missing'
  );
};

export const getPublicPreorderByCode = async (artistSlug: string, pickupCode: string) => {
  const { data, error } = await supabase.rpc('get_public_preorder_by_code', {
    p_artist_slug: artistSlug,
    p_pickup_code: pickupCode,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row || null) as PublicPreorderDetail | null;
};

export const getPublicOrderReceipt = async (orderId: string, pickupCode: string) => {
  const { data, error } = await supabase.rpc('get_public_order_receipt', {
    p_order_id: orderId,
    p_pickup_code: pickupCode,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row || null) as PublicOrderReceipt | null;
};
