# Pre-order Payment Evidence and Production Dashboard Design

## Goal

Extend the current pre-order MVP so creators can run pre-orders before producing goods:

- Customers can order comfortably before the event, including on desktop.
- Customers must provide reachable contact information.
- Customers can see seller payment instructions and submit payment evidence.
- Sellers can review payment evidence manually without NireQ touching money.
- Sellers get a pre-order production dashboard they can use to order goods from a factory.

The MVP intentionally does **not** integrate a payment gateway or slip verification API. It should be built so a verification provider can be added later without changing the customer/seller mental model.

## Product Positioning

The current pre-order MVP reserves stock at order creation and focuses on day-of-event pickup. That is correct for "reserve a finite booth item", but for creator pre-orders the more natural production workflow is:

1. Customer submits an order.
2. Customer pays the seller directly.
3. The order starts counting toward production once the customer submits payment evidence.
4. Seller confirms/rejects after checking their bank app.
5. Confirmed orders stay in the pickup flow.

This makes NireQ a pre-order operating system, not a payment processor.

## Legal and Payment Guardrails

NireQ must not receive, hold, settle, or transfer customer money in this MVP.

Allowed:

- Seller configures their own PromptPay, bank transfer details, or QR image.
- Customer transfers directly to the seller's bank account or PromptPay.
- Customer uploads a slip/payment evidence image.
- Seller manually checks their bank account and confirms or rejects payment.
- NireQ stores payment evidence and workflow status.

Not allowed in this MVP:

- NireQ receives money into a NireQ account.
- NireQ transfers money onward to sellers.
- NireQ deducts marketplace fees from customer payment before settlement.
- NireQ presents itself as the party that verified bank settlement.
- NireQ generates dynamic payment QR codes in NireQ's name.

If future work crosses those lines, use a licensed payment provider instead of building the flow directly.

Rationale:

- Bank of Thailand describes PromptPay as payment infrastructure for transfers and QR payments through banking channels.
- Bank of Thailand's Payment Systems Act guidance says designated payment services include electronic payment acceptance on behalf of sellers and electronic money transfer services, which require permission/registration before operating such business.
- Therefore this MVP should keep money flowing customer -> seller and frame NireQ as workflow/evidence tooling only.

References:

- Bank of Thailand PromptPay: https://www.bot.or.th/en/financial-innovation/digital-finance/digital-payment/promptpay.html
- Bank of Thailand Payment Systems Act overview: https://www.bot.or.th/th/our-roles/payment-systems/back-up-payment.html
- Bank of Thailand regulated payment business provider list: https://www.bot.or.th/th/our-roles/payment-systems/payment-act-oversight/business-provider.html

## MVP Scope

### Included

- Desktop-first pre-order customer layout.
- Required customer contact rule: at least one of phone, social media, or email.
- Seller payment method settings per event.
- Customer payment instruction page after pre-order creation.
- Customer payment evidence upload.
- Payment status workflow.
- Stock reservation timing changed to payment evidence submission.
- Seller payment review queue.
- Seller pre-order production dashboard.
- CSV export for factory ordering and customer follow-up.
- Pickup page payment status/warning.
- Audit log for payment review actions.
- Privacy notice text for contact and payment evidence.

### Deferred

- Payment gateway integration.
- Automatic bank settlement confirmation.
- Slip verification API.
- Refund automation.
- Shipping and post-event delivery.
- Customer account login.
- Seller payout/marketplace fee deduction.
- Partial payment/deposit logic.
- Product variants. Product-level aggregation should be designed so variants can be added later.

## Key Product Decision

Stock is not reserved when the pre-order is first created.

Stock/production quantity is reserved when the customer submits payment evidence. If the seller later rejects the payment evidence, the reserved quantity is released and removed from the production totals.

This fits creator pre-orders better because an unpaid cart should not affect the production plan. It also limits fake/no-action orders. A fake slip can still reserve stock temporarily, but the seller can reject it and release the stock immediately.

### Current implementation impact

The current pre-order RPC must be actively changed, not merely wrapped with a payment table.

Current `create_preorder_with_stock` behavior:

