# Product

## Users

Paimon serves creator-booth operators, booth staff, and event visitors at high-traffic events such as fan conventions, artist alleys, pop-up markets, and cosplay or game events.

Creators and managers use the admin workspace to configure events, catalog stock, pre-orders, pickup, queue operations, POS checkout, dashboard metrics, and order records. Sellers and queue staff use focused operational screens during live booth hours. Customers use mobile pages to discover booths, join queues, browse menus, pre-order, and track their status without relying on noisy chat groups.

## Product Purpose

Paimon reduces booth congestion and checkout confusion by connecting event setup, customer queueing, digital menus, stock-aware ordering, POS checkout, pre-order reservations, pickup fulfillment, and post-event records in one lightweight workflow.

Success means booth teams can open operations quickly, see the next task for each event, sell without overselling stock, call or serve queues clearly, fulfill pre-orders safely, and review orders after the event.

## Commerce Rules

These are agreed business rules, not a claim that every deployment has passed every regression. Detailed specs below explain individual flows; deployment status must be checked separately.

### Sales channels and fulfillment

- Catalog sales-channel selection supports multiple Event and Online Campaign checkboxes in compact dropdowns and one atomic save. Event filtering defaults to active/upcoming and also offers ended/all; filtering never changes selections hidden by the filter. Selected channels enable the product; unchecked existing memberships hide it. Newly added tracked memberships start at zero; existing allocations, holds, sales, supply policies and prices are preserved. Archived Campaigns are excluded.
- Online Campaign is a separate entity from Physical Event. It uses explicitly allocated catalog stock, not an implicit shared pool with an Event.
- Event Pre-order, live-day sales and Post-order remain distinct phases. Live-day queue/POS must not acquire the online payment timer.
- Online Campaign supports shipping or pickup. Shipping is a merchant-defined flat fee per order, included in the checkout total. The merchant can configure multiple pickup points with dates/times; the customer chooses at checkout.
- Pickup point names are required; address details are optional. Pickup start/end times describe the collection appointment, not checkout eligibility. Customers can select an enabled point in advance while the Campaign accepts orders. Times are stored as instants; entry uses the creator device time zone and displayed appointments identify the viewer time zone.
- A closed Campaign stops new checkout but keeps its closed storefront and existing order lookup accessible according to visibility rules. Do not redirect customers away from an expired order's payment-exception route.
- Purchase limits are optional, per product within each Campaign, per order. Unset means unlimited by this rule, not unlimited stock. This is not a per-person limit across multiple orders.

### Payment instructions

- Online Campaign, Pre-order and Post-order may show several enabled payment instruction entries. Every populated PromptPay, bank account, account holder, QR and instruction field is displayed together; method_type is a compatibility classification, not a display filter.
- Each payment entry groups one recipient’s PromptPay, QR and multiple bank accounts; adding another entry represents an alternative recipient. The editor has no custom payment display-name field. Existing names and legacy bank fields remain compatible. Event payment entries can be independently enabled or disabled; Campaign entries use the existing add/remove controls. These are alternative destinations for one order payment, not split payments or automatic bank verification. Existing 15-minute payment/hold rules remain unchanged.

### Payment and reservations

- Online Campaign, Pre-order and Post-order hold finite purchased items and gifts together for a fixed 15-minute payment window after order creation. Adding to cart alone does not hold stock.
- An evidence upload begun before the deadline may use the existing two-minute technical grace. It is not an extra payment window or permission to start a new normal upload after expiry.
- Submitted evidence keeps stock committed pending review. Unsubmitted expired holds release stock once; retrying expiry must not release twice.
- Late-payment reports do not automatically restore an expired hold or reclaim stock from another buyer. The merchant must resolve payment and fulfillment explicitly.
- Live queue remains one shared queue for merchandise and cheki/photo service; this pilot does not require separate service queues.
- Live-day sales have no 15-minute online payment timer. Preserve existing queue reservations; staff payment completion finalizes stock.
- An order successfully created in its hold window already owns its price/promotion snapshot. Later promotion edits must not reprice that order.

### Seller identity

