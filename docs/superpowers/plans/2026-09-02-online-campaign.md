# Online Campaign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate online-sales campaign flow with campaign stock, 15-minute payment holds, shipping or merchant pickup, late-payment resolution, and bilingual merchant/customer screens without changing Physical Event behavior.

**Architecture:** Add campaign-specific tables beside the existing Event tables and reuse shared products, orders, payment evidence, and review records. All prices and stock transitions stay in transactional PostgreSQL RPCs; React calls a typed campaign client and never calculates authoritative totals or availability. Promotion authoring is excluded, so campaign orders persist `discount_total = 0`.

**Tech Stack:** React 18, TypeScript, React Router, Tailwind CSS, Supabase/PostgreSQL RPC and RLS, pgTAP, Playwright, Vite.

---

## File map

- Create `supabase/migrations/20260902120000_online_campaigns.sql`: schema, RLS, RPCs, stock/payment transitions, and expiry integration.
- Create `supabase/tests/online_campaign_test.sql`: campaign money, stock, authorization, late-payment, and fulfillment coverage.
- Create `src/types/onlineCampaign.ts`: shared campaign/order/payment contracts.
- Create `src/lib/onlineCampaigns.ts`: typed Supabase calls and stable RPC error mapping.
- Create `src/pages/creators/OnlineCampaigns.tsx`: campaign list and create flow.
- Create `src/pages/creators/OnlineCampaignWorkspace.tsx`: Overview, Products, Orders, and Settings.
- Create `src/pages/customer/OnlineCampaignStorefront.tsx`: public catalog, cart, checkout, countdown, and evidence upload.
- Modify `src/pages/customer/OrderStatus.tsx`: campaign order and late-payment states.
- Modify `src/pages/creators/ManageProducts.tsx`: generated SKU, variants, and Add-to-sale.
- Modify `src/components/AdminHeader.tsx`, `src/App.tsx`, and `src/i18n.tsx`: navigation, routes, bilingual copy.
- Create `src/tests/regression/online-campaign.spec.ts` and extend `src/tests/security-rls-regression.spec.ts`.

### Task 1: Lock the database contract with pgTAP

**Files:**
- Create: `supabase/tests/online_campaign_test.sql`

- [ ] **Step 1: Write the failing schema and lifecycle tests**

Use a transaction and existing JWT helper pattern. Seed two artists, one finite product, a published campaign, shipping, one pickup point, and a payment method:

```sql
begin;
select plan(32);

select has_table('public', 'online_campaigns');
select has_table('public', 'online_campaign_products');
select has_table('public', 'campaign_pickup_points');
select has_table('public', 'campaign_payment_methods');

select throws_ok(
  $$ select * from public.create_online_campaign_order(
    :'campaign_id'::uuid,
    jsonb_build_array(jsonb_build_object('product_id', :'product_id'::uuid, 'quantity', 6)),
    'shipping', null, 'Buyer', 'buyer@example.com', '0800000000',
    'Bangkok', '', gen_random_uuid()
  ) $$,
  'insufficient_stock'
);

select is(
  (select stock_reserved from public.online_campaign_products where campaign_id = :'campaign_id'::uuid),
  0,
  'failed checkout does not reserve stock'
);

select * from finish();
rollback;
```

The other named assertions cover exact-one Event/Campaign sources, a 15-minute expiry, flat shipping once, pickup fee zero, idempotent checkout, evidence grace capped at 17 minutes, confirmation, expiry release, late evidence not reserving, late acceptance only with current stock, refund audit, and fulfillment without another decrement.

- [ ] **Step 2: Run the test and verify it fails before the migration exists**

```bash
npx supabase test db supabase/tests/online_campaign_test.sql
```

Expected: FAIL because the campaign tables and RPCs do not exist.

- [ ] **Step 3: Commit the failing contract**

```bash
git add supabase/tests/online_campaign_test.sql
git commit -m "test: define online campaign lifecycle"
```

### Task 2: Add campaign schema, RLS, catalog configuration, and SKU

**Files:**
- Create: `supabase/migrations/20260902120000_online_campaigns.sql`
- Test: `supabase/tests/online_campaign_test.sql`

- [ ] **Step 1: Add campaign tables and native constraints**

```sql
alter table public.products add column if not exists sku text;
create unique index if not exists products_artist_sku_unique
  on public.products (artist_id, lower(sku)) where sku is not null and deleted_at is null;

create table public.online_campaigns (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text not null default '',
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  campaign_timezone text not null default 'Asia/Bangkok',
  currency text not null default 'THB',
  shipping_enabled boolean not null default false,
  flat_shipping_fee numeric not null default 0 check (flat_shipping_fee >= 0),
  pickup_enabled boolean not null default false,
  publication_status text not null default 'draft'
    check (publication_status in ('draft', 'published', 'cancelled', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artist_id, slug),
  check (opens_at < closes_at),
  check (shipping_enabled or pickup_enabled)
);
```

