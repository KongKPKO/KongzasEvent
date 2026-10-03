# DEV release: product families, CSV and event Cosplan

Approved target: Supabase `kdjqitvtxmcrnnpuxuyl` (Kongzas Event Queue - DEV), Firebase project `event-queue-app`, site `nireqapp`, preview channel `dev`.

The release starts from `1c09ffe` on `origin/codex/dev-release-20260922`. Product family, CSV and Cosplan changes are integrated with the existing stock history, validated WebP upload, online discovery and offline operation features. The original developer checkout and its unrelated pending work are preserved.

Reviewed pending migrations:

- `20261003100000_product_families.sql`: shared product parents, existing child identities/inventory preserved, atomic family editor and public presentation.
- `20261003110000_event_appearances.sql`: optional event/date appearance with creator management and public visibility policies.
- `20261003120000_import_product_families.sql`: atomic create-only CSV batches with duplicate and concurrency guards.

Preflight remote aggregate: 14 existing child products, 13 active owned child products, one shop. No customer records or identifiers are included in release evidence. The remote migration dry run contains only the three files above; no seed is included.

Validation on the integrated candidate passed: `npm run verify` includes lint, TypeScript/Vite build, 504 SQL assertions in 23 suites, five inventory concurrency runs, 71 desktop browser tests and local API smoke checks. Tests use a separate disposable Supabase project; no remote fixture writes are part of validation.

Integration also fixes queue status updates to retain the database-generated revision after each transition. The full customer queue → arrival → POS payment flow verifies the next transition without waiting for Realtime. Existing stock receipts/history, WebP uploads, shipping/checkout, search and online discovery remain covered.

Fresh diff review and DEV migration dry run completed. The deploy procedure commits and pushes this isolated branch, applies exactly the three migrations without seed, then builds the same commit for the approved DEV preview channel. Remote post-deploy evidence is recorded outside the commit so the deployed release identity stays stable. Production is outside this release target.

Four Android mobile browser flows also passed on the integrated candidate: family management/Cosplan, CSV import, product presentation types and customer storefront.
