# Phase 2–4 implementation and local validation

This is an implementation record, not approval to deploy or certification of DEV/PROD readiness. Source is the current uncommitted checkout on top of `27e85c0`. Existing unrelated files are preserved.

## Implemented scope

- Phase 2: canonical server workspace enumeration/resolution; only UID owners or active memberships; explicit selection stored per user; selected-store guards for event/campaign routes; switching clears operational local state and realtime subscriptions and reloads scoped UI; logout errors stay visible and customer order records remain; invitation page identifies the signed-in account and offers account recovery.
- Phase 3: AAL2-gated `/admin` console with real bounded/paginated overview, users/memberships, creators, events/campaigns, read-only orders/queues and audit. Existing applications/store-support remain linked. Admin identity requires bound Auth UID; email-only entries are inert. Trusted first-admin bootstrap and reasoned grant/revoke are audited; self-revocation is refused. Direct application updates are denied; approval/rejection RPCs remain authoritative.
- Phase 4: `/help` for bug/support/suggestion, authenticated own-ticket status, guest reference/contact, private optional JPG/PNG/WebP screenshots (5 MB), server validation, per-user/guest limits plus a global guest circuit budget, idempotency, status/internal-note history, private authorized downloads and read/action audits. Feedback metadata strips query/fragment and customer order access codes from page URLs. No client can directly write ticket state, read other reporters' tickets/internal notes or upload/read the screenshot bucket.

## Product decision follow-up

The user confirmed immediate **account management** suspension on 2026-10-21, while teammates keep operating the same store and existing orders. This is implemented by the append-only `20261021045441_phase3_account_management_suspension.sql` migration, server authorization checks, audited reason/state transitions and the user detail UI. See [Platform Admin access and suspension](runbooks/platform-admin-access.md). It does not Auth-ban login, change store publication or rewrite memberships, money, stock or order state. Public customer/support flows remain available.

The user confirmed Event/Campaign moderation on 2026-10-21: hide and stop new orders/queue entries while preserving existing order tracking and staff fulfillment. These mutation controls are still unfinished and excluded from this DEV deployment; do not describe them as shipped. Existing **store** suspension is separate.

## Local environment

Disposable workspace: `output/phase234-local`; project `NireqPhase234Validation`; API59421, DB59422, Mailpit59424. Historical seed disabled. PostgreSQL image pinned to `17.6.1.063` for the known CLI/runtime issue documented in Phase 0–1. No remote migrations, deployment, real email provider, commit or push has been performed.

## Validation before the account-suspension follow-up

The results below describe the earlier Phase 2–4 snapshot. See [account-suspension validation](phase3-account-suspension-2026-10-21.md) for the later source, migration and checks.

The full result is recorded after the final verification below. Earlier failed/interrupted runs are retained as diagnostic evidence, not counted as successful checks.

- Clean replay: all106 source migrations applied with historical seed disabled; snapshot hashes match the repository migration files.
- Focused SQL: platform console and feedback tests passed together (53 assertions); final complete SQL run passed26 files/551 assertions.
- Focused browser: workspace selection/seller catalog/logout failure and successful identity switch passed on desktop Chromium, Android Chromium and iOS WebKit. Admin navigation/search/pagination/error handling passed desktop/Android. Guest/authenticated feedback, private attachments and upload recovery passed desktop/Android/iOS; the final note-response-loss regression also passed on Android/iOS (2 tests). Evidence: [mobile workspace](../output/phase234-local/mobile-workspace-final.log), [mobile feedback](../output/phase234-local/mobile-feedback-final.log), [targeted checks](../output/phase234-local/final-targeted.log).
- Targeted logout/keyboard/legacy POS accessibility checks passed (3 tests). The existing POS accessibility test is non-blocking for serious contrast findings: Axe reported one serious `color-contrast` rule at two unchanged empty-state elements, `src/components/dashboard/PosPanel.tsx:921` and `:1343`. This is not a full WCAG pass; retain for the UI/accessibility phase.
- Final `npm run verify`: **PASS** — lint/hygiene, TypeScript+Vite+PWA build,26 SQL files/551 assertions, team-permission concurrency, five promotion/stock race rounds,95 desktop browser tests and all API smoke checks. Evidence: [verify.log](../output/phase234-local/verify.log).

