# Phase 3 — Account management suspension follow-up

The user chose immediate denial of one account's management rights while other teammates continue operating the same store and existing orders. This extends the [Phase 2–4 implementation](phase234-implementation-2026-10-21.md); content hiding/stop-sales remains a separate unanswered decision.

## Implemented behavior

- Platform Admin user details now suspend/restore management access with a 5–500 character reason, MFA, expected-state checks and an audit entry. The private restriction is keyed by immutable Auth UUID. Admin grants and suspension share a lock; an account cannot receive Platform Admin while suspended, and a Platform Admin must lose that grant before suspension. Existing self/last-admin protections remain.
- New management requests check current database state, including already-issued JWTs: store/event role helpers, legacy UID/email RLS, workspace selection, invitation/signup entry points and shop file ownership. Deleting an Auth user cannot reactivate its old token when the restriction row cascades away. Other team memberships and the original store/order/payment/stock state remain intact.
- The open workspace rechecks on focus/every five seconds, clears operational UI state/subscriptions and shows a suspension notice with retry, support, public browsing and logout. Server enforcement does not wait for that display refresh. Existing in-flight operations may finish; completed work and downloaded information cannot be recalled.
- Customer-token order tracking, public storefronts and authenticated support stay available. `is_account_management_active` is distinct from general account existence, so suspension does not prevent an appeal through `/help`.
- Private payment evidence now uses an authenticated `payment-evidence` broker, existing order/staff RLS and private/no-store binary downloads. Direct staff Storage read/sign permission is removed. Pre-order and campaign previews use local Blob URLs, reauthorize each opening and revoke URLs on close/unmount, with stale-request guards. Customer uploads are preserved.
- The conflict response is `PT409`, not `40001`: [PostgREST can retry serialization errors](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b). A lost acknowledgement followed by a stale retry refreshes current state without another state transition.

## Access and rollout

Use `/admin`, sign in with a verified Auth account that has a UUID-bound Platform Admin grant, then complete the Authenticator challenge. Store owner/manager roles do not confer platform privileges. Trusted first-admin bootstrap and later grant/revoke instructions: [Platform Admin access](runbooks/platform-admin-access.md).

No remote grant, migration, deployment, commit or push was performed. Apply migration `20261021045441_phase3_account_management_suspension.sql` after all earlier Phase 0–4 migrations, deploy `payment-evidence` with gateway JWT verification disabled and its in-handler authorization enabled, then deploy the matching frontend as one coordinated approved release. Old frontend versions cannot create new evidence links after the policy removal.

**Existing-link limitation:** a legacy bearer link remains valid until its own expiry. Known application-generated links have a 30-minute lifetime; independently minted links can have another lifetime. Establish expiry of all old links or separately authorize controlled object-path rotation before promising immediate revocation of old evidence URLs. No shared evidence is deleted by this feature.

## Validation

Target: confirmed disposable `NireqPhase234Validation`, API59421/DB59422, historical seed disabled, synthetic fixtures only. Existing Local/DEV/PROD were preserved. Three older SQL fixtures now create real Auth users before presenting management JWT claims, matching the new deleted-account protection.

- Clean replay: all **107 migrations** applied with seed disabled; copied migration hashes match source byte-for-byte. [Replay log](../output/phase234-local/suspension-reset-final.log).
- Focused authorization SQL: **123 assertions** across account suspension, invitation boundaries and promotion authorization, including same-JWT denial, deleted Auth identities, stale state, direct ownership/Storage and teammate fulfillment. [Focused log](../output/phase234-local/suspension-sql-focused-final.log). The final complete run includes the updated `PT409` conflict regression.
- Final **`npm run verify`: PASS** — lint/hygiene, TypeScript and production build, **27 SQL files / 603 assertions**, team-invitation concurrency, five promotion/stock race rounds, **96 desktop browser tests**, all **8 API smoke checks**. [Final verification](../output/phase234-local/suspension-verify-final.log).
- Android Chromium and iPhone WebKit: **2 tests passed**, exercising real admin MFA, suspension/restoration, old JWT denial, authenticated private evidence/preview revocation, teammate fulfillment, support submission, public storefront/customer lookup and a lost-acknowledgement retry. The regression includes a `manage-` prefixed store slug and `/live/queue` so customer routes stay accessible while reserved staff routes are blocked. [Mobile log](../output/phase234-local/suspension-mobile.log).
- Screenshots visually inspected after verification: [desktop](../output/playwright/phase3-suspension/account-desktop-chromium.png), [iPhone](../output/playwright/phase3-suspension/account-mobile-ios-safari-iphone12.png). Android is also [captured](../output/playwright/phase3-suspension/account-mobile-android-chrome-pixel5.png). All data is synthetic; no MFA setup image, token or password is recorded.
- Fresh diff review completed. Confirmed fixes were integrated before the final full run. Earlier failed and interrupted runs are diagnostic evidence only. The final tested source/config snapshot is `ad0e07315ee74dfe2209eff43477df826fe898eae38e8762a4a939b70618554a`; [manifest](../output/phase234-local/source-manifest.json). The earlier Phase 2–4 manifest is preserved separately.

No cloud deployment parity, Google OAuth provider flow, production load behavior, independent live Realtime subscription revocation timing, or old signed-link invalidation was certified. Policy/RPC tests exercise the database authorization used by Realtime; UI tests exercise operational subscription cleanup. The prior unrelated POS contrast limitation remains recorded in the Phase 2–4 report. Event/Campaign moderation is still awaiting its product decision.

The disposable validation project was stopped after checks, with Docker volumes retained. Unrelated local projects remain untouched.
