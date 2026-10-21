# Platform Admin access

## Sign in

1. Open `/admin` on the intended Nireq environment. The app redirects to `/manage-login?redirect=/admin` when needed.
2. Sign in with the verified account that has a Platform Admin grant bound to its Auth user UUID. Store owner/manager roles do not grant platform access; an email-only `platform_admins` row does not grant access.
3. On the first visit, enroll an Authenticator, scan the QR code privately and verify its six-digit code. Later visits require the verified Authenticator challenge when the session is not already AAL2.
4. The console opens after the server verifies both the bound identity and AAL2. Existing MFA enrollment secrets must never enter tickets, screenshots, logs or chat.

These routes and controls require the matching frontend, migrations and Edge functions to have been deployed together. Local validation does not establish that the DEV or PROD website already has them.

## First administrator

A trusted database operator must first confirm the **environment and verified Auth user UUID**. Applying remote migrations or changing a live grant requires explicit authorization for that target and action.

When the installation has no bound administrator, run the following through its trusted SQL connection, replacing the placeholder with the confirmed UUID and an actual reason:

```sql
select private.bootstrap_platform_admin(
  'CONFIRMED-VERIFIED-AUTH-USER-UUID'::uuid,
  'Authorized initial platform administrator setup'
);
```

The private function is inaccessible to browser roles, requires a verified email, refuses an already bootstrapped system and writes an audit record. If a bound administrator already exists, that administrator uses the user detail page to grant another verified account with MFA and a reason. Do not bypass the bootstrap refusal by inserting an email-only grant. Recovery without an available administrator requires a separately authorized trusted operator action.

## Suspend management access

Open **Users → User details → Account management access**, choose suspend or restore, enter a reason of 5–500 characters, then confirm. Both actions require an active Platform Admin session at AAL2 and write an audit record. A stale or repeated expected state is rejected; reload and inspect the current state before acting again.

Suspension affects that immutable Auth user UUID across its workspaces. It removes store, catalog, event, campaign, team, queue, order and private shop-file management access, including new requests with an already issued JWT. It does not change store publication, memberships, customer orders, payments, stock or other team members' roles. Existing teammates retain their own rights, including fulfillment of existing orders. Public customer browsing, customer-token order tracking and support remain available. An operation already admitted before suspension commits may finish; this does not cancel in-flight transactions or reverse completed work.

The workspace checks again on window focus and every five seconds while open, clears operational state/subscriptions and displays a suspension notice. Server checks apply to each new management request immediately after the suspension commits, independently of this UI refresh. After restoration, **Check access again** reloads the existing role; memberships do not need to be recreated.

A current Platform Admin grant must be revoked before suspending that account. Self-revocation is prohibited; another trusted admin must perform the revoke. This preserves the existing protection against administrator lockout.

This action is separate from **store suspension**, Auth login bans and content moderation. It leaves login/customer support available. Event/Campaign hide or stop-sales behavior still requires its own product decision.

## Enforcement notes

The restriction lives in a private RLS-enabled table. Live database checks cover both role helpers and legacy direct ownership/email RLS, including Storage policies. Invitation/signup/workspace entry points also check it. Privileged notification/admin Edge handlers use those same caller checks before service operations. A PostgREST-only request hook is insufficient for Storage/Realtime; see [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api). Already issued tokens cannot be treated as fresh permission state; see [Supabase sessions](https://supabase.com/docs/guides/auth/sessions).

Payment evidence now downloads through `payment-evidence`, which rechecks the Auth identity, current management state and the order's existing staff RLS before returning private/no-store bytes. The browser cannot directly read/sign the PaymentEvidence bucket, and previews revoke their local Blob URLs when closed or unmounted. Customer evidence uploads remain separate.

**Cutover limitation:** a [signed bearer URL](https://supabase.com/docs/reference/javascript/storage-from-createsignedurl) issued by an older release cannot be revoked for just one user by changing account RLS. Known application-issued links last 30 minutes; independently issued links can carry their own expiry. Before claiming immediate revocation of previously issued evidence links on an existing environment, establish that all old links have expired or separately authorize a controlled object-path rotation. Do not delete shared evidence to revoke one account. Downloaded copies and already displayed information cannot be recalled.
