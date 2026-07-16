# Nireq Production Readiness and Guided Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the currently deployed Nireq application into a locally verified release candidate with reliable release gates, an understandable first-run creator path, safer live operations, and a documented Production rollout.

**Architecture:** Keep the existing React routes and Supabase domain model. Derive creator readiness from existing artist, event, catalog, payment, and pickup records; use small pure helpers for state resolution and keep all business mutations in existing RPC/Edge Function boundaries. Split local code changes from remote rollout so Production deployment, database changes, and Supabase settings remain an explicit approval step.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind CSS, React Router, Supabase Auth/Postgres/Storage/Edge Functions, Playwright, Vitest, Firebase Hosting.

---

## File map

- `src/lib/setupReadiness.ts`: pure five-step readiness and next-action resolver.
- `src/lib/setupReadiness.test.ts`: deterministic readiness tests without Supabase.
- `src/components/creator/GuidedSetupPanel.tsx`: first-run checklist and explicit publish entry point.
- `src/pages/creators/EventWorkspace.tsx`: loads readiness inputs and renders guided setup before the daily command center.
- `src/pages/creators/ManageArtist.tsx`: removes publish side effects from Copy/Open and exposes explicit publication.
- `src/pages/creators/ManageProducts.tsx`: prevents Enter in category autocomplete from submitting the product form.
- `src/pages/LegalPage.tsx`: public Privacy, Terms, and Cookies content.
- `src/pages/ManageLogin.tsx`, `src/pages/CreatorRegister.tsx`, `src/App.tsx`: legal links/routes and accessible recovery dialog.
- `src/lib/queueAvailability.ts`: one queue-availability resolver shared by creator and customer labels.
- `src/utils/edgeFunctions.ts`, `supabase/functions/notify-preorder-payment/index.ts`: authenticated notification invocation and retry-safe response handling.
- `supabase/migrations/20260716*_*.sql`: append-only queue and grant/search-path hardening.
- `src/tests/production-readiness.spec.ts`: browser regressions for Thai, explicit publish, category Enter, legal pages, and dialog keyboard behavior.
- `scripts/release-check.mjs`, `scripts/validate-release-env.mjs`, `.github/workflows/ci-pipeline.yml`: one local/CI release gate and non-Production CI guard.
- `index.html`, `src/index.css`, `tailwind.config.js`, `vite.config.ts`, `firebase.json`, `public/*`: Thai fonts, metadata, PWA assets, cache policy, and security headers.
- `docs/runbooks/production-release.md`: ordered deployment, smoke test, rollback, monitoring, backup, and cleanup procedure.

### Task 1: Make the release gate deterministic

**Files:**
- Modify: `package.json`
- Modify: `scripts/release-check.mjs`
- Create: `scripts/validate-release-env.mjs`
- Modify: `.github/workflows/ci-pipeline.yml`

- [ ] **Step 1: Add a failing environment-guard test**

Create a script whose pure check rejects missing values and the Production project ref during CI:

```js
export function validateReleaseEnv({ url, anonKey, allowProduction }) {
  if (!url || !anonKey) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required');
  const projectRef = new URL(url).hostname.split('.')[0];
  if (!allowProduction && projectRef === 'fnutmjnzugpayccscvgr') {
    throw new Error('CI tests must not target Production');
  }
  return projectRef;
}
```

- [ ] **Step 2: Run the guard against an empty environment**

Run: `env -u VITE_SUPABASE_URL -u VITE_SUPABASE_ANON_KEY node scripts/validate-release-env.mjs ci`

Expected: exit 1 with the required-variable message.

- [ ] **Step 3: Use the real Playwright project and GitHub secrets**

Replace every `--project=chromium` with `--project=desktop-chromium`, read both Vite values from GitHub environment secrets, and run `node scripts/validate-release-env.mjs ci` before tests. Keep load/soak jobs unable to run against the Production project ref.

- [ ] **Step 4: Make `npm run verify` the single local gate**

The script must execute hygiene, lint, build, the public Playwright smoke, and local API smoke in that order. It must stop on the first failure and never print a passing claim for a skipped command.

- [ ] **Step 5: Run the narrow checks**

