# Promotion Sales-Channel Integration — Design Spec

**Date:** 2026-09-05
**Status:** Pending written review
**Feature:** Reusable store promotions across Event Pre-order, Live Event, Event Post-order, and Online Campaign

---

## Problem

Nireq already has event promotions, but promotion definition, event selection, schedule, pricing, and reporting are coupled together. That structure does not safely cover Online Campaigns, reusable promotion runs, stock-backed gifts, overlapping promotions, or immutable pricing during a 15-minute checkout hold.

Merchants need to define a promotion once, reuse it in selected selling contexts, understand conflicts before activation, and see exactly what was discounted or gifted in each order. Customers need automatic, predictable benefits without coupon codes or silent changes at checkout.

## Goals

- Make a promotion a reusable store-level entity.
- Apply promotions to explicit sales contexts through separate assignments.
- Support Event Pre-order, Live Event, Event Post-order, and Online Campaign.
- Apply promotions automatically; coupon codes are out of scope.
- Support repeating quantity discounts, repeating quantity gifts, and spend-tier gifts.
- Reserve finite purchased stock and finite gift stock atomically where the sales flow uses a hold.
- Preserve the exact promotion result after an order is created.
- Detect overlapping promotion targets and let the merchant choose whether the assignments combine.
- Show promotion and gift work clearly in customer checkout, merchant orders, picking, and reporting.
- Reuse the existing promotion, product, event, campaign, order, and stock models where possible.

## Non-goals

- Coupon or voucher codes.
- Percentage discounts, fixed order discounts, shipping discounts, memberships, customer segments, or usage caps.
- A generic promotion rules engine or expression language.
- Product-line targeting as a separate rule type.
- Automatic monetary valuation of gifts when comparing exclusive promotions.
- Conversion analytics that requires visitor, impression, or abandoned-cart tracking.
- Seller-facing version management or rollback of promotion revisions.
- A generic `sales_channels` parent table.

---

## Core Decisions

| Area | Decision |
|---|---|
| Ownership | A promotion belongs to one store/artist and is reusable |
| Usage | Each sales context and schedule is a separate assignment |
| Automatic application | Eligible promotions apply without a code |
| Quantity repetition | Every complete group qualifies; e.g. 6 items on “every 3 save ฿50” saves ฿100 |
| Spend basis | Net eligible merchandise after quantity discounts; excludes shipping and reward lines |
| Reward stock | A finite reward is reserved and sold through the same channel stock as merchandise |
| Unlimited rewards | Recorded for production/fulfillment without decrementing stock |
| Existing orders | Keep their original promotion snapshot even when the merchant edits an active promotion |
| Open carts | Recalculate from current rules and require confirmation when the payable result changes |
| Overlap | Detect likely collisions before activation; store the merchant's combination choice per assignment |
| Live Event | No 15-minute hold; finalize merchandise and reward stock when staff completes paid checkout |
| Other sales flows | Pre-order, Post-order, and Online Campaign hold merchandise and rewards for 15 minutes |

---

## Promotion Types

### 1. Repeating quantity discount

Example: **Every 3 qualifying items, save ฿50**.

- Count complete groups of `buy_quantity`.
- Multiply the fixed discount by the number of groups.
- There is no per-order repetition cap in this release.
- Customer copy must say “Every 3…” / “ทุก 3 ชิ้น…” so six qualifying items clearly receive two discounts.

### 2. Repeating quantity gift

Example: **Every 3 qualifying items, receive 1 gift**.

- Count complete qualifying groups.
- Multiply the reward quantity by the number of groups.
- The merchant chooses either a fixed reward or customer choice among approved reward products.
- A fixed reward is added automatically.
- When customer choice is required, checkout cannot complete until all earned selections are made.

### 3. Spend-tier gift

Example tiers: net eligible merchandise of ฿500, ฿1,000, and ฿2,000, each with different rewards.

- Evaluate tiers after quantity discounts.
- Exclude shipping and reward lines priced at ฿0 from the qualifying amount.
- The merchant chooses one tier behavior for the promotion:
  - **Highest tier only:** grant only the highest reached tier.
  - **Cumulative:** grant every reached tier.
