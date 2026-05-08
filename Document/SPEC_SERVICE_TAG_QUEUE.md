# Specification: Global Queue Number + Service Tags + Fair Scheduling

Date: 2026-05-07
Status: Design / Pre-implementation
Scope: Additive change to existing queue system. Backward compatible. No existing behavior removed.

---

## 0. Guiding Constraints

Before anything else, three non-negotiable rules this design must uphold:

1. **The global sequential queue number is the single source of truth for arrival order.** Tags are metadata on the ticket, not a separate sequence.
2. **No automatic reordering.** The system never silently moves a customer ahead of someone who arrived first in the same service lane. Only humans (staff or customers themselves) trigger reordering.
3. **No existing event breaks.** Events without service tags configured behave exactly as today.

---

## 1. Product Behavior

### 1.1 Core Model

A ticket has one **service tag**: a label describing what the customer needs. Tags are defined per-event by the booth owner. A typical two-tag event might have:

- `cheki` — Cheki / Photo session (long service time, requires photo station)
- `merch` — Merchandise only (short service time, any staff can serve)

The global queue number is still assigned atomically and sequentially from 1 per event per day. Ticket #7 always arrived before ticket #8, regardless of tag.

### 1.2 Two Operating Modes

The booth owner sets a **queue mode** per event:

**Standard mode (default, current behavior):**
The "Call Next" button calls the lowest-numbered waiting ticket regardless of tag. Tags are visible information only. No routing. Fully backward compatible.

**Lane mode:**
Two (or more) service stations operate in parallel. Each station calls the next ticket for its own service tag. The photo station calls next `cheki`. The merch desk calls next `merch`. Both can operate simultaneously. A customer tagged `cheki` does not block merch customers, and vice versa.

### 1.3 Fairness Contract

**Within a tag:** Strict first-arrival order is always preserved. The lowest queue number in a tag is always called first within that tag. This is absolute.

**Across tags:** A merch customer may be served before a cheki customer with a lower queue number, IF the cheki customer is waiting for the photo station while the merch desk is free. This is intentional — it is the purpose of lane mode. The cheki customer's experience is not degraded; they wait for the photo station, not for the merch desk.

**Anti-starvation guarantee:** The system enforces that no cheki ticket is passed over by more than N completions of other-tag tickets without staff notification. N is configurable per event (`starvation_threshold`, default 5). When the threshold is crossed, staff receive a visual alert. Humans decide how to respond — the system does not automatically reorder.

### 1.4 Customer Tag Choice

Customers select a service tag when they get their ticket. The selection is presented as plain-language options with descriptions:

- **"Cheki / Photo Session"** — I want a photo with the artist. (Includes purchasing merch if wanted.)
- **"Merchandise Only"** — I want to buy goods only, no photo session.

Customers can change their tag while their ticket is in `waiting` status. Once the ticket becomes `calling`, the tag is locked.

A customer who selected `merch` and changes their mind to `cheki` is re-tagged as `cheki`. Their queue number does not change — they retain their arrival position. However, they must now wait for the photo station, which may mean a longer wait than their original merch-lane wait. A clear warning is shown: "Changing to Cheki means a longer wait. Your queue number stays the same."

### 1.5 Single-Tag Events

Events can have only one service tag defined. In this case, the tag selection step is skipped on the customer side and all tickets share that tag. Behavior is identical to current standard mode.

### 1.6 Mixed-Service Tickets

A customer who wants both merch AND cheki gets a single ticket tagged `cheki`. The POS handles both in one transaction. There is no split-ticket concept. The rule: if cheki is desired, the ticket is always `cheki`. Merch is purchased as part of the same session.

### 1.7 Manual Override

Staff can call any specific ticket number from the waiting list, regardless of tag or order. This is always available. A confirmation step ("Call ticket #12 out of order?") is shown before the call is issued.

### 1.8 Booth-Level vs Tag-Level Call Next

The "Call Next" button in standard mode calls the global next waiting ticket.
In lane mode, two "Call Next" buttons appear: one per active service tag. Each calls the next waiting ticket for its tag. A single "Call Next (Any)" button remains for standard/override use.

---

## 2. Edge Cases

### 2.1 Customer doesn't know what they want yet

**Situation:** Customer joins queue before seeing the full product catalog. They don't know if they want cheki.

**Handling:** Add a third tag option: `"Decide at booth"` (internal: `any`). Staff handle `any`-tagged customers as if they were `merch` for scheduling purposes (faster lane), but confirm the actual service at arrival. If cheki is wanted, they continue at the photo station. Stock is not pre-reserved at ticket join time.

**Risk:** This dilutes the routing value of tags. Limit `any` to events that explicitly enable it.

### 2.2 Customer changes tag from merch → cheki after many merch tickets have been served

**Situation:** Customer #10 was tagged `merch`. By the time they would be called at the merch desk, they change to `cheki`. Meanwhile, customers #11–#15 (all cheki) have been waiting for the photo station.

**Handling:** The tag change is allowed. The ticket retains queue number #10. For cheki lane ordering, #10 is now ahead of #11–#15 even though they originally chose merch. This is correct — they arrived first.

