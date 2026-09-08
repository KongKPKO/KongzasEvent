# Platform Admin history and safe resend

## Scope

Extend the read-only support order detail with recorded milestones and email delivery diagnostics. Reuse existing order/payment timestamps and `preorder_notification_deliveries`; do not claim these constitute a complete historical event log. A ledger row is the latest delivery state plus attempt count, not a record of every attempt.

Show created, evidence submitted, payment reviewed and fulfillment milestones only when their timestamps exist. Label missing history explicitly. Email diagnostics expose event, status, attempts and timestamps; exclude recipient addresses, provider response bodies and `last_error` free text from the browser. `delivered` means the send operation succeeded, not proof of inbox receipt or reading.

## Safe repair boundary

First repair action sends an order-status link to the saved recipient, with an admin reason and audit record. No recipient editing, payment confirmation, refund, stock adjustment, hold extension or forced expiry. A dedicated admin endpoint uses the existing Mailpit/Resend delivery pattern; existing merchant/customer notification functions and their ledger remain unchanged.

Do not replay stale notification events after order state changes; the neutral link always leads to the current order page. Protect concurrent clicks and preserve delivery idempotency. A `sending` row with an old claim is ambiguous: provider acceptance might have succeeded before the database acknowledgement. Never describe a new explicit resend as guaranteed duplicate-free. Record repair intent before sending and its result afterwards; an external send and database transaction cannot be made atomic.

## Approved resend behavior

Admin may resend even after successful delivery. Send a neutral order-status link to the saved customer email, not an obsolete event template. Require reason5–500, explicit confirmation, a unique request UUID, and a server-enforced 60-second per-order cooldown. Same-request retries never send again; ambiguous sends remain unknown rather than claiming failure or inbox receipt. Keep normal delivery history intact, record each admin send separately. No changes to recipient, order, money or stock. Applies to Campaign/Pre-order/Post-order, not offline orders.

## Verification before implementation handoff

Cover unauthorized callers, private-data allowlists, failed send retry, duplicate/concurrent attempts, changed order state, audit failure, provider error and unchanged money/stock. Verify through local Mailpit only; no real customer email or remote mutation during development. Run `npm run verify`, relevant security tests and desktop/mobile support flow. DEV deployment requires separate approval.
