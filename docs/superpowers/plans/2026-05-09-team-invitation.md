# Team Invitation Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a practical team invitation flow so booth owners can invite staff by email before those staff accounts exist in Supabase Auth.

**Architecture:** A new `artist_member_invitations` table holds pending invites separate from `artist_members`. Six security-definer RPCs gate all mutations. A new `notify-team-invitation` edge function emails the invitee. On login, `list_my_pending_invitations()` drives a `PendingInvitationBanner`; acceptance is explicit via `accept_team_invitation()`.

**Tech Stack:** PostgreSQL 15 (pgTAP for tests), Supabase Edge Functions (Deno/TypeScript), React 18 + TypeScript, Supabase JS v2, TailwindCSS, Lucide React.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/20260509220000_team_invitations.sql` | Create | Table, indexes, trigger, RLS, all 6 RPCs |
| `supabase/tests/team_invitations_test.sql` | Create | pgTAP — 18 test cases |
| `supabase/functions/notify-team-invitation/index.ts` | Create | Email edge function |
| `src/pages/creators/ManageTeam.tsx` | Modify | Invite form + Pending Invitations section |
| `src/components/PendingInvitationBanner.tsx` | Create | Login-time accept banner |
| `src/pages/InvitationsPage.tsx` | Create | `/invitations` settings page |
| `src/App.tsx` | Modify | Mount banner, add route, load invitations in auth cycle |

---

## Task 1: Database migration — table, indexes, trigger, RLS

**Files:**
- Create: `supabase/migrations/20260509220000_team_invitations.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260509220000_team_invitations.sql

-- ─── Table ────────────────────────────────────────────────────────────────────

create table public.artist_member_invitations (
  id            uuid        primary key default gen_random_uuid(),
  artist_id     uuid        not null references public.artists(id) on delete cascade,
  invited_email text        not null,
  role          text        not null check (role in ('manager', 'seller', 'queue_staff')),
  invited_by    uuid        references auth.users(id),
  status        text        not null default 'pending'
                            check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  invited_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  declined_at   timestamptz,
  cancelled_at  timestamptz,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Prevents duplicate pending invites; allows clean re-invite after cancel
create unique index artist_member_invitations_pending_uidx
  on public.artist_member_invitations (artist_id, lower(invited_email))
  where status = 'pending';

-- Fast lookup when a user logs in and checks for their invitations
create index artist_member_invitations_email_idx
  on public.artist_member_invitations (lower(invited_email));

-- ─── updated_at trigger ───────────────────────────────────────────────────────

-- Reuse the existing set_updated_at_timestamp() function
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_artist_member_invitations_updated_at'
  ) then
    create trigger trg_artist_member_invitations_updated_at
      before update on public.artist_member_invitations
      for each row execute function public.set_updated_at_timestamp();
  end if;
end $$;

-- ─── RLS ──────────────────────────────────────────────────────────────────────

-- Enable RLS; all access is through security-definer RPCs (no direct client writes)
alter table public.artist_member_invitations enable row level security;
```

- [ ] **Step 2: Apply the migration**

```bash
npx supabase db reset
```

Expected: migration applied with no errors. All existing migrations re-run cleanly.

- [ ] **Step 3: Verify table exists**

```bash
docker exec supabase_db_EventWebQueue psql -U postgres -d postgres \
  -c "\d public.artist_member_invitations"
```

Expected: table columns and constraints listed, including `status` check constraint and both indexes.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260509220000_team_invitations.sql
git commit -m "feat: add artist_member_invitations table with RLS"
```

---

## Task 2: Database migration — all 6 RPCs

**Files:**
- Modify: `supabase/migrations/20260509220000_team_invitations.sql` (append to same file)

- [ ] **Step 1: Append all 6 RPCs to the migration file**