Run: `npm run lint && npm run build && npx playwright test src/tests/public-i18n-smoke.spec.ts --project=desktop-chromium`

Expected: all commands exit 0.

### Task 2: Ship valid public assets, Thai typography, and hosting policy

**Files:**
- Modify: `index.html`
- Modify: `src/index.css`
- Modify: `tailwind.config.js`
- Modify: `vite.config.ts`
- Modify: `firebase.json`
- Create: `public/nireq-mark.svg`
- Create: `public/pwa-192x192.png`
- Create: `public/pwa-512x512.png`
- Create: `public/apple-touch-icon.png`
- Create: `public/mask-icon.svg`
- Create: `public/robots.txt`
- Create: `public/sitemap.xml`
- Test: `src/tests/public-i18n-smoke.spec.ts`

- [ ] **Step 1: Add browser assertions for Thai and public assets**

Add assertions that computed `font-family` includes `Noto Sans Thai`, the Thai heading has a non-zero bounding box, `/robots.txt` and `/sitemap.xml` return 200, and every manifest icon returns 200 with an image content type.

- [ ] **Step 2: Run the smoke test to prove the asset assertions fail**

Run: `npx playwright test src/tests/public-i18n-smoke.spec.ts --project=desktop-chromium`

Expected: FAIL on the missing Thai family or missing PWA icon.

- [ ] **Step 3: Add a Thai-capable font stack and metadata**

Load `Outfit`, `Inter`, and `Noto Sans Thai` from Google Fonts. Use `"Outfit", "Noto Sans Thai", "Inter", system-ui, sans-serif` for display/body, and add description, canonical, Open Graph, theme-color, and language metadata for `https://nireqapp.com`.

- [ ] **Step 4: Generate a restrained pink Nireq mark and correct manifest**

Use the same SVG source for the mask icon and deterministic 192/512/180 PNG exports. Set manifest name to `Nireq`, short name to `Nireq`, theme/background colors to the approved pink and warm off-white roles, and include `purpose: "any maskable"` where appropriate.

- [ ] **Step 5: Add public crawling files and safe hosting headers**

