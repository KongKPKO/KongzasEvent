# Fragility & Security Audit

Date: 2026-05-07
Scope: Supabase RLS/security, realtime subscriptions, queue race conditions, stale ticket handling, anonymous ticket ownership, stock consistency, payment consistency, localStorage dependency, mobile browser edge cases, state synchronization.

---

## Risk 1 — `cancel_customer_order_with_stock_release` is callable by anonymous users with no ownership check

**File:** `supabase/migrations/20260503134056_event_product_catalog.sql:521`

**Why it's risky:**

```sql
grant execute on function public.cancel_customer_order_with_stock_release(uuid) to anon, authenticated;
```

The function body only checks `v_order.status not in ('draft', 'confirmed')`. It has no `auth.uid()` check, no `has_artist_role` check, and no queue-owner check. Any anonymous visitor to the site who obtains a valid order UUID can call this RPC and cancel any active order, releasing stock reservations.

The orders table is not publicly readable via RLS, but the RPC is callable by `anon`. The order UUID itself is a v4 UUID (hard to guess), but:
- Any browser can log network requests in DevTools at checkout time and see the order UUID
- A customer who observes their own `queue_id` (visible in localStorage) could attempt to enumerate order UUIDs

**Bugs/failures this causes:**

1. Malicious cancellation of another booth's active orders, releasing stock reservations mid-event.
2. A customer who spots their own order UUID can cancel their own order after it is in `confirmed` state, getting stock released before the artist delivers the item.
3. Staff pressing "back" or refreshing during checkout may cause a client-side retry that calls the cancel RPC before calling the complete RPC.

**Minimum safe fix:**

Add a caller role check as the first line of the function body:

```sql
if not public.has_artist_role(
     (select e.artist_id from public.events e
      join public.orders o on o.event_id = e.id
      where o.id = p_order_id limit 1),
     array['owner', 'manager', 'seller']
   ) then
  raise exception 'forbidden';
end if;
```

Then change the grant:

```sql
revoke execute on function public.cancel_customer_order_with_stock_release(uuid) from anon;
```

**What can wait:** A customer-facing "cancel my pre-order" feature (if it ever exists) could use a separate narrow RPC that verifies the customer owns the queue ticket linked to the order.

---

## Risk 2 — `create_customer_order_with_stock` callable by `anon` with no queue-ownership check

**File:** `supabase/migrations/20260503134056_event_product_catalog.sql:98` + grant at line 358

**Why it's risky:**

```sql
grant execute on function public.create_customer_order_with_stock(uuid, jsonb) to anon, authenticated;
```

The function accepts `p_queue_id`. It only checks that the queue exists and is in an active status — it does NOT verify the caller owns or is linked to that queue. The `queues` table is publicly readable, so any anon user can:

1. Do `SELECT id FROM queues WHERE event_id = ? AND status = 'serving'` — this is publicly visible.
2. Do `SELECT id FROM products WHERE artist_id = ?` — also publicly visible.
3. Call `create_customer_order_with_stock(queue_id, [{product_id, quantity: 999}])`.

**Bugs/failures this causes:**

1. Stock exhaustion attack: create phantom orders reserving all stock units before any customer reaches the booth. For bounded stock items, `insufficient_stock` eventually blocks new reservations, but the attack drains all units instantly.
2. Ghost orders attached to real customer queue tickets. Staff sees an unexpected order pre-loaded in POS for a customer who didn't select anything.
3. For unlimited-stock products, phantom orders accumulate unbounded.

**Minimum safe fix:**

Add a link between the caller and the queue. The simplest approach for the current design (no customer accounts) is to require an `authenticated` caller and verify the caller has an artist role for the event:

```sql
-- In create_customer_order_with_stock:
if auth.uid() is not null then
  if not public.has_artist_role(v_event.artist_id, array['owner', 'manager', 'seller', 'queue_staff']) then
    raise exception 'forbidden';
  end if;
end if;
```

This restricts the "pre-order on behalf of customer" path to authenticated staff. Customers joining the queue never directly call this RPC — they only call `create_queue_ticket`. The POS staff calls `create_customer_order_with_stock` after confirming arrival.

```sql
revoke execute on function public.create_customer_order_with_stock(uuid, jsonb) from anon;
```

