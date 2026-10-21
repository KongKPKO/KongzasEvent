# Phase 0–1: isolated local validation

This workflow creates a new disposable database. It never resets the default Local instance or changes DEV/PROD. Run from the repository root. Keep the generated directory: its migration copies record the schema that was replayed.

## Prepare and start

Requirements: installed project dependencies, Supabase CLI 2.98.2, Docker and Playwright Chromium. Check ports 59320–59329 are free. The frontend uses 5173; stop only a server you own, or run this validation when that port is free.

```bash
node scripts/prepare-isolated-validation.mjs output/phase01-local
supabase start --workdir output/phase01-local --exclude studio,postgres-meta,imgproxy,logflare,vector,supavisor
supabase functions serve --workdir output/phase01-local --env-file output/phase01-local/functions.env --no-verify-jwt
```

The preparation command refuses an existing directory. If that workspace already exists, inspect/reuse it or choose a new output directory and project/port allocation; do not delete somebody else's workspace. Project ID is `NireqPhase01Validation`; do not run a second instance with that ID at the same time.

The excluded services are optional tools for this test run. Auth, PostgREST, Storage, Realtime, Mailpit and Edge Runtime remain enabled. Historical `supabase/seed.sql` is deliberately excluded; tests create synthetic fixtures. Google OAuth is disabled locally; real provider verification remains a separate DEV check.

The local Postgres image is pinned to `17.6.1.063`, matching the repository's existing local runtime. CLI 2.98.2 defaults to `17.6.1.106`; its denied-EXECUTE error handler can crash the database ([Supabase issue 2112](https://github.com/supabase/postgres/issues/2112)). Do not change permission assertions or grant additional privileges to work around this runtime bug. Re-evaluate the pin during a separately validated CLI/runtime upgrade.

The Edge command deliberately disables gateway JWT verification **only locally** so tests reach each handler's own authorization checks. Creator notification uses log mode; other notification tests use local Mailpit. No remote email provider keys are loaded. Never copy this command to a remote deployment without reviewing that function's authorization/configuration.

## Verify

Keep the Edge command running in its terminal. In a second terminal:

```bash
SUPABASE_WORKDIR="$PWD/output/phase01-local" VITE_LOGROCKET_DISABLED=true npm run verify
```

The release guard discovers credentials from this instance, requires loopback URLs and rejects mismatched environment overrides. Never print its environment/keys into logs. The gate runs lint/build, all SQL tests, actual concurrent team transitions/assignment replacements, the existing commerce race tests, browser regressions including admin MFA/notification/support/suspension, and API smoke.

Migration copies must match the intended source before a clean replay. Adding files after a workspace was started does not prove replay from zero. Recreate only this explicitly disposable instance when a fresh replay is needed; never use `--linked` or remote DB URLs.

## Admin MFA and recovery

`is_platform_admin_account()` returns only whether the signed-in account may enter enrollment; it grants no privileged access. `is_platform_admin()` additionally requires the server-verified `aal2` claim. Existing admin pages and Edge/RPC policies use the latter for data and actions.

Admin routes offer TOTP enrollment when no verified factor exists, then require a six-digit authenticator code. Subsequent password/Magic Link/OAuth login starts at AAL1 and must challenge the registered factor. Do not share or log QR codes, setup keys, access/refresh tokens or one-time codes. New MFA tests disable automatic trace/video/screenshots and capture only screens without setup secrets.

If an admin loses every authenticator, the authorized platform operator must first verify the person's identity out of band, then remove the lost factor using trusted Supabase Auth administration for the explicitly confirmed environment/user. Sign out/revoke existing sessions and require enrollment again. Record the recovery action in the operational incident record. There is no browser-side MFA bypass or self-service reset that grants platform privileges. UID-bound admin bootstrap/lifecycle improvements remain Phase 3.

## Stop this instance

```bash
supabase stop --workdir output/phase01-local --project-id NireqPhase01Validation
```

This keeps its disposable volumes for inspection. `--no-backup` deletes this instance's volumes and is appropriate only when intentionally recreating this confirmed test target. Do not use `--all`.
