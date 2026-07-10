# Public Privacy and Creator Recovery Design

## Scope

This release adds public privacy documentation for Nireq and repairs the verified-email creator signup path when a pre-existing account does not contain the current self-serve signup metadata.

## Privacy and Cookie Pages

- Add public routes at `/privacy` and `/cookies`.
- Present the content in Thai and English using the existing application language preference.
- Identify `Nireq` as the data controller and `kongphop.sunit@gmail.com` as the contact address.
- Describe only services and browser storage the application currently uses: Supabase Auth, Database, Storage and Realtime; Firebase Firestore for queue operations; browser local/session storage for language, carts, customer order state and UI preferences.
- Describe the account, creator application, public creator profile, event, order, pickup and support data processed by the product. State the purposes, retention principle, deletion/contact path, and a no-sale/no-advertising statement.
- State that production currently does not load optional session replay/analytics. If Nireq later enables it, the policy will be updated and the app will obtain a separate choice before activating it.
- Provide a compact reusable legal footer on public discovery, creator registration, creator login, and customer home surfaces. Do not add a consent banner in this release because there is no optional tracking active in the current production build.

## Creator Signup Recovery

### Observed Failure

An existing, verified account can contain older creator metadata (`creator_name`, `contact_name`, and `desired_slug`) without the current `creator_signup=self_serve` marker or the current required social proof and application note. `complete_verified_creator_signup()` then returns `not_pending`, so no workspace is created. Supabase intentionally returns an obfuscated success response for a duplicate confirmed email when confirmation is enabled, so a subsequent registration attempt cannot safely overwrite that account's metadata.

### Recovery Flow

- Add `/creator/complete`, available only to an authenticated user without a workspace.
- Pre-fill any available creator metadata and request the required current fields: creator name, contact name, URL slug, primary social URL, and a short application note.
- On submit, update the signed-in user's metadata with the complete self-serve payload and then call the existing `complete_verified_creator_signup()` RPC. The RPC remains the only code path that creates the application/workspace and still requires a confirmed email.
- If the RPC succeeds, refresh actor context and navigate to `/manage-events`. If it fails, retain the form and show the actionable error.
- When a signed-in creator has no workspace, the login page should offer the recovery route rather than only showing the generic no-workspace message.
- When the confirmation callback has `otp_expired` or a similar error in the URL hash, show a clear expired/used-link message and offer a generic resend-confirmation action using Supabase `auth.resend({ type: 'signup' })`. The message must not disclose whether the entered email exists.

## Security Boundaries

- The browser can only update metadata for its current authenticated account.
- The database RPC remains responsible for requiring an authenticated, email-confirmed user, validating the slug, and enforcing existing slug uniqueness before creating an artist, application, and owner membership.
- The recovery flow does not grant platform-admin or staff roles and does not modify existing workspaces.
- No migration is required for this repair: the existing production RPC can process the completed metadata after the user supplies the missing fields.

## Verification

- Add Playwright coverage for public legal routes and their footer links.
- Add browser coverage for the expired confirmation-link message without logging sensitive query/hash values.
- Run TypeScript, lint, production build, targeted Playwright tests, then deploy to DEV before production.
