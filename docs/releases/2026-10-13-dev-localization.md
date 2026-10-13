# DEV release: language selection and event context

Approved target: Firebase project `event-queue-app`, site `nireqapp`, preview channel `dev`, URL `https://nireqapp--dev-mttk3ru2.web.app`, Supabase project `kdjqitvtxmcrnnpuxuyl` (DEV).

The release integrates `27e85c0` with the existing DEV release `31a6114`. It retains DEV product families, validated image uploads, stock history, order problem reports, online discovery, offline operations and consent-based session replay.

Changes:

- Current-language TH/EN dropdown, explicit system-text localization, and persistent language selection. Merchant names and authored content remain intact; free-text fulfillment estimates remain verbatim.
- Event overview identifies the event, date, venue and status before its internal navigation. Queue/POS actions remain directly accessible. The duplicate event-level language controls are removed.
- Photoset gallery rendering survives navigation, editing and reload, including one-image galleries and URL-based media. The family editor retains validated image uploads.
- Recoverable workspace/auth loading failures, with retry rather than a misleading missing-store state.

Validation: `npm run verify` passes against disposable `NireqDevLocalization20261013`: lint/build, 23 SQL suites/504 assertions, five stock concurrency rounds, 91 desktop browser tests, and eight local API smoke checks. The browser suite includes four independent shop sessions, queue-to-cash-payment, pre-order evidence/review/pickup, language/cart preservation, photoset reload/edit, and offline receipt retry/idempotency.

Integration fixes retain the accessible failed-image name and adapt existing UI tests to current DEV controls. Validated evidence upload tests wait for the actual asynchronous completion. Offline tests use the discovered local API instead of an unrelated default port.

DEV migration dry run reports that the remote database is up to date. This release changes no migrations or Edge Function source relative to the previous DEV release; no remote migration, function deployment, seed, or transaction is required. Production is outside the approved target. Post-deploy public smoke is read-only and does not certify real email delivery or a full remote sales transaction.
