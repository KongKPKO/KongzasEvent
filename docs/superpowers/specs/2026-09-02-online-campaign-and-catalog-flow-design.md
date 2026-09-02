# Online Campaign and Catalog Flow — Design Spec

**Date:** 2026-09-02
**Status:** Pending written review
**Feature:** Online sales campaigns with reserved stock, manual-payment review, shipping, and merchant pickup points

---

## Problem

Nireq's current sales model is centered on physical events. Live-event orders correctly require a queue and are paid at the booth, while pre-order and post-event orders reuse the event catalog and payment workflow. A separate online sale needs different behavior:

- no queue or physical event dependency;
- campaign-specific products and allocated stock;
- a fixed 15-minute payment window;
- shipping or pickup at a merchant-defined point;
- a flat shipping fee per order;
- clear handling for late payment evidence after stock has been released;
- a merchant workspace that separates payment review from fulfillment work.

The catalog setup also exposes too many concepts at once, makes product-to-event assignment hard to discover, presents variants through a pipe-delimited bulk form, and leaves much of the creator workspace untranslated when Thai is selected.

---

## Goals

- Add Online Campaign as a first-class entity separate from Physical Event.
- Preserve the current live-event queue and pay-at-booth flow unchanged.
- Reuse the existing product catalog, order records, payment evidence, review history, and stock-accounting patterns.
- Give every campaign its own product allocation, price overrides, and stock counters.
- Reserve limited campaign stock transactionally for 15 minutes.
- Support one fulfillment method per order: shipping or one pickup point.
- Calculate flat shipping fees and final totals on the server.
- Keep closed campaigns understandable and reachable without allowing new checkout.
- Handle late payment evidence without silently losing a payment or letting a customer continue holding stock.
- Simplify catalog creation, product assignment, variants, and SKU management.
- Make every new or changed surface fully bilingual in Thai and English.

## Non-goals

- Mixed shipping and pickup within one order.
- Per-product shipping fees, weight-based rates, carrier quoting, or international tax calculation.
- Pickup-point capacity limits.
- Automatic refunds or bank-account reconciliation.
- A generic `sales_channels` database abstraction.
- A global inbox combining live-event, pre-order, post-event, and online-campaign orders.
- Campaign-specific promotion authoring; `discount_total` remains `0` in the first release.
- A full Shopify-style multi-option variant matrix.
- A whole-site translation rewrite in this feature.

---

## Decisions

| Area | Decision | Reason |
|---|---|---|
| Sales entity | `online_campaigns` is separate from `events` | Queue, POS, venue, and live-event timing must not leak into online sales |
| Shared catalog | Reuse `products` as the merchant's product library | Products are created once and assigned to a selling context |
| Campaign allocation | Add `online_campaign_products`, mirroring `event_products` | Reuses the proven price/stock allocation model without a generic channel layer |
| Fulfillment | One order chooses shipping or one pickup point | Keeps checkout, fees, fulfillment, and support understandable |
| Shipping fee | One merchant-configured flat fee per campaign order | Matches the approved business rule and avoids speculative rate logic |
| Hold duration | 15 minutes from order creation | Approved fixed customer payment window |
| Upload race | Allow a maximum two-minute technical upload grace only when submission starts before the deadline | Prevents a file upload crossing the deadline from losing reserved stock |
| Late evidence | Release stock at expiry; late evidence creates a payment exception and never re-holds stock | Prevents abuse while preserving a path for customers who already transferred money |
| Closed campaign | Remains public and read-only; moves to past campaigns | Shared links remain meaningful and customers can revisit product information |
| Archived campaign | Hidden from storefront; direct campaign URL says it is no longer public | Merchant controls public history without breaking order-status access |
| Order storage | Reuse `orders`, `order_items`, `order_payments`, and `payment_review_events` | Keeps reporting and payment history in one system |
| Stock conversion | Campaign reserved stock becomes sold when payment is confirmed | Matches the approved online-sale lifecycle; fulfillment must not decrement stock again |
| SKU | Generate one stable SKU for each sellable product row/variant | Supports search, CSV, POS, and operations without asking merchants to invent identifiers |
| Variant storage | Keep the current flat product-row model and group it in the UI | Avoids a high-risk catalog migration while improving the merchant experience |
| Language | Explicit translation keys on touched screens | The legacy DOM text-replacement approach is incomplete and fragile |