- Customer-facing copy must state which behavior applies.

## Eligible Product Scope

New promotion authoring supports:

- all sellable products in the assignment's channel;
- explicitly selected products;
- one category;
- one tag;
- category plus tag.

Product line remains the catalog's variant group, not a promotion target type. The product picker offers **Select all variants** for a variant group. Category plus tag is the dynamic grouping mechanism for collections such as Hairclip + Genshin Impact.

Eligibility resolves against the actual catalog assigned to the Event or Online Campaign. Products not present in that sales context cannot qualify and cannot be selected as rewards there.

---

## Architecture

Use the approved **central promotion plus assignments** model:

```text
Store Promotion
├── rule and eligible product scope
├── quantity reward or spend tiers
├── reward product choices
└── Assignment
    ├── exact Event phase or Online Campaign
    ├── active schedule and pause state
    └── overlap/combination policy
```

Do not introduce a generic rule engine or generic sales-channel entity. Event and Online Campaign references remain explicit so database foreign keys and authorization stay understandable.

The existing TypeScript promotion calculator may remain as a preview helper, but checkout uses one authoritative database pricing path shared by every selling flow.

---

## Data Model

### `artist_promotions`

Reuse and extend the existing table as the central definition.

| Field | Purpose |
|---|---|
| `id`, `artist_id`, `name` | Existing identity and ownership |
| `promotion_type` | `quantity_discount`, `quantity_gift`, or `spend_tier_gift` |
| `target_type` | `all`, `product`, `category`, `tag`, or `category_tag` |
| existing target columns | Eligible product selection |
| `buy_quantity` | Group size for quantity types; null for spend tiers |
| `discount_amount` | Fixed discount per complete group |
| `reward_quantity` | Gifts per complete group for quantity gifts |
| `tier_grant_mode` | `highest_only` or `cumulative` for spend-tier gifts |
| `reward_selection_mode` | `fixed` or `customer_choice` for quantity gifts |
| `lifecycle_status` | `draft`, `ready`, or `archived` |
| `revision` | Incremented whenever commercial terms change |
| `updated_by`, timestamps | Minimal edit audit metadata |

The existing active window and event arrays stop being the source of truth after migration. Scheduling and placement move to assignments.

### `promotion_assignments`

| Field | Purpose |
|---|---|
| `id`, `promotion_id`, `artist_id` | Identity and ownership |
| `event_id` | Nullable Event reference |
| `event_phase` | `preorder`, `live`, or `postorder` when `event_id` is set |
| `campaign_id` | Nullable Online Campaign reference |
| `starts_at`, `ends_at` | Optional assignment-specific window |
| `is_paused` | Immediate merchant pause without changing the central definition |
| `combination_policy` | `combine` or `exclusive` |
| timestamps | Assignment history |

A constraint requires exactly one context:

- Event plus one Event phase, or
- Online Campaign with no Event phase.

Assignment state is derived as scheduled, active, ended, or paused. An ended assignment is not reopened. Reuse is done by creating a new assignment from the same central promotion.

An assignment is effective only while its central promotion is Ready, it is not paused, its own window is open, and the referenced sales context and Event phase are open. An assignment never extends a closed Event phase or Online Campaign.

### `promotion_tiers`

Spend-tier gift definitions:

- `id`, `promotion_id`;
- positive `threshold_amount`;
- `reward_quantity`;
- `reward_selection_mode` (`fixed` or `customer_choice`);
- display order and timestamps.

Thresholds are unique and ascending within a promotion.

### `promotion_reward_products`

Allowed reward options:

- `id`, `promotion_id`;
- nullable `promotion_tier_id` for spend-tier rewards;
- `product_id` referencing the shared catalog;
- optional display order.

Quantity gifts use promotion-level options. Spend-tier gifts use tier-level options. A fixed reward must have one option; customer choice must have at least two.

### Channel product rows

Add `is_sellable` to `event_products` and `online_campaign_products`, defaulting to `true`.