```sql
-- ─── RPC: invite_team_member ──────────────────────────────────────────────────
-- Called by owner/manager from ManageTeam.
-- Returns: { result, invitation_id? }
-- result values: member_added | invitation_sent | already_member | already_invited

create or replace function public.invite_team_member(
  p_artist_id uuid,
  p_email     text,
  p_role      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email          text;
  v_invitation_id  uuid;
  v_rows_inserted  int;
begin
  -- Permission check
  if not public.has_artist_role(p_artist_id, array['owner', 'manager']) then
    raise exception 'permission denied';
  end if;

  -- Normalize
  v_email := lower(trim(p_email));

  -- Validate role
  if p_role not in ('manager', 'seller', 'queue_staff') then
    raise exception 'invalid role: %', p_role;
  end if;

  -- Already an active member?
  if exists (
    select 1 from public.artist_members
    where artist_id = p_artist_id
      and lower(member_email) = v_email
      and status = 'active'
  ) then
    return jsonb_build_object('result', 'already_member');
  end if;

  -- Already a pending invitation?
  if exists (
    select 1 from public.artist_member_invitations
    where artist_id = p_artist_id
      and lower(invited_email) = v_email
      and status = 'pending'
  ) then
    return jsonb_build_object('result', 'already_invited');
  end if;

  -- User exists in auth? → add as active member immediately
  if exists (select 1 from auth.users where lower(email) = v_email) then
    insert into public.artist_members (artist_id, member_email, role, status, created_by)
    values (p_artist_id, v_email, p_role, 'active', auth.uid())
    on conflict do nothing;
    return jsonb_build_object('result', 'member_added');
  end if;

  -- User does not exist → create pending invitation (handle race via ON CONFLICT)
  insert into public.artist_member_invitations
    (artist_id, invited_email, role, invited_by)
  values
    (p_artist_id, v_email, p_role, auth.uid())
  on conflict do nothing
  returning id into v_invitation_id;

  get diagnostics v_rows_inserted = row_count;

  if v_rows_inserted = 0 then
    -- Race condition: another concurrent call already created it
    return jsonb_build_object('result', 'already_invited');
  end if;

  return jsonb_build_object('result', 'invitation_sent', 'invitation_id', v_invitation_id);
end;
$$;


-- ─── RPC: list_team_invitations ───────────────────────────────────────────────
-- Returns pending invitations for an artist. Owner/manager only.

create or replace function public.list_team_invitations(p_artist_id uuid)
returns table(
  id            uuid,
  invited_email text,
  role          text,
  invited_at    timestamptz,
  expires_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_artist_role(p_artist_id, array['owner', 'manager']) then
    raise exception 'permission denied';
  end if;

  return query
    select i.id, i.invited_email, i.role, i.invited_at, i.expires_at
    from public.artist_member_invitations i
    where i.artist_id = p_artist_id
      and i.status = 'pending'
    order by i.invited_at asc;
end;
$$;


-- ─── RPC: cancel_team_invitation ─────────────────────────────────────────────
-- Owner/manager cancels a pending invitation.

create or replace function public.cancel_team_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_artist_id uuid;
  v_status    text;
begin
  select artist_id, status
  into v_artist_id, v_status
  from public.artist_member_invitations
  where id = p_invitation_id;

  if not found then
    raise exception 'invitation not found';
  end if;

  if not public.has_artist_role(v_artist_id, array['owner', 'manager']) then
    raise exception 'permission denied';
  end if;

  if v_status != 'pending' then
    raise exception 'invitation is not pending (current status: %)', v_status;
  end if;

  update public.artist_member_invitations
  set status       = 'cancelled',
      cancelled_at = now(),
      updated_at   = now()
  where id = p_invitation_id;

  return jsonb_build_object('result', 'cancelled');
end;
$$;


-- ─── RPC: list_my_pending_invitations ─────────────────────────────────────────
-- Read-only. Returns pending, non-expired invitations for the authenticated user's email.

create or replace function public.list_my_pending_invitations()
returns table(
  id          uuid,
  artist_id   uuid,
  artist_name text,
  role        text,
  invited_at  timestamptz,
  expires_at  timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if v_email = '' then
    return;
  end if;

  return query
    select
      i.id,
      i.artist_id,
      coalesce(a.creator_name, 'Unknown Booth') as artist_name,
      i.role,
      i.invited_at,
      i.expires_at
    from public.artist_member_invitations i
    join public.artists a on a.id = i.artist_id
    where lower(i.invited_email) = v_email
      and i.status = 'pending'
      and (i.expires_at is null or i.expires_at > now())
    order by i.invited_at asc;
end;
$$;


-- ─── RPC: accept_team_invitation ─────────────────────────────────────────────
-- Called when invitee explicitly clicks Accept.
-- Returns: { result: 'accepted' | 'accepted_existing_member' }

create or replace function public.accept_team_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email         text;
  v_invitation    record;
  v_rows_inserted int;
begin
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if v_email = '' then
    raise exception 'not authenticated';
  end if;

  select * into v_invitation
  from public.artist_member_invitations
  where id = p_invitation_id;

  if not found then
    raise exception 'invitation not found';
  end if;

  if lower(v_invitation.invited_email) != v_email then
    raise exception 'permission denied';
  end if;

  if v_invitation.status != 'pending' then
    raise exception 'invitation is not pending (current status: %)', v_invitation.status;
  end if;

  if v_invitation.expires_at is not null and v_invitation.expires_at <= now() then
    raise exception 'invitation has expired';
  end if;

  -- Insert active member; silent no-op if already exists
  insert into public.artist_members (artist_id, member_email, role, status, created_by)
  values (v_invitation.artist_id, v_email, v_invitation.role, 'active', v_invitation.invited_by)
  on conflict (artist_id, lower(member_email)) do nothing;

  get diagnostics v_rows_inserted = row_count;

  -- Mark invitation accepted regardless of whether member row was new
  update public.artist_member_invitations
  set status      = 'accepted',
      accepted_at = now(),
      updated_at  = now()
  where id = p_invitation_id;

  if v_rows_inserted = 0 then
    return jsonb_build_object('result', 'accepted_existing_member');
  end if;

  return jsonb_build_object('result', 'accepted');
end;
$$;


-- ─── RPC: decline_team_invitation ────────────────────────────────────────────
-- Called only from /invitations settings page (not the login banner).

create or replace function public.decline_team_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email      text;
  v_invitation record;
begin
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if v_email = '' then
    raise exception 'not authenticated';
  end if;

  select * into v_invitation
  from public.artist_member_invitations
  where id = p_invitation_id;

  if not found then
    raise exception 'invitation not found';
  end if;

  if lower(v_invitation.invited_email) != v_email then
    raise exception 'permission denied';
  end if;

  if v_invitation.status != 'pending' then
    raise exception 'invitation is not pending (current status: %)', v_invitation.status;
  end if;

  update public.artist_member_invitations
  set status      = 'declined',
      declined_at = now(),
      updated_at  = now()
  where id = p_invitation_id;

  return jsonb_build_object('result', 'declined');
end;
$$;
```

- [ ] **Step 2: Apply migration**

```bash
npx supabase db reset
```

Expected: all migrations apply cleanly, no errors.

- [ ] **Step 3: Smoke test RPCs exist**

```bash
docker exec supabase_db_EventWebQueue psql -U postgres -d postgres \
  -c "SELECT proname FROM pg_proc WHERE proname IN (
    'invite_team_member','list_team_invitations','cancel_team_invitation',
    'list_my_pending_invitations','accept_team_invitation','decline_team_invitation'
  ) ORDER BY proname;"
```

Expected: 6 rows returned, one per function.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260509220000_team_invitations.sql
git commit -m "feat: add team invitation RPCs (invite, list, cancel, accept, decline)"
```

---

## Task 3: pgTAP tests

**Files:**
- Create: `supabase/tests/team_invitations_test.sql`

- [ ] **Step 1: Create the test file**

```sql
-- supabase/tests/team_invitations_test.sql
begin;
select plan(18);

-- ─── Fixtures ─────────────────────────────────────────────────────────────────

