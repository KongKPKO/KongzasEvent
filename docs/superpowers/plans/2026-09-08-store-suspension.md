# Store suspension

Approved: stop new orders and queue tickets, keep existing order lookup/payment review/fulfillment and normal hold expiry intact. Do not hide the store or rewrite channel state, stock, money or pending orders. New orders from an existing queue are still new orders and are blocked; existing orders can be completed.

- [x] Private store restriction state and append-only audit, admin-only suspend/resume RPC with reason and expected-state check. A store row lock serializes suspension against inserts. Guard orders and queues centrally, including channel reassignment; do not replace every checkout RPC.
- [x] Public boolean status lookup (visible store/merchant/admin only), no public reason. Admin store detail controls and public storefront notices; meaningful API rejection text.
- [x] Local DB regression: anon/merchant denial, protected state, all five new order types and queue blocked, unchanged channel updates allowed, resume and stale-state rejection. Real browser admin suspend/resume and anonymous customer notice.
- [x] Focused tests, commerce/security regressions, npm run verify and diff review. No remote migration or deployment. Platform Admin membership management is the next separate slice of item3.

Verification (2026-09-12, local only):
- `supabase test db --local supabase/tests/store_suspension_test.sql`: 22 checks passed.
- Stock summary/adjustment/promotion SQL: 87 checks passed; preorder/campaign/admin support SQL: 171 checks passed.
- `npm run test:security -- --project=desktop-chromium --reporter=line`: 25 tests passed.
- `npx playwright test src/tests/store-suspension.spec.ts --project=desktop-chromium --project=mobile-android-chrome-pixel5 --reporter=line`: 2 passed. Local browser, separate anonymous session. Screenshots saved under `/tmp/store-suspension-*.png`.
- `npm run verify`: passed; `git diff --check`: passed.
- Remaining verification limitation: row-lock concurrency has been reviewed, not stress-tested with simultaneous suspension/checkout transactions. Existing commerce expiry suites passed; no dedicated suspended-store expiry fixture yet.