---

## Architecture

```text
Product Catalog
├── Physical Event
│   └── event_products
│       ├── preorder
│       ├── live queue / POS
│       └── post-event
└── Online Campaign
    └── online_campaign_products
        ├── 15-minute stock hold
        ├── manual payment evidence
        └── shipping or merchant pickup
```

`Online Campaign` is the entity. "Sales channel" remains a product and UI concept describing where a catalog item is sold. It does not become a shared parent table or polymorphic foreign key.

The Event and Campaign assignment screens may reuse layout, validation, and stock-allocation behavior. Shared code should be extracted only where the two real implementations are identical.

---

## Catalog and Product Setup

### Quick product creation

The primary form shows only:

- product name;
- base price;
- stock mode and quantity;
- image.

Defaults:

- currency comes from the workspace or selling context;
- category defaults to `Other`;
- status defaults to active;
- sort order is automatic.

Advanced fields contain category, tags, and description. Variant fields do not appear in the primary product form.

### SKU

Add `products.sku` with a case-insensitive unique constraint per artist. New products receive a database-generated uppercase identifier such as `NQ-A82K91`. The SKU is stable across renames and is editable from Advanced settings. Each current product row, including each variant row, receives its own SKU.

### Variants

Continue using `variant_group_name`, `variant_name`, and `variant_sort_order`. Present grouped products as one product line with a row editor:

| Option | Stock | Price override | SKU |
|---|---:|---:|---|
| Paimon | 30 | — | generated |
| Aether | 20 | 250 | generated |

The default action is **Add option**. Pipe-delimited paste and CSV import remain available under Advanced or Bulk tools.

### Assigning products to a sale

After saving a product, the next action is **Add to sale**, followed by an Event or Online Campaign selection, allocated quantity, and optional price override.

The inverse path is also available inside an Event or Campaign workspace:

```text
Add products
→ choose products from Catalog
→ allocate stock and optional price override
→ save
```

Templates and Import remain available as secondary bulk tools, not equal-weight primary tabs.

---

## New Tables

### `online_campaigns`

| Column | Purpose |
|---|---|
| `id` | UUID primary key |
| `artist_id` | Owning creator |
| `name` | Merchant-facing and public name |
| `slug` | Public URL segment, unique per artist |
| `description` | Public campaign copy |
| `opens_at`, `closes_at` | Sale window as `timestamptz` |
| `campaign_timezone` | Display and input timezone; default `Asia/Bangkok` |
| `currency` | Single campaign currency |
| `shipping_enabled` | Enables shipping checkout |
| `flat_shipping_fee` | Non-negative fee added once per shipping order |
| `pickup_enabled` | Enables pickup checkout |
| `publication_status` | `draft`, `published`, `cancelled`, or `archived` |
| `created_at`, `updated_at` | Audit timestamps |

Publish validation requires a valid window, at least one enabled product, at least one fulfillment method, enabled payment instructions, and at least one enabled pickup point when pickup is enabled.

### `online_campaign_products`

Mirror the proven `event_products` shape:

- `id`, `campaign_id`, `product_id`, `artist_id`;
- `is_enabled`;
- `price_override`;
- `stock_total`, `stock_reserved`, `stock_sold`;
- `is_unlimited`;
- timestamps;
- unique `(campaign_id, product_id)`;
- non-negative price and stock constraints.

Finite campaign allocation is reserved from central catalog availability. Availability is:

```text
stock_total - stock_reserved - stock_sold
```

### `campaign_pickup_points`

- `id`, `campaign_id`, `artist_id`;
- `name`, `address`;
- `starts_at`, `ends_at`;
- `instructions`;
- `is_enabled`;
- timestamps.

Pickup can occur after the campaign sale closes. The only time constraint is `ends_at > starts_at`.

### `campaign_payment_methods`

Mirror `event_payment_methods` for PromptPay, bank transfer, uploaded QR, and other merchant instructions. Campaign payment methods do not have an order payment deadline; the order's stock-hold deadline is authoritative.

---

## Existing Table Changes

### `orders`

- make `event_id` nullable;
- add nullable `campaign_id` referencing `online_campaigns`;
- require exactly one of `event_id` or `campaign_id`;
- extend `order_type` with `online_sale`;
- add `fulfillment_method` with `shipping | pickup` for online orders;
- add non-negative `shipping_fee`, default `0`;
- add nullable `pickup_point_id`;
- add `pickup_point_snapshot jsonb` so later pickup-point edits do not rewrite an order;
- reuse customer, shipping address, tracking, cancellation, and public order-code fields;
- generate campaign order codes with at least 50 bits of randomness while keeping them human-readable.

For compatibility, the database column `pickup_status` continues to store fulfillment state. New UI and TypeScript names present it as **Fulfillment status**.

Online-order constraints:

- shipping requires `shipping_enabled`, customer phone, and shipping address;
- pickup requires an enabled point belonging to the same campaign;
- pickup orders have `shipping_fee = 0`;
- all online orders require customer name and email;
- pickup additionally requires at least one contact method;
- order currency must equal campaign currency.

### `order_items`

Add nullable `campaign_product_id`. An online order item must reference a campaign product from the order's campaign. `price_per_unit` and currency remain immutable order snapshots.

### `order_payments`

- make `event_id` nullable;
- add nullable `campaign_id`;
- require the same source as the parent order;
- reuse `stock_hold_expires_at` and `slip_url`;
- add `evidence_upload_started_at` and `upload_grace_expires_at`;
- add `late_payment_reported_at`;
- add refund audit fields: `refunded_at`, `refunded_by`, `refund_note`, `refund_reference`, and `refund_evidence_url`.

Extend payment status with:

- `payment_submitted_late`;
- `refund_pending`;
- `refunded`.

### `payment_review_events`

Make `event_id` nullable, add `campaign_id`, and require exactly one source. Add audit event types for late evidence, refund required, and refund completed.

---

## Campaign Lifecycle and Public Visibility

Only `publication_status` is stored. The public sales state is derived:

| Public state | Rule | Storefront behavior |
|---|---|---|
| Draft | Not published | Hidden |
| Scheduled | Published and before `opens_at` | Listed with opening time; read-only |
| Open | Within window and at least one enabled item is available | Listed prominently; checkout enabled |
| Sold out | Within window and no enabled item is sellable | Listed with sold-out label; read-only |
| Closed | At or after `closes_at` | Moved to Past Campaigns; read-only |
| Cancelled | Merchant cancelled | Shows cancellation notice; checkout disabled |
| Archived | Merchant archived | Hidden; direct campaign URL says no longer public |

Sold out is reversible: adding campaign stock immediately makes the campaign Open again while the sale window remains active. Any enabled unlimited-stock item prevents the campaign from becoming Sold out.

The public route is `/:artistSlug/campaign/:campaignSlug`. Existing and new orders continue to use `/:artistSlug/order/:code`, independent of campaign visibility.

Closed and cancelled campaign pages remain reachable so social links are meaningful. They show campaign details and products without quantity controls or cart actions. Archived campaigns do not expose their catalog, but their order-status pages remain available.

---

## Customer Checkout and Pricing

The customer selects one fulfillment method for the entire cart.

### Shipping