-- We need: an artist (workspace owner), an owner user, a manager user, a
-- queue_staff user (unauthorized), and two email addresses — one that exists
-- in auth and one that does not.

-- Use pgTAP helper to set auth context: set_config('request.jwt.claims', ...)
-- Supabase local dev exposes auth.uid() / auth.jwt() from request headers.
-- We simulate this with set_config.

-- Create a test artist and auth users
do $$
declare
  v_owner_id   uuid := gen_random_uuid();
  v_manager_id uuid := gen_random_uuid();
  v_staff_id   uuid := gen_random_uuid();
  v_artist_id  uuid;
begin
  -- Insert auth users (local dev allows direct inserts into auth.users)
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (v_owner_id,   'test.owner@nireq.local',   'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_manager_id, 'test.manager@nireq.local',  'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_staff_id,   'test.staff@nireq.local',    'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated');

  -- Create artist (owner = v_owner_id)
  insert into public.artists (id, creator_name)
  values (v_owner_id, 'Test Booth')
  returning id into v_artist_id;

  -- Seed owner row in artist_members
  insert into public.artist_members (artist_id, member_email, role, status)
  values (v_owner_id, 'test.owner@nireq.local', 'owner', 'active');

  -- Seed manager row
  insert into public.artist_members (artist_id, member_email, role, status)
  values (v_owner_id, 'test.manager@nireq.local', 'manager', 'active');

  -- Seed staff row (unauthorized for team management)
  insert into public.artist_members (artist_id, member_email, role, status)
  values (v_owner_id, 'test.staff@nireq.local', 'queue_staff', 'active');

  -- Store IDs for use in tests via temp table
  create temp table _test_ids (owner_id uuid, manager_id uuid, staff_id uuid, artist_id uuid);
  insert into _test_ids values (v_owner_id, v_manager_id, v_staff_id, v_owner_id);
end $$;

-- Helper: set JWT context to simulate a logged-in user
create or replace function set_jwt_email(p_email text) returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('email', p_email)::text, true);
end;
$$ language plpgsql;

-- ─── Tests ────────────────────────────────────────────────────────────────────

-- Test 1: Owner invites email that exists in auth → member_added
do $$ begin perform set_jwt_email('test.owner@nireq.local'); end $$;
select results_eq(
  $$ select (public.invite_team_member(
       (select artist_id from _test_ids),
       'test.staff.existing@nireq.local', 'queue_staff'
     ) ->> 'result')::text $$,
  $$ values ('member_added') $$,
  'Test 1: invite existing auth user → member_added'
);
-- (test.staff.existing@nireq.local was inserted in auth.users fixture above)

-- Test 2: Owner invites email not in auth → invitation_sent
select results_eq(
  $$ select (public.invite_team_member(
       (select artist_id from _test_ids),
       'newstaff@external.com', 'queue_staff'
     ) ->> 'result')::text $$,
  $$ values ('invitation_sent') $$,
  'Test 2: invite non-existing user → invitation_sent'
);

-- Test 3: Duplicate pending invite → already_invited
select results_eq(
  $$ select (public.invite_team_member(
       (select artist_id from _test_ids),
       'newstaff@external.com', 'queue_staff'
     ) ->> 'result')::text $$,
  $$ values ('already_invited') $$,
  'Test 3: duplicate pending invite → already_invited'
);

-- Test 4: Invite existing active member → already_member
select results_eq(
  $$ select (public.invite_team_member(
       (select artist_id from _test_ids),
       'test.staff@nireq.local', 'queue_staff'
     ) ->> 'result')::text $$,
  $$ values ('already_member') $$,
  'Test 4: invite existing active member → already_member'
);

-- Test 5: Manager can invite
do $$ begin perform set_jwt_email('test.manager@nireq.local'); end $$;
select results_eq(
  $$ select (public.invite_team_member(
       (select artist_id from _test_ids),
       'mgr.invite@external.com', 'seller'
     ) ->> 'result')::text $$,
  $$ values ('invitation_sent') $$,
  'Test 5: manager can invite → invitation_sent'
);

-- Test 6: queue_staff cannot invite → exception
do $$ begin perform set_jwt_email('test.staff@nireq.local'); end $$;
select throws_ok(
  $$ select public.invite_team_member(
       (select artist_id from _test_ids),
       'hacker@external.com', 'queue_staff'
     ) $$,
  'permission denied',
  'Test 6: queue_staff cannot invite → permission denied'
);

-- Test 7: Owner cancels pending invitation → cancelled
do $$ begin perform set_jwt_email('test.owner@nireq.local'); end $$;
select results_eq(
  $$ select (public.cancel_team_invitation(
       (select id from public.artist_member_invitations
        where lower(invited_email) = 'newstaff@external.com'
          and status = 'pending'
        limit 1)
     ) ->> 'result')::text $$,
  $$ values ('cancelled') $$,
  'Test 7: cancel pending invitation → cancelled'
);

-- Test 8: Cannot cancel already-cancelled invitation → exception
select throws_ok(
  $$ select public.cancel_team_invitation(
       (select id from public.artist_member_invitations
        where lower(invited_email) = 'newstaff@external.com'
          and status = 'cancelled'
        limit 1)
     ) $$,
  null,
  'Test 8: cancel non-pending invitation → exception'
);

-- Test 9: Invitee lists their pending invitations
do $$ begin perform set_jwt_email('mgr.invite@external.com'); end $$;
select ok(
  (select count(*) from public.list_my_pending_invitations()) = 1,
  'Test 9: invitee sees their pending invitation'
);

-- Test 10: Invitee accepts pending invitation → accepted
select results_eq(
  $$ select (public.accept_team_invitation(
       (select id from public.artist_member_invitations
        where lower(invited_email) = 'mgr.invite@external.com'
          and status = 'pending'
        limit 1)
     ) ->> 'result')::text $$,
  $$ values ('accepted') $$,
  'Test 10: accept pending invitation → accepted'
);

