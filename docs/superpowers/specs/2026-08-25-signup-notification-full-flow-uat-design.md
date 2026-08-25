# Signup Idempotency, Notification Delivery, and Full-Flow UAT Design

**Date:** 2026-08-25
**Status:** Approved design direction
**Environment:** Local Supabase and local web app only; no remote migration or deployment

## 1. Goal

Fix the two failures found during the local real-user flow, then verify the complete Nireq lifecycle through real browser interactions:

- creator signup must create one active application and one workspace even when completion requests race;
- pre-order notification requests must accept valid UUID order IDs and deliver through local Mailpit;
- catalog stock and per-event stock must remain correct through pre-order, event-day sales, pickup, rejection/cancellation, and post-order shipment;
- owner, manager, seller, and queue staff must be able to perform only their intended actions and see only their assigned operational events.

## 2. Confirmed Failure Evidence

### 2.1 Duplicate creator applications

A local creator login produced two concurrent successful requests to `complete_verified_creator_signup`. The requests originate from independent session-routing paths in `App.tsx` and `ManageLogin.tsx`. Both database calls passed the initial artist-existence check before either transaction completed, so two `auto_approved` application rows were inserted with the same auth user and timestamp.

The workspace itself remained singular because the application trigger upserts the artist by auth user ID. The application table has no equivalent active-application uniqueness rule.

### 2.2 Notification request rejected before delivery

`notify-preorder-payment` returned HTTP 400 for every real order notification. Its UUID validator accepts `8-4-4-12`, while a standard UUID is `8-4-4-4-12`. Valid order IDs are therefore rejected before order lookup or Mailpit delivery.

These two explanations account for every breadcrumb from the first run: two HTTP 200 completion RPCs, two application rows, no duplicate artist, a notification HTTP 400, and no Mailpit message or provider error log.

## 3. Data and Function Design

### 3.1 Active application invariant

Add an append-only migration that establishes one active creator application per non-null `auth_user_id`.

Active means `pending`, `auto_approved`, or `approved`. A rejected application remains historical and does not prevent a later valid application.

Before creating the partial unique index, preserve the earliest active application for each duplicated auth user and mark later duplicates as rejected. The migration keeps the audit rows, records a deterministic duplicate-cleanup review note, and does not delete applications.

The unique index is the final integrity boundary. It protects every current and future caller, including multiple tabs, devices, direct authenticated inserts, and later frontend changes.

### 3.2 Idempotent completion RPC

Replace `complete_verified_creator_signup()` in the same append-only migration.

The function keeps its existing validation and authorization behavior. Its insert handles the active-application conflict as an idempotent outcome:

- the winning call returns `created`;
- a concurrent or repeated call returns `exists` after confirming the artist/application belongs to the authenticated user;
- conflicts belonging to another user or another slug remain errors;
- user metadata remains onboarding input only and is not used as authorization state.

The frontend may still issue two harmless completion requests. Removing one session-routing path is not required for correctness and is outside this targeted fix.

### 3.3 Notification UUID validation

Correct the validator in `notify-preorder-payment` to accept canonical UUIDs with five groups: `8-4-4-4-12`.

All existing authorization remains unchanged:

- customer submission is authorized by order ID plus pickup code;
- confirmed and rejected events require an authenticated owner, manager, or seller with access to the event;
- notification delivery remains separate from money, stock, and fulfillment mutations;
- retries reuse the notification-delivery ledger and never repeat a business mutation.

No email-provider abstraction or unrelated Edge Function refactor will be added.

## 4. Durable Regression Checks

### 4.1 Database regression

Add pgTAP coverage that proves:

- the active-application unique index exists;
- a user cannot hold two active creator applications;
- rejected history does not block one later active application;
- repeated completion leaves exactly one active application, artist, and owner membership;
- anonymous callers cannot execute the completion RPC.

### 4.2 Notification regression

Add the smallest runnable Edge Function check that sends a canonical UUID and proves the request advances beyond UUID validation. A nonexistent but valid UUID must return `Order not found`, not `order_id must be a valid UUID`. A malformed value must still return HTTP 400.

The real browser UAT must additionally prove successful local delivery for submitted, confirmed/rejected, invitation, and post-order notification events by reading Mailpit.