**What can wait:** If a future feature lets customers pre-select items from the menu while waiting, a properly authenticated customer pre-order RPC can be designed then.

---

## Risk 3 — `complete_order_with_stock` has no caller ownership check

**File:** `supabase/migrations/20260503134056_event_product_catalog.sql:578`

**Why it's risky:**

```sql
grant execute on function public.complete_order_with_stock(uuid, text) to authenticated;
```

The function locks the order with `FOR UPDATE` and checks only that the order is not already completed or cancelled. There is no `has_artist_role` check. Any authenticated user in the system — even a `seller` from a completely different artist's workspace — who knows an order UUID can call this function and mark the order as `completed`, causing the queue ticket to close and stock to be deducted.

**Bugs/failures this causes:**

1. Authenticated attacker can mark competitor's orders as `complete` with `payment_method='cash'` without any real payment, advancing the queue and deducting stock.
2. Staff from Artist A who knows Artist B's order UUID (from browser network logs) can complete Artist B's orders, corrupting Artist B's revenue records.
3. If a client-side bug re-calls `complete_order_with_stock` on an already-completed order, the function returns `true` early (idempotent for order status) but still triggers the queue update again — firing two realtime UPDATE events for the same queue ticket.

**Minimum safe fix:**

Add an ownership check at the top of the function:

```sql
if not public.has_artist_role(
     (select e.artist_id from public.orders o
      join public.events e on e.id = o.event_id
      where o.id = p_order_id limit 1),
     array['owner', 'manager', 'seller']
   ) then
  raise exception 'forbidden';
end if;
```

**What can wait:** Caller audit logging (who completed which order, at what time via which device) can be added later via a `completed_by uuid` column on `orders`.

---

## Risk 4 — Legacy owner fallback in `fetchActorContext` is an escalation path

**File:** `src/utils/access.ts:14`

**Why it's risky:**

When `get_actor_context()` RPC fails for any reason (timeout, network error, function error), the code falls back to `fetchLegacyOwnerContext()`:

```typescript
const { data: emailArtist } = await supabase
  .from('artists')
  .select('id')
  .ilike('email', email)           // ← searches artists WHERE artist.email = auth_user.email
  .order('updated_at', { ascending: false })
  .limit(1)
  .maybeSingle();
```

The `artists.email` column is user-editable. Artist B can update their profile to set `email = 'user-a@example.com'`. When user A's `get_actor_context()` call fails, the fallback matches artist B's record and grants user A `owner` access to artist B's workspace.

The `artists_update_self` RLS policy (`USING (auth.uid() = id)`) prevents artist B from updating anyone else's row. But artist B CAN set their own email to any string — the DB has no uniqueness or format constraint beyond `email` being a plain `text` column. After doing so, if user A hits a network blip and falls back to legacy lookup, they are now acting as artist B's owner.

**Bugs/failures this causes:**

1. Privilege escalation: user A gains owner-level access to artist B's events, products, orders, and team.
2. Triggered not by a sustained attack but by any transient Supabase RPC failure — which happens in poor network conditions at events.
3. The `limit(1) order by updated_at desc` means the attacker who most recently updated their artist record "wins" the match if multiple artists try this.

**Minimum safe fix:**

Replace the email-based fallback with a strict UUID-only lookup:

```typescript
const fetchLegacyOwnerContext = async (): Promise<ActorContext | null> => {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return null;

  // Only match by auth.uid() = artists.id (the original owner relationship)
  const { data } = await supabase
    .from('artists')
    .select('id')
    .eq('id', userData.user.id)    // ← UUID match only, no email lookup
    .maybeSingle();

  if (!data) return null;
  return {
    artist_id: data.id,
    role: 'owner',
    is_owner: true,
    member_email: userData.user.email?.toLowerCase() || null,
  };
};
```

This removes the email-matching entirely. Non-owner members (sellers, queue_staff) will get null context on RPC failure and be redirected to login — acceptable degradation.

**What can wait:** A proper retry strategy for `get_actor_context()` with backoff, rather than the fallback pattern entirely.

---

## Risk 5 — `CallingNotification` misses tickets obtained in the current session

**File:** `src/components/CallingNotification.tsx:48`

**Why it's risky:**

`CallingNotification` is mounted once in `CustomerLayout` and reads `localStorage.getItem(`ticket_id_${artistId}`)` in a `useEffect` that only re-runs when `artistId` changes:

