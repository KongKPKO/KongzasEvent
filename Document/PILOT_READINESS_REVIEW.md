# Pilot Readiness Review: Real-World Failure Scenarios

Date: 2026-05-07
Context: Creator/cosplay/artist event booths — crowded queues, poor mobile internet, limited staff, manual QR transfer payments, high-pressure event conditions.

---

## Failure 1 — Customer loses their ticket when phone clears storage

**What happens:** Customer joins the queue on their phone. Battery dies, they switch to another device, or open an incognito tab to check status. `localStorage` for `ticket_id_{artist_id}` is gone. Their phone shows "no ticket / join queue." The DB still has them as `waiting`. When staff calls their number, no one shows up → missed → queue stalls.

**Operational impact:** At a busy event this happens multiple times per hour. Each missed call wastes 30–60 seconds of booth time. Staff has no way to contact the customer. The ticket eventually expires client-side (30 min), tying up a queue slot.

**Current mitigation:** `QueueView` reconciles event/device mismatches by checking `availableEvents` — but only if the same browser has the ticket. Cross-device recovery has no path.

**Fix (must fix before pilot):** Add a "Find my ticket" flow on `/:slug/queue`. Customer enters their queue number (visible on screenshot or remembered). The page queries `queues` by `event_id + queue_number + queue_service_date + status IN ('waiting','calling','serving')` and re-stores the ticket ID in localStorage. No login required. The DB constraint `queues_event_service_date_queue_number_uidx` guarantees this lookup is unique and fast.

---

## Failure 2 — Payment hangs forever on venue WiFi drop

**What happens:** Staff taps "Charge Cash." `handlePayment` sets `loading=true` (button disabled). The sequence of three RPCs begins: `sync_customer_order_items_with_stock` → `applyPricingToOrder` → `complete_order_with_stock`. WiFi drops after the first RPC commits but before the third. Supabase JS client uses fetch under the hood — the Promise never rejects, it just hangs. The `finally` block never runs. The spinner shows forever.

**Operational impact:** Staff doesn't know if payment succeeded. Reloading the page will reload the draft order (if it exists) or show empty cart (if order completed before the drop). If they charge a second time assuming failure, walk-in customers get two completed orders debiting the same items twice from stock.

**Current mitigation:** None. No timeout on any RPC call in `handlePayment`. No "check order history" fallback in the error toast.

**Fix (must fix before pilot):** Wrap the payment sequence in a `Promise.race` with a 12-second timeout:

```typescript
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([promise, new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), ms))]);
```

In the `catch` block, when the error is `timeout`, show a distinct toast: **"Payment status unknown. Check order history before retrying."** Add a direct link to `/manage-events/:eventId/history` in the toast.

---

## Failure 3 — Customer misses "calling" state with phone in pocket

**What happens:** Staff taps "Call Next." Customer's ticket status becomes `calling`. The customer page subscribes via Supabase Realtime and shows yellow pulsing animation — but only if the screen is on and the browser tab is active. In a crowded hall with loud music, phone pocketed, the customer has no idea they were called. After 30 minutes, `expireStaleCallingQueues` marks them `expired`.

**Operational impact:** One missed call holds up the queue. Staff must re-call manually (using "Recall" button from Missed section). At a busy booth with 40+ customers, this happens repeatedly and erodes throughput by 15–20%.

**Current mitigation:** The 3-second polling loop in `QueueView` does update ticket status, but that's reactive — it tells the UI what it already knows. It does not alert the customer proactively when the phone is locked.

**Fix (should fix soon):** The PWA service worker already exists (`sw.js`, `registerSW.js`). Wire up Web Push for full implementation. **Before pilot fallback (1 day of work):** Play a loud sound in the browser when status transitions to `calling`. The Realtime subscription in `QueueView` already fires on status changes — add `new Audio('/alert.mp3').play()` in the payload handler when `payload.new.status === 'calling'` and `prev.status !== 'calling'`.

---

## Failure 4 — Transfer payment with no verification → revenue gap

**What happens:** Customer says "I transferred." Staff sees total ฿450, taps "Transfer." `complete_order_with_stock` marks order `completed` with `payment_method='transfer'`. No reference, no slip, no amount confirmation. At the end of the day, the artist reconciles bank statements and finds 3 missing transfers, but has no way to match them to orders.

**Operational impact:** Real revenue loss. At a pilot with 50–100 customers, even 2–3 unverified transfers represent significant loss for a creator. Post-event, `orders` has `payment_method='transfer'` but no `payment_reference` field — there's nothing to reconcile against.

