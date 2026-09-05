# Promotion Sales-Channel Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make store promotions reusable across Event Pre-order, Live Event, Event Post-order, and Online Campaign with authoritative pricing, stock-backed gifts, conflict decisions, immutable order snapshots, and merchant operations.

**Architecture:** Extend the existing `artist_promotions` model with explicit assignments, tiers, and reward products rather than adding a generic rules engine. A shared PostgreSQL calculator is the authority for every checkout; the current TypeScript calculator becomes preview/presentation code. Existing event and campaign stock rows remain the source of finite availability, so reward lines can reuse the current reserve, expire, and sell lifecycle.

**Tech Stack:** PostgreSQL 17 and Supabase RPC/RLS/pgTAP, React 18, TypeScript, Tailwind CSS, Playwright, existing Supabase and Firebase DEV deployment scripts.

---

## File Map

**Create**

- `supabase/migrations/20260905090000_promotion_assignments_and_rewards.sql` — central promotion extensions, assignments, tiers, rewards, channel sellability, order reward metadata, migration of existing rules, and RLS.
- `supabase/migrations/20260905100000_authoritative_promotion_pricing.sql` — shared active-assignment lookup, collision validation, quote calculation, pricing fingerprint, and analytics RPCs.
- `supabase/migrations/20260905110000_promotion_checkout_stock.sql` — integrates authoritative pricing and reward stock into Event and Online Campaign order lifecycles.
- `supabase/migrations/20260905120000_live_event_promotion_checkout.sql` — integrates authoritative pricing and reward stock into paid Live Event completion without a hold.
- `supabase/migrations/20260905130000_promotion_order_reporting.sql` — owner-safe promotion and reward analytics from immutable orders.
- `supabase/tests/promotion_sales_channel_test.sql` — pgTAP coverage for migration, pricing, conflicts, hold/sell/release, idempotency, and tenant isolation.
- `src/types/promotion.ts` — shared promotion definition, assignment, tier, reward, quote, and snapshot types.
- `src/lib/promotions.ts` — Supabase reads/writes, quote calls, stable error parsing, and form payload conversion.
- `src/tests/regression/promotion-sales-channel.spec.ts` — browser coverage for merchant authoring, customer application, gift shortage, and order display.

**Modify**

- `src/utils/promotionPricing.ts` — preserve legacy preview behavior and adapt display helpers to the new quote/snapshot types.
- `src/components/promotions/PromotionManager.tsx` — central list plus four-step create/edit/assignment flow and conflict preview.
- `src/pages/customer/MenuView.tsx` — Event Pre-order, Live Event, and Event Post-order promotion quote/progress/reward selection.
- `src/pages/customer/OnlineCampaignStorefront.tsx` — campaign quote, reward choice, changed-price confirmation, and exhausted-gift recovery.
- `src/lib/preorders.ts` — pass quote fingerprints and promotion choices to pre/post-order checkout.
- `src/lib/onlineCampaigns.ts` — pass quote fingerprints and promotion choices to campaign checkout.
- `src/components/dashboard/PosPanel.tsx` — quote and reconfirm the authoritative promotion result before paid completion.
- `src/pages/creators/EventWorkspace.tsx` — Event-phase promotion assignments entry point.
- `src/pages/creators/OnlineCampaignWorkspace.tsx` — campaign promotion assignments, order filters, and gift visibility.
- `src/pages/creators/OrderHistory.tsx` — promotion and reward breakdown in merchant order detail.
- `src/pages/creators/PreorderDashboard.tsx` — promotion and gift filters/status for pre/post orders.
- `src/pages/customer/OrderStatus.tsx` — immutable discount and reward receipt display.
- `src/pages/customer/CampaignAwareOrderStatus.tsx` — campaign reward and promotion snapshot display.
- `src/i18n.tsx` — explicit Thai/English copy for new promotion and error states.
- `src/tests/security-rls-regression.spec.ts` — cross-store RLS, public-safe reads, tampered totals, and replay coverage.
- `src/tests/regression/online-campaign.spec.ts` — campaign checkout and expiration regression coverage.
- `src/tests/regression/preorder-pickup.spec.ts` — Pre-order/Post-order hold and Live Event no-hold coverage.
- `supabase/tests/online_campaign_test.sql` — reward-line reservation compatibility assertions.
- `supabase/tests/preorder_pickup_mvp_test.sql` — Event reward-line reservation and expiration compatibility assertions.