-- Verify artist_members row created
select ok(
  exists(select 1 from public.artist_members
         where lower(member_email) = 'mgr.invite@external.com'
           and status = 'active'),
  'Test 10b: artist_members row created after accept'
);

-- Test 11: Accept expired invitation → exception
do $$ begin perform set_jwt_email('test.owner@nireq.local'); end $$;
-- Create an expired invitation
insert into public.artist_member_invitations (artist_id, invited_email, role, expires_at)
values ((select artist_id from _test_ids), 'expired@external.com', 'queue_staff', now() - interval '1 day');

do $$ begin perform set_jwt_email('expired@external.com'); end $$;
select throws_ok(
  $$ select public.accept_team_invitation(
       (select id from public.artist_member_invitations
        where lower(invited_email) = 'expired@external.com'
        limit 1)
     ) $$,
  'invitation has expired',
  'Test 11: accept expired invitation → exception'
);

-- Test 12: Accept already-accepted invitation → accepted_existing_member
do $$ begin perform set_jwt_email('mgr.invite@external.com'); end $$;
-- Re-insert a pending invitation for the already-accepted user (bypass unique index via direct insert)
insert into public.artist_member_invitations (artist_id, invited_email, role)
values ((select artist_id from _test_ids), 'mgr.invite@external.com', 'seller');

select results_eq(
  $$ select (public.accept_team_invitation(
       (select id from public.artist_member_invitations
        where lower(invited_email) = 'mgr.invite@external.com'
          and status = 'pending'
        limit 1)
     ) ->> 'result')::text $$,
  $$ values ('accepted_existing_member') $$,
  'Test 12: accept when already a member → accepted_existing_member'
);

-- Test 13: Invitee declines from settings page → declined
do $$ begin perform set_jwt_email('test.owner@nireq.local'); end $$;
-- Create fresh pending invitation to decline
insert into public.artist_member_invitations (artist_id, invited_email, role)
values ((select artist_id from _test_ids), 'decliner@external.com', 'queue_staff');

do $$ begin perform set_jwt_email('decliner@external.com'); end $$;
select results_eq(
  $$ select (public.decline_team_invitation(
       (select id from public.artist_member_invitations
        where lower(invited_email) = 'decliner@external.com'
          and status = 'pending'
        limit 1)
     ) ->> 'result')::text $$,
  $$ values ('declined') $$,
  'Test 13: decline invitation → declined'
);

-- Test 14: Wrong user cannot accept another's invitation → exception
do $$ begin perform set_jwt_email('test.owner@nireq.local'); end $$;
insert into public.artist_member_invitations (artist_id, invited_email, role)
values ((select artist_id from _test_ids), 'victim@external.com', 'queue_staff');

do $$ begin perform set_jwt_email('attacker@nireq.local'); end $$;
select throws_ok(
  $$ select public.accept_team_invitation(
       (select id from public.artist_member_invitations
        where lower(invited_email) = 'victim@external.com'
          and status = 'pending'
        limit 1)
     ) $$,
  'permission denied',
  'Test 14: wrong user cannot accept another invitation → permission denied'
);

-- Test 15: Wrong user cannot decline another's invitation → exception
select throws_ok(
  $$ select public.decline_team_invitation(
       (select id from public.artist_member_invitations
        where lower(invited_email) = 'victim@external.com'
          and status = 'pending'
        limit 1)
     ) $$,
  'permission denied',
  'Test 15: wrong user cannot decline another invitation → permission denied'
);

-- Test 16: Re-invite after cancel → new pending row, old cancelled preserved
do $$ begin perform set_jwt_email('test.owner@nireq.local'); end $$;
-- newstaff@external.com was cancelled in Test 7
select results_eq(
  $$ select (public.invite_team_member(
       (select artist_id from _test_ids),
       'newstaff@external.com', 'manager'
     ) ->> 'result')::text $$,
  $$ values ('invitation_sent') $$,
  'Test 16: re-invite after cancel → invitation_sent'
);
select ok(
  (select count(*) from public.artist_member_invitations
   where lower(invited_email) = 'newstaff@external.com') >= 2,
  'Test 16b: old cancelled row preserved alongside new pending row'
);

-- Test 17: Expired invitations excluded from list_my_pending_invitations
do $$ begin perform set_jwt_email('expired@external.com'); end $$;
select ok(
  (select count(*) from public.list_my_pending_invitations()) = 0,
  'Test 17: expired invitations excluded from list_my_pending_invitations'
);