- Creates the order as `status = confirmed`.
- Sets `pickup_status = awaiting_pickup`.
- Increments `stock_reserved` during order creation.

New behavior:

- Creates the order as not pickup-ready.
- Creates `order_payments.payment_status = awaiting_payment`.
- Leaves `pickup_status = not_required` or a non-ready equivalent until seller payment confirmation.
- Does not increment `stock_reserved` until payment evidence submission.

Existing pickup/cancel/expire RPCs also need updated guards because they currently expect `status = confirmed` and `pickup_status = awaiting_pickup`. Under the new model, only `payment_confirmed` orders should reach `awaiting_pickup`. Submitted-but-unconfirmed payment evidence needs its own release/expiry path.

## Status Model

### Order lifecycle

Existing `orders.status` should remain coarse lifecycle state:

- `pending` or `awaiting_payment`: customer has created a pre-order but has not submitted payment evidence.
- `confirmed`: payment is confirmed by seller and the order is valid for pickup.
- `completed`: order has been picked up.
- `cancelled`: order cancelled/rejected/expired.

If changing `orders.status` creates too much blast radius, keep existing order status values and drive the payment-specific workflow from `order_payments.payment_status`. The UI must still expose the same state labels.

### Payment status

Use a payment-specific status:

- `awaiting_payment`: order created, no payment evidence submitted, no stock reserved.
- `payment_submitted`: customer uploaded evidence, stock reserved, counts toward production draft.
- `payment_confirmed`: seller checked bank account and confirmed payment, stock remains reserved, ready for pickup.
- `payment_rejected`: seller rejected payment evidence, stock released, removed from production totals.
- `payment_expired`: submitted payment evidence was not confirmed before the review deadline, stock released, removed from production totals.

Future optional status:

- `payment_verified`: slip verification provider says the slip is valid, amount matches, and evidence is not duplicated. This does not replace seller confirmation in the first integrated version.

### Pickup status

Current pickup statuses remain, but pickup must understand payment status:

- `awaiting_pickup`: only for payment-confirmed pre-orders.
- `picked_up`: after staff marks pickup complete.
- `cancelled`: after cancellation/rejection.
- `expired`: after order expiry/no-show flow.

If an order has `payment_submitted` but not `payment_confirmed`, it should not be treated as fully ready for pickup.

## State Matrix

| Customer/Seller moment | Payment status | Stock reserved? | Counts in production dashboard? | Pickup allowed? |
|---|---|---:|---:|---:|
| Pre-order created, not paid | `awaiting_payment` | No | No | No |
| Slip/evidence uploaded | `payment_submitted` | Yes | Yes, as "submitted/unconfirmed" | Warn or block |
| Seller confirms after bank check | `payment_confirmed` | Yes | Yes, as confirmed | Yes |
| Seller rejects evidence | `payment_rejected` | Released | No | No |
| Submitted evidence expires unreviewed | `payment_expired` | Released | No | No |
| Seller cancels confirmed payment order | `cancelled` | Released | No | No |
| Event ends/no-show expired | `expired` | Released if not picked up | No active production impact | No |
| Picked up | `payment_confirmed` + `picked_up` | Converted to sold | Historical only | Completed |

## Customer Flow

### Desktop layout

When the selected event is in pre-order mode, desktop should use a dedicated layout:

- Left column: event catalog/product grid.
- Right column: sticky cart/order summary.
- Order summary includes total, selected items, required contact fields, and primary CTA.
- The cart should remain visible while browsing products.
- Avoid giant mobile-style checkout panels on desktop.

Mobile can keep the current cart sheet/bottom bar pattern, but the form copy and payment states should match desktop.

### Required contact

Customer must provide:

- `customer_name`, required.
- At least one of:
  - `customer_phone`
  - `customer_social`
  - `customer_email`

`customer_social` is free text so customers can enter LINE, IG, X, Facebook, or another handle.

Validation:

- At least one contact channel must be non-empty.
- Email should be format-checked when present.
- Phone can be lenient; do not block international numbers.
- Social media is free text, but trim and cap length.