- Shops choose one seller type: `creator`, `cosplayer`, or `shop`. Existing shops default to `creator`. New sellers choose during registration and owners/managers may edit it in the shop profile under existing profile permissions.
- Seller type controls Thai/English shop-specific wording, including public storefronts, discovery, queue and order pages. It never changes roles, authorization, inventory, payment windows or available sales channels.
- The `shop` label is a self-selected presentation category, not verification of licensing or product authenticity. General entry and navigation text uses neutral shop/seller wording.

### Products, SKU and stock

- A product parent owns shared merchandising and has single-dimension child variants. Each child retains its own UUID, SKU and independent stock; the parent is not a shared stock pool. The existing `products` table stores sellable children for compatibility with orders, allocations and promotions. See [product families](docs/specs/2026-10-03-product-families.md).
- Ordinary product formats are single goods and photo sets. Bundles are created separately from existing exact child UUIDs and quantities, with their own cover/price and no independent stock pool or variants. Capacity is the minimum component availability divided by units per set, within the same channel allocation. Composition is snapshotted on the order; purchased and gift components hold/consume/release atomically with individual sales. Legacy descriptive bundles require deliberate configuration; used legacy bundles require a new linked bundle.
- Preorder/service are not creation formats. Channel phases govern preorder timing, and production policies govern made-to-order demand. Production bundle units expand into component obligations and share receipt/explicit-earmark ordering with ordinary production demand.
- UUID is the reference identity. SKU is a readable merchant-editable identifier unique within the shop; do not parse it to identify products or require a shop-name prefix. Name-derived SKU generation is a heuristic, not semantic recognition.
- `stock_total` / legacy RPC `on_hand` remains the recorded stock total. The inventory overview separately reports physical units present, unallocated capacity, channel allocations/holds, production earmarks/shortfall, sold and fulfilled history. Do not relabel recorded total as physical stock.
- Catalog stock is either untracked (`is_unlimited`) or tracked. Starting tracking after channel use requires an explicit opening physical count, not a stock increment; existing Event obligations are earmarked without rewriting order snapshots. Existing Campaign commitments remain protected. Once allocated/used, tracked stock cannot become untracked.
- Preorder/Postorder supply is configured per Event product and phase; Online Campaign products support the same choice. Stock supply uses existing allocations (or untracked catalog stock). Made-to-order supply accepts demand independently of physical stock, with an optional total phase/channel cap. Live sales continue to use stock. Postorder defaults to selling existing leftover stock.
- Supply is snapshotted on each order item. Editing a policy affects future orders only. Production pending-payment demand counts toward its cap during the existing 15-minute hold but does not hold physical units. Newly received units are earmarked for confirmed production orders in order, before the remainder becomes ready to allocate. Existing ready stock stays separate after payment; owners/managers can explicitly earmark a reviewed quantity using an idempotent action. Partial receipts create visible shortfalls; tracked production orders cannot be fulfilled until fully earmarked. Cancellation releases unconsumed earmarks; refunds never restock delivered units automatically.
- Receiving 50 units with 20 confirmed outstanding production units earmarks20 and leaves30 ready to allocate. Opening counts and receipts are separate, auditable, retry-safe operations; previews explain the earmark and remaining shortage, and save recomputes atomically.
- Event unused allocations remain protected through an enabled Postorder window after the event date. Closing that window releases only unused capacity.
- Channel commitments include sold units, outstanding holds, and unused allocation while the channel is active. Holds inside active allocation are counted once, not again on top of that allocation.
- Catalog ready-to-allocate = recorded total − catalog-level sold/held − channel sold − channel outstanding holds − active unused allocation.
- Closing, archiving or disabling a channel releases only its unused allocation. Sold units and outstanding holds remain committed. Actual hold release restores capacity; refund alone does not mean returned merchandise is sellable again.
- Example: total30, Campaign allocation20 → ready10. Sell1 → ready10. Close with sold1 and held1 → ready28. Release that hold → ready29.
- The summary RPC, Event adjustment capacity and allocation limits must agree. Do not change actual stock counters to make a misleading display add up.

### Promotions