**Caveat:** A customer cannot change tag to cheki if cheki stock is at 0. The system blocks the change and shows the sold-out message.

### 2.3 Photo station breaks mid-event (only one staff member)

**Situation:** The owner is doing all cheki sessions. They feel unwell and must stop cheki. All `cheki` tickets in the queue are now unserviceable.

**Handling:** Owner broadcasts a message. Then changes queue mode from lane → standard. All tickets are now served in strict number order. Staff manually works through all waiting tickets, collecting merch payments and apologizing for cheki. No automatic cancellation of cheki tickets. The owner may manually set cheki stock to 0 via `/manage-products`, which prevents new cheki ticket joins.

**Outstanding question this spec cannot answer:** Should the system offer a bulk-notify to all `cheki` waiting customers? This requires push notification infrastructure not yet built.

### 2.4 Last cheki stock unit sells out while cheki customers are still in queue

**Situation:** Cheki stock = 0. Multiple `cheki` tickets are still in `waiting` status.

**Handling:** Staff continue calling these tickets. When the customer arrives and discovers cheki is unavailable, staff can:
- Offer to convert to merch purchase only (update cart, same queue transaction)
- Mark as missed if customer leaves

The system does not auto-cancel `cheki` tickets when cheki stock reaches 0. That decision requires a human. The sold-out state is visible on the customer menu page.

**A broadcast message should be issued manually:** "Cheki sold out. Customers with cheki tickets, please come to the booth to discuss alternatives."

### 2.5 Tag field is null (backward compatibility)

**Situation:** Events that were created before this feature have tickets with `service_tag IS NULL`.

**Handling:** NULL tags are treated as `any` in all scheduling logic. They are never filtered out by tag-based call-next. They appear in standard mode as before.

### 2.6 Single staff member running both lanes alone

**Situation:** Event is in lane mode. Only one staff member is present. They must handle both cheki and merch.

**Handling:** A single staff member can use either lane's "Call Next" button at their discretion. They switch between lanes naturally. The anti-starvation alert becomes more important in this case. No system change needed.

### 2.7 Concurrent tag change by customer and call by staff

**Situation:** Staff presses "Call Next (merch)" for ticket #8. Simultaneously, customer #8 taps "Change to cheki."

**Handling:** The `update_ticket_service_tag` RPC must check that `status = 'waiting'` with a `FOR UPDATE` lock on the ticket row. If `call_next_ticket` acquires the lock first and sets status to `calling`, the tag change RPC sees `status = 'calling'` and raises an error: "Your ticket is being called. Tag cannot be changed." The customer sees a clear error. The ticket is called as its original tag (merch). No inconsistency.

### 2.8 Event defines only `cheki` tag, no `merch`

**Situation:** Owner creates an event with only one service tag. Every customer gets a cheki ticket.

**Handling:** Tag selection UI is skipped on the customer side. All tickets have `service_tag = 'cheki'`. Lane mode degenerates to standard mode (one lane). The "Call Next (cheki)" button is the only call button. Behavior is identical to today.

### 2.9 Anti-starvation threshold triggers, staff ignores it

**Situation:** Alert fires for ticket #3 (cheki, waiting). Staff continues serving merch because merch is fast and the photo station needs costume setup.

**Handling:** The alert is informational only. Staff can dismiss it or leave it. If 5 more merch tickets complete, the alert counter resets (or escalates to a stronger visual). There is no automatic action. Staff sovereignty is preserved.

### 2.10 Queue number #1 is a walk-in (no ticket)

**Situation:** Walk-in customers bypassing the queue system entirely. They appear in `orders` with `queue_id IS NULL` and no ticket.

**Handling:** Walk-in orders have no service tag (since they have no queue ticket). For stock purposes, they deduct from the same pool as tagged tickets. No change to the walk-in flow. Tags exist on `queues`, not on `orders`.

---

## 3. Suggested Schema Changes

### 3.1 `queues` table

```sql
ALTER TABLE public.queues
  ADD COLUMN service_tag text,
  ADD COLUMN tag_changed_at timestamptz,
  ADD CONSTRAINT queues_service_tag_format_chk
    CHECK (service_tag IS NULL OR service_tag ~ '^[a-z0-9_]{1,32}$');
```

`service_tag`: Lowercase alphanumeric + underscore. Max 32 chars. Null is valid (backward compatible). Validated against event's `service_tags` definition at ticket creation time (in the RPC, not DB level — event tags change over time).

`tag_changed_at`: Timestamp of the last customer-initiated tag change. Used to detect rapid tag-switching (abuse prevention) and to audit tag change history.

**Index additions:**

```sql
-- Fast "call next by tag" query
CREATE INDEX idx_queues_event_date_tag_status_number
  ON public.queues (event_id, queue_service_date, service_tag, status, queue_number)
  WHERE status = 'waiting';

-- Fast starvation check
CREATE INDEX idx_queues_event_date_status_number
  ON public.queues (event_id, queue_service_date, status, queue_number);
```

### 3.2 `events` table

