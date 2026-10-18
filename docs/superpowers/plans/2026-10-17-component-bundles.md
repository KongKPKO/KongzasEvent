# Component bundles and product formats

Approved scope: separate bundle creation from ordinary single/photo products; remove preorder/service product kinds from creation. DEV database and preview deployment authorized. No production deployment.

- [x] Add authenticated atomic bundle save with existing same-shop product references, quantities, no nested bundles, immutable order composition snapshots.
- [x] Share component allocation/holds with individual sales across Events/POS/Campaigns; release/fulfill atomically. Production demand reserves receipts or explicit transfers only.
- [x] Project calculated bundle availability in catalog and channel menus; no independent bundle stock controls. Preserve historical descriptive bundles until deliberately configured; no automatic mapping by name.
- [x] Separate accessible bundle editor, cover/name/price, search existing items, quantity warning, stock limitation explanation. Remove obsolete type controls and CSV options.
- [x] Focused SQL lifecycle, auth, shared stock and production tests; browser editor/checkout regressions; full npm run verify; fresh diff review.
- [ ] Confirm DEV ref, apply append-only migration, commit/push intended changes, deploy preview, read-only smoke. Preserve unrelated local environments.

Legacy preorder/service metadata stays archived in columns; future sales use channel timing. Existing stock/order identities remain. Roll forward if migration needs repair; never remove history.

## Added scope: sales report and POS history

- Retain existing top sellers and summary. Add a server-aggregated, paginated product report with historical names/SKUs/prices, expandable variants, category/search/sort and BOM CSV. Allocate order discounts with deterministic largest-remainder cents. Separate currencies; current category/image metadata is disclosed.
- Refund amounts are only recorded at order level: show unavailable per-item refund and define product net as gross less allocated discount. No invented return quantities.
- Add a read-only POS drawer using event-scoped RPCs for owner/manager/seller. Queue staff and other shops are denied at the backend. Keep current cart and queue state independent from inspected orders. Display recorded payment, item, note/status and bundle component information where available; no new refund/payment actions.
- Focused SQL money/permission tests and browser report/export/cart/queue regressions are included in the release check.

Dashboard summaries now aggregate on the server too, so they cannot truncate at the Data API row limit. Regression fixtures include 1,005 orders and mixed-currency history. One currency selection applies to summary and product breakdown; order/queue details are not downloaded for calculation.

Validation completed: npm run verify passed (801 SQL assertions, five race rounds, 127 browser tests, eight API smoke checks). Focused mobile/history/report and last-unit bundle checkout regressions passed; fresh diff review completed. DEV release remains pending.
