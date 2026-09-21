# NireQ JIRA-style Story And Spec Catalog

**Purpose:** Convert the repository's design notes into a product-owner-friendly backlog view without replacing the original specifications.  
**Status rule:** "Implemented in repository" means supporting code/migrations exist locally; it does not prove that DEV or PROD has been deployed.  
**Priority scale:** P0 release/security blocker, P1 core workflow, P2 usability/maintainability.

## Story Index

| Key | Story | Priority | Repository status |
|---|---|---:|---|
| NIR-101 | Practical team invitations | P1 | Implemented in repository |
| NIR-102 | Creator/manager vs staff login modes | P1 | Implemented in repository |
| NIR-103 | Dedicated forgot-password modal | P1 | Implemented in repository |
| NIR-104 | Manager invitation signup wording | P2 | Implemented in repository |
| NIR-105 | Explicit catalog and event stock adjustments | P0 | Implemented in repository |
| NIR-106 | Pre-order and event pickup MVP | P0 | Implemented in repository |
| NIR-107 | Event-first creator workspace | P1 | Implemented in repository |
| NIR-108 | Payment evidence and production dashboard | P0 | Implemented in repository; deployment varies by function |
| NIR-109 | Public privacy and creator recovery | P0 | Implemented in repository |
| NIR-110 | Production readiness and guided setup | P0 | Implemented in repository; operational gates remain |
| NIR-111 | Realtime publication and function hardening | P0 | Implemented as append-only migrations |
| NIR-112 | Idempotent signup, notification repair, and full-flow UAT | P0 | Implemented and locally verified in source records |
| NIR-113 | Creator Google signup and login | P1 | Implemented in repository; provider rollout is environment-specific |
| NIR-114 | Recognizable Google authentication buttons | P2 | Implemented in repository |
| NIR-115 | Fifteen-minute pre-order stock hold | P0 | Implemented in repository; remote migration requires approval |

## NIR-101 - Practical Team Invitations

**Type:** Story  
**Priority:** P1  
**Source:** `docs/superpowers/specs/2026-05-09-team-invitation-design.md`  
**Plan:** `docs/superpowers/plans/2026-05-09-team-invitation.md`

**User story:** As a booth owner or manager, I want to invite staff before they already have a NireQ account, so that the team can be prepared before event day.

**Acceptance criteria:**

- Existing users can be activated without duplicate membership.
- New users receive a pending invitation rather than silent access.
- Invitee explicitly accepts or declines while authenticated with the invited email.
- Owner/manager can cancel and re-invite.
- Email failure does not remove the invitation record.
- Invitation and membership transitions retain audit history.

## NIR-102 - Creator/Manager And Staff Login Modes

**Type:** Story  
**Priority:** P1  
**Source:** `docs/superpowers/specs/2026-05-16-login-mode-and-password-reset-design.md`

**User story:** As a management or booth staff user, I want a login flow that matches my authentication method, so that I do not choose the wrong sign-in path.

**Acceptance criteria:**

- Creator/manager password login is the default mode.
- Seller/queue staff magic-link login is a separate visible mode.
- Password recovery appears only in creator/manager mode.
- Role routing continues to use database actor context.
- Switching modes clears irrelevant local feedback and does not mix credentials.

## NIR-103 - Dedicated Forgot-password Modal

**Type:** Story  
**Priority:** P1  
**Source:** `docs/superpowers/specs/2026-05-16-forgot-password-modal-design.md`

**User story:** As a creator or manager who forgot a password, I want a focused recovery dialog, so that reset actions are not confused with login.

**Acceptance criteria:**

- `Forgot password?` opens a dedicated accessible dialog.
- The modal starts with a blank email and has its own validation/loading state.
- Success copy does not reveal whether an account exists.
- The recovery link returns to `/reset-password`.
- Close/reopen resets modal-local state; Staff mode closes the dialog.

## NIR-104 - Manager Invitation Signup Wording

**Type:** Story  
**Priority:** P2  
**Source:** `docs/superpowers/specs/2026-05-16-manager-invitation-signup-copy-design.md`

**User story:** As an invited manager, I want signup copy that describes manager access, so that I understand I am not creating a generic staff or creator account.

**Acceptance criteria:**

- Public login does not advertise generic staff account creation.
- Invitation CTA and page use manager-specific wording.
- Existing `/staff-signup` links remain compatible.
- Seller and queue-staff magic-link behavior remains unchanged.

