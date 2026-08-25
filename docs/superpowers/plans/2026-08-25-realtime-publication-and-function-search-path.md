# Realtime Publication and Function Search Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Include the missing Realtime publication change in the release and eliminate the six current mutable function `search_path` warnings without changing application behavior.

**Architecture:** Keep Realtime publication and function hardening in separate append-only migrations. Verify each concern with a focused pgTAP test, then run the full local database, security, and repository release gates. Production remains untouched.

**Tech Stack:** PostgreSQL migrations, Supabase CLI, Supabase Realtime Postgres Changes, pgTAP, npm release scripts

---

## File Map

- `supabase/migrations/20260825030753_enable_realtime_subscribed_tables.sql`: conditionally publishes the four application tables currently missing from `supabase_realtime`.
- `supabase/tests/realtime_publication_test.sql`: verifies every subscribed table is published and retains RLS.
- `supabase/migrations/20260825080650_harden_function_search_paths.sql`: pins an empty search path for the six functions reported by the local advisor while preserving currency validation.
- `supabase/tests/function_search_path_security_test.sql`: verifies the six exact function signatures and the mixed-currency rejection behavior.

### Task 1: Validate and commit the Realtime publication change

**Files:**
- Create: `supabase/migrations/20260825030753_enable_realtime_subscribed_tables.sql`
- Create: `supabase/tests/realtime_publication_test.sql`

- [ ] **Step 1: Review the existing migration against actual subscriptions**

Run:

```bash
rg -n "postgres_changes" src
sed -n '1,160p' supabase/migrations/20260825030753_enable_realtime_subscribed_tables.sql
```

Expected: the union of subscribed tables is `artist_promotions`, `artists`, `event_products`, `events`, `order_payments`, `orders`, `products`, and `queues`; the migration conditionally adds the four missing tables only.

- [ ] **Step 2: Run the focused publication test**

Run:

```bash
supabase test db supabase/tests/realtime_publication_test.sql
```

Expected: 2 tests pass—every subscribed table is published and every published application table has RLS enabled.

- [ ] **Step 3: Commit only the Realtime migration and test**

```bash
git add supabase/migrations/20260825030753_enable_realtime_subscribed_tables.sql supabase/tests/realtime_publication_test.sql
git commit -m "fix: publish subscribed realtime tables"
```

### Task 2: Add a failing function search-path security test

**Files:**
- Create: `supabase/tests/function_search_path_security_test.sql`

- [ ] **Step 1: Write the focused pgTAP test**

```sql
begin;

select plan(2);

with expected(signature) as (
  values
    ('public.update_last_updated_at_column()'),
    ('public.update_last_updated_column()'),
    ('public.update_updated_at_column()'),
    ('public.check_active_currency_consistency()'),
    ('public.set_updated_at_timestamp()'),
    ('public.normalize_artist_role(text)')
)
select is(
  (
    select count(*)
    from expected e
    join pg_proc p on p.oid = to_regprocedure(e.signature)
    where 'search_path=""' = any(coalesce(p.proconfig, array[]::text[]))
  ),
  6::bigint,
  'all advisor-reported functions pin an empty search path'
);

do $$
declare
  v_artist_id uuid := gen_random_uuid();
begin
  insert into public.artists (id, slug, display_name)
  values (v_artist_id, 'search-path-currency-test', 'Search Path Currency Test');

  insert into public.products (
    artist_id, name, price, status, currency, is_unlimited
  ) values (
    v_artist_id, 'THB Product', 100, 'enable', 'THB', true
  );

  create temp table _search_path_test_artist (artist_id uuid) on commit drop;
  insert into _search_path_test_artist values (v_artist_id);
end $$;

select throws_ok(
  $$
    insert into public.products (
      artist_id, name, price, status, currency, is_unlimited
    ) values (
      (select artist_id from _search_path_test_artist),
      'USD Product', 10, 'enable', 'USD', true
    )
  $$,
  'P0001',
  'Conflict Currency: ร้านนี้มีเมนูที่ขายเป็นสกุลเงิน THB อยู่แล้ว ไม่สามารถเปิดขายเมนูที่เป็น USD ผสมกันได้',
  'currency consistency still rejects mixed active currencies'
);

select * from finish();

rollback;
```