**Current mitigation:** None. The payment modal has two equally sized buttons with no friction for either path.

**Fix (must fix before pilot):** Add a mandatory confirmation step for Transfer specifically:

```
Transfer received?
Enter last 6 digits of the transfer ref: [______]
[ Skip & confirm anyway ]  [ Confirm payment ]
```

Store the reference in `orders.payment_reference` (single `ALTER TABLE orders ADD COLUMN payment_reference text`). "Skip & confirm anyway" is allowed but adds a visual flag so post-event reconciliation can identify unverified transfers.

---

## Failure 5 — Stock conflict between two staff tablets shows opaque error

**What happens:** Two sellers (Tablet A and Tablet B) are both logged into the same booth. Product "Mini Figure" has 1 unit remaining. Both tablets show "1 left." Both add 1 to cart simultaneously. Tablet A taps Charge → reserves the last unit → succeeds. Tablet B taps Charge 2 seconds later → RPC runs → `v_available = 1-1-0 = 0 < 1` → raises `insufficient_stock` exception → caught by `catch` block → toast shows: **"Payment failed: insufficient_stock"**.

**Operational impact:** Seller B has no idea what went wrong. In a fast-moving queue, they may assume it's a system bug and retry rather than removing the item from cart. The cart is not re-validated after the realtime product update, so stale quantity stays.

**Current mitigation:** DB-level lock prevents actual oversell — good. But the error surface is broken.

**Fix (should fix soon — 2 parts):**

**Part A** — Translate known RPC error messages:
```typescript
const errorMessage = err instanceof Error
  ? (err.message === 'insufficient_stock'
      ? 'One or more items sold out. Remove them from the cart and try again.'
      : err.message)
  : 'Unknown error';
```

**Part B** — When `fetchProducts` fires via Realtime, cross-reference current cart and auto-remove items where `getAvailableUnits(updatedProduct) < cartItem.quantity`. Show a toast: "Mini Figure removed from cart — just sold out."

---

## Failure 6 — Queue expiry stops when the staff tab is backgrounded

**What happens:** `expireStaleCallingQueues` runs via `setInterval(30_000)` in `ManageCombined`. Modern browsers throttle background timers to fire no more than once per minute, and often much less when the tab is hidden. If a staff member locks their iPad for 10 minutes mid-event, calling tickets that should have expired at the 30-minute mark can persist for 40–50 minutes.

**Operational impact:** The queue dashboard shows tickets as "Calling" long past their window. Staff manually clearing them is error-prone. Customers whose tickets should have expired may still try to show up.

**Current mitigation:** `expireStaleCallingQueues` runs on interval only — no `visibilitychange` handler to trigger a fresh run when the tab comes back into focus.

**Fix (should fix soon):** Add a visibility change handler in `ManageCombined`:

```typescript
useEffect(() => {
  const onVisible = () => {
    if (!document.hidden && activeEvent?.id) expireStaleCallingQueues();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => document.removeEventListener('visibilitychange', onVisible);
}, [activeEvent?.id, expireStaleCallingQueues]);
```

**Longer term:** Move expiry to a Supabase Edge Function with pg_cron (`*/10 * * * *`). This is the only way to make expiry reliable when no staff device is active.

---

## Failure 7 — Interrupted payment leaves stock permanently reserved

**What happens:** Staff processes a queue customer. `create_customer_order_with_stock` runs and succeeds — order is created in `confirmed` state with `stock_reserved += N`. The network dies before `complete_order_with_stock` runs. Staff doesn't reload — they move on, serve the next customer. The confirmed order sits in DB forever with stock permanently reserved.

**Operational impact:** The artist ends the event with items showing as "reserved" that were never actually paid for. A product with `stock_total=5, stock_reserved=2, stock_sold=3` appears to have 0 available (`5-2-3=0`) when in reality there are 2 unsold units.

**Current mitigation:** `fetchCurrentOrder` recovers the cart if the staff reloads the page and selects the same queue ticket. This works for the attentive case. There is no cleanup for forgotten orders.

**Fix (should fix soon):** Add a check in `OrderHistory.tsx` that flags orders in `draft` or `confirmed` state older than 2 hours with an orange warning and a "Release reservation" action. Add a cleanup RPC:

```sql
create or replace function public.cancel_stale_order(p_order_id uuid)
-- Releases stock_reserved, sets order status = 'cancelled'
```

As a parallel measure, a Supabase Edge Function running hourly can auto-cancel `confirmed` orders older than 4 hours that have never progressed to `completed`.

---

## Failure 8 — Walk-in order duplicates on "payment failed" retry

