# Signup Idempotency, Notification, and Full-Flow UAT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate duplicate self-serve creator applications, restore preorder notification delivery for canonical order UUIDs, and prove the complete local workflow and four-role permission matrix.

**Architecture:** Keep idempotency in PostgreSQL, where every caller is covered: serialize completion per authenticated user and enforce one active application with a partial unique index. Correct the Edge Function's UUID trust-boundary validator in place and keep its regression in the existing local API smoke script. Exercise the real browser UI against local Supabase and verify outcomes independently in PostgreSQL and Mailpit.

**Tech Stack:** React 18, TypeScript, Supabase/PostgreSQL/pgTAP, Supabase Edge Functions (Deno), Bash/curl, Playwright CLI, Mailpit.

---

## File Map

- Create `supabase/migrations/20260825*_make_creator_signup_idempotent.sql`: retire legacy active duplicates, add the database invariant, and serialize the existing completion RPC.
- Create `supabase/tests/creator_signup_idempotency_test.sql`: prove repeated completion, active-row uniqueness, workspace ownership, and anonymous denial.
- Modify `supabase/functions/notify-preorder-payment/index.ts`: accept canonical `8-4-4-4-12` UUIDs.
- Modify `scripts/api-smoke-local.sh`: keep one runnable malformed/canonical UUID regression at the real Edge Function boundary.
- Create `docs/superpowers/uat/2026-08-25-full-flow-results.md`: record browser, database, Mailpit, permission, cleanup, and screenshot evidence.

### Task 1: Capture Both Failures Before Editing

**Files:**
- Inspect: `supabase/migrations/20260706100040_require_verified_email_for_creator_workspace.sql`
- Inspect: `supabase/functions/notify-preorder-payment/index.ts`
- No repository changes

- [ ] **Step 1: Reproduce the notification validator failure**

Run the local Edge Function with a canonical nonexistent UUID and a malformed value. Load the local anonymous key without printing it:

```bash
SUPABASE_ANON_KEY="$(supabase status -o env | awk -F= '/^ANON_KEY=/{gsub(/"/,"",$2); print $2}')"
curl -sS -w '\nHTTP %{http_code}\n' -X POST http://127.0.0.1:54321/functions/v1/notify-preorder-payment \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{"order_id":"00000000-0000-4000-8000-000000000001","event":"submitted"}'
curl -sS -w '\nHTTP %{http_code}\n' -X POST http://127.0.0.1:54321/functions/v1/notify-preorder-payment \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{"order_id":"not-a-uuid","event":"submitted"}'
unset SUPABASE_ANON_KEY
```

Expected before the fix: both calls return HTTP 400 with `order_id must be a valid UUID`. Expected after the fix: canonical UUID returns HTTP 404 `Order not found`; malformed input remains HTTP 400.

- [ ] **Step 2: Reproduce concurrent creator completion**

Create one disposable local auth fixture, fire two authenticated RPC transactions concurrently, query the exact UUID, and remove only that fixture:

```bash
RACE_DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
RACE_UID='f0250825-0000-4000-8000-000000000001'
RACE_CLAIMS='{"sub":"f0250825-0000-4000-8000-000000000001","email":"race-20260825@nireq.local","role":"authenticated"}'
psql "${RACE_DB_URL}" -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users (
  id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, aud, role
)
values (
  'f0250825-0000-4000-8000-000000000001',
  'race-20260825@nireq.local', 'x', now(), now(), now(), '{}',
  '{"creator_signup":"self_serve","creator_name":"Race Creator","contact_name":"Race Owner","desired_slug":"race-creator-20260825","primary_social_url":"https://example.com/race","application_note":"Concurrent signup regression fixture."}',
  'authenticated', 'authenticated'
);
SQL
(
  psql "${RACE_DB_URL}" -v ON_ERROR_STOP=1 -c "begin; set local role authenticated; set local request.jwt.claims = '${RACE_CLAIMS}'; select public.complete_verified_creator_signup(); commit;"
) &
RACE_PID_ONE=$!
(
  psql "${RACE_DB_URL}" -v ON_ERROR_STOP=1 -c "begin; set local role authenticated; set local request.jwt.claims = '${RACE_CLAIMS}'; select public.complete_verified_creator_signup(); commit;"
) &
RACE_PID_TWO=$!
wait "${RACE_PID_ONE}" "${RACE_PID_TWO}"
psql "${RACE_DB_URL}" -v ON_ERROR_STOP=1 -c "select count(*) filter (where status in ('pending','auto_approved','approved')) as active_applications from public.creator_applications where auth_user_id = '${RACE_UID}'; select count(*) as artists from public.artists where id = '${RACE_UID}'; select count(*) as owner_members from public.artist_members where artist_id = '${RACE_UID}' and role = 'owner' and status = 'active';"
psql "${RACE_DB_URL}" -v ON_ERROR_STOP=1 -c "delete from public.creator_applications where auth_user_id = '${RACE_UID}'; delete from public.artist_members where artist_id = '${RACE_UID}'; delete from public.artists where id = '${RACE_UID}'; delete from auth.users where id = '${RACE_UID}';"
unset RACE_DB_URL RACE_UID RACE_CLAIMS RACE_PID_ONE RACE_PID_TWO
```

