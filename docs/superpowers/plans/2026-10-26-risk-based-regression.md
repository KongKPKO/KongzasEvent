# Risk-based regression sets

Goal: apply impact analysis before the supplied Impact × Usage matrix, so routine development runs the affected regression sets while release verification retains the complete existing gate. Keep existing assertions, fixture guards, transactional tests and concurrency checks.

Usage bands are provisional product assumptions, not measured analytics. The last verified release ran 174 browser scenarios and 1,231 pgTAP assertions across 46 SQL files; these are different units.

- [x] Catalogue Smoke, Lightweight and Full selections with domain, impact, provisional usage and rationale. Keep the existing full release roster.
- [x] Reuse `scripts/release-check.mjs` for execution; add scoped/changed-file selection, a read-only plan and conservative fallback for shared/unknown changes. Keep fixture execution local and remote public smoke unchanged.
- [x] Add selector/matrix/impact-routing regressions and integrate npm commands, agent guidance and release documentation. `verify` becomes affected verification; `verify:full` remains the pre-release gate.
- [x] Validate selection before running fixtures, run representative Smoke/Lightweight paths and the full gate against `NireqDevPhase234Validation`, then review the diff once.

Acceptance: changing presentation does not run unrelated SQL suites; pricing/stock and permission changes retain their relevant server tests; migrations/shared auth/unknown runtime paths and test infrastructure select Full; a missing selector or invalid scope fails visibly. No schema, production, DNS or deployed app changes are part of this work.

Validation (2026-10-26): 13 selector contracts passed; Smoke 9 browser cases passed (48.5s); presentation Lightweight 9 passed (21.6s); reports Lightweight 3 passed (12.5s) with 44 SQL assertions in two files. The new direct invitation endpoint case passed separately. `npm run verify` conservatively selected Full for these infrastructure changes and passed 175 browser scenarios (6.5m), 1,231 SQL assertions, both concurrency checks and API smoke. These browser timings exclude lint/build and are observations, not performance budgets. No deployed app, DNS or live data was changed.