```sql
ALTER TABLE public.events
  ADD COLUMN service_tags jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN queue_mode text DEFAULT 'standard'
    CHECK (queue_mode IN ('standard', 'lane')),
  ADD COLUMN starvation_threshold integer DEFAULT 5
    CHECK (starvation_threshold BETWEEN 1 AND 50);
```

**`service_tags` shape:**
```json
[
  {
    "id": "cheki",
    "label": "Cheki / Photo Session",
    "label_th": "เชกิ / ถ่ายรูป",
    "description": "Includes a photo session with the artist.",
    "description_th": "รวมถ่ายรูปกับศิลปิน",
    "icon": "camera",
    "is_default": false
  },
  {
    "id": "merch",
    "label": "Merchandise Only",
    "label_th": "ซื้อสินค้าอย่างเดียว",
    "description": "Buy goods only, no photo session.",
    "description_th": "ซื้อสินค้าโดยไม่ถ่ายรูป",
    "icon": "shopping-bag",
    "is_default": true
  }
]
```

`is_default`: The tag pre-selected for the customer. Exactly one should be true. If all are false, no pre-selection (customer must actively choose).

`queue_mode`:
- `'standard'` — All tickets called in number order. Tags are display-only.
- `'lane'` — Parallel calling by tag. Anti-starvation active.

`starvation_threshold`: Number of tickets from other tags that can complete before an alert fires for a waiting ticket.

### 3.3 New `queue_starvation_log` table (optional, for analytics)

```sql
CREATE TABLE IF NOT EXISTS public.queue_starvation_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  queue_service_date date NOT NULL,
  ticket_id uuid NOT NULL REFERENCES public.queues(id),
  ticket_queue_number integer NOT NULL,
  ticket_service_tag text NOT NULL,
  tickets_served_over integer NOT NULL,
  alerted_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution text CHECK (resolution IN ('called', 'dismissed', 'auto_expired'))
);
```

This table is optional. Its purpose is post-event analytics: "how often did cheki customers get starved?" Omit for the pilot and add later.

---

## 4. Suggested RPC Changes

### 4.1 `create_queue_ticket` — add `p_service_tag` parameter

**Current signature:**
```sql
create_queue_ticket(p_artist_id uuid, p_event_id uuid)
```

**New signature:**
```sql
create_queue_ticket(p_artist_id uuid, p_event_id uuid, p_service_tag text DEFAULT NULL)
```

**Additional logic inside the function:**

After the existing event validation, add:
```
-- Validate service_tag
IF p_service_tag IS NOT NULL THEN
  -- Check that service_tag is a valid tag id in event.service_tags
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_event.service_tags)
    WHERE value->>'id' = p_service_tag
  ) THEN
    RAISE EXCEPTION 'invalid_service_tag';
  END IF;
END IF;
-- If event has service_tags and p_service_tag is null, use the default tag
-- If no default exists, allow null (standard mode)
```

The INSERT includes `service_tag` in the `VALUES` clause.

**Return type addition:** Include `service_tag text` in the return table.

**Backward compatibility:** `p_service_tag` defaults to NULL. Callers that don't pass it continue to work. Events with empty `service_tags` accept null silently.

### 4.2 New RPC: `update_ticket_service_tag`

```sql
create_or_replace function public.update_ticket_service_tag(
  p_ticket_id uuid,
  p_service_tag text
)
returns table (
  id uuid,
  queue_number integer,
  service_tag text,
  status text
)
```

**Logic:**
1. Lock the ticket row with `FOR UPDATE`
2. Verify `status = 'waiting'` — if not, raise `'ticket_not_changeable'`
3. If caller is anonymous: verify the ticket was issued with the same `queue_service_date` as today — prevents old ticket manipulation
4. If caller is authenticated staff: skip customer-side validation (staff can override tags)
5. Validate `p_service_tag` against `event.service_tags`
6. Check that `tag_changed_at` is not within the last 60 seconds — raise `'tag_changed_too_recently'` if so (rate limiting)
7. Update `service_tag`, `tag_changed_at = now()`
8. Return the updated ticket row

**Grant:** `anon, authenticated` — customers (anon) must be able to change their own tag.

**Ownership constraint for anon:** Anonymous customers are not authenticated, so we cannot verify "this customer owns this ticket." The constraint is:
- The ticket must be `waiting` (cannot game a ticket in progress)
- The ticket must be from today (cannot manipulate historical tickets)
- Rate limiting: 1 change per 60 seconds per ticket

