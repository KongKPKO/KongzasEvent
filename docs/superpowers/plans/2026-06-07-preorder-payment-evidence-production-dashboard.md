# Pre-order Payment Evidence Production Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manual payment evidence, required contact fields, payment-gated stock reservation, seller review, and production dashboard for pre-orders.

**Architecture:** Backend state is the source of truth: pre-order creation creates an unpaid order and `order_payments`, payment evidence submission reserves stock transactionally, seller review confirms/rejects and controls pickup readiness. Frontend surfaces split into customer payment instructions/upload, seller payment review/production dashboard, and pickup payment gating.

**Tech Stack:** React, TypeScript, Vite, Supabase Postgres/RPC/RLS/Storage, pgTAP, Playwright.

---

## File Map

- Create `supabase/migrations/<timestamp>_preorder_payment_evidence.sql`: contact columns, payment tables, private storage bucket, RPC changes, grants/revokes.
- Modify `supabase/tests/preorder_pickup_mvp_test.sql`: update existing expectations from immediate reservation to payment-gated reservation.
- Create `supabase/tests/preorder_payment_evidence_test.sql`: behavior tests for contact, evidence submission, confirm/reject/expire, audit, RLS, storage guardrails.
- Modify `src/types/preorder.ts`: structured contact/payment types and RPC results.
- Modify `src/lib/preorders.ts`: new RPC wrappers and error mapping.
- Create `src/pages/creators/PreorderPayments.tsx`: seller payment review queue.
- Create `src/pages/creators/PreorderProductionDashboard.tsx`: production summary and CSV export.
- Modify `src/pages/customer/MenuView.tsx`: desktop pre-order layout, structured contact form, payment instructions/evidence state.
- Modify `src/pages/creators/PreorderPickup.tsx`: payment status badges and pickup gating.
- Modify `src/pages/creators/EventWorkspace.tsx`: module cards for payment review and production dashboard.
- Modify `src/App.tsx`: routes for payment review and production dashboard.
- Modify `src/i18n.tsx`: customer/seller copy.
- Modify `src/tests/regression/preorder-pickup.spec.ts`: update mocked preorder flow and add payment-gating checks.

## Task 1: Backend Foundation

**Files:**
- Create: `supabase/migrations/<timestamp>_preorder_payment_evidence.sql`
- Modify: `supabase/tests/preorder_pickup_mvp_test.sql`
- Create: `supabase/tests/preorder_payment_evidence_test.sql`

- [ ] Add `orders.customer_phone`, `orders.customer_social`, `orders.customer_email`.
- [ ] Create `event_payment_methods`, `order_payments`, and `payment_review_events`.
- [ ] Create private `PaymentEvidence` bucket with non-public storage policies.
- [ ] Replace `create_preorder_with_stock` behavior so order creation does not reserve stock and does not set `confirmed`/`awaiting_pickup`.
- [ ] Add `submit_preorder_payment_evidence`, `confirm_preorder_payment`, `reject_preorder_payment`, `expire_submitted_preorder_payments`.
- [ ] Update pickup/cancel/expire RPCs to require `payment_confirmed` and avoid double stock release.
- [ ] Add production summary and payment review listing RPCs.
- [ ] Explicitly revoke anon access for new contact/payment evidence columns.
- [ ] Run DB tests.

## Task 2: Client API Layer

**Files:**
- Modify: `src/types/preorder.ts`
- Modify: `src/lib/preorders.ts`

- [ ] Add structured customer contact and payment status types.
- [ ] Add wrappers for payment evidence submission, seller review, submitted expiry, payment review list, production summary, and payment methods.
- [ ] Add error mappings for contact required, payment status invalid, payment not confirmed, evidence expired, and storage failures.
- [ ] Run `npm run build`.

## Task 3: Customer Pre-order Payment UX

**Files:**
- Modify: `src/pages/customer/MenuView.tsx`
- Modify: `src/i18n.tsx`

- [ ] Add desktop two-column preorder layout.
- [ ] Split contact into phone/social/email and require at least one.
- [ ] Show payment instructions after order creation.
- [ ] Upload payment evidence to private bucket/signed path.
- [ ] Submit evidence RPC and show waiting-for-seller-confirmation state.
- [ ] Ensure mobile cart remains usable.
- [ ] Run customer regression test.

## Task 4: Seller Review and Production Dashboard

**Files:**
- Create: `src/pages/creators/PreorderPayments.tsx`
- Create: `src/pages/creators/PreorderProductionDashboard.tsx`
- Modify: `src/App.tsx`
- Modify: `src/pages/creators/EventWorkspace.tsx`

- [ ] Add payment review route.
- [ ] Add confirm/reject/expire UI with audit-safe RPC calls.
- [ ] Add production summary cards/table.
- [ ] Add product and customer/order CSV export.
- [ ] Add workspace module cards.
- [ ] Run build and regression smoke.

## Task 5: Pickup Integration

**Files:**
- Modify: `src/pages/creators/PreorderPickup.tsx`
- Modify: `src/pages/creators/EventDashboard.tsx`
- Modify: `src/pages/creators/OrderHistory.tsx`

- [ ] Load payment status with pickup orders.
- [ ] Hide unpaid/rejected orders from awaiting pickup.
- [ ] Block pickup unless payment is confirmed.
- [ ] Show payment status in dashboard/history.
- [ ] Run pickup regression.

## Task 6: Verification

**Commands:**
- `supabase test db`
- `npm run build`
- `npm run check:hygiene`
- `npx playwright test src/tests/regression/preorder-pickup.spec.ts --project=desktop-chromium`

- [ ] Fix DB failures before frontend signoff.
- [ ] Fix TypeScript/build failures.
- [ ] Fix customer and seller browser regressions.
- [ ] Manual flow: create pre-order -> upload slip -> seller confirm -> pickup.