**What happens:** Staff serves a walk-in (no queue ticket). They tap Charge Cash. `create_walkin_order_with_stock` → `applyPricingToOrder` → `complete_order_with_stock`. The first two succeed; the third fails (network error). Toast shows "Payment failed." The first RPC actually created and completed an order (or partial state). Staff assumes failure, re-selects walk-in mode, rebuilds cart, charges again. This creates a second `completed` order with no queue link — no way to detect the duplicate.

**Operational impact:** The artist is debited twice from stock but may only receive one payment. Post-event, `OrderHistory` shows two identical walk-in orders 30 seconds apart — hard to notice during busy event cleanup.

**Current mitigation:** For queue-linked orders, the RPC-level `order_not_editable` guard prevents this. Walk-in orders have no such guard — each invocation of `create_walkin_order_with_stock` creates a fresh order.

**Fix (must fix before pilot):** After any payment error, show the last walk-in order created for this event in the error toast:

> "Payment status unknown. **Last walk-in order was ฿450 at 14:32** — check before retrying."

Requires a single query to `orders WHERE queue_id IS NULL AND event_id = ? ORDER BY created_at DESC LIMIT 1` in the catch block. No DB change needed.

---

## Failure 9 — ETA wildly wrong at the start of the event day

**What happens:** `estimate_queue_eta` computes median service time from the last 80 completed tickets with `served_at` and `completed_at` both set. At 10:00am when the event opens, there are zero completed tickets. The formula falls back to `v_effective_seconds = 75` (75 seconds per person). For a creator selling custom cosplay items, actual service time is often 5–10 minutes per customer. The ETA shown to customer #40 would be "~50 minutes" but reality is "4+ hours."

**Operational impact:** Customers return to the booth far too early, causing a physical crowd at the booth even during the online queue — the system is designed to *prevent* this.

**Current mitigation:** `v_effective_seconds` is clamped between 30 and 180 seconds. Worst case displayed is `people_ahead × 180s` which may still be under-estimated for slow-service booths.

**Fix (nice to have):** Let the booth owner configure a default service time during event setup. Add an `avg_service_seconds` field to `events`. `estimate_queue_eta` prefers real historical data but falls back to the owner-set value. A simple picker during event creation — "How long does each customer take? 1 min / 3 min / 5 min / 10 min" — is enough for a pilot.

---

## Failure 10 — Booth close/open has two unlinked control surfaces

**What happens:** There are two independent code paths for toggling `is_booth_open`:
1. `ManageCombined.handleBoothToggle` — direct DB update. Shows `window.confirm` before closing.
2. `QueuePanel.handleToggleBooth` — calls `set_booth_open_status` RPC. No confirmation dialog.

A `queue_staff` user (no management access) can still see and tap the toggle in QueuePanel and close the booth without any confirmation prompt. The change propagates via Realtime immediately — the "Get Ticket" button disappears for all customers in real time.

**Operational impact:** Accidental booth closure during a busy event blocks all new queue joins instantly across all customer devices.

**Current mitigation:** None. `handleToggleBooth` only checks if `activeEvent` exists, not the caller's role.

**Fix (must fix before pilot):** Add a role guard to `QueuePanel.handleToggleBooth`:

```typescript
if (!['owner', 'manager'].includes(actorContext.role)) {
  setToast({ tone: 'error', title: 'Permission denied',
    detail: 'Only owners and managers can toggle booth status.' });
  return;
}
```

Then hide the toggle button entirely for `seller` and `queue_staff` roles in the QueuePanel UI.

---

## Priority Summary

### Must fix before pilot

| # | Issue | Effort |
|---|---|---|
| 1 | Customer loses ticket — no recovery path | 1 day |
| 2 | Payment hangs on network drop — no timeout, no recovery hint | 4 hours |
| 4 | Transfer payment with no verification | 4 hours (DB column + UI step) |
| 8 | Walk-in double payment on retry | 2 hours |
| 10 | `queue_staff` role can toggle booth closed without confirmation | 2 hours |

### Should fix soon (before second event)

| # | Issue | Effort |
|---|---|---|
| 5 | Stock oversell error is unreadable; cart not re-validated on Realtime | 4 hours |
| 6 | Queue expiry stops when staff tab is backgrounded | 2 hours |
| 7 | Draft order leaves stock reserved after payment failure | 4 hours |

### Nice to have (after first pilot feedback)

| # | Issue | Effort |
|---|---|---|
| 3 | "Calling" notification requires screen on | 1–3 days (Web Push) |
| 9 | ETA wrong at event start — no real history yet | 2 hours |