- require recipient name, email, phone, and shipping address;
- copy the campaign flat fee to `orders.shipping_fee`;
- compute total on the server.

### Pickup

- require customer name, email, and a contact method;
- require one enabled campaign pickup point;
- copy point name, address, window, and instructions to `pickup_point_snapshot`;
- set `shipping_fee = 0`.

Server formula:

```text
total_price = subtotal_price - discount_total + shipping_fee
```

`discount_total` is `0` for the first Online Campaign release. The stored field and formula remain compatible with a separately designed promotion feature later.

The client sends product IDs, quantities, fulfillment selection, and customer input. It never supplies authoritative prices, discounts, fees, availability, or totals.

Checkout uses `client_request_id` for idempotency. A transaction locks the relevant campaign product rows, validates the campaign window and fulfillment selection, calculates pricing, creates order items and payment state, increments reserved stock, and sets `stock_hold_expires_at = now() + 15 minutes`.

Campaign closure prevents new checkout but does not invalidate a previously created order. An existing order may complete payment through its own 15-minute window.

---

## Payment and Stock Lifecycle

| Event | Order status | Payment status | Fulfillment status | Campaign stock |
|---|---|---|---|---|
| Checkout succeeds | `draft` | `awaiting_payment` | `not_required` | Available → Reserved |
| Evidence completes on time | `draft` | `payment_submitted` | `not_required` | Remains Reserved |
| Deadline and grace pass without evidence | `cancelled` | `payment_expired` | `expired` | Reserved → Available |
| Merchant confirms payment | `confirmed` | `payment_confirmed` | `awaiting_shipment` or `awaiting_pickup` | Reserved → Sold |
| Merchant rejects ordinary evidence | `cancelled` | `payment_rejected` | `cancelled` | Reserved → Available |
| Customer cancels before evidence | `cancelled` | `payment_cancelled` | `cancelled` | Reserved → Available |
| Shipping/pickup completes | `completed` | `payment_confirmed` | `shipped` or `picked_up` | No stock change |

Submitting valid evidence stops normal expiry while the merchant reviews it.

Cancellation after payment confirmation never automatically returns sold stock. Refund and restock are separate merchant decisions because goods may already be packed, damaged, or otherwise unavailable.

### Technical upload grace

The customer must begin evidence submission before the 15-minute deadline. A server call records `evidence_upload_started_at` and sets:

```text
upload_grace_expires_at = min(now() + 2 minutes, stock_hold_expires_at + 2 minutes)
```

The expiry job waits until the later of the normal deadline and this capped grace. Each order receives at most one grace period. Successful upload changes the status to `payment_submitted`; failure to finish by the grace deadline expires the order and releases stock.

The customer-facing payment deadline remains 15 minutes. The maximum technical stock hold is 17 minutes only when upload starts before the deadline.

### Late-payment exception

After expiration:

- the stock remains released;
- the QR/payment instructions are hidden;
- the expired order page remains accessible;
- the page offers **Transferred already? Notify the shop and attach your slip**;
- the customer may also return to the campaign and create a new order if sales remain open.

Late evidence is tied to the expired order code and changes payment status to `payment_submitted_late`. It never reserves stock. The customer sees that the shop received the evidence but the original items are no longer reserved.

Reporting late payment never extends the expired deadline or changes campaign availability. An expired order may have only one unresolved late-payment report; retrying the same submission is idempotent rather than creating more merchant work.

The merchant sees the order under **Needs action → Payment issues** and chooses:

1. **Accept order** — transactionally verify current availability, move available stock directly to sold, change the expired/cancelled order back to `confirmed`, set payment to `payment_confirmed`, and start fulfillment. If stock is insufficient, this action is unavailable.
2. **Refund required** — keep the order and fulfillment cancelled, set payment to `refund_pending`; the merchant returns money outside Nireq and records **Refunded** with note or evidence.
3. **Reject invalid evidence** — use `payment_rejected` only when the submitted evidence does not represent a valid transfer and no refund is owed.