-- Test 18: list_team_invitations returns only pending rows
do $$ begin perform set_jwt_email('test.owner@nireq.local'); end $$;
select ok(
  (select count(*) from public.list_team_invitations((select artist_id from _test_ids))
   where role is not null) >= 1,
  'Test 18: list_team_invitations returns at least one pending row'
);
select ok(
  not exists(
    select 1 from public.list_team_invitations((select artist_id from _test_ids)) lti
    join public.artist_member_invitations ami
      on ami.id = lti.id
    where ami.status != 'pending'
  ),
  'Test 18b: list_team_invitations returns no non-pending rows'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the tests**

```bash
npx supabase test db
```

Expected: all 18 (+ sub-assertions) pass. If any fail, fix the corresponding RPC in the migration, re-run `npx supabase db reset`, then re-run `npx supabase test db`.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/team_invitations_test.sql
git commit -m "test: add pgTAP tests for team invitation RPCs (18 cases)"
```

---

## Task 4: Edge function — notify-team-invitation

**Files:**
- Create: `supabase/functions/notify-team-invitation/index.ts`

- [ ] **Step 1: Create the edge function**

```typescript
// supabase/functions/notify-team-invitation/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { invitation_id } = await req.json();
    if (!invitation_id) {
      return json({ error: "invitation_id is required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Server is missing Supabase service configuration" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Fetch invitation + artist name
    const { data: invitation, error: invError } = await supabase
      .from("artist_member_invitations")
      .select("id, invited_email, role, status, artist_id, artists(creator_name)")
      .eq("id", invitation_id)
      .single();

    if (invError || !invitation) {
      return json({ error: "Invitation not found" }, 404);
    }

    // Only send for pending invitations — safe no-op otherwise
    if (invitation.status !== "pending") {
      return json({ ok: true, skipped: true, reason: "invitation is not pending" });
    }

    const artistName = (invitation.artists as { creator_name?: string } | null)?.creator_name || "a booth";
    const roleLabel = getRoleLabel(invitation.role);

    const subject = `You've been invited to join ${artistName} on NireQ`;
    const html = buildInviteHtml(artistName, roleLabel);
    const text = buildInviteText(artistName, roleLabel);

    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!resendApiKey) {
      // Local dev: Mailpit HTTP API
      const mailpitApiUrl =
        Deno.env.get("MAILPIT_API_URL") || "http://host.docker.internal:54324/api/v1/send";

      const mailpitResponse = await fetch(mailpitApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          From: { Email: "invites@nireq.local", Name: "NireQ" },
          To: [{ Email: invitation.invited_email, Name: invitation.invited_email }],
          Subject: subject,
          HTML: html,
          Text: text,
        }),
      });

      if (!mailpitResponse.ok) {
        const detail = await mailpitResponse.text();
        console.error("[notify-team-invitation] Mailpit failed:", detail);
        return json({ error: "Email delivery failed", detail }, 502);
      }

      const result = await mailpitResponse.json().catch(() => null);
      return json({ ok: true, delivered: true, provider: "mailpit", result });
    }

    // Production: Resend
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: Deno.env.get("APPLICATION_EMAIL_FROM") || "NireQ <invites@resend.dev>",
        to: [invitation.invited_email],
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("[notify-team-invitation] Resend failed:", detail);
      return json({ error: "Email provider failed", detail }, 502);
    }

    return json({ ok: true, delivered: true, provider: "resend" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json({ error: message }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    manager: "Manager",
    seller: "Seller / POS Staff",
    queue_staff: "Queue Staff",
  };
  return labels[role] ?? role;
}

function escapeHtml(str: unknown): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildInviteHtml(artistName: string, roleLabel: string): string {
  return `
<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:520px">
  <h1 style="font-size:20px;margin:0 0 12px">
    You've been invited to join ${escapeHtml(artistName)} on NireQ
  </h1>
  <p>You have been invited as <strong>${escapeHtml(roleLabel)}</strong>.</p>
  <p>
    To accept this invitation, sign up or log in using
    <strong>this exact email address</strong>.
    Once logged in, you will see a prompt to accept the invitation.
  </p>
  <p style="color:#6b7280;font-size:13px">
    If you did not expect this invitation, you can ignore this email.
  </p>
</div>`;
}

function buildInviteText(artistName: string, roleLabel: string): string {
  return [
    `You've been invited to join ${artistName} on NireQ`,
    "",
    `Role: ${roleLabel}`,
    "",
    "To accept this invitation, sign up or log in using this exact email address.",
    "Once logged in, you will see a prompt to accept the invitation.",
    "",
    "If you did not expect this invitation, you can ignore this email.",
  ].join("\n");
}
```

- [ ] **Step 2: Test the edge function manually**

Make sure `npx supabase functions serve` is running in a separate terminal, then:

```bash
# First create a test pending invitation via DB
docker exec supabase_db_EventWebQueue psql -U postgres -d postgres \
  -c "INSERT INTO public.artist_member_invitations (artist_id, invited_email, role)
      SELECT id, 'edgefn.test@example.com', 'queue_staff'
      FROM public.artists LIMIT 1
      RETURNING id;" 

# Use the returned ID in the curl below (replace <invitation_id>)
curl -s -X POST http://127.0.0.1:54321/functions/v1/notify-team-invitation \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
  -d '{"invitation_id":"<invitation_id>"}'
```

Expected: `{"ok":true,"delivered":true,"provider":"mailpit","result":{...}}`

Open `http://127.0.0.1:54324` — verify the invitation email appears addressed to `edgefn.test@example.com`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/notify-team-invitation/index.ts
git commit -m "feat: add notify-team-invitation edge function"
```

---

## Task 5: ManageTeam.tsx — invite form + pending invitations section

**Files:**
- Modify: `src/pages/creators/ManageTeam.tsx`

- [ ] **Step 1: Add PendingInvitation type and invite result state**

At the top of `ManageTeam.tsx`, add the new type and update imports. Add `Clock` to the lucide-react import.

```typescript
// Add to lucide-react import
import { CalendarDays, UserPlus, Users, Shield, Trash2, RefreshCcw, Search, Clock, Send, X } from 'lucide-react';

// Add after existing interfaces
interface PendingInvitation {
  id: string;
  invited_email: string;
  role: ActorRole;
  invited_at: string;
  expires_at: string | null;
}

type InviteResult =
  | 'member_added'
  | 'invitation_sent'
  | 'already_member'
  | 'already_invited'
  | 'email_failed'
  | null;
```

- [ ] **Step 2: Add pending invitations state and fetch function**

Inside the `ManageTeam` component, add state and the fetch function after the existing state declarations:

```typescript
const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
const [inviteResult, setInviteResult] = useState<InviteResult>(null);
const [inviteResultMsg, setInviteResultMsg] = useState<string>('');
const [resendingId, setResendingId] = useState<string | null>(null);
const [resendResultId, setResendResultId] = useState<string | null>(null);
const [resendResultOk, setResendResultOk] = useState<boolean | null>(null);

const fetchPendingInvitations = async () => {
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('list_team_invitations', { p_artist_id: actorContext.artist_id })
    );
    if (!error) setPendingInvitations((data || []) as PendingInvitation[]);
  } catch (err) {
    console.error('[ManageTeam] fetch pending invitations failed:', err);
  }
};
```

- [ ] **Step 3: Update useEffect to also fetch pending invitations**

```typescript
useEffect(() => {
  fetchMembers();
  fetchEventsAndAssignments();
  fetchPendingInvitations();
}, [actorContext.artist_id]);
```

- [ ] **Step 4: Replace handleAddMember with handleInvite**

Remove the existing `handleAddMember` function entirely and replace with:

```typescript
const handleInvite = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!canSave || adding) return;

  setAdding(true);
  setInviteResult(null);
  setInviteResultMsg('');
  const normalizedEmail = email.trim().toLowerCase();

  try {
    const { data, error } = await withTimeout(
      supabase.rpc('invite_team_member', {
        p_artist_id: actorContext.artist_id,
        p_email: normalizedEmail,
        p_role: role,
      })
    );

    if (error) throw error;

    const result = (data as { result: string; invitation_id?: string }).result;
    const invitationId = (data as { result: string; invitation_id?: string }).invitation_id;

    if (result === 'invitation_sent' && invitationId) {
      // Fire email notification — failure is non-blocking
      try {
        const { error: notifyError } = await withTimeout(
          supabase.functions.invoke('notify-team-invitation', {
            body: { invitation_id: invitationId },
          })
        );
        if (notifyError) {
          setInviteResult('email_failed');
          setInviteResultMsg('Invitation created, but the notification email failed to send.');
        } else {
          setInviteResult('invitation_sent');
          setInviteResultMsg('Invitation sent. They can join after signing up with this email.');
        }
      } catch {
        setInviteResult('email_failed');
        setInviteResultMsg('Invitation created, but the notification email failed to send.');
      }
      await fetchPendingInvitations();
    } else if (result === 'member_added') {
      setInviteResult('member_added');
      setInviteResultMsg('Member added successfully.');
      await fetchMembers();
    } else if (result === 'already_member') {
      setInviteResult('already_member');
      setInviteResultMsg('This email is already an active member.');
    } else if (result === 'already_invited') {
      setInviteResult('already_invited');
      setInviteResultMsg('An invitation already exists for this email.');
    }

    setEmail('');
    setRole('queue_staff');
  } catch (err) {
    console.error('[ManageTeam] invite failed:', err);
    setInviteResult(null);
    setInviteResultMsg(getErrorMessage(err, 'Failed to send invitation.'));
  } finally {
    setAdding(false);
  }
};
```

- [ ] **Step 5: Add handleCancelInvitation and handleResendInvitation**

```typescript
const handleCancelInvitation = async (inv: PendingInvitation) => {
  if (!confirm(`Cancel invitation for ${inv.invited_email}? They will no longer be able to accept it.`)) return;
  try {
    const { error } = await withTimeout(
      supabase.rpc('cancel_team_invitation', { p_invitation_id: inv.id })
    );
    if (error) throw error;
    await fetchPendingInvitations();
  } catch (err) {
    console.error('[ManageTeam] cancel invitation failed:', err);
    setInviteResultMsg(getErrorMessage(err, 'Failed to cancel invitation.'));
  }
};

