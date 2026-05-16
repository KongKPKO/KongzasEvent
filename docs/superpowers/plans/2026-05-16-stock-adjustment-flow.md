# Stock Adjustment Flow - Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Keep catalog and event stock invariants intact at every step, and verify each layer before moving on.

**Goal:** Replace direct ongoing stock-total edits with explicit catalog and event stock adjustment flows while preserving the existing `stock_total`, `stock_reserved`, `stock_sold`, and event allocation model.

**Architecture:** Keep the existing product and event-product tables as the authoritative current state. Add explicit stock-adjustment RPCs that mutate those totals atomically under the current ownership rules. Update the creator UI so existing products expose stock summaries plus `Add stock` / `Remove stock`, while event catalog management exposes `Add to event` / `Remove from event`. Leave room for a future `stock_movements` audit table without requiring it in the first implementation pass.

**Tech Stack:** PostgreSQL 15, Supabase SQL/RPCs, React 18 + TypeScript, Supabase JS v2, TailwindCSS, Playwright/manual browser verification.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/<timestamp>_stock_adjustment_flows.sql` | Create | Catalog/event stock adjustment RPCs, grants, and validation helpers |
| `supabase/tests/stock_adjustment_flows_test.sql` | Create | pgTAP coverage for catalog/event add/remove rules |
| `src/pages/creators/ManageProducts.tsx` | Modify | Replace existing-product stock input with stock summary and catalog stock actions |
| `src/components/catalog/EventCatalogManager.tsx` or current event-catalog owner module | Modify | Add event stock actions and stock-state display |
| `src/lib/stockAdjustments.ts` | Create | Shared client helpers/types for adjustment RPC calls |
| `src/i18n.tsx` | Modify | New labels and validation messages if translated UI strings are used |
| `src/tests/...` | Modify/Create | Focused UI or integration coverage for stock adjustment flows |

---

## Task 1: Confirm current stock ownership and invariants

**Files:**
- Read: current product/event catalog modules and stock migrations

- [ ] **Step 1: Inventory the current model**

Confirm how these fields are used today:

- `products.stock_total`
- `products.stock_reserved`
- `products.stock_sold`
- `event_products.stock_total`
- `event_products.stock_reserved`
- `event_products.stock_sold`
- `products.is_unlimited`
- `event_products.is_unlimited`

- [ ] **Step 2: Confirm current event allocation validation**

Review the latest event catalog trigger/RPC migrations to preserve these rules:

- event allocation cannot exceed catalog availability
- event allocation cannot fall below `reserved + sold`

- [ ] **Step 3: Decide the concrete existing event-catalog UI owner**

Locate the active component that manages event catalog rows and saves allocation changes. Record the actual target module in the implementation notes before editing.

- [ ] **Step 4: Capture baseline behavior**

Use local fixtures or direct SQL to record one finite-stock product with:

- catalog total
- allocated event total
- reserved
- sold
- catalog available
- event available

Expected: baseline values are known before introducing new RPCs.

---

## Task 2: Add database RPCs for catalog stock adjustments

**Files:**
- Create: `supabase/migrations/<timestamp>_stock_adjustment_flows.sql`
- Create: `supabase/tests/stock_adjustment_flows_test.sql`

- [ ] **Step 1: Create migration shell**

Use:

```bash
supabase migration new stock_adjustment_flows
```

- [ ] **Step 2: Add `add_catalog_stock` RPC**

Expected behavior:

- caller must own/manage the product's artist
- reject unlimited products or define explicit no-op behavior before implementation
- require positive integer quantity
- increment `products.stock_total`
- return updated totals needed by the UI

- [ ] **Step 3: Add `remove_catalog_stock` RPC**

Expected behavior:

- caller must own/manage the product's artist
- require positive integer quantity
- require reason input
- compute currently allocated event stock for the product
- reject removal if the new total would fall below allocated stock or existing used stock
- decrement `products.stock_total`
- return updated totals needed by the UI

- [ ] **Step 4: Add grants and stable error contracts**

Use consistent exception codes/messages such as:

- `invalid_stock_quantity`
- `insufficient_catalog_available_stock`
- `catalog_stock_below_allocated_stock`

Keep client-facing error mapping simple and deterministic.

- [ ] **Step 5: Write pgTAP coverage**

Test:

- owner can add catalog stock
- non-owner cannot mutate catalog stock
- remove stock succeeds within available amount
- remove stock fails below allocated amount
- zero/negative quantities fail
- unlimited products follow the chosen rule

- [ ] **Step 6: Reset and verify**

```bash
supabase db reset
```

Expected: migration and tests apply cleanly.

---

## Task 3: Add database RPCs for event stock adjustments

**Files:**
- Modify: `supabase/migrations/<timestamp>_stock_adjustment_flows.sql`
- Modify: `supabase/tests/stock_adjustment_flows_test.sql`

- [ ] **Step 1: Add `add_event_stock` RPC**

Expected behavior:

- caller must own/manage the related artist/event
- require positive integer quantity
- lock relevant product/event-product rows
- reject when catalog available stock is insufficient
- increment `event_products.stock_total`
- do not mutate catalog `stock_total`
- return updated catalog/event stock summaries

- [ ] **Step 2: Add `remove_event_stock` RPC**

Expected behavior:

- caller must own/manage the related artist/event
- require positive integer quantity
- reject removal below `reserved + sold`
- decrement `event_products.stock_total`
- catalog available increases implicitly because less stock remains allocated
- return updated catalog/event stock summaries

- [ ] **Step 3: Decide first-pass behavior when an event product row does not exist**

Recommended first-pass rule:

- `Add to event` from an existing event catalog row only
- creation/allocation of a new event product continues through the existing event catalog setup flow

- [ ] **Step 4: Extend pgTAP coverage**

Test:

- adding to event succeeds when catalog available is sufficient
- adding to event fails when catalog available is insufficient
- removing from event succeeds for unreserved/unsold stock
- removing from event fails below `reserved + sold`
- catalog available changes correctly after event remove

- [ ] **Step 5: Verify migration and tests**

Use local DB reset or targeted test execution according to repo convention.

---

## Task 4: Add client-side stock adjustment helpers

**Files:**
- Create: `src/lib/stockAdjustments.ts`

- [ ] **Step 1: Define shared response types**

Include:

- catalog totals
- event totals where relevant
- derived values used by previews

- [ ] **Step 2: Wrap RPC calls**

Expose helpers such as:

- `addCatalogStock`
- `removeCatalogStock`
- `addEventStock`
- `removeEventStock`

- [ ] **Step 3: Centralize friendly error mapping**

Map database error contracts to user-facing copy:

- insufficient available stock
- quantity too high
- cannot remove used stock
- permission denied

- [ ] **Step 4: Keep optimistic behavior conservative**

Do not invent local stock values before RPC success unless the module already has a safe established pattern. Prefer refreshing from returned summaries or existing loaders.

---

## Task 5: Update Catalog Workspace product stock UI

**Files:**
- Modify: `src/pages/creators/ManageProducts.tsx`
- Modify: `src/i18n.tsx` if required

- [ ] **Step 1: Separate create vs edit stock behavior**

Creation flow:

- keep `Initial stock`

Existing product flow:

- remove the default editable stock total input
- show `On hand`, `Allocated`, and `Available`
- add `Manage stock` entry point or direct `Add stock` / `Remove stock` actions

- [ ] **Step 2: Add `Add stock` modal**

Fields:

- quantity
- optional reason

Preview:

- current on hand
- after add

- [ ] **Step 3: Add `Remove stock` modal**

Fields:

- quantity
- required reason

Preview:

- current on hand
- allocated
- maximum removable now
- after remove

- [ ] **Step 4: Update catalog list rows**

Expose concise stock summary in the list:

- `On hand`
- `Allocated`
- `Available`

Keep the row scannable and avoid turning each product row into a dense dashboard.

- [ ] **Step 5: Handle unlimited products clearly**

Recommended first pass:

- show `Unlimited`
- hide finite stock add/remove actions for unlimited products

- [ ] **Step 6: Add focused UI coverage**

Cover at least:

- finite stock summary renders
- remove action blocks excessive quantity
- unlimited product does not show finite stock actions

---

## Task 6: Update Event Catalog stock UI

**Files:**
- Modify: actual event catalog owner module identified in Task 1
- Modify: `src/i18n.tsx` if required

- [ ] **Step 1: Show event and catalog stock context together**

Per event product, show:

- catalog available
- allocated to this event
- reserved
- sold
- available at event

- [ ] **Step 2: Add `Add to event` action**

Preview:

- catalog available
- current event allocation
- after add

Validation:

- block quantity above catalog available
- guide the user to add catalog stock first when needed

- [ ] **Step 3: Add `Remove from event` action**

Preview:

- current event allocation
- reserved
- sold
- maximum removable now
- returned to catalog after remove

Validation:

- block removals below `reserved + sold`

- [ ] **Step 4: Preserve pre-event setup flow**

Initial event allocation may continue using the existing event catalog setup/save flow. The new actions should enhance ongoing adjustment without forcing a full rewrite of initial setup.

- [ ] **Step 5: Add focused UI coverage**

Cover:

- catalog-insufficient add path
- successful event add
- successful event remove
- event remove blocked by reserved/sold stock

---

## Task 7: End-to-end verification

**Files:**
- No new production files required

- [ ] **Step 1: Run build and automated suites**

```bash
npm run build
```

Run the most relevant existing regression/security tests for stock/order flows.

- [ ] **Step 2: Verify catalog flow manually**

Using a finite-stock product:

1. Add stock in catalog.
2. Confirm on-hand and available values increase.
3. Remove stock within available amount.
4. Confirm removal is blocked once it would undercut allocated stock.

- [ ] **Step 3: Verify event flow manually**

1. Allocate stock into an event.
2. Add to event while catalog has available stock.
3. Attempt to add beyond catalog available and confirm it is blocked.
4. Remove unreserved event stock and confirm catalog available rises.
5. Confirm removal below reserved/sold is blocked.

- [ ] **Step 4: Verify purchase flow still works**

Complete at least one order path and confirm:

- reserve still increments
- completion still moves reserved into sold
- availability calculations remain correct

- [ ] **Step 5: Capture implementation notes**

Record any behavior choices that differ from this plan before merging.

---

## Suggested Commit Sequence

1. `feat: add catalog stock adjustment RPCs`
2. `feat: add event stock adjustment RPCs`
3. `feat: add stock adjustment client helpers`
4. `feat: replace inline catalog stock edits with stock actions`
5. `feat: add event stock adjustment actions`
6. `test: cover stock adjustment flows`

## Deferred Work

- `stock_movements` audit ledger
- stock reconciliation workflow
- bulk adjustments
- CSV import/export
- inventory reporting

## Completion Checklist

- [ ] Catalog stock add/remove actions work through RPCs
- [ ] Event stock add/remove actions work through RPCs
- [ ] Catalog cannot drop below allocated stock
- [ ] Event allocation cannot exceed catalog availability
- [ ] Event allocation cannot drop below reserved + sold
- [ ] Existing-product edit modal no longer invites silent stock-total overwrites
- [ ] Build/tests pass
- [ ] Manual catalog, event, and order flows verified
