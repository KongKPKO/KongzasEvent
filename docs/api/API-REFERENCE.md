# NireQ API Reference

This reference lists API surfaces called by the current frontend. SQL migrations remain the authoritative definition for parameters, return types, grants, RLS, and transaction behavior.

## 1. Authentication And Access

| RPC | Main inputs | Access | Purpose |
|---|---|---|---|
| `complete_verified_creator_signup` | Session metadata | Verified authenticated user | Idempotently create or reuse a creator application/workspace |
| `get_actor_context` | None | Authenticated | Return creator membership, role, owner flag, and member email |
| `has_event_role` | `p_event_id`, `p_allowed_roles` | Authenticated | Authorize an event-scoped route/action |
| `is_creator_slug_available` | `p_slug` | Public/authenticated | Validate a requested public creator slug |
| `is_platform_admin` | None | Authenticated | Return whether the caller is a platform administrator |
| `list_accessible_pos_events` | None | Authenticated staff | Return only events available for operational POS/queue use |
| `publish_artist_public_booth` | `p_artist_id`, `p_event_id` | Owner/manager | Explicitly publish a creator booth and selected event |
| `approve_creator_application` | Application identifier and review data | Platform admin | Approve an application and provision access |
| `reject_creator_application` | Application identifier and review note | Platform admin | Reject an application without deleting its audit row |
| `update_artist_member_role` | Artist/member identifiers and role | Owner/manager | Change a member role under role-escalation rules |

## 2. Team Invitations

| RPC | Main inputs | Access | Purpose |
|---|---|---|---|
| `invite_team_member` | Artist, email, role, optional event assignment | Owner/manager | Add an existing member or create a pending invitation |
| `list_team_invitations` | `p_artist_id` | Owner/manager | List current and historical team invitations |
| `cancel_team_invitation` | `p_invitation_id` | Owner/manager | Cancel a pending invitation while keeping audit history |
| `list_my_pending_invitations` | None | Authenticated | List invitations matching the caller's verified email |
| `accept_team_invitation` | `p_invitation_id` | Authenticated invitee | Accept and create the permitted membership/assignment |
| `decline_team_invitation` | `p_invitation_id` | Authenticated invitee | Permanently decline a pending invitation |

## 3. Catalog, Event Stock, And Templates

| RPC | Main inputs | Access | Purpose |
|---|---|---|---|
| `list_event_products` | `p_event_id` | Public or authorized depending on publication | Return event catalog products with event stock and currency |
| `save_event_catalog` | Event identifier and catalog rows | Owner/manager | Atomically save event products and allocations |
| `calculate_product_event_allocation_available` | Product/event identifiers | Owner/manager | Calculate catalog stock still available to allocate |
| `list_product_stock_summaries` | `p_artist_id` | Owner/manager | Return on-hand, allocated, reserved, sold, and available stock |
| `add_catalog_stock` | Product and positive quantity | Owner/manager | Increase creator catalog stock explicitly |
| `remove_catalog_stock` | Product and quantity | Owner/manager | Reduce only stock that is safe to remove |
| `add_event_stock` | Event product and quantity | Owner/manager | Allocate available catalog stock to an event |
| `remove_event_stock` | Event product and quantity | Owner/manager | Return removable event stock to catalog availability |
| `create_products_from_template` | Template identifier and product options | Owner/manager | Create products from a saved template/variant structure |

## 4. Promotions And Pricing

| RPC | Main inputs | Access | Purpose |
|---|---|---|---|
| `list_active_promotions` | Artist/event/time context | Public/authenticated | Return eligible active promotion rules |
| `apply_order_pricing` | Order context/items | Transaction caller | Apply validated promotion pricing to an order |
| `get_promotion_analytics` | `p_artist_id` | Owner/manager | Return promotion usage and outcome metrics |

## 5. Queue And Booth Operations

| RPC | Main inputs | Access | Purpose |
|---|---|---|---|
| `create_queue_ticket` | `p_artist_id`, `p_event_id`, optional `p_customer_fingerprint` | Public | Atomically issue one queue ticket for the service date |
| `estimate_queue_eta` | Queue/event context | Public/authenticated | Estimate wait time from current queue/service history |
| `leave_queue_ticket` | Ticket identifier and customer proof | Customer holding ticket | Leave an active queue without exposing staff mutation rights |
| `set_artist_queue_broadcast` | Artist and broadcast state/message | Queue-capable staff | Update customer-visible queue message/state |
| `set_booth_open_status` | `p_event_id`, `p_is_open` | Authorized event staff | Open/close booth and synchronize queue intake state |

## 6. Live Orders And POS

| RPC | Main inputs | Access | Purpose |
|---|---|---|---|
| `create_customer_order_with_stock` | Event/queue/customer items and idempotency | Customer with valid context | Create an order and reserve stock atomically |
| `create_walkin_order_with_stock` | Event, items, customer data, idempotency | Seller/owner/manager | Create a walk-in POS order and reserve stock |
| `sync_customer_order_items_with_stock` | Order identifier and new item set | Authorized order actor | Reconcile basket quantities and stock reservations |
| `complete_order_with_stock` | Order/payment completion data | Seller/owner/manager | Complete once and convert reserved stock to sold |
| `cancel_customer_order_with_stock_release` | Order identifier and reason | Authorized actor | Cancel and release reserved stock |
| `get_customer_order_status` | Customer order proof | Customer | Return limited customer-safe status |
| `get_public_order_receipt` | Public order/pickup code | Public with code | Return a customer-safe receipt |

