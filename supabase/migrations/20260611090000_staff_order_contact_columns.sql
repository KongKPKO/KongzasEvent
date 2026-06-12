-- The payment-evidence migration revoked all column access on orders and
-- re-granted a safe subset, but left out the customer/pickup columns that
-- staff pages (Pickup desk, Order history) read directly. Row access is
-- already gated by the orders_preorder_staff_read RLS policy
-- (has_event_role owner/manager/seller/queue), so granting these columns to
-- authenticated does not expose them to anonymous users.

grant select (
  customer_name,
  customer_contact,
  customer_note,
  customer_phone,
  customer_social,
  customer_email,
  picked_up_at,
  cancelled_at,
  cancel_reason
) on public.orders to authenticated;
