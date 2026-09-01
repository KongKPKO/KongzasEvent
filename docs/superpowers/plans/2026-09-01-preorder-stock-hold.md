# Pre-order Stock Hold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reserve finite pre-order stock for 15 minutes at checkout, release abandoned holds automatically, and keep submitted payments reserved through seller review.

**Architecture:** Extend `order_payments` with one hold deadline, then reuse the existing database reservation and release helpers from the public RPCs. A private idempotent expiry function runs once per minute through Supabase Cron, while order reads and slip submission also enforce the deadline so a delayed job cannot revive an expired hold.

**Tech Stack:** PostgreSQL 17, PL/pgSQL RPCs, Supabase Cron (`pg_cron`), pgTAP, React 18, TypeScript, Playwright.

---

## File map

- Create via `npx supabase migration new preorder_stock_hold`: the generated `supabase/migrations/*_preorder_stock_hold.sql` owns the column, expiry functions, cron job, and replacements for the four affected public RPCs.
- Modify `supabase/tests/preorder_pickup_mvp_test.sql`: dangerous stock/payment lifecycle coverage.
- Modify `supabase/tests/rpc_execute_privileges_test.sql`: private expiry remains inaccessible to API roles.
- Modify `src/lib/preorders.ts`: convert the committed `payment_expired` RPC result into a customer-facing error.
- Modify `src/types/preorder.ts`: represent the expiry result returned by slip submission.
- Modify `src/pages/customer/OrderStatus.tsx`: disable payment evidence after the countdown reaches zero.
- Modify `src/i18n.tsx`: precise Thai/English hold and expiry copy.
- Modify `src/tests/regression/preorder-pickup.spec.ts`: customer-visible countdown regression. Preserve the user's existing uncommitted changes in this file.

### Task 1: Write failing database lifecycle tests

**Files:**
- Modify: `supabase/tests/preorder_pickup_mvp_test.sql`
- Modify: `supabase/tests/rpc_execute_privileges_test.sql`

- [ ] **Step 1: Change the initial reservation expectations**

Increase the pgTAP plan count for every new assertion, then replace the initial stock assertion with:

```sql
select is(
  (select stock_reserved from public.event_products where id = (select event_product_id from _preorder_ids)),
  2,
  'pre-order creation reserves event stock immediately'
);

select ok(
  (select stock_hold_expires_at between now() + interval '14 minutes' and now() + interval '16 minutes'
   from public.order_payments
   where order_id = (select first_order_id from _preorder_ids)),
  'pre-order creation creates a fixed 15-minute stock hold'
);
```

- [ ] **Step 2: Assert slip submission does not reserve twice**

Keep the existing slip submission call and change its stock assertion to:

```sql
select is(
  (select stock_reserved from public.event_products where id = (select event_product_id from _preorder_ids)),
  2,
  'payment evidence keeps the existing stock reservation without double-reserving'
);
```

- [ ] **Step 3: Move oversell rejection to checkout**

Replace creation of `_oversell_preorder` and its submit-time failure with:

```sql
select throws_ok(
  $$ select * from public.create_preorder_with_stock(
    (select event_id from _preorder_ids),
    jsonb_build_array(jsonb_build_object('product_id', (select product_id from _preorder_ids), 'quantity', 4)),
    'Oversell Customer', '', '', gen_random_uuid(), '0800000000', '', 'oversell@example.com'
  ) $$,
  'insufficient_stock',
  'finite stock cannot be oversold at checkout'
);

select is(
  (select count(*) from public.orders where customer_email = 'oversell@example.com'),
  0::bigint,
  'failed stock hold leaves no draft order behind'
);
```

- [ ] **Step 4: Cover cancellation and automatic expiry**

Update cancellation assertions to expect stock reserved at creation and released by `cancel_public_preorder_before_payment`. Add a fresh order, force its deadline into the past, and call the private cleanup as the database owner:

```sql
create temp table _expired_hold as
select * from public.create_preorder_with_stock(
  (select event_id from _preorder_ids),
  jsonb_build_array(jsonb_build_object('product_id', (select product_id from _preorder_ids), 'quantity', 1)),
  'Expired Hold', '', '', gen_random_uuid(), '', '@expired', 'expired-hold@example.com'
);

update public.order_payments
set stock_hold_expires_at = now() - interval '1 second'
where order_id = (select order_id from _expired_hold);

select results_eq(
  $$ select expired_count, released_stock_count from private.expire_preorder_stock_holds() $$,
  $$ values (1, 1) $$,
  'automatic cleanup expires one abandoned hold and releases one unit'
);

select results_eq(
  $$ select payment_status, pickup_status, status
     from public.order_payments op
     join public.orders o on o.id = op.order_id
     where o.id = (select order_id from _expired_hold) $$,
  $$ values ('payment_expired'::text, 'expired'::text, 'cancelled'::text) $$,
  'expired hold becomes a cancelled expired order'
);
```

