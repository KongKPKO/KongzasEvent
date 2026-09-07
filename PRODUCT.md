# Product

## Users

Nireq serves creator-booth operators, booth staff, and event visitors at high-traffic events such as fan conventions, artist alleys, pop-up markets, and cosplay or game events.

Creators and managers use the admin workspace to configure events, catalog stock, pre-orders, pickup, queue operations, POS checkout, dashboard metrics, and order records. Sellers and queue staff use focused operational screens during live booth hours. Customers use mobile pages to discover booths, join queues, browse menus, pre-order, and track their status without relying on noisy chat groups.

## Product Purpose

Nireq reduces booth congestion and checkout confusion by connecting event setup, customer queueing, digital menus, stock-aware ordering, POS checkout, pre-order reservations, pickup fulfillment, and post-event records in one lightweight workflow.

Success means booth teams can open operations quickly, see the next task for each event, sell without overselling stock, call or serve queues clearly, fulfill pre-orders safely, and review orders after the event.

## Commerce Rules

These are agreed business rules, not a claim that every deployment has passed every regression. Detailed specs below explain individual flows; deployment status must be checked separately.

### Sales channels and fulfillment

- Online Campaign is a separate entity from Physical Event. It uses explicitly allocated catalog stock, not an implicit shared pool with an Event.
- Event Pre-order, live-day sales and Post-order remain distinct phases. Live-day queue/POS must not acquire the online payment timer.
- Online Campaign supports shipping or pickup. Shipping is a merchant-defined flat fee per order, included in the checkout total. The merchant can configure multiple pickup points with dates/times; the customer chooses at checkout.
- A closed Campaign stops new checkout but keeps its closed storefront and existing order lookup accessible according to visibility rules. Do not redirect customers away from an expired order's payment-exception route.
- Purchase limits are optional, per product within each Campaign, per order. Unset means unlimited by this rule, not unlimited stock. This is not a per-person limit across multiple orders.

### Payment and reservations

- Online Campaign, Pre-order and Post-order hold finite purchased items and gifts together for a fixed 15-minute payment window after order creation. Adding to cart alone does not hold stock.
- An evidence upload begun before the deadline may use the existing two-minute technical grace. It is not an extra payment window or permission to start a new normal upload after expiry.
- Submitted evidence keeps stock committed pending review. Unsubmitted expired holds release stock once; retrying expiry must not release twice.
- Late-payment reports do not automatically restore an expired hold or reclaim stock from another buyer. The merchant must resolve payment and fulfillment explicitly.
- Live-day sales have no 15-minute online payment timer. Preserve existing queue reservations; staff payment completion finalizes stock.
- An order successfully created in its hold window already owns its price/promotion snapshot. Later promotion edits must not reprice that order.

### Products, SKU and stock

- Each variant is a separately countable product with its own UUID and SKU. A variant group organizes products; it is not a shared stock pool.
- UUID is the reference identity. SKU is a readable merchant-editable identifier unique within the shop; do not parse it to identify products or require a shop-name prefix. Name-derived SKU generation is a heuristic, not semantic recognition.
- `stock_total` / legacy RPC `on_hand` is the recorded stock total, not a count of unsold physical items in the merchant's possession. This task does not implement physical warehouse custody tracking.
- Channel commitments include sold units, outstanding holds, and unused allocation while the channel is active. Holds inside active allocation are counted once, not again on top of that allocation.
- Catalog ready-to-allocate = recorded total − catalog-level sold/held − channel sold − channel outstanding holds − active unused allocation.
- Closing, archiving or disabling a channel releases only its unused allocation. Sold units and outstanding holds remain committed. Actual hold release restores capacity; refund alone does not mean returned merchandise is sellable again.
- Example: total30, Campaign allocation20 → ready10. Sell1 → ready10. Close with sold1 and held1 → ready28. Release that hold → ready29.
- The summary RPC, Event adjustment capacity and allocation limits must agree. Do not change actual stock counters to make a misleading display add up.

### Promotions

