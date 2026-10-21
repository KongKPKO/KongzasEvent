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

## Validation and deployment evidence

Disposable local target: `NireqDevPhase234Validation`, API `59521`, DB `59522`, Mailpit `59524`, seed disabled. All 134 migrations are replayed from zero; no historical seed, remote credentials or customer records are copied.

Local and deployment logs are under the integration worktree's ignored `output/dev-phase234-local/` and the original checkout's ignored `output/phase234-dev-release/`. Final check results and cloud release identifiers must be taken from those logs; this preparation document alone does not assert a completed deployment.

Browser fixture compatibility uses current WebP evidence, dated team labels, the saved-access error message and explicit waits for asynchronous page readiness. The read-only support regression requires an isolated `Nireq…Validation` workspace, temporarily pauses only its stock-expiry scheduler and restores its previous state in `finally`; the expiry functions and application assertions remain active. This prevents an independent scheduled expiry from changing its deliberately expired fixture during read-only assertions.

The final combined gate uses `CI=true` and the repository's existing two-retry Playwright policy. Record any flaky/retried cases with the final results; a successful retry is not a claim of a clean first attempt.

Final local combined gate **passed** (`verify-ci-release.log`): lint/hygiene, type/build/PWA, 45 SQL files / 1,198 assertions, team concurrency, five stock races plus global-quota/idempotency checks, 165 desktop scenarios and eight API smoke checks. Desktop result: **164 passed + 1 flaky**, with the existing `campaign-multi-payment.spec.ts` case passing on retry after its five-second DB row-count wait saw one entry instead of two. First-attempt stability is therefore not established for that case. The eight targeted integration scenarios and isolated read-only support case also passed.

Targeted mobile validation: **3 passed, 1 intentionally skipped** across Android Chromium and iOS WebKit (`mobile-final.log`); account suspension/evidence/teammate fulfillment passed on both engines. The existing console navigation test retains its documented project skip.

DEV migration dry-run contains only the six Phase 1–4/account migrations plus the compatibility migration. Existing 127 remote migrations are retained; no history repair or migration rewrite is performed. Commit and push the integrated branch before applying DEV migrations or deploying functions/Hosting.

## Deliberately pending behavior

The user confirmed that hiding an Event/Campaign should hide it and stop new orders/queue entries while preserving existing order tracking and fulfillment. The mutation controls are not implemented in this deployment. This is separate from the shipped account management suspension and existing store suspension.

Previously issued payment-evidence bearer links keep their original expiry (known old app links: 30 minutes). New evidence previews recheck current access through the authenticated broker. Previously downloaded information cannot be recalled. Google provider delivery and external email-provider delivery require separate manual DEV checks; local tests use synthetic users and Mailpit/log delivery.