## 7. Pre-order, Payment Review, And Fulfillment

| RPC | Main inputs | Access | Purpose |
|---|---|---|---|
| `create_preorder_with_stock` | Event, customer, items, fulfillment details | Public | Create a pre/post-event order and reserve a timed stock hold |
| `get_public_preorder_by_code` | `p_artist_slug`, `p_pickup_code` | Public with code | Return masked order, payment, deadline, and fulfillment state |
| `submit_preorder_payment_evidence` | Order/code and evidence object path | Public customer with code | Submit private evidence while preserving/reacquiring stock correctly |
| `cancel_public_preorder_before_payment` | Order/code | Public customer with code | Cancel an unpaid order and release an active hold |
| `confirm_preorder_payment` | Order identifier and review context | Authorized seller/manager/owner | Convert reserved stock to sold and mark payment confirmed |
| `reject_preorder_payment` | Order identifier and review reason | Authorized seller/manager/owner | Reject evidence and release stock according to lifecycle rules |
| `cancel_preorder_with_stock` | Order identifier and reason | Authorized staff | Cancel fulfillment and release any reserved stock |
| `expire_preorders_for_event` | `p_event_id` | Owner/manager | Expire eligible no-show/abandoned orders idempotently |
| `list_preorder_payment_review` | Event/filter context | Authorized seller/manager/owner | Return payment-review queue with private evidence metadata |
| `list_preorder_production_summary` | `p_event_id` | Authorized seller/manager/owner | Aggregate confirmed production quantities and customer orders |
| `mark_preorder_picked_up` | `p_order_id` | Authorized event staff | Mark one confirmed order as picked up |
| `mark_order_shipped` | Order and carrier/tracking fields | Authorized fulfillment staff | Mark post-event fulfillment as shipped |

## 8. Direct PostgREST Tables Used By The Browser

Direct table access is still constrained by RLS. The browser commonly reads or performs narrowly permitted mutations against:

| Table | Main use |
|---|---|
| `artists` | Creator profile, publication, slug, and public booth identity |
| `events` | Event schedule, location, selling mode, booth state |
| `products` | Creator catalog and product presentation |
| `event_products` | Per-event product enablement, currency, and stock allocation |
| `event_payment_methods` | Seller-owned payment instructions for one event |
| `artist_promotions` | Promotion configuration and display |
| `product_templates` | Reusable product/variant setup |
| `queues` | Staff queue progression and customer status display |
| `orders` | Authorized order lists and operational state |
| `order_items` | Items belonging to an authorized order |
| `event_member_assignments` | Staff-to-event assignment visibility |

Stock, payment, role, and final order-state mutations should use their RPC rather than direct table writes.

## 9. Edge Functions

### `notify-creator-application`

- **Endpoint:** `/functions/v1/notify-creator-application`
- **Body:** `applicationId`, optional event (`submitted`, `auto_approved`, `approved`, `rejected`)
- **Purpose:** Notify the administrator or creator about application state.
- **Delivery:** Mailpit locally when Resend is unavailable; Resend in configured hosted environments.
- **Important:** The database application state is authoritative; an email failure must not roll back an already-valid application transaction.

### `notify-team-invitation`

- **Endpoint:** `/functions/v1/notify-team-invitation`
- **Body:** `invitation_id` UUID
- **Auth:** Bearer session required; caller must be allowed to manage the invitation's creator.
- **Purpose:** Send a team invitation email after the invitation row exists.
- **Important:** Email failure does not delete or roll back the pending invitation.

### `notify-preorder-payment`

- **Endpoint:** `/functions/v1/notify-preorder-payment`
- **Body:** `order_id`, optional `pickup_code`, event (`submitted`, `confirmed`, `rejected`)
- **Auth:** Submission is proven by pickup code and payment state; staff events additionally require authorized caller context.
- **Purpose:** Send customer/seller workflow notifications without repeating stock or payment mutations.
- **Important:** Notification delivery is separate from business-state success.

## 10. Common Error Classes

| HTTP/database class | Meaning |
|---|---|
| `400` | Missing/malformed input or unsupported event value |
| `401` | Missing, invalid, or expired authentication |
| `403` / `permission denied` | Authenticated caller lacks creator/event role |
| `404` | Resource intentionally hidden or not found |
| `409` | Current lifecycle state conflicts with the requested action |
| `insufficient_stock` | Transaction cannot reserve the requested finite quantity |
| `payment_expired` | Timed pre-order hold has expired; customer must create a new order |
| `500` / `502` | Server configuration, provider, or unexpected backend failure |

## 11. Source Lookup

To find the current implementation of an RPC:

```bash
rg -n "create( or replace)? function public\\.FUNCTION_NAME" supabase/migrations
rg -n "rpc\\('FUNCTION_NAME'" src
```

When several migrations define the same function, the latest append-only migration is the current definition.
