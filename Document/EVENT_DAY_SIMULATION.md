# Event Day Simulation

Date: 2026-05-07
Context: Thai creator/cosplay booth. Artist selling merchandise + cheki (instant photo sessions). One owner, two staff. 80–120 customers expected. Event 10:00–18:00.

---

## Pre-Event: 09:00–09:55

**Owner sets up on laptop at the booth.**

Owner logs into `/manage-events`, confirms event is in `Confirmed` status. Opens `/manage-products` and verifies the catalog: 12 items — acrylic charms, print sets, keychains, and 2 cheki options (Standard ฿200, With Costume ฿350). Sets `is_unlimited=false` on cheki products with `stock_total=30` each.

Navigates to `/manage-pos-queues`. Selects today's event from the dropdown. Sees "No Active Event" because `start_date` is 10:00 and it is currently 09:45 — `list_accessible_pos_events()` filters `e.start_date <= now()`, so the event does not appear yet.

**What goes right:** This is correct behavior. The system correctly prevents premature booth opening.

**What goes wrong:** The owner doesn't know why the event isn't showing. There is no message saying "event starts in 15 minutes." The dropdown just shows "No active event" with no explanation. Owner will spend time refreshing and worrying.

**Manual fallback needed:** Owner needs to know the rule: events only appear in the POS dropdown after `start_date`. Brief the owner on this before the event. A "next event starts at HH:MM" message in the empty state would help.

---

## Opening: 10:00–10:20

**Owner opens the booth at exactly 10:00.**

Refreshes `/manage-pos-queues`. Event now appears in the dropdown — `list_accessible_pos_events()` now passes the `start_date <= now()` check. Owner toggles booth open via the green toggle in QueuePanel. This calls `set_booth_open_status` RPC, sets `is_booth_open = true` on the event. Supabase Realtime propagates the change.

**What goes right:** The "Get Ticket" button on `/:slug/queue` activates for all customers simultaneously within ~1 second of the toggle. Realtime subscription on `events` table in `useArtistRealtime` fires, updates `is_booth_open`, and the customer UI re-renders. The queue is open.