- A reward-only product has `is_sellable = false`, remains visible to merchant operations, and is hidden from normal customer purchase lists.
- A normally sold product may also be a reward; it keeps `is_sellable = true`.
- Finite rewards consume the same allocated channel stock counters as normal sales.
- Unlimited rewards are recorded but do not decrement stock.

### Orders and order items

Continue using `orders.pricing_breakdown` as the immutable commercial snapshot. Each applied promotion entry includes:

- promotion and assignment IDs;
- promotion revision;
- display name and customer-facing rule text;
- qualifying groups or reached tiers;
- discount granted;
- reward products and quantities granted;
- combination decision used.

Extend `order_items` with:

- `line_type`: `purchase` or `promotion_reward`;
- nullable `promotion_id`, `promotion_assignment_id`, and `promotion_tier_id`;
- reward lines have unit price `0` and are excluded from promotion qualification.

The snapshot is authoritative for historical display and analytics. Editing or archiving the current promotion never rewrites an existing order.

---

## Lifecycle and Editing

### Central promotion

- **Draft:** incomplete or not ready for assignment.
- **Ready:** valid and available for assignments.
- **Archived:** unavailable for new evaluation or assignment but retained for history; it may be restored to Ready. Archiving requires confirmation and pauses active assignments so restoring the definition cannot restart sales silently.

### Assignment

- Schedule determines scheduled, active, and ended states.
- Merchant pause takes effect immediately for new pricing calculations.
- A new assignment reuses an ended promotion in another channel or time period.

### Editing an active promotion

The merchant may correct an active promotion immediately. Before save, show:

> This promotion is active in N sales contexts. Changes affect new orders immediately.

On save:

- increment the central promotion revision;
- revalidate every active or scheduled assignment;
- block the edit until the merchant resolves any newly introduced overlap or invalid reward assignment;
- recalculate open carts when they next quote or checkout;
- preserve every already-created order, including orders inside a 15-minute hold.

There is no seller-facing version tree. `revision`, `updated_by`, and immutable order snapshots provide the required operational audit without a separate version-management workflow.

---

## Assignment and Collision Detection

Run collision analysis when:

- an assignment is created, edited, resumed, or activated;
- the central promotion's targeting or reward terms change;
- relevant channel product category, tags, inclusion, or sellability changes;
- checkout performs its authoritative calculation.

The detector:

1. Finds other active or scheduled assignments in the same Event phase or Online Campaign whose time windows overlap.
2. Resolves both target rules against the actual channel catalog.
3. Intersects the eligible product IDs.
4. Reports a collision only when the same product units could satisfy both promotions.
5. Shows a concrete cart example and resulting benefits before activation.

The merchant chooses `combine` or `exclusive` per assignment. The same product unit can satisfy both promotions only when both assignments permit combination.

If different product units independently satisfy each promotion, both apply even when the assignments are exclusive.

When colliding promotions are exclusive:

- discount versus discount: apply the option with the largest customer discount for the current cart;
- any collision involving alternative gift benefits: show the eligible benefits and require the customer to choose one promotion;
- spend-tier gifts are evaluated later from the discounted net amount and are not treated as a quantity-rule collision.

The database recalculates the result at checkout; pre-activation analysis is explanatory and cannot authorize a price by itself.

---

## Merchant Management Flow

### Entry points

Both entry points manage the same central entities:

1. **Promotion workspace:** create or edit a store promotion, then assign it.
2. **Event or Online Campaign workspace:** add an existing promotion or create one with the current context preselected.

### Authoring flow

Use a four-step form instead of one long configuration page:

1. Choose promotion type.
2. Define eligible products, quantities/tiers, and rewards.
3. Choose sales contexts, schedules, and combination behavior.
4. Review customer-facing copy, stock readiness, conflicts, and worked cart examples.

The review step blocks activation for invalid configuration, unavailable reward assignments, or unresolved collisions. It warns—but does not block—when finite reward stock is low.

### Promotion list

Show:

- draft, ready, or archived state;
- current and upcoming assignment count;
- plain-language rule summary;
- assigned contexts and dates;
- conflict or reward-stock warning;
- edit, duplicate, assign, pause-assignment, and archive actions.

