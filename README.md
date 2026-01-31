# EventWebQueue

Production Deployment Readiness, Runbook, and Test Matrix Summary

## Overview
EventWebQueue is a Vite + React + TypeScript frontend for event queue management and POS, backed by Supabase (auth, database, storage, realtime). The system supports:
- Admin: Manage Events, Queue/POS, Products (CRUD, CSV import, currency)
- Customer: Home, Menu, Queue (ticketing)
- Realtime updates via Supabase channels
- Automated tests via Playwright across a multi-device matrix

## Tech Stack
- React + TypeScript (Vite)
- Supabase: Auth, Postgres, Storage, Realtime
- Playwright: E2E/Regression (multi-device, multi-browser)

## Environments & Configuration
Define the following environment variables for each environment (staging/production):

Required (client/runtime):
- `VITE_SUPABASE_URL` = https://<your-supabase-project>.supabase.co
- `VITE_SUPABASE_ANON_KEY` = <anon-public-key>

Server-side only (do NOT ship to client unless absolutely required; depends on your backend usage):
- `SUPABASE_SERVICE_ROLE` (if used by backend/admin scripts)
- `JWT_SECRET` and other backend-only secrets (if applicable)

Supabase configuration:
- Apply all SQL migrations in `supabase/migrations/` to staging/prod:
  - `20260131140000_add_deleted_at_to_products.sql` (soft delete)
  - `20260130190115_create_storage_policy.sql` (Menu bucket policy)
  - All prior schema/seed fixes
- RLS and Storage Policies:
  - Ensure artist-level isolation on: `products`, `orders`, `order_items`, `events`, `queues`, `artists`
  - Storage bucket `Menu`: public read for images; authenticated write (admins only) via policy

## Build & Deploy
1) Install & build
```
npm ci
npm run build
```
The production artifacts are emitted to `dist/`.

2) Deploy static site (choose one)
- Vercel / Netlify / Cloudflare Pages: point to `dist/`, set env vars in project settings
- S3 + CloudFront or Nginx: upload `dist/`, configure SPA fallback (rewrite 404 -> index.html)

3) Supabase
- Create/validate project
- Apply migrations (CLI or dashboard)
- Create storage bucket `Menu` and apply policies

4) Observability (recommended)
- Add Sentry (or similar) to capture frontend exceptions
- Configure uptime checks for the public site

## Smoke Test Checklist
Run on staging and post-deploy to production.

Admin
- Login: `/manage-login`
- Events: `/manage-events` (list/create if needed)
- POS/Queue: `/manage-pos-queues`
  - Verify header and `BOOTH OPEN/CLOSED`
  - Toggle booth open/close
  - POS: select Walk-in or serving queue, add products, charge (Cash)

Products
- `/manage-products`
  - Add a product with image
  - Edit status (Enable/Disable/Sold Out)
  - CSV import (2–3 rows) and confirm processed items

Customer
- `/<artist-slug>/home` – active event status shows
- `/<artist-slug>/menu` – product list & currency format
- `/<artist-slug>/queue` – get ticket, queue number displayed, status updates

## Test Strategy & Status
Playwright regression runs across multi-device matrix:
- Desktop: Chrome (Chromium), Edge, Safari (WebKit)
- Mobile: Android (Pixel 5 – Mobile Chrome), iOS (iPhone 12 – Mobile Safari)
- Tablet: iPad Pro 11 (landscape), iPad Mini (portrait)

Current status:
- Desktop & Tablet: GREEN
- Mobile (Pixel 5, iPhone 12): 2 scenarios each timeout on POS pane visibility (see Known Caveats). These appear to be test interaction/visibility issues, not confirmed product defects.

Useful commands:
```
npx playwright test
npx playwright show-report
```

## Known Caveats & Mitigations
Mobile POS Tab Activation
- On phones, the POS pane can remain hidden on `/manage-pos-queues` until the user taps the "POS / Order" tab.
- Operational guidance: staff using phones should tap "POS / Order" to activate POS before using the product grid.
- Tests include helpers to activate the tab; adding `data-testid` hooks (pos-switcher, pos-tab, pos-pane) makes this deterministic.

CSV Upload Feedback
- CSV validation details are primarily logged to console; the UI shows a simple summary. For large bulk uploads in production, consider enhancing UI feedback (non-blocking toasts with error counts/details).

Image Storage Lifecycle
- Soft delete of products retains images to preserve history. Edit-upload replaces the image and removes the previous one. This is intentional; document this behavior for operators.

## Operational Runbook
Daily operations
- Open booth: `/manage-pos-queues` → ensure `BOOTH OPEN`
- Queue: `Call Next`, monitor `Calling` and `Serving`
- POS: select Walk-in or a serving queue → add items → `Charge` (Cash/Transfer)
- Products: CRUD, edit status, CSV import
- Events: ensure an active Confirmed event exists for the artist

Troubleshooting
- Mobile POS grid not visible → tap "POS / Order" tab; if still not visible, refresh or use tablet/desktop
- Customer cannot get ticket → verify booth open and an active event exists
- Product not visible → ensure status `enable` and currency matches
- Upload failures → verify storage policy and file types (JPG/PNG/WebP) & reasonable size

## Pre-Deploy Checklist
- [ ] Supabase migrations applied to staging/prod
- [ ] RLS and storage policies enforced for isolation
- [ ] Env vars set: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- [ ] `npm run build` successful; `dist/` generated
- [ ] Deploy `dist/` with SPA fallback
- [ ] Staging smoke tests:
  - [ ] Admin login & POS open/close
  - [ ] POS quick sale (Walk-in, add item, Cash)
  - [ ] Products add/edit/disable & verification
  - [ ] Customer ticket issuance flow
- [ ] Acknowledge mobile POS tab caveat in docs/training
- [ ] (Optional) Sentry or equivalent is configured

## Post-Deploy Validation
- Admin dashboard loads, shows booth status; toggle works
- POS adds items to cart and completes Cash sale
- Customer ticket issuance works on public site
- (Optional) Run regression suite against staging clone (be mindful of data writes)

## Development
Local dev:
```
npm run dev
```

Build:
```
npm run build
```

Run tests:
```
npx playwright test
npx playwright show-report
```

## License
Copyright © 2026. All rights reserved.