Add immutable one-year caching for `/assets/**`; keep HTML uncached; add `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and frame protection without blocking Supabase, Google Fonts, or current image hosts.

- [ ] **Step 6: Re-run the browser smoke and build**

Run: `npm run build && npx playwright test src/tests/public-i18n-smoke.spec.ts --project=desktop-chromium`

Expected: PASS and all manifest assets present under `dist/`.

### Task 3: Add public legal pages and accessible recovery

**Files:**
- Create: `src/pages/LegalPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/pages/ManageLogin.tsx`
- Modify: `src/pages/CreatorRegister.tsx`
- Test: `src/tests/production-readiness.spec.ts`

- [ ] **Step 1: Write legal-route and keyboard-dialog tests**

Cover `/privacy`, `/terms`, and `/cookies`; assert login/register links reach them. Open the reset dialog, assert focus enters it, Tab stays inside, Escape closes it, and focus returns to the reset opener.

- [ ] **Step 2: Run the new test and confirm failure**

Run: `npx playwright test src/tests/production-readiness.spec.ts --project=desktop-chromium -g "legal|recovery dialog"`

Expected: FAIL because routes and dialog focus behavior are absent.

- [ ] **Step 3: Implement the public legal page**

Use one component with `kind: 'privacy' | 'terms' | 'cookies'`, plain-language Thai-first copy, the support email `kongphop.sunit@gmail.com`, and a visible back-to-Nireq link. Do not claim automatic payment verification or data practices the application does not perform.

- [ ] **Step 4: Make the reset dialog keyboard-safe**

Capture the opener, focus the email field, trap Tab/Shift+Tab among enabled controls, close on Escape, restore focus, add `aria-modal="true"`, and keep interactive controls at least 44px high.

- [ ] **Step 5: Re-run the focused tests**

Run: `npx playwright test src/tests/production-readiness.spec.ts --project=desktop-chromium -g "legal|recovery dialog"`

Expected: PASS.

### Task 4: Replace implicit publication with derived guided setup

**Files:**
- Create: `src/lib/setupReadiness.ts`
- Create: `src/lib/setupReadiness.test.ts`
- Create: `src/components/creator/GuidedSetupPanel.tsx`
- Modify: `src/pages/creators/ManageArtist.tsx`
- Modify: `src/pages/creators/EventWorkspace.tsx`
- Test: `src/tests/production-readiness.spec.ts`

- [ ] **Step 1: Write pure readiness tests**

Test the five approved steps, including conditional payment/pickup requirements, zero sellable products, unpublished booth, and a fully ready booth. Assert the first incomplete step is the next action.

- [ ] **Step 2: Run readiness tests and confirm failure**

Run: `npx vitest run src/lib/setupReadiness.test.ts`

Expected: FAIL because `deriveSetupReadiness` is missing.

- [ ] **Step 3: Implement the minimal pure resolver**

Define `SetupReadinessInput`, `SetupReadinessStep`, and `deriveSetupReadiness(input)`. Compute state only from supplied artist/event/catalog/payment/pickup values; do not persist wizard flags.

- [ ] **Step 4: Remove publication side effects**

`handleCopyPublicUrl` only copies when public, `handleOpenPublicCatalog` only previews, and `handlePublishPublicBooth` alone calls `publish_owner_artist`. Show missing readiness items inline before enabling Publish Booth.

- [ ] **Step 5: Render first-run B and daily-use A**

Show `GuidedSetupPanel` while unpublished or incomplete. Once published and complete, keep the existing event command center dominant and expose setup as a resumable compact section. Reuse pink only for brand/primary/focus and semantic colors for status.

- [ ] **Step 6: Add browser regression coverage**

Assert Copy URL and Open Preview do not call the publish RPC, Publish Booth does, and first-run users see one dominant next step.

- [ ] **Step 7: Run unit and browser tests**

Run: `npx vitest run src/lib/setupReadiness.test.ts && npx playwright test src/tests/production-readiness.spec.ts --project=desktop-chromium -g "publish|guided setup"`

Expected: PASS.

### Task 5: Make product creation and queue availability safe

**Files:**
- Modify: `src/pages/creators/ManageProducts.tsx`
- Create: `src/lib/queueAvailability.ts`
- Create: `src/lib/queueAvailability.test.ts`
- Modify: `src/components/AdminQueueControls.tsx`
- Modify: `src/pages/customer/QueueView.tsx`
- Create: `supabase/migrations/20260716120000_reconcile_booth_queue_state.sql`
- Test: `src/tests/production-readiness.spec.ts`
- Test: `supabase/tests/queue_availability_regression_test.sql`

- [ ] **Step 1: Write failing category and queue-state tests**

Press Enter in category selection and assert no product mutation occurs. Unit-test `closed`, `booth-open-queue-paused`, and `accepting` states. SQL-test that opening a booth clears stale intake pause while preserving explicit operator pauses made afterward.

- [ ] **Step 2: Run narrow tests and confirm failure**

Run: `npx vitest run src/lib/queueAvailability.test.ts && npx playwright test src/tests/production-readiness.spec.ts --project=desktop-chromium -g "category Enter"`

Expected: FAIL.

- [ ] **Step 3: Prevent autocomplete Enter from submitting**

On the category input, call `event.preventDefault()` and `event.stopPropagation()` for Enter while the input is focused. Keep the visible Add Product button as the only submit action.

- [ ] **Step 4: Implement one queue label resolver**

Return `{ state, title, detail, acceptsTickets }` from event confirmation, booth-open, queue-open, and broadcast/pause reason. Use it in creator controls and customer queue messaging.

- [ ] **Step 5: Add an append-only transactional queue reconciliation migration**

Update the existing booth-open RPC/function so a newly opened booth and queue intake cannot disagree. Preserve role checks and set `search_path = ''`; do not expose a new anonymous mutation.

- [ ] **Step 6: Run unit, browser, and local SQL regressions**

Run: `npx vitest run src/lib/queueAvailability.test.ts && npx playwright test src/tests/production-readiness.spec.ts --project=desktop-chromium -g "category Enter|queue state" && supabase test db supabase/tests/queue_availability_regression_test.sql`

Expected: PASS in a running local Supabase environment; if local Supabase is unavailable, report that check as skipped.

### Task 6: Clarify manual transfer and separate notification failure

**Files:**
- Modify: `src/pages/ManageCombined.tsx`
- Modify: `src/pages/creators/PreorderDashboard.tsx`
- Modify: `src/utils/edgeFunctions.ts`
- Modify: `supabase/functions/notify-preorder-payment/index.ts`
- Test: `src/tests/regression/preorder-pickup.spec.ts`

- [ ] **Step 1: Add regression assertions for payment language and notification failure**

Assert POS says `Confirm transfer received`; preorder review says Nireq stores evidence for creator review; and a failed notification after a successful status update shows success plus a separate retryable email warning.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npx playwright test src/tests/regression/preorder-pickup.spec.ts --project=desktop-chromium -g "manual transfer|notification"`