## NIR-105 - Explicit Stock Adjustments

**Type:** Story  
**Priority:** P0  
**Source:** `docs/superpowers/specs/2026-05-16-stock-adjustment-flow-design.md`  
**Plan:** `docs/superpowers/plans/2026-05-16-stock-adjustment-flow.md`

**User story:** As a creator managing physical inventory, I want explicit catalog and event stock movements, so that ongoing changes cannot silently overwrite reserved or allocated stock.

**Acceptance criteria:**

- Initial stock remains simple during product creation.
- Existing products use Add/Remove stock actions.
- Event allocation uses Add to event/Remove from event actions.
- Removal cannot reduce below reserved, sold, or allocated constraints.
- Transactional RPCs enforce ownership and lock relevant rows.
- UI displays on-hand, allocated, reserved, sold, and available values clearly.

## NIR-106 - Pre-order And Event Pickup MVP

**Type:** Epic/Story  
**Priority:** P0  
**Source:** `docs/superpowers/specs/2026-06-02-preorder-pickup-mvp-design.md`  
**Plan:** `docs/superpowers/plans/2026-06-02-preorder-pickup-mvp.md`

**User story:** As an event customer, I want to reserve products before arriving and collect them with a code, so that I do not need to join the live queue to secure stock.

**Acceptance criteria:**

- Pre-order availability is configured per event.
- Customer creates an order without a queue ticket.
- Backend generates a pickup code and reserves finite stock atomically.
- Staff can search and mark eligible orders picked up.
- Cancellation/expiry releases stock exactly once.
- Live POS and queue ordering continue to work independently.

## NIR-107 - Event-first Creator Workspace

**Type:** Story  
**Priority:** P1  
**Source:** `docs/superpowers/specs/2026-06-03-event-workspace-restructure-design.md`

**User story:** As a creator usually operating one event, I want to land in that event's workspace with a clear next action, so that I do not scan a command-heavy event table.

**Acceptance criteria:**

- Zero active events shows creation guidance.
- One active event opens its workspace by default.
- Multiple active events show a selection grid.
- User can always return to all active and ended events without redirect loops.
- Workspace emphasizes lifecycle-relevant actions.
- Queue and POS remain one click away during booth operations.

## NIR-108 - Payment Evidence And Production Dashboard

**Type:** Epic/Story  
**Priority:** P0  
**Source:** `docs/superpowers/specs/2026-06-06-preorder-payment-and-production-dashboard-design.md`  
**Plan:** `docs/superpowers/plans/2026-06-07-preorder-payment-evidence-production-dashboard.md`

**User story:** As a creator accepting direct bank/PromptPay transfers, I want customers to submit evidence and a production summary, so that I can review payments and order goods without NireQ handling money.

**Acceptance criteria:**

- Seller configures their own payment instructions.
- Customer provides reachable contact data and private evidence.
- Seller confirms/rejects manually with an auditable status transition.
- Evidence is accessible only to authorized reviewers.
- Production dashboard counts confirmed quantities and supports export.
- Notification failure never repeats a money or stock mutation.
- NireQ does not receive, settle, or transfer customer funds.

## NIR-109 - Public Privacy And Creator Recovery

**Type:** Story  
**Priority:** P0  
**Source:** `docs/superpowers/specs/2026-07-10-public-privacy-and-creator-recovery-design.md`

**User story:** As a creator whose signup callback was incomplete or expired, I want a safe recovery path while private information stays hidden, so that I can finish setup without support intervention.

**Acceptance criteria:**

- Public legal/privacy routes are available.
- Incomplete authenticated creators can complete required metadata at `/creator/complete`.
- Database RPC remains the workspace-creation authority.
- Expired confirmation links show actionable, non-enumerating feedback.
- Public pages never expose private creator/order/payment data.

## NIR-110 - Production Readiness And Guided Setup

**Type:** Epic  
**Priority:** P0  
**Source:** `docs/superpowers/specs/2026-07-16-production-readiness-and-guided-workspace-design.md`  
**Plan:** `docs/superpowers/plans/2026-07-16-production-readiness-and-guided-workspace.md`

**User story:** As a new creator preparing a pilot event, I want guided readiness checks and reliable release evidence, so that I can open the booth without missing critical setup.

**Acceptance criteria:**

