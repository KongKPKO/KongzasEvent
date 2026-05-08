# Repository Analysis: EventQueueSocial (KongzasEvent)

Date: 2026-05-07

---

## 1. Architecture Summary

```
Customer Browser (no login)
  /:slug/home | menu | queue
       │
       ▼
Supabase (PostgreSQL + RLS + Realtime + Storage)
       │
Staff Browser (logged in)
  /manage-pos-queues        ← QueuePanel + POSPanel (split view)
  /manage-events            ← Event CRUD
  /manage-products          ← Product CRUD + CSV import
  /manage-team              ← Member management
       │
Firebase Hosting
  React 18 + Vite + TypeScript SPA (PWA)
```

**Backend is entirely Supabase.** `FirebaseQueueService.ts` and `ServiceFactory.ts` exist as an abstraction layer but the real service in use is Supabase. Firebase is only used for hosting.

**23 Supabase migrations** from January → May 2026 show rapid feature development. Key tables: `artists`, `events`, `queues`, `products`, `orders`, `order_items`, `artist_members`, `event_products`, `artist_promotions`, `event_member_assignments`, `creator_applications`.

**Auth model:** email/password via Supabase Auth. Roles (`owner`, `manager`, `seller`, `queue_staff`) are DB-enforced via `has_artist_role()` security-definer RPCs and RLS policies. The `get_actor_context()` RPC determines the calling user's role on load.

---

## 2. Product Flow (What Actually Happens at an Event Booth)

**Customer side (mobile, no login):**
1. Scans QR → `/:slug` → sees booth home with artist info, social links, events
2. Views `/:slug/menu` → product catalog with images, prices, stock, promotions
3. Opens `/:slug/queue` → booth must be open → taps "Get Ticket"
4. `create_queue_ticket` RPC runs atomically, returns a ticket with a sequential number
5. Ticket ID is stored in `localStorage` — customer sees their number, "Now Serving" number, ETA estimate, and live status (waiting → calling → serving → complete)
6. When status becomes `calling`, customer proceeds to booth

**Staff side (tablet/iPad, logged in):**
1. Login → `/manage-pos-queues` → split view: QueuePanel (left) + POSPanel (right)
2. QueuePanel: see waiting list, tap "Call Next" → first waiting ticket becomes `calling`
3. Confirm customer arrival → status becomes `serving`, ticket appears in POS header
4. POSPanel: select ticket from header, add products to cart, apply promotions, tap "Charge"
5. Payment modal: Cash or Transfer → `complete_order_with_stock` RPC deducts stock, closes order, marks queue `complete`
6. Walk-ins supported: staff can charge without any queue ticket

**Broadcast controls:** Staff can set "Break time," "Queue closed temporarily," or "Urgent matter" — pushes instantly to customer queue pages via Supabase Realtime.

---

## 3. What Is Already Production-Promising

| Area | Why It's Solid |
|---|---|
| **Atomic queue tickets** | `create_queue_ticket` uses `FOR UPDATE` row lock — no duplicate numbers under concurrent joins |
| **4-tier role model** | DB enforced via RLS + security-definer RPCs. `queue_staff` can't charge, `seller` can't manage products |
| **Event-scoped staff assignments** | `event_member_assignments` lets owners restrict sellers to specific events |
| **Stock tracking** | `stock_total / stock_reserved / stock_sold` per product, enforced at `complete_order_with_stock` |
| **Promotion engine** | `artist_promotions` + `calculatePromotionPricing` handles buy-X-get-Y, % discounts with cart-level insight hints |
| **ETA estimation** | `estimate_queue_eta` RPC gives min/max wait and people-ahead — customers see this live |
| **Multi-day events** | `queue_service_date` field correctly resets queue context at midnight via `useMidnightTick` |
| **PWA** | Service worker + web manifest → installable, works in low-signal venues |
| **i18n** | Thai/English throughout customer-facing pages |
| **CI pipeline** | Security, resilience, E2E, performance, mobile, offline, accessibility, browser compat + k6 load tests |
| **UAT gate** | Formal UAT report with GO/NO-GO recommendation exists (dated 2026-03-29) |

---

## 4. Highest-Risk Technical Areas

**1. Customer ticket stored only in localStorage**
No server-side link between the browser session and the queue ticket. If a customer clears storage, opens incognito, or switches devices, the ticket is permanently inaccessible — they cannot re-join (booth sees them as waiting, they see "no ticket"). This is the single highest operational risk on event day.

**2. No push notification for "calling" state**
The customer must have the page open and visible to know they're being called. In a noisy event hall with a phone in a pocket, they will miss it. The current design relies purely on the customer watching the screen.

**3. Transfer payment has no verification**
When staff taps "Transfer," the order is immediately marked complete. There is no slip capture, no reference number validation, no confirmation step. Accidental taps or payment-before-confirmation errors will result in unrecoverable lost revenue.

**4. RLS policy accumulation across 23 migrations**
Early migrations created permissive policies (`USING(true)`) that were later dropped and replaced. Later migrations added hardened policies. The net result depends on migration execution order and Postgres policy precedence. A `SELECT` policy check against the live DB is needed to confirm no conflicting permissive policies remain.