---

## Release Slice 1 — Data and Authoritative Pricing

### Task 1: Add the reusable promotion schema and migrate existing rules

**Files:**
- Create: `supabase/migrations/20260905090000_promotion_assignments_and_rewards.sql`
- Create: `supabase/tests/promotion_sales_channel_test.sql`

- [ ] **Step 1: Write failing schema and RLS assertions**

Start the pgTAP file with assertions for the new tables, constrained context shape, tenant ownership, reward ownership, and backward-compatible defaults:

```sql
begin;
select plan(18);

select has_table('public', 'promotion_assignments');
select has_table('public', 'promotion_tiers');
select has_table('public', 'promotion_reward_products');
select has_column('public', 'event_products', 'is_sellable');
select has_column('public', 'online_campaign_products', 'is_sellable');
select has_column('public', 'order_items', 'line_type');

select throws_ok(
  $$ insert into public.promotion_assignments
     (promotion_id, artist_id, event_id, campaign_id, event_phase)
     values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'live') $$,
  null,
  'an assignment cannot target an event and campaign together'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the new database test and verify it fails**

Run: `supabase test db supabase/tests/promotion_sales_channel_test.sql`

Expected: FAIL because the assignment/reward schema does not exist.

- [ ] **Step 3: Add the append-only schema migration**

Extend existing structures instead of replacing them. The migration must use checks and foreign keys equivalent to:

```sql
alter table public.artist_promotions
  add column if not exists promotion_type text,
  add column if not exists lifecycle_status text not null default 'ready',
  add column if not exists tier_grant_mode text,
  add column if not exists reward_selection_mode text,
  add column if not exists revision bigint not null default 1,
  add column if not exists updated_by uuid references auth.users(id);

