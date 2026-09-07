# Platform Admin Support — Read-only V1

## Scope and approval

The user approved implementing the first of three admin improvements: store/order
lookup and read-only support, including access logging. System repair/retries,
suspension controls and admin membership management belong to later phases.
This document makes the data-access boundary explicit before implementation.
No deployment or remote migration is included in this task.

## Approach

Add one dedicated `/admin/support` page and narrowly scoped admin RPCs. Reuse
existing auth, language toggle, feedback components, currency/date utilities and
order records. Do not embed merchant workspaces or impersonate store owners.

Alternatives considered:
- Reusing merchant workspaces exposes irrelevant mutation actions and couples
  support to merchant role checks; reject for this phase.
- A separate support service duplicates auth/data infrastructure; unnecessary.

## User flow

1. Platform Admin opens Support from the existing workspace/admin navigation.
   Keep Applications accessible; do not change normal merchant landing routes.
2. Choose Stores or Orders and submit a search. No automatic full-platform list.
   Store search matches name, slug or store email; order search matches exact
   order UUID, Campaign order code or Event pickup code, case-insensitively.
   Non-unique pickup codes return separate rows with store and event identities.
3. Search has a 2–100 character trimmed input limit and a maximum of 25 results.
   Show a refine-search notice at the limit rather than silently implying that
   results are exhaustive. Treat SQL wildcard characters as literal input.
4. Store results show name, slug and publication flags, not customer contacts.
   Opening a store shows up to 25 recent Events and 25 recent Campaigns with
   dates/status, plus store-filtered order lookup. Clearly label recent lists.
5. Before opening store/order detail, require a 5–500 character support reason.
   Keep it in page memory for the current investigation, not localStorage or URL.
6. Order detail shows store and channel, order code/time, status, money breakdown
   with currency, purchased and gift lines, payment state/submission time,
   hold/grace deadlines when present, fulfillment state, carrier/tracking and
   pickup location/time when available. Show customer name and masked email/phone.
   Exclude full shipping address, slip URLs/images, account numbers, payment
   credentials and customer free-text notes in V1.
7. Clearly mark the page read-only. No save, payment approval, cancel, refund,
   stock adjustment, email retry or merchant-login controls.

## Accuracy

- Read saved order price/promotion/fulfillment snapshots; never recalculate an
  existing order using the current promotion definition.
- Label deadlines as recorded deadlines. An elapsed deadline alone must not be
  described as proof that stock was released. Read stored payment/order states;
  display an overdue-awaiting-processing hint if necessary.
- Distinguish order quantities from aggregate channel stock counters. Do not
  claim aggregate reservations are all owned by the inspected order.
- Offline orders have no invented online-payment countdown. Missing legacy
  fields display “Not recorded”, not zero/paid/expired by default.
- A detail fetch must not invoke existing lookup routines that expire holds or
  otherwise mutate commerce data. Query the relevant records directly.

## Authorization and access log

- Every endpoint independently checks `is_platform_admin()` before looking up
  any target. Merchant owner/manager/seller roles do not grant support access.
- Do not broaden base-table RLS to grant global orders/payments access.
- Use small public invoker RPC entry points with guarded private implementations
  if privileged reads are needed; lock search paths and qualify database objects.
  Grant only the necessary function execution, never service credentials to UI.
- Add an append-only support access table containing actor UUID, action, target
  store/order UUID, reason and timestamp. No customer data or raw search strings.
- A successful detail read and its access-log insertion occur in one transaction;
  audit failure fails the read. Missing targets return no detail and no success log.
- Search requests record their action/actor/time without the raw query. Denied
  requests disclose no existence information. No audit UI is required in V1.
- Clients cannot insert, update or delete audit rows directly. Record identity
  from authenticated context, never a caller-supplied actor ID.
- Do not cache sensitive responses in persistent browser storage. Clear detail
  on new searches, logout or access denial; ignore stale asynchronous responses.

## UI states

Thai and English labels; compact result table on desktop and readable stacked
results on mobile. Reuse the current workspace visual language, not a new design
system. Include initial guidance, loading, empty results, forbidden, not-found,
retryable errors and an always-visible read-only notice. Controls have labels,
keyboard focus, and usable touch targets. Query submission is explicit.

## Verification / acceptance

- SQL: anonymous and all non-admin merchant roles denied, admin allowed across
  two fixture stores, exact/duplicate order-code lookup, literal wildcards and
  bounded search, invalid inputs, missing targets and sensitive-field exclusion.
- SQL: audit actor cannot be forged, direct writes denied, successful reads
  recorded; compare commerce rows/counters before and after inspection to prove
  that reads do not expire holds, reprice orders or change stock.
- Browser: navigation, forbidden route, search/selection/reason/detail flow,
  errors/empty state, offline-vs-held order labels, TH/EN and mobile layout.
- Verify the real local flow using isolated fixture data, then run relevant
  security regression and `npm run verify`; inspect final diff and reverify any
  confirmed fix. Report limits honestly. Do not deploy without a later request.

## Implementation map

- `src/pages/AdminSupport.tsx`: search and detail workflow.
- `src/lib/adminSupport.ts`: explicit RPC DTOs and calls.
- `src/App.tsx`, `src/components/AdminHeader.tsx`,
  `src/pages/AdminApplications.tsx`: route and cross-navigation.
- New append-only Supabase migration: guarded reads and access-log table.
- `supabase/tests/admin_support_test.sql`: authorization and read-only guarantees.
- `src/tests/admin-support.spec.ts`: browser workflow and rendering regressions.

## Spec self-review

Single-phase scope; no placeholders. Read-only refers to commerce data, with the
explicit exception of append-only access logging. Sensitive fields, result limits,
legacy records and hold-state interpretation are defined above. Existing unrelated
worktree changes are excluded.
