# Paimon regression sets

`npm run verify` now checks the current **impact scope** rather than running the complete release suite for every edit. The existing Full gate remains available through `npm run verify:full` and `npm run test:release`.

The last Paimon release ran **174 browser scenarios and 1,231 pgTAP assertions in 46 SQL files**. An assertion checks one condition inside a scenario; these are not 1,231 separate user journeys. Counts grow with the tests. The runner prints the actual selected browser count after collecting tests.

## Daily commands

Run fixture tests only against a confirmed disposable local Supabase. This chat's existing isolated environment uses `SUPABASE_WORKDIR="$PWD/output/dev-phase234-local"`; another checkout must prepare and confirm its own local environment first. The runner preserves the existing localhost/credential/environment checks and never runs fixture suites through its remote mode.

```bash
# Inspect the current diff and selection without Docker, credentials or test execution.
npm run test:regression:plan

# Lint + selector contracts + affected regression sets + typecheck/build when relevant.
SUPABASE_WORKDIR="$PWD/output/dev-phase234-local" npm run verify

# Fast cross-domain journey check; no SQL or concurrency suites.
SUPABASE_WORKDIR="$PWD/output/dev-phase234-local" npm run test:regression:smoke

# Focused development check; available scopes are in the catalogue below.
SUPABASE_WORKDIR="$PWD/output/dev-phase234-local" npm run test:regression:lightweight -- --scope presentation
SUPABASE_WORKDIR="$PWD/output/dev-phase234-local" npm run test:regression:full -- --scope workspace

# Check a committed feature diff as well as any remaining working edits.
SUPABASE_WORKDIR="$PWD/output/dev-phase234-local" npm run test:regression -- --base HEAD~1

# Full existing release gate before an approved DEV/PROD deployment.
SUPABASE_WORKDIR="$PWD/output/dev-phase234-local" npm run verify:full
```

`--scope` accepts comma-separated catalogue names. Explicit Smoke/Lightweight commands are development checks, not a substitute for the affected gate or the Full pre-release gate. To preview an explicit set, append `--list`, for example `npm run test:regression:lightweight -- --scope presentation --list`.

Git impact includes staged edits, unstaged edits, untracked files and both sides of a rename. The default base is `HEAD`. A **clean worktree selects Smoke only**; use `--base <commit>` to verify already committed work. A bad base, unknown scope or unknown flag fails rather than silently selecting fewer tests.

## Impact × Usage matrix

First identify the affected domain and its dependencies. Only then apply the supplied matrix:

| Impact | Very high ≥80% | High 51–79% | Medium 21–50% | Low ≤20% |
| --- | --- | --- | --- | --- |
| Critical P1 | Smoke | Lightweight | Lightweight | Full |
| High P2 | Lightweight | Lightweight | Lightweight | Full |
| Medium P3 | Full | Full | Full | Optional |
| Low P4 | Optional | Optional | Optional | Optional |

**Usage is provisional.** There is no measured usage dataset behind these assignments. The bands are product assumptions to make the initial sets usable, with a rationale in `scripts/regression-suites.mjs`. They do not establish that the selected cases cover 80% of business impact. Reclassify using real product usage when available. Optional means excluded from automatic prioritization, not deleted from Full.

## Catalogue

Each row owns existing cases and server regressions. The executable source of truth is [the suite catalogue](../../scripts/regression-suites.mjs); file/group/case selections reference existing Playwright titles, so no test bodies are copied.

