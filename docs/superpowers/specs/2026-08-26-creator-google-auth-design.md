# Creator Google Signup And Login Design

**Date:** 2026-08-26
**Status:** Approved design direction; awaiting written-spec review
**Environment:** Local and Development verification first; Production configuration and deployment require separate approval

## 1. Goal

Add Google authentication for management users while keeping Nireq's customer experience guest-first.

The feature must support:

- new creators starting with Google, then completing the existing creator application;
- existing creators, managers, staff, and platform admins signing in with Google and retaining their current database role;
- existing verified email/password accounts automatically linking to Google when both identities use the same email address;
- email/password creator signup and login as a fallback;
- clear disclosure that linking identities with different email addresses is not yet supported.

Customer menu, queue, order, and order-status flows remain account-free.

## 2. Product Decisions

### 2.1 Creator signup is Google-first

`/creator/register` presents `Continue with Google` as the primary path. The existing email/password path remains available below a divider.

Google authentication happens before the creator application form. This avoids storing an incomplete application or preserving form data across an external OAuth redirect.

### 2.2 Creator login supports Google and password

`/manage-login` presents Google in the creator/manager login experience while preserving the existing email/password form and password recovery flow.

After Google authentication, routing continues to use the existing database-backed actor context and platform-admin checks. Google profile data never determines authorization.

The existing staff magic-link flow remains available. If an already-assigned staff account authenticates through Google with the same email, the normal role router must still send it to the permitted staff workspace.

### 2.3 Customers remain guests

No Google or Nireq account is required for customer discovery, queueing, ordering, or order tracking. Customer accounts are deferred until a concrete cross-device feature such as consolidated order history or loyalty requires them.

### 2.4 Different-email manual linking is deferred

Supabase supports manual identity linking as a beta capability, but the pilot will not expose it. Nireq will disclose:

> Nireq currently links Google automatically only when it uses the same email as your Nireq account. Linking accounts with different email addresses is not yet supported.

A future manual-linking feature must be initiated from an authenticated Account Settings page with explicit confirmation. It is not part of this work.

## 3. User Flows

### 3.1 New creator with Google

1. User opens `/creator/register` and selects `Continue with Google`.
2. Supabase redirects to Google OAuth.
3. Google returns the user to `/creator/register` with a valid Supabase session.
4. Nireq displays the authenticated email as read-only, prefills a contact name when available, and hides password fields.
5. User enters creator name, slug, social proof, optional links, application note, and truthful-application confirmation.
6. Nireq validates the fields and slug availability.
7. Nireq stores the existing self-serve signup metadata on the authenticated user and invokes `complete_verified_creator_signup()`.
8. The idempotent RPC creates the application and workspace once.
9. Nireq routes the creator to `/manage-events`.

### 3.2 Existing verified email/password account adds Google

1. User selects Google login or Google signup with the same verified email as the existing Nireq account.
2. Supabase automatically links the Google identity to the existing auth user.
3. The auth user ID, workspace, memberships, and platform-admin association remain unchanged.
4. The user may subsequently authenticate with Google or password.

If the existing account has no workspace, Nireq sends the user to the authenticated creator application form rather than asking the user to sign up again.

### 3.3 Existing workspace login

1. User selects `Continue with Google` on `/manage-login`.
2. Google returns the user to `/manage-login`.
3. Nireq resolves the actor context and routes by database role:
   - owner or manager to the management workspace;
   - seller or queue staff to the permitted live workspace;
   - platform admin to the requested admin page or admin fallback.

### 3.4 Authenticated account without a workspace

When login succeeds but no actor role, invitation, or platform-admin access exists, the login page displays a clear `Apply as a creator` action. The action opens `/creator/register` in authenticated mode and reuses the verified session email.

### 3.5 Email/password fallback

The existing creator email/password signup remains available. A new account still verifies its email before workspace creation.

Because Supabase intentionally obscures duplicate-account signup responses, the confirmation screen uses neutral copy and offers both login and password recovery. It must not state with certainty that an email was delivered when the address may already belong to a confirmed account.

## 4. Application Architecture

### 4.1 OAuth configuration

Configure a Google Web OAuth client with:

- Nireq Production and Development web origins;
- local origins used by the repository's development server;
- the hosted Supabase Google callback URL shown by the Production provider settings;
- the local Supabase callback for local verification.

Enable Google in Supabase Auth. Keep the Google client secret in Supabase Dashboard for hosted environments and a gitignored environment variable for local Supabase. No privileged credential may enter browser code, logs, commits, or chat output.

OAuth `redirectTo` values must already be present in the Supabase URL allowlist. Signup returns to `/creator/register`; login returns to `/manage-login` and preserves an approved relative destination when one exists.

### 4.2 Frontend behavior

Reuse the existing Supabase client and session listeners.

- `CreatorRegister` distinguishes unauthenticated email/password signup from authenticated onboarding.
- Google signup calls `signInWithOAuth({ provider: 'google' })` before displaying the creator details form.
- Authenticated onboarding reads the verified session user, shows the email read-only, updates the existing self-serve metadata, and calls the existing completion RPC.
- `ManageLogin` adds Google login and then reuses `routeAfterAuth()`.
- An authenticated user with an existing workspace is routed out of registration rather than shown a second application form.
- An authenticated user without a workspace may complete the creator form regardless of whether the session began with Google or email/password.

