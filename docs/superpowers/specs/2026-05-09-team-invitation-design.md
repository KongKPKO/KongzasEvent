# Team Invitation Flow — Design Spec

**Date:** 2026-05-09
**Status:** Approved
**Feature:** Practical team invitation flow for EventQueueSocial booth operations

---

## Problem

On `/manage-team`, adding a staff member fails when the email does not exist in Supabase Auth yet. Booth owners cannot invite staff before those staff accounts exist. This blocks real-world booth operations.

---

## Goals

- Owner/Manager can invite any email, existing auth user or not.
- Pending invitations are tracked separately from active members.
- Invitee sees an explicit Accept banner on login — no silent auto-grant.
- Owner/Manager can cancel pending invitations and re-invite cleanly.
- Email notification sent to invitee when invitation is created.
- Duplicate active memberships and duplicate pending invitations are both prevented.
- All status transitions are auditable (rows never hard-deleted).

---

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Pending storage | Separate `artist_member_invitations` table | No security bleed into `has_artist_role`; clean audit trail |
| Accept flow | Explicit Accept banner | User decided — no silent auto-grant on login |
| Email delivery | Existing edge function pattern (Mailpit local / Resend prod) | Already working in project |
| Invite link token | None | Identity proof is the authenticated email |
| Permanent decline | Settings/invitations page only | Login banner uses "Not now" (soft dismiss) |
| Row deletion | Never hard-delete | Full audit history for all statuses |
| Re-invite after cancel | Allowed immediately | Partial unique index on `pending` only |

---

## Architecture

```
ManageTeam (owner/manager)
  └─ invite_team_member RPC
       ├─ user exists in auth → insert artist_members (active)  → member_added
       └─ user not in auth   → insert artist_member_invitations → invitation_sent
                                    └─ app calls notify-team-invitation edge fn → email

App shell (any authed user)
  └─ list_my_pending_invitations() on session resolve / SIGNED_IN
       └─ PendingInvitationBanner
            ├─ Accept → accept_team_invitation() → refresh actorContext
            └─ Not now → sessionStorage dismiss (banner returns next session)

/invitations settings page
  └─ list_my_pending_invitations()
       ├─ Accept → accept_team_invitation()
       └─ Decline → decline_team_invitation()
```

---

## Database Schema

### New table: `artist_member_invitations`

```sql
create table public.artist_member_invitations (
  id            uuid primary key default gen_random_uuid(),
  artist_id     uuid not null references public.artists(id) on delete cascade,
  invited_email text not null,                    -- stored lowercase
  role          text not null check (role in ('manager', 'seller', 'queue_staff')),
  invited_by    uuid references auth.users(id),   -- nullable
  status        text not null default 'pending'
                check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  invited_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  declined_at   timestamptz,
  cancelled_at  timestamptz,
  expires_at    timestamptz,                      -- null = no expiry
  updated_at    timestamptz not null default now()
);
```

**Indexes:**

```sql
-- Prevents duplicate pending invites; allows re-invite after cancel/decline
create unique index artist_member_invitations_pending_uidx
  on public.artist_member_invitations (artist_id, lower(invited_email))
  where status = 'pending';

-- Fast lookup when a user logs in and claims invitations
create index artist_member_invitations_email_idx
  on public.artist_member_invitations (lower(invited_email));
```

**RLS:** Direct client writes are blocked. All mutations go through security-definer RPCs.

**`artist_members` table:** Unchanged. Only holds `active | inactive` real memberships.

---

## RPCs

### `invite_team_member(p_artist_id, p_email, p_role)`

Called from ManageTeam by owner or manager.

1. Assert caller has `owner` or `manager` role on `p_artist_id`.
2. Normalize email to lowercase.
3. If active `artist_members` row exists for `(artist_id, email)` → return `already_member`.
4. If pending `artist_member_invitations` row exists → return `already_invited`.
5. Check `auth.users` for the email:
   - **Found** → insert `artist_members` (active) → return `{result: 'member_added'}`.
   - **Not found** → insert `artist_member_invitations` (pending) using `INSERT ... ON CONFLICT DO NOTHING`; if 0 rows inserted (race condition) → return `already_invited`; otherwise return `{result: 'invitation_sent', invitation_id: <uuid>}`.