| Scope | Impact | Provisional usage | Automatic tier | Primary coverage |
| --- | --- | --- | --- | --- |
| `public` | P2 | High | Lightweight | Discovery, anonymous/public/private shops, entry and release assets |
| `auth` | P1 | High | Lightweight | Registration, email confirmation, reset and session failures |
| `queue` | P1 | High | Lightweight | Join → call → serve → payment; queue transactions and realtime |
| `sales` | P1 | Very high | Smoke | Campaign checkout, preorder/payment evidence/pickup, hold and retention SQL |
| `catalog` | P1 | High | Lightweight | Cart, allocations, production, bundles, stock math and import atomicity |
| `products` | P2 | Low | Full | Product/variant authoring, imports and bundle editors |
| `promotions` | P1 | High | Lightweight | Server quotes, stale pricing, atomic save, gifts, activity rights and stock races |
| `workspace` | P1 | Low | Full | Team/event roles, cross-workspace identity, suspension and invitation races |
| `platform` | P1 | Low | Full | MFA, non-admin denial, platform console and RPC privileges |
| `support` | P2 | Low | Full | Feedback, notification delivery and authorization |
| `recovery` | P1 | Low | Full | Existing offline receipts, synchronization and reconciliation |
| `reports` | P2 | Medium | Lightweight | Report totals, variants/export and read-only POS history |
| `media` | P2 | Medium | Lightweight | Images, variant galleries and storage boundaries |
| `appearance` | P3 | Medium | Full | Optional event appearances and public details |
| `presentation` | P2 | High | Lightweight | Shared theme, responsive header, storefront, language menu and POS language state |

Automatic **affected** checks keep each selected business domain's SQL regressions even when its browser tier is Smoke. Pricing/stock changes fan out to checkout, catalog and promotions; they retain promotion concurrency. Team role changes retain invitation/assignment concurrency. Browser-only mocked responses never replace transaction regressions.

Examples:

- `src/index.css`, `tokens.css`, brand assets or translations → presentation Lightweight, without unrelated SQL/races.
- Promotion/cart/pricing/stock/product logic → related sales/catalog/promotions sets, SQL and stock races.
- Reports → report/history cases and reporting SQL.
- Team UI → complete workspace regressions and role races.
- Migrations, Edge Functions, shared authentication/access code, the app router, dependency/config changes, test infrastructure or an unknown runtime path → the complete existing Full gate.
- A changed browser spec also runs **all cases in that file**, even if the domain's normal tier selects one Smoke case. New unclassified specs select Full and include the new spec.
- Documentation-only changes run static checks without starting a fixture backend.

## Selection integrity and release boundaries

Before running browser fixtures, the runner collects the selected files, verifies that **every requested file/group/case exists**, and expands the result into exact test-list entries. This supports the installed Playwright version and avoids a green run that silently lost a renamed case. A stale or empty selection fails visibly. [Selector regressions](../../scripts/regression-selection.test.mjs) cover the matrix, Git changes, conservative fallback, scope guards and missing cases.

Full preserves the previous release roster and adds the existing direct team-invitation email/authorization regression; it retains all SQL files, team/promotion concurrency and eight API smoke checks. The three existing isolated-only browser files still require `SUPABASE_WORKDIR`. No business test is removed. Legacy exploratory/security/performance/browser suites that were already outside the release roster remain separately runnable; the former `test:regression` legacy command is retained as `test:regression:legacy`.

`test:release:staging` and other remote checks still run public, read-only smoke only and reject fixture-selection flags. The existing GitHub QA pipeline keeps its security/load/browser jobs; this change adds the selector contract tests, without moving its fixtures or changing its backend. Automated impact selection here applies to the local verification/release commands.

Deploying, editing DNS, changing live Auth settings or applying remote migrations still requires the project's explicit target authorization. A reduced development set is never evidence that Full has passed.

## Initial validation — 2026-10-26

| Set | Observed browser result | Browser time | Server checks |
| --- | --- | --- | --- |
| Smoke | 9 passed | 48.5s | None by design for the explicit fast journey check |
| Lightweight `presentation` | 9 passed | 21.6s | No unrelated SQL/races |
| Lightweight `reports` | 3 passed | 12.5s | 2 SQL files / 44 assertions passed |
| Full through `npm run verify` for this infrastructure diff | 175 passed | 6.5m | 46 SQL files / 1,231 assertions, both concurrency checks and API smoke passed |

The 13 pure selector contracts also passed. Timings are observed browser phases on the existing isolated local environment; lint/build/collection are additional work. Hosted GitHub CI was not executed locally. Usage classifications remain provisional.
