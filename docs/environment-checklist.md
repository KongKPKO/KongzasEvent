# Environment Checklist

Use this as the operating map for Nireq environments. Keep real keys in `.env*` files or the provider dashboards only; do not paste secrets into docs, commits, screenshots, or chat.

## Current Environments

| Layer | Purpose | Supabase | Frontend | Data safety |
| --- | --- | --- | --- | --- |
| Local Supabase | Fast database/auth/storage testing on this Mac | `http://127.0.0.1:54321` | Host dev server | Disposable |
| Docker test app | Local app container wired to local Supabase | `eventqueue-test-app` via `.env.docker.test` | `http://localhost:5173` | Disposable |
| LAN local test | Phone/tablet testing on the same Wi-Fi | Should use Mac LAN IP, not `127.0.0.1` | `http://192.168.1.149:5173` while on current Wi-Fi | Disposable |
| DEV / Staging | Cloud test that should feel close to production | `Kongzas Event Queue - DEV` / `kdjqitvtxmcrnnpuxuyl` | Firebase preview channel or local build pointed to DEV | Test data only |
| PROD | Real users and real creator data | `Kongzas Event Queue - PROD` / `fnutmjnzugpayccscvgr` | Firebase Hosting target `createeq` | Protect carefully |

Current repo link: Supabase CLI is linked to **PROD** (`fnutmjnzugpayccscvgr`). Be deliberate before running any remote command that defaults to `--linked`.

## Local URLs

| Service | URL |
| --- | --- |
| Vite / Docker test app | `http://localhost:5173` |
| Supabase API | `http://127.0.0.1:54321` |
| Supabase Studio | `http://127.0.0.1:54323` |
| Mailpit | `http://127.0.0.1:54324` |
| Local Postgres | Run `supabase status` for the current local DB URL. |

## Env Files

| File | Intended use |
| --- | --- |
| `.env.local` | Local browser dev on the Mac. Usually points to `http://127.0.0.1:54321`. |
| `.env.docker.test` | Docker test app. Usually points to local Supabase from inside the container/network. |
| `.env.docker.test.example` | Template for Docker test config. Safe defaults only. |
| `.env.production` | Production Firebase build. Must point to PROD Supabase only. |
| `.env.lan` | Recommended new file for testing from phone/tablet. Use Mac LAN IP for Supabase URL. Do not commit if it contains keys. |
| `.env.staging` | Recommended new file for DEV/Staging builds. Use DEV Supabase URL/key. Do not commit if it contains keys. |

Example LAN shape:

```bash
VITE_SUPABASE_URL=http://192.168.1.149:54321
VITE_SUPABASE_KEY=<local publishable/anon key>
```

Why LAN needs a separate env: a phone opening `http://192.168.1.149:5173` cannot use `http://127.0.0.1:54321`, because `127.0.0.1` means the phone itself, not the Mac.

## Normal Development Flow

1. Work locally.

```bash
supabase start
npm run docker:test:up
# or, without Docker app:
npm run dev -- --host 0.0.0.0 --port 5173
```

2. Create schema changes as migrations.

```bash
supabase migration new short_descriptive_name
# edit the generated SQL under supabase/migrations/
supabase db reset
```

3. Verify locally.

```bash
npm run build
npx playwright test src/tests/public-i18n-smoke.spec.ts --project=desktop-chromium
npm run test:api:smoke
```

Run broader suites when the change touches shared behavior:

```bash
npm run test:regression
npm run test:security
npm run test:mobile
```

## Local Supabase Backup / Restore Note

When backing up local Supabase Storage, remember that the object rows in Postgres and the binary files in the storage volume are only part of the full picture. Copying storage files back with `docker cp` can leave the files present on disk while the Storage API still fails to serve them because file-level metadata is missing.

Symptom to recognize:

- `storage.objects` rows still exist.
- Files still exist under the storage volume.
- Public image URLs return `500`, and storage logs show `ENODATA` / `The extended attribute does not exist`.

After any local restore:

1. Restore the database and storage files.
2. Open at least one known public object URL, not just the app UI.
3. If files exist but public URLs return `500` with missing extended-attribute errors, re-upload the affected objects through the Storage API from the backup payloads so Supabase rebuilds the storage metadata.
4. Treat a restore as complete only after both database counts and real public object URLs work.