- Guided setup derives completion from real profile/event/catalog/payment/pickup data.
- Publishing is explicit; copying/opening URLs does not silently publish.
- Thai text, keyboard dialogs, and critical mobile paths are usable.
- Release identifies the deployed commit and passes the canonical verification gate.
- Production changes require approval, target confirmation, backup/rollback readiness, and smoke testing.

## NIR-111 - Realtime And Function Security Hardening

**Type:** Technical story  
**Priority:** P0  
**Source:** `docs/superpowers/specs/2026-08-25-realtime-publication-and-function-search-path-design.md`

**User story:** As a release operator, I want all subscribed tables published and mutable function search paths pinned, so that realtime behavior works without leaving known database security-advisor warnings.

**Acceptance criteria:**

- Required subscribed tables are conditionally added to `supabase_realtime`.
- RLS remains enabled on published tables.
- Identified functions use an empty pinned `search_path` and qualified object names.
- Currency validation behavior remains unchanged.
- Append-only migrations and pgTAP tests verify both concerns.

## NIR-112 - Idempotent Signup And Full-flow UAT

**Type:** Bug/Technical story  
**Priority:** P0  
**Source:** `docs/superpowers/specs/2026-08-25-signup-notification-full-flow-uat-design.md`  
**Plan:** `docs/superpowers/plans/2026-08-25-signup-notification-full-flow-uat.md`

**User story:** As a creator completing signup and pre-order operations, I want retries and concurrent requests to be harmless, so that one action cannot create duplicates or suppress notifications.

**Acceptance criteria:**

- One active creator application exists per authenticated user.
- Concurrent completion calls return idempotent outcomes.
- Notification UUID validation accepts canonical UUIDs.
- Mailpit receives local notification evidence.
- Full-flow UAT verifies stock across pre-order, rejection/cancellation, event sale, pickup, and shipment.
- Owner, manager, seller, and queue staff remain constrained to intended actions/events.

## NIR-113 - Creator Google Signup And Login

**Type:** Epic/Story  
**Priority:** P1  
**Source:** `docs/superpowers/specs/2026-08-26-creator-google-auth-design.md`  
**Plan:** `docs/superpowers/plans/2026-08-26-creator-google-auth.md`

**User story:** As a creator or existing management user, I want to authenticate with Google while retaining database-backed roles, so that access is easier without changing authorization.

**Acceptance criteria:**

- New creator starts Google-first then completes the existing application.
- Existing same-email identities retain their current database role.
- Email/password and staff magic-link fallbacks remain available.
- Customers remain guest-first.
- Different-email manual identity linking is explicitly deferred.
- Provider/redirect configuration is verified in DEV before separately approved PROD rollout.

## NIR-114 - Google Authentication Button Design

**Type:** Story  
**Priority:** P2  
**Source:** `docs/superpowers/specs/2026-08-27-google-auth-button-design.md`

**User story:** As a user, I want the Google action to look immediately recognizable and accessible, so that I can choose it confidently.

**Acceptance criteria:**

- Login and signup use the official multicolor Google G asset locally.
- Button is white with clear border, focus, hover, disabled, and loading states.
- Touch target is at least 48px and accessible name is stable.
- Staff mode and OAuth behavior remain unchanged.
- Focused browser coverage verifies both pages and mobile layout.

## NIR-115 - Fifteen-minute Pre-order Stock Hold

**Type:** Story  
**Priority:** P0  
**Source:** `docs/superpowers/specs/2026-09-01-preorder-stock-hold-design.md`  
**Plan:** `docs/superpowers/plans/2026-09-01-preorder-stock-hold.md`

**User story:** As a customer paying for a finite pre-order, I want stock held for a visible short period, so that I can complete payment without another customer taking the item.

**Acceptance criteria:**

- New finite-stock pre-orders reserve stock atomically for 15 minutes.
- Public order page displays deadline and countdown.
- Submitted evidence keeps stock reserved until review.
- Confirmation converts reserved stock to sold.
- Rejection, cancellation, and expiry release stock once.
- Expired customers cannot submit evidence and are directed to create a new order.
- Automatic expiry is private, idempotent, and covered by stock regression tests.

## Definition Of Done For Any Story

- Requested behavior works through the real user flow.
- The narrow relevant regression passes.
- `npm run verify` passes.
- Money, stock, auth, authorization, or RLS work runs its focused security/database regression.
- Remote environment changes are recorded separately from repository implementation.
- Production deployment and remote migrations receive explicit approval.