Customer-facing helper text:

```text
Used only for pre-order updates, payment review, and pickup issues.
```

### Create pre-order

Customer submits items and contact details.

Backend creates an order with:

- `order_type = preorder`
- payment status `awaiting_payment`
- no stock reservation yet
- total price/currency captured
- pickup code can be generated now, but receipt should not imply the order is ready until payment is confirmed

Customer lands on payment instructions.

### Payment instructions

Show:

- Order code and pickup code.
- Total amount.
- Seller payment methods.
- PromptPay/bank details or seller-uploaded QR image.
- Payment deadline/cutoff if configured.
- Button to upload payment slip/evidence.
- Notice that the seller will verify payment in their bank account.

Do not say "payment successful" after order creation.

### Submit payment evidence

Customer uploads an image. The system should:

- Validate file type/size.
- Store the evidence in private/protected storage.
- Create/update `order_payments`.
- Reserve stock in the same transactional backend operation.
- Move payment status to `payment_submitted`.
- Show "Payment evidence submitted. Waiting for seller confirmation."

If stock is no longer available by the time evidence is submitted, reject the submission and show a clear message:

```text
Some items are no longer available. Please contact the seller or update your order.
```

## Seller Flow

### Payment method settings

Per event, seller can configure one or more payment methods:

- PromptPay ID.
- Bank account number.
- Account name.
- Bank name.
- QR image upload.
- Short payment instructions.
- Payment deadline/cutoff.
- Enabled/disabled flag.

Settings should be visible from event workspace as part of pre-order settings or payment settings. Keep it event-level because payment details and cutoff can differ by event.

### Payment review queue

Seller page shows pre-orders grouped by payment status:

- Awaiting payment.
- Submitted, needs review.
- Confirmed.
- Rejected.

For each submitted payment:

- Customer name and contact.
- Order total and currency.
- Items.
- Slip/evidence thumbnail and preview.
- Submitted timestamp.
- Internal note.
- Actions: confirm payment, reject payment.

Confirm action:

- Requires owner/manager/seller role.
- Records `confirmed_by` and `confirmed_at`.
- Updates payment status to `payment_confirmed`.
- Updates order status to `confirmed`.
- Sets pickup status to `awaiting_pickup`.
- Does not change reserved stock.

Reject action:

- Requires owner/manager/seller role.
- Requires optional but encouraged reject note.
- Records `rejected_by`, `rejected_at`, and note.
- Releases reserved stock.
- Updates payment status to `payment_rejected`.
- Updates order/pickup state to non-fulfillable.

### Submitted payment expiry

Because stock is reserved at payment evidence submission, there must be a release path for unreviewed `payment_submitted` orders.

Default policy:

- Use `event_payment_methods.payment_deadline_at` when configured.
- Otherwise use `events.preorder_closes_at` as the payment deadline.
- Apply a default 24-hour review grace period after the deadline.
- Owner/manager can manually expire submitted evidence before the automatic expiry if the seller has checked and decided not to honor it.

Expiry action:

- Finds `payment_submitted` orders older than the deadline plus grace period.
- Releases reserved stock exactly once.
- Sets `payment_status = payment_expired`.
- Sets order/pickup state to non-fulfillable.
- Records an audit event with actor `system` for automatic expiry or the staff user for manual expiry.

### Production dashboard

This is the main missing seller surface before event day.

Core cards:

- Total pre-order orders.
- Awaiting payment.
- Payment submitted, needs review.
- Payment confirmed.
- Rejected/cancelled.
- Production quantity total.
- Production amount/revenue.

Product summary table:

- Product image/name/category.
- Quantity from `payment_submitted`.
- Quantity from `payment_confirmed`.
- Total quantity to prepare.
- Revenue expected/confirmed.
- Stock/payment warnings.

Customer/order table:

- Order code/pickup code.
- Customer name.
- Required contact values.
- Items.
- Payment status.
- Submitted/confirmed timestamps.
- Notes.

Export CSV:

- Product production CSV for factory ordering.
- Customer/order CSV for follow-up and pickup preparation.

Dashboard filters:

