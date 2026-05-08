# Performance Optimization Update

Date: `2026-02-14`

## Scope

- Switch Docker test env back to local Supabase workflow.
- Reduce frontend query/render overhead on high-traffic pages.
- Add DB indexes for read patterns used by queue/POS/customer pages.

## Environment Changes

- Updated `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/.env.docker.test` to local defaults:
  - `VITE_SUPABASE_URL=http://host.docker.internal:54321`
  - `VITE_SUPABASE_ANON_KEY=YOUR_TEST_ANON_KEY`
  - `VITE_SUPABASE_KEY=YOUR_TEST_ANON_KEY`

- Updated `/Users/kongzas/Desktop/Kong/EventQueueSocial/Document/DOCKER_TEST_ENV_SETUP.md` with local key retrieval flow via `supabase status -o env`.

## Frontend Optimizations Applied

### Realtime + fetch stability

- `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/src/hooks/useArtistRealtime.ts`
  - `refresh` function is now memoized (`useCallback`) to avoid repeated effect reruns.
  - Added cleanup for system channel to prevent channel leaks over long sessions.
  - Artist row updates now patch local state directly instead of full refetch.
  - Hook return now memoized (`useMemo`) for stable references.

### Dashboard workspace

- `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/src/pages/ManageCombined.tsx`
  - Replaced `select('*')` with explicit columns.
  - Queue realtime subscription now filters by `activeEvent.id` (less noise).
  - Queue list ordering switched to `queue_number` for deterministic render.

### POS panel

- `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/src/components/dashboard/PosPanel.tsx`
  - Replaced product `select('*')` with explicit columns.
  - Removed N+1 query for order items by selecting nested `order_items(...)` in order query.

### Customer queue page

- `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/src/pages/customer/QueueView.tsx`
  - Reduced row payload with explicit `select` columns.
  - Added short debounce for "now serving" refresh on burst realtime updates.
  - Changed max queue lookup to `maybeSingle()` to avoid expensive error flow.

### Customer menu page

- `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/src/pages/customer/MenuView.tsx`
  - Replaced product `select('*')` with explicit columns.
  - Added `productById` map to reduce repeated `Array.find` scans in cart operations.
  - Cart cleanup now uses map lookup instead of full scans.

### Creator pages

- `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/src/pages/creators/ManageProducts.tsx`
  - Replaced product `select('*')` with explicit columns.
  - Added lazy/async image decode on product thumbnails.

- `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/src/pages/creators/ManageArtist.tsx`
  - Replaced `select('*')` for artist/events/queue stats with explicit columns.

## Database Optimization Migration

- Added:
  - `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/supabase/migrations/20260214021500_add_performance_indexes.sql`

- Indexes added for:
  - active event lookup by artist/time/status
  - queue lookups by event/status/queue number
  - product list lookup by artist/status/deleted flag
  - order lookup by event/queue/status/time
  - order item lookup by order id
  - artist member lookup by email/status