```typescript
useEffect(() => {
  const storedTicketId = localStorage.getItem(`ticket_id_${artistId}`);
  if (storedTicketId) {
    setTicketId(storedTicketId);
    // ...subscribe to ticket status
  }
}, [artistId]);                    // ← only runs once per artist
```

When a customer opens `/:slug/home`, then navigates to `/:slug/queue` and taps "Get Ticket", `QueueView.handleGetTicket()` writes the ticket ID to localStorage. But `CallingNotification` has already run its `[artistId]` effect, found no ticket, and set `ticketId = null`. It never re-reads localStorage.

The `[ticketId, artistId]` effect that subscribes to realtime queue changes only fires when `ticketId` is truthy. Since `ticketId` is still null in `CallingNotification`, the realtime subscription for "calling" events is never established for this ticket.

**Bugs/failures this causes:**

1. Customer joins queue → browses menu → staff calls their number. The yellow calling banner in `CallingNotification` **does not appear**. The customer must be on the `/queue` page to see the status change. The primary notification mechanism fails for any customer who browses after joining.
2. `navigator.vibrate([200, 100, 200])` at line 103 — the vibration that provides the only sensory alert — also never fires.
3. No failure message to the customer. The yellow banner simply never appears on Home or Menu pages.

**Minimum safe fix:**

Add a storage listener to `CallingNotification` so it picks up the ticket ID as soon as it is written:

```typescript
useEffect(() => {
  const key = `ticket_id_${artistId}`;

  const handleStorage = (e: StorageEvent) => {
    if (e.key === key && e.newValue && e.newValue !== ticketId) {
      setTicketId(e.newValue);
    }
  };

  window.addEventListener('storage', handleStorage);
  return () => window.removeEventListener('storage', handleStorage);
}, [artistId, ticketId]);
```

Note: `StorageEvent` fires on `storage` changes from **other tabs** by browser spec. For same-tab writes, use a small custom event:

In `QueueView.handleGetTicket`, after writing to localStorage:
```typescript
localStorage.setItem(`ticket_id_${displayArtist.id}`, data.id);
window.dispatchEvent(new Event('ticket-updated'));   // ← add this
```

In `CallingNotification`:
```typescript
window.addEventListener('ticket-updated', recheckLocalStorage);
```

**What can wait:** Web Push notifications as a proper replacement for the banner approach.

---

## Risk 6 — Realtime channel multiplication across components

**Why it's risky:**

For a customer on `/:slug/queue`, the following channels are all active simultaneously, each subscribing to overlapping Supabase tables:

| Channel name | Table | Component |
|---|---|---|
| `artist-realtime-${artistId}` | `artists` UPDATE | `useArtistRealtime` in CustomerLayout |
| `artist-broadcast-notification:${artistId}` | `artists` UPDATE | `CallingNotification` |
| `artist-system-${artistId}` | system events | `useArtistRealtime` |
| `public:queues:${activeEvent.id}` | `queues` ALL | `QueueView` |
| `my-ticket-notification:${ticketId}` | `queues` UPDATE | `CallingNotification` |

For a staff member on `/manage-pos-queues`:

| Channel name | Table | Component |
|---|---|---|
| `manage-combined-events-${artistId}` | `events` ALL | ManageCombined |
| `manage-combined-queues-${artistId}-${eventId}` | `queues` ALL | ManageCombined |
| `queue-panel-artists-${artistId}` | `artists` UPDATE | QueuePanel |
| `pos-panel-products-${artistId}-${eventId}` | `products` + `event_products` ALL | PosPanel |
| `pos-panel-promotions-${artistId}` | `artist_promotions` ALL | PosPanel |
| `pos-orders-${selectedQueueId}-${Date.now()}` | `orders` ALL | PosPanel |

Supabase Realtime multiplexes all channels over a single WebSocket connection, but each `postgres_changes` subscription registers a server-side filter listener. The `artists` table receives 3 separate channel listeners when a customer is in the booth flow.

**Bugs/failures this causes:**

