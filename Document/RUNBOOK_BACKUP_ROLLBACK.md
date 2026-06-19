# Backup And Rollback Runbook

Use this before every DEV or production release that changes Supabase migrations, order stock behavior, checkout, storage, or Firebase Hosting configuration.

## Current Targets

- Source of truth: `/Users/kongzas/Desktop/Kong/EventQueueSocial`
- Firebase hosting target: `nireqapp`
- DEV deploy command: `npm run deploy:staging`
- PROD deploy command: `npm run deploy:prod`
- DEV env file: `.env.staging`
- PROD env file: `.env.production`

## Pre-Deploy Gate

1. Confirm the working tree code is committed.
2. Confirm the build uses the intended env:
   - `node scripts/validate-env.mjs staging`
   - `node scripts/validate-env.mjs production`
3. For a DEV deploy, run:
   - `npm run lint`
   - `npm run build:staging`
   - `npm run test:security`
4. For a PROD deploy, repeat with:
   - `npm run build:prod`
5. Check whether any Supabase migration exists locally but has not been pushed to the target project.
6. Record the commit hash and Firebase channel/live URL in the release note.

## Database Backup Policy

Supabase managed backups cover the database only, not uploaded Storage objects. Storage object metadata may exist in Postgres, but restoring a database backup does not restore deleted files from Storage.

For paid projects, use Supabase dashboard backups or Point-in-Time Recovery when enabled. For free-tier or extra safety before risky migrations, create an off-site logical dump.

Recommended manual backup before risky DEV/PROD migration:

```bash
supabase db dump --linked --file backups/$(date +%Y%m%d-%H%M%S)-target.sql
```

Keep manual dumps outside the repo or in encrypted/off-site storage. Do not commit dumps because they can contain customer data.

## Migration Rollback

Preferred rollback order:

1. Stop new writes if the issue affects stock, orders, or payments.
2. Roll forward with a corrective migration when data has already changed.
3. Restore database backup only when a forward fix is not practical and downtime/data loss is accepted.

Do not delete already-applied migration files to roll back. Supabase migration history and the actual schema will drift.

For function-only bugs, deploy a new migration that restores the previous function body.

For table/column bugs:

- If the bad migration only added unused columns/tables, create a new migration that drops or disables the new surface.
- If customer/order data was written through the bad schema, first export affected rows, then write a corrective migration or manual repair script.

## Firebase Hosting Rollback

Firebase Hosting keeps release history for the live channel. Use the Firebase console release history for quick live rollback, or clone a known-good deployed version/channel when appropriate.

DEV preview channels are temporary and can expire. Use DEV for UAT confidence, not as the only rollback copy.

Rollback checklist:

1. Identify the last good commit hash.
2. Identify the last good Firebase release/version in Hosting release history.
3. Roll back Hosting first if the frontend is broken but database state is safe.
4. If the issue came from a migration, pause write paths and follow the database rollback section.
5. After rollback, run a smoke check:
   - customer menu loads
   - queue ticket can be created
   - POS/order flow can complete on test data
   - stock numbers remain consistent

## Incident Notes Template

```text
Incident:
Environment:
Bad release commit:
Bad Firebase release/version:
Migration(s) involved:
First detected at:
User impact:
Action taken:
Rollback/fix commit:
Data repair needed:
Follow-up test added:
```

## References

- Supabase backups: https://supabase.com/docs/guides/platform/backups
- Firebase Hosting releases/channels: https://firebase.google.com/docs/hosting/manage-hosting-resources
