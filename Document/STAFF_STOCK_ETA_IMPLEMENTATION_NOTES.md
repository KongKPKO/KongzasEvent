# Staff Role + Stock + ETA Implementation Notes

Date: `2026-02-13`

## What was implemented

### Backend (Supabase SQL)

- New migration:
  - `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/supabase/migrations/20260213232000_staff_roles_stock_eta.sql`

Includes:
- `artist_members` table for role-based team access (`owner`, `queue_only`, `queue_pos`)
- Role helper functions:
  - `has_artist_role(...)`
  - `get_actor_context()`
- Stock columns on `products`:
  - `stock_total`
  - `stock_reserved`
  - `stock_sold`
  - `is_unlimited`
- Atomic stock/order RPC functions:
  - `create_customer_order_with_stock(...)`
  - `cancel_customer_order_with_stock_release(...)`
  - `complete_order_with_stock(...)`
  - `create_walkin_order_with_stock(...)`
- Queue control RPC functions for staff:
  - `set_artist_queue_broadcast(...)`
  - `set_booth_open_status(...)`
- ETA function:
  - `estimate_queue_eta(...)`
- Additional policies for queue/POS staff access

### Frontend

- Role-aware actor context and route gating:
  - `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/src/utils/access.ts`
  - `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/src/types/access.ts`
  - `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/src/App.tsx`
  - `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/src/pages/ManageLogin.tsx`
- New owner page for team management:
  - `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/src/pages/creators/ManageTeam.tsx`
- Admin navigation updated for role visibility:
  - `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/src/components/AdminHeader.tsx`
- Queue workspace uses actor context and staff-safe RPC actions:
  - `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/src/pages/ManageCombined.tsx`
  - `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/src/components/dashboard/QueuePanel.tsx`
- POS switched to stock-safe RPC transaction flow:
  - `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/src/components/dashboard/PosPanel.tsx`
- Customer menu order flow switched to stock-safe RPC:
  - `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/src/pages/customer/MenuView.tsx`
  - `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/src/components/menu/ProductList.tsx`
- Queue ETA shown on customer ticket state:
  - `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/src/pages/customer/QueueView.tsx`
- Product management updated for stock input/edit:
  - `/Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/src/pages/creators/ManageProducts.tsx`

## Apply order

1. Apply migrations in order by timestamp.
2. Validate owner login and role context.
3. Add at least one staff email in Team page.
4. Test queue-only and queue-pos permissions.
5. Test stock reserve/complete/cancel flows.
6. Test ETA display on active waiting ticket.