---

## Customer Experience

### Before checkout

- Product and cart surfaces show plain-language promotion badges.
- Progress copy tells the customer what remains, such as “Add 1 more qualifying item to save ฿50.”
- Fixed rewards appear automatically when earned.
- Customer-choice rewards show the available options and remaining earned selections.
- Spend tiers show whether only the highest tier or all reached tiers are granted.

### Price changes

Open carts always use current promotion rules. If a promotion changes, pauses, ends, or becomes unavailable and the payable result changes, show the recalculated breakdown and require explicit confirmation before order creation.

### Reward shortage during checkout

If the selected finite reward is no longer available:

1. Do not create a partial order.
2. Explain which reward ran out.
3. Offer remaining valid reward choices.
4. If every reward for the promotion is unavailable, explicitly show **“All gifts for this promotion are out of stock” / “ของแถมสำหรับโปรนี้หมดทั้งหมดแล้ว”**.
5. Recalculate the total without that promotion and require customer confirmation before continuing.

Never silently substitute a reward, silently remove an earned benefit, or recreate a stock hold without confirmation.

---

## Pricing and Stock Flow

### Authoritative calculation order

Every checkout entry point calls one database pricing path:

1. Load current channel products, prices, stock state, and per-order limits.
2. Resolve active assignments and current promotion revisions.
3. Validate purchased quantities and eligible product sets.
4. Calculate repeating quantity discounts and quantity rewards.
5. Produce the net eligible merchandise amount after quantity discounts.
6. Evaluate spend-tier rewards from that net amount, excluding shipping and reward lines.
7. Resolve combination choices and required customer reward choices.
8. Validate all finite merchandise and reward stock.
9. Reserve or sell all affected stock in one transaction.
10. Store purchased lines, reward lines, totals, and the immutable pricing snapshot.

Browser calculations are preview-only. The server ignores client-supplied totals, discounts, reward prices, and hold deadlines.

### Event Pre-order, Event Post-order, and Online Campaign

- Creating a valid order gives the customer a fixed 15-minute payment deadline and holds finite purchased items and finite rewards together.
- If any finite line cannot be held, roll back the entire order creation transaction.
- Starting payment-evidence upload before the deadline follows the existing two-minute technical upload grace so an upload already in flight may finish; a new upload cannot start after the 15-minute deadline.
- Successfully submitted evidence keeps the hold while merchant review is pending.
- Confirmed payment converts every finite held line to sold.
- Expiry releases purchased and reward stock exactly once, even if expiry processing retries.
- A late-payment report does not re-hold stock.

### Live Event

- There is no 15-minute customer hold.
- Staff sees the promotion and reward result before accepting payment.
- Completing paid POS checkout atomically records the order and moves finite purchased and reward quantities to sold.
- Failure on any line rejects the complete checkout so staff can correct the cart.

### Unlimited rewards

Unlimited reward lines are recorded with their earned quantities for production, picking, and analytics. They do not reserve or decrement stock.

---

## Merchant Orders and Reporting

### Order list and detail

- Mark orders that used promotions or contain rewards.
- Filter orders by promotion and by **Has gifts**.
- Separate purchased items, discounts, and reward items visually.
- Label each reward line **Gift from [promotion name]**, with price ฿0 and its stock state.
- Show the immutable rule summary and revision used by the order.

### Picking and fulfillment

- Include reward lines in picking and packing work.
- Aggregate gift SKUs separately in printable/exported picking totals.
- Keep reward status visible so staff cannot overlook a gift.

### Promotion reporting

Show lifetime totals and a per-assignment breakdown for:

- orders using the promotion;
- qualifying groups or reached tiers;
- total discount granted;
- reward quantity by SKU;
- gross merchandise amount before promotion;
- net merchandise amount after promotion.

Do not label these metrics as conversion or incremental revenue. Those require traffic and counterfactual data not collected in this release.

---

## Security and Authorization