**5. Cart state partially in-memory**
If the page refreshes mid-transaction, the cart is rebuilt from the `draft` order in DB — which is good. But if `fetchCurrentOrder` fails (network blip), the staff sees an empty cart and might unknowingly re-charge. The error path in `fetchCurrentOrder` silently sets loading=false without showing an error.

**6. `ServiceFactory` / `FirebaseQueueService` dead code**
These abstractions exist but are never used at runtime (Supabase is always chosen). They add cognitive load and could mislead future developers into thinking Firebase is a live fallback.

---

## 5. Highest-Risk Operational / UX Areas

**1. "Calling" notification gap** — Customer doesn't know they're being called unless phone screen is on and app is open. In a large event hall this means missed calls, wasted staff time, and queue stalls.

**2. Ticket recovery on device change** — Customer who joins queue on phone A cannot retrieve their ticket on phone B (no login, no account). This will happen at real events.

**3. Transfer payment verification gap** — Staff taps "Transfer" without verifying receipt. At a busy booth with multiple staff, split receipts and verbal confirmations create confusion and untracked revenue loss.

**4. Queue expiry is manual** — The `expired` status exists but there's no automated expiry trigger. After a long event, the waiting list could contain stale tickets from customers who left without cancelling.

**5. Event-day LAN setup** — The `dev:lan` script and runbook exist, but LAN access (staff tablets connecting to the same network) is not the default. If the venue WiFi is poor, staff dashboard latency will degrade.

**6. Orphaned draft orders** — If a payment crashes between `sync_customer_order_items_with_stock` and `complete_order_with_stock`, the order stays as `draft`. There is no reconciliation step or cleanup job.

---

## 6. What Should NOT Be Refactored Yet

| Area | Reason |
|---|---|
| `ManageCombined.tsx` + QueuePanel/POSPanel | The combined split-view dashboard is complex but working and UAT-tested. Any refactor before pilot feedback is waste. |
| `create_queue_ticket` RPC | Atomic, proven correct. Don't touch. |
| All RLS policies (post-`20260504` migration) | Just settled after 5+ rewrites. Stable. |
| `promotionPricing.ts` | Complex but tested. Has k6 soak test coverage. |
| `schemaCompat.ts` | This normalizes legacy field names from old DB records. Removing it before all old data is migrated will break real data. |
| `CustomerLayout` → outlet context pattern | The shared context (artist, events, connection state) passed to `Home`, `MenuView`, and `QueueView` via `useOutletContext` is working correctly. Refactoring before pilot will introduce regressions. |

---

## 7. Realistic Roadmap

### Before Pilot (current sprint — harden only, no new features)

| Priority | Action |
|---|---|
| **Critical** | Manual device UAT: iPhone Safari, Android Chrome, iPad Safari |
| **Critical** | Test mixed promotions with a real product catalog |
| **Critical** | Test full stock flow: customer preselect → POS edit → payment → verify stock deducted correctly |
| **Critical** | Verify `.env.production` is not committed to git |
| **High** | Add a "copy ticket link / ticket code" fallback for customers who lose localStorage |
| **High** | Test 30-minute queue expiry in real real-time conditions |
| **High** | Verify no stale permissive RLS policies remain on live DB (`SELECT * FROM pg_policies`) |
| **Medium** | Document the event-day LAN setup procedure clearly for staff briefing |
| **Medium** | Handle the silent error path in `fetchCurrentOrder` — show a toast, not a blank cart |

### After First Pilot (collect feedback first, then build)

| Feature | Why |
|---|---|
| Push notifications when `calling` | Most impactful gap — without this customers miss their turn |
| Transfer payment slip photo capture | Prevents revenue disputes |
| Automated queue expiry (Edge Function or pg_cron) | Clean up stale `waiting` tickets after N minutes |
| Ticket recovery via ticket number + booth slug | Lets customers find their ticket on a new device |
| Post-event sales report (CSV export) | Creators need this for accounting |
| Customer receipt / order summary page | Trust signal, good for social sharing |
| Draft order cleanup job | Reconcile `draft` orders that never completed |

### Long-Term (SaaS v1 — after multiple pilots)

| Feature | Why |
|---|---|
| SaaS multi-tenant billing (plans / limits) | Monetize the platform |
| Customer accounts (optional) | Ticket recovery, order history, cross-event identity |
| Full payment gateway (PromptPay QR, Stripe) | Actual verified payment, not just method logging |
| Analytics dashboard | Daily revenue, top products, queue throughput |
| Pre-order / reservation (customer picks items before arriving) | Reduces checkout time at busy booths |
| Multi-booth event directory | `DiscoveryHome` is already scaffolded — complete it |
| Mobile app (React Native or PWA push) | Permanently solve the notification gap |

---

## Summary Verdict

The core loop — **customer joins queue → staff calls → POS checkout → stock deducted** — is architecturally sound and handles concurrency correctly. The role model is well-designed and DB-enforced. The CI pipeline is ambitious and shows engineering seriousness.

The two blocking gaps before a real pilot are: **(1) no customer notification when called** and **(2) no ticket recovery if localStorage is lost**. Everything else is manageable with staff SOPs. The manual UAT on real devices is the most important thing to do right now — not new features.
