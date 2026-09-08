# Admin history and order-link resend

- [x] Add restricted resend attempt ledger and admin-only atomic claim (reason, identity, cooldown); append-only migration. History RPC returns recorded milestones and allowlisted delivery/attempt metadata, logged via existing support read.
- [x] Add authenticated Edge Function sending only the saved order-status link. Preserve original notification ledger. No client-provided recipient or URL, no automated ambiguous-send retry. Local Mailpit only during tests.
- [x] Extend support detail with explicit history loading, resend confirmation and clear results in TH/EN; clear sensitive UI on auth/navigation changes.
- [x] Test admin/non-admin, repeated and concurrent claims, cooldown, original ledger and commerce unchanged, real Mailpit send, UI confirmation and duplicate protection.
- [x] Run focused tests, security suite, npm run verify; review diff and fix confirmed findings, rerun checks. No remote migration or deployment.

Verified locally: pgTAP 61 assertions; admin support desktop/Android E2E 2 cases; security 25 cases; npm run verify (lint/build/public smoke6/API smoke) passed. Actual Mailpit messages verified with saved recipient and order link; simultaneous requests sent only once, successful original ledger preserved. UI cancellation, cooldown, unknown transport response, repeated-request check and revoked admin were exercised. Local security advisor (error severity) found no issues.

Browser plugin not available; repository Playwright used at http://localhost:5173. Desktop/Android screenshots inspected under /tmp/admin-email-*.png. Resend provider delivery/failure, Safari and DEV remain untested. No remote deployment or real customer email. Future approved DEV release must apply the new migration, deploy admin-resend-order-link, and set PUBLIC_SITE_URL to the DEV site. Existing notification functions are unchanged.