- Create and edit promotion definitions in the store-level Promotions menu. An Event’s Promotions tab selects existing store offers and changes only that Event’s phase, schedule and combination settings; other channels and existing order snapshots remain unchanged. Store offers can be saved before selecting a sales channel.
- Customer Event carts and confirmation show the server-calculated current promotion benefits and net total for live sales as well as advance orders. Pending or failed quotes cannot be submitted; changed live quotes require a fresh review before sending. Live benefits remain provisional until booth payment, with no new gift/stock holds from a quote.
- Promotions are reusable shop-level definitions with separate channel/time assignments. They apply automatically when eligible; there is no discount-code workflow.
- New promotions combine one condition (quantity, net spend, any of the selected exact products, or an exact product recipe) with a fixed/percentage discount, one fixed gift SKU, or both. Quantity/recipe groups repeat; spend benefits apply once per order. Quantity percentages apply to the highest-priced complete qualifying groups; recipe percentages apply only to recipe units, rounded to two decimals. Existing quantity rules, spend tiers and mixed customer-choice gifts remain supported.
- Net-spend conditions run after selected quantity/recipe discounts, then prior spend discounts in deterministic priority/creation/assignment order; a reward cannot qualify itself. Shipping and free gifts never qualify. Existing combination/explicit conflict confirmation rules remain.
- Fixed V1 gifts share actual channel stock with purchases. The optional global limit counts gift units across every assignment of the reusable promotion. Unpaid holds reserve rights during the existing payment window, expiry/unpaid cancellation releases them, and payment permanently redeems them. Refund alone never restores rights. Gift shortage/limit exhaustion does not block the independent discount or the sale; explain any reduced gift quantity. Existing mixed/partial-choice confirmation rules are unchanged.
- Real bundles may opt into automatic matching of loose exact components at their own channel price, provided supply policies agree and the bundle does not cost more. Choose greatest per-set saving first, UUID ties, never reuse units. Orders/reports record the resulting real bundle SKU and existing immutable component snapshot; downstream promotions see the bundle.
- Merchant draft previews use the checkout pricing engine with hypothetical quantities, without requiring physical stock or gift quota. Enabled channel membership and shop permissions remain required. Preview creates no order, stock, quota or activation writes; real quotes/checkout still enforce actual stock and quota. Results are invalidated when the draft/cart changes.
- Eligibility supports explicit products or category/tag rules. Product lines are variant groups, not a substitute for category/tag matching.
- Spend-tier qualification uses eligible merchandise after discounts, excluding shipping and free gift lines. Merchant chooses highest tier only or cumulative tiers, with clear customer-facing terms.
- Overlapping assignments require explicit merchant combination rules and conflict confirmation. Do not silently choose stacking behavior for the merchant.
- Promotion edits and activation commit atomically after conflict/revision checks. Cancelled confirmation or a failed save leaves the existing active promotion unchanged. Date editing must preserve the saved instant unless the merchant changes that field.
- Gift choices may mix SKUs within entitlement and stock limits. Earn2 with A1+B1 permits A1+B1, not A2.
- Insufficient total gift stock requires explicit acceptance of the reduced quantity. If every gift is exhausted, explain that all gifts are gone, show the revised total without that gift promotion, and require confirmation.
- Gift availability is rechecked at checkout. A changed offer requires renewed selection/acceptance. Purchased and gift stock changes succeed or roll back together; gift lines remain zero-priced and cannot generate more eligibility.

- POS has an in-place queue drawer with shared queue actions and atomic idempotent batch calls (1/3/5/10). Arrival is metadata separate from serving; an arrived ticket is protected from call expiry. Staff explicitly choose the sale context; incoming updates never auto-select a queue, and per-context unpaid cart edits survive switching during the session. Queue staff gain no POS/money access. Opening and closing a booth is limited to owners, managers and assigned sellers; queue staff can still manage tickets and queue announcements. The POS toolbar always displays waiting, called and arrived counts; waiting tickets use compact tiles in both queue views. Activity success notices dismiss automatically after six seconds; saved reward details remain in sales history.
- Offline preparation and new offline sales/queue entry are paused. The legacy offline route supports recovery, synchronization and reconciliation of previously recorded operations only; do not delete or strand pending receipts.