## Promote To DEV / Staging

Use DEV after local is clean and the feature needs a realistic cloud pass: Auth emails, Storage, Edge Functions, public URL behavior, approval flows, or phone testing without local networking issues.

1. Confirm current projects.

```bash
supabase projects list
```

2. Link to DEV only for this promotion.

```bash
supabase link --project-ref kdjqitvtxmcrnnpuxuyl
```

3. Dry run migrations.

```bash
supabase db push --dry-run
```

4. Push migrations to DEV.

```bash
supabase db push
```

5. Deploy/serve frontend pointed at DEV.

Recommended: create `.env.staging` locally with DEV Supabase values, then build with that env. If using Firebase preview channels:

```bash
npm run build
firebase hosting:channel:deploy dev --only createeq --expires 30d
```

Shortcut after `.env.staging` is configured:

```bash
npm run deploy:staging
```

6. Test staging.

Checklist:

- Creator register submits and sends Mailpit/real DEV email as expected.
- Admin can approve/reject application.
- Login works for approved creator.
- Product image upload works for JPG/PNG/WebP/HEIC/HEIF.
- Customer pages work for `/slug/home`, `/slug/menu`, `/slug/queue`.
- Unknown slug shows `Creator not found`.
- Storage images are visible from customer phone/browser.

7. Link back to PROD after DEV work so the repo state is obvious.

```bash
supabase link --project-ref fnutmjnzugpayccscvgr
```

## Promote To PROD

Only promote to PROD after local and DEV pass.

1. Confirm you are about to affect PROD.

```bash
supabase projects list
supabase migration list
```

2. Link to PROD.

```bash
supabase link --project-ref fnutmjnzugpayccscvgr
```

3. Dry run first.

```bash
supabase db push --dry-run
```

If the CLI reports that it cannot create/update the temporary login role, set `SUPABASE_DB_PASSWORD` for the target project and retry the dry run. Do not paste the password into commits or docs.

4. Push migrations.

```bash
supabase db push
```

5. Build with `.env.production` and deploy Firebase Hosting.

```bash
npm run build
firebase deploy --only hosting:createeq
```

Shortcut after `.env.production` is configured:

```bash
npm run deploy:prod
```

6. Smoke test production.

Checklist:

- `https://createeq.web.app/` loads discovery/home.
- Creator login works.
- Admin application list is visible only for admin.
- Known creator slug loads.
- Unknown slug shows `Creator not found`.
- Product image upload still produces public customer-visible images.
- Queue ticket issuance and order flow still work.

## Safety Rules

- **Pre-Release Check**: Always run `npm run check:public` before pushing to a public repository. This script identifies risky files (secrets, build artifacts) that might be accidentally tracked by git. Use `npm run check:hygiene` for a fast scan of tracked file paths and sensitive content without running the full build/test suite.
- Never run `supabase db reset` against DEV or PROD.
- Never use production data for destructive testing.
- Always run `supabase db push --dry-run` before pushing remote migrations.
- Always check which project is linked before remote work.
- Keep `.env.production` pointed at PROD only.
- Keep `.env.staging` pointed at DEV only.
- If testing on phone against local, use LAN IP for both frontend and Supabase, not `127.0.0.1`.
- Do not commit service role keys, secret keys, local storage keys, or database passwords.

## Quick Decision Guide

| Question | Use |
| --- | --- |
| Am I still building or breaking things? | Local / Docker |
| Do I need to test from phone on the same Wi-Fi? | LAN local |
| Do I need realistic cloud Auth/Storage/Edge behavior? | DEV |
| Is this ready for real creators/customers? | PROD |

## Known Follow-Up

Create explicit staging/LAN scripts so humans do not have to remember env files:

```json
{
  "dev:lan": "vite --host 0.0.0.0 --port 5173 --mode lan",
  "build:staging": "tsc && vite build --mode staging",
  "build:prod": "tsc && vite build --mode production",
  "deploy:staging": "npm run build:staging && firebase hosting:channel:deploy dev --only createeq --expires 30d",
  "deploy:prod": "npm run build:prod && firebase deploy --only hosting:createeq"
}
```

This needs matching `.env.lan` and `.env.staging` files.
