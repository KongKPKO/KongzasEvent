# NireQ API Handbook

**Repository:** `KongKPKO/KongzasEvent`  
**Audience:** Product owner, developers, QA, and release operators  
**Source of truth:** Frontend calls under `src/`, append-only SQL migrations under `supabase/migrations/`, and Edge Functions under `supabase/functions/`

## 1. What This API Is

NireQ does not run a separate Express or REST server. The application uses Supabase as its backend platform:

- Supabase Auth creates and validates user sessions.
- PostgREST exposes approved tables and views through `/rest/v1`.
- PostgreSQL RPC functions implement trusted workflows such as queue creation, stock reservation, checkout, payment review, and team invitations.
- Supabase Edge Functions send operational emails through Mailpit in local development or Resend in hosted environments.
- Supabase Realtime notifies the browser when queue, event, catalog, order, or payment state changes.

The browser must use only the public Supabase key. Service-role credentials belong only in trusted Edge Function or administrative environments.

## 2. User And Role Model

| Actor | Typical access |
|---|---|
| Visitor / customer | Public booth, menu, queue entry, pre-order creation, order lookup by code |
| Owner | Full creator workspace, event setup, stock, team, queue, POS, payment review |
| Manager | Most management operations delegated by the owner |
| Seller | Assigned event POS, order completion, permitted pickup/payment actions |
| Queue staff | Assigned event queue and pickup operations |
| Platform admin | Creator application approval/rejection and platform review |

Authorization is database-backed. UI visibility is not an authorization boundary. Protected operations must verify the authenticated user, creator membership, assigned event, and allowed role inside RLS or the RPC itself.

## 3. Architecture Map

```text
React/Vite browser
  |-- Supabase Auth
  |-- PostgREST table reads/writes
  |-- PostgreSQL RPC workflows
  |     |-- authorization checks
  |     |-- stock and money-state transactions
  |     `-- audit/status transitions
  |-- Realtime subscriptions
  `-- Edge Functions
        |-- notify-creator-application
        |-- notify-team-invitation
        `-- notify-preorder-payment
```

## 4. Critical Business Flows

### 4.1 Creator signup and workspace access

1. User registers or signs in through Supabase Auth.
2. `complete_verified_creator_signup` creates or reuses the verified creator application/workspace.
3. `get_actor_context` returns the creator and role used for routing.
4. `has_event_role` protects event-scoped pages.
5. `list_accessible_pos_events` returns only operational events the actor can access.

### 4.2 Queue and live booth

1. Owner or manager opens the booth with `set_booth_open_status`.
2. Customer creates a queue ticket with `create_queue_ticket`; a local fingerprint makes retries idempotent.
3. `estimate_queue_eta` supplies an approximate wait time.
4. Staff update queue state through permitted table operations.
5. Customer can leave safely through `leave_queue_ticket`.

### 4.3 POS order and stock

1. Customer or staff creates an order through a transactional order RPC.
2. The RPC validates event catalog availability and reserves stock.
3. `sync_customer_order_items_with_stock` changes the basket without overselling.
4. `complete_order_with_stock` converts reserved quantities to sold quantities once.
5. Cancellation releases the reserved quantities.

Money and stock transitions must never be replaced with direct browser table updates.

### 4.4 Pre-order, payment evidence, and pickup

1. `create_preorder_with_stock` creates an order and a 15-minute stock hold.
2. Customer retrieves the order through `get_public_preorder_by_code`.
3. `submit_preorder_payment_evidence` records the private slip and keeps stock reserved.
4. Seller confirms or rejects through the matching payment-review RPC.
5. Confirmation converts reserved stock to sold stock; rejection/cancellation releases it.
6. `mark_preorder_picked_up` or `mark_order_shipped` finishes fulfillment.

NireQ records payment workflow evidence only. Customer money goes directly to the seller; NireQ is not a payment processor.

### 4.5 Team invitations

1. Owner/manager calls `invite_team_member`.
2. Existing users may become active members; new users receive a pending invitation.
3. `notify-team-invitation` sends the email but does not own the invitation transaction.
4. Invitees explicitly accept or decline.
5. Authorization continues to come from database membership and event assignment.

## 5. API Conventions

- UUIDs use the canonical `8-4-4-4-12` format.
- Timestamps are ISO 8601 UTC values; event display uses `event_timezone`.
- Monetary values are paired with a three-letter currency such as `THB`.
- Public order lookup requires an unguessable order/pickup code and returns masked contact data.
- Idempotency keys protect retryable order operations.
- Append-only migrations preserve database history.
- Expected business failures use stable messages/codes such as `insufficient_stock`, `payment_expired`, or `permission denied`.

## 6. Environments

| Environment | Supabase project ref | Intended use |
|---|---|---|
| Local | Local Supabase | Development and destructive automated tests |
| DEV / Staging | `kdjqitvtxmcrnnpuxuyl` | Cloud integration and UAT |
| PROD | `fnutmjnzugpayccscvgr` | Real creator/customer data |

Never apply a remote migration or deploy Production without explicit approval and target confirmation.

## 7. Related Documents

- `docs/api/API-REFERENCE.md` - callable RPC, table, and Edge Function reference
- `docs/api/API-EXAMPLES.md` - copyable Supabase JavaScript examples
- `docs/specs/JIRA-STORY-CATALOG.md` - product stories and acceptance criteria
- `docs/environment-checklist.md` - environment promotion checklist
- `docs/runbooks/production-release.md` - Production release and rollback