1. Every artist profile update (broadcast message change, queue open/close) triggers 2 separate payload deliveries on the customer side. Both handlers update state, causing double renders.
2. The `pos-orders-${selectedQueueId}-${Date.now()}` channel name includes `Date.now()`. Every time `selectedQueueId` or `activeEvent.id` changes, a new channel with a new name is created. The old channel is removed in cleanup, but if the effect fires during a React StrictMode double-invoke or fast state change, multiple channels with different timestamps exist simultaneously.
3. Hitting Supabase Realtime channel limits. The free/pro plan limits concurrent channel subscriptions. A staff dashboard with 5 channels active and 2+ concurrent staff devices approaches the limit quickly.

**Minimum safe fix:**

Merge the two `artists` UPDATE listeners (in `useArtistRealtime` and `CallingNotification`) into one shared subscription passed via the outlet context. `CallingNotification` should consume `realtimeArtist` from context rather than subscribing independently:

```typescript
// CustomerLayout already passes realtimeArtist via context
// CallingNotification should receive broadcastMessage as a prop from context, not re-subscribe
```

Remove the duplicate `artist-broadcast-notification` channel from `CallingNotification` entirely. The `useArtistRealtime` hook already maintains artist state including `broadcast_message`.

Fix the `Date.now()` channel name in `PosPanel`:
```typescript
// Before:
`pos-orders-${selectedQueueId}-${Date.now()}`
// After:
`pos-orders-${selectedQueueId}`
```

**What can wait:** A full audit of all channel subscriptions across the app and consolidation into shared hooks.

---

## Risk 7 — `resilientFetch` silently retries mutating RPCs

**File:** `src/supabaseClient.ts:71`

**Why it's risky:**

```typescript
const isTransientAbort = message.includes('aborted') || message.includes('failed to fetch');
if (isTransientAbort) {
  return await fetchWithTimeout(input, init);   // ← unconditional retry
}
```

This retry applies to ALL fetch calls, including POST requests to Supabase RPC endpoints. A `failed to fetch` error can occur:
- Before the request reaches the server (safe to retry)
- After the server processed the request and the response was lost in transit (NOT safe to retry)

For `create_queue_ticket`: if the first call committed an INSERT and the response was lost, the retry creates a **second ticket** for the same customer. The customer's localStorage gets the first ticket ID (from the first successful response) if it arrived before the abort, or gets the second ticket ID if the retry response arrives first — depending on race timing.

For `create_customer_order_with_stock`: a retry creates a **second order** for the same queue ticket. Both orders are in `confirmed` state, both reserve stock. Only one gets completed. The other stays as a confirmed orphan reserving inventory.

**Bugs/failures this causes:**

1. Duplicate queue tickets for the same customer in a single session.
2. Duplicate confirmed orders for the same queue ticket, reserving double the stock.
3. Because `Failed to fetch` is a common network error on mobile, this isn't a rare edge case — it is triggered regularly on poor venue WiFi.

**Minimum safe fix:**

Do not retry POST requests. Check the HTTP method before retrying:

```typescript
const resilientFetch: typeof fetch = async (input, init) => {
  const method = (init?.method || 'GET').toUpperCase();
  const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  try {
    return await fetchWithTimeout(input, init);
  } catch (err) {
    if (isMutating) throw err;            // ← never retry mutations
    // ... existing retry logic for GET only
  }
};
```

**What can wait:** Idempotency keys (a `X-Idempotency-Key` header passed with each RPC call) would allow the server to deduplicate retried mutations safely, but requires Supabase Edge Function proxy setup.

---

## Risk 8 — LocalStorage as the only customer identity mechanism

**Files:** `src/pages/customer/QueueView.tsx`, `src/components/CallingNotification.tsx`, `src/pages/customer/CustomerLayout.tsx`

**Why it's risky:**

The entire customer-side queue experience depends on `localStorage.getItem(`ticket_id_${artistId}`)`. LocalStorage is cleared by:
- Safari's ITP (Intelligent Tracking Prevention) on iOS — purges after 7 days of no direct interaction with the domain
- Private/Incognito browsing — cleared on tab close
- User tapping "Clear site data" in browser settings
- Low storage conditions on Android where the OS may aggressively purge storage
- Switching devices at any point

Additionally, `CustomerLayout` stores the selected event in localStorage:
```
customerEventStorageKey(displayArtist.id) → `customer_event_${artistId}`
```

And `ManageCombined` stores the selected event:
```
posSelectedEventId:${actorContext.artist_id}
```