Staff A (seller, on personal Android phone) logs into `/manage-login`, navigates to `/manage-pos-queues`. POS dashboard loads. Staff B (queue_staff, on owner's spare iPad) logs in and sees the queue panel only — no POS access, which is correct for the `queue_staff` role.

**What goes wrong — first complication:** Staff A is on an Android phone. The POS panel renders a product grid, but the cart is behind a bottom-sheet modal (the mobile cart UX). Each time Staff A needs to check the cart total or apply a payment, they tap the bottom bar, the sheet slides up, they process, close it. On a 5.5-inch phone screen under booth lighting with people talking, this is physically awkward. The grid product cards are small. Staff A will slow down significantly compared to tablet usage.

**What goes wrong — second complication:** Staff B on the iPad sees QueuePanel only. But QueuePanel has a booth open/close toggle — and Staff B's role is `queue_staff`. Based on the current code, `QueuePanel.handleToggleBooth` has **no role check**. Staff B can accidentally close the booth by tapping the toggle. No confirmation dialog appears for them (the confirmation in `ManageCombined.handleBoothToggle` is a different code path). One tap and every customer immediately sees "Booth Closed."

---

## The Rush: 10:20–11:00

**A LINE announcement goes out. 40 customers hit the queue page in 3 minutes.**

Customers arrive at `/:slug/queue`. Each taps "Get Ticket."

**What goes right:** `create_queue_ticket` acquires a `FOR UPDATE` lock on the event row and atomically increments from `MAX(queue_number) + 1` within `queue_service_date`. Even with 40 simultaneous taps, no two customers get the same number. Tickets #1 through #40 are issued cleanly. The unique index `queues_event_service_date_queue_number_uidx` is a safety net if anything slips past the lock.

**What goes right — customer UX:** Each customer immediately sees their ticket card:
- Ticket number in large font
- "Now Serving: --" (nobody served yet)
- ETA: "people ahead: 39, estimated wait: 32–48 minutes" (using the fallback 75s/customer since no completed tickets exist yet)

**What goes wrong — ETA is wrong from the start:** 75 seconds per customer is the cold-start default in `estimate_queue_eta`. This booth serves cheki customers (photo + costume change: 8–15 minutes each) and merch customers (1–2 minutes each). The actual per-customer time will average around 5–6 minutes. The ETA shown for ticket #40 is "32–48 minutes." Actual wait time: 3–4 hours.

Customer #40 sees "estimated 40 minutes" and thinks "I'll come back in 30 minutes." They will be disappointed.

**What goes wrong — CallingNotification silent for current-session joiners:** Every customer who opens `/:slug/home` first, then navigates to `/:slug/queue` and gets a ticket, then navigates back to `/:slug/menu` to browse — their ticket is written to localStorage by `QueueView.handleGetTicket`, but `CallingNotification` in `CustomerLayout` has already run its `[artistId]` effect at mount time and found no ticket. The realtime subscription for their ticket is never registered in `CallingNotification`. When staff later calls their number, **the yellow banner does not appear** on the Home or Menu page. The customer must be on the Queue page to see the status change.

Of 40 customers who just joined, perhaps 30 navigate away to browse the menu. 30 customers will not see the calling notification banner.

**What goes wrong — resilientFetch silent retry during rush:** With 40 customers hitting "Get Ticket" simultaneously on unstable venue WiFi, some requests will abort mid-flight. The `resilientFetch` in `supabaseClient.ts` catches `'failed to fetch'` and silently retries. If the first call reached the DB and committed (a ticket was created), the retry creates a second ticket. The customer receives the second ticket ID in the response and stores it in localStorage. The first ticket is now an orphan — sitting as `waiting` in the staff queue with no customer attached.

In 40 rush-period joins with flaky WiFi, expect 2–4 ghost tickets. Staff will call these, no one will show up, they will sit in "Calling" for 30 minutes and then expire.

**Manual fallback needed:** Staff should know to skip a calling ticket if no one responds within 60 seconds and move to the next. A "mark as missed" workflow needs to be verbally briefed before the event since there's no timeout message on the staff UI.

---

## First Serving Cycle: 10:20–11:30 (Tickets #1–#8)

**Staff B on the iPad calls "Call Next."**

QueuePanel shows ticket #1 with "Waiting." Staff B taps "Call Next." `updateStatus(next.id, 'calling')` fires. Supabase Realtime propagates. Customer #1's queue page turns yellow with pulsing animation — if they are on that page.

**What goes right:** Customer #1 is at the booth already (they were waiting physically). Staff B presses "ARRIVED." Status becomes `serving`. Ticket #1 appears in the POS header on Staff A's phone.

**What goes right — photo session flow:** Staff A selects ticket #1, finds "Cheki Standard ฿200" in the product browser, adds it to cart, taps "Charge." Payment modal: customer hands over cash. Staff A taps "CASH." Three RPCs fire in sequence:
1. `sync_customer_order_items_with_stock` — reserves 1 cheki unit
2. `applyPricingToOrder` — no promotions active
3. `complete_order_with_stock` — deducts 1 from stock_reserved, adds 1 to stock_sold, marks queue #1 as `complete`

All three succeed. Stock updates. Staff A sees success toast. Cart clears.

**What goes right:** Customer #1's phone (on Queue page) shows `complete` status within ~1 second. They know the transaction is done.

**What goes wrong — cheki vs merch queue mixing:** Ticket #2 arrives. It is a merch-only customer (just wants 2 keychains, takes 45 seconds). But the photo studio isn't free yet (owner is still changing costume from ticket #1's session). So ticket #2 waits even though Staff A could serve them immediately at the merch table. The system has no "service type" concept. There's no way to mark a ticket as "merch only" vs "cheki" so merch customers get routed to a fast track.

Customers with merch-only intent are stuck in the same queue as cheki customers. Average wait time inflates badly. Customers #3 and #5 are also merch-only. They wait 20+ minutes behind a single cheki session.

**Manual fallback needed:** The owner needs to announce verbally (or via a handwritten sign) that merch-only customers can approach the merch table directly without a queue. This is a pure operational gap that the system cannot solve without a "ticket type" feature.

---

## Network Instability Period: 11:00–12:00

**Venue WiFi degrades. Supabase connection becomes intermittent.**

**Realtime drops.** The Supabase WebSocket disconnects on multiple devices simultaneously.

**On the customer side:**
`useArtistRealtime` fires the `'CHANNEL_ERROR'` callback, setting `isConnected = false`. The offline banner appears: "ออฟไลน์ / Offline." The "Now Serving" number freezes. Customers on the queue page see stale data. They cannot tell if their number was called.

However: `QueueView` has a 3-second polling fallback (`setInterval(pollId, 3000)`) that calls `syncTicketStatus` directly via REST. This continues working over REST even when the WebSocket is down. Customers who are on the Queue page can see status updates within 3 seconds.

Customers who are on Home or Menu pages — no polling, no realtime, complete blindness.

**On the staff side:**
`ManageCombined` subscribes via `manage-combined-queues-${artistId}-${eventId}`. When this channel errors, new queue inserts stop appearing automatically. The waiting list freezes. Staff B on the iPad does not see new customers who just joined.

`fetchQueues()` is only called reactively on Supabase channel events and on `activeEvent.id` change — there is no periodic polling fallback on the staff dashboard. If the channel drops and doesn't reconnect, the staff waiting list is permanently stale until a page refresh.

**What goes wrong — staff doesn't realize the queue is outdated:** Staff B's queue panel shows 12 people waiting. In reality, 6 more have joined during the network drop. Staff B calls "next" based on stale data. The `updateStatus` call goes through via REST (not Websocket-dependent), so it reaches the DB. But when realtime reconnects, the queue panel receives a burst of UPDATE events and INSERT events, potentially causing queue items to appear/disappear rapidly for 1–2 seconds (React state updates from burst payload processing).

**What goes wrong — `isConnected` starts as `true`:** The `useArtistRealtime` hook initializes `isConnected = true` before the WebSocket is established. If the hook is remounted (e.g., customer navigates away and back), it starts `true` again and shows no offline indicator during the connection establishment window, even if WiFi is down.

**What the offline test actually covers:** `offline-poor-network.spec.ts` tests 1.5 Mbps / 300ms latency. Venue WiFi failures are often complete drops (0 Mbps) or severe packet loss (timeout behavior), which is the scenario marked `test.skip('Network: Should gracefully degrade on very slow network')`. The hardest case is explicitly skipped.

**Manual fallback needed:**
- Staff must refresh the browser manually after any noticed disconnection.
- Owner should verbally announce to customers: "If you're not sure about your status, tap the refresh button on the queue page."
- A laminated "HOW TO REFRESH" instruction card at the booth is practical.

---

## The First Sold-Out: 12:30

**"Cheki With Costume" stock reaches 0.**

The 30th customer to purchase Cheki With Costume triggers `complete_order_with_stock`. This updates `stock_sold = 30`, `stock_reserved = 0` (if no pending reservations). Supabase Realtime fires `UPDATE` on `products` table with `stock_sold = 30`.

**On the POS panel:** `fetchProducts` is re-called via the realtime product subscription in PosPanel. `normalizeProductRecord` runs. `getAvailableUnits(product)` returns `stock_total - stock_reserved - stock_sold = 30 - 0 - 30 = 0`. PosPanel's `filteredProducts` filter: `getAvailableUnits(product) > 0` — the item is **removed from the product browser**. Staff A's product grid no longer shows "Cheki With Costume." 

**What goes right:** The product disappears from the POS browser automatically. Staff won't accidentally add it to a new cart.

**What goes right:** The customer menu at `/:slug/menu` also subscribes to `products` via realtime in `ProductList.tsx` (or similar). The product will show as out-of-stock or disappear depending on how `MenuView` handles `is_out_of_stock`.

**What goes wrong — cart not re-validated on stock update:** Staff A had already added 1 "Cheki With Costume" to their current cart for a customer who's currently serving (ticket #29). The product subscription fires, `fetchProducts` runs, and the POS product browser updates. But the **cart items are not removed or flagged**. Staff A still sees "Cheki With Costume ฿350" in the cart summary. When they tap "Charge":

1. `sync_customer_order_items_with_stock` runs
2. Checks `v_available = stock_total - stock_reserved - stock_sold`
3. If ticket #29's cart was already creating a reservation via `create_customer_order_with_stock` earlier, the reservation is already counted
4. If no prior reservation exists: `30 - 0 - 30 = 0 < 1` → raises `insufficient_stock`
5. Payment fails with error message: `"Payment failed: insufficient_stock"`

Staff A is confused. The item was in the cart. The customer is standing at the booth. Staff A tries again — same result. They have to manually remove the item, apologize to the customer, and adjust the order.

**What goes wrong — customer on Menu page still sees product:** If the customer browsing the menu has been on the page for more than a few seconds since the stock update, the Realtime subscription should have pushed the update. But if their connection dropped briefly around the 12:30 mark, their menu view shows Cheki With Costume as available. They queue up specifically for it.

**What goes wrong — verbal communication gap:** The product is gone from the POS, but there's no way to push a "Cheki With Costume sold out" notice to customers in the queue. The broadcast message ("Break time," "Queue closed temporarily," "Urgent matter") is the only mass communication tool. The owner will need to manually type a custom broadcast message. But the QueuePanel only has preset messages with preset buttons — there's no free-text broadcast field visible in the current QueuePanel UI. 

Actually looking at `handleSetBroadcast` — the function takes any string. But the UI only shows 3 hardcoded preset buttons. There's no input field. Owner cannot type "Cheki With Costume sold out" and push it. They would have to go to `/manage-events` and update the `broadcast_message` field from there, which is on a completely different page than the POS dashboard.

**Manual fallback needed:** Owner announces verbally and/or posts to LINE group that cheki-costume is sold out. Customers in queue adjust expectations. No system support for this.

---

## Payment Mistake: 13:15

**A customer pays by QR transfer. Staff A is rushing.**

Ticket #45 arrives at the POS. Staff A selects products: 2 acrylic charms (฿180 each) + 1 print set (฿250). Total: ฿610.

Customer opens their banking app and taps "Transfer." Staff A, distracted by the line behind the customer, accidentally taps "CASH" instead of "TRANSFER" in the payment modal.

**What happens in the system:**

`complete_order_with_stock` runs with `p_payment_method = 'cash'`. Order is marked `completed` with `payment_method = 'cash'`. Queue #45 is marked `complete`. Stock deducted. Success toast appears.

The customer's transfer may or may not have arrived. If they transferred before the tap, the artist has ฿610 in their account but the system says cash. If they transferred after, the system records cash but no cash was received. Both scenarios corrupt the payment records.

**What goes right:** The actual stock deduction is correct. The items are sold. The transaction completed.

**What goes wrong:** `orders.payment_method = 'cash'` for a QR transfer. End-of-day reconciliation: the artist counts cash in the box, subtracts the expected amount from system, finds a discrepancy. They can see all orders in `OrderHistory` but cannot determine from the data alone which specific order had the wrong payment method recorded.

There is no `payment_reference` column on the `orders` table. There's no slip photo. The only audit trail is Staff A's memory.

**What goes wrong — cannot correct it:** There is no "edit order" function in the UI after an order is `completed`. The `OrderHistory` page is read-only. The artist cannot retroactively fix the payment method. The DB has `update` capability via RLS for the artist, but no UI surface for it.

**Manual fallback needed:** Staff must maintain a paper log of all QR transfers — amount, approximate time, queue number. Cross-reference with bank statement at end of day. This is the same workflow artists used before the system existed. The system does not reduce this burden.

---

## Customer Confusion Peak: 13:30–15:00

**Queue is at 60+ customers. Mix of served, waiting, missed, expired tickets.**

**Situation 1 — Customer loses ticket:**
Customer #52 is waiting. Their phone battery dies at 13:40. They borrow a friend's phone, open `/:slug/queue`. No ticket. The "Get Ticket" button is visible but the queue is still open. If they tap it, they join as a new customer at the back of the queue (ticket #68 or wherever the count is). They have no way to recover ticket #52.

What happens to ticket #52: it stays as `waiting` in the staff list. Staff will eventually call it. Nobody shows up. After 30 minutes in `calling` state, `expireStaleCallingQueues` (running every 30 seconds in ManageCombined on the staff tablet) will mark it `expired`.

**What goes right:** The orphan ticket eventually expires automatically. The queue doesn't stall forever.

**What goes wrong:** The customer re-joined at the back. They wait an extra 2 hours. There is no way for them to tell staff "I was #52, please recover my slot." Staff would have to manually find the ticket in the "Missed" section and use the "Recall" button — but there's nothing linking their identity to that ticket number. The customer would need to remember their queue number (or have it in a screenshot).

**Situation 2 — Customer on incognito browser:**
Customer #57 opened `/:slug` in a private browsing window on Safari because they habitually browse privately. They joined the queue. Ticket stored in sessionStorage (Safari private mode behavior). They close the tab to check the artist's Instagram, then re-open — the ticket is gone. They rejoin as #71.

The app has no detection of private browsing and shows no warning before the customer joins.

**Situation 3 — Customer sitting in front of the wrong "Now Serving" number:**
Customer #41 is waiting. The "Now Serving" display shows #38 (the current serving customer). Customer #41 interprets "serving" as "just called" — they walk up to the booth. Actually "serving" means the customer is actively at the booth transacting. Customer #41 has to be told to go back and wait.

The terminology in the queue status system: `waiting` → `calling` → `serving` → `complete`. From the customer's perspective, "Now Serving #38" combined with ticket #41 naturally prompts "I'm almost up" behavior. The ETA display helps ("3 people ahead") but the Now Serving number alone is misleading.

**Situation 4 — Multi-event artist with two events today:**
This booth is running at a 2-day event. The artist has Event A (10:00–18:00 Day 1) and Event B (10:00–18:00 Day 2) both in `Confirmed` status. The customer page `CustomerLayout` shows a dropdown at the top to select the event. Many customers don't notice the dropdown and are looking at the wrong event's queue. They get a ticket for Day 2's event while being physically at the Day 1 booth.

`selectedEvent` defaults to `availableEvents[0]` if no stored preference. The first available event in the sorted list is the earliest `start_date`. For a two-day event, Day 1 is first — correct. But if the customer has localStorage from a previous visit that stored Day 2's ID, they auto-switch to Day 2.

**Situation 5 — "Calling" state with customer not looking at phone:**
Staff B calls ticket #55. Customer #55 is in the merchandise area 15 meters away, phone in pocket. `CallingNotification` fires the vibration: `navigator.vibrate([200, 100, 200])` — but only if the browser tab is active and the browser has vibration permission. On iOS Safari, `navigator.vibrate` is not supported (returns undefined). No vibration. No notification. No audio.

Customer #55 doesn't respond. After 30 minutes: `expired`. They come back to the queue page, see "Expired," and are confused — they didn't leave, they were just browsing the venue.

---

## Staff Overload: 14:00–16:00

**Peak period. Owner is doing cheki sessions. Two staff are managing queue and POS alone.**

**Staff B's overload:**

Staff B (queue_staff on iPad) manages the calling flow. At peak, new customers are joining every 30–60 seconds. The waiting list in QueuePanel shows 25 people. Staff B is:
- Watching for customers to arrive after being called
- Tapping "ARRIVED" when they physically show up
- Tapping "Call Next" for each successive customer
- Answering customer questions verbally ("when is my turn?", "is cheki sold out?")
- Watching for missed tickets to "Recall" if the customer comes back

The QueuePanel waiting list has a `max-h-[200px] overflow-y-auto` constraint. With 25 waiting customers, only about 6–8 are visible without scrolling. Staff B cannot see the full queue at a glance on a standard iPad screen. The queue numbers are visible, but there's no customer name — just a number and elapsed time.

**What goes wrong — "Call Next" race condition:**
At 14:23, both the owner (who stepped away from the cheki session for a moment and checked their phone) and Staff B tap "Call Next" within 500ms of each other.

`handleCallNext` in QueuePanel:
```
const waitingList = queues.filter(q => q.status === 'waiting').sort(...)
const next = waitingList[0]   // both see ticket #61 as next
updateStatus(next.id, 'calling')
```

Both calls hit Supabase simultaneously. Both execute `UPDATE queues SET status='calling' WHERE id = #61_uuid`. Postgres processes them serially (row-level lock on the single row). Both updates succeed — the second one is a no-op write of the same values. Ticket #61 ends up in `calling` state exactly once.

**What goes right:** No duplicate calling. The row lock prevents any real corruption.

**What goes wrong:** Staff B and the owner both think they called the next customer. The owner returns to the cheki station. Staff B is watching for the customer. No actual harm, just momentary confusion.

**Staff A's overload (POS on phone):**

Staff A is processing payments one at a time. Each cycle:
1. Confirm customer arrival → select queue in POS header
2. Scroll through product grid on phone screen (small cards)
3. Add items to cart
4. Tap bottom bar to open mobile cart sheet
5. Review total
6. Tap "Charge"
7. Choose Cash or Transfer
8. Wait for 3 RPCs to complete (typically 800ms–2s on good WiFi, 3–8s on venue WiFi)
9. Cart clears → next customer

Under stress, Step 8 is where mistakes happen. The loading state shows "Processing..." Staff A, worried the payment failed, taps "Charge" again while loading is still `true`. The button is disabled — no double-tap. Safe.

But at 14:47, the venue WiFi drops for 12 seconds during step 8. The `fetchWithTimeout` (15-second limit in `supabaseClient.ts`) doesn't trigger. The RPCs are in-flight. Staff A waits. At 15 seconds, the timeout fires, the fetch aborts. The `resilientFetch` sees `'aborted'` and silently **retries** the POST request.

If the first RPC (`sync_customer_order_items_with_stock`) committed before the abort, the retry creates a new attempt on the same order. The order is now in `confirmed` status from the first commit. The retry tries to call `sync_customer_order_items_with_stock` again — this function checks `if v_order.status not in ('draft', 'confirmed')` — it's `confirmed`, so it continues. It releases all previous reservations and re-reserves. Two calls to this RPC in quick succession against the same order means the stock accounting runs twice: reserve → re-reserve. Net effect depends on timing.

Staff A sees "Payment failed" after the full timeout. They re-select the cart manually and try again. Now the payment succeeds on the third attempt. But the order from the first commit (if `complete_order_with_stock` partially succeeded) may be in a zombie state.

---

## Data Consistency Breaks: Throughout the Day

**Scenario A — Orphaned confirmed order from interrupted payment:**

At 15:12, Staff A is mid-payment for ticket #78. Between `create_customer_order_with_stock` (succeeds, stock_reserved += 2 for 2 keychains) and `complete_order_with_stock`, the iPad's screen times out and Staff A taps it to wake it. The payment response is pending. Staff A, not seeing the "Processing..." screen (screen was dark), assumes nothing happened. They clear the queue selection and serve the next customer.

Order for ticket #78 is now stuck in `confirmed` status with `stock_reserved = 2`. The 2 keychains are effectively invisible — they appear reserved but will never be sold. The end-of-day stock count will show 2 units "reserved" with no corresponding sale.

The system has no automated cleanup for this. The orphan stays in the DB indefinitely.

**Scenario B — Walk-in double order from retry:**

At 15:45, a customer shows up without a queue ticket and wants to buy merchandise directly. Staff A selects "Walk-in" in the POS header (the "Walk-in" button with `User` icon). Adds 3 items to cart. Taps "Charge Transfer." `create_walkin_order_with_stock` fires — immediately creates a `completed` order with `payment_method='transfer'` and deducts stock. Network hiccup: Staff A doesn't see the success toast clearly (notification was brief). They tap "Charge Transfer" again.

Second call: `create_walkin_order_with_stock` creates a **second** `completed` order. Two orders, same items, same payment method. Stock deducted twice. The system has no deduplication for walk-in orders — each call is treated as a fresh transaction.

The customer paid once. The system records two sales. Stock is under-reported by one set of items. End-of-day: cash/transfer count doesn't match the order total.

**Scenario C — Stock arithmetic with concurrent staff:**

Both Staff A and the owner are processing POS simultaneously (owner returned from cheki station). Product "Acrylic Keychain Furina" has 3 units remaining.

Staff A adds 2 to their cart (ticket #80). Owner adds 2 to their cart (walk-in customer).

Staff A charges first: `sync_customer_order_items_with_stock` → `stock_reserved += 2`. Available: `total - reserved - sold = 3 - 2 - X`.
Owner charges half a second later: `sync_customer_order_items_with_stock` → DB checks `available = 3 - 2 - X`. If only 1 is now available: `raise exception 'insufficient_stock'`.

Owner's payment fails. Error: "Payment failed: insufficient_stock." Owner looks at the product browser — it still shows the item (because the realtime product update hasn't arrived yet or the cart hasn't been validated against it). They try again. Still fails. They have to manually remove the item from the cart.

**What goes right:** No actual oversell. The DB-level lock prevented it.
**What goes wrong:** The UX is a dead end. "Payment failed: insufficient_stock" gives no guidance. The owner doesn't know which item caused it.

---

## Evening Slowdown: 16:00–17:30

**Queue thins out. Tickets #85–#110 are processed.**

**What goes right — ETA improves:** By 16:00, there are 40+ completed tickets with `served_at` and `completed_at` timestamps. `estimate_queue_eta` now uses real data: `percentile_cont(0.5)` of actual service times. If cheki sessions averaged 8 minutes and merch sessions averaged 2 minutes, the median lands around 4 minutes. ETA for remaining customers is now realistic.

**What goes wrong — expired tickets clogging the staff view:**
Over the day, approximately 8–10 customers never responded to their "Calling" status (missed calls, borrowed phones, browsed away). These were marked `expired` by `expireStaleCallingQueues`. They appear in the QueuePanel's "Missed" section. Staff B has been dismissing them by scrolling past, but the section grows throughout the day. There's no "bulk clear expired tickets" button.

The "Recall" button on each expired ticket allows re-setting status to `waiting`. Staff B accidentally taps "Recall" on ticket #47 (long expired, customer definitely gone). Ticket #47 is now `waiting` again at the bottom of the list. Staff will eventually call it. Nobody shows up. It expires again 30 minutes later.

**What goes wrong — queue expiry stops at 17:00:**
Owner closes the laptop to help pack merchandise. The `expireStaleCallingQueues` interval was running in ManageCombined on the laptop tab. Browser tab closed → interval stopped. Staff B's iPad is still showing the queue panel, but Staff B doesn't have ManageCombined loaded (they navigate directly to `/manage-pos-queues` but the iPad tab was refreshed at some point and is showing a loading state).

Any new `calling` ticket issued after 17:00 will not auto-expire. If ticket #108 gets called at 17:15 and nobody shows, it stays as `calling` forever (unless manually marked missed or until a device with ManageCombined open reconnects and the interval fires).

---

## End of Event: 18:00

**Owner changes event status to "Ended."**

Actually: there is no "Ended" status button in the UI. The `events.status` field supports `Confirmed` and `Cancelled` (from `snippets/Add Ended Event status.sql`, this was a snippet, not a full migration — unclear if it was applied). The owner toggles the booth closed via the QueuePanel toggle. Customers immediately see "Booth Closed" on their queue pages.

The `end_date` of the event has passed (18:00). `create_queue_ticket` will now raise `'event_not_in_window'` for any new join attempts — the time check `v_event.start_date > now() or v_event.end_date < now()` blocks new tickets. The queue is functionally closed.

**What goes right:** Customers who try to join after 18:00 cannot get a ticket. The system correctly blocks this.

**What goes wrong:** Customers with active tickets (status `waiting` or `calling`) at 18:00 see no automated message that the event has ended. Their queue page shows their ticket as `waiting` with an ETA. They don't know they won't be served. They might wait at the booth in confusion.

There is no "event ended" broadcast. The owner must manually set a broadcast message ("Queue closed — event ended. Thank you!") via the QueuePanel preset buttons — but none of the 3 presets say this. Owner needs to navigate to `/manage-events` to set a custom broadcast message. By this time, the team is packing up and this step is likely forgotten.

---

## Highest-Risk Operational Moments

Ranked by combination of likelihood and impact:

**1. First 10 minutes after booth opens (10:00–10:10)**
40+ customers tap "Get Ticket" simultaneously. `resilientFetch` retries can create ghost tickets. The ETA is wildly wrong from the start. Staff haven't confirmed their device setup is working. The booth-close toggle has no role guard — Staff B could accidentally close the booth. All of this happens in the most chaotic moment of the day.

**2. Each QR transfer payment (throughout the day)**
Every transfer payment has no verification step. Wrong method recorded, wrong amount assumed, no slip captured. At 30% transfer rate × 100 customers = 30 payment records that may be wrong.

**3. Any WiFi drop during an active payment (throughout the day)**
The 3-RPC payment chain is not atomic from a network perspective. A drop between RPCs 1 and 3 creates a confirmed order with reserved stock and no completed payment. The `resilientFetch` retry on `'aborted'` may re-execute a mutation that already committed.

**4. A cheki product selling out while a customer is at the POS (mid-day)**
Customer is at the booth. Staff has the item in the cart. The item sells out due to another transaction. Staff taps Charge → "Payment failed: insufficient_stock." No explanation. Customer is standing there. Staff has to troubleshoot under pressure.

**5. Any customer who navigates away from the queue page before being called (all day)**
The `CallingNotification` banner doesn't appear for tickets obtained in the current session. Every customer who browses the menu after joining the queue — most of them — is deaf to the calling notification. They will miss their turn, expire after 30 minutes, and be upset.

---

## Summary: What the System Does Well Today

| Behavior | How |
|---|---|
| No duplicate queue numbers under any load | `FOR UPDATE` lock on event row + unique index on `(event_id, queue_service_date, queue_number)` |
| Real-time booth status propagation | Supabase Realtime on `events` table, booth open/close reaches customers in < 1 second |
| Stock never goes negative | `FOR UPDATE` on product row in all order RPCs + availability check before reservation |
| Queue number resets per day | `queue_service_date` computed per event timezone, unique index scoped per date |
| Staff roles correctly restrict POS access | `has_artist_role` in RPCs + `canUsePos` check in PosPanel renders correctly |
| Payment cannot be accidentally retried for queue-linked orders | `order_not_editable` exception on `sync` if order is already `completed` |

## Summary: What Breaks in Practice

| Failure | Root Cause |
|---|---|
| Ghost tickets from network retries | `resilientFetch` retries POST mutations |
| CallingNotification silent for current-session joins | `[artistId]` effect doesn't re-run when localStorage is written |
| Walk-in payment double-recorded | No deduplication on `create_walkin_order_with_stock` |
| Wrong payment method recorded | No confirmation step or verification for Transfer |
| Orphaned confirmed orders reserving stock | No atomic payment chain; 3 separate RPCs can partially fail |
| Staff queue list stale after network drop | No REST polling fallback in ManageCombined |
| ETA misleads customers for first 2 hours | Cold-start 75s default vs actual 5–8 min cheki sessions |
| Sold-out broadcast impossible from POS screen | No free-text broadcast field in QueuePanel; presets only |
| Queue expiry stops if staff tab is closed | Client-side interval only, no server-side expiry |
| Any staff can accidentally close the booth | No role check on QueuePanel's booth toggle |