6. Returns `invitation_id` in the `invitation_sent` case so the app can call the edge function.

### `list_team_invitations(p_artist_id)`

Called from ManageTeam to populate the Pending Invitations section.

1. Assert caller has `owner` or `manager` role.
2. Return all `pending` rows for `p_artist_id`: `(id, invited_email, role, invited_at, expires_at)`.

### `cancel_team_invitation(p_invitation_id)`

Called from ManageTeam by owner or manager.

1. Assert caller has `owner` or `manager` role on the invitation's `artist_id`.
2. Assert `status = 'pending'`.
3. Set `status = 'cancelled'`, `cancelled_at = now()`, `updated_at = now()`.

### `list_my_pending_invitations()`

Called by any authenticated user on session resolve and after accept/decline.

1. Get caller email from `auth.jwt() ->> 'email'`.
2. Return `pending` rows where `lower(invited_email) = caller_email` AND (`expires_at IS NULL OR expires_at > now()`).
3. Return fields: `(id, artist_id, artist_name, role, invited_at, expires_at)`.
4. Read-only — modifies nothing.

### `accept_team_invitation(p_invitation_id)`

Called only when the user explicitly clicks Accept.

1. Assert caller email matches `invited_email`.
2. Assert `status = 'pending'`.
3. Assert `expires_at IS NULL OR expires_at > now()`.
4. Insert into `artist_members` (active, role from invitation).
   - On duplicate: mark invitation accepted anyway, return `accepted_existing_member`.
5. Set invitation `status = 'accepted'`, `accepted_at = now()`, `updated_at = now()`.
6. Return typed result: `accepted` or `accepted_existing_member`.

### `decline_team_invitation(p_invitation_id)`

Called from the `/invitations` settings page only (not from the login banner).

1. Assert caller email matches `invited_email`.
2. Assert `status = 'pending'`.
3. Set `status = 'declined'`, `declined_at = now()`, `updated_at = now()`.

---

## Edge Function: `notify-team-invitation`

Called from the app layer after `invite_team_member` returns `invitation_sent`.

**Request body:** `{ "invitation_id": "<uuid>" }`

**Flow:**
1. Fetch invitation row using service role key.
2. Assert `status = 'pending'` — return safe no-op if not pending.
3. Fetch artist name from `artists` table.
4. Build email (content identical regardless of whether invitee has an auth account — do not expose auth user existence):
   - **To:** `invited_email`
   - **Subject:** `"You've been invited to join [Artist Name] on NireQ"`
   - **Body:** Role, booth name, and CTA: "Sign up or log in using this exact email address to accept the invitation."
5. Send via Mailpit HTTP API (local, no `RESEND_API_KEY`) or Resend (production).
6. Return `{ ok: true, provider: "mailpit" | "resend" }`.

**Important:** Email send failure does not roll back invitation creation. App shows: "Invitation created, but the notification email failed to send."

**Resend support:** A `resend_team_invitation(p_invitation_id)` RPC (or frontend action) can call this same edge function for any `pending` invitation. Disabled for non-pending statuses.

---

## Frontend

### `ManageTeam.tsx` changes

**Invite form:**
- Rename "Add Member" → "Invite Member".
- Replace all `alert()` calls with inline status messages below the form.
- `handleInvite` calls `invite_team_member`, reads typed result:

| Result | Inline message |
|---|---|
| `member_added` | "Member added successfully." |
| `invitation_sent` | "Invitation sent. They can join after signing up with this email." |
| `already_member` | "This email is already an active member." |
| `already_invited` | "An invitation already exists for this email." |
| email send failure | "Invitation created, but the notification email failed to send." |

- On `invitation_sent`: app calls `notify-team-invitation` edge function with `invitation_id`. Email failure shows inline — does not block invitation creation.

