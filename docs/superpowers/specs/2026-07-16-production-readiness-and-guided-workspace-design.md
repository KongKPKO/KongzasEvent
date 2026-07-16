# Nireq Production Readiness and Guided Workspace Design

**Date:** 2026-07-16  
**Status:** Approved design direction  
**Product direction:** Guided first-run setup, then an event-first daily command center  
**Visual direction:** Existing warm pink identity refined with a restrained Gridgeist system

## 1. Goal

Make Nireq safe and understandable enough for a controlled production pilot while preserving the core flows that already work:

- creator signup and verified-email workspace creation;
- event and catalog setup;
- customer queue, called state, preselected order, and POS completion;
- pre-order creation, private slip review, rejection, resubmission, confirmation, and pickup;
- password recovery and return to the existing workspace.

The design must reduce first-run confusion without slowing experienced creators or booth staff during live operations.

## 2. Production Evidence

An authorized Production QA run created and removed a temporary creator, event, product, queue ticket, live order, pre-order, payment evidence, and password reset. The following paths completed:

1. Creator registration sent a confirmation email.
2. Confirmation created an owner workspace and routed to `/manage-events`.
3. Event creation, product creation, event catalog setup, and booth opening succeeded.
4. A customer joined queue `#1`; realtime calling and arrival states propagated correctly.
5. The customer sent a preselected order; the creator received it in POS and recorded a manually verified transfer.
6. Pre-order creation returned an order code usable on another device.
7. The creator could privately preview submitted evidence, reject it with a customer-visible reason, receive a resubmission, confirm it, and mark pickup complete.
8. Password reset email, recovery link, password update, and login with the new password succeeded.
9. All temporary QA rows and Storage objects were removed and verified at zero remaining records.

Confirmed friction and failures:

- Thai text renders as missing-glyph boxes in a clean browser because the loaded fonts do not cover Thai.
- Pressing Enter while selecting a product category submitted the entire Add Product form early.
- New creators are private until Copy URL or Open Catalog silently publishes them.
- A newly opened booth could still show the customer queue as paused because booth, broadcast, and queue-open state can disagree.
- `notify-preorder-payment` is invoked by the frontend but is absent from Production, returning 404 after otherwise successful review actions.
- The slip POST failed from the Browser Use cloud environment with `net::ERR_FAILED`, while the same Production Storage API accepted the same JPEG and origin with HTTP 200. This needs a reproducible browser regression before changing upload logic.
- Creator registration and login do not expose Privacy or Terms pages.
- The reset dialog does not trap or restore focus and does not close on Escape.
- Production release CI is not a reliable gate because the workflow references a nonexistent Playwright project and reads the Supabase URL from the wrong GitHub variable source.
- Production lacks sufficient application error monitoring and release identification.

## 3. Governing UX Thesis

> A calm event-first workspace that gives a new creator one clear next step, then becomes a fast command center after the booth is published.

The first-run experience uses guided setup. Daily work uses the existing event workspace, simplified into clear operational groups. The interface remains practical, energetic, and trustworthy rather than becoming a generic wizard or marketing dashboard.

## 4. Information Architecture

### 4.1 Guided first-run

The setup guide contains five derived steps:

1. **Booth profile** — display name, public slug, contact, and required legal acknowledgement.
2. **Event details** — confirmed future/current event with timezone, location, booth, and queue area.
3. **Products and stock** — at least one active product selling in the selected event catalog.
4. **Payment and fulfillment** — required payment instructions and pickup details only when pre-order or post-order is enabled.
5. **Preview and publish** — customer preview plus an explicit Publish Booth action.

The guide stores no independent completion flags. Each step derives its state from existing artist, event, event-product, schedule, payment-method, and pickup data. Returning to a changed setup immediately recomputes readiness.

Experienced owners may leave the guide at any time. The guide remains resumable from the daily workspace and never blocks access to an existing live event.

### 4.2 Daily command center

After publication, the selected event opens in a command center organized by work phase:

- **Overview** — one dominant next action plus event health.
- **Setup** — event details, event catalog, promotion, payment, and pickup settings.
- **Live** — queue and POS remain one click away.
- **Fulfill** — payment review, pickup, post-order shipping.
- **Review** — dashboard and order history.

Existing routes remain valid. The change is navigation hierarchy and task prioritization, not a route rewrite.

The next-action resolver uses this order:

1. blocking setup required for the active selling mode;
2. payment evidence awaiting review;
3. pickup or shipping awaiting action;
4. active queue waiting/calling work;
5. open-booth action on event day;
6. optional setup or review.

## 5. Visual System

Nireq keeps its existing pink identity with these roles:

- warm off-white page background;
- white operational surfaces;
- near-black primary text;
- pink for the Nireq brand, primary actions, selected navigation, setup attention, and focus rings;
- green only for confirmed success or ready/open state;
- amber for warnings and incomplete setup;
- red for destructive or rejected state;
- quiet neutral rules for alignment and grouping.

The system uses a consistent outer grid, restrained radii, limited shadows, and visible alignment rules. It avoids stacked decorative cards, oversized hero treatment inside the workspace, and using pink as a substitute for status semantics.

Thai and English must both render through a font stack with explicit Thai glyph coverage. Dynamic Thai labels must survive mobile widths without relying on OS font fallback.

## 6. Interaction Design

### 6.1 Explicit publication

Copying a URL or opening a preview must never change public visibility. Publication is a dedicated action that:

- shows the exact public slug and selected shareable event;
- confirms the booth has customer-visible products;
- reports missing readiness requirements inline;
- publishes once confirmed;
- then offers Copy URL and Open Customer Preview.

### 6.2 Safe product creation