Expected: FAIL on existing copy or coupled failure state.

- [ ] **Step 3: Update UI semantics without changing payment state**

Keep `TRANSFER` and existing database values. Change labels/help text only, and never claim Nireq checked a bank account.

- [ ] **Step 4: Make notification invocation authenticated and retry-safe**

Send the current session access token, return a stable notification result, and allow retrying only the notification call. A retry must not call the order/payment mutation again.

- [ ] **Step 5: Run the focused regression**

Run: `npx playwright test src/tests/regression/preorder-pickup.spec.ts --project=desktop-chromium -g "manual transfer|notification"`

Expected: PASS.

### Task 7: Harden Supabase boundaries locally

**Files:**
- Create: `supabase/migrations/20260716130000_harden_function_paths_and_grants.sql`
- Create: `supabase/tests/production_security_regression_test.sql`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Add SQL assertions before changing grants**

Assert anonymous/authenticated execution is absent for privileged functions, creator/staff actions still follow role policy, payment evidence remains private, and security-definer functions have an immutable explicit search path.

- [ ] **Step 2: Run the SQL test against local Supabase**

Run: `supabase test db supabase/tests/production_security_regression_test.sql`

Expected: FAIL on the confirmed excessive grants/search paths.

- [ ] **Step 3: Add the smallest append-only hardening migration**

Revoke only confirmed unnecessary grants, grant required functions to the narrow role, qualify object names, and set explicit search paths. Do not rewrite migration history or alter unrelated schemas.

- [ ] **Step 4: Re-run all relevant SQL regressions**

Run: `supabase test db supabase/tests/production_security_regression_test.sql supabase/tests/preorder_pickup_mvp_test.sql supabase/tests/team_invitations_test.sql supabase/tests/stock_adjustment_flows_test.sql`

Expected: PASS.

### Task 8: Document and verify the controlled Production release

**Files:**
- Create: `docs/runbooks/production-release.md`
- Modify: `src/lib/observability.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: Expose non-secret release metadata**

Inject `VITE_RELEASE_SHA` at build time, include it in sanitized error reports, and render it only in diagnostic output. Never include access tokens, evidence URLs, customer contact data, or service credentials.

- [ ] **Step 2: Write the release runbook**

Document: target-environment confirmation; CI secret names; deploy order for migrations, `notify-preorder-payment`, and web; smoke steps; monitoring checks; exact QA cleanup; rollback; leaked-password protection; SSL/network restrictions; and backup/PITR restore verification.

- [ ] **Step 3: Run the complete local gate**

Run: `npm run verify`

Expected: PASS. If Docker/local Supabase is unavailable, web verification may pass but the skipped SQL commands must remain explicitly listed.

- [ ] **Step 4: Review the diff with fresh context**

Run: `git diff --check && git diff --stat && git diff`

Expected: no whitespace errors, no credentials, no unrelated file changes, and no business mutation coupled to automatic retry.

- [ ] **Step 5: Fix confirmed review findings and verify again**

Run: `npm run verify`

Expected: PASS after the final fix pass.

- [ ] **Step 6: Stop before Production mutation**

Present the verified diff, skipped checks, migration/function list, and exact release command sequence. Obtain explicit user approval before deploying Firebase, applying remote Supabase migrations, deploying Edge Functions, or changing Auth/database settings.