- Payment status.
- Product.
- Search by customer/contact/code.
- Date/payment submitted age.

The dashboard should clearly separate "submitted/unconfirmed" from "confirmed" so a seller can decide whether to include unconfirmed slips in factory orders.

## Pickup Integration

Pickup Orders should include payment signal:

- Payment confirmed badge for ready orders.
- Payment submitted badge/warning for orders that have evidence but are not confirmed.
- Rejected/unpaid orders should be hidden by default from awaiting pickup.

Suggested behavior:

- `payment_confirmed`: staff can mark picked up.
- `payment_submitted`: show warning and disable "Picked up" by default, unless an owner/manager confirms payment first.
- `awaiting_payment` and `payment_rejected`: not shown in awaiting pickup filter.

This avoids handing out goods for a fake or unverified slip.

## Data Model

### `event_payment_methods`

New table:

- `id uuid primary key`
- `event_id uuid not null references events(id)`
- `artist_id uuid not null`
- `method_type text not null check in ('promptpay', 'bank_transfer', 'qr_image', 'other')`
- `display_name text`
- `account_name text`
- `account_number text`
- `bank_name text`
- `promptpay_id text`
- `qr_image_url text`
- `instructions text`
- `payment_deadline_at timestamptz`
- `is_enabled boolean default true`
- `created_at timestamptz`
- `updated_at timestamptz`

RLS:

- Public/customer read only enabled methods for public verified artist events that are in pre-order mode.
- Owner/manager can insert/update/delete.
- Seller can read, and update only if current policy allows sellers to manage pre-order settings. Default recommendation: owner/manager only for settings.

### `order_payments`

New table:

- `id uuid primary key`
- `order_id uuid not null references orders(id) unique`
- `event_id uuid not null references events(id)`
- `artist_id uuid not null`
- `payment_status text not null`
- `amount_expected numeric not null`
- `currency text not null`
- `slip_url text`
- `submitted_at timestamptz`
- `confirmed_at timestamptz`
- `confirmed_by uuid`
- `rejected_at timestamptz`
- `rejected_by uuid`
- `expired_at timestamptz`
- `review_note text`
- `created_at timestamptz`
- `updated_at timestamptz`

Constraints:

- `payment_status in ('awaiting_payment', 'payment_submitted', 'payment_confirmed', 'payment_rejected', 'payment_expired')`
- `amount_expected >= 0`
- `confirmed_at` only when status is `payment_confirmed`
- `rejected_at` only when status is `payment_rejected`
- `expired_at` only when status is `payment_expired`

RLS:

- Customers should not directly select arbitrary payment rows.
- Public receipt/payment status should be returned through a receipt RPC that requires order id + pickup code or a separate receipt token.
- Staff reads through role-checked RPCs or RLS scoped to their event role.

`order_payments` is the current-state row. It remains unique by `order_id` so the app can load the latest payment state cheaply. It must not be the only audit source.

### `payment_review_events`

New append-only audit table:

- `id uuid primary key`
- `order_id uuid not null references orders(id)`
- `order_payment_id uuid references order_payments(id)`
- `event_id uuid not null references events(id)`
- `artist_id uuid not null`
- `event_type text not null`
- `from_status text`
- `to_status text`
- `slip_url text`
- `actor_user_id uuid`
- `actor_role text`
- `note text`
- `metadata jsonb default '{}'::jsonb`
- `created_at timestamptz default now()`

Allowed `event_type` values:

- `created`
- `evidence_submitted`
- `evidence_resubmitted`
- `payment_confirmed`
- `payment_rejected`
- `payment_expired`
- `stock_reserved`
- `stock_released`

Rules:

- Inserts happen inside the same transaction as the state/stock change.
- Customer resubmission after rejection must append a new `evidence_resubmitted` event and preserve the prior rejection event.
- Confirm/reject/expire actions must append review events instead of overwriting history.
- Staff UI can show the latest `order_payments` state and optionally expand audit history later.

RLS:

- No anon direct select.
- Owner/manager/seller can read events for their event.
- Inserts should be via RPC only.

### Customer contact fields