Add `online_campaign_products` with finite stock counters, `campaign_pickup_points` with date/time, and `campaign_payment_methods` mirroring event payment instructions without a method deadline.

- [ ] **Step 2: Extend orders, items, payments, and review records**

```sql
alter table public.orders
  add column if not exists campaign_id uuid references public.online_campaigns(id),
  add column if not exists fulfillment_method text,
  add column if not exists shipping_fee numeric not null default 0,
  add column if not exists pickup_point_id uuid references public.campaign_pickup_points(id),
  add column if not exists pickup_point_snapshot jsonb;

alter table public.orders alter column event_id drop not null;
alter table public.orders add constraint orders_sale_source_check
  check ((event_id is not null)::integer + (campaign_id is not null)::integer = 1);
```

Add `campaign_product_id`, evidence-grace fields, late/refund fields, and status values while retaining every current Event status.

- [ ] **Step 3: Add role policies and deny anonymous table writes**

```sql
create policy online_campaigns_manage on public.online_campaigns
for all to authenticated
using (public.has_artist_role(artist_id, array['owner', 'manager']))
with check (public.has_artist_role(artist_id, array['owner', 'manager']));

revoke insert, update, delete on public.online_campaigns,
  public.online_campaign_products, public.campaign_pickup_points,
  public.campaign_payment_methods from anon;
```

Public reads go through masked RPCs. Owner/manager configures; seller reads fulfillment data and fulfills; seller cannot review payments.

- [ ] **Step 4: Add configuration RPCs**

Implement `save_online_campaign`, `save_online_campaign_products`, `save_campaign_pickup_points`, `save_campaign_payment_methods`, `publish_online_campaign`, and `archive_online_campaign`. Each verifies ownership. Publishing rejects missing products, fulfillment, pickup point, or payment method.

- [ ] **Step 5: Reset and run schema plus Event regressions**

```bash
npx supabase db reset
npx supabase test db supabase/tests/online_campaign_test.sql supabase/tests/preorder_pickup_mvp_test.sql
```

Expected: campaign schema assertions and all Event preorder assertions pass.

- [ ] **Step 6: Commit schema/configuration**

```bash
git add supabase/migrations/20260902120000_online_campaigns.sql supabase/tests/online_campaign_test.sql
git commit -m "feat: add online campaign schema"
```

### Task 3: Implement checkout, holds, payment review, and fulfillment

**Files:**
- Modify: `supabase/migrations/20260902120000_online_campaigns.sql`
- Modify: `supabase/tests/online_campaign_test.sql`

- [ ] **Step 1: Add public catalog and checkout RPCs**

`get_public_online_campaign(text,text)` returns published data only. `create_online_campaign_order(...)` validates the window, locks campaign products, snapshots prices/items, increments reserved stock, adds shipping once, and returns a high-entropy order code and 15-minute deadline:

```sql
v_shipping_fee := case when p_fulfillment_method = 'shipping'
  then v_campaign.flat_shipping_fee else 0 end;
v_total := v_subtotal + v_shipping_fee;

update public.online_campaign_products
set stock_reserved = stock_reserved + v_qty
where id = v_product.id
  and (is_unlimited or stock_total - stock_reserved - stock_sold >= v_qty);

if not found then raise exception 'insufficient_stock'; end if;
```

The idempotency lookup returns an order only when campaign, item, fulfillment, and customer payloads match; otherwise it raises `client_request_id_conflict`.

- [ ] **Step 2: Add upload grace and evidence submission**

`begin_online_payment_upload(order_code)` succeeds once before the deadline and sets:

```sql
upload_grace_expires_at := least(
  now() + interval '2 minutes',
  stock_hold_expires_at + interval '2 minutes'
);
```

`submit_online_payment_evidence` produces `payment_submitted` before hold/grace expiry. After expiry it produces `payment_submitted_late` without stock changes. One unresolved late report exists per order.

- [ ] **Step 3: Extend the existing expiry cadence**

Add `private.expire_online_campaign_holds()` and call it from the existing scheduled expiry entry point. It locks rows, releases Reserved to Available once, and writes cancelled/payment_expired/expired.

- [ ] **Step 4: Add merchant state transitions**

Implement `confirm_online_payment`, `reject_online_payment`, `accept_late_online_payment`, `mark_online_refund_required`, `mark_online_refunded`, `mark_online_order_shipped`, and `mark_online_order_picked_up`. Late acceptance moves Available directly to Sold transactionally; fulfillment changes no stock.