- RLS permits merchant management only for promotions and assignments owned by that merchant's artist/store.
- Public customers may receive only active, public-safe promotion data for the requested Event phase or Online Campaign.
- Customer-facing RPCs do not expose internal notes, conflict examples, other channel assignments, or merchant-only analytics.
- Every referenced eligible or reward product must belong to the same artist.
- Every assignment must point to an Event or Online Campaign owned by the same artist.
- Checkout accepts product IDs, quantities, customer choices, and an idempotency key; it derives all money and stock effects server-side.
- Promotion editing cannot mutate order snapshots or reward order lines.
- Privileged credentials remain server-only.

---

## Error Contracts

Use stable machine codes with localized Thai and English UI copy:

| Code | Customer/merchant response |
|---|---|
| `promotion_changed` | Show the new breakdown and require confirmation |
| `promotion_choice_required` | Show mutually exclusive benefits or missing reward selections |
| `promotion_reward_unavailable` | Explain the unavailable reward and show alternatives |
| `promotion_rewards_exhausted` | State that all gifts are out of stock, show the no-promotion total, and require confirmation |
| `promotion_conflict_unresolved` | Block assignment activation and show the worked conflict example |
| `sale_product_unavailable` | Name the purchased item and current available quantity |
| `order_request_replayed` | Return the existing order for the same idempotency key |

Do not surface raw database error text to customers.

---

## Compatibility and Migration

Migrations are append-only.

1. Extend the central promotion table and add assignment, tier, and reward-option tables.
2. Add reward metadata to order items and `is_sellable` to channel product tables with backward-compatible defaults.
3. Convert current fixed quantity-discount promotions into central definitions and create assignments for their currently included, non-excluded Events.
4. Preserve current promotion schedules on the generated assignments.
5. Preserve legacy “free eligible units” behavior as a hidden legacy promotion type because existing rows do not identify a reward SKU. Existing orders and rules remain readable; merchants create a new stock-backed gift promotion when they want the new behavior.
6. New Events do not automatically inherit formerly global rules. The merchant assigns the reusable central promotion explicitly, matching the new model.
7. Keep existing `orders.pricing_breakdown` records unchanged and make analytics understand both old and new snapshot shapes.
8. Switch customer and POS flows to the authoritative calculator one flow at a time behind the existing DEV deployment process.

No historical order, payment, or stock counter is rewritten.

---

## Testing and Definition of Done

### Pricing tests

- repeating quantity discounts across one and multiple products;
- fixed and customer-choice quantity rewards;
- highest-only and cumulative spend tiers;
- spend thresholds after quantity discounts and without shipping/reward value;
- eligible targets for product, category, tag, category plus tag, and all products;
- combined and exclusive overlaps, including best discount and customer benefit choice;
- changed or paused promotion between cart quote and checkout.

### Stock and transaction tests

- merchandise and reward reservation succeeds or rolls back together;
- two customers race for the final reward;
- expiry releases every finite line exactly once;
- payment confirmation converts holds to sold exactly once;
- idempotent checkout returns the same order without a second deduction;
- unlimited rewards record quantity without stock mutation;
- Live Event sells atomically without a hold;
- late-payment reporting never restores a released hold.

### Security and compatibility tests

- cross-artist promotion, assignment, product, reward, and analytics access is rejected;
- anonymous users see only active public-safe promotion data;
- tampered client totals, discounts, reward lines, and deadlines are ignored or rejected;
- migrated discount and legacy free-unit promotions preserve current behavior;
- existing Event checkout, Pre-order, Post-order, Online Campaign, payment evidence, order-status, and fulfillment regressions remain green.

### UI acceptance

- Thai and English copy describes repeated discounts and tier behavior unambiguously;
- customer sees progress, applied benefits, reward choices, changed-price confirmation, and explicit all-gifts-exhausted messaging;
- merchant can create, assign, simulate, edit, pause, reuse, and inspect a promotion;
- order detail and picking show reward lines clearly;
- keyboard, focus, touch-target, status-text, and contrast behavior meet the repository's WCAG AA target.

Before handoff, run the narrow promotion/checkout/security suites and `npm run verify`. DEV deployment requires committing and pushing the intended changes before deploy. Production deployment remains out of scope without explicit approval.
