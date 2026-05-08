---
name: EventQueueSocial project context
description: Core context for the EventQueueSocial / KongzasEvent product — creator booth queue + POS SaaS
type: project
---

EventQueueSocial is a real-world queue + POS system for creator/cosplay artist event booths in Thailand. The app lives in `KongzasEvent/` subdirectory.

**Why it exists:** Artist booths at cosplay/creator events (like anime conventions) had chaotic LINE group queues, slow checkout, no stock visibility. This replaces that.

**Stack:** React 18 + Vite + TypeScript → Firebase Hosting. Supabase as backend (PostgreSQL + RLS + Realtime + Storage). PWA enabled. i18n Thai/English.

**Roles:** owner > manager > seller > queue_staff. DB enforced via RLS and `has_artist_role()` RPC.

**Core flows:**
1. Customer: `/:slug/home → menu → queue` (no login, ticket stored in localStorage)
2. Staff: `/manage-login → /manage-pos-queues` (combined queue + POS dashboard)
3. Owner: `/manage-events`, `/manage-products`, `/manage-team`

**Key RPCs:** `create_queue_ticket` (atomic, prevents duplicates), `complete_order_with_stock`, `sync_customer_order_items_with_stock`, `estimate_queue_eta`

**CI:** GitHub Actions with Playwright (security, resilience, E2E, performance, mobile, offline, accessibility, browser compat) + k6 load tests.

**UAT status (2026-03-29):** GO for closed pilot/friend testing. NO-GO for public rollout until manual device UAT (iPhone Safari, Android Chrome, iPad Safari).

**Key risk:** Customer ticket stored only in localStorage — if cleared, ticket is lost with no recovery mechanism.