- [ ] **Step 5: Run money/stock and legacy tests**

```bash
npx supabase test db   supabase/tests/online_campaign_test.sql   supabase/tests/preorder_pickup_mvp_test.sql   supabase/tests/stock_adjustment_flows_test.sql   supabase/tests/rpc_execute_privileges_test.sql
```

Expected: all files pass.

- [ ] **Step 6: Commit transactional backend**

```bash
git add supabase/migrations/20260902120000_online_campaigns.sql supabase/tests/online_campaign_test.sql
git commit -m "feat: add online campaign checkout lifecycle"
```

### Task 4: Add typed client, explicit translations, and routes

**Files:**
- Create: `src/types/onlineCampaign.ts`
- Create: `src/lib/onlineCampaigns.ts`
- Modify: `src/App.tsx`
- Modify: `src/i18n.tsx`

- [ ] **Step 1: Define state contracts**

```ts
export type CampaignPublicationStatus = 'draft' | 'published' | 'cancelled' | 'archived';
export type CampaignPaymentStatus =
  | 'awaiting_payment' | 'payment_submitted' | 'payment_confirmed'
  | 'payment_rejected' | 'payment_expired' | 'payment_cancelled'
  | 'payment_submitted_late' | 'refund_pending' | 'refunded';
export type CampaignFulfillmentMethod = 'shipping' | 'pickup';
export type CampaignFulfillmentStatus =
  | 'not_required' | 'awaiting_shipment' | 'shipped'
  | 'awaiting_pickup' | 'picked_up' | 'cancelled' | 'expired';
```

- [ ] **Step 2: Add the typed RPC wrapper**

Expose list/get/save/publish/archive, catalog allocation, public lookup, checkout, upload, review, refund, and fulfillment methods. Convert stable RPC codes into `OnlineCampaignError`; do not display raw SQL messages.

- [ ] **Step 3: Add lazy routes**

```tsx
<Route path="/manage-online-sales" element={session && canUseManagement ? <OnlineCampaigns /> : <Navigate to="/manage-login" replace />} />
<Route path="/manage-online-sales/:campaignId" element={session && canUseManagement ? <OnlineCampaignWorkspace /> : <Navigate to="/manage-login" replace />} />
<Route path="/:slug/campaign/:campaignSlug" element={<OnlineCampaignStorefront />} />
```

- [ ] **Step 4: Add Thai/English keys**

Add explicit keys for campaign status, fulfillment, payment countdown, payment issues, refunds, empty states, and errors. Do not add campaign copy to `legacyThaiText`.

- [ ] **Step 5: Verify contracts/routes**

```bash
npm run build
npm run lint
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/types/onlineCampaign.ts src/lib/onlineCampaigns.ts src/App.tsx src/i18n.tsx
git commit -m "feat: add online campaign client routes"
```

### Task 5: Build merchant Online Sales workspace

**Files:**
- Create: `src/pages/creators/OnlineCampaigns.tsx`
- Create: `src/pages/creators/OnlineCampaignWorkspace.tsx`
- Modify: `src/components/AdminHeader.tsx`
- Modify: `src/i18n.tsx`
- Create: `src/tests/regression/online-campaign.spec.ts`

- [ ] **Step 1: Build campaign list/create**

Group Active, Scheduled, and Past campaigns. Show status, window, revenue, stock health, and actionable counts. Create requires name, window, currency, and fulfillment; slug is generated and editable.

- [ ] **Step 2: Build four tabs**

Overview shows actions and storefront link. Products selects catalog rows and edits allocation/price override. Orders defaults to Needs action with approved filters/search. Settings edits details, shipping fee, pickup points, payment methods, publication, cancellation, and archive.

- [ ] **Step 3: Add state-driven order detail/actions**

Show one primary action based on state: review, resolve late payment, ship, or mark picked up. Require notes for rejection/refund and show immutable fulfillment/payment history.

- [ ] **Step 4: Add Online Sales navigation badge**

Badge owner/manager navigation with only payment review/issues, shipment, and pickup work; exclude awaiting-customer-payment.

- [ ] **Step 5: Run focused checks**

```bash
npm run build
npx playwright test src/tests/regression/online-campaign.spec.ts --project=desktop-chromium --grep "merchant"
```

Expected: build passes and merchant draft setup works.

- [ ] **Step 6: Commit**

```bash
git add src/pages/creators/OnlineCampaigns.tsx src/pages/creators/OnlineCampaignWorkspace.tsx src/components/AdminHeader.tsx src/i18n.tsx src/tests/regression/online-campaign.spec.ts
git commit -m "feat: add online sales workspace"
```