After submitting a different order's payment evidence, backdate its hold and assert cleanup returns `(0, 0)` and leaves `payment_submitted` reserved.

- [ ] **Step 5: Cover legacy awaiting-payment orders**

Set `stock_hold_expires_at = NULL` for a new awaiting-payment order, release its creation-time reservation once to emulate a legacy row, submit evidence, and assert the legacy path reserves exactly once.

```sql
select public.release_preorder_order_stock((select order_id from _legacy_hold));
update public.order_payments
set stock_hold_expires_at = null
where order_id = (select order_id from _legacy_hold);

select isnt_empty(
  $$ select 1 from public.submit_preorder_payment_evidence(
    (select order_id from _legacy_hold),
    (select pickup_code from _legacy_hold),
    'artist/event/order/slip-legacy.png',
    gen_random_uuid()
  ) $$,
  'legacy awaiting-payment order still reserves at slip submission'
);
```

- [ ] **Step 6: Add privilege assertions**

Add `private.expire_preorder_stock_holds()` to a new private-helper assertion in `rpc_execute_privileges_test.sql`:

```sql
select ok(
  not has_function_privilege('anon', 'private.expire_preorder_stock_holds()', 'execute')
  and not has_function_privilege('authenticated', 'private.expire_preorder_stock_holds()', 'execute'),
  'stock-hold cleanup is unavailable to API roles'
);
```

- [ ] **Step 7: Run tests and verify they fail for the missing schema**

Run:

```bash
npx supabase test db supabase/tests/preorder_pickup_mvp_test.sql supabase/tests/rpc_execute_privileges_test.sql
```

Expected: FAIL because `stock_hold_expires_at` and `private.expire_preorder_stock_holds()` do not exist.

- [ ] **Step 8: Commit the failing tests**

```bash
git add supabase/tests/preorder_pickup_mvp_test.sql supabase/tests/rpc_execute_privileges_test.sql
git commit -m "test: define preorder stock hold lifecycle"
```

### Task 2: Add the atomic 15-minute hold migration

**Files:**
- Create via CLI: `supabase/migrations/*_preorder_stock_hold.sql`

- [ ] **Step 1: Create the migration with the installed CLI**

Run:

```bash
npx supabase migration new preorder_stock_hold
```

Expected: one empty timestamped migration under `supabase/migrations/`.

- [ ] **Step 2: Add the hold column and expiry lookup index**

```sql
alter table public.order_payments
  add column if not exists stock_hold_expires_at timestamptz;

create index if not exists order_payments_active_stock_hold_idx
  on public.order_payments (stock_hold_expires_at)
  where payment_status = 'awaiting_payment'
    and stock_hold_expires_at is not null;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
```

- [ ] **Step 3: Add one-order and batch expiry functions**

Create `private.expire_preorder_stock_hold(uuid)` as `security definer set search_path = ''` returning `(expired boolean, released_stock_count integer)`. It must lock the order and payment, return `(false, 0)` unless the row is a pre-order in `awaiting_payment` with an expired non-null deadline, call `public.release_preorder_order_stock`, update payment/order status, append the existing `payment_expired` and `stock_released` audit events, and return `(true, released_count)`.

Create `private.expire_preorder_stock_holds()` returning `(expired_count integer, released_stock_count integer)`. Select only expired awaiting-payment pre-orders with `FOR UPDATE OF o, op SKIP LOCKED`, call the one-order helper for each ID, count rows whose helper result has `expired = true`, and sum the helper's exact `released_stock_count`.

Use these exact state writes:

```sql
update public.order_payments
set payment_status = 'payment_expired',
    expired_at = now(),
    updated_at = now()
where order_id = p_order_id;

update public.orders
set status = 'cancelled',
    pickup_status = 'expired',
    cancelled_at = now(),
    cancelled_by = null,
    cancel_reason = 'stock_hold_expired'
where id = p_order_id;
```

End with:

```sql
revoke all on function private.expire_preorder_stock_hold(uuid) from public, anon, authenticated;
revoke all on function private.expire_preorder_stock_holds() from public, anon, authenticated;
```

- [ ] **Step 4: Replace create-time behavior without duplicating the current RPC**

Copy the latest `public.create_preorder_with_stock` definition into the append-only migration. Keep its validation, idempotency, catalog, and order-item code unchanged. After inserting `order_payments`, reserve only when `v_sales_phase = 'preorder'`:

```sql
if v_sales_phase = 'preorder' then
  v_reserved := public.reserve_preorder_order_stock(v_order_id);
  v_stock_hold_expires_at := now() + interval '15 minutes';

  update public.order_payments
  set stock_hold_expires_at = v_stock_hold_expires_at
  where id = v_payment_id;

  perform public.append_payment_review_event(
    v_order_id, v_payment_id, p_event_id, v_event.artist_id,
    'stock_reserved', 'awaiting_payment', 'awaiting_payment', null, null,
    jsonb_build_object('quantity', v_reserved, 'expires_at', v_stock_hold_expires_at)
  );
end if;
```

Return `least(event payment deadline, v_stock_hold_expires_at)` when both exist, otherwise their non-null value. Apply the same return logic to the idempotent existing-order branch.

- [ ] **Step 5: Replace slip submission and cancellation behavior**

Copy the latest `submit_preorder_payment_evidence` definition and make these exact state decisions:

```sql
if v_payment.payment_status = 'awaiting_payment'
   and v_payment.stock_hold_expires_at is not null then
  if v_payment.stock_hold_expires_at <= v_now then
    perform private.expire_preorder_stock_hold(v_order.id);
    return query select v_order.id, 'payment_expired'::text, 0, v_now;
    return;
  end if;
  v_reserved := 0; -- already reserved at checkout
else
  v_reserved := public.reserve_preorder_order_stock(v_order.id);
end if;
```

Keep `payment_submitted` stock reserved. Append `stock_reserved` only when `v_reserved > 0` so an active checkout hold does not create a duplicate audit event.

Copy the latest `cancel_public_preorder_before_payment` definition and call the release helper before changing statuses when `stock_hold_expires_at is not null`.

- [ ] **Step 6: Enforce expiry on public order reads**

Copy the latest `get_public_preorder_by_code` definition. Resolve the matching order ID first, call `private.expire_preorder_stock_hold(order_id)`, then return the current row. Return `stock_hold_expires_at` as `payment_deadline_at` for `awaiting_payment` pre-orders; preserve the existing configured payment deadline for other order types and statuses.

- [ ] **Step 7: Schedule one global cleanup job**

Use the native extension and a stable job name:

```sql
create extension if not exists pg_cron;

select cron.schedule(
  'expire-preorder-stock-holds',
  '* * * * *',
  'select * from private.expire_preorder_stock_holds()'
);
```

The named schedule is idempotent on Supabase Cron; no per-event jobs are created.

- [ ] **Step 8: Reset the local database and run the narrow SQL tests**

Run:

```bash
npx supabase db reset --local
npx supabase test db supabase/tests/preorder_pickup_mvp_test.sql supabase/tests/rpc_execute_privileges_test.sql
```

Expected: both pgTAP files PASS.

- [ ] **Step 9: Commit the migration and passing tests**

```bash
git add supabase/migrations/*_preorder_stock_hold.sql supabase/tests/preorder_pickup_mvp_test.sql supabase/tests/rpc_execute_privileges_test.sql
git commit -m "feat: hold preorder stock for payment"
```

### Task 3: Write the failing customer countdown regression

**Files:**
- Modify: `src/tests/regression/preorder-pickup.spec.ts`

- [ ] **Step 1: Preserve the existing dirty diff**

Review `git diff -- src/tests/regression/preorder-pickup.spec.ts`. Do not revert the existing auth mocks, selector fixes, or workspace expectations.

- [ ] **Step 2: Return a fixed future hold deadline from both preorder mocks**

At mock setup, define:

```ts
const stockHoldExpiresAt = new Date(now + 15 * 60 * 1000).toISOString();
```

Set `payment_deadline_at: stockHoldExpiresAt` in both `create_preorder_with_stock` and `get_public_preorder_by_code` responses.

- [ ] **Step 3: Assert the payment countdown is visible**

Extend the existing customer checkout test:

```ts
await expect(page.getByText(/Pay before/i)).toBeVisible();
await expect(page.getByText(/Time left: 14:/i)).toBeVisible();
```

- [ ] **Step 4: Run the focused regression**

```bash
npx playwright test src/tests/regression/preorder-pickup.spec.ts --project=desktop-chromium -g "customer pre-order checkout"
```

Expected: the countdown assertion passes with the existing UI, proving the RPC deadline is sufficient; if it passes, do not add countdown component code.

### Task 4: Block slip upload after expiry and tighten copy

**Files:**
- Modify: `src/lib/preorders.ts`
- Modify: `src/types/preorder.ts`
- Modify: `src/pages/customer/OrderStatus.tsx`
- Modify: `src/i18n.tsx`
- Modify: `src/tests/regression/preorder-pickup.spec.ts`

- [ ] **Step 1: Add an expired-hold browser fixture**

Allow the order mock to return `payment_deadline_at` in the past and assert the file picker and submit button cannot be used while the expiry message and “Order again” link are visible.

- [ ] **Step 2: Disable evidence controls at zero**

Use the existing `deadlinePassed` boolean; do not add another timer:

```tsx
disabled={deadlinePassed}
```

on the file input and file-picker buttons, and:

```tsx
disabled={!slipFile || submitting || deadlinePassed}
```

on submit. When the countdown reaches zero, call `load(true)` once so the read RPC performs authoritative expiry and returns `payment_expired`.

Update `SubmitPaymentEvidenceResult` to allow the database's committed expiry result:

```ts
payment_status: 'payment_submitted' | 'payment_expired';
```

In `submitPaymentEvidence`, inspect the returned row before returning it:

```ts
const result = firstRow<SubmitPaymentEvidenceResult>(
  data as SubmitPaymentEvidenceResult[] | SubmitPaymentEvidenceResult | null,
  error,
  'preorder_payment_submit_response_missing'
);
if (result.payment_status === 'payment_expired') throw new Error('stock_hold_expired');
return result;
```

Map `stock_hold_expired` in `getPreorderErrorMessage` to the same “place a new order” guidance. This throw happens after the successful RPC response, so the database expiry and stock release stay committed.

- [ ] **Step 3: Replace ambiguous deadline copy**

Use:

```ts
orderPayDeadlinePassed: 'This 15-minute hold expired. The items were released; place a new order to try again.'
orderStatusExpiredDetail: 'This order expired before a slip was submitted. Its reserved items were released; place a new order to try again.'
```

and Thai equivalents:

```ts
orderPayDeadlinePassed: 'เวลาจองสินค้า 15 นาทีหมดแล้ว สินค้าถูกคืนเข้าสต็อก กรุณาสั่งใหม่อีกครั้ง'
orderStatusExpiredDetail: 'ออเดอร์หมดอายุก่อนส่งสลิป สินค้าที่จองไว้ถูกคืนเข้าสต็อกแล้ว กรุณาสั่งใหม่อีกครั้ง'
```

- [ ] **Step 4: Run the full preorder browser regression**

```bash
npx playwright test src/tests/regression/preorder-pickup.spec.ts --project=desktop-chromium
```

Expected: PASS.

- [ ] **Step 5: Commit the customer behavior**

```bash
git add src/lib/preorders.ts src/types/preorder.ts src/pages/customer/OrderStatus.tsx src/i18n.tsx src/tests/regression/preorder-pickup.spec.ts
git commit -m "feat: show preorder stock hold countdown"
```

### Task 5: Security, full verification, and fresh-context review

**Files:**
- Review all files changed by Tasks 1–4.

- [ ] **Step 1: Run the relevant money/stock/security regressions**

```bash
npx supabase test db supabase/tests/preorder_pickup_mvp_test.sql supabase/tests/rpc_execute_privileges_test.sql
npm run test:security
```

Expected: PASS.

- [ ] **Step 2: Run repository verification**

```bash
npm run verify
```

Expected: lint and release checks PASS.

- [ ] **Step 3: Review the final diff once with fresh context**

```bash
git status --short
git diff HEAD~3 --check
git diff HEAD~3 --stat
git diff HEAD~3 -- supabase src
```

Confirm there is one hold deadline, one global cron job, no double reservation, no public maintenance grant, no quantity-limit work, and no unrelated file changes.

- [ ] **Step 4: Fix confirmed findings and verify again**

Run the narrow affected test, then `npm run verify` again. Do not add another review round unless a money, stock, or privilege finding remains unresolved.