const handleResendInvitation = async (inv: PendingInvitation) => {
  setResendingId(inv.id);
  setResendResultId(null);
  setResendResultOk(null);
  try {
    const { error } = await withTimeout(
      supabase.functions.invoke('notify-team-invitation', {
        body: { invitation_id: inv.id },
      })
    );
    setResendResultId(inv.id);
    setResendResultOk(!error);
  } catch {
    setResendResultId(inv.id);
    setResendResultOk(false);
  } finally {
    setResendingId(null);
  }
};
```

- [ ] **Step 6: Remove the old "Add Member" / "Invite Member" form from the JSX**

Find and delete the entire existing form section that contains the `handleAddMember` submit handler and the email/role inputs. It is a `<form>` or `<section>` block that likely starts with something like `<UserPlus` or `"Add Member"`. Remove it completely — the new form in Step 7 replaces it.

- [ ] **Step 7: Add the new invite form JSX**

Insert the following section where the old form was:

Find the existing "Add Member" form section in the JSX and replace it with:

```tsx
{/* Invite Member */}
<section className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
  <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
    <UserPlus size={14} className="text-gray-500" />
    <h2 className="text-sm font-bold text-gray-800">Invite Member</h2>
  </div>
  <form onSubmit={handleInvite} className="px-4 py-4 flex flex-col gap-3">
    <div className="flex flex-col sm:flex-row gap-3">
      <input
        type="email"
        placeholder="staff@example.com"
        value={email}
        onChange={(e) => { setEmail(e.target.value); setInviteResult(null); setInviteResultMsg(''); }}
        className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-pink-200"
        required
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as ActorRole)}
        className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
      >
        {ROLE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <Button
        type="submit"
        disabled={!canSave || adding}
        className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg disabled:opacity-50"
      >
        {adding ? 'Sending…' : 'Invite'}
      </Button>
    </div>
    {inviteResultMsg && (
      <p className={`text-xs ${inviteResult === 'member_added' || inviteResult === 'invitation_sent' ? 'text-green-600' : 'text-amber-600'}`}>
        {inviteResultMsg}
      </p>
    )}
  </form>
</section>
```

- [ ] **Step 8: Add Pending Invitations section JSX**

Insert this section above the "Current Members" section:

```tsx
{/* Pending Invitations */}
<section className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
  <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
    <Clock size={14} className="text-gray-500" />
    <h2 className="text-sm font-bold text-gray-800">Pending Invitations</h2>
  </div>
  {pendingInvitations.length === 0 ? (
    <p className="px-4 py-5 text-sm text-gray-400">No pending invitations.</p>
  ) : (
    <div className="divide-y divide-gray-100">
      {pendingInvitations.map((inv) => (
        <div key={inv.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{inv.invited_email}</p>
            <p className="text-xs text-gray-500">
              {getRoleLabel(inv.role)} · Invited {new Date(inv.invited_at).toLocaleDateString('en-GB')}
            </p>
            {resendResultId === inv.id && (
              <p className={`text-xs mt-0.5 ${resendResultOk ? 'text-green-600' : 'text-red-500'}`}>
                {resendResultOk ? 'Email resent.' : 'Resend failed.'}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleResendInvitation(inv)}
              disabled={resendingId === inv.id}
              className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1"
            >
              <Send size={12} />
              {resendingId === inv.id ? 'Sending…' : 'Resend'}
            </button>
            <button
              type="button"
              onClick={() => handleCancelInvitation(inv)}
              className="text-xs px-2.5 py-1.5 border border-red-100 rounded-lg text-red-500 hover:bg-red-50 flex items-center gap-1"
            >
              <X size={12} />
              Cancel
            </button>
          </div>
        </div>
      ))}
    </div>
  )}
</section>
```

- [ ] **Step 9: Verify TypeScript builds cleanly**

```bash
cd /Users/kongzas/Desktop/Kong/EventQueueSocial && npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 10: Commit**

```bash
git add src/pages/creators/ManageTeam.tsx
git commit -m "feat: update ManageTeam with invite form and pending invitations section"
```



---

## Task 6: PendingInvitationBanner.tsx

**Files:**
- Create: `src/components/PendingInvitationBanner.tsx`

- [ ] **Step 1: Create the component**

```typescript
// src/components/PendingInvitationBanner.tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { Bell, X, Check } from 'lucide-react';

export interface PendingInvite {
  id: string;
  artist_id: string;
  artist_name: string;
  role: string;
  invited_at: string;
  expires_at: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  manager: 'Manager',
  seller: 'Seller / POS Staff',
  queue_staff: 'Queue Staff',
};

const SESSION_KEY = 'dismissed_invitations';

function getDismissed(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function dismiss(id: string): void {
  const current = getDismissed();
  if (!current.includes(id)) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([...current, id]));
  }
}

interface Props {
  invitations: PendingInvite[];
  onAccepted: () => void; // tells App to reload actorContext + pending invitations
}

export default function PendingInvitationBanner({ invitations, onAccepted }: Props) {
  const dismissed = getDismissed();
  const visible = invitations.filter((inv) => !dismissed.includes(inv.id));

  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [acceptedIds, setAcceptedIds] = useState<string[]>([]);
  const [localDismissed, setLocalDismissed] = useState<string[]>([]);
  const [errorId, setErrorId] = useState<string | null>(null);

  const shown = visible.filter(
    (inv) => !acceptedIds.includes(inv.id) && !localDismissed.includes(inv.id)
  );

  if (shown.length === 0) return null;

  const handleAccept = async (inv: PendingInvite) => {
    setAcceptingId(inv.id);
    setErrorId(null);
    try {
      const { error } = await supabase.rpc('accept_team_invitation', {
        p_invitation_id: inv.id,
      });
      if (error) throw error;
      setAcceptedIds((prev) => [...prev, inv.id]);
      onAccepted(); // parent refreshes actorContext + pending list
    } catch (err) {
      console.error('[PendingInvitationBanner] accept failed:', err);
      setErrorId(inv.id);
    } finally {
      setAcceptingId(null);
    }
  };

  const handleNotNow = (inv: PendingInvite) => {
    dismiss(inv.id);
    setLocalDismissed((prev) => [...prev, inv.id]);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
      {shown.map((inv) => (
        <div
          key={inv.id}
          className="bg-white border border-gray-200 rounded-xl shadow-lg p-4 flex flex-col gap-3"
        >
          <div className="flex items-start gap-3">
            <Bell size={16} className="text-pink-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 leading-snug">
                You've been invited to join{' '}
                <span className="text-pink-600">{inv.artist_name}</span>
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Role: {ROLE_LABELS[inv.role] ?? inv.role}
              </p>
              {errorId === inv.id && (
                <p className="text-xs text-red-500 mt-1">Failed to accept. Please try again.</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleAccept(inv)}
              disabled={acceptingId === inv.id}
              className="flex-1 py-1.5 text-sm font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Check size={13} />
              {acceptingId === inv.id ? 'Accepting…' : 'Accept'}
            </button>
            <button
              type="button"
              onClick={() => handleNotNow(inv)}
              className="flex-1 py-1.5 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Not now
            </button>
          </div>
          <Link
            to="/invitations"
            className="text-xs text-center text-gray-400 hover:text-gray-600 underline"
          >
            Manage invitations
          </Link>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript builds cleanly**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/PendingInvitationBanner.tsx
git commit -m "feat: add PendingInvitationBanner component"
```

---

## Task 7: InvitationsPage.tsx + route

**Files:**
- Create: `src/pages/InvitationsPage.tsx`

- [ ] **Step 1: Create the page**

```typescript
// src/pages/InvitationsPage.tsx
import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { Bell } from 'lucide-react';

interface PendingInvite {
  id: string;
  artist_id: string;
  artist_name: string;
  role: string;
  invited_at: string;
  expires_at: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  manager: 'Manager',
  seller: 'Seller / POS Staff',
  queue_staff: 'Queue Staff',
};

export default function InvitationsPage() {
  const [invitations, setInvitations] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});

  const fetchInvitations = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('list_my_pending_invitations');
      if (!error) setInvitations((data || []) as PendingInvite[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchInvitations(); }, []);

  const handleAccept = async (inv: PendingInvite) => {
    setActionId(inv.id);
    try {
      const { error } = await supabase.rpc('accept_team_invitation', {
        p_invitation_id: inv.id,
      });
      if (error) throw error;
      // Reload so App.tsx re-runs loadInitialSession → fetchActorContext picks up the new member row
      window.location.href = '/';
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to accept invitation.';
      setMessages((m) => ({ ...m, [inv.id]: msg }));
    } finally {
      setActionId(null);
    }
  };

  const handleDecline = async (inv: PendingInvite) => {
    setActionId(inv.id);
    try {
      const { error } = await supabase.rpc('decline_team_invitation', {
        p_invitation_id: inv.id,
      });
      if (error) throw error;
      await fetchInvitations();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to decline invitation.';
      setMessages((m) => ({ ...m, [inv.id]: msg }));
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-2xl mx-auto px-4 py-10">
        <div className="flex items-center gap-2 mb-6">
          <Bell size={18} className="text-gray-600" />
          <h1 className="text-xl font-black text-gray-800">My Invitations</h1>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : invitations.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl px-5 py-8 text-center text-sm text-gray-400">
            No pending invitations.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {invitations.map((inv) => (
              <div
                key={inv.id}
                className="bg-white border border-gray-200 rounded-xl px-5 py-4 flex flex-col gap-3"
              >
                <div>
                  <p className="text-sm font-semibold text-gray-800">{inv.artist_name}</p>
                  <p className="text-xs text-gray-500">
                    {ROLE_LABELS[inv.role] ?? inv.role} ·{' '}
                    Invited {new Date(inv.invited_at).toLocaleDateString('en-GB')}
                  </p>
                  {messages[inv.id] && (
                    <p className="text-xs text-gray-600 mt-1">{messages[inv.id]}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleAccept(inv)}
                    disabled={actionId === inv.id}
                    className="px-4 py-1.5 text-sm font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
                  >
                    {actionId === inv.id ? 'Processing…' : 'Accept'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDecline(inv)}
                    disabled={actionId === inv.id}
                    className="px-4 py-1.5 text-sm border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript builds cleanly**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/InvitationsPage.tsx
git commit -m "feat: add /invitations settings page for accept/decline invitations"
```

---

## Task 8: App.tsx — wire up banner, route, auth state

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Import new components and page**

Add these imports near the top of `App.tsx` with the other imports:

```typescript
import PendingInvitationBanner, { type PendingInvite } from './components/PendingInvitationBanner';
import InvitationsPage from './pages/InvitationsPage';
```

- [ ] **Step 2: Add pendingInvitations state**

Inside the `App` component, add after the existing state declarations:

```typescript
const [pendingInvitations, setPendingInvitations] = useState<PendingInvite[]>([]);
```

- [ ] **Step 3: Add loadPendingInvitations helper**

Add inside the `App` component, before `syncSessionContext`:

```typescript
const loadPendingInvitations = async () => {
  try {
    const { data } = await supabase.rpc('list_my_pending_invitations');
    setPendingInvitations((data || []) as PendingInvite[]);
  } catch {
    setPendingInvitations([]);
  }
};
```

- [ ] **Step 4: Update syncSessionContext to load invitations**

Find the existing `syncSessionContext` function and update it:

```typescript
const syncSessionContext = async (nextSession: any) => {
  try {
    setSession(nextSession);

    if (!nextSession) {
      setActorContext(null);
      setPendingInvitations([]); // clear on sign out
      return;
    }

    const [ctx] = await Promise.all([
      fetchActorContext(),
      loadPendingInvitations(),   // load alongside actorContext
    ]);
    setActorContext(ctx);
  } catch (error) {
    console.error('[App] Failed to sync session context:', error);
    setActorContext(null);
  } finally {
    setLoading(false);
  }
};
```

- [ ] **Step 5: Add /invitations to isWorkspaceOptionalPath**

Find:
```typescript
const isWorkspaceOptionalPath = ['/', '/discover', '/manage-login', '/creator/register', '/reset-password', '/admin/applications'].includes(currentPath);
```

Replace with:
```typescript
const isWorkspaceOptionalPath = ['/', '/discover', '/manage-login', '/creator/register', '/reset-password', '/admin/applications', '/invitations'].includes(currentPath);
```

- [ ] **Step 6: Add /invitations route**

Inside the `<Routes>` block, add after the `/admin/applications` route:

```tsx
<Route
  path="/invitations"
  element={session ? <InvitationsPage /> : <Navigate to="/manage-login?redirect=/invitations" replace />}
/>
```

- [ ] **Step 7: Mount PendingInvitationBanner in the JSX**

In the returned JSX, just before the closing `</Router>` tag (or just before the closing of the outermost wrapper), add:

```tsx
{session && (
  <PendingInvitationBanner
    invitations={pendingInvitations}
    onAccepted={async () => {
      await Promise.all([
        syncSessionContext(session),
        loadPendingInvitations(),
      ]);
    }}
  />
)}
```

- [ ] **Step 8: Verify TypeScript builds cleanly**

```bash
npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 9: Run the dev server and manually test the full flow**

```bash
npm run dev
```

Test checklist:
1. Go to `/manage-team` — "Pending Invitations" section is visible (empty state).
2. Invite a non-existent email → "Invitation sent." message appears + row in Pending section.
3. Check Mailpit at `http://127.0.0.1:54324` → invitation email received.
4. Invite same email again → "An invitation already exists for this email."
5. Click Resend on the pending row → "Email resent." appears.
6. Click Cancel (with confirm) → row disappears from Pending section.
7. Re-invite the same email (after cancel) → "Invitation sent." again.
8. Log in as the invited email → `PendingInvitationBanner` appears in bottom-right.
9. Click "Not now" → banner hides; refresh page → banner reappears.
10. Click "Accept" → banner disappears; user now has workspace access.
11. Go to `/invitations` → page loads; no pending invitations (already accepted).
12. Invite a different email → log in → `/invitations` → click Decline → row disappears.

- [ ] **Step 10: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire PendingInvitationBanner and /invitations route into App"
```

---

## Done

All tasks complete. The team invitation flow is fully implemented:

- `artist_member_invitations` table with audit-safe status transitions
- 6 security-definer RPCs covering invite, list, cancel, accept, decline
- `notify-team-invitation` edge function (Mailpit local / Resend prod)
- `ManageTeam` updated with invite form + pending section (no alerts)
- `PendingInvitationBanner` with explicit Accept / Not now (sessionStorage dismiss)
- `/invitations` settings page with Accept + Decline
- `App.tsx` loads invitations on session resolve, SIGNED\_IN, and after accept