Option A: keep existing `orders.customer_contact` and add structured fields.

Recommended:

- `orders.customer_name text`
- `orders.customer_phone text`
- `orders.customer_social text`
- `orders.customer_email text`
- keep `orders.customer_contact` as backward-compatible display/fallback

Validation happens in RPC:

- customer name required
- at least one contact channel required

RLS:

- Anon must not directly read contact fields from `orders`.
- Migration must explicitly revoke anon column access for `customer_phone`, `customer_social`, and `customer_email`, following the existing column-level hardening pattern for `customer_name` and `customer_contact`.
- Receipt RPC returns only the matching customer's own receipt.
- Staff pages use role checks.

## Backend RPCs

### `create_preorder_with_stock` changes

This RPC should be renamed later if "with_stock" becomes misleading, but for minimal churn it can keep the name and change behavior carefully.

Inputs:

- Add `p_customer_phone text default ''`
- Add `p_customer_social text default ''`
- Add `p_customer_email text default ''`
- Keep `p_customer_contact` as backward compatibility during transition.

Rules:

- Customer name required.
- At least one contact channel required.
- Creates order and order items.
- Creates `order_payments` with `payment_status = awaiting_payment`.
- Does **not** increment reserved stock yet.
- Still validates products and price snapshot so payment amount is stable.
- Still uses idempotency.

Return:

- `order_id`
- `pickup_code`
- `total_price`
- `currency`
- `payment_status`
- `payment_methods`
- `payment_deadline_at`
- `pickup_instructions`

### `submit_preorder_payment_evidence`

Inputs:

- `p_order_id uuid`
- `p_pickup_code text` or receipt token
- `p_slip_url text`
- `p_client_request_id uuid default null`

Rules:

- Order must be preorder.
- Payment status must be `awaiting_payment` or `payment_rejected` if resubmission is allowed.
- If resubmitting after `payment_rejected`, the previous rejection must already have released stock; this submission reserves stock again exactly once.
- Event must still allow payment submission, unless seller allows late payment.
- Reserve stock transactionally based on order items.
- If stock is insufficient, do not move status and do not store evidence as accepted.
- Set `payment_status = payment_submitted`.
- Set `submitted_at = now()`.
- Keep order status not fully confirmed.
- Append `payment_review_events` entries for evidence submission and stock reservation.

Return:

- `order_id`
- `payment_status`
- `stock_reserved`
- `submitted_at`

### `confirm_preorder_payment`

Inputs:

- `p_order_id uuid`
- `p_note text default ''`

Rules:

- Caller must be owner/manager/seller.
- Payment status must be `payment_submitted`.
- Reserved stock must already exist.
- Set `payment_status = payment_confirmed`.
- Set order status to `confirmed`.
- Set pickup status to `awaiting_pickup`.
- Record reviewer and timestamp.
- Store optional note.
- Append a `payment_confirmed` audit event.

### `reject_preorder_payment`

Inputs:

- `p_order_id uuid`
- `p_note text default ''`

Rules:

- Caller must be owner/manager/seller.
- Payment status must be `payment_submitted`.
- Release reserved stock.
- Set `payment_status = payment_rejected`.
- Set order status/pickup status to non-fulfillable.
- Record reviewer and timestamp.
- Store note.
- Append `payment_rejected` and `stock_released` audit events.

### `expire_submitted_preorder_payments`

Inputs:

- `p_event_id uuid`
- `p_grace_hours integer default 24`

Rules:

- Automatic/system execution is allowed through a privileged service path.
- Manual execution requires owner/manager role.
- Finds `payment_submitted` pre-orders whose payment deadline plus grace period has passed.
- Releases reserved stock exactly once.
- Sets payment status to `payment_expired`.
- Sets order/pickup state to non-fulfillable.
- Appends `payment_expired` and `stock_released` audit events.

Return:

- `expired_count integer`
- `released_stock_count integer`

### Existing pickup/cancel/expire RPC updates

`mark_preorder_picked_up`:

- Must require `order_payments.payment_status = payment_confirmed`.
- Must only operate on orders already in `pickup_status = awaiting_pickup`.
- Must not allow `payment_submitted`, `payment_rejected`, or `payment_expired` orders to be picked up.

`cancel_preorder_with_stock`:

- Must release stock only when the order currently has reserved stock.
- Must handle `payment_submitted` and `payment_confirmed` without double-release.
- Must append stock release/payment cancellation audit events when payment evidence existed.

`expire_preorders_for_event`:

- Keeps the existing no-show pickup expiry behavior for `payment_confirmed` orders that reached `awaiting_pickup`.
- Must not be the only expiry path. `payment_submitted` orders use `expire_submitted_preorder_payments`.

### `list_preorder_production_summary`

Inputs:

- `p_event_id uuid`

Returns product-level summary:

- product id/name/category/image
- submitted quantity
- confirmed quantity
- rejected quantity
- total to prepare
- expected amount
- confirmed amount

Rules:

- Owner/manager/seller can access.
- Queue staff should not access unless later required.

### `list_preorder_payment_review`

Inputs:

- `p_event_id uuid`
- optional `p_payment_status text`

Returns order-level review rows with:

- customer display fields
- contact fields
- item summary
- payment status
- slip url
- review metadata

Rules:

- Owner/manager/seller can access.
- PII access must be role-checked.

## Storage

Payment evidence images should not live in a public bucket.

Recommended:

- Private bucket: `PaymentEvidence`
- Path: `{artist_id}/{event_id}/{order_id}/{uuid}.{ext}`
- Upload through signed upload URL or authenticated RPC/Edge Function if needed.
- Staff view through signed URLs generated only for role-checked users.

This is new infrastructure for this repo. Existing image buckets are public product/avatar buckets, so `PaymentEvidence` must be treated as its own implementation task with:

- bucket creation migration
- private bucket setting
- upload policy or signed upload URL flow
- signed read URL flow for role-checked staff
- tests that anon cannot read payment evidence objects

Do not fallback to a public bucket for slip/payment evidence. A public evidence bucket is not an acceptable MVP shortcut because slips can contain names, account details, transfer metadata, and other personal data. If private storage cannot be implemented in the same phase, defer slip upload rather than making slips public.

## Privacy and PDPA Notes

The UI should include short privacy text where contact and slip are collected:

```text
We use your contact and payment evidence only to manage this pre-order, payment review, and pickup. The seller's authorized staff can view it.
```

Operational requirements:

- Do not expose contact/slip data through anon table selects.
- Explicitly revoke anon column access to all new PII columns on `orders`, especially `customer_phone`, `customer_social`, and `customer_email`.
- Do not grant anon direct select on `order_payments.slip_url` or any `payment_review_events` rows.
- Keep access scoped by event role.
- Store audit records for payment confirmation/rejection.
- Keep retention policy open for now, but add an admin future task to remove old slip evidence after a defined period.

## UX Copy Rules

Avoid:

- "Payment successful" after slip upload.
- "Verified" unless a verification provider actually checked the slip.
- "NireQ confirms payment" in manual mode.

Use:

- "Payment evidence submitted"
- "Waiting for seller confirmation"
- "Seller confirmed payment"
- "Seller rejected payment evidence"

Customer receipt states:

- Awaiting payment: show payment instructions.
- Payment submitted: show waiting state and seller contact reminder.
- Payment confirmed: show pickup-ready receipt.
- Rejected: show rejection note and option to resubmit if seller allows.

## Future Slip Verification Integration

Design provider-neutral integration point:

- `payment_verifications` table or JSON fields on `order_payments`
- provider name
- provider reference id
- amount detected
- receiver detected
- transfer timestamp
- duplicate flag
- raw response stored securely
- verification status

Future flow:

1. Customer uploads slip.
2. System calls verification provider.
3. If amount/receiver match and slip is not duplicated, mark `payment_verified`.
4. Seller still confirms payment in MVP+1, but the review queue can highlight verified evidence.

Do not build provider-specific assumptions into the MVP schema.

## Implementation Sequencing

