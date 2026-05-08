# Docker Test Environment Setup

Date: `2026-02-14`

## Goal

Run the frontend in Docker for an isolated test environment before feature validation.

## Files Added

- `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/Dockerfile.test`
- `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/docker-compose.test.yml`
- `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/.env.docker.test.example`

## Prerequisites

- Docker Desktop running
- A reachable Supabase test backend:
  - local Supabase stack, or
  - hosted Supabase test project

## Setup

1. Create env file:
   - Copy `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/.env.docker.test.example`
   - Save as `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/.env.docker.test`
2. For local Supabase workflow (recommended for feature testing):
   - Set `VITE_SUPABASE_URL=http://127.0.0.1:54321`
   - Set `VITE_SUPABASE_ANON_KEY` and `VITE_SUPABASE_KEY` from local stack
3. To get local keys quickly:

```bash
cd /Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent
supabase status -o env
```

Copy `ANON_KEY` value into both:
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_KEY`

## Start

From `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent`:

```bash
npm run docker:test:up
```

Frontend will be available at:

- `http://localhost:5173`

## Stop

```bash
npm run docker:test:down
```

## Notes

- This compose file containerizes the app runtime.
- Supabase backend is external to this compose file and should point to a dedicated test environment.
- `docker-compose.test.yml` now loads `.env.docker.test` directly via `env_file`.

## Troubleshooting

1. If `supabase status -o env` shows `No such container: supabase_db_EventWebQueue`:
   - local Supabase is not running. Start it first:

```bash
cd /Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent
supabase start --ignore-health-check
```

2. If `supabase_kong_EventWebQueue` crashes with `exec /bin/sh: exec format error`:
   - pull `kong` image as `amd64` and restart:

```bash
docker rm -f supabase_kong_EventWebQueue || true
docker image rm public.ecr.aws/supabase/kong:2.8.1 || true
docker pull --platform linux/amd64 public.ecr.aws/supabase/kong:2.8.1
```

Then run `supabase start` again.

3. If SQL run fails with `relation already exists`:
   - do not paste whole schema repeatedly in SQL Editor.
   - use migration flow (`supabase db push`) or run only the missing migration file once.

4. If editing/adding product image fails (`name resolution failed`, upload error):
   - ensure local storage service and buckets are ready:

```bash
cd /Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent
npm run test:api:smoke
```

This validates auth/rest/storage APIs and verifies required buckets (`Menu`, `Avatar`) exist.
