# POS queue operations and promotion conditions V1

## Queue operations

POS opens a drawer on its existing route. Waiting, called, arrived, serving and missed tickets remain separate. `arrived_at` adds arrival metadata to the existing `calling` state; arrival never selects the POS sale context. Arrived tickets do not expire while waiting for staff to start service.

`call_queue_batch(event, count, request_id)` supports 1/3/5/10, serializes calls per event and replays the same request safely. `update_queue_operation` checks the ticket revision and existing event role permissions. Both return explicit safe queue fields, never customer fingerprints. QueuePanel and PosQueueDrawer share `useQueueOperations`; queue staff gain no POS or sales access.

POS keeps unsaved cart edits and promotion choices separately for each event/queue or walk-in context for the current session. Opening the drawer or receiving a new ticket/order does not select another customer. Context loading and payment block checkout/switching at the relevant boundary. These unsaved edits are not a hard-reload recovery system; persisted queue orders retain their existing reload behavior.

## Promotion data and calculation

Legacy definitions and mixed customer-choice gifts remain intact. New `condition_reward` definitions use `artist_promotions.v1_config`:

- `version: 1`
- `condition`: quantity, spend, exact product or exact recipe. Product/recipe items reference existing child product UUIDs and positive quantities.
- `discount`: optional fixed amount or percentage, at most one.
- `gift`: optional existing exact SKU, units per earned group, and nullable global maximum gift units.

Server validation requires a reward, valid quantities/percentage, same-shop products and an enabled gift allocation in every selected channel. Existing save/revision/conflict confirmation remains atomic. Gift stock can be zero at configuration time; availability is checked again at checkout. Archiving an existing offer remains possible after its SKU becomes unavailable.

Calculation order is bundle normalization, quantity/exact-SKU/recipe candidates under existing combination rules, spend conditions in deterministic priority/creation/assignment order, then legacy spend-tier gifts. Spend eligibility uses the existing after-discount merchandise base (eligible merchandise minus the selected order discount) and excludes its own benefit. Spend rewards apply once per order; quantity/recipe groups repeat. Percentages cover only complete qualifying groups (highest-priced eligible units for quantity groups), rounded to two decimals.

Fixed V1 gifts are best effort from real stock and global quota, independently of discounts. Purchased bundle component demand also reduces gift availability. Insufficient gifts are explicit diagnostics; the independent discount/sale remains available. Legacy mixed/partial gift confirmations are unchanged.

## Gift rights

`private.promotion_gift_commitments` accounts for rights across all assignments of one reusable promotion. Gift order lines remain zero-priced with their promotion and assignment provenance. The ledger is updated inside the existing order/payment transaction and quota checks serialize on the promotion row.

Unpaid online orders hold rights during the existing 15-minute stock hold, including existing evidence grace/review rules. Expiry/unpaid cancellation releases rights; retry is idempotent. Successful payment or POS completion redeems rights permanently. Refund/cancellation after payment does not silently restore them. Lowering a limit cannot invalidate already held/redeemed rights. This ledger is not customer-accessible; owners/managers use `promotion_gift_usage` for aggregate counts.

## Automatic sets

A real bundle parent may opt into `auto_bundle_enabled`; existing bundles default off. The normalizer consumes exact loose component units by greatest per-set channel saving, then bundle UUID. It never uses units twice or chooses a more expensive set. Supply policies must agree; non-empty item notes prevent matching rather than being lost. Orders and reports receive the real bundle SKU, and existing component snapshots hold/consume/release inventory. Downstream promotions see that SKU.

Persist/checkout facades normalize before their existing transactional stock path. A transaction-local canonical hash avoids reversing the parent/product lock order when the quote engine validates again. `normalized_items` is part of the pricing hash; display-only `auto_sets` and diagnostics are not.

## Preview and verification

`preview_promotion_definition` authorizes an owner/manager, validates the unsaved draft and evaluates it in the same private engine as checkout. It creates no order, promotion, stock or quota writes. Changing the form/cart invalidates the displayed result and stale asynchronous responses are ignored. Diagnostics distinguish condition shortfalls, inactive schedules and gift quota/stock shortages.

Regression anchors: `pos_queue_operations_test.sql`, `promotion_condition_reward_v1_test.sql`, `auto_bundle_matching_test.sql`, existing promotion/bundle SQL suites, `scripts/test-promotion-release.mjs` (simultaneous channel/quota checks), `pos-queue-drawer.spec.ts`, `promotion-workspace.spec.ts`, `auto-bundle-editor.spec.ts` and the existing POS/customer/role suites. `npm run verify` is the release check. Remote migration/deployment requires separate explicit target authorization.