Reporter UI displays the latest50 own tickets; admins search the full inbox with20 tickets/page. Failed admin writes retain their request identity for an unchanged retry, preventing a lost response from duplicating an internal note. The final regressions deliberately simulate a committed note with an aborted response and assert one note after retry.

## Rollout after separate target approval

Apply the append-only Phase 1 and Phase 2–4 migrations in order, deploy the compatible feedback Edge handlers (gateway JWT disabled because each handler validates user authorization itself and intake also supports guests), then publish the matching frontend. Existing phase 1 notification authorization must ship with these changes. Confirm source/schema/Edge parity on a controlled DEV release before production approval.

For a new installation with no bound administrator, a trusted database operator confirms the verified Auth user UUID in the intended environment, then invokes `private.bootstrap_platform_admin(p_user_id, p_reason)` from the trusted SQL connection. This function is not exposed through the browser API, refuses an already bootstrapped system and requires an explicit reason. Do not insert a nullable-UID email as a workaround. The selected administrator enrolls an authenticator at `/admin`; all console calls still require AAL2. Later grants/revokes use the controlled UI/RPC and require verified target accounts and a reason. Never delete the last trusted recovery path or share MFA enrollment secrets.

Guest protections are bounded throttles (5 submissions/hour per guest scope; 200/hour global guest circuit; authenticated users20/hour). The shared guest circuit is intentionally conservative against distributed/header-rotation abuse and can temporarily block legitimate guests during an attack. Cloud proxy behavior and quotas must be checked on the approved DEV deployment; local tests do not certify perimeter behavior. Screenshot downloads require fresh authorized Edge requests and return private/no-store binary responses rather than reusable public URLs.

Review fixes preserve event/cart-scoped `posPaymentAttempt:*` IDs: they protect an uncertain payment retry and are not ordinary UI cache. Customer `orderSent_*`/`sentOrderId_*` records are also retained. Workspace/UI state, selected operational events, channels and pending context requests are cleared. Screenshot retries reuse immutable validated bytes when upload succeeded before metadata acknowledgement; the handler never deletes a potentially committed file on an ambiguous database response.

Overview distinguishes total entity counts from `active_events` (Confirmed and within start/end dates) and `active_campaigns` (published and within opens/closes dates). These are configured operating windows, not a promise of available stock. Queue activity uses the actual database values `waiting/calling/serving`; completed queues use `complete`. User console suspension status now comes from the private per-account management restriction, independently of Auth login bans.


## Evidence and handoff for the earlier Phase 2–4 snapshot

Selected source/config snapshot: `0b43140226843a982fa742e8b2d0bbbc75b6f6808dc6bf326d56879d52ff074a`; [file-hash manifest](../output/phase234-local/source-manifest-phase234-foundation.json). Migration snapshot has106 files and matches source byte-for-byte. This identifies the tested local inputs; it does not identify a cloud release or include the unrelated user-owned files.

Screenshots inspected: [desktop feedback](../output/playwright/phase234/feedback-admin-desktop-chromium.png), [Android feedback](../output/playwright/phase234/feedback-admin-mobile-android-chrome-pixel5.png), [iOS feedback](../output/playwright/phase234/feedback-admin-mobile-ios-safari-iphone12.png), [Android workspace](../output/playwright/phase234/workspace-mobile-android-chrome-pixel5.png), [iOS workspace](../output/playwright/phase234/workspace-mobile-ios-safari-iphone12.png). All use synthetic local data and are captured after MFA verification; setup secrets, passwords and access tokens are excluded.

The console UI suite intentionally skips the duplicate ordinary-user denial case on Android; desktop and SQL cover that denial. Full WCAG certification, real Google OAuth/provider delivery and remote schema/Edge/hosting parity were not verified. No production-readiness claim follows from these local results. The content-moderation decision is now confirmed; its mutation controls are not shipped.

Fresh diff review completed after validation; confirmed fixes were integrated and the required full verification passed. No commit/push/deploy/remote migration was performed. The disposable validation project is stopped after checks, with volumes retained; existing Local/DEV/PROD are preserved.