This is an acceptable trade-off given there is no customer account system. The worst abuse case: someone changes another customer's tag from cheki to merch. This puts the victim in the faster lane — not a harmful outcome. Changing from merch to cheki when cheki is sold out is blocked by the stock check in `create_queue_ticket` context... actually `update_ticket_service_tag` doesn't reserve stock (tickets don't reserve stock — only orders do). So changing to cheki when cheki is sold out is allowed at the ticket level but blocked at payment time. The customer arrives, staff cannot process cheki, situation handled manually.

### 4.3 New RPC: `call_next_ticket`

This replaces the current direct `UPDATE queues SET status='calling'` call that happens client-side in `QueuePanel.updateStatus`.

```sql
create or replace function public.call_next_ticket(
  p_event_id uuid,
  p_service_tag text DEFAULT NULL  -- NULL = standard mode (global next)
)
returns table (
  id uuid,
  queue_number integer,
  service_tag text,
  status text,
  called_at timestamptz
)
```

**Logic:**

```
1. Verify caller has artist role (owner, manager, seller, queue_staff)
2. Verify event is active and is_booth_open = true
3. Compute v_service_date (current date in event timezone)

4. IF p_service_tag IS NULL (standard mode):
   SELECT the row with lowest queue_number
   WHERE event_id = p_event_id
     AND queue_service_date = v_service_date
     AND status = 'waiting'
   FOR UPDATE SKIP LOCKED   ← critical: non-blocking lock
   LIMIT 1

5. IF p_service_tag IS NOT NULL (lane mode):
   Same query with additional AND service_tag = p_service_tag

6. IF no row found: RAISE EXCEPTION 'no_waiting_tickets'

7. UPDATE found row: status = 'calling', called_at = now()
8. RETURN the updated row
```

**Why `FOR UPDATE SKIP LOCKED` matters here:**
If two staff members tap "Call Next (merch)" simultaneously, one acquires the lock and calls the next merch ticket. The other sees the lock, skips that row, and moves to the next lowest merch ticket. This is correct: two different merch customers get called. Without `SKIP LOCKED`, the second staff member would block until the first finishes and then call the same ticket (because `status` is now `calling`, the second would find `no_waiting_tickets`). `SKIP LOCKED` ensures concurrent calls to the same lane each get a distinct ticket.

**Grant:** `authenticated`

### 4.4 New RPC: `get_starvation_alerts`

```sql
create or replace function public.get_starvation_alerts(
  p_event_id uuid
)
returns table (
  ticket_id uuid,
  queue_number integer,
  service_tag text,
  created_at timestamptz,
  tickets_served_over integer
)
```

**Logic:**
```
v_service_date ← current date in event timezone
v_threshold ← events.starvation_threshold WHERE id = p_event_id

SELECT
  t.id,
  t.queue_number,
  t.service_tag,
  t.created_at,
  COUNT(later.id)::integer as tickets_served_over
FROM queues t
LEFT JOIN queues later ON
  later.event_id = t.event_id
  AND later.queue_service_date = t.queue_service_date
  AND later.queue_number > t.queue_number      ← joined AFTER t
  AND later.status = 'complete'
  AND later.service_tag IS DISTINCT FROM t.service_tag  ← different tag
WHERE t.event_id = p_event_id
  AND t.queue_service_date = v_service_date
  AND t.status = 'waiting'
  AND t.service_tag IS NOT NULL
GROUP BY t.id, t.queue_number, t.service_tag, t.created_at
HAVING COUNT(later.id) >= v_threshold
ORDER BY t.queue_number ASC
```

**Called:** On the staff dashboard, polled every 30 seconds OR triggered by any `queues` table realtime UPDATE event. Result is shown as a warning banner in QueuePanel when non-empty.

**Grant:** `authenticated`

### 4.5 Modified RPC: `estimate_queue_eta`

Current signature unchanged. Add `p_service_tag` parameter:

```sql
estimate_queue_eta(
  p_event_id uuid,
  p_queue_number integer,
  p_service_tag text DEFAULT NULL
)
```

**Logic change:** When `p_service_tag IS NOT NULL`:
- `people_ahead` = count of waiting tickets with `queue_number < p_queue_number` AND `service_tag = p_service_tag` (only people in the same lane matter for wait time)
- `average_service_seconds` = median of completed tickets WHERE `service_tag = p_service_tag` (tag-specific service time, not global median)
- If no tag-specific completed tickets exist, fall back to global median, then to the event-configured `default_service_seconds` (new event field: `default_service_seconds jsonb` mapping tag → seconds, e.g., `{"cheki": 480, "merch": 90}`)

The cold-start problem is solved per-tag: instead of a global 75-second default, each tag has a meaningful owner-configured default.

---

## 5. Suggested Admin UX

### 5.1 Event Setup — Service Tags Configuration

In `/manage-events` → Event creation/edit form, add a collapsible section:

**"Queue Mode & Service Types"**

```
Queue Mode:
  ○ Standard (call all customers in arrival order)
  ● Lane (separate photo and merch queues)

Service types for this event:
  ┌────────────────────────────────────────────────────┐
  │ + Add service type                                 │
  ├────────────────────────────────────────────────────┤
  │ [camera icon] Cheki / Photo Session [edit] [delete]│
  │   Tag ID: cheki                                    │
  │   Default wait (min): [8]  ← used for cold ETA    │
  │   [ ] Pre-selected for customers                   │
  ├────────────────────────────────────────────────────┤
  │ [bag icon] Merchandise Only [edit] [delete]        │
  │   Tag ID: merch                                    │
  │   Default wait (min): [2]                          │
  │   [✓] Pre-selected for customers                  │
  └────────────────────────────────────────────────────┘

Anti-starvation alert after:  [5] ▲▼  tickets of other types served
```

Validation: Tag IDs must be unique. At least one tag must be non-default if lane mode is selected. Lane mode requires at least 2 tags.

### 5.2 QueuePanel — Lane Mode Layout

**Current:** One "Call Next" button, one waiting list.

**Lane mode additions:**

```
┌──────────────────────────────────────────────────┐
│ Queue Control                                    │
│                                                  │
│ [Pause queue] [Break] [Urgent]                   │
│ BOOTH OPEN ●  ══                                 │
│ Active Event: Cosplay Fest Day 1                 │
├──────────────────────────────────────────────────┤
│ Total: 18  │  Next cheki: #4  │  Next merch: #6  │
├──────────────────────────────────────────────────┤
│ [📷 Call Next Cheki (#4)]  [🛍 Call Next Merch (#6)]│
│                                                  │
│ [Call Any Next (#4)] ← standard mode override    │
├──────────────────────────────────────────────────┤
│ ⚠️ STARVATION ALERT                              │
│ Cheki #4 has waited while 6 merch tickets        │
│ were served. Consider calling cheki next.         │
│ [Dismiss]                                        │
├──────────────────────────────────────────────────┤
│ 📷 CALLING (cheki)                               │
│ #4  ←  [ARRIVED]                                 │
│ 🛍 CALLING (merch)                               │
│ #6  ←  [ARRIVED]                                 │
├──────────────────────────────────────────────────┤
│ Waiting List                                     │
│ [All ▾] [📷 Cheki (3)] [🛍 Merch (9)] [? Any (2)]│
│                                                  │
│ #7  📷 Cheki   2:14 ago  [Call this ticket]      │
│ #8  🛍 Merch   2:31 ago  [Call this ticket]      │
│ #9  🛍 Merch   3:05 ago  [Call this ticket]      │
│ #11 📷 Cheki   3:44 ago  [Call this ticket]      │
│ ...                                              │
└──────────────────────────────────────────────────┘
```

**Key UX decisions:**
- Calling section shows one row per active calling ticket (can have cheki and merch calling simultaneously)
- Waiting list has filter tabs by tag — "All," "Cheki (3)," "Merch (9)," "Any (2)"
- Each row in waiting list has a "Call this ticket" button for manual override — shows confirmation modal before firing
- The starvation alert is a sticky orange banner above the calling section, dismissed per-session only (re-appears on reload if still above threshold)
- Queue numbers for "Next cheki" and "Next merch" shown in the stats row so staff always know what's coming without scrolling

### 5.3 POS Panel — Serving Indicator by Tag

In the serving queue row at the top of POSPanel (the customer selector):

```
[Walk-in]  [📷 Queue #4 — cheki]  [🛍 Queue #6 — merch]
```

The tag icon gives staff instant visual context for which service this customer needs before they open the cart.

### 5.4 Event Setup — Default Service Time Configuration

In the event form, below the tag list:

```
Default wait time per customer (used before enough data exists):
  📷 Cheki:  [ 8 ] minutes
  🛍 Merch:  [ 2 ] minutes
```

These are written into the `service_tags` JSONB as `default_service_seconds`. They replace the hard-coded 75-second global fallback in `estimate_queue_eta`.

### 5.5 Broadcast — Free-Text Field

Currently broadcast is preset-button only. Add a free-text input below the presets:

```
Custom message:
[                                    ] [Send]
```

This is a simple `input` field calling the existing `set_artist_queue_broadcast` RPC with the typed string. No schema change needed. The presets remain as quick-tap buttons. This resolves the "cheki sold out" broadcast problem from the event day simulation.

---

## 6. Suggested Customer UX

### 6.1 Tag Selection on Queue Join

When the customer taps "Get Ticket" and the event has `service_tags` configured with 2+ tags:

Instead of immediately issuing the ticket, show a one-step modal:

```
┌─────────────────────────────────────────┐
│  What do you need today?                │
│                                         │
│  ┌──────────────────────────────────┐   │
│  │ 📷 Cheki / Photo Session         │   │
│  │  A photo session with the artist  │   │
│  │  (longer wait, limited slots)    │   │
│  └──────────────────────────────────┘   │
│                                         │
│  ┌──────────────────────────────────┐   │
│  │ 🛍 Merchandise Only              │   │
│  │  Buy goods only, no photo        │   │
│  │  (shorter wait)                  │   │
│  └──────────────────────────────────┘   │
│                                         │
│  You can change this before being       │
│  called.                                │
└─────────────────────────────────────────┘
```

Tapping either card immediately calls `create_queue_ticket` with the selected tag. No additional confirm step.

If the event has only 1 tag, this modal is skipped and the ticket is issued with that tag automatically.

If `is_default` is set on one tag, that card is visually highlighted (colored border, "Recommended" label). The customer can still choose either.

### 6.2 Tag Display on the Ticket Card

The ticket card in `QueueView` shows the tag as a small badge:

```
┌─────────────────────────────────────┐
│  [WAITING]                          │
│                                     │
│  Booked at 10:24                    │
│                                     │
│    #12                              │
│                                     │
│  [📷 Cheki / Photo Session]         │
│                                     │
│  3 cheki customers ahead of you     │
│  Estimated wait: 24–36 min          │
│                                     │
│  [fun fact carousel]                │
└─────────────────────────────────────┘
```

The "people ahead" count shows only same-tag customers in lane mode (because that's the relevant queue for the customer). The ETA is tag-specific.

### 6.3 Tag Change UI

A "Change service type" link appears below the ticket card when `status = 'waiting'`:

```
[Change to: 🛍 Merchandise Only]
```

If there are more than 2 tags, a full picker appears. Tapping shows a warning:

```
⚠️ Changing to Merchandise Only
Your queue number stays the same (#12), but your estimated
wait will change because you'll move to the merch lane.

New estimated wait: 12–18 min (was 24–36 min)

[Keep Cheki]    [Switch to Merch]
```

After confirmation, calls `update_ticket_service_tag`. The ticket card re-renders with the new tag badge.

### 6.4 ETA Clarification — Cold Start

For the first 10 customers of the day (before enough completed tickets to compute median), show a soft disclaimer:

```
Estimated wait: 24–36 min
(based on typical session length, may vary early in the day)
```

After 5 completed tickets of a given tag, the disclaimer is removed and the estimate is based on real data.

### 6.5 Sold-Out Tag Handling

If the artist marks a cheki-linked product as sold out (or stock_total reached), the `cheki` tag option is greyed out on the join modal:

```
📷 Cheki / Photo Session   [SOLD OUT]
   (No more cheki sessions available today)
```

Technically: the sold-out check is done via the event's `event_products` for products marked with `is_cheki = true` (a future product field), OR the owner manually marks the `cheki` tag as inactive in the event configuration. For the first implementation, manual deactivation is sufficient.

Tag deactivation is a new `is_active` boolean in the tag JSONB:
```json
{"id": "cheki", "label": "...", "is_active": false}
```

Staff toggles this from the QueuePanel: a small "Disable tag" button next to each lane's "Call Next" button.

---

## 7. Suggested Tests

### 7.1 Atomic Queue Numbering Under Concurrent Tag Joins

**Scenario:** 50 concurrent `create_queue_ticket` calls — 25 with `p_service_tag='cheki'`, 25 with `p_service_tag='merch'`.

**Assert:**
- All 50 tickets have distinct queue_numbers 1–50
- No gaps in sequence
- Distribution of tags: ~25 cheki, ~25 merch
- Execution time under 3 seconds for all 50

**Why:** Verifies the `FOR UPDATE` lock on the event row still prevents duplicates when tags are mixed.

### 7.2 Call Next By Tag — SKIP LOCKED Under Concurrent Staff

**Scenario:** Two staff sessions simultaneously call `call_next_ticket(event_id, 'merch')`. The next merch tickets are #3 and #7 (others in between are cheki).

**Assert:**
- Staff session A calls #3
- Staff session B calls #7
- Neither session blocks the other
- No ticket is called twice
- Both responses return within 500ms

**Why:** Verifies `FOR UPDATE SKIP LOCKED` behavior in `call_next_ticket`.

### 7.3 Tag Change Blocked After Calling

**Scenario:** Ticket #5 is in `calling` status. Customer calls `update_ticket_service_tag` to change from `cheki` to `merch`.

**Assert:** RPC raises `'ticket_not_changeable'`. Ticket status and tag remain unchanged.

### 7.4 Tag Change Race With Call Next

**Scenario:** Staff calls `call_next_ticket(event_id, 'merch')` targeting ticket #8 (merch). Simultaneously, the owner of ticket #8 calls `update_ticket_service_tag(ticket_8_id, 'cheki')`.

**Assert:** One of the two succeeds. The other fails with a clear error. The ticket ends up in a consistent state: either `calling` with `merch`, or `waiting` with `cheki`. No state where `status = 'calling'` and `service_tag` was just changed.

**Why:** Verifies the `FOR UPDATE` lock in `update_ticket_service_tag` correctly handles concurrent mutations.

### 7.5 Starvation Alert — Correct Threshold Trigger

**Scenario:** Event with `starvation_threshold = 3`. Ticket #2 is `cheki`, waiting. Tickets #3, #4, #5 are `merch` and become `complete` in sequence.

**Assert:**
- After #3 completes: `get_starvation_alerts()` returns empty
- After #4 completes: `get_starvation_alerts()` returns empty
- After #5 completes (3rd merch ticket completed after #2): `get_starvation_alerts()` returns ticket #2 with `tickets_served_over = 3`

### 7.6 ETA Uses Tag-Specific Median

**Scenario:** Event with `service_tags = [{id:'cheki',...}, {id:'merch',...}]`. 10 cheki completions with `served_at` to `completed_at` = 8 minutes. 10 merch completions = 2 minutes. Customer #25 is cheki with 3 cheki tickets ahead.

**Assert:**
- `estimate_queue_eta(event_id, 25, 'cheki')` returns `eta_min_minutes` ≈ 19, `eta_max_minutes` ≈ 29 (3 × 8 min ± 20%)
- `estimate_queue_eta(event_id, 25, 'merch')` would return ~5 min
- The cheki customer sees ~24 min wait, not ~5 min

### 7.7 Cold Start ETA Falls Back to Owner-Configured Default

**Scenario:** New event, 0 completed tickets. `service_tags` includes `{"id": "cheki", "default_service_seconds": 480}`. Customer #10 (cheki) with 5 cheki tickets ahead.

**Assert:**
- `estimate_queue_eta` uses 480 seconds (8 min) as the base
- Returns approximately 40 min wait for 5 customers
- No division-by-zero or null return

### 7.8 Standard Mode — Tags Are Decorative Only

**Scenario:** Event with `queue_mode = 'standard'`. Mix of cheki and merch tickets waiting.

**Assert:**
- `call_next_ticket(event_id, NULL)` always returns the lowest `queue_number` regardless of tag
- Waiting list ordered by queue_number without tag grouping

### 7.9 Backward Compatibility — Null Tags Work Like Before

**Scenario:** Existing event with no `service_tags`. Customer calls `create_queue_ticket` without `p_service_tag`. All resulting tickets have `service_tag IS NULL`.

**Assert:**
- All existing functionality works without change
- `call_next_ticket(event_id, NULL)` returns the next waiting ticket (null-tag tickets are included)
- No RPC raises an error due to null tag

### 7.10 Sold-Out Tag Deactivation

**Scenario:** `cheki` tag is set `is_active: false` in `events.service_tags`. Customer attempts `create_queue_ticket(artist_id, event_id, 'cheki')`.

**Assert:** RPC raises `'service_tag_inactive'`. No ticket created. The merch tag remains joinable.

---

## 8. Failure Modes

### 8.1 Owner sets up tags but forgets to set `queue_mode = 'lane'`

**What happens:** Tags are defined. Customers can select them. But the staff dashboard shows only one "Call Next" button (standard mode). All customers are served in strict number order regardless of tag.

**Impact:** Merch customers wait as long as cheki customers. No routing benefit.

**Detection:** The QueuePanel shows only one "Call Next" button. No lane-specific buttons are visible.

**Mitigation:** Add a visible warning in QueuePanel: "Service types are configured but lane mode is not enabled. Enable lane mode in event settings to route customers by type."

### 8.2 Staff accidentally calls a cheki ticket at the merch desk

**What happens:** Merch desk taps "Call Next Cheki" instead of "Call Next Merch." A cheki customer arrives at the merch desk. No photo station is available.

**Impact:** Confusion. The customer must be redirected to the photo station. Their ticket status is `calling` — they're now in a limbo state.

**Recovery:** Staff uses "Call Any Next (override)" to call the next merch ticket for the merch desk. The cheki customer waits at the photo station. Once the photo station is ready, staff confirms their arrival there.

**No data corruption.** The ticket remains `calling` until "ARRIVED" is pressed on one of the two stations.

### 8.3 `get_starvation_alerts` query is slow with large queue

**What happens:** The starvation query joins `queues` to itself. For an event with 200+ tickets, this is a O(N×M) join where N = waiting cheki tickets and M = completed tickets. With the indexes defined in Section 3.1, this should stay under 50ms for up to 500 tickets.

**Risk:** If the index is missing or was not applied during migration, the query degrades to a full table scan.

**Mitigation:** Run `EXPLAIN ANALYZE` on the query during migration verification. If slow, the fallback is to poll less frequently (every 60s instead of 30s) or disable starvation alerts for that event.

### 8.4 Customer changes tag multiple times rapidly

**What happens:** Customer taps "change to cheki," then immediately "change back to merch," then back to cheki. Without rate limiting, each call is a DB write.

**Impact:** DB churn. Potentially confusing state if two rapid updates race.

**Mitigation:** The 60-second rate limit in `update_ticket_service_tag` (check `tag_changed_at > now() - interval '60 seconds'` and raise `'tag_changed_too_recently'`) prevents this. The UI should also disable the change button for 60 seconds after a change with a countdown.

### 8.5 Lane mode with only one active staff member

**What happens:** Lane mode is on. Owner goes to do cheki. Staff A is the only person at the merch desk. Staff A only taps "Call Next Merch." Cheki customers wait indefinitely.

**Impact:** Cheki customers starve. The anti-starvation alert fires.

**Recovery:** Starvation alert tells Staff A there are N cheki customers waiting. Staff A can call the next cheki customer and manage both (ask them to wait at the photo station, finish current merch customer, then process cheki). Or broadcast a message to customers.

**System cannot auto-resolve this.** Human decision required.

### 8.6 `call_next_ticket` RPC replaces direct client-side update — regression risk

**What happens:** Currently, `QueuePanel.handleCallNext` does a direct `supabase.from('queues').update({ status: 'calling' })`. If `call_next_ticket` RPC is not deployed before the frontend is updated, the new "Call Next" buttons will fail.

**Mitigation:** Deploy the RPC migration first, then deploy the frontend. The existing direct `update` path remains in the codebase as a fallback until the migration is confirmed stable. A feature flag (`events.queue_mode IS NOT NULL`) can gate the new RPC path.

### 8.7 Event timezone mismatch for `queue_service_date` in starvation query

**What happens:** `get_starvation_alerts` computes `v_service_date` using event timezone. If the event's `event_timezone` is null or wrong, `v_service_date` could be tomorrow in one timezone and today in another. Starvation query runs against yesterday's tickets.

**Impact:** Alert returns empty (no starvation detected) even when starvation exists, or returns yesterday's tickets as starvation candidates.

**Mitigation:** Same defensive fallback as `create_queue_ticket`: `coalesce(nullif(v_event.event_timezone, ''), 'Asia/Bangkok')`. Always set event timezone during event creation — add a required validation in the event form.

---

## 9. Migration Strategy

### 9.1 Principles

- Every schema change is additive. No existing column is modified or dropped.
- Every new column has a safe default (`NULL` or `'standard'`) so existing rows continue to work.
- Every new RPC is a `CREATE OR REPLACE` that doesn't break existing callers.
- The existing `create_queue_ticket(uuid, uuid)` continues to work — the new version adds an optional third parameter.
- Frontend changes are gated behind the new `queue_mode` field. Events with `queue_mode = 'standard'` (the default) see zero UI change.

### 9.2 Migration Order

**Step 1 — Schema (no breaking change, deploy any time):**
```
20260510_001_add_service_tag_to_queues.sql
  - ALTER TABLE queues ADD COLUMN service_tag text
  - ALTER TABLE queues ADD COLUMN tag_changed_at timestamptz
  - ADD CONSTRAINT queues_service_tag_format_chk
  - CREATE INDEX idx_queues_event_date_tag_status_number
  - CREATE INDEX idx_queues_event_date_status_number

20260510_002_add_queue_mode_to_events.sql
  - ALTER TABLE events ADD COLUMN service_tags jsonb DEFAULT '[]'
  - ALTER TABLE events ADD COLUMN queue_mode text DEFAULT 'standard'
  - ALTER TABLE events ADD COLUMN starvation_threshold integer DEFAULT 5
```

**Step 2 — RPCs (deploy after schema, before frontend):**
```
20260510_003_call_next_ticket_rpc.sql
  - CREATE OR REPLACE FUNCTION call_next_ticket(...)
  - GRANT TO authenticated

20260510_004_update_ticket_service_tag_rpc.sql
  - CREATE OR REPLACE FUNCTION update_ticket_service_tag(...)
  - GRANT TO anon, authenticated

20260510_005_get_starvation_alerts_rpc.sql
  - CREATE OR REPLACE FUNCTION get_starvation_alerts(...)
  - GRANT TO authenticated

20260510_006_update_create_queue_ticket_with_tag.sql
  - CREATE OR REPLACE FUNCTION create_queue_ticket(uuid, uuid, text DEFAULT NULL)
  - (Replaces existing function — old callers still work with 2 args)

20260510_007_update_estimate_queue_eta_with_tag.sql
  - CREATE OR REPLACE FUNCTION estimate_queue_eta(uuid, integer, text DEFAULT NULL)
```

**Step 3 — Frontend (deploy after RPCs):**

Feature is gated behind `events.queue_mode`. Until an event is explicitly set to `'lane'`, no UI changes are visible. Deploy the frontend update. No existing event is affected.

**Step 4 — Owner enables lane mode on next event:**

Owner creates a new event in `/manage-events`, configures service tags, selects "Lane" mode. Existing events remain on `'standard'`.

**Step 5 — Pilot the feature on one event:**

Run a single event with 2 tags configured. Monitor starvation alerts. Gather timing data. After 3–5 events, review `estimate_queue_eta` accuracy with tag-specific medians. Adjust `default_service_seconds` defaults if needed.

### 9.3 Rollback Plan

If the lane mode feature causes problems:
1. Set `events.queue_mode = 'standard'` for the affected event — immediate rollback to current behavior, no DB data loss
2. All existing `call_next_ticket` calls with `p_service_tag = NULL` behave identically to the previous direct update approach
3. `service_tag` columns can remain on the tables — they are nullable and do not affect any existing functionality

### 9.4 What Does NOT Need to Change

- `complete_order_with_stock` — no tag awareness needed; completes regardless of tag
- `sync_customer_order_items_with_stock` — no tag awareness needed
- `OrderHistory` page — orders are tag-agnostic
- `ManageCombined` realtime subscription — subscribes to all `queues` changes; tag is just another field in the payload
- RLS policies on `queues` — tag is just metadata; same access rules apply
- `ManageProducts` — products are not tagged by service type (cheki stock is managed normally)

---

## Summary

| Aspect | Decision |
|---|---|
| Queue number sequence | Unchanged. Global, atomic, per event per day. |
| Tag type | Text ID (`cheki`, `merch`). Defined per event in JSONB. |
| Tag selection | Customer picks at join time. Changeable while `waiting`. |
| Scheduling model | Lane mode: each station calls its tag. Standard mode: unchanged. |
| Fairness within a tag | Strict first-arrival (lowest queue_number first). Absolute. |
| Cross-tag fairness | Staff-managed. Starvation alerts prompt human action. |
| Anti-starvation | Configurable N-threshold. Alert-only. No auto-reorder. |
| Manual override | Always available. Per-ticket "Call this" button on any waiting ticket. |
| Backward compatibility | Events with no tags configured: zero behavior change. |
| Cold-start ETA | Owner-configured default seconds per tag. No more global 75s guess. |
| Rollback | Set `queue_mode = 'standard'`. Instant. No data loss. |
