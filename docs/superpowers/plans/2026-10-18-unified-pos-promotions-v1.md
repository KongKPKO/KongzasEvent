# Unified POS queue operations and Promotions V1

User specification: attached “Complete Queue/POS UX and Refactor Promotion System V1”. Implement and validate locally; the user explicitly approved finishing the work and updating the DEV database/frontend on 2026-10-19. Target: Supabase kdjqitvtxmcrnnpuxuyl and Firebase nireqapp channel dev. Preserve existing roles, order/stock identities, legacy promotions, report/history and channel rules.

## P0 — queue operations within POS

- [x] Trace ManageCombined, QueuePanel, PosPanel and current role/state rules. Current arrival immediately starts serving; single-call updates are client-side; POS selects only serving queues and fetches overwrite unsaved carts.
- [x] Add arrival metadata (without changing existing status enum), authenticated atomic/idempotent batch calling (1/3/5/10), shared optimistic queue actions. Reuse existing role checks and service date rules.
- [x] Share actions between QueuePanel and a POS Queue Drawer. Show waiting/called/arrived/serving, recall/missed/requeue, direct sale selection and real counts; no route change.
- [x] Keep sale context, order ID and displayed queue consistent. Retain an unpaid draft per context during switches and ignore stale remote responses. Block checkout during context transitions/payment and preserve walk-in.
- [x] Add SQL role/state/retry/concurrency regressions and real two-device/browser tests, desktop/tablet/mobile screenshots.

## P1 — promotions

- [x] Audit existing quote/checkout/save/stacking/gift flows and document compatibility boundaries before structural edits.
- [x] Extend existing condition/reward representation for unit/spend/exact-SKU/exact-recipe conditions, fixed/percentage discount plus one fixed-SKU gift, preserving existing promotion data and legacy gift choices.
- [x] Add atomic shared gift quota accounting with idempotent checkout and existing cancellation/refund semantics; discount remains valid when quota/stock is exhausted.
- [x] Add opt-in bundle auto-pricing from exact components, deterministic non-overlapping consumption, own bundle price and immutable sale snapshots. Surface any ambiguous competing bundle or spend-base decision for clarification before implementing it.
- [x] Four-section localized form and unsaved-draft test cart using the same server calculation as checkout, with unmet-condition/stock/quota explanations and zero mutations.
- [x] Regression coverage across POS/Event/Campaign, legacy stacking, quotas, gifts, retry/cancel/refund, preview parity and permissions.

## Verification / release

- [x] Focused checks then npm run verify; fresh diff review, fix confirmed regressions and rerun affected checks.
- [x] Inspect real desktop/tablet/mobile screenshots and exercise all affected journeys.
- [x] Report files, migrations, test results/screenshots and precise limitations. Do not claim remote application or deploy until authorized and completed.

Remote migrations remain append-only after release. Use confirmed disposable local Supabase for mutating tests. Additive compatibility changes only; no deletion or silent reinterpretation of existing promotions. Any major incompatible architecture/business-rule choice is a user decision per the brief.

## Confirmed product decisions (user reply)

- Keep minimum-spend eligibility after discounts, as in existing rules. Spend discount is once per order; percentage applies to eligible merchandise (complete groups for quantity conditions), rounded to two decimals. Preserve deterministic existing stacking and exclude a reward from its own condition.
- Auto-detected sets become actual bundle order lines and downstream rules see the bundle SKU. Competing recipes consume each unit once, best saving first, deterministic ties.
- A gift cap is global across the reusable promotion and its channels. Unpaid online orders reserve quota during the existing hold; expiry/unpaid cancellation releases it. Successful payment redeems it, and refunds do not automatically restore it.
- Existing mixed-SKU customer-choice gifts remain compatible; new combined V1 offers use one fixed gift SKU.

## Validation notes

- P0: focused SQL 35/35 and the real two-device drawer journey passed, including a lost committed response retried with the same request ID. Captured desktop/mobile/tablet.
- P1: focused condition/reward SQL, existing bundle/stock/offline suites and real editor/preview flow passed. Simultaneous Campaign requests demonstrated one global gift right, stale-quote rejection and a discount-only fresh retry.
- Clean local reset applied all three new migrations successfully. Final `npm run verify` passed: 923 SQL assertions in 34 files, five existing stock/gift races plus the V1 simultaneous global-quota scenario, 130 browser journeys, and eight API smoke checks. Lint, typecheck/build and tracked-file hygiene passed. This is local verification; remote release evidence is recorded separately after deployment.
- Review fixes: restore legacy offline/no-auto paths and their stock error contracts; use event-local service dates in bundle fixtures across UTC midnight; subtract component demand from fixed gifts; preserve item notes; invalidate stale draft previews; allow archiving an unavailable gift; preserve safe queue projections and column grants.

- Final review fixes: retain own loose-component holds when an existing queue cart becomes a set; avoid crediting ordinary holds twice; compact the mobile active-sale bar; preserve an open customer item picker during live catalog refresh. The latter has an explicit real-time price-update regression on desktop and mobile.
- Screenshots and the completion report are retained locally in `output/queue-promotion-v1-evidence/`. Unsaved cart context drafts last for the current session; offline pricing keeps the existing reconciliation path; multi-cashier POS remains outside V1.