Enter inside category/tag autocomplete selects the highlighted option and does not submit the containing form. Product creation occurs only through the visible Add Product action. The form preserves entered values on validation or upload failure.

### 6.3 Queue state

Customer queue availability is presented as one coherent state derived from:

- an active confirmed event;
- booth open status;
- creator queue-open status;
- optional broadcast/pause reason.

Opening a booth must not leave a stale paused flag. Clearing a pause must reopen intake predictably. UI labels distinguish `Booth open`, `Queue accepting tickets`, and `Queue paused` without requiring a pause-then-clear workaround.

Only roles authorized by the final server-side policy may change booth availability. Destructive operational toggles require a confirmation when they would strand active customers.

### 6.4 Payment semantics

Nireq does not verify bank transfers. Copy and controls state that:

- the customer pays the creator directly;
- Nireq stores the order and private evidence;
- the creator checks the evidence and confirms or rejects it;
- POS `TRANSFER` means `Confirm transfer received`, not automatic verification.

An optional creator note/reference may be stored for reconciliation, but it is not required to complete a sale and does not claim bank verification.

### 6.5 Dialog accessibility

Dialogs use the existing component approach but must:

- move focus to the first useful control on open;
- keep Tab and Shift+Tab within the dialog;
- close on Escape when safe;
- return focus to the opener;
- use at least 44px touch targets for primary interactive controls.

## 7. Reliability and Error Handling

Business state and notification delivery are separate outcomes.

- If payment confirmation succeeds but email notification fails, show `Payment confirmed` first and a separate `Email not sent` warning with a retry action.
- Never retry money, stock, order, queue, or fulfillment mutations automatically.
- Notification retries use an idempotent notification request and never repeat the business mutation.
- Upload failures preserve the chosen file and display the Storage error. The upload implementation changes only after the failure reproduces outside the Browser Use cloud environment or a concrete browser/network incompatibility is identified.
- Creator recovery uses authenticated server state and the authoritative workspace-completion RPC. User-editable metadata supplies onboarding inputs only and is never authorization state.
- Expired signup links show a resend action and a separate path for an already-confirmed account missing a workspace.

## 8. Workstreams

### 8.1 Production foundation

- Add Thai-capable font loading and regression coverage.
- Add valid PWA icons, `robots.txt`, and `sitemap.xml`.
- Add hosting security headers and cache immutable hashed assets appropriately.
- Correct CI Playwright project names and environment-variable sources.
- Require a single release branch/source of truth, green checks, and commit/release metadata in deploy artifacts.
- Remove unused production dependencies where deletion eliminates audit findings; update only directly affected runtime packages.

### 8.2 Creator onboarding and guided setup

- Add public Privacy and Terms routes and links from signup/login.
- Implement verified-email recovery, resend, and expired-link handling.
- Add accessible reset dialog behavior.
- Add derived five-step guided setup.
- Add explicit publish and customer preview actions.
- Apply the approved restrained pink Gridgeist hierarchy.

### 8.3 Customer and live operations

- Prevent autocomplete Enter from submitting product creation.
- Reconcile booth, queue-open, and broadcast state.
- Restrict booth controls by role and add confirmation where active customers are affected.
- Add ticket/order recovery using an existing order or pickup code where available; do not add customer accounts solely for recovery.
- Add visibility-change/server-backed expiry handling so browser throttling is not the only expiry mechanism.
- Clarify manual transfer confirmation and optional reference notes.

### 8.4 Backend reliability and security

- Deploy and verify `notify-preorder-payment` with authenticated/authorized invocation appropriate to each event.
- Add notification retry without repeating business state changes.
- Enable sanitized production monitoring with release SHA/version and actionable alerts.
- Reduce table/function grants to least privilege while preserving tested RLS behavior.
- Fix mutable function search paths and review public GraphQL/function exposure.
- Enable leaked-password protection and verify Production auth policy.
- Enforce database SSL and restrict direct database networks to required sources.
- Establish a usable backup/PITR posture and perform a documented restore verification.

Remote migrations, Production configuration changes, and Production deployment require an explicit release approval after local verification.

## 9. Testing Strategy

Each workstream leaves the smallest durable regression that proves its risk boundary:

- Playwright coverage for Thai glyph rendering, guided readiness, explicit publication, product Enter behavior, queue availability, recovery, and accessible dialogs;
- SQL/RLS regression for role-restricted booth actions, recovery RPCs, notification authorization, and least-privilege grants;
- API/Storage regression for allowed evidence types, private reads, upload failure handling, and signed preview access;
- CI validation that the configured Playwright project exists and required environment values are non-empty;
- production-build verification for headers, PWA assets, robots, sitemap, release metadata, and monitoring initialization.

The release candidate must run:

1. the narrow test for each change;
2. `npm run verify`;
3. a fresh diff review and confirmed-finding fix pass;
4. `npm run verify` again;
5. a controlled end-to-end run with a temporary QA creator:
   - signup and email confirmation;
   - guided setup and explicit publication;
   - queue, call, customer order, and manual POS transfer confirmation;
   - pre-order, slip upload, rejection, resubmission, confirmation, and pickup;
   - password reset and login;
   - cleanup verified by exact IDs.

The application is ready for a broader pilot only when the critical path passes, CI is green on the actual release source, Production monitoring is active, and backup restore capability is demonstrated.

## 10. Deliberate Non-Goals

- Automatic bank-transfer verification.
- A new customer account system solely for ticket recovery.
- A new wizard framework or wizard-state database table.
- Replacing the existing route structure or working queue/POS/pre-order domain model.
- Bulk dependency upgrades unrelated to a confirmed production risk.
- A full visual redesign of every management page before critical production issues are resolved.