**Pending Invitations section** (above Current Members):
- Always visible with empty state "No pending invitations." — do not hide when empty.
- Fetched via `list_team_invitations(artist_id)` on load and after each invite/cancel action.
- Each row: email, role badge, invited_at date.
- **Cancel button:** shows confirmation prompt before calling `cancel_team_invitation`. On success, refreshes list. Uses inline/toast feedback — no `alert()`.
- **Resend button:** disabled while sending. Shows inline success/failure per row. Only active for `pending` invitations.

### `PendingInvitationBanner.tsx` — new component

Mounted in the authenticated app shell.

**Trigger:** `list_my_pending_invitations()` called:
- On initial session resolve (user already signed in on page load/refresh).
- On `SIGNED_IN` auth state change.
- On `SIGNED_OUT` → clear pending invitations from state.
- After Accept or Decline action → refresh.

**Behavior:**
- Shows one invitation card at a time (or stacked if multiple).
- Each card: "You've been invited to join **[Artist Name]** as **[Role]**."
- **Accept:** calls `accept_team_invitation(invitation_id)` → on success: refresh pending invitations, reload `actorContext`/workspace access, show success message. If this is the user's first accessible workspace, route them into it.
- **Not now:** stores `invitation_id` in `sessionStorage` → card hidden for this browser session. Invitation stays `pending` and banner reappears in next session.
- **"Manage invitations" link:** navigates to `/invitations`.
- No `alert()` — all feedback inline.

### `/invitations` — new route

Simple settings page for the authenticated user.

- Lists all pending (non-expired) invitations via `list_my_pending_invitations()`.
- Per row: booth name, role, invited_at date, **Accept** + **Decline** buttons.
- **Accept** → `accept_team_invitation(invitation_id)` → row disappears, success message.
- **Decline** → `decline_team_invitation(invitation_id)` → row disappears.
- Empty state: "No pending invitations."
- Linked from `PendingInvitationBanner` and user menu/settings nav.

---

## Tests

File: `supabase/tests/team_invitations_test.sql` (pgTAP)

| # | Description | RPC | Expected |
|---|---|---|---|
| 1 | Owner invites email that exists in auth | `invite_team_member` | `member_added`; row in `artist_members` |
| 2 | Owner invites email not in auth | `invite_team_member` | `invitation_sent`; pending row in `artist_member_invitations` |
| 3 | Owner invites same pending email again | `invite_team_member` | `already_invited`; no duplicate row |
| 4 | Owner invites existing active member | `invite_team_member` | `already_member`; no invitation row |
| 5 | Manager can invite | `invite_team_member` | `invitation_sent` or `member_added` |
| 6 | `queue_staff` cannot invite | `invite_team_member` | permission error |
| 7 | Owner cancels pending invitation | `cancel_team_invitation` | `status = 'cancelled'`, `cancelled_at` set |
| 8 | Cannot cancel already-cancelled invitation | `cancel_team_invitation` | error / no-op |
| 9 | Invitee lists pending invitations | `list_my_pending_invitations` | returns matching pending rows |
| 10 | Invitee accepts pending invitation | `accept_team_invitation` | active row in `artist_members`; invitation `status = 'accepted'` |
| 11 | Accept expired invitation is rejected | `accept_team_invitation` | error — expired |
| 12 | Accept already-accepted invitation | `accept_team_invitation` | `accepted_existing_member` — no crash |
| 13 | Invitee declines from settings page | `decline_team_invitation` | `status = 'declined'`, `declined_at` set |
| 14 | Wrong user cannot accept another's invitation | `accept_team_invitation` | permission error |
| 15 | Wrong user cannot decline another's invitation | `decline_team_invitation` | permission error |
| 16 | Re-invite after cancel creates new pending row | `invite_team_member` | new `pending` row; old `cancelled` row preserved |
| 17 | Expired invitations excluded from list | `list_my_pending_invitations` | expired rows not returned |
| 18 | `list_team_invitations` returns only pending rows | `list_team_invitations` | accepted/cancelled/declined excluded |
