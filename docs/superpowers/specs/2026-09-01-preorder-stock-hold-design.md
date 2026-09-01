# Pre-order Stock Hold Design

## Goal

Reserve finite product stock for 15 minutes when a customer creates a pre-order, release abandoned holds automatically, and keep submitted payments reserved until seller review.

## Scope

- Use a fixed 15-minute hold for pre-orders.
- Reserve stock atomically during `create_preorder_with_stock`.
- Show the hold deadline and countdown on the public order page.
- Keep stock reserved after payment evidence is submitted.
- Release expired, cancelled, or rejected reservations.
- Convert reserved stock to sold stock when payment is confirmed.
- Do not add per-order quantity limits in this change.

## Data Model

Add nullable `stock_hold_expires_at timestamptz` to `order_payments`.

- New awaiting-payment pre-orders set it to `now() + interval '15 minutes'`.
- Existing orders with `NULL` retain the legacy submit-time reservation behavior.
- The timestamp remains available for audit after submission or expiry; expiry logic is gated by payment status.

No event-level setting is added.

## Order Lifecycle

### Create order

`create_preorder_with_stock` creates the order and payment record, reserves finite stock through the existing shared reservation function, and returns the 15-minute hold deadline as `payment_deadline_at`. The operation remains one database transaction, so a failed reservation rolls back the whole order.

When stock is unavailable, the RPC returns `insufficient_stock`; no draft order survives.

### Await payment

The public order page displays the fixed hold deadline and a countdown. Product availability already subtracts `stock_reserved`, so Realtime catalog updates mark an exhausted product sold out without creator action.

### Submit payment evidence

For an active new hold, `submit_preorder_payment_evidence` changes the payment to `payment_submitted` without reserving stock a second time. Legacy awaiting-payment orders with no hold timestamp continue to reserve at submission.

If the hold has already expired, the order cannot submit payment evidence and the customer is directed to create a new order.

### Confirm, reject, or cancel

- Confirmation uses the existing reserved-to-sold transition.
- Rejection and cancellation use the existing stock release function.
- Customer cancellation before payment must now release an active hold before cancelling the order.
- Existing rejected-payment resubmission may reserve available stock again when the slip is resubmitted; it does not receive a new cart hold because payment evidence is supplied in the same transaction.

## Automatic Expiry

Create one private, idempotent database function that finds `awaiting_payment` pre-orders whose non-null `stock_hold_expires_at` is in the past. For each locked order it releases stock, marks the payment `payment_expired`, cancels the order with an expired pickup state, and writes the existing payment and stock-release audit events.

Schedule the function once per minute with Supabase Cron (`pg_cron`). The job is global rather than one job per event. The expiry function is not executable by public API roles.

The order-page read and payment submission paths also expire their target order transactionally when needed, so a delayed cron run cannot permit payment against an expired hold.

## Concurrency and Security

- Continue using PostgreSQL row locks and the existing shared stock reservation/release functions.
- Reserve, release, and payment state changes happen inside database transactions.
- Keep privileged maintenance functions unavailable to `anon` and `authenticated` callers.
- Preserve idempotency through the existing client request ID behavior.
- Do not expose any new table directly through the Data API.

## Customer Experience

- Successful checkout navigates to the order page with payment methods and QR details.
- The page displays a 15-minute countdown while payment is awaiting evidence.
- At zero, payment upload is disabled and the page explains that reserved stock was released and a new order is required.
- A race for the last item returns the existing sold-out error.

## Verification

Add SQL regression coverage for:

- stock reserved immediately at order creation;
- concurrent capacity cannot exceed finite stock;
- slip submission does not double-reserve;
- expired awaiting-payment holds release stock and cancel the order;
- submitted payments are not released by the 15-minute expiry job;
- cancellation before payment releases stock;
- legacy orders with no hold timestamp retain submit-time reservation;
- public roles cannot execute the maintenance function.

Update the customer regression test for the returned deadline and countdown behavior. Run the narrow SQL and Playwright checks, the relevant security regression, then `npm run verify`.