- [ ] **Step 2: Run the test and confirm the configuration assertion fails**

Run:

```bash
supabase test db supabase/tests/function_search_path_security_test.sql
```

Expected: the first assertion fails because none of the six functions currently has `search_path=""`; the currency behavior assertion passes.

### Task 3: Add the append-only function hardening migration

**Files:**
- Create: `supabase/migrations/20260825080650_harden_function_search_paths.sql`
- Test: `supabase/tests/function_search_path_security_test.sql`

- [ ] **Step 1: Create a migration through the Supabase CLI**

Run:

```bash
supabase migration new harden_function_search_paths
```

Expected: the CLI creates a timestamped migration under `supabase/migrations/`. Rename the empty generated file to `20260825080650_harden_function_search_paths.sql` before adding content so the reviewed plan and repository path match.

- [ ] **Step 2: Implement the minimal security hardening**

```sql
alter function public.update_last_updated_at_column() set search_path = '';
alter function public.update_last_updated_column() set search_path = '';
alter function public.update_updated_at_column() set search_path = '';
alter function public.set_updated_at_timestamp() set search_path = '';
alter function public.normalize_artist_role(text) set search_path = '';

create or replace function public.check_active_currency_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  current_active_currency text;
begin
  if new.status in ('enable', 'soldout') then
    select p.currency into current_active_currency
    from public.products p
    where p.artist_id = new.artist_id
      and p.status in ('enable', 'soldout')
      and p.id != new.id
    limit 1;

    if current_active_currency is not null
      and current_active_currency != new.currency then
      raise exception 'Conflict Currency: ร้านนี้มีเมนูที่ขายเป็นสกุลเงิน % อยู่แล้ว ไม่สามารถเปิดขายเมนูที่เป็น % ผสมกันได้',
        current_active_currency,
        new.currency;
    end if;
  end if;

  return new;
end;
$$;
```

- [ ] **Step 3: Apply pending migrations locally**

Run:

```bash
supabase migration up --local
```

Expected: `20260825080650_harden_function_search_paths.sql` is applied successfully.

- [ ] **Step 4: Run the focused test again**

Run:

```bash
supabase test db supabase/tests/function_search_path_security_test.sql
```

Expected: both tests pass.

- [ ] **Step 5: Run the local security advisor**

Run:

```bash
supabase db advisors --local --type security --level warn
```

Expected: no `function_search_path_mutable` findings remain.

- [ ] **Step 6: Commit the security migration and test**

```bash
git add supabase/migrations/20260825080650_harden_function_search_paths.sql supabase/tests/function_search_path_security_test.sql
git commit -m "fix: pin database function search paths"
```

### Task 4: Run release verification and review the final diff

**Files:**
- Verify only; do not stage unrelated files.

- [ ] **Step 1: Run the complete local database suite**

Run:

```bash
supabase test db
```

Expected: all pgTAP files pass.

- [ ] **Step 2: Run the authorization/security regression suite**

Run:

```bash
npm run test:security
```

Expected: all security tests pass.

- [ ] **Step 3: Run the repository release gate**

Run:

```bash
npm run verify
```

Expected: lint, release checks, build, browser smoke, and API smoke pass.

- [ ] **Step 4: Review only the approved commits and confirm unrelated work remains untouched**

Run:

```bash
git show --stat --oneline HEAD~2..HEAD
git status --short
git diff -- src/tests/regression/preorder-pickup.spec.ts
```

Expected: the two implementation commits contain only the approved migrations/tests; `src/tests/regression/preorder-pickup.spec.ts` remains modified and unstaged with its original user changes.