Expected before the fix: `active_applications=2`, `artists=1`, `owner_members=1`. The script is diagnostic only and must clean its exact auth/application/workspace rows; do not commit it.

### Task 2: Add the Failing Creator Signup Regression

**Files:**
- Create: `supabase/tests/creator_signup_idempotency_test.sql`

- [ ] **Step 1: Write the pgTAP regression**

Create a transaction-scoped test with one confirmed self-serve auth user. The checks must be these exact behaviors:

```sql
begin;
select plan(9);

do $$
declare
  v_uid uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, aud, role
  )
  values (
    v_uid,
    'creator.signup.idempotency@nireq.local',
    'x', now(), now(), now(), '{}',
    '{"creator_signup":"self_serve","creator_name":"Idempotent Creator","contact_name":"Test Owner","desired_slug":"idempotent-creator-test","primary_social_url":"https://example.com/creator","application_note":"Creator signup idempotency regression."}',
    'authenticated', 'authenticated'
  );

  create temp table _creator_signup_ids (uid uuid not null);
  insert into _creator_signup_ids values (v_uid);

  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'email', 'creator.signup.idempotency@nireq.local',
      'sub', v_uid::text,
      'role', 'authenticated'
    )::text,
    true
  );
end $$;

select is(
  public.complete_verified_creator_signup() ->> 'status',
  'created',
  'first completion creates the workspace'
);
select is(
  public.complete_verified_creator_signup() ->> 'status',
  'exists',
  'repeated completion is idempotent'
);
select is((select count(*) from public.creator_applications where auth_user_id = (select uid from _creator_signup_ids) and status in ('pending','auto_approved','approved')), 1::bigint, 'one active application');
select is((select count(*) from public.artists where id = (select uid from _creator_signup_ids)), 1::bigint, 'one owned artist');
select is((select count(*) from public.artist_members where artist_id = (select uid from _creator_signup_ids) and role = 'owner' and status = 'active'), 1::bigint, 'one active owner member');
select has_index('public', 'creator_applications', 'creator_applications_active_auth_user_uidx', 'active application invariant exists');

update public.creator_applications
set status = 'rejected'
where auth_user_id = (select uid from _creator_signup_ids);
delete from public.artist_members where artist_id = (select uid from _creator_signup_ids);
delete from public.artists where id = (select uid from _creator_signup_ids);

select is(
  public.complete_verified_creator_signup() ->> 'status',
  'created',
  'rejected history permits a new active application'
);
select is(
  (select count(*) from public.creator_applications where auth_user_id = (select uid from _creator_signup_ids)),
  2::bigint,
  'reapplication preserves rejected history'
);

do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select throws_ok(
  $$ select public.complete_verified_creator_signup() $$,
  'Authentication required',
  'anonymous completion is denied'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test and verify it fails for the missing invariant**

```bash
npx supabase test db supabase/tests/creator_signup_idempotency_test.sql
```

Expected before the migration: FAIL at `has_index`; the sequential result may already be `exists` because the first call creates the artist.

### Task 3: Enforce Creator Signup Idempotency in PostgreSQL

**Files:**
- Create: `supabase/migrations/20260825*_make_creator_signup_idempotent.sql`
- Test: `supabase/tests/creator_signup_idempotency_test.sql`

- [ ] **Step 1: Check the CLI contract and generate an append-only migration**

```bash
npx supabase migration --help
npx supabase migration new make_creator_signup_idempotent
```

Expected: one new timestamped SQL file under `supabase/migrations/`; do not edit historical migrations.

- [ ] **Step 2: Retire legacy duplicates and add the native invariant**

Add this data-preserving cleanup and partial unique index before replacing the RPC:

```sql
with ranked_active_applications as (
  select id,
         row_number() over (
           partition by auth_user_id
           order by created_at, id
         ) as active_rank
  from public.creator_applications
  where auth_user_id is not null
    and status in ('pending', 'auto_approved', 'approved')
)
update public.creator_applications ca
set status = 'rejected',
    reviewed_at = coalesce(ca.reviewed_at, now()),
    review_note = 'Duplicate active self-serve application retired by signup idempotency migration.'