## 5. UAT Dataset and Lifecycle

The run creates one isolated local creator, four authenticated role accounts, finite and unlimited products, and three events.

### 5.1 Catalog and stock

- Create one finite-stock product and one unlimited product through the creator UI.
- Assign both products to each event through Event Catalog.
- Set distinct finite stock per event rather than relying only on global catalog stock.
- Verify available, reserved, sold, and released quantities directly in the database after each risk-bearing action.
- Verify an unavailable or out-of-stock quantity is blocked through the customer/POS UI.

### 5.2 Future event: pre-order

- Enable a currently open pre-order window, pickup instructions, and direct-payment instructions.
- Customer creates an order and confirms stock moves from available to reserved.
- Exercise cancellation before payment and verify the reservation is released.
- Exercise slip submission followed by rejection and verify stock release plus customer-visible reason.
- Create the final order, submit evidence, confirm payment, fulfill pickup, and verify reserved stock becomes sold stock.
- Verify the customer order page progresses through placed, under review, confirmed, and picked up.

### 5.3 Current event: event-day operations

- Open the booth and queue.
- Customer joins, staff sees the ticket through Realtime, calls the next number, marks arrival, and completes a queue-linked POS order.
- Complete a separate walk-in POS sale.
- Verify finite event stock decrements, unlimited stock remains unlimited, completed queue/order states are linked correctly, and overselling is blocked.

### 5.4 Past event: post-order

- Enable a currently open post-order window with shipping requirements and payment instructions.
- Customer supplies the required name, email, phone, and shipping address.
- Customer submits payment evidence; authorized staff confirms payment.
- Seller records carrier and tracking, marks shipment, and the customer sees the shipped state and tracking details.
- Verify reserved stock becomes sold stock only through the intended fulfillment transition.

## 6. Role and Event-Assignment Matrix

Every role receives at least one positive and one negative browser check. Seller and queue staff are assigned only to selected events; attempts to access an unassigned event must be denied server-side as well as hidden or redirected in the UI.

| Role | Must succeed | Must be denied |
|---|---|---|
| Owner | Profile, catalog, stock, events, team, payment review, queue, POS, pickup, shipping | Access to another creator's workspace or data |
| Manager | Event/profile/catalog management, dashboard/history, payment review, queue, POS, pickup/shipping | Owner-only team management and another creator's data |
| Seller | Assigned-event queue control, POS, payment review, pickup, and shipping | Team, profile/catalog/event management, and unassigned events |
| Queue staff | Assigned-event queue control and marking an eligible order picked up | POS charging, payment review, preorder cancellation/expiry, management pages, team, and unassigned events |

Negative checks must confirm both route behavior and database/RPC enforcement. A redirect alone is not sufficient evidence for authorization.

## 7. Notification Evidence

Mailpit must contain the expected local messages for the flows that trigger them:

- team invitation;
- payment evidence submitted;
- payment confirmed;
- payment rejected;
- post-order evidence submitted and payment confirmed/rejected; shipment itself is verified on the customer order page because the existing function has no shipped-email event.

Message recipients, subjects, and order/event identifiers are verified without exposing production credentials. Production Resend configuration is not exercised or changed.

## 8. Verification and Cleanup

Verification order:

1. reproduce each original failure with a deterministic check;
2. apply the migration locally and run the narrow database/Edge checks;
3. run SQL/RLS/security regressions relevant to auth, roles, stock, money, and Storage;
4. run `npm run verify`;
5. execute the complete browser UAT and capture screenshots/traces under `output/playwright/`;
6. inspect final database and Storage state using exact IDs;
7. review the diff with fresh context, fix confirmed findings, and run `npm run verify` again;
8. remove only the isolated UAT users, applications, memberships, events, products, queues, orders, evidence, notification rows, and Storage objects; verify every exact target is zero.

No remote migration, production data mutation, deployment, or production email delivery is authorized by this work.

## 9. Non-Goals

- Refactoring the global auth/session architecture solely to remove a harmless duplicate request.
- Automatic bank-transfer verification.
- Replacing the existing role model, stock model, route structure, or notification ledger.
- Adding a new email service abstraction or dependency.
- Testing every cosmetic UI variation; the UAT targets distinct business-state and authorization branches.