The system never takes stock away from a newer confirmed customer to satisfy a late payment.

---

## Merchant Information Architecture

### Main navigation

Add **Online Sales** beside Events and Catalog. Its badge counts only work requiring merchant action:

- payment evidence awaiting review;
- late-payment issues;
- orders awaiting shipment;
- orders awaiting pickup.

Orders merely awaiting customer payment are excluded.

### Online Campaigns

List campaigns by Active, Scheduled, and Past. Each row/card shows campaign state, confirmed revenue, stock health, pending payment reviews, shipments, and pickups. Primary actions are Open Workspace and View Storefront. Duplicate and Archive are secondary actions.

### Campaign Workspace

Use four tabs:

1. Overview
2. Products
3. Orders
4. Settings

Overview prioritizes actionable counts, stock warnings, confirmed revenue, sale window, and storefront sharing.

### Orders

Default filter: **Needs action**.

Available filters:

- awaiting customer payment;
- payment review;
- payment issues;
- awaiting shipment;
- awaiting pickup;
- completed;
- cancelled/expired/refunded;
- all.

Search covers order code, customer identity/contact, product name, and SKU.

Each list row shows order code and time, customer, item summary, fulfillment method, subtotal/discount/shipping/total, payment status, fulfillment status, and the one relevant next action.

Order detail uses a bookmarkable route and shows:

- order and customer data;
- immutable item and price snapshots;
- shipping address or pickup snapshot;
- payment evidence and review timeline;
- fulfillment tracking;
- staff actions and actor identity.

The primary action changes with state: Review evidence, Resolve payment issue, Add tracking and ship, Mark picked up, or View details.

A global cross-channel Orders page is deferred until merchants routinely operate multiple concurrent campaigns. Existing event history remains event-scoped.

---

## Server Operations

Use campaign-specific public RPCs rather than forcing campaign semantics into event-named functions. Reuse existing private helpers only where their contracts are genuinely source-independent.

Required operations:

- create/update/publish/archive campaign;
- save campaign catalog allocation;
- list public campaign and sellable products;
- create idempotent online order with stock hold;
- begin payment-evidence upload grace;
- complete ordinary or late evidence submission;
- expire one or all due online holds;
- confirm/reject ordinary payment;
- accept late payment when stock remains;
- mark refund required/refunded;
- mark shipped or picked up without another stock transition;
- cancel an eligible order;
- fetch a masked public order by artist slug and order code;
- list merchant campaign orders and action counts.

Extend the existing scheduled expiry job to invoke online-order expiry. Do not add a second scheduler for the same cadence.

All stock transitions lock the affected campaign product rows and are idempotent.

---

## Error Handling

| Condition | Behavior |
|---|---|
| Product sells out between cart and checkout | Do not create an order; return affected items and refresh cart availability |
| Campaign closes before checkout commits | Reject new checkout; existing orders remain accessible |
| Pickup point becomes unavailable | Reject checkout and require a new fulfillment selection |
| Pickup point changes after order | Preserve and display the order snapshot |
| Evidence upload fails before deadline | Keep awaiting payment and allow retry within the remaining time |
| Evidence upload began before deadline | Apply the single capped two-minute grace |
| Evidence arrives after full expiry | Record late-payment exception without re-reserving stock |
| Two staff review simultaneously | First valid transition wins; second receives current state and UI refreshes |
| Ship/pickup action repeats | Return the existing result without changing stock |
| Realtime connection drops | Refetch on reconnect/window focus and provide manual refresh |
| Campaign payment or fulfillment settings become invalid | Block publish or new checkout; never rewrite existing orders |

Errors use stable machine codes from RPCs and translated Thai/English customer copy. Raw database messages are not exposed.

---

## Authorization and Privacy