No new authentication library, callback service, onboarding draft table, or client-side form-persistence layer is introduced.

### 4.3 Database behavior

The design reuses:

- `is_creator_slug_available` for the early availability check;
- `complete_verified_creator_signup()` for validated, idempotent creator creation;
- `get_actor_context`, platform-admin checks, invitation checks, and accessible-event RPCs for routing.

No role or permission is taken from Google claims or user-editable metadata. Signup metadata remains onboarding input only. Database role and membership tables remain the authorization source of truth.

No schema migration is expected unless implementation reveals that the existing completion RPC cannot safely accept the authenticated Google onboarding path. Any required schema change must be append-only and reviewed separately.

## 5. Identity-Linking Rules

- Same verified email: allow Supabase automatic linking.
- Different email: treat as a separate auth user; do not merge automatically.
- Manual linking: not exposed in the pilot.
- SAML SSO identity linking: outside scope.
- Existing workspace or membership: preserve the current auth user ID and database associations.
- Google display name and avatar: optional presentation or prefill data only, never authorization data.

The same-email limitation appears near the Google action and in the no-workspace recovery guidance so users know which Google account to select.

## 6. Error And Recovery Design

- OAuth cancelled or denied: return to the initiating page, show a retryable message, and create no application.
- Provider configuration or callback error: show a non-secret error and retain email/password fallback.
- Google returns an email different from the user's intended Nireq account: do not merge; show the same-email limitation when the new account has no workspace.
- Slug becomes unavailable: keep the authenticated form populated and ask for another slug.
- Metadata update fails: do not call the completion RPC; keep the form available for retry.
- Completion RPC fails after metadata succeeds: keep the form available and allow retry. Existing RPC idempotency must prevent duplicate active applications and workspaces.
- Completion returns `exists`: route to the existing workspace.
- Authenticated account has no role: show `Apply as a creator` instead of the generic dead-end message.
- Duplicate email/password signup: use neutral copy with login and password-recovery actions.

## 7. Security Requirements

- Store Google client secrets outside browser code and git.
- Allow only exact Nireq Production, Development, and local redirect targets required by the flows.
- Continue deriving all authorization from database roles, memberships, event assignments, RLS, and RPC checks.
- Do not use Google claims or `raw_user_meta_data` for permission decisions.
- Preserve current short JWT expiry and session handling.
- Do not expose account-existence information through signup or recovery copy.
- Do not add different-email manual linking until it has a dedicated authenticated confirmation and recovery design.
- Do not apply Production provider configuration or deploy without explicit approval.

## 8. Verification

### 8.1 Local and automated checks

Add the smallest focused checks for:

- Google signup starts with the correct provider and registration return URL;
- Google login starts with the correct login return URL;
- authenticated registration hides password fields and uses the session email;
- successful authenticated onboarding invokes completion and routes to the workspace;
- existing workspace users are not offered a duplicate application;
- no-role users receive the creator-application action;
- duplicate email/password confirmation copy remains neutral;
- OAuth cancellation, slug conflict, metadata failure, and RPC retry states remain recoverable.

Run the relevant auth/security regression and `npm run verify`.

### 8.2 Real OAuth checks

After local configuration, verify through a real browser:

- new Google creator signup creates one auth user, one active creator application, one workspace, and one owner membership;
- a verified email/password account signing in with the same Google email keeps the same auth user ID;
- owner, manager, seller, queue staff, and platform admin route only to their permitted surfaces;
- Google OAuth cancellation leaves no partial application;
- selecting a different Google email does not merge accounts and shows the limitation;
- password login, password recovery, staff magic link, and email/password creator signup still work.

Negative permission checks must confirm database/RPC enforcement, not only frontend redirects.

### 8.3 Production rollout

Production rollout requires separate approval and proceeds in this order:

1. configure and verify the Google OAuth client;
2. enable the Google provider in Production Supabase Auth;
3. deploy the verified frontend;
4. run one existing-account Google login smoke test;
5. run one isolated new-creator Google signup smoke test;
6. verify auth user identity linkage, workspace creation, and role routing;
7. retain email/password fallback throughout the pilot.

## 9. Non-Goals

- Customer accounts or customer Google login.
- Manual identity linking between different email addresses.
- Account merge, identity unlinking, or account-recovery UI.
- Replacing email/password or staff magic-link authentication.
- Changing the role, membership, RLS, event-assignment, or workspace model.
- Adding an onboarding draft table or a new OAuth library.

## 10. Acceptance Criteria

- A new user can authenticate with Google, complete the creator form, and reach exactly one creator workspace.
- An existing verified email/password user can use Google with the same email without changing auth user ID or losing access.
- Existing management roles continue to route and authorize correctly after Google login.
- A no-workspace authenticated user has a clear path into creator onboarding.
- Email/password signup and login remain functional.
- Users are told that different-email linking is not supported.
- Customer flows remain account-free.
- Relevant auth/security regressions and `npm run verify` pass before any deployment.