### Event catalog setup and activity rewards

- New Event setup may start empty, select catalog products in bulk, or reuse the enabled product list from another Event in the same shop. Reuse does not copy allocations, sold counts, holds, production settings, or prices; finite items start with zero allocated stock until the merchant explicitly allocates them. Existing channel stock is never moved implicitly.
- Activity participation rewards are non-inventory promotion benefits with a name, optional manual instructions, and quantity. They do not create catalog products, gift commitments, customer-name fields, or automated drawings.
- Activity rights can accompany every condition. Quantity and recipe conditions earn rights per complete group; specific-product conditions earn independently for each selected product at its configured quantity. Specific-product discounts apply to any selected item without requiring all selected items; recipes continue to require all components.
- For a spend condition, activity rights repeat for each complete threshold in qualifying merchandise after discounts, per order only; no cross-order remainder or shipping/free-gift eligibility. Two orders of 700 and 800 with a 500 threshold earn 1 + 1 rights.
- The server stores activity reward name, instructions, and count in the order pricing snapshot. They are provisional until payment confirmation; cancelled/refunded orders do not have active rights. Staff distribute entries and reconcile external manual activity records themselves; the app does not claim to track redemption.

### Sources and regression anchors

- [Campaign and catalog flow](docs/superpowers/specs/2026-09-02-online-campaign-and-catalog-flow-design.md)
- [Promotion integration](docs/superpowers/specs/2026-09-05-promotion-sales-channel-integration-design.md)
- [Mixed and partial gifts](docs/superpowers/specs/2026-09-07-mixed-promotion-rewards-design.md)
- [Stock summary correction and verification](docs/superpowers/plans/2026-09-07-stock-summary.md)
- SQL regressions: `supabase/tests/stock_summary_lifecycle_test.sql`, `stock_adjustment_flows_test.sql`, `promotion_sales_channel_test.sql`, `promotion_mixed_rewards_test.sql`, `promotion_atomic_save_test.sql`, and `promotion_rpc_authorization_test.sql`.
- Browser regressions: `src/tests/production-inventory.spec.ts`, `src/tests/promotion-save.spec.ts`, `promotion-mixed-rewards.spec.ts`, and `security-rls-regression.spec.ts`. Controlled-RPC UI tests are not substitutes for transaction regressions.

## Brand Personality

Practical, energetic, trustworthy.

The interface should feel like a calm booth command center: compact enough for repeated operational use, warm enough for creator culture, and precise enough for money, stock, and queue state.

Customer-facing pages prioritize visual appeal using the selected Creator Festival reference: bright pink accents, dark navy type, artwork-led cards and restrained sticker/paper details. The NireQ platform logo belongs in platform navigation, never inside a creator’s merchandise banner where it could be mistaken for the shop name. Creator/staff screens prioritize fast, clear operational UX; they do not need the same decorative density.

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

## Sales reporting and POS history

- Event sales reports retain the established completed-order/date/time-zone definition. Dashboard metrics are aggregated in the database; summaries and product rows share a currency selection instead of adding unlike currencies. The product breakdown groups actual sale units and saved price/name/SKU snapshots, with expandable variants and separate currency rows; parent totals and variant rows must not be counted together. Order-level discounts allocate proportionally with deterministic largest-remainder cents. Category and image may use current catalog metadata.
- Existing refunds are recorded at order level without reliable per-item money/returned-unit allocation. Product refund columns show unavailable rather than invented amounts; product net deducts allocated discounts only. This limitation is displayed in the report and CSV leaves unavailable refund cells blank.
- POS history is a read-only, paginated event view for existing owner/manager/seller access. Queue staff receive no money/history access. Viewing orders never changes the current cart, queue, order status or payment. Historical queue labels come from the saved order relationship. Actor information appears only where recorded.

## Brand presentation

Paimon is the public brand. Use an ivory surface, navy text, accessible blue actions and restrained gold stars/constellation details. Keep status colors and operational readability. Brand changes preserve existing domains, Firebase/Supabase project identifiers, customer browser storage keys, offline records and public routes.
