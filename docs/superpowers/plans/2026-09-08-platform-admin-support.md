# Platform Admin Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver the approved read-only support search/detail workflow without changing commerce data.

**Architecture:** One public invoker RPC delegates four explicit actions to a guarded private implementation. All response fields are allowlisted; a private audit table records searches and successful detail reads atomically. One React page uses the existing login and bilingual workspace patterns.

**Tech Stack:** Existing React/TypeScript, Supabase PostgreSQL, pgTAP, Playwright. No new dependencies.

Execution is inline. The executing-plans skill is unavailable; follow this checklist directly. Never deploy remotely in this task.

## Task 1 — Authorization/data contract regression

Files: `supabase/tests/admin_support_test.sql`; new migration generated with `supabase migration new platform_admin_support`.

- [x] Add local transaction fixtures: admin, non-admin owner/manager/seller/queue_staff, two stores, two events with duplicate pickup codes, campaign, held order and gift line.
- [x] Assert missing endpoint before implementation using `select has_function('public','admin_support',array['text','text','uuid','text','uuid']);`.
- [x] Use `set local role authenticated` and JWT claims in tests, not only postgres execution. Verify non-admin and anonymous denials, invalid action/query/reason, cross-store lookup, exact duplicate code results, store scoping, literal wildcard search, max25 and masking.
- [x] Snapshot orders/payment/stock before reads and compare after. Check append-only audit and accurate actor; force audit failure in the transaction and assert no detail return.

Run: `supabase test db supabase/tests/admin_support_test.sql` (initial fail; final pass).

## Task 2 — Read API and access audit

- [x] Create private RLS-enabled `admin_support_access` (identity id, actor UUID, action, target store/order UUID, reason, timestamp). No direct API role table grants.
- [x] Implement `private.admin_support(p_action text,p_query text,p_target uuid,p_reason text,p_store_id uuid) returns jsonb`, security definer with empty search_path. First statement rejects `not public.is_platform_admin()`. Never accept actor identity as an argument.
- [x] Public invoker wrapper uses the same arguments/defaults and delegates only to that implementation. Revoke default/public/anon execution; authenticated receives only the required execution and private schema usage. Private implementation still independently checks authorization.
- [x] `search_stores`: trimmed2–100 chars; `strpos(lower(field),lower(query))>0` for literal name/slug/email matching; deterministic order/id, limit25. `search_orders`: exact lower UUID/pickup_code match, joins event/campaign to store, optional store filter, limit25. Return `{results,limited}`. Log action, not query.
- [x] `store`: require reason5–500; return identity/publication flags and recent25 Events/Campaigns (id/name/status/dates). `order`: same validation; explicit identity, channel, saved money, item snapshots/gift line type, masked contact, payment/hold/grace, fulfillment and safe pickup fields. Never return `to_jsonb(order)` or raw pricing/payment snapshots.
- [x] Successful detail reads insert their target/reason audit record in the same transaction. Missing detail returns null. No existing order lookup/expiry RPC calls.
- [x] Apply to LOCAL only via psql, run regression, inspect privileges/advisors, then record local migration history. Preserve remote history.

## Task 3 — Typed client and support page

Files: `src/lib/adminSupport.ts`, `src/pages/AdminSupport.tsx`.

- [x] Export explicit search/detail DTOs and two narrow helpers (`searchSupport`, `openSupport`) calling `supabase.rpc('admin_support', {p_action,p_query,p_target,p_reason,p_store_id})`.
- [x] Page checks `is_platform_admin`; unauthenticated route redirects to login, merchant-only account sees forbidden. Clear state on auth changes/unmount.
- [x] Add explicit submit form: Stores/Orders, query2–100, optional selected store scope; reason5–500 for opening detail; initial/empty/loading/error text. Disable detail controls without valid reason.
- [x] Invalidate a request sequence on mode/input/new request/auth changes; ignore late promises. Keep responses/reason only in memory, never URL/localStorage.
- [x] Render responsive result rows and detail sections with TH/EN labels, currency/date formatting and “Not recorded” for null legacy values. Offline detail has no timer; elapsed awaiting-payment deadline says overdue, not automatically expired/released.
- [x] Store detail lists recent channels and offers store-filtered order search; order detail labels purchase vs gift and shows masked contacts. Read-only banner always visible; no commerce mutations.

## Task 4 — Navigation and real UI regression

Files: `src/App.tsx`, `src/components/AdminHeader.tsx`, `src/pages/AdminApplications.tsx`, `src/pages/ManageLogin.tsx`, `src/tests/admin-support.spec.ts`.

- [x] Add `/admin/support` to workspace-optional routes and the session-guarded Router. Preserve merchant landing behavior; allow only exact admin support/applications login redirects after admin check.
- [x] Add support links beside Applications on desktop/mobile and an Applications/Support link in each platform page.
- [x] Browser local fixture uses admin create-once/sign-in, then searches a foreign store and an order, enters reason, opens detail, asserts masked data and audit insert. Capture desktop/mobile screenshots outside repo and inspect them.
- [x] Test forbidden merchant, missing result, failed RPC then retry, TH/EN, no mutation buttons, no overflow, and stale-response clearing. Assert `pageerror` empty and no framework overlay.

## Task 5 — Release verification, not deployment

- [x] Run focused SQL plus `npx playwright test src/tests/admin-support.spec.ts --project=desktop-chromium --project=mobile-android-chrome-pixel5`.
- [x] Run `npm run test:security -- --project=desktop-chromium` and `npm run verify`.
- [x] Review intended diff and security grants with fresh context. Fix confirmed issues and repeat affected checks/verify.
- [x] Commit intended feature files only; preserve unrelated `.gitignore`, `docs/api`, `docs/specs`, `scripts/docs`.
- [x] Report tests and limitations; no push/deploy or remote migration in this phase.

## Self-review

Spec coverage: search/detail (tasks2–3), safe read-only/audit (tasks1–2), auth/nav (task4), privacy/time/legacy rendering (tasks2–4), validation (task5). Response fields mirror local schema: orders use `pickup_code` for Campaign and Event codes, `pickup_status` for fulfillment, and have no `artist_id`; store ownership comes from the joined channel. No new state machine or inferred stock mutation.

Verification: local pgTAP 43 assertions, browser desktop/Android 2 cases, and security 25 cases passed. Screenshots inspected under `/tmp/admin-support-*.png`. Local security advisor at error severity reported no issues. No remote migrations/deployment; Safari and DEV verification remain for a later approved release.