Five separate keys per artist exist in localStorage, each with no expiry, no versioning, and no cross-tab consistency mechanism. If localStorage becomes corrupted or full, silent failures result — the app falls back to defaults with no user-visible error.

**Bugs/failures this causes:**

1. iOS Safari: customer joins queue in Safari, switches to Chrome (a common "try another browser" behavior in Asia), ticket is gone.
2. Private browsing: some customers habitually browse in private mode. Their ticket vanishes when the tab closes.
3. Low-memory Android: OS may kill background tabs and clear storage, then customer returns to find "no ticket."
4. Two tabs in same browser: if a customer opens two queue tabs for the same artist (accidental), the second tab overwrites `posSelectedEventId` on any event switch, affecting the first tab.

**Minimum safe fix:**

Add a visible ticket recovery UI as described in the Pilot Readiness Review. Additionally, show an explicit warning when the app detects it is running in a private browser context:

```typescript
// Detect private mode (approximation):
const isPrivate = (() => {
  try {
    localStorage.setItem('__test', '1');
    localStorage.removeItem('__test');
    return false;
  } catch {
    return true;
  }
})();

if (isPrivate) {
  showToast('Private browsing detected. Your ticket will be lost if you close this tab.');
}
```

Also validate localStorage writes succeed before relying on them:

```typescript
try {
  localStorage.setItem(key, value);
} catch {
  // QuotaExceededError or SecurityError
  showToast('Cannot save ticket locally. Screenshot your queue number.');
}
```

**What can wait:** A proper server-side session linked to a short-lived token (e.g., a 6-digit code + artist slug lookup) that replaces localStorage as the primary ticket recovery mechanism.

---

## Risk 9 — `useArtistRealtime` starts `isConnected = true` before connection is established

**File:** `src/hooks/useArtistRealtime.ts:46`

**Why it's risky:**

```typescript
const [isConnected, setIsConnected] = useState(true); // Assumption: Starts connected
```

The Supabase Realtime WebSocket connection is established asynchronously in `useEffect`. Between component mount and the subscription becoming `SUBSCRIBED`, the state claims connectivity. During this window:

1. `CustomerLayout` passes `isConnected` to the outlet context.
2. `QueueView` renders `{!isConnected && <div>Offline indicator</div>}` — hidden because `isConnected = true`.
3. If `fetchInitialData()` fails (network error), `isConnected` stays `true` and the events list stays empty with no offline feedback.

Additionally, the system channel subscribed for connection events:
```typescript
.on('system', { event: '*' }, (payload) => {
  if (payload.event === 'disconnect') setIsConnected(false);
  if (payload.event === 'connect') setIsConnected(true);
})
```
The `system` event API is not officially documented in Supabase JS v2. Relying on undocumented event payloads means this could silently stop working after a client library upgrade.

**Bugs/failures this causes:**

1. Customer at a venue with no signal loads the page from PWA cache. `isConnected` remains `true`. Customer sees stale data from initial render with no offline indicator. They tap "Get Ticket" — request fails silently or hangs.
2. `CHANNEL_ERROR` status is handled on the main channel but not on the system channel — if the system channel errors, `isConnected` is never updated.
3. During reconnect after a drop, both channels fire `SUBSCRIBED` and `connect` events. State flickers between connected/disconnected, potentially causing rapid re-renders of all queue data.

**Minimum safe fix:**

Start `isConnected = false` and set it to `true` only after confirmed subscription:

```typescript
const [isConnected, setIsConnected] = useState(false);   // ← pessimistic start

// In channel.subscribe callback:
.subscribe((status) => {
  setIsConnected(status === 'SUBSCRIBED');
});
```

Replace the undocumented `system` channel with the documented `onAuthStateChange` + a `RealtimeClient` level `disconnect`/`connect` check:

```typescript
const client = supabase.realtime;
// supabase-js v2: client.transport.conn.onclose / onopen
// Or use: supabase.realtime.isConnected() in a polling interval as fallback
```

**What can wait:** Full offline-first state management with optimistic updates.

---

## Risk 10 — `sync_customer_order_items_with_stock` references stale role name `'queue_pos'`

**File:** `supabase/migrations/20260215233000_sync_queue_order_stock_before_complete.sql:49`

**Why it's risky:**

