# Phase 2–4: identity, platform administration and support

Approved implementation scope follows the audit and Phase 0–1 validation. Preserve existing business rules and unrelated work. No commits, remote migrations or deployments are authorized by this implementation request.

## Acceptance criteria

- One user can select their owner/staff workspaces with server-validated roles. Switching, logout and expired/revoked sessions cannot retain another identity/context/cart/subscription. Failed logout is visible; persisted commerce data is retained.
- `/admin` uses the existing AAL2 gate and real paginated data for overview, users/memberships, creators, events/campaigns, read-only order/queue troubleshooting, feedback and audit. Existing applications/support stay available. UID-bound admin bootstrap and lifecycle are audited; direct application-status updates cannot bypass RPC invariants.
- Feedback offers bug/support/suggestion intake to signed-in users and guests, safe optional screenshots/context/contact, abuse controls, ticket references, own-ticket status, admin filtering/status/internal notes/audit and authorized private attachments.
- New UI follows current tokens and Thai/English conventions, keyboard access and mobile layouts. Loading/empty/error/denied states are meaningful. No production mock data.
- Focused SQL/Edge/browser checks, clean isolated migration replay and `npm run verify` pass. Capture changed UI on desktop/mobile without credentials or setup secrets.

## Work order / ownership

- [x] Phase 2: server list/resolve workspaces; remove inconsistent legacy fallback; user-scoped selection; remount scoped surfaces; shared account menu/logout/help; wrong-account invitation recovery; SQL/browser regressions.
- [x] Phase 3 data/security foundation: UID-bound admin identity, controlled bootstrap/revoke, audited read APIs, guarded application transitions and negative permission tests.
- [x] Phase 3 account suspension: immediate per-account management denial, with other team members and existing orders preserved. See the follow-up validation record.
- [ ] Phase 3 content moderation: implement the confirmed hide + stop-new-transactions behavior, preserving existing tracking/fulfillment.
- [x] Phase 3 UI foundation: responsive shell + real overview/search/details/operations/audit; legacy applications/support, Phase 4 inbox and controlled admin grant/revoke. Account suspension is implemented in the follow-up; content controls remain pending.
- [x] Phase 4: ticket/private storage model + intake/admin APIs, validation/rate-limit/idempotency, user/public/help and admin flows, privacy/XSS/attachment authorization tests.
- [x] Integrate routes/menu/API contracts; verify role context and feedback authorization across modules. Account suspension follows the confirmed immediate-management-denial choice.
- [x] Start a new isolated disposable Local workspace using the Phase 0 workflow. Replay complete migrations with historical seed disabled; preserve existing Local/DEV/PROD.
- [x] Run focused checks, `npm run verify`, changed-screen mobile/desktop exercises; review the combined diff once and resolve confirmed regressions.
- [x] Record migration/rollout requirements, executed results and remaining cloud limitations.

## Product decisions

1. Confirmed 2026-10-21: immediate denial of the account’s management privileges, preserving other team members’ operation of the creator and existing orders. Public customer/support use remains available; this is not an Auth login ban.
2. Content moderation: confirmed 2026-10-21: hide/stop new transactions while preserving existing order tracking/fulfillment. Mutation controls remain pending and are excluded from the current DEV deployment.

Routine reversible choices: local-device logout; ticket statuses `new/in_progress/resolved/closed`; explicit reason for sensitive admin actions; private PNG/JPEG/WebP screenshots with bounded size/count; use installed libraries and existing UI primitives. These do not change money/stock/queue rules.

## Database / rollout

Append-only migrations. Privileged admin-access mutations require server AAL2 + bound admin identity, a reason, current-state/concurrency checks and audit. Feedback status/note writes also use request IDs and stale-status checks. Account suspension follows the confirmed behavior; content moderation has a confirmed decision and remains pending implementation. No customer financial amounts or stock counters are editable from the new console. Restrict private storage and reporter visibility on the server. Rehearse on synthetic Local fixtures; remote apply requires separately confirmed target/action. Deploy compatible migrations/Edge/frontend together only after explicit authorization.

Validation and remaining product gates: [implementation record](../../phase234-implementation-2026-10-21.md). Phase 3 content moderation implementation remains pending; account suspension is implemented separately after the confirmed choice; Phase 2 and Phase 4 are implemented and locally verified.