1. Customer contact and desktop pre-order layout.
2. Payment method settings for event.
3. Private `PaymentEvidence` storage bucket, signed upload/read URL path, and storage RLS/policy tests.
4. Data migration for `order_payments`, `payment_review_events`, contact fields, and explicit PII column-level grants/revokes.
5. Order creation changes: no stock reservation until evidence submission, no immediate `confirmed`/`awaiting_pickup`.
6. Payment instructions/receipt states.
7. Payment evidence upload.
8. Submit evidence RPC that reserves stock and appends audit events.
9. Seller payment review queue.
10. Confirm/reject/expire-submitted RPCs with stock release and audit events.
11. Production dashboard and CSV export.
12. Pickup payment status integration.
13. Regression and DB behavior tests.

## Testing Requirements

### DB behavior

- Create pre-order without contact fails.
- Create pre-order with phone only succeeds.
- Create pre-order with social only succeeds.
- Create pre-order with email only succeeds.
- Create pre-order does not reserve stock.
- Submitting payment evidence reserves stock.
- Submitting evidence fails when stock is no longer available.
- Confirming payment does not double-reserve stock.
- Rejecting payment releases reserved stock.
- Rejecting twice is idempotent or fails safely without double-release.
- Resubmitting after rejection reserves stock exactly once for the new submitted evidence.
- Expiring submitted payment evidence releases reserved stock exactly once.
- Existing no-show pickup expiry still works for confirmed awaiting-pickup pre-orders.
- Confirming rejected payment is blocked unless resubmission flow explicitly allows it.
- Pickup is blocked or warned for unconfirmed payment.
- Pickup converts confirmed reserved stock to sold stock.
- Anon cannot directly select customer contact or slip URL.
- Anon cannot select `customer_phone`, `customer_social`, or `customer_email` from `orders`.
- Anon cannot read private payment evidence storage objects.
- Payment review events are appended for submit, resubmit, confirm, reject, expire, reserve, and release actions.
- Receipt RPC only returns matching order/code.
- Unauthorized role cannot confirm/reject payment.

### Frontend regression

- Desktop preorder shows two-column catalog/cart layout.
- Mobile preorder remains usable.
- Contact validation blocks empty contact channels.
- Customer can create order and land on payment instructions.
- Slip upload moves receipt to waiting-for-confirmation state.
- Seller review page can confirm and reject.
- Seller review page can expire old submitted evidence.
- Production dashboard product totals update after submit/confirm/reject.
- Production dashboard product totals update after submitted evidence expires.
- Pickup list shows payment-confirmed orders as ready.
- Pickup list warns/blocks submitted but unconfirmed orders.

## Acceptance Criteria

- Customers can place pre-orders on desktop without mobile-style friction.
- A pre-order cannot be submitted without customer name and at least one contact channel.
- Creating a pre-order does not reserve stock or count toward production totals.
- Creating a pre-order does not immediately set the order to `confirmed` or `awaiting_pickup`.
- Uploading payment evidence reserves stock and counts toward production as submitted/unconfirmed.
- Seller can confirm payment after checking their bank app; confirmed orders become pickup-ready.
- Seller can reject payment evidence; rejected orders release reserved stock and leave production totals.
- Submitted payment evidence that remains unreviewed past the deadline plus grace period can be expired and releases stock.
- Seller can see a production dashboard with product-level submitted vs confirmed quantities.
- Seller can export production and customer/order CSVs.
- Pickup staff can clearly see whether payment is confirmed before handing over goods.
- NireQ never claims to hold money, verify settlement, or process payment in manual mode.
- Contact and slip evidence are protected by role checks and not exposed through anon table reads.
- Payment evidence is stored in a private bucket; public storage is not allowed for this MVP.
- Payment review history is append-only, so resubmission after rejection does not erase previous review events.

## Open Product Defaults

These defaults should be used unless user testing suggests otherwise:

- Payment evidence can be resubmitted after rejection.
- Rejected orders do not keep stock reserved.
- Seller review is required before pickup.
- Payment submitted orders are included in production dashboard but visually separated from confirmed.
- Owner/manager/seller can review payment; queue staff cannot.
- Payment method settings are owner/manager only.
