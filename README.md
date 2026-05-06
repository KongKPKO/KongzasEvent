# 🎟️ Event Queue System (SaaS MVP)

An **Event Queue + POS SaaS MVP** designed for creators and service booths at high-traffic events (e.g., fan conventions, pop-up markets, service centers). This system enables a seamless transition from queueing to ordering in a unified interface.

> [!IMPORTANT]  
> This project is a **Work-in-Progress (WIP) SaaS MVP** intended for portfolio demonstration. It is **not** currently production-ready. Specific security and reliability areas are under active development and labeled as "Review Focus" below.

---

## 🚀 Project Summary
This platform aims to solve booth congestion by allowing customers to join a virtual queue, browse digital menus, and track their status in real-time. For creators, it provides a lightweight dashboard to manage the flow of people and sales in one spot.

## 🔄 Main User Flows

### **For Customers**
*   **Discovery**: Find creators or active events via a dedicated home surface.
*   **Join Queue**: Secure a virtual ticket for an active event booth.
*   **Real-time Tracking**: Monitor "Now Serving" numbers and their own queue status via Supabase Realtime.
*   **Digital Menu**: Browse product catalogs and pricing while waiting.

### **For Admins & Staff**
*   **Booth Operations**: Open or close the booth to pause ticket issuance instantly.
*   **Queue Control**: Call the next customer, mark as serving, or complete the ticket.
*   **Integrated POS**: Link queue tickets directly to orders for seamless checkout and inventory management.

## 🛠️ Tech Stack
*   **Frontend**: React (Vite), TypeScript, Tailwind CSS, Framer Motion.
*   **Backend**: Supabase (Auth, Postgres, Storage, Realtime).
*   **Testing**: Playwright (E2E, Mobile Responsive), k6 (Load Testing).

---

## 🔍 Codebase Navigation (Reviewer Guide)
For technical reviewers, these files showcase the core logic and architectural patterns:

*   **[`src/pages/customer/QueueView.tsx`](src/pages/customer/QueueView.tsx)**: Customer-facing queue and real-time status component.
*   **[`src/pages/ManageCombined.tsx`](src/pages/ManageCombined.tsx)**: Unified Admin Workspace combining Queue Control and POS.
*   **[`src/components/dashboard/QueuePanel.tsx`](src/components/dashboard/QueuePanel.tsx)**: Core logic for admin queue state transitions.
*   **[`supabase/migrations/`](supabase/migrations/)**: Database schema, atomic RPC functions, and RLS policies.
*   **[`src/tests/e2e/full-service-loop.spec.ts`](src/tests/e2e/full-service-loop.spec.ts)**: Comprehensive E2E test covering the entire lifecycle.

## 🛡️ Technical Deep Dive & Known Review Focus
This project uses advanced serverless patterns, with several areas identified for further hardening:

*   **Atomic Queue Issuance**: Uses a Postgres RPC (`create_queue_ticket`) with `FOR UPDATE` locks to prevent duplicate ticket numbers during high-concurrency spikes.
*   **RLS Hardening (Active Review Focus)**: While Row Level Security is implemented, ensuring complete isolation and preventing unauthorized updates across all tables is a priority for the next phase.
*   **Ticket Ownership (WIP)**: Anonymous ticket ownership and the cancellation flow (`queues_public_mark_missed`) require further hardening to prevent unauthorized ticket state changes.
*   **Stale Ticket Management**: Current stale calling cleanup exists in the frontend logic; moving this to a scheduled backend cleanup (e.g., via `pg_cron` or Edge Functions) is a planned improvement.
*   **Public Direct Inserts**: A known risk is the potential for direct `INSERT` access to `public.queues` bypasssing the RPC; enforcing RPC-only insertion is an upcoming task.
*   **Realtime Latency**: Real-time updates are functional, but further stress testing for latency under 10k+ concurrent users is required.

---

## 💻 Local Development

1.  **Clone & Install**:
    ```bash
    npm install
    ```
2.  **Environment Setup**:
    *   Copy `.env.example` to `.env.local`.
    *   Fill in your Supabase credentials (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY).
3.  **Run Development Server**:
    ```bash
    npm run dev
    ```
4.  **Run Tests**:
    ```bash
    npx playwright test
    ```

---

## ⚙️ Environments & Configuration
| Layer | Purpose | Supabase Project |
| --- | --- | --- |
| **Local** | Fast testing/dev | `http://127.0.0.1:54321` |
| **Staging** | Cloud testing | `kdjqitvtxmcrnnpuxuyl` |
| **PROD** | Live Portfolio | `fnutmjnzugpayccscvgr` |

### Required Environment Variables:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `TEST_EMAIL` / `TEST_PASSWORD` (for Playwright)

---

## 🚀 Build & Deploy
1. **Build**: `npm run build` (Artifacts in `dist/`)
2. **Deploy (Firebase)**:
   - Staging: `npm run deploy:staging`
   - Production: `npm run deploy:prod`
3. **Database**: Apply migrations via `supabase db push`.

---

## ✅ Smoke Test Checklist
- [ ] Admin login (`/manage-login`)
- [ ] Toggle booth open/closed
- [ ] POS: Complete Walk-in sale (Cash)
- [ ] Customer: Get ticket from `/<slug>/queue`
- [ ] Admin: `Call Next` -> `Serve` -> `Complete`
- [ ] Customer: Verify realtime "Now Serving" updates

---

## 📝 Operational Runbook
- **Daily Open**: Admin sets booth to `BOOTH OPEN` in Dashboard.
- **Queue Management**: Use `Call Next` to pull from the waiting list.
- **Troubleshooting**: If customer cannot get ticket, verify an active event exists and the booth is open.

## License
Copyright © 2026. All rights reserved.