- Promotions are reusable shop-level definitions with separate channel/time assignments. They apply automatically when eligible; there is no discount-code workflow.
- Supported rules: every X eligible items discounts Y money; every X eligible items earns Y gifts; net-spend gift tiers. Repeated groups earn repeated benefits.
- Eligibility supports explicit products or category/tag rules. Product lines are variant groups, not a substitute for category/tag matching.
- Spend-tier qualification uses eligible merchandise after discounts, excluding shipping and free gift lines. Merchant chooses highest tier only or cumulative tiers, with clear customer-facing terms.
- Overlapping assignments require explicit merchant combination rules and conflict confirmation. Do not silently choose stacking behavior for the merchant.
- Promotion edits and activation commit atomically after conflict/revision checks. Cancelled confirmation or a failed save leaves the existing active promotion unchanged. Date editing must preserve the saved instant unless the merchant changes that field.
- Gift choices may mix SKUs within entitlement and stock limits. Earn2 with A1+B1 permits A1+B1, not A2.
- Insufficient total gift stock requires explicit acceptance of the reduced quantity. If every gift is exhausted, explain that all gifts are gone, show the revised total without that gift promotion, and require confirmation.
- Gift availability is rechecked at checkout. A changed offer requires renewed selection/acceptance. Purchased and gift stock changes succeed or roll back together; gift lines remain zero-priced and cannot generate more eligibility.

### Sources and regression anchors

- [Campaign and catalog flow](docs/superpowers/specs/2026-09-02-online-campaign-and-catalog-flow-design.md)
- [Promotion integration](docs/superpowers/specs/2026-09-05-promotion-sales-channel-integration-design.md)
- [Mixed and partial gifts](docs/superpowers/specs/2026-09-07-mixed-promotion-rewards-design.md)
- [Stock summary correction and verification](docs/superpowers/plans/2026-09-07-stock-summary.md)
- SQL regressions: `supabase/tests/stock_summary_lifecycle_test.sql`, `stock_adjustment_flows_test.sql`, `promotion_sales_channel_test.sql`, `promotion_mixed_rewards_test.sql`, `promotion_atomic_save_test.sql`, and `promotion_rpc_authorization_test.sql`.
- Browser regressions: `src/tests/promotion-save.spec.ts`, `promotion-mixed-rewards.spec.ts`, and `security-rls-regression.spec.ts`. Controlled-RPC UI tests are not substitutes for transaction regressions.

## Brand Personality

Practical, energetic, trustworthy.

The interface should feel like a calm booth command center: compact enough for repeated operational use, warm enough for creator culture, and precise enough for money, stock, and queue state.

## Anti-references

- Do not clone BoothMate directly; Nireq's wedge is customer-facing event commerce around the booth, not only seller-side POS.
- Do not return to a command shelf where every event row exposes Dashboard, Orders, Pre-order, Pickup, Live Queue, Live POS, Edit, and Delete as equal actions.
- Do not recreate LINE OpenChat-style queue chaos where customers need to monitor noisy chat updates.
- Do not use marketing-site composition for admin workflows: no oversized hero sections, decorative card stacks, or generic SaaS metric theater.
- Do not hide live operational actions behind deep navigation during booth hours.

## Design Principles

1. Event-first workspace: the current event should surface the next operational task instead of making users scan a table of commands.
2. Live operations stay one click away: queue and POS actions must remain fast during event hours.
3. Stock and pickup state must be explicit: reservations, awaiting pickup counts, and completed orders should be visible before staff acts.
4. Role clarity beats visual completeness: staff should see actions they can actually use, not management-only controls.
5. Customer flows should reduce waiting anxiety: queue, menu, pre-order, and receipt states must be obvious on mobile.

## Accessibility & Inclusion

Target WCAG AA for product surfaces. Prioritize readable contrast, 44px touch targets, clear focus states, keyboard-operable controls, reduced-motion alternatives, and copy that works for multilingual Thai/English UI. Color must not be the only indicator for status such as booth open, pickup state, or role access.