- Public users may read only published campaign data belonging to a public, verified, published creator.
- Direct public writes to campaign stock, orders, payments, and review history are denied.
- Public checkout, evidence submission, cancellation, and order lookup use narrowly scoped security-definer RPCs.
- Owner and manager may configure campaigns, allocate stock, review payments, cancel orders, and resolve refunds.
- Seller may view the minimum customer data needed for fulfillment and mark shipped/picked up, but may not edit campaign or payment settings or confirm/reject payments.
- Every mutation verifies `artist_id`, source ownership, role, campaign state, and expected prior state.
- Customer addresses and unmasked contact information never appear in campaign catalog queries.
- Public order lookup requires artist slug plus a high-entropy order code and returns masked contact data where full data is unnecessary.
- Order, payment, and review records reference either an Event or Campaign, never both and never neither.

---

## Internationalization

Every new or modified Campaign, Catalog assignment, Variant, Checkout, Order, Payment issue, Refund, and Fulfillment surface uses explicit `t()` keys with complete Thai and English copy.

Merchant-entered product names, campaign descriptions, pickup instructions, and bios are not machine-translated.

The legacy DOM localization pass remains temporarily for untouched pages. Touched pages must not add new entries to it. Removing that legacy mechanism across the entire application is a separate follow-up after explicit-key coverage is complete.

---

## Testing

### Database and money/stock regression

- Two customers race for the last unit; exactly one order succeeds.
- Checkout retry with the same request ID returns one order and one reservation.
- Expiry releases the exact reserved quantities once.
- Evidence submitted before the deadline prevents normal expiry.
- Upload started before the deadline receives at most one two-minute grace.
- Failed grace upload expires and releases stock.
- Confirmed payment converts reserved to sold exactly once.
- Rejected ordinary evidence releases stock exactly once.
- Fulfillment never increments sold stock again.
- Shipping total equals subtotal minus discount plus flat fee.
- Pickup always has zero shipping fee.
- Client-supplied price, fee, total, or availability is ignored.
- Late evidence never reserves stock.
- Accepting late evidence succeeds only when current stock is sufficient.
- Refund state records actor, time, and note/evidence without changing stock automatically.
- Campaign closure blocks new checkout but not an existing unexpired order.

### Security suite

- Artist A cannot read or mutate Artist B campaigns, allocations, orders, payments, or customer data.
- Anonymous users cannot directly write stock, order, payment, or review tables.
- Seller cannot edit campaign/payment settings or review payments.
- Event/Campaign source exclusivity constraints hold across orders, payments, reviews, and order items.
- Campaign product references always belong to the order's campaign.
- Public order lookup does not expose unmasked private fields.

### Browser regression

- Create, configure, publish, close, cancel, and archive a campaign.
- Assign products and allocated stock from Catalog.
- Create a simple product and grouped variants with generated SKUs.
- Checkout with shipping and pickup.
- Render countdown, begin upload grace, expire, and restore catalog availability.
- Submit ordinary evidence and complete merchant review.
- Submit late evidence and complete both accept-if-stock and refund paths.
- Fulfill shipping with tracking and complete pickup.
- Verify Online Sales badges, order filters, search, and bookmarkable order detail.
- Verify closed and archived storefront behavior.
- Verify Thai and English on every changed screen.

Run the focused local suites while developing, then `npm run verify`. Because this feature changes money, stock, authorization, and RLS, run the full security suite locally and against DEV. Production deployment and remote production migrations require a separate explicit approval.

---

## Delivery Boundaries

The feature should be implemented in reviewable slices while preserving this single product model:

1. schema, constraints, RLS, and server operations;
2. simplified catalog/SKU/variant and campaign product assignment;
3. campaign setup and public storefront;
4. checkout, payment hold, upload grace, and late-payment exception;
5. merchant orders, fulfillment, refunds, and translated UI;
6. local and DEV regression/security verification.

Physical Event behavior remains unchanged throughout. No production deploy is part of this design approval.