```sql
if not public.has_artist_role(v_order.artist_id, array['owner', 'queue_pos']) then
    raise exception 'forbidden';
end if;
```

After the role model v2 migration (`20260504041622_creator_role_model_v2.sql`), the role `queue_pos` no longer exists in `artist_members.role`. It was renamed to `seller`. The `normalize_artist_role` function does normalize `'queue_pos'` → `'seller'` inside `has_artist_role`, so this happens to work today.

However:
1. The normalization is a runtime shim. If `normalize_artist_role` is ever simplified or removed (perfectly reasonable since the old roles don't exist in the DB anymore), this function breaks silently — sellers get `'forbidden'` errors at checkout.
2. The same stale role reference exists in `create_walkin_order_with_stock` at line 719:
   ```sql
   if not public.has_artist_role(v_event.artist_id, array['owner', 'queue_pos']) then
   ```
3. `event_products_staff_read` RLS policy uses `array['owner', 'queue_pos', 'queue_only']` — same pattern.

A future developer maintaining the normalization code would have no way to know these three locations depend on the old names being preserved.

**Bugs/failures this causes:**

1. If `normalize_artist_role` is removed as cleanup (it would seem safe to remove since all DB rows already have the new role names), sellers can no longer sync order items or process walk-in payments. The payment flow raises `'forbidden'` with no stack trace pointing to the root cause.
2. Silent regression: no test will catch this because the normalization still works until someone removes it.

**Minimum safe fix:**

Update all three references to use current role names:

In `20260215233000_sync_queue_order_stock_before_complete.sql` (via a new migration):
```sql
create or replace function public.sync_customer_order_items_with_stock(...)
...
-- change:
if not public.has_artist_role(v_order.artist_id, array['owner', 'seller']) then
```

In `create_walkin_order_with_stock`:
```sql
if not public.has_artist_role(v_event.artist_id, array['owner', 'seller']) then
```

In `event_products_staff_read` policy:
```sql
using (public.has_artist_role(artist_id, array['owner', 'manager', 'seller', 'queue_staff']));
```

**What can wait:** Removing `normalize_artist_role` entirely can wait until all stale references are confirmed cleaned up via a DB-level audit (`grep -r "queue_pos\|queue_only"` across all migrations and functions).

---

## Summary Table

| # | Area | Risk Level | Fix Before Pilot | Fix Soon | Can Wait |
|---|---|---|---|---|---|
| 1 | `cancel_order` callable by anon, no ownership check | **Critical** | Yes | — | — |
| 2 | `create_customer_order` callable by anon, no queue-ownership | **Critical** | Yes | — | — |
| 3 | `complete_order` no caller ownership check | **High** | Yes | — | — |
| 4 | Legacy owner fallback escalates via artist email field | **High** | Yes | — | — |
| 5 | `CallingNotification` misses same-session tickets | **High** | Yes | — | — |
| 6 | Realtime channel multiplication + unstable channel name | **Medium** | — | Yes | — |
| 7 | `resilientFetch` retries mutating RPCs | **High** | Yes | — | — |
| 8 | localStorage as sole customer identity | **Medium** | Partial | Full | — |
| 9 | `isConnected` starts true, system channel undocumented | **Medium** | — | Yes | — |
| 10 | Stale role names in 3 RPCs — hidden normalization dependency | **Medium** | — | Yes | — |

### Must fix before pilot (items 1, 2, 3, 4, 5, 7)
All of items 1–3 are security vulnerabilities that could be exploited by anyone with browser DevTools. Items 4 and 7 are exploitable via normal network conditions. Item 5 is the most impactful UX failure: the notification banner — the app's only alerting mechanism — doesn't work for tickets obtained in the current session.

### Fix soon after first event (items 6, 8, 9, 10)
These cause real degradation but not data corruption. Item 8 (localStorage) is partially addressed by the ticket recovery UI from the Pilot Readiness Review.

### What to avoid changing right now
- The `create_queue_ticket` RPC: the atomic lock + unique index is correct, do not touch.
- RLS policies added in migrations after `20260504`: these just settled.
- `promotionPricing.ts` and `schemaCompat.ts`: working, tested, not implicated in any of the above risks.
- The `ManageCombined` / `QueuePanel` / `PosPanel` layout: complex but working. The fixes above are all additive (grants, guards, event listeners) — none require restructuring the component tree.