create table public.promotion_assignments (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.artist_promotions(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  event_phase text,
  campaign_id uuid references public.online_campaigns(id) on delete cascade,
  starts_at timestamptz,
  ends_at timestamptz,
  is_paused boolean not null default false,
  combination_policy text not null default 'exclusive',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (combination_policy in ('combine', 'exclusive')),
  check (
    (event_id is not null and campaign_id is null and event_phase in ('preorder', 'live', 'postorder'))
    or (event_id is null and campaign_id is not null and event_phase is null)
  )
);

create table public.promotion_tiers (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.artist_promotions(id) on delete cascade,
  threshold_amount numeric not null check (threshold_amount > 0),
  reward_quantity integer not null check (reward_quantity > 0),
  reward_selection_mode text not null check (reward_selection_mode in ('fixed', 'customer_choice')),
  sort_order integer not null default 0,
  unique (promotion_id, threshold_amount)
);

create table public.promotion_reward_products (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.artist_promotions(id) on delete cascade,
  promotion_tier_id uuid references public.promotion_tiers(id) on delete cascade,
  product_id uuid not null references public.products(id),
  sort_order integer not null default 0,
  unique nulls not distinct (promotion_id, promotion_tier_id, product_id)
);

alter table public.event_products add column if not exists is_sellable boolean not null default true;
alter table public.online_campaign_products add column if not exists is_sellable boolean not null default true;
alter table public.order_items
  add column if not exists line_type text not null default 'purchase',
  add column if not exists promotion_id uuid references public.artist_promotions(id),
  add column if not exists promotion_assignment_id uuid references public.promotion_assignments(id),
  add column if not exists promotion_tier_id uuid references public.promotion_tiers(id),
  add constraint order_items_line_type_check check (line_type in ('purchase', 'promotion_reward'));
```

Add triggers that derive `artist_id`, reject cross-artist Event/Campaign/product references, validate fixed versus selectable rewards, and increment `revision` when commercial fields change. Reuse the repository's existing artist owner/team membership predicates in RLS; public users receive promotion data only through RPCs.

Migrate fixed discounts to `quantity_discount` and create explicit assignments for each currently included, non-excluded existing Event and each phase. Preserve legacy `free_items` as `legacy_free_eligible_items`; do not invent a gift SKU. Future Events require explicit assignment.

- [ ] **Step 4: Run the schema test**

Run: `supabase test db supabase/tests/promotion_sales_channel_test.sql`

Expected: all schema, constraint, migration, and RLS assertions pass.

- [ ] **Step 5: Commit the schema slice**

```bash
git add supabase/migrations/20260905090000_promotion_assignments_and_rewards.sql \
  supabase/tests/promotion_sales_channel_test.sql
git commit -m "feat: add reusable promotion assignments and rewards"
```

### Task 2: Add shared TypeScript contracts and pure pricing expectations

**Files:**
- Create: `src/types/promotion.ts`
- Create: `src/tests/promotion-pricing.spec.ts`
- Modify: `src/utils/promotionPricing.ts`

- [ ] **Step 1: Write failing pricing contract tests**

Use Playwright's test runner without a browser to cover repeat groups, post-discount tiers, reward lines at zero value, and combination decisions:

```ts
import { expect, test } from '@playwright/test';
import { summarizePromotionQuote } from '../utils/promotionPricing';

test('renders two groups for every 3 items when quantity is 6', () => {
  const quote = summarizePromotionQuote({
    subtotal: 1200,
    discount_total: 100,
    merchandise_total: 1100,
    shipping_fee: 0,
    total: 1100,
    pricing_hash: 'example',
    applied_promotions: [{ id: 'p1', name: 'ทุก 3 ชิ้น ลด ฿50', bundle_count: 2, discount_amount: 100, rewards: [] }],
    reward_lines: [],
    required_choices: [],
  });
  expect(quote[0].detail).toContain('2');
  expect(quote[0].discountAmount).toBe(100);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx playwright test src/tests/promotion-pricing.spec.ts`

Expected: FAIL because the new quote type and adapter do not exist.

- [ ] **Step 3: Add the minimal shared types and display adapter**

Define exact transport types in `src/types/promotion.ts`:

```ts
export type PromotionType = 'quantity_discount' | 'quantity_gift' | 'spend_tier_gift' | 'legacy_free_eligible_items';
export type PromotionTargetType = 'all' | 'product' | 'category' | 'tag' | 'category_tag';
export type SalesPhase = 'preorder' | 'live' | 'postorder';
export type PromotionChoice = { promotionId: string; selectedPromotionId?: string; productIds?: string[] };

export type PromotionQuote = {
  subtotal: number;
  discount_total: number;
  merchandise_total: number;
  shipping_fee: number;
  total: number;
  pricing_hash: string;
  applied_promotions: AppliedPromotionQuote[];
  reward_lines: PromotionRewardLine[];
  required_choices: PromotionRequiredChoice[];
};
```

Keep the current calculator exports needed by legacy screens. Add only adapters for new server quotes; do not create a second authoritative browser evaluator.

- [ ] **Step 4: Run the pricing contract test**

Run: `npx playwright test src/tests/promotion-pricing.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit the TypeScript contract slice**

```bash
git add src/types/promotion.ts src/utils/promotionPricing.ts src/tests/promotion-pricing.spec.ts
git commit -m "feat: define promotion quote contracts"
```

### Task 3: Implement the authoritative pricing and collision RPCs

**Files:**
- Create: `supabase/migrations/20260905100000_authoritative_promotion_pricing.sql`
- Modify: `supabase/tests/promotion_sales_channel_test.sql`
- Create: `src/lib/promotions.ts`

- [ ] **Step 1: Add failing pgTAP scenarios**

Seed one Event, one Online Campaign, products tagged into overlapping scopes, two quantity discounts, a customer-choice reward, and spend tiers. Assert:

```sql
select is(
  (public.quote_sale_promotions(
    (select event_id from _promotion_ids), 'preorder', null,
    jsonb_build_array(jsonb_build_object('product_id', (select product_id from _promotion_ids), 'quantity', 6)),
    '[]'::jsonb, '[]'::jsonb
  ) ->> 'discount_total')::numeric,
  100::numeric,
  'every three save fifty repeats for six items'
);

select is(
  public.promotion_assignment_conflicts((select assignment_id from _promotion_ids)) ->> 'has_conflict',
  'true',
  'overlapping target products are reported before activation'
);
```

Also assert that six purchased units cannot count twice unless both assignments use `combine`, exclusive discount-versus-discount picks the larger discount, and a gift collision returns a required customer choice.

- [ ] **Step 2: Run the focused database test and verify it fails**

Run: `supabase test db supabase/tests/promotion_sales_channel_test.sql`

Expected: FAIL because quote and conflict RPCs do not exist.

- [ ] **Step 3: Implement one internal calculator and two public-safe wrappers**

Create an internal function with an explicit context and payload:

```sql
create function public.calculate_sale_promotions(
  p_event_id uuid,
  p_event_phase text,
  p_campaign_id uuid,
  p_items jsonb,
  p_reward_choices jsonb,
  p_promotion_choices jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp;

create function public.quote_sale_promotions(
  p_event_id uuid,
  p_event_phase text,
  p_campaign_id uuid,
  p_items jsonb,
  p_reward_choices jsonb default '[]'::jsonb,
  p_promotion_choices jsonb default '[]'::jsonb
) returns jsonb
language sql
security definer
set search_path = public, pg_temp;

create function public.promotion_assignment_conflicts(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp;
```

The internal calculator must derive ownership, currency, sellable channel rows, prices, limits, assignment effectiveness, and reward availability. Apply quantity rules first, then spend tiers from discounted eligible merchandise. Exclude reward lines and shipping. Return stable `required_choices` instead of guessing gift value. Compute `pricing_hash` from the canonical commercial result and current promotion revisions.

The quote wrapper exposes only public-safe names, messages, totals, reward choices, and the pricing hash. Conflict inspection requires merchant access.

- [ ] **Step 4: Add the TypeScript RPC wrapper and stable error parser**

Use one library entry point:

```ts
export const quotePromotions = async (input: PromotionQuoteInput): Promise<PromotionQuote> => {
  const { data, error } = await supabase.rpc('quote_sale_promotions', {
    p_event_id: input.eventId ?? null,
    p_event_phase: input.eventPhase ?? null,
    p_campaign_id: input.campaignId ?? null,
    p_items: input.items,
    p_reward_choices: input.rewardChoices,
    p_promotion_choices: input.promotionChoices,
  });
  if (error) throw toPromotionError(error);
  return data as PromotionQuote;
};
```

- [ ] **Step 5: Run database and type checks**

Run: `supabase test db supabase/tests/promotion_sales_channel_test.sql`

Run: `npm run build`

Expected: pricing/collision tests and TypeScript build pass.

- [ ] **Step 6: Commit the pricing slice**

```bash
git add supabase/migrations/20260905100000_authoritative_promotion_pricing.sql \
  supabase/tests/promotion_sales_channel_test.sql src/lib/promotions.ts
git commit -m "feat: calculate promotions authoritatively"
```

---

## Release Slice 2 — Checkout and Stock

### Task 4: Integrate promotion rewards with held checkout flows

**Files:**
- Create: `supabase/migrations/20260905110000_promotion_checkout_stock.sql`
- Modify: `supabase/tests/promotion_sales_channel_test.sql`
- Modify: `supabase/tests/online_campaign_test.sql`
- Modify: `supabase/tests/preorder_pickup_mvp_test.sql`
- Modify: `src/lib/preorders.ts`
- Modify: `src/lib/onlineCampaigns.ts`

- [ ] **Step 1: Write failing atomic-stock scenarios**

Cover Event Pre-order, Event Post-order, and Online Campaign:

```sql
-- Two checkouts compete for the last finite gift.
-- First order reserves purchase and reward lines.
-- Second order raises promotion_reward_unavailable and reserves neither line.
-- Expiring the first order twice restores both counters only once.
-- Confirming payment moves both finite lines from reserved to sold only once.
```

Assert that unlimited gift lines are recorded at quantity earned with no stock counter mutation, a replayed idempotency key returns the existing order, and a late-payment report never recreates the hold.

- [ ] **Step 2: Run the three database suites and verify they fail**

Run:

```bash
supabase test db supabase/tests/promotion_sales_channel_test.sql
supabase test db supabase/tests/online_campaign_test.sql
supabase test db supabase/tests/preorder_pickup_mvp_test.sql
```

Expected: new reward reservation assertions fail.

- [ ] **Step 3: Extend held checkout RPCs with backward-compatible named parameters**

Append defaulted parameters to `create_preorder_with_stock` and `create_online_campaign_order`:

```sql
p_reward_choices jsonb default '[]'::jsonb,
p_promotion_choices jsonb default '[]'::jsonb,
p_expected_pricing_hash text default null
```

Inside each existing transaction:

1. Lock requested channel-product rows.
2. Call `calculate_sale_promotions`.
3. Raise `promotion_changed` when a supplied hash differs.
4. Lock finite reward channel-product rows in stable UUID order.
5. Insert purchase and `promotion_reward` order lines.
6. Increment finite `stock_reserved` for every line.
7. Store totals and the returned breakdown on the order.

Reuse the existing expiration and payment-confirmation loops over `order_items`; because reward lines carry the same `event_product_id` or `campaign_product_id`, they release and sell through the existing counters. Add a `stock_released_at`/existing terminal-state guard only where the current functions lack idempotency.

- [ ] **Step 4: Pass the quote fingerprint and choices from client libraries**

Extend existing input types without changing callers that have no promotion:

```ts
promotion?: {
  pricingHash: string;
  rewardChoices: PromotionChoice[];
  promotionChoices: PromotionChoice[];
};
```

Map missing promotion data to the default empty arrays and null hash.

- [ ] **Step 5: Run the three database suites**

Run the commands from Step 2.

Expected: all held-flow, existing campaign, and existing preorder assertions pass.

- [ ] **Step 6: Commit the held-checkout slice**

```bash
git add supabase/migrations/20260905110000_promotion_checkout_stock.sql \
  supabase/tests/promotion_sales_channel_test.sql supabase/tests/online_campaign_test.sql \
  supabase/tests/preorder_pickup_mvp_test.sql src/lib/preorders.ts src/lib/onlineCampaigns.ts
git commit -m "feat: hold promotion gifts with online orders"
```

### Task 5: Integrate authoritative promotion completion with Live Event POS

**Files:**
- Create: `supabase/migrations/20260905120000_live_event_promotion_checkout.sql`
- Modify: `supabase/tests/promotion_sales_channel_test.sql`
- Modify: `src/components/dashboard/PosPanel.tsx`
- Modify: `src/tests/security-rls-regression.spec.ts`

- [ ] **Step 1: Add failing Live Event and tampering tests**

Assert that a Live Event quote shows the reward before payment, `complete_order_with_stock` recalculates from stored purchase lines, and completion atomically inserts reward lines and moves all finite quantities directly to sold without touching reserved counters. Send forged discount/total/reward values and assert the server result ignores them.

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
supabase test db supabase/tests/promotion_sales_channel_test.sql
npx playwright test src/tests/security-rls-regression.spec.ts --grep "promotion|tampered total|complete order"
```

Expected: FAIL until Live Event completion uses the shared calculator.

- [ ] **Step 3: Recalculate inside paid completion**

Append the same choice/hash parameters to `complete_order_with_stock`, `create_walkin_order_with_stock`, and the paid queue completion path. Treat a queued customer menu submission as an editable cart, not a final commercial snapshot. At staff payment completion, lock all finite purchase/reward rows, recalculate, compare the hash, then insert reward lines and increment sold counters in one transaction. Never create a 15-minute payment hold for `event_phase = 'live'`.

- [ ] **Step 4: Replace POS browser authority with quote-and-confirm**

In `PosPanel.tsx`, request a server quote after cart changes, display loading/error state, require gift/exclusive choices, and pass the accepted hash to paid completion. On `promotion_changed`, reload the quote and require staff confirmation before retrying.

- [ ] **Step 5: Run focused database and security tests**

Run the commands from Step 2.

Expected: PASS, including direct-to-sold reward stock and tampering rejection.

- [ ] **Step 6: Commit the Live Event slice**

```bash
git add supabase/migrations/20260905120000_live_event_promotion_checkout.sql \
  supabase/tests/promotion_sales_channel_test.sql src/components/dashboard/PosPanel.tsx \
  src/tests/security-rls-regression.spec.ts
git commit -m "feat: apply promotions safely at live checkout"
```

---

## Release Slice 3 — Merchant and Customer Experience

### Task 6: Build the central promotion and assignment workflow

**Files:**
- Modify: `src/components/promotions/PromotionManager.tsx`
- Modify: `src/pages/creators/EventWorkspace.tsx`
- Modify: `src/pages/creators/OnlineCampaignWorkspace.tsx`
- Modify: `src/lib/promotions.ts`
- Modify: `src/i18n.tsx`
- Create: `src/tests/regression/promotion-sales-channel.spec.ts`

- [ ] **Step 1: Write a failing merchant workflow test**

Exercise the real four-step flow:

```ts
test('merchant creates and assigns a repeating gift promotion', async ({ page }) => {
  await page.goto('/manage-promotions');
  await page.getByRole('button', { name: /Create promotion|สร้างโปรโมชัน/ }).click();
  await page.getByRole('radio', { name: /Every X items, get a gift|ซื้อครบ X รับของแถม/ }).check();
  await page.getByLabel(/Qualifying quantity|จำนวนที่ต้องซื้อ/).fill('3');
  await page.getByRole('button', { name: /Select products|เลือกสินค้า/ }).click();
  await page.getByRole('checkbox', { name: /Hairclip Keito/ }).check();
  await page.getByRole('button', { name: /Select reward products|เลือกของแถม/ }).click();
  await page.getByRole('checkbox', { name: /Postcard Genshin Special/ }).check();
  await page.getByRole('button', { name: /Review|ตรวจสอบ/ }).click();
  await expect(page.getByText(/Every 3 qualifying items, get 1 gift|ทุก 3 ชิ้นที่ร่วมรายการ รับของแถม 1 ชิ้น/)).toBeVisible();
});
```

- [ ] **Step 2: Run the focused browser test and verify it fails**

Run: `npx playwright test src/tests/regression/promotion-sales-channel.spec.ts --grep "creates and assigns"`

Expected: FAIL because the new workflow is not present.

- [ ] **Step 3: Replace the long inline form with the approved workflow**

Keep `PromotionManager` as the route-level container. Add four internal steps: type, eligibility/rewards, assignments, review. Reuse native inputs, existing product/category/tag data, and current button/modal patterns. Add **Select all variants** by expanding the existing variant-group product IDs; do not add a new product-line rule.

The review calls `promotion_assignment_conflicts`, displays worked examples, and blocks save for unresolved collisions or missing channel reward allocations. Active edits show the approved N-context warning and save immediately only after revalidation.

Event and Campaign workspaces pass a locked context into the same manager for **Add existing** and **Create new**. Assignment schedule never extends a closed sale phase.

- [ ] **Step 4: Add explicit Thai and English keys**

Add keys for lifecycle, promotion types, target types, tier behavior, combination behavior, reward stock warnings, active-edit warning, conflict examples, and validation. Do not rely on DOM text replacement for any new string.

- [ ] **Step 5: Run merchant workflow and accessibility checks**

Run:

```bash
npx playwright test src/tests/regression/promotion-sales-channel.spec.ts --grep "creates and assigns"
npx playwright test src/tests/accessibility.spec.ts --grep "Promotion"
```

Expected: merchant flow passes in Thai and English; controls have labels, keyboard focus, and non-color status text.

- [ ] **Step 6: Commit the authoring slice**

```bash
git add src/components/promotions/PromotionManager.tsx src/pages/creators/EventWorkspace.tsx \
  src/pages/creators/OnlineCampaignWorkspace.tsx src/lib/promotions.ts src/i18n.tsx \
  src/tests/regression/promotion-sales-channel.spec.ts
git commit -m "feat: manage reusable promotion assignments"
```

### Task 7: Add customer quote, progress, choices, and shortage recovery

**Files:**
- Modify: `src/pages/customer/MenuView.tsx`
- Modify: `src/pages/customer/OnlineCampaignStorefront.tsx`
- Modify: `src/i18n.tsx`
- Modify: `src/tests/regression/promotion-sales-channel.spec.ts`
- Modify: `src/tests/regression/online-campaign.spec.ts`
- Modify: `src/tests/regression/preorder-pickup.spec.ts`

- [ ] **Step 1: Write failing customer-flow tests**

Cover:

- progress copy before eligibility;
- automatic fixed reward;
- required selection among reward options;
- highest-only versus cumulative tier copy;
- changed pricing requiring confirmation;
- explicit all-rewards-exhausted copy and no-promotion total;
- 15-minute hold in Pre-order/Post-order/Campaign and no hold in Live Event.

The critical exhausted-state assertion is:

```ts
await expect(page.getByText('ของแถมสำหรับโปรนี้หมดทั้งหมดแล้ว')).toBeVisible();
await expect(page.getByRole('button', { name: /ยืนยันยอดใหม่|Confirm new total/ })).toBeVisible();
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npx playwright test src/tests/regression/promotion-sales-channel.spec.ts src/tests/regression/online-campaign.spec.ts src/tests/regression/preorder-pickup.spec.ts --grep "promotion|gift|ของแถม"`

Expected: FAIL on missing server quote UI and explicit exhausted-gift handling.

- [ ] **Step 3: Use one quote state model in both customer surfaces**

Debounce quote refresh after cart changes, disable checkout while the quote is stale/loading, render `required_choices`, and submit the accepted `pricing_hash`. On `promotion_changed`, show old versus new totals and require confirmation. On `promotion_reward_unavailable`, keep the cart and show remaining choices. On `promotion_rewards_exhausted`, show the exact approved Thai/English message, fetch the no-promotion quote, and require confirmation.

Keep the current Event queue gate unchanged for Live Event. Pre-order and Post-order continue without a live queue and use the existing 15-minute payment screen.

- [ ] **Step 4: Run customer regressions**

Run the command from Step 2 without `--grep` after the focused cases pass.

Expected: all promotion, campaign, preorder, post-order, queue, and hold regressions pass.

- [ ] **Step 5: Commit the customer slice**

```bash
git add src/pages/customer/MenuView.tsx src/pages/customer/OnlineCampaignStorefront.tsx \
  src/i18n.tsx src/tests/regression/promotion-sales-channel.spec.ts \
  src/tests/regression/online-campaign.spec.ts src/tests/regression/preorder-pickup.spec.ts
git commit -m "feat: show automatic promotions and gift choices"
```

### Task 8: Show promotion rewards in orders, fulfillment, and reporting

**Files:**
- Create: `supabase/migrations/20260905130000_promotion_order_reporting.sql`
- Modify: `src/pages/creators/OrderHistory.tsx`
- Modify: `src/pages/creators/PreorderDashboard.tsx`
- Modify: `src/pages/creators/OnlineCampaignWorkspace.tsx`
- Modify: `src/pages/customer/OrderStatus.tsx`
- Modify: `src/pages/customer/CampaignAwareOrderStatus.tsx`
- Modify: `src/components/promotions/PromotionManager.tsx`
- Modify: `src/tests/regression/promotion-sales-channel.spec.ts`

- [ ] **Step 1: Write failing order and reporting tests**

Create a paid order with a discount and reward, then assert merchant and customer views show purchased lines, discount, reward SKU at ฿0, promotion name, and unchanged snapshot after editing the live promotion. Assert merchant filters for **Uses promotion** and **Has gifts**.

- [ ] **Step 2: Run the focused order test and verify it fails**

Run: `npx playwright test src/tests/regression/promotion-sales-channel.spec.ts --grep "order snapshot|gift fulfillment|promotion analytics"`

Expected: FAIL because order readers and analytics do not expose reward metadata.

- [ ] **Step 3: Add owner-safe reporting RPCs**

Return lifetime and per-assignment values from immutable orders:

```sql
create function public.get_promotion_sales_analytics(p_promotion_id uuid)
returns table (
  assignment_id uuid,
  order_count bigint,
  qualifying_count bigint,
  discount_total numeric,
  reward_quantity bigint,
  gross_merchandise numeric,
  net_merchandise numeric
)
language sql
security definer
set search_path = public, pg_temp;
```

Verify caller ownership before returning data. Read both the legacy and new `pricing_breakdown` shapes. Include reward SKU totals from `order_items`; do not calculate conversion or incremental revenue.

- [ ] **Step 4: Render immutable breakdowns and fulfillment lines**

Order list badges and filters come from stored order data, never current promotion status. Order detail and receipt group purchase lines separately from **Gift from [promotion]** lines. Preorder/Campaign picking includes reward SKU quantities and reward completion status. Promotion workspace shows order count, groups/tiers, discount, gifts by SKU, gross merchandise, and net merchandise per assignment.

- [ ] **Step 5: Run focused and full promotion regressions**

Run:

```bash
npx playwright test src/tests/regression/promotion-sales-channel.spec.ts
npx playwright test src/tests/regression/online-campaign.spec.ts src/tests/regression/preorder-pickup.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the order/reporting slice**

```bash
git add supabase/migrations/20260905130000_promotion_order_reporting.sql \
  src/pages/creators/OrderHistory.tsx src/pages/creators/PreorderDashboard.tsx \
  src/pages/creators/OnlineCampaignWorkspace.tsx src/pages/customer/OrderStatus.tsx \
  src/pages/customer/CampaignAwareOrderStatus.tsx src/components/promotions/PromotionManager.tsx \
  src/tests/regression/promotion-sales-channel.spec.ts
git commit -m "feat: track promotion gifts through fulfillment"
```

---

## Release Slice 4 — Security, Compatibility, and DEV

### Task 9: Complete security and compatibility coverage

**Files:**
- Modify: `src/tests/security-rls-regression.spec.ts`
- Modify only if a confirmed defect is found: promotion migrations and targeted callers from Tasks 1–8.

- [ ] **Step 1: Add explicit security assertions**

Use the suite's existing admin-create-once/sign-in setup. Assert:

- another artist cannot read or mutate definitions, assignments, tiers, rewards, conflict detail, or analytics;
- reward and assignment references cannot cross artist ownership;
- anonymous quote returns only public-safe active assignment data;
- draft, archived, paused, ended, closed-channel, and wrong-phase promotions do not quote;
- client-supplied totals, reward prices, line type, assignment ID, and deadline do not control checkout;
- replayed checkout and repeated expiry/confirmation do not duplicate stock effects.

- [ ] **Step 2: Run security and database suites**

Run:

```bash
npm run test:security
supabase test db supabase/tests/promotion_sales_channel_test.sql
supabase test db supabase/tests/online_campaign_test.sql
supabase test db supabase/tests/preorder_pickup_mvp_test.sql
```

Expected: all tests pass without creating a fresh Auth user per test.

- [ ] **Step 3: Run full repository verification**

Run: `npm run verify`

Expected: lint, build/release checks, and configured release tests pass.

- [ ] **Step 4: Review the complete diff with fresh context**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~8..HEAD
```

Expected: only intended promotion schema, pricing, checkout, UI, i18n, and test changes are committed. Preserve the user's unrelated `.gitignore`, `docs/api/`, `docs/specs/`, and `scripts/docs/` changes.

- [ ] **Step 5: Re-run the owning task for any confirmed defect**

If review finds a defect, return to the task that owns that file, add a failing focused regression, make the minimum fix, rerun its listed checks, and commit the exact files named by that task. Skip this step when review finds no defect.

### Task 10: Push and deploy to DEV

**Files:**
- No source changes expected.

- [ ] **Step 1: Confirm the database target is DEV**

Run:

```bash
supabase projects list
supabase link --project-ref kdjqitvtxmcrnnpuxuyl
supabase migration list
supabase db push --dry-run
```

Expected: linked project is `Kongzas Event Queue - DEV` / `kdjqitvtxmcrnnpuxuyl`, and the dry run lists only the five 20260905 promotion migrations.

- [ ] **Step 2: Push the current branch before deployment**

Run: `npm run push:current`

Expected: branch `codex/prod-release-20260721` and all intended commits are present on `origin`.

- [ ] **Step 3: Apply migrations to DEV**

Run: `supabase db push`

Expected: only the reviewed promotion migrations apply successfully to DEV. Never run `supabase db reset` against DEV.

- [ ] **Step 4: Deploy the DEV frontend**

Run: `npm run deploy:staging`

Expected: staging build uses `.env.staging`, push remains clean/idempotent, and Firebase returns the DEV preview URL. Do not run `npm run deploy:prod`.

- [ ] **Step 5: Run DEV smoke and security checks**

Run:

```bash
npm run test:release:staging
PLAYWRIGHT_BASE_URL=https://nireqapp--dev-mttk3ru2.web.app \
  npx playwright test src/tests/regression/promotion-sales-channel.spec.ts \
  src/tests/regression/online-campaign.spec.ts src/tests/regression/preorder-pickup.spec.ts
```

Expected: DEV promotion authoring, customer checkout, gift hold, Live Event checkout, order snapshot, and existing sales regressions pass. If Auth-backed security tests require DEV service credentials not present locally, report that exact limitation and do not claim the suite passed.

- [ ] **Step 6: Relink Supabase to PROD without applying changes**

Run: `supabase link --project-ref fnutmjnzugpayccscvgr`

Expected: repository is linked back to PROD for operational clarity. Do not run `supabase db push` after relinking.
