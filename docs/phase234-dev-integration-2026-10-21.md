# Phase 0–4 DEV integration — 2026-10-21

## Release scope and targets

Deploy the implemented workspace identity, team boundaries, MFA-bound Platform Admin console, account management suspension, feedback/support and authenticated payment-evidence access to DEV only.

- Supabase DEV: `kdjqitvtxmcrnnpuxuyl` (`Kongzas Event Queue - DEV`).
- Firebase project: `event-queue-app`, Hosting site/target `nireqapp`, preview channel `dev`.
- DEV URL: `https://nireqapp--dev-mttk3ru2.web.app`.
- Production Supabase `fnutmjnzugpayccscvgr` and live Hosting are excluded.
- Admin entry: `/admin`; use a verified account with an existing UUID-bound grant and complete Authenticator enrollment/challenge. Deployment does not bootstrap an arbitrary account.

The actual DEV frontend was based on `bcd44e82989a74089fbb45050b8bed8b3bbf15a5`, newer than the original task checkout. The release merges foundation `2a415c8` into that actual DEV base on `codex/dev-phase234-20261021`. It preserves the existing product families, bundles, production inventory, shipping, payment methods, order problems, offline recovery and seller types. FAQ content remains at `/help/guide`; feedback is at `/help` with links between both.

## Compatibility changes

The append-only `20261021102538_phase234_dev_compatibility.sql` preserves latest DEV manager cancellation and invitation issuer/membership checks, preserves seller-type signup, and closes the direct shipping-assignment suspension bypass. Account restrictions continue to affect only the target Auth UUID; other authorized teammates can fulfill existing orders.

Synthetic regressions cover assigned shipping staff suspension, fulfillment by another teammate, denied offline synchronization without a conflict record, manager invitation cancellation, stale inviter rejection and protection of existing manager membership. Fixture identities exist in Auth so checks exercise authorization rather than fail early for nonexistent identities. Invitation concurrency fixtures retain an authorized issuer.

Guest feedback explicitly sends no user Authorization token when there is no session, while retaining the public API key. Signed-in callers retain their user JWT; session errors fail instead of submitting as a guest. This supports DEV’s modern publishable key without treating it as user identity ([Supabase header contract](https://supabase.com/docs/guides/functions/auth-headers)). The browser regression asserts the actual guest request header and successful private attachment intake.

## Validation and deployment evidence

Disposable local target: `NireqDevPhase234Validation`, API `59521`, DB `59522`, Mailpit `59524`, seed disabled. All 134 migrations are replayed from zero; no historical seed, remote credentials or customer records are copied.

Local and deployment logs are under the integration worktree's ignored `output/dev-phase234-local/` and the original checkout's ignored `output/phase234-dev-release/`. Final check results and cloud release identifiers must be taken from those logs; this preparation document alone does not assert a completed deployment.

Browser fixture compatibility uses current WebP evidence, dated team labels, the saved-access error message and explicit waits for asynchronous page readiness. The read-only support regression requires an isolated `Nireq…Validation` workspace, temporarily pauses only its stock-expiry scheduler and restores its previous state in `finally`; the expiry functions and application assertions remain active. This prevents an independent scheduled expiry from changing its deliberately expired fixture during read-only assertions.

The final combined gate uses `CI=true` and the repository's existing two-retry Playwright policy. Record any flaky/retried cases with the final results; a successful retry is not a claim of a clean first attempt.

Final local combined gate **passed** (`verify-ci-release.log`): lint/hygiene, type/build/PWA, 45 SQL files / 1,198 assertions, team concurrency, five stock races plus global-quota/idempotency checks, 165 desktop scenarios and eight API smoke checks. Desktop result: **164 passed + 1 flaky**, with the existing `campaign-multi-payment.spec.ts` case passing on retry after its five-second DB row-count wait saw one entry instead of two. First-attempt stability is therefore not established for that case. The eight targeted integration scenarios and isolated read-only support case also passed.

The publishable-key follow-up passed all three feedback browser scenarios (`feedback-key-final.log`). An initial combined rerun hit the intentional five-per-hour guest throttle because prior local runs left rate events; that run was stopped and the disposable local database alone was rebuilt from all migrations with seeding disabled (`reset-publishable-final.log`). The final rerun passed on this fresh isolated target (`verify-publishable-clean.log`): 165/165 desktop scenarios in 11.4 minutes with no retries, all 1,198 SQL assertions, concurrency checks, and eight API smoke checks. No runtime rate limit was weakened.

DEV backend deployment completed from pushed merge `0675c94b04fbcc2800e4f9e9fef5f40fb1ea0679`: all seven planned migrations applied and all ten integrated Edge functions are ACTIVE. Readback confirms all 134 migration versions match (`dev-migrations-after.log`, `dev-functions-after.json`). A schema-only pre-deployment backup was saved under the ignored deployment snapshot. Public site URL configuration points to the DEV preview channel; provider email credentials were unchanged.

Targeted mobile validation: **3 passed, 1 intentionally skipped** across Android Chromium and iOS WebKit (`mobile-final.log`); account suspension/evidence/teammate fulfillment passed on both engines. The existing console navigation test retains its documented project skip.

DEV migration dry-run contains only the six Phase 1–4/account migrations plus the compatibility migration. Existing 127 remote migrations are retained; no history repair or migration rewrite is performed. Commit and push the integrated branch before applying DEV migrations or deploying functions/Hosting.

## Deliberately pending behavior

The user confirmed that hiding an Event/Campaign should hide it and stop new orders/queue entries while preserving existing order tracking and fulfillment. The mutation controls are not implemented in this deployment. This is separate from the shipped account management suspension and existing store suspension.

Previously issued payment-evidence bearer links keep their original expiry (known old app links: 30 minutes). New evidence previews recheck current access through the authenticated broker. Previously downloaded information cannot be recalled. Google provider delivery and external email-provider delivery require separate manual DEV checks; local tests use synthetic users and Mailpit/log delivery.

## 2026-10-22 follow-up: stale customer event receipt

A customer browser could restore shop-wide `orderSent` flags from an ended Event and disable the new Event menu. Both menu queue restorers could also select the old Event without checking its live window. The fix verifies the receipt through the existing order-ID/queue-ID RPC and verifies that queue’s event/service date before showing submitted status. Expired Event tickets no longer select an old Event or show calling notifications. Storage remains compatible with older receipts; server orders, stock and payments are not changed or cancelled. A failed status request blocks another confirmation for that ticket while retrying.

Regressions in `src/tests/e2e/full-service-loop.spec.ts` cover bound and legacy receipts from previous-day and same-day Events left Confirmed/open after their end times, a new queue/order from the same browser, reload restoration, preserved old order data, a failed receipt check without duplicate ordering, and a draft selected before joining the next Event queue. Expired receipt flags are forgotten without dropping that new draft. These two scenarios passed on desktop Chromium, Android Chromium and iOS WebKit (six cases, `event-receipt-scope-final.log`). The bug reproduced before the fix (`event-receipt-before.log`). Follow-up validation and deployment logs use the `event-receipt-` prefix in the existing ignored local output directory.

The final release gate passed (`event-receipt-gate.log`): lint/hygiene/type/build, 1,198 SQL assertions, concurrency checks, 167 desktop scenarios without retries (9.3 minutes), and eight API smoke checks. The final full-service flow also passed all three scenarios (`event-receipt-final-flow.log`). This frontend-only follow-up requires no remote migration or customer-order mutation.