from ranked_active_applications ranked
where ca.id = ranked.id
  and ranked.active_rank > 1;

create unique index if not exists creator_applications_active_auth_user_uidx
  on public.creator_applications (auth_user_id)
  where auth_user_id is not null
    and status in ('pending', 'auto_approved', 'approved');
```

- [ ] **Step 3: Serialize the shared completion RPC at the root**

Copy the current `public.complete_verified_creator_signup()` body into the new migration and add this statement immediately after the `Authentication required` guard:

```sql
perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
```

Keep all existing metadata, slug, verified-email, trigger, grants, and response behavior unchanged. The first caller returns `created`; a waiting/repeated caller observes the artist and returns `exists`. The partial unique index remains the final guard for every writer.

- [ ] **Step 4: Apply locally and run the focused regression**

```bash
npx supabase migration up --local
npx supabase test db supabase/tests/creator_signup_idempotency_test.sql
```

Expected: migration succeeds and all 9 pgTAP checks pass.

- [ ] **Step 5: Re-run the concurrent diagnostic**

```bash
RACE_DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
RACE_UID='f0250825-0000-4000-8000-000000000001'
RACE_CLAIMS='{"sub":"f0250825-0000-4000-8000-000000000001","email":"race-20260825@nireq.local","role":"authenticated"}'
psql "${RACE_DB_URL}" -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users (
  id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, aud, role
)
values (
  'f0250825-0000-4000-8000-000000000001',
  'race-20260825@nireq.local', 'x', now(), now(), now(), '{}',
  '{"creator_signup":"self_serve","creator_name":"Race Creator","contact_name":"Race Owner","desired_slug":"race-creator-20260825","primary_social_url":"https://example.com/race","application_note":"Concurrent signup regression fixture."}',
  'authenticated', 'authenticated'
);
SQL
(
  psql "${RACE_DB_URL}" -v ON_ERROR_STOP=1 -c "begin; set local role authenticated; set local request.jwt.claims = '${RACE_CLAIMS}'; select public.complete_verified_creator_signup(); commit;"
) &
RACE_PID_ONE=$!
(
  psql "${RACE_DB_URL}" -v ON_ERROR_STOP=1 -c "begin; set local role authenticated; set local request.jwt.claims = '${RACE_CLAIMS}'; select public.complete_verified_creator_signup(); commit;"
) &
RACE_PID_TWO=$!
wait "${RACE_PID_ONE}" "${RACE_PID_TWO}"
psql "${RACE_DB_URL}" -v ON_ERROR_STOP=1 -c "select count(*) filter (where status in ('pending','auto_approved','approved')) as active_applications from public.creator_applications where auth_user_id = '${RACE_UID}'; select count(*) as artists from public.artists where id = '${RACE_UID}'; select count(*) as owner_members from public.artist_members where artist_id = '${RACE_UID}' and role = 'owner' and status = 'active';"
psql "${RACE_DB_URL}" -v ON_ERROR_STOP=1 -c "delete from public.creator_applications where auth_user_id = '${RACE_UID}'; delete from public.artist_members where artist_id = '${RACE_UID}'; delete from public.artists where id = '${RACE_UID}'; delete from auth.users where id = '${RACE_UID}';"
unset RACE_DB_URL RACE_UID RACE_CLAIMS RACE_PID_ONE RACE_PID_TWO
```

Expected after the fix: the two responses contain one `created` and one `exists`; `active_applications=1`, `artists=1`, `owner_members=1`; exact disposable rows are removed.

- [ ] **Step 6: Commit the database change**

```bash
git add supabase/migrations/*_make_creator_signup_idempotent.sql supabase/tests/creator_signup_idempotency_test.sql
git commit -m "fix: make creator signup completion idempotent"
```

### Task 4: Fix and Lock the Notification UUID Boundary

**Files:**
- Modify: `scripts/api-smoke-local.sh`
- Modify: `supabase/functions/notify-preorder-payment/index.ts:444`

- [ ] **Step 1: Add the real-boundary API assertions**

Add a reusable status/body assertion beside `assert_2xx`:

```bash
assert_status_and_body() {
  local code="$1"
  local expected_code="$2"
  local expected_body="$3"
  local name="$4"
  if [[ "${code}" != "${expected_code}" ]] || ! grep -Fq "${expected_body}" /tmp/api_smoke_resp.txt; then
    echo "[FAIL] ${name} (HTTP ${code})"
    cat /tmp/api_smoke_resp.txt
    exit 1
  fi
  echo "[PASS] ${name}"
}
```

Add these requests after REST health and before storage mutation:

```bash
code="$(request_code -X POST "${API_URL}/functions/v1/notify-preorder-payment" \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"order_id":"00000000-0000-4000-8000-000000000001","event":"submitted"}')"
assert_status_and_body "${code}" "404" '"error":"Order not found"' "Notification accepts canonical UUID"

code="$(request_code -X POST "${API_URL}/functions/v1/notify-preorder-payment" \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"order_id":"not-a-uuid","event":"submitted"}')"
assert_status_and_body "${code}" "400" '"error":"order_id must be a valid UUID"' "Notification rejects malformed UUID"
```

- [ ] **Step 2: Run the focused smoke and verify the canonical assertion fails**

```bash
npm run test:api:smoke
```

Expected before the code fix: FAIL `Notification accepts canonical UUID (HTTP 400)`.

- [ ] **Step 3: Correct the existing one-line validator**

```ts
function isUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
```

- [ ] **Step 4: Re-run the focused smoke**

```bash
npm run test:api:smoke
```

Expected: canonical nonexistent UUID passes validation and reaches `Order not found` with HTTP 404; malformed remains HTTP 400; all existing health/storage checks pass.

- [ ] **Step 5: Commit the Edge Function regression**

```bash
git add scripts/api-smoke-local.sh supabase/functions/notify-preorder-payment/index.ts
git commit -m "fix: accept canonical preorder notification UUIDs"
```

### Task 5: Run Focused Security and Release Verification

**Files:**
- Verify only

- [ ] **Step 1: Run database regressions for auth, roles, stock, preorder, and post-order**

```bash
npx supabase test db \
  supabase/tests/creator_signup_idempotency_test.sql \
  supabase/tests/team_invitations_test.sql \
  supabase/tests/stock_adjustment_flows_test.sql \
  supabase/tests/preorder_pickup_mvp_test.sql \
  supabase/tests/production_security_regression_test.sql
```

Expected: every pgTAP file passes with no failed assertions.

- [ ] **Step 2: Run browser security regressions and the repository gate**

```bash
npm run test:security
npm run verify
```

Expected: security Playwright specs pass; lint, build, public i18n smoke, API smoke, and release hygiene all pass.

### Task 6: Execute the Real Full-Flow UAT

**Files:**
- Create: `docs/superpowers/uat/2026-08-25-full-flow-results.md`
- Create evidence: `output/playwright/full-flow-20260825/*.png`

- [ ] **Step 1: Verify Playwright CLI availability and start the local app**

```bash
npx playwright --version
npm run dev -- --host 127.0.0.1
```

Expected: Playwright prints a version and Vite serves the local app. Use `/Users/kongzas/.codex/skills/playwright/scripts/playwright_cli.sh`; keep screenshots under `output/playwright/full-flow-20260825/`.

- [ ] **Step 2: Create owner workspace, stock, and three lifecycle events through UI**

Use unique `uat-20260825-*` emails/slugs/names. Create one finite-stock product and one unlimited product in Catalog. Create:

```text
Future event: starts after 2026-08-25; preorder enabled.
Live event: includes 2026-08-25; queue and POS enabled.
Past event: ended before 2026-08-25; post-order enabled with an open sales window.
```

Allocate finite and unlimited catalog stock into each applicable event through Event Catalog. Screenshot global stock, each event allocation, and the no-stock state after reservations consume the finite quantity.

- [ ] **Step 3: Complete future-event preorder branches**

Through the public event page and creator dashboard, execute three independent orders:

```text
cancel branch: reserve -> upload evidence -> customer cancel -> stock released
reject branch: reserve -> upload evidence -> staff reject -> stock released
pickup branch: reserve -> upload evidence -> seller confirm -> mark picked up -> stock sold
```

After each transition, query the exact order, payment, event product, and stock ledger rows by the UAT IDs. Confirm Mailpit has `submitted`, `confirmed`, and `rejected` messages and no duplicate delivery row per delivery key.

- [ ] **Step 4: Complete live-event queue and POS branches**

Join the public queue, then as authorized staff progress `waiting -> called -> arrived -> completed`. Create both a queue-linked POS sale and a walk-in POS sale. Prove finite-stock decrement, unlimited-stock sale, and out-of-stock rejection through UI; verify order, queue, order item, and stock ledger records in PostgreSQL.

- [ ] **Step 5: Complete past-event post-order shipping**

Place a post-order through the public page, submit payment evidence, confirm it as authorized staff, enter shipping/tracking data, and verify the customer tracking page. Confirm the expected evidence/payment email in Mailpit; shipped state is evidenced on the customer page because no shipped-email feature exists.

- [ ] **Step 6: Invite and activate all staff roles**

As owner, invite one manager without event restriction and one seller plus one queue staff restricted to the live event. Open each Mailpit invitation link, activate the local account, and sign in. Verify Mailpit invitation messages exist once per invited address.

- [ ] **Step 7: Prove the positive and negative permission matrix**

Record a pass/fail row for every check below, using both visible navigation and direct URL/API denial where applicable:

```text
owner +: team, profile, catalog, every event, payments, queue, POS, pickup, shipping
owner -: cannot mutate a different creator workspace
manager +: profile, catalog, dashboard, every event, payments, queue, POS, pickup
manager -: team management; different creator workspace
seller +: assigned live-event queue, POS, payment review, pickup, shipping
seller -: team, workspace/catalog/event management, unassigned future/past events
queue_staff +: assigned live-event queue operation and mark pickup
queue_staff -: POS, payment review, preorder cancel/expiry, management, team, unassigned events
```

For each denied action, require a disabled/absent control, redirect, HTTP 401/403, or RPC `permission denied`; merely skipping the screen is not evidence.

- [ ] **Step 8: Write the evidence report and clean only UAT data**

In `docs/superpowers/uat/2026-08-25-full-flow-results.md`, include exact UAT identifiers, screen route, expected/actual outcome, database query result, Mailpit subject/message ID, screenshot path, and any defect. Delete only rows/files/accounts with the unique `uat-20260825-*` identifiers in dependency order, then query each exact ID again and record zero remaining rows. Close Playwright browser sessions and stop Vite; do not touch production or remote Supabase.

### Task 7: Fresh-Diff Review and Final Verification

**Files:**
- Review all task files while preserving pre-existing worktree changes

- [ ] **Step 1: Review the scoped diff once**

```bash
git diff --check
git diff -- supabase/migrations supabase/tests/creator_signup_idempotency_test.sql scripts/api-smoke-local.sh supabase/functions/notify-preorder-payment/index.ts docs/superpowers/uat/2026-08-25-full-flow-results.md
```

Expected: no whitespace errors; no credential, remote migration, unrelated-file, or unrequested abstraction changes.

- [ ] **Step 2: Fix only confirmed findings and run the complete gate again**

```bash
npm run verify
npx supabase test db
```

Expected: repository verification and the full local pgTAP suite pass. If a check cannot run, record it explicitly as skipped with the environment reason.

- [ ] **Step 3: Commit the UAT evidence if it contains no local credentials or personal data**

```bash
git add docs/superpowers/uat/2026-08-25-full-flow-results.md
git commit -m "test: document full lifecycle role UAT"
```
