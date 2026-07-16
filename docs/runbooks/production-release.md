# Nireq Production Release Runbook

This runbook deliberately separates local verification from remote mutation. Never apply a remote migration, deploy an Edge Function, change Supabase settings, or deploy Firebase Hosting until the owner explicitly approves that release and confirms the Production target.

## 1. Release identity and target confirmation

Production identifiers:

- Site: `https://nireqapp.com`
- Supabase project ref: `fnutmjnzugpayccscvgr`
- Firebase Hosting target: `nireqapp`

Record the branch and immutable SHA:

```bash
git branch --show-current
git rev-parse HEAD
git status --short
```

The release candidate must come from the agreed release branch with no unexplained changes. CI uses a non-Production Supabase environment. Required GitHub secrets are `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY`; the environment guard rejects the Production project for automated and load tests.

## 2. Local release gate

```bash
npm ci
npm run verify
git diff --check
```

`npm run verify` must complete hygiene, lint, environment validation, build, public Playwright smoke, and local API smoke. Run the focused production regressions too:

```bash
npx playwright test \
  src/tests/production-readiness.spec.ts \
  src/tests/setup-readiness.spec.ts \
  src/tests/queue-availability.spec.ts \
  --project=desktop-chromium
```

If local Supabase is running, also run the existing money, stock, auth/RLS regressions:

```bash
supabase test db \
  supabase/tests/preorder_pickup_mvp_test.sql \
  supabase/tests/stock_adjustment_flows_test.sql \
  supabase/tests/team_invitations_test.sql
```

An unavailable local Supabase or Docker runtime is a reported skipped check, never a pass.

## 3. Pre-deploy Production checks

After explicit release approval:

1. Confirm the logged-in Supabase and Firebase projects match the Production identifiers above.
2. Export the list of pending migrations with `supabase migration list`; inspect every pending file.
3. Confirm a current database backup exists and note its timestamp.
4. Confirm restore/PITR access and the person responsible for initiating restore.
5. Confirm Auth leaked-password protection is enabled.
6. Confirm database SSL enforcement is enabled and direct database network access is limited to required sources.
7. Set Edge Function secrets without printing values: `RESEND_API_KEY`, `PREORDER_EMAIL_FROM`, `PUBLIC_SITE_URL`.
8. Set Firebase build variables: Production Supabase URL, publishable/anon key, `VITE_RELEASE_SHA`, and `VITE_LOGROCKET_APP_ID`. Keep `VITE_LOGROCKET_CAPTURE_EMAIL=false` unless separately approved.

## 4. Deployment order

Use the exact approved SHA. The order matters because the web client must not call a missing backend function.

```bash
# 1. Apply only reviewed append-only migrations.
supabase db push --linked

# 2. Deploy payment notification support before the web client.
supabase functions deploy notify-preorder-payment --project-ref fnutmjnzugpayccscvgr --no-verify-jwt

# 3. Deploy other changed functions only if they are in the reviewed diff.
supabase functions deploy notify-creator-application --project-ref fnutmjnzugpayccscvgr --no-verify-jwt
supabase functions deploy notify-team-invitation --project-ref fnutmjnzugpayccscvgr --no-verify-jwt

# 4. Build with release identity and deploy Hosting.
VITE_RELEASE_SHA="$(git rev-parse HEAD)" npm run build:prod
firebase deploy --only hosting:nireqapp
```

Do not copy any service-role key into a `VITE_*` variable. Browser code receives only the publishable/anon key.

## 5. Production smoke test

Use a uniquely named temporary QA creator and record every exact id created. Complete:

1. Registration, confirmation email, workspace creation, logout/login, reset email, and new-password login.
2. Guided setup: profile, event with timezone/location/booth, product and event stock, payment and pickup settings.
3. Confirm Copy URL and Open Customer Catalog do not publish; use the explicit Publish Booth action.
4. Open booth once and confirm the customer immediately sees queue intake as accepting, without pause-then-clear.
5. Join queue, call, arrive/serve, send a customer selection, and complete POS with `Confirm transfer received`.
6. Create a pre-order, upload a small JPEG evidence file, reject with a reason, resubmit, confirm, and pick up.
7. Confirm notification success and verify a forced email failure can retry email without repeating order, stock, or payment mutations.
8. Verify Thai text on a clean browser profile, legal routes, PWA icons, responsive mobile layout, and reset-dialog keyboard behavior.

Stop the release if any money, stock, authorization, private evidence, or queue-state result is wrong.

## 6. Monitoring checks

Within 15 minutes of deployment:

- verify the LogRocket release equals the deployed SHA;
- verify request/response bodies and auth headers are absent from captured sessions;
- inspect Supabase Auth, Postgres, Storage, and Edge Function errors;
- alert on elevated 4xx/5xx rates for `notify-preorder-payment`, order RPCs, queue RPCs, and evidence upload;
- verify the browser console has no new unhandled errors on the critical flow.

Business-state success and notification delivery are separate. An email error must not be treated as a failed payment confirmation or retried by repeating the business mutation.

## 7. Rollback

For a web regression, deploy the previous known-good Hosting release/commit. For an Edge Function regression, redeploy the previous function source. Do not reverse an applied migration by editing migration history; create a reviewed forward migration or restore only under the incident lead's direction.

If authorization or evidence privacy is compromised, close affected public flows first, preserve logs, rotate exposed credentials, and begin the incident process before resuming sales.

## 8. QA cleanup and restore evidence

Delete temporary data by the exact recorded ids in dependency order: evidence Storage objects, order items/payments/orders, queues, event catalog rows/products, events, artist membership/artist, then Auth user. Query each id afterward and record zero remaining rows/objects.

At least once before expanding beyond the pilot, restore a recent backup into an isolated non-Production environment and document:

- backup timestamp and restore target;
- start/end time and responsible person;
- row counts for users/workspaces, events, orders, payments, and queues;
- authentication and critical-flow smoke result;
- recovery point and recovery time achieved.