### Task 6: Build storefront, checkout, countdown, and late recovery

**Files:**
- Create: `src/pages/customer/OnlineCampaignStorefront.tsx`
- Modify: `src/pages/customer/OrderStatus.tsx`
- Modify: `src/lib/onlineCampaigns.ts`
- Modify: `src/i18n.tsx`
- Modify: `src/tests/regression/online-campaign.spec.ts`

- [ ] **Step 1: Render public visibility states**

Scheduled, sold-out, closed, and cancelled remain readable without cart actions. Archived/invalid URLs show unavailable. Open campaigns use server availability.

- [ ] **Step 2: Add single-method checkout**

Shipping requires recipient, email, phone, and address and shows the flat fee once. Pickup requires customer/contact and one configured point. Send only IDs, quantities, method, and customer input.

- [ ] **Step 3: Add fixed timer/evidence upload**

Render the server deadline, begin grace before uploading to the existing evidence bucket, then submit the storage path. On expiry refetch the campaign so released quantities return.

- [ ] **Step 4: Extend public order status**

Campaign orders show fulfillment snapshot, payment/evidence state, and tracking. Expired orders hide instructions and offer only new order or already-transferred late evidence.

- [ ] **Step 5: Add browser coverage**

Cover shipping total, pickup zero fee, countdown, sold-out rejection, closed read-only state, expiry recovery, and late-evidence copy.

- [ ] **Step 6: Run public checks**

```bash
npm run build
npx playwright test src/tests/regression/online-campaign.spec.ts --project=desktop-chromium
npx playwright test src/tests/public-i18n-smoke.spec.ts --project=desktop-chromium
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/pages/customer/OnlineCampaignStorefront.tsx src/pages/customer/OrderStatus.tsx src/lib/onlineCampaigns.ts src/i18n.tsx src/tests/regression/online-campaign.spec.ts
git commit -m "feat: add online campaign storefront"
```

### Task 7: Simplify catalog and present generated SKUs

**Files:**
- Modify: `src/pages/creators/ManageProducts.tsx`
- Modify: `src/i18n.tsx`
- Modify: `src/tests/regression/online-campaign.spec.ts`

- [ ] **Step 1: Reduce the primary form**

Show name, price, stock mode/quantity, and image first. Move category, tags, description, and editable SKU under Advanced.

- [ ] **Step 2: Add Add-to-sale handoff**

After save, choose Event or Campaign, allocation, and optional price override. Call existing Event save behavior or campaign allocation RPC; do not reproduce stock rules in React.

- [ ] **Step 3: Make row variants the default**

Use Add option rows for option name, stock, price override, and generated SKU. Keep pipe paste/CSV under Advanced/Bulk.

- [ ] **Step 4: Run catalog regressions**

```bash
npm run build
npx playwright test src/tests/regression/online-campaign.spec.ts --project=desktop-chromium --grep "catalog"
npx playwright test src/tests/regression/regression.spec.ts --project=desktop-chromium
```

Expected: Campaign assignment and existing Event catalog both pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/creators/ManageProducts.tsx src/i18n.tsx src/tests/regression/online-campaign.spec.ts
git commit -m "feat: simplify campaign catalog setup"
```

### Task 8: Security, full verification, and fresh-context review

**Files:**
- Modify: `src/tests/security-rls-regression.spec.ts`
- Modify: `supabase/tests/online_campaign_test.sql`

- [ ] **Step 1: Add security assertions**

Assert Artist A cannot access Artist B campaign/config/stock/order/payment/customer data. Assert anonymous users cannot write campaign tables, Seller cannot configure/review payments, and public order lookup masks contacts.

- [ ] **Step 2: Run database and browser security suites**

```bash
npx supabase test db
npm run test:security
```

Expected: all pass.

- [ ] **Step 3: Run repository verification**

```bash
npm run verify
```

Expected: lint, build, public i18n, and API smoke pass.

- [ ] **Step 4: Review the full diff**

```bash
git status --short
git diff --check
git log --oneline -8
```

Confirm Event flows still use Event RPCs, no privileged key is in browser code, stock transitions are idempotent, and unrelated files are untouched.

- [ ] **Step 5: Fix confirmed findings and verify once**

Run the narrow failing test, then:

```bash
npm run verify
npm run test:security
```

Expected: both pass.

- [ ] **Step 6: Commit verification changes**

```bash
git add src/tests/security-rls-regression.spec.ts supabase/tests/online_campaign_test.sql
git commit -m "test: secure online campaign flows"
```

Do not deploy DEV or PROD in this plan. Deployment requires a separate explicit request after local verification is reviewed.
